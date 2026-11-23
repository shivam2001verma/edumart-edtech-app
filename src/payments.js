import express from 'express';
import crypto from 'crypto';
import Razorpay from 'razorpay';
import jwt from 'jsonwebtoken';
import db from './db.js';
import { computeCartQuote } from './pricing.js';

const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_placeholder',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'secret_placeholder',
});

// Auth middleware
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// HMAC-SHA256 helpers (exported for automated tests)
export function verifyCheckoutSignature(orderId, paymentId, signature, keySecret) {
  const expected = crypto
    .createHmac('sha256', keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return expected === signature;
}

export function verifyWebhookSignature(rawBodyBuffer, signature, webhookSecret) {
  const expected = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBodyBuffer)
    .digest('hex');
  return expected === signature;
}

/**
 * Idempotent Grant Function:
 * Called by both /verify AND /webhook. Whichever arrives first grants access;
 * subsequent calls safely ignore without duplicating entitlements or coupon counts.
 */
export async function fulfillOrderIdempotent(conn, orderId, paidAmountPaise, paymentDetails = {}) {
  // Lock order row to prevent race conditions between /verify and webhook
  const [[order]] = await conn.query(
    `SELECT * FROM orders WHERE id = ? FOR UPDATE`,
    [orderId]
  );

  if (!order) throw new Error('Order not found');

  // If already paid, do nothing (idempotent exit)
  if (order.status === 'paid') {
    return { alreadyFulfilled: true, orderId };
  }

  // Amount check before granting access
  if (Number(paidAmountPaise) !== Number(order.total_paise)) {
    await conn.query(
      `UPDATE orders SET status = 'failed' WHERE id = ?`,
      [orderId]
    );
    throw new Error(`Amount mismatch: expected ${order.total_paise}, got ${paidAmountPaise}`);
  }

  // Mark order as paid
  await conn.query(
    `UPDATE orders SET status = 'paid', paid_at = NOW() WHERE id = ?`,
    [orderId]
  );

  // Increment coupon usage if applied
  if (order.coupon_id) {
    await conn.query(
      `UPDATE coupons SET used_count = used_count + 1 WHERE id = ?`,
      [order.coupon_id]
    );
  }

  // Fetch order items and grant entitlements
  const [items] = await conn.query(
    `SELECT oi.*, p.type, p.target_id, p.duration_days
     FROM order_items oi
     JOIN products p ON oi.product_id = p.id
     WHERE oi.order_id = ?`,
    [orderId]
  );

  for (const item of items) {
    const scopeType =
      item.type === 'monthly_pass' || item.type === 'annual_pass'
        ? 'class'
        : item.type; // 'chapter' or 'subject'

    if (item.duration_days) {
      // Time-bound pass: extend from existing active expiry if present, else NOW()
      const [[existing]] = await conn.query(
        `SELECT id, expires_at FROM entitlements
         WHERE user_id = ? AND scope_type = ? AND scope_id = ? AND expires_at > NOW()
         ORDER BY expires_at DESC LIMIT 1`,
        [order.user_id, scopeType, item.target_id]
      );

      if (existing) {
        await conn.query(
          `UPDATE entitlements
           SET expires_at = DATE_ADD(expires_at, INTERVAL ? DAY), source_order_id = ?
           WHERE id = ?`,
          [item.duration_days, orderId, existing.id]
        );
      } else {
        await conn.query(
          `INSERT INTO entitlements (user_id, scope_type, scope_id, expires_at, source_order_id)
           VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY), ?)`,
          [order.user_id, scopeType, item.target_id, item.duration_days, orderId]
        );
      }
    } else {
      // Lifetime access (chapter or subject)
      await conn.query(
        `INSERT IGNORE INTO entitlements (user_id, scope_type, scope_id, expires_at, source_order_id)
         VALUES (?, ?, ?, NULL, ?)`,
        [order.user_id, scopeType, item.target_id, orderId]
      );
    }
  }

  // Record successful payment audit row
  if (paymentDetails.razorpayPaymentId) {
    await conn.query(
      `INSERT IGNORE INTO payments (order_id, razorpay_payment_id, amount_paise, status, method)
       VALUES (?, ?, ?, 'captured', ?)`,
      [orderId, paymentDetails.razorpayPaymentId, paidAmountPaise, paymentDetails.method || 'upi/card']
    );
  }

  return { alreadyFulfilled: false, orderId };
}

// 1. Preview Cart Quote (Upgrade + Coupon + GST)
router.post('/quote', requireAuth, async (req, res, next) => {
  try {
    const { productIds, couponCode } = req.body;
    const quote = await computeCartQuote(db, req.user.id, productIds, couponCode);
    res.json(quote);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 2. Create Order (Server recomputes total; never trusts browser price)
router.post('/create-order', requireAuth, async (req, res, next) => {
  const conn = await db.getConnection();
  try {
    const { productIds, couponCode } = req.body;
    const quote = await computeCartQuote(conn, req.user.id, productIds, couponCode);

    await conn.beginTransaction();

    // Create Razorpay order in paise
    const rzpOrder = await razorpay.orders.create({
      amount: quote.totalPaise,
      currency: 'INR',
      receipt: `edumart_${req.user.id}_${Date.now()}`,
    });

    const [orderRes] = await conn.query(
      `INSERT INTO orders (user_id, razorpay_order_id, subtotal_paise, discount_paise, gst_paise, total_paise, coupon_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'created')`,
      [
        req.user.id,
        rzpOrder.id,
        quote.subtotalPaise,
        quote.discountPaise,
        quote.gstPaise,
        quote.totalPaise,
        quote.couponId,
      ]
    );
    const orderId = orderRes.insertId;

    for (const item of quote.items) {
      await conn.query(
        `INSERT INTO order_items (order_id, product_id, original_price_paise, upgrade_credit_paise, final_price_paise)
         VALUES (?, ?, ?, ?, ?)`,
        [orderId, item.productId, item.originalPaise, item.upgradeCreditPaise, item.finalItemPaise]
      );
    }

    await conn.commit();

    res.json({
      orderId,
      razorpayOrderId: rzpOrder.id,
      amountPaise: quote.totalPaise,
      currency: 'INR',
      keyId: process.env.RAZORPAY_KEY_ID,
      quote,
    });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// 3. Verify Checkout Signature from Browser
router.post('/verify', requireAuth, async (req, res) => {
  const conn = await db.getConnection();
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing Razorpay payment fields' });
    }

    const isValid = verifyCheckoutSignature(
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      process.env.RAZORPAY_KEY_SECRET
    );

    if (!isValid) {
      return res.status(400).json({ error: 'Invalid payment signature' });
    }

    await conn.beginTransaction();
    const [[order]] = await conn.query(
      `SELECT * FROM orders WHERE razorpay_order_id = ? AND user_id = ?`,
      [razorpay_order_id, req.user.id]
    );
    if (!order) {
      await conn.rollback();
      return res.status(404).json({ error: 'Order not found' });
    }

    const result = await fulfillOrderIdempotent(conn, order.id, order.total_paise, {
      razorpayPaymentId: razorpay_payment_id,
    });

    await conn.commit();
    res.json({ ok: true, ...result });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// 4. Razorpay Webhook (payment.captured & payment.failed)
// Note: server.js must pass raw body buffer to this route
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const conn = await db.getConnection();
  try {
    const signature = req.headers['x-razorpay-signature'];
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));

    const isValid = verifyWebhookSignature(
      rawBody,
      signature,
      process.env.RAZORPAY_WEBHOOK_SECRET
    );

    if (!isValid) {
      return res.status(400).json({ error: 'Invalid webhook signature' });
    }

    const payload = JSON.parse(rawBody.toString('utf8'));
    const eventId = req.headers['x-razorpay-event-id'] || `${payload.event}_${payload.payload?.payment?.entity?.id}`;

    // Audit trail: store webhook event idempotently
    const [evRes] = await conn.query(
      `INSERT IGNORE INTO webhook_events (event_id, event_type, payload_json) VALUES (?, ?, ?)`,
      [eventId, payload.event, JSON.stringify(payload)]
    );

    const paymentEntity = payload.payload?.payment?.entity;
    if (!paymentEntity) {
      return res.json({ ok: true, ignored: true });
    }

    await conn.beginTransaction();
   const [[order]] = await conn.query(
      `SELECT * FROM orders WHERE razorpay_order_id = ?`,
      [paymentEntity.order_id]
    );

    if (order) {
      if (payload.event === 'payment.captured') {
        await fulfillOrderIdempotent(conn, order.id, paymentEntity.amount, {
          razorpayPaymentId: paymentEntity.id,
          method: paymentEntity.method,
        });
      } else if (payload.event === 'payment.failed') {
        if (order.status !== 'paid') {
          await conn.query(`UPDATE orders SET status = 'failed' WHERE id = ?`, [order.id]);
        }
        await conn.query(
          `INSERT IGNORE INTO payments (order_id, razorpay_payment_id, amount_paise, status, method)
           VALUES (?, ?, ?, 'failed', ?)`,
          [order.id, paymentEntity.id, paymentEntity.amount, paymentEntity.method || 'upi/card']
        );
      }
    }

    await conn.commit();
    res.json({ ok: true, duplicateEvent: evRes.affectedRows === 0 });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
});

export default router;