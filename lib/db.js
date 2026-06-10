const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '../flip.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    username     TEXT    UNIQUE NOT NULL,
    password_hash TEXT   NOT NULL,
    balance      INTEGER NOT NULL DEFAULT 1000,
    created_at   INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS matches (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    player1_id   INTEGER NOT NULL REFERENCES users(id),
    player2_id   INTEGER NOT NULL REFERENCES users(id),
    bet_amount   INTEGER NOT NULL,
    winner_id    INTEGER NOT NULL REFERENCES users(id),
    seed         TEXT    NOT NULL,
    seed_hash    TEXT    NOT NULL,
    verify_hash  TEXT    NOT NULL,
    created_at   INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_matches_player1 ON matches(player1_id);
  CREATE INDEX IF NOT EXISTS idx_matches_player2 ON matches(player2_id);
`);

const resolveMatchTx = db.transaction((player1Id, player2Id, betAmount, winnerId, seed, seedHash, verifyHash) => {
  db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(betAmount, player1Id);
  db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(betAmount, player2Id);
  db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(betAmount * 2, winnerId);
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO matches (player1_id, player2_id, bet_amount, winner_id, seed, seed_hash, verify_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
  `).run(player1Id, player2Id, betAmount, winnerId, seed, seedHash, verifyHash);
  return lastInsertRowid;
});

module.exports = { db, resolveMatchTx };
