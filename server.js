const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const path = require('path');

const { db, resolveMatchTx } = require('./lib/db');
const { generateSeed, hashSeed, determineWinner, buildVerificationHash } = require('./lib/rng');
const authRoutes = require('./routes/auth');
const gameRoutes = require('./routes/game');

const JWT_SECRET = process.env.JWT_SECRET || 'flip-demo-secret-2024';
const PORT = process.env.PORT || 3000;
const VALID_BETS = new Set([10, 25, 50, 100, 250, 500]);

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/auth', authRoutes);
app.use('/api/game', gameRoutes);

// In-memory state
// queues: betAmount → [{userId, socketId, username}]
const queues = {};
// activeMatches: matchId → match object
const activeMatches = {};
// userToMatch: userId → matchId (for disconnect handling)
const userToMatch = {};
// userInQueue: userId → betAmount
const userInQueue = {};

// Socket auth
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('No token'));
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.userId = decoded.userId;
    socket.username = decoded.username;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  const { userId, username } = socket;

  // Push current balance on connect
  const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
  if (user) socket.emit('balance_update', { balance: user.balance });

  socket.on('join_queue', ({ betAmount }) => {
    betAmount = parseInt(betAmount, 10);
    if (!VALID_BETS.has(betAmount)) {
      return socket.emit('game_error', { message: 'Invalid bet amount' });
    }

    // Already in queue or match?
    if (userInQueue[userId] !== undefined || userToMatch[userId]) {
      return socket.emit('game_error', { message: 'Already in queue or match' });
    }

    const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
    if (!user || user.balance < betAmount) {
      return socket.emit('game_error', { message: 'Insufficient balance' });
    }

    if (!queues[betAmount]) queues[betAmount] = [];
    queues[betAmount].push({ userId, socketId: socket.id, username });
    userInQueue[userId] = betAmount;

    socket.emit('queued', { betAmount });

    if (queues[betAmount].length >= 2) {
      const p1 = queues[betAmount].shift();
      const p2 = queues[betAmount].shift();
      delete userInQueue[p1.userId];
      delete userInQueue[p2.userId];
      startMatch(p1, p2, betAmount);
    }
  });

  socket.on('leave_queue', () => {
    removeFromQueues(userId);
    socket.emit('queue_left');
  });

  socket.on('disconnect', () => {
    removeFromQueues(userId);

    const matchId = userToMatch[userId];
    if (matchId) handleDisconnectDuringMatch(matchId, userId);
  });
});

function removeFromQueues(userId) {
  const betAmount = userInQueue[userId];
  if (betAmount !== undefined && queues[betAmount]) {
    queues[betAmount] = queues[betAmount].filter(p => p.userId !== userId);
  }
  delete userInQueue[userId];
}

function startMatch(p1, p2, betAmount) {
  const matchId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const seed = generateSeed();
  const seedHash = hashSeed(seed);

  activeMatches[matchId] = { matchId, p1, p2, betAmount, seed, seedHash, phase: 'countdown', timers: [] };
  userToMatch[p1.userId] = matchId;
  userToMatch[p2.userId] = matchId;

  // Send matched + countdown start in one shot — client drives the visual countdown
  const payload = { matchId, betAmount, seedHash };
  emitToPlayer(p1, 'matched', { ...payload, opponent: { username: p2.username } });
  emitToPlayer(p2, 'matched', { ...payload, opponent: { username: p1.username } });

  // Resolve after countdown (3s) + small buffer
  const resolveTimer = setTimeout(() => resolveMatch(matchId), 4200);
  if (activeMatches[matchId]) activeMatches[matchId].timers.push(resolveTimer);
}

function resolveMatch(matchId) {
  const match = activeMatches[matchId];
  if (!match) return;

  clearMatchTimers(matchId);

  const { p1, p2, betAmount, seed, seedHash } = match;
  const winnerId = determineWinner(seed, p1.userId, p2.userId);
  const verifyHash = buildVerificationHash(seed, p1.userId, p2.userId);

  try {
    resolveMatchTx(p1.userId, p2.userId, betAmount, winnerId, seed, seedHash, verifyHash);
  } catch (e) {
    console.error('DB error resolving match', e);
    cancelMatch(matchId, 'Server error — bets refunded');
    return;
  }

  const p1Balance = db.prepare('SELECT balance FROM users WHERE id = ?').get(p1.userId)?.balance ?? 0;
  const p2Balance = db.prepare('SELECT balance FROM users WHERE id = ?').get(p2.userId)?.balance ?? 0;

  const base = {
    matchId, winnerId, seed, seedHash, verifyHash, betAmount,
    player1: { id: p1.userId, username: p1.username },
    player2: { id: p2.userId, username: p2.username },
  };

  emitToPlayer(p1, 'result', { ...base, won: winnerId === p1.userId, myBalance: p1Balance });
  emitToPlayer(p2, 'result', { ...base, won: winnerId === p2.userId, myBalance: p2Balance });

  delete userToMatch[p1.userId];
  delete userToMatch[p2.userId];
  delete activeMatches[matchId];
}

function handleDisconnectDuringMatch(matchId, disconnectedUserId) {
  const match = activeMatches[matchId];
  if (!match) return;

  clearMatchTimers(matchId);

  const other = match.p1.userId === disconnectedUserId ? match.p2 : match.p1;
  emitToPlayer(other, 'match_cancelled', { reason: 'Opponent disconnected' });

  delete userToMatch[match.p1.userId];
  delete userToMatch[match.p2.userId];
  delete activeMatches[matchId];
}

function cancelMatch(matchId, reason) {
  const match = activeMatches[matchId];
  if (!match) return;

  clearMatchTimers(matchId);
  emitToPlayer(match.p1, 'match_cancelled', { reason });
  emitToPlayer(match.p2, 'match_cancelled', { reason });

  delete userToMatch[match.p1.userId];
  delete userToMatch[match.p2.userId];
  delete activeMatches[matchId];
}

function clearMatchTimers(matchId) {
  const match = activeMatches[matchId];
  if (match?.timers) match.timers.forEach(clearTimeout);
}

function emitToPlayer(player, event, data) {
  const socket = io.sockets.sockets.get(player.socketId);
  if (socket) socket.emit(event, data);
}

server.listen(PORT, () => {
  console.log(`\n  FLIP server → http://localhost:${PORT}\n`);
});
