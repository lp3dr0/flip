const express = require('express');
const jwt = require('jsonwebtoken');
const { db } = require('../lib/db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'flip-demo-secret-2024';

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No token' });
  const token = header.replace('Bearer ', '');
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

router.get('/history', authMiddleware, (req, res) => {
  const matches = db.prepare(`
    SELECT
      m.id, m.bet_amount, m.winner_id, m.seed, m.seed_hash, m.verify_hash,
      m.created_at,
      m.player1_id, u1.username AS player1_name,
      m.player2_id, u2.username AS player2_name
    FROM matches m
    JOIN users u1 ON u1.id = m.player1_id
    JOIN users u2 ON u2.id = m.player2_id
    WHERE m.player1_id = ? OR m.player2_id = ?
    ORDER BY m.created_at DESC
    LIMIT 50
  `).all(req.user.userId, req.user.userId);

  res.json(matches.map(m => ({
    id: m.id,
    betAmount: m.bet_amount,
    winnerId: m.winner_id,
    won: m.winner_id === req.user.userId,
    seed: m.seed,
    seedHash: m.seed_hash,
    verifyHash: m.verify_hash,
    createdAt: m.created_at,
    player1: { id: m.player1_id, username: m.player1_name },
    player2: { id: m.player2_id, username: m.player2_name }
  })));
});

router.post('/reload', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(req.user.userId);
  if (user.balance > 100) return res.status(400).json({ error: 'Balance too high to reload (must be ≤ $100)' });
  db.prepare('UPDATE users SET balance = 1000 WHERE id = ?').run(req.user.userId);
  res.json({ balance: 1000 });
});

module.exports = router;
