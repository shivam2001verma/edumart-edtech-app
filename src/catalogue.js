import express from "express";
import jwt from "jsonwebtoken";
import db from "./db.js";

const router = express.Router();

// Login check
function auth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.replace(/^Bearer\s+/i, "");

    if (!token) {
      return res.status(401).json({ message: "Login required" });
    }

    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

// Admin check
function adminOnly(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin access only" });
  }
  next();
}

// 1. Get all boards
router.get("/boards", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id, name FROM boards ORDER BY name"
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: "Could not load boards" });
  }
});

// 2. Get classes by board
router.get("/boards/:boardId/classes", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id, name FROM classes WHERE board_id = ? ORDER BY name",
      [req.params.boardId]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: "Could not load classes" });
  }
});

// 3. Get subjects by class
router.get("/classes/:classId/subjects", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id, name FROM subjects WHERE class_id = ? ORDER BY name",
      [req.params.classId]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: "Could not load subjects" });
  }
});

// 4. Get chapters and their chapter products
router.get("/subjects/:subjectId/chapters", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT
         c.id, c.name, c.is_free,
         p.id AS product_id,
         p.price_paise
       FROM chapters c
       LEFT JOIN products p
         ON p.chapter_id = c.id
         AND p.product_type = 'chapter'
         AND p.active = TRUE
       WHERE c.subject_id = ?
       ORDER BY c.id`,
      [req.params.subjectId]
    );

    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: "Could not load chapters" });
  }
});

// 5. Admin: Add board
router.post("/boards", auth, adminOnly, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Board name required" });
    }

    const [result] = await db.query(
      "INSERT INTO boards (name) VALUES (?)",
      [name.trim()]
    );

    res.status(201).json({ id: result.insertId, name });
  } catch (error) {
    res.status(400).json({ message: "Could not add board" });
  }
});

// 6. Admin: Add class
router.post("/classes", auth, adminOnly, async (req, res) => {
  try {
    const { board_id, name } = req.body;
    if (!board_id || !name || !name.trim()) {
      return res.status(400).json({
        message: "Board ID and class name required"
      });
    }

    const [result] = await db.query(
      "INSERT INTO classes (board_id, name) VALUES (?, ?)",
      [board_id, name.trim()]
    );

    res.status(201).json({ id: result.insertId });
  } catch (error) {
    res.status(400).json({ message: "Could not add class" });
  }
});

// 7. Admin: Add subject
router.post("/subjects", auth, adminOnly, async (req, res) => {
  try {
    const { class_id, name } = req.body;
    if (!class_id || !name || !name.trim()) {
      return res.status(400).json({
        message: "Class ID and subject name required"
      });
    }

    const [result] = await db.query(
      "INSERT INTO subjects (class_id, name) VALUES (?, ?)",
      [class_id, name.trim()]
    );

    res.status(201).json({ id: result.insertId });
  } catch (error) {
    res.status(400).json({ message: "Could not add subject" });
  }
});

// 8. Admin: Add chapter
router.post("/chapters", auth, adminOnly, async (req, res) => {
  try {
    const { subject_id, name, is_free = false } = req.body;

    if (!subject_id || !name || !name.trim()) {
      return res.status(400).json({
        message: "Subject ID and chapter name required"
      });
    }

    const [result] = await db.query(
      "INSERT INTO chapters (subject_id, name, is_free) VALUES (?, ?, ?)",
      [subject_id, name.trim(), Boolean(is_free)]
    );

    res.status(201).json({ id: result.insertId });
  } catch (error) {
    res.status(400).json({ message: "Could not add chapter" });
  }
});

// 9. Admin: Add chapter product and price
router.post("/products/chapter", auth, adminOnly, async (req, res) => {
  try {
    const { chapter_id, name, price_rupees } = req.body;

    if (!chapter_id || !name || !Number.isInteger(price_rupees) ||
        price_rupees < 0) {
      return res.status(400).json({
        message: "Chapter, name and whole-number price required"
      });
    }

    const [result] = await db.query(
      `INSERT INTO products
       (name, product_type, chapter_id, price_paise)
       VALUES (?, 'chapter', ?, ?)`,
      [name.trim(), chapter_id, price_rupees * 100]
    );

    res.status(201).json({
      id: result.insertId,
      price_paise: price_rupees * 100
    });
  } catch (error) {
    res.status(400).json({ message: "Could not add product" });
  }
});

export default router;
