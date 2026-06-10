/**
 * Provably Fair RNG Module
 *
 * Scheme:
 *  1. Server generates a secret 32-byte hex seed before the match.
 *  2. Server sends SHA-256(seed) — the "commitment hash" — to both players BEFORE the flip.
 *  3. After the flip, server reveals the original seed.
 *  4. Players verify: SHA-256(seed) === commitment hash they received.
 *
 * Winner formula:
 *  input  = seed + ":" + player1_id + ":" + player2_id
 *  result = SHA-256(input)
 *  index  = parseInt(result.slice(0, 8), 16) % 2
 *  index === 0  →  player1 wins
 *  index === 1  →  player2 wins
 *
 * Anyone can re-run this with the revealed seed to confirm the outcome.
 */

const crypto = require('crypto');

function generateSeed() {
  return crypto.randomBytes(32).toString('hex');
}

function hashSeed(seed) {
  return crypto.createHash('sha256').update(seed).digest('hex');
}

function determineWinner(seed, player1Id, player2Id) {
  const input = `${seed}:${player1Id}:${player2Id}`;
  const hash = crypto.createHash('sha256').update(input).digest('hex');
  const index = parseInt(hash.slice(0, 8), 16) % 2;
  return index === 0 ? player1Id : player2Id;
}

function buildVerificationHash(seed, player1Id, player2Id) {
  const input = `${seed}:${player1Id}:${player2Id}`;
  return crypto.createHash('sha256').update(input).digest('hex');
}

module.exports = { generateSeed, hashSeed, determineWinner, buildVerificationHash };
