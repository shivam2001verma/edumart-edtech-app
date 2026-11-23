import express from 'express';
import db from './db.js';
import { requireAuth } from './payments.js';

const router = express.Router();

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

router.use(requireAuth, requireAdmin);

// A1. Create Board / Class / Subject / Chapter
router.post('/boards', async (req, res, next) => {
  try {
    const [r] = await db.query(`INSERT INTO boards (name) VALUES (?)`, [req.body.name]);
    res.status(201).json({ id: r.insertId, name: req.body.name });
  } catch (e) { next(e); }
});

router.post('/classes', async (req, res, next) => {
  try {
    const [r] = await db.query(`INSERT INTO classes (board_id, name) VALUES (?, ?)`, [req.body.boardId, req.body.name]);
    res.status(201).json({ id: r.insertId, name: req.body.name });
  } catch (e) { next(e); }
});

router.post('/subjects', async (req, res, next) => {
  try {
    const [r] = await db.query(`INSERT INTO subjects (class_id, name) VALUES (?, ?)`, [req.body.classId, req.body.name]);
    res.status(201).json({ id: r.insertId, name: req.body.name });
  } catch (e) { next(e); }
});

router.post('/chapters', async (req, res, next) => {
  try {
    const { subjectId, title, isFree } = req.body;
    const [r] = await db.query(
      `INSERT INTO chapters (subject_id, title, is_free) VALUES (?, ?, ?)`,
      [subjectId, title, isFree ? 1 : 0]
    );
    res.status(201).json({ id: r.insertId, title, isFree: !!isFree });
  } catch (e) { next(e); }
});

// A2. Toggle Free Sample on a Chapter
router.patch('/chapters/:id/free', async (req, res, next) => {
  try {
    await db.query(`UPDATE chapters SET is_free = ? WHERE id = ?`, [req.body.isFree ? 1 : 0, req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// A3. Create Product & Price (in paise)
router.post('/products', async (req, res, next) => {
  const conn = await db.getConnection();
  try {
    const { type, targetId, name, durationDays, amountPaise } = req.body;
    await conn.beginTransaction();
    const [pRes] = await conn.query(
      `INSERT INTO products (type, target_id, name, duration_days) VALUES (?, ?, ?, ?)`,
      [type, targetId, name, durationDays || null]
    );
    await conn.query(
      `INSERT INTO prices (product_id, amount_paise, active) VALUES (?, ?, 1)`,
      [pRes.insertId, Math.round(amountPaise)]
    );
    await conn.commit();
    res.status(201).json({ productId: pRes.insertId });
  } catch (e) {
    await conn.rollback();
    next(e);
  } finally {
    conn.release();
  }
});

// A4. View All Orders & Payments
router.get('/orders', async (req, res, next) => {
  try {
    const { status } = req.query;
    let sql = `SELECT o.*, u.name AS student_name, u.email AS student_email
               FROM orders o JOIN users u ON o.user_id = u.id`;
    const params = [];
    if (status) {
      sql += ` WHERE o.status = ?`;
      params.push(status);
    }
    sql += ` ORDER BY o.created_at DESC`;
    const [orders] = await db.query(sql, params);
    res.json({ orders });
  } catch (e) { next(e); }
});

// A5. Create Coupon
router.post('/coupons', async (req, res, next) => {
  try {
    const { code, discountType, discountValue, expiresAt, usageLimit } = req.body;
    const [r] = await db.query(
      `INSERT INTO coupons (code, discount_type, discount_value, expires_at, usage_limit, active)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [code.toUpperCase(), discountType, discountValue, expiresAt, usageLimit]
    );
    res.status(201).json({ id: r.insertId });
  } catch (e) { next(e); }
});

// A6. Manual Grant or Revoke Access
router.post('/entitlements/grant', async (req, res, next) => {
  try {
    const { userId, scopeType, scopeId, durationDays } = req.body;
    const expiresClause = durationDays ? `DATE_ADD(NOW(), INTERVAL ${Number(durationDays)} DAY)` : 'NULL';
    await db.query(
      `INSERT INTO entitlements (user_id, scope_type, scope_id, expires_at)
       VALUES (?, ?, ?, ${expiresClause})`,
      [userId, scopeType, scopeId]
    );
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});

// A7. Dashboard Stats
router.get('/dashboard', async (req, res, next) => {
  try {
    const [[rev]] = await db.query(`SELECT COALESCE(SUM(total_paise), 0) AS total_revenue_paise FROM orders WHERE status = 'paid'`);
    const [[passes]] = await db.query(`SELECT COUNT(*) AS active_passes FROM entitlements WHERE scope_type = 'class' AND expires_at > NOW()`);
    res.json({
      totalRevenuePaise: rev.total_revenue_paise,
      activePasses: passes.active_passes,
    });
  } catch (e) { next(e); }
});

export default router;