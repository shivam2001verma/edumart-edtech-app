import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from './db.js';
import catalogueRoutes from './catalogue.js';
import paymentRoutes from './payments.js';
import libraryRoutes from './library.js';
import adminRoutes from './admin.js';

dotenv.config();

const app = express();
app.use(helmet());
app.use(cors());

// Mount payment routes BEFORE express.json() so /api/payments/webhook gets raw body
app.use('/api/payments', paymentRoutes);

app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'EduMart API' });
});

// S1. Auth: Register & Login
app.post('/api/auth/register', async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }
    const hash = await bcrypt.hash(password, 10);
    const [r] = await db.query(
      `INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'student')`,
      [name, email, hash]
    );
    const token = jwt.sign({ id: r.insertId, email, role: 'student' }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user: { id: r.insertId, name, email, role: 'student' } });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Email already registered' });
    next(err);
  }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const [[user]] = await db.query(`SELECT * FROM users WHERE email = ?`, [email]);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    next(err);
  }
});

// Mount Catalogue, Library, and Admin routes
app.use('/api/catalogue', catalogueRoutes);
app.use('/api/library', libraryRoutes);
app.use('/api/admin', adminRoutes);

// Global error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

const PORT = Number(process.env.PORT || 5000);
app.listen(PORT, () => {
  console.log(`EduMart API running on http://localhost:${PORT}`);
});