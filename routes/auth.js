const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { db } = require('../lib/db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'flip-demo-secret-2024';
const SALT_ROUNDS = 10;

router.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (username.length < 3 || username.length > 20) return res.status(400).json({ error: 'Username must be 3–20 characters' });
  if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.status(400).json({ error: 'Username: letters, numbers, underscores only' });
  if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

  try {
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO users (username, password_hash) VALUES (?, ?)'
    ).run(username, hash);

    const token = jwt.sign({ userId: lastInsertRowid, username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, userId: lastInsertRowid, username, balance: 1000 });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Username already taken' });
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, userId: user.id, username: user.username, balance: user.balance });
});

module.exports = router;
