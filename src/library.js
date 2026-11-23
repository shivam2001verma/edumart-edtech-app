import express from 'express';
import fs from 'fs';
import path from 'path';
import db from './db.js';
import { requireAuth } from './payments.js';

const router = express.Router();

// Helper: Check if a student can access a specific chapter (via free sample, chapter, subject, or active class pass)
export async function canAccessChapter(dbConn, userId, chapterId) {
  const [[chapter]] = await dbConn.query(
    `SELECT c.id, c.is_free, c.subject_id, s.class_id
     FROM chapters c
     JOIN subjects s ON c.subject_id = s.id
     WHERE c.id = ?`,
    [chapterId]
  );
  if (!chapter) return { allowed: false, reason: 'Chapter not found' };
  if (chapter.is_free) return { allowed: true, reason: 'free_sample' };

  const [entitlements] = await dbConn.query(
    `SELECT * FROM entitlements
     WHERE user_id = ?
       AND (expires_at IS NULL OR expires_at > NOW())
       AND (
         (scope_type = 'chapter' AND scope_id = ?) OR
         (scope_type = 'subject' AND scope_id = ?) OR
         (scope_type = 'class' AND scope_id = ?)
       )`,
    [userId, chapter.id, chapter.subject_id, chapter.class_id]
  );

  if (entitlements.length > 0) {
    return { allowed: true, reason: entitlements[0].scope_type };
  }
  return { allowed: false, reason: 'Purchase required' };
}

// 1. My Library (Lists all active entitlements with expiry dates)
router.get('/my-library', requireAuth, async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT e.id, e.scope_type, e.scope_id, e.expires_at, e.created_at,
        CASE
          WHEN e.scope_type = 'chapter' THEN (SELECT title FROM chapters WHERE id = e.scope_id)
          WHEN e.scope_type = 'subject' THEN (SELECT name FROM subjects WHERE id = e.scope_id)
          WHEN e.scope_type = 'class' THEN (SELECT CONCAT(name, ' All-Subject Pass') FROM classes WHERE id = e.scope_id)
        END AS title
       FROM entitlements e
       WHERE e.user_id = ? AND (e.expires_at IS NULL OR e.expires_at > NOW())
       ORDER BY e.created_at DESC`,
      [req.user.id]
    );
    res.json({ items: rows });
  } catch (err) {
    next(err);
  }
});

// 2. Protected Material Download / Reader (Blocks unpurchased access on server)
router.get('/materials/:materialId/read', requireAuth, async (req, res, next) => {
  try {
    const [[mat]] = await db.query(
      `SELECT * FROM materials WHERE id = ?`,
      [req.params.materialId]
    );
    if (!mat) return res.status(404).json({ error: 'Material not found' });

    const access = await canAccessChapter(db, req.user.id, mat.chapter_id);
    if (!access.allowed) {
      return res.status(403).json({ error: 'Locked content: please purchase this chapter, subject pack, or class pass.' });
    }

    const absPath = path.resolve(process.cwd(), mat.file_path);
    if (!fs.existsSync(absPath)) {
      // Fallback response if physical sample PDF file is not yet uploaded on disk
      return res.status(200).json({
        ok: true,
        accessGrantedVia: access.reason,
        title: mat.title,
        message: 'Access verified. Upload actual PDF file to server/uploads/notes/ to stream binary PDF.',
      });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(absPath)}"`);
    fs.createReadStream(absPath).pipe(res);
  } catch (err) {
    next(err);
  }
});

// 3. Order History & GST Invoice Data
router.get('/orders', requireAuth, async (req, res, next) => {
  try {
    const [orders] = await db.query(
      `SELECT id, razorpay_order_id, subtotal_paise, discount_paise, gst_paise, total_paise, status, created_at, paid_at
       FROM orders
       WHERE user_id = ?
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({ orders });
  } catch (err) {
    next(err);
  }
});

export default router;