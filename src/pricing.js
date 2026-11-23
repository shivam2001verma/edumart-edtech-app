export function calculateGstSplit(totalInclusivePaise) {
  const safeTotal = Math.max(0, Math.round(totalInclusivePaise));
  const basePaise = Math.round((safeTotal * 100) / 118);
  const gstPaise = safeTotal - basePaise;
  return { basePaise, gstPaise, totalPaise: safeTotal };
}

export function calculateUpgradePrice({
  product,
  basePricePaise,
  ownedChapterIds = [],
  chapterProductPrices = {},
  subjectChapterIds = [],
}) {
  if (product.type !== 'subject') {
    return { originalPaise: basePricePaise, upgradeCreditPaise: 0, finalItemPaise: basePricePaise };
  }
  let credit = 0;
  for (const chId of subjectChapterIds) {
    if (ownedChapterIds.includes(chId) && chapterProductPrices[chId]) {
      credit += chapterProductPrices[chId];
    }
  }
  const finalItemPaise = Math.max(0, basePricePaise - credit);
  return {
    originalPaise: basePricePaise,
    upgradeCreditPaise: Math.min(basePricePaise, credit),
    finalItemPaise,
  };
}

export function applyCouponDiscount(subtotalPaise, coupon) {
  if (!coupon || !coupon.active) return { discountPaise: 0, couponApplied: null };
  const now = new Date();
  if (coupon.expires_at && new Date(coupon.expires_at) < now) throw new Error('Coupon has expired');
  if (coupon.usage_limit !== null && coupon.used_count >= coupon.usage_limit) {
    throw new Error('Coupon usage limit reached');
  }
  let discountPaise = 0;
  if (coupon.discount_type === 'flat') {
    discountPaise = Math.min(subtotalPaise, Math.round(coupon.discount_value));
  } else if (coupon.discount_type === 'percentage') {
    discountPaise = Math.min(subtotalPaise, Math.round((subtotalPaise * coupon.discount_value) / 100));
  }
  return { discountPaise, couponApplied: coupon.code };
}

export async function computeCartQuote(db, userId, productIds, couponCode = null) {
  if (!Array.isArray(productIds) || productIds.length === 0) throw new Error('Cart is empty');

  const [entitlements] = await db.query(
    `SELECT * FROM entitlements WHERE user_id = ? AND (expires_at IS NULL OR expires_at > NOW())`,
    [userId]
  );

  const ownedChapterIds = entitlements.filter((e) => e.scope_type === 'chapter').map((e) => e.scope_id);
  const ownedSubjectIds = entitlements.filter((e) => e.scope_type === 'subject').map((e) => e.scope_id);
  const activeClassPassIds = entitlements.filter((e) => e.scope_type === 'class').map((e) => e.scope_id);

  const [paidItems] = await db.query(
    `SELECT oi.product_id, oi.final_price_paise, p.target_id AS chapter_id
     FROM order_items oi
     JOIN orders o ON oi.order_id = o.id
     JOIN products p ON oi.product_id = p.id
     WHERE o.user_id = ? AND o.status = 'paid' AND p.type = 'chapter'`,
    [userId]
  );

  const chapterProductPrices = {};
  for (const row of paidItems) {
    chapterProductPrices[row.chapter_id] = row.final_price_paise;
  }

  const placeholders = productIds.map(() => '?').join(',');
  const [products] = await db.query(
    `SELECT p.*, pr.amount_paise FROM products p
     JOIN prices pr ON pr.product_id = p.id AND pr.active = 1
     WHERE p.id IN (${placeholders})`,
    productIds
  );

  if (products.length !== productIds.length) throw new Error('One or more products are invalid');

  const lineItems = [];
  let subtotalPaise = 0;

  for (const prod of products) {
    if (prod.type === 'chapter') {
      if (ownedChapterIds.includes(prod.target_id)) throw new Error(`You already own: ${prod.name}`);
      const [[chap]] = await db.query(
        `SELECT c.subject_id, s.class_id FROM chapters c JOIN subjects s ON c.subject_id = s.id WHERE c.id = ?`,
        [prod.target_id]
      );
      if (chap && (ownedSubjectIds.includes(chap.subject_id) || activeClassPassIds.includes(chap.class_id))) {
        throw new Error(`Already unlocked via pack/pass: ${prod.name}`);
      }
    } else if (prod.type === 'subject') {
      if (ownedSubjectIds.includes(prod.target_id)) throw new Error(`Already own pack: ${prod.name}`);
      const [[subj]] = await db.query(`SELECT class_id FROM subjects WHERE id = ?`, [prod.target_id]);
      if (subj && activeClassPassIds.includes(subj.class_id)) {
        throw new Error(`Already unlocked via class pass: ${prod.name}`);
      }
    }

    let subjectChapterIds = [];
    if (prod.type === 'subject') {
      const [chaps] = await db.query(`SELECT id FROM chapters WHERE subject_id = ?`, [prod.target_id]);
      subjectChapterIds = chaps.map((c) => c.id);
    }

    const pricing = calculateUpgradePrice({
      product: prod,
      basePricePaise: prod.amount_paise,
      ownedChapterIds,
      chapterProductPrices,
      subjectChapterIds,
    });

    subtotalPaise += pricing.finalItemPaise;
    lineItems.push({
      productId: prod.id,
      name: prod.name,
      type: prod.type,
      targetId: prod.target_id,
      durationDays: prod.duration_days,
      ...pricing,
    });
  }

  let couponRow = null;
  if (couponCode && couponCode.trim()) {
    const [[found]] = await db.query(`SELECT * FROM coupons WHERE code = ?`, [couponCode.trim().toUpperCase()]);
    if (!found) throw new Error('Invalid coupon code');
    couponRow = found;
  }

  const { discountPaise, couponApplied } = applyCouponDiscount(subtotalPaise, couponRow);
  const netPayablePaise = Math.max(0, subtotalPaise - discountPaise);
  const gstBreakdown = calculateGstSplit(netPayablePaise);

  return {
    items: lineItems,
    subtotalPaise,
    discountPaise,
    couponApplied,
    couponId: couponRow ? couponRow.id : null,
    ...gstBreakdown,
  };
}