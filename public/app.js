'use strict';

// ── State ────────────────────────────────────────────────────
const state = {
  token: null,
  userId: null,
  username: null,
  balance: 0,
  selectedBet: null,
  currentMatch: null,
};

let socket = null;
let toastTimer = null;
let countdownInterval = null;

// ── DOM ──────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const el = (sel, ctx = document) => ctx.querySelector(sel);

const dom = {
  screenAuth: $('screen-auth'),
  app: $('app'),

  // Auth
  tabLogin: document.querySelector('[data-tab="login"]'),
  tabRegister: document.querySelector('[data-tab="register"]'),
  formLogin: $('form-login'),
  formRegister: $('form-register'),
  loginUsername: $('login-username'),
  loginPassword: $('login-password'),
  regUsername: $('reg-username'),
  regPassword: $('reg-password'),
  authError: $('auth-error'),

  // Header
  headerBalance: $('header-balance'),
  btnHistory: $('btn-history'),
  btnLogout: $('btn-logout'),

  // Phases
  phaseLobby: $('phase-lobby'),
  phaseQueue: $('phase-queue'),
  phaseMatched: $('phase-matched'),
  phaseCountdown: $('phase-countdown'),
  phaseFlip: $('phase-flip'),
  phaseResult: $('phase-result'),

  // Lobby
  lobbyUsername: $('lobby-username'),
  betGrid: $('bet-grid'),
  betChips: document.querySelectorAll('.bet-chip'),
  btnFlip: $('btn-flip'),
  lowBalanceBanner: $('low-balance-banner'),
  btnReload: $('btn-reload'),

  // Queue
  queueAmount: $('queue-amount'),
  btnCancelQueue: $('btn-cancel-queue'),

  // Matched
  matchedYouAvatar: $('matched-you-avatar'),
  matchedYouName: $('matched-you-name'),
  matchedThemAvatar: $('matched-them-avatar'),
  matchedThemName: $('matched-them-name'),
  matchedAmount: $('matched-amount'),
  matchedSeedHash: $('matched-seed-hash'),

  // Countdown
  countdownNumber: $('countdown-number'),

  // Flip
  coin3d: el('.coin-3d', $('phase-flip')),

  // Result
  resultBadge: $('result-badge'),
  resultAmount: $('result-amount'),
  resultBalanceVal: $('result-balance-val'),
  proofSeed: $('proof-seed'),
  proofHash: $('proof-hash'),
  proofVerifyHash: $('proof-verify-hash'),
  btnPlayAgain: $('btn-play-again'),

  // History
  btnCloseHistory: $('btn-close-history'),
  historyPanel: $('history-panel'),
  historyOverlay: $('history-overlay'),
  historyList: $('history-list'),

  toast: $('toast'),
};

// ── Auth tab switching ───────────────────────────────────────
dom.tabLogin.addEventListener('click', () => switchTab('login'));
dom.tabRegister.addEventListener('click', () => switchTab('register'));

function switchTab(tab) {
  dom.tabLogin.classList.toggle('active', tab === 'login');
  dom.tabRegister.classList.toggle('active', tab === 'register');
  dom.formLogin.classList.toggle('active', tab === 'login');
  dom.formRegister.classList.toggle('active', tab === 'register');
  dom.authError.textContent = '';
}

// ── Auth forms ───────────────────────────────────────────────
dom.formLogin.addEventListener('submit', async e => {
  e.preventDefault();
  const username = dom.loginUsername.value.trim();
  const password = dom.loginPassword.value;
  if (!username || !password) return setAuthError('Fill in all fields');
  await doAuth('/api/auth/login', { username, password });
});

dom.formRegister.addEventListener('submit', async e => {
  e.preventDefault();
  const username = dom.regUsername.value.trim();
  const password = dom.regPassword.value;
  if (!username || !password) return setAuthError('Fill in all fields');
  await doAuth('/api/auth/register', { username, password });
});

async function doAuth(endpoint, body) {
  setAuthError('');
  const btn = el('button[type="submit"]', endpoint.includes('login') ? dom.formLogin : dom.formRegister);
  btn.disabled = true;
  btn.textContent = '…';
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) return setAuthError(data.error || 'Error');
    saveSession(data);
    bootApp();
  } catch {
    setAuthError('Network error');
  } finally {
    btn.disabled = false;
    btn.textContent = endpoint.includes('login') ? 'Sign In' : 'Create Account';
  }
}

function setAuthError(msg) {
  dom.authError.textContent = msg;
}

// ── Session ──────────────────────────────────────────────────
function saveSession({ token, userId, username, balance }) {
  state.token = token;
  state.userId = userId;
  state.username = username;
  state.balance = balance;
  localStorage.setItem('flip_session', JSON.stringify({ token, userId, username }));
}

function loadSession() {
  try {
    const saved = JSON.parse(localStorage.getItem('flip_session') || 'null');
    if (saved?.token) {
      state.token = saved.token;
      state.userId = saved.userId;
      state.username = saved.username;
      return true;
    }
  } catch {}
  return false;
}

function clearSession() {
  state.token = null;
  state.userId = null;
  state.username = null;
  state.balance = 0;
  state.selectedBet = null;
  localStorage.removeItem('flip_session');
}

// ── Boot / logout ────────────────────────────────────────────
function bootApp() {
  dom.screenAuth.classList.remove('active');
  dom.app.classList.remove('hidden');
  dom.lobbyUsername.textContent = state.username;
  showPhase('lobby');
  connectSocket();
  checkLowBalance();
}

dom.btnLogout.addEventListener('click', () => {
  if (socket) { socket.disconnect(); socket = null; }
  clearSession();
  dom.app.classList.add('hidden');
  dom.screenAuth.classList.add('active');
  dom.loginUsername.value = '';
  dom.loginPassword.value = '';
  setAuthError('');
  switchTab('login');
});

// ── Phases ───────────────────────────────────────────────────
const phases = ['lobby', 'queue', 'matched', 'countdown', 'flip', 'result'];

function showPhase(name) {
  phases.forEach(p => {
    const el = $(`phase-${p}`);
    if (el) el.classList.toggle('active', p === name);
  });
}

// ── Balance ──────────────────────────────────────────────────
function setBalance(amount) {
  state.balance = amount;
  const formatted = fmt(amount);
  dom.headerBalance.textContent = formatted;
  dom.headerBalance.classList.remove('bump');
  void dom.headerBalance.offsetWidth;
  dom.headerBalance.classList.add('bump');
  checkLowBalance();
}

function checkLowBalance() {
  const needsReload = state.balance <= 100;
  dom.lowBalanceBanner.classList.toggle('hidden', !needsReload);
  // Disable bet chips the user can't afford
  dom.betChips.forEach(chip => {
    const amount = parseInt(chip.dataset.amount, 10);
    chip.disabled = state.balance < amount;
    if (chip.disabled && chip.classList.contains('selected')) {
      chip.classList.remove('selected');
      state.selectedBet = null;
    }
  });
  updateFlipButton();
}

function fmt(n) {
  return '$' + n.toLocaleString('en-US');
}

// ── Bet selection ────────────────────────────────────────────
dom.betChips.forEach(chip => {
  chip.addEventListener('click', () => {
    if (chip.disabled) return;
    const amount = parseInt(chip.dataset.amount, 10);
    dom.betChips.forEach(c => c.classList.remove('selected'));
    chip.classList.add('selected');
    state.selectedBet = amount;
    updateFlipButton();
  });
});

function updateFlipButton() {
  const canFlip = state.selectedBet !== null && state.balance >= state.selectedBet;
  dom.btnFlip.disabled = !canFlip;
}

// ── Reload balance ────────────────────────────────────────────
dom.btnReload.addEventListener('click', async () => {
  dom.btnReload.disabled = true;
  dom.btnReload.textContent = '…';
  try {
    const res = await fetch('/api/game/reload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.token}` },
    });
    const data = await res.json();
    if (res.ok) {
      setBalance(data.balance);
      showToast('Balance reloaded to $1,000!');
    } else {
      showToast(data.error || 'Cannot reload');
    }
  } catch {
    showToast('Network error');
  } finally {
    dom.btnReload.disabled = false;
    dom.btnReload.textContent = 'Reload $1,000 free';
  }
});

// ── FLIP button ───────────────────────────────────────────────
dom.btnFlip.addEventListener('click', () => {
  if (!state.selectedBet || !socket) return;
  socket.emit('join_queue', { betAmount: state.selectedBet });
  dom.queueAmount.textContent = `Bet: ${fmt(state.selectedBet)} each`;
  showPhase('queue');
});

dom.btnCancelQueue.addEventListener('click', () => {
  if (socket) socket.emit('leave_queue');
  showPhase('lobby');
});

dom.btnPlayAgain.addEventListener('click', () => {
  dom.phaseResult.classList.remove('win-glow', 'lose-glow');
  state.currentMatch = null;
  showPhase('lobby');
});

// ── Socket ────────────────────────────────────────────────────
function connectSocket() {
  socket = io({ auth: { token: state.token } });

  socket.on('connect', () => {
    // Re-join queue automatically after reconnect
    const phase = document.querySelector('.phase.active')?.id;
    if (phase === 'phase-queue' && state.selectedBet) {
      socket.emit('join_queue', { betAmount: state.selectedBet });
    }
    // If mid-match when disconnected, go back to lobby
    if (phase === 'phase-matched' || phase === 'phase-countdown' || phase === 'phase-flip') {
      showPhase('lobby');
      showToast('Reconnected — match was lost');
    }
  });

  socket.on('disconnect', (reason) => {
    if (reason !== 'io client disconnect') {
      showToast('Connection lost — reconnecting…');
    }
  });

  socket.on('connect_error', err => {
    console.error('Socket error:', err.message);
    showToast('Connection error');
  });

  socket.on('balance_update', ({ balance }) => {
    setBalance(balance);
  });

  socket.on('queued', () => {
    // Already showing queue phase
  });

  socket.on('queue_left', () => {
    showPhase('lobby');
  });

  socket.on('matched', ({ matchId, betAmount, seedHash, opponent }) => {
    state.currentMatch = { matchId, betAmount, seedHash, opponent };

    dom.matchedYouAvatar.textContent = state.username[0].toUpperCase();
    dom.matchedYouName.textContent = state.username;
    dom.matchedThemAvatar.textContent = opponent.username[0].toUpperCase();
    dom.matchedThemName.textContent = opponent.username;
    dom.matchedAmount.textContent = `${fmt(betAmount)} each`;
    dom.matchedSeedHash.textContent = seedHash;

    showPhase('matched');

    // Client-driven countdown — no server round-trips needed
    startCountdown(3);
  });

  socket.on('result', (data) => {
    stopCountdown();
    state.currentMatch = { ...state.currentMatch, ...data };
    playFlipThenResult(data);
  });

  socket.on('match_cancelled', ({ reason }) => {
    stopCountdown();
    showPhase('lobby');
    showToast(reason || 'Match cancelled');
  });

  socket.on('game_error', ({ message }) => {
    stopCountdown();
    showPhase('lobby');
    showToast(message);
  });
}

// ── Coin flip animation → result ──────────────────────────────
function playFlipThenResult(data) {
  showPhase('flip');
  const coin = dom.coin3d;
  coin.classList.remove('land-win', 'land-lose', 'is-flipping');
  void coin.offsetWidth;

  const animClass = data.won ? 'land-win' : 'land-lose';
  coin.classList.add(animClass);

  setTimeout(() => {
    showResult(data);
  }, 1500);
}

function showResult(data) {
  const { won, betAmount, myBalance, seed, seedHash, verifyHash } = data;

  dom.resultBadge.textContent = won ? 'YOU WIN' : 'YOU LOSE';
  dom.resultBadge.className = 'result-badge ' + (won ? 'win' : 'lose');

  if (won) {
    dom.resultAmount.textContent = `+${fmt(betAmount)}`;
  } else {
    dom.resultAmount.textContent = `-${fmt(betAmount)}`;
  }

  dom.resultBalanceVal.textContent = fmt(myBalance);
  dom.proofSeed.textContent = seed;
  dom.proofHash.textContent = seedHash;
  dom.proofVerifyHash.textContent = verifyHash;

  setBalance(myBalance);

  showPhase('result');
  dom.phaseResult.classList.remove('win-glow', 'lose-glow');
  void dom.phaseResult.offsetWidth;
  dom.phaseResult.classList.add(won ? 'win-glow' : 'lose-glow');
}

// ── Countdown (client-driven) ────────────────────────────────
let countdownTimer = null;
let safetyTimer = null;

function startCountdown(from) {
  stopCountdown();
  let count = from;

  // Brief delay to show "matched" screen first
  setTimeout(() => {
    showPhase('countdown');
    setCountdownNumber(count);

    countdownTimer = setInterval(() => {
      count--;
      if (count <= 0) {
        stopCountdown();
        showPhase('flip');
      } else {
        setCountdownNumber(count);
      }
    }, 1000);

    // Safety net: if result never arrives within 10s, go back to lobby
    safetyTimer = setTimeout(() => {
      const phase = document.querySelector('.phase.active')?.id;
      if (phase === 'phase-countdown' || phase === 'phase-flip') {
        stopCountdown();
        showPhase('lobby');
        showToast('Match timed out — try again');
      }
    }, 10000);
  }, 800);
}

function stopCountdown() {
  clearInterval(countdownTimer);
  clearTimeout(safetyTimer);
  countdownTimer = null;
  safetyTimer = null;
}

function setCountdownNumber(n) {
  dom.countdownNumber.textContent = n;
  dom.countdownNumber.style.animation = 'none';
  void dom.countdownNumber.offsetWidth;
  dom.countdownNumber.style.animation = '';
}

// ── History ───────────────────────────────────────────────────
dom.btnHistory.addEventListener('click', openHistory);
dom.btnCloseHistory.addEventListener('click', closeHistory);
dom.historyOverlay.addEventListener('click', closeHistory);

async function openHistory() {
  dom.historyPanel.classList.remove('hidden');
  dom.historyOverlay.classList.remove('hidden');
  dom.historyList.innerHTML = '<div class="history-empty">Loading…</div>';

  try {
    const res = await fetch('/api/game/history', {
      headers: { Authorization: `Bearer ${state.token}` },
    });
    const matches = await res.json();
    renderHistory(matches);
  } catch {
    dom.historyList.innerHTML = '<div class="history-empty">Failed to load.</div>';
  }
}

function closeHistory() {
  dom.historyPanel.classList.add('hidden');
  dom.historyOverlay.classList.add('hidden');
}

function renderHistory(matches) {
  if (!matches.length) {
    dom.historyList.innerHTML = '<div class="history-empty">No matches yet. Go flip!</div>';
    return;
  }

  dom.historyList.innerHTML = matches.map(m => {
    const won = m.won;
    const opponent = m.player1.id === state.userId ? m.player2 : m.player1;
    const date = new Date(m.createdAt * 1000);
    const timeStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      + ' · ' + date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    return `
      <div class="history-item ${won ? 'won' : 'lost'}">
        <div class="history-item-header">
          <span class="history-outcome ${won ? 'win' : 'lose'}">${won ? 'WIN' : 'LOSE'}</span>
          <span class="history-amount">${won ? '+' : '-'}${fmt(m.betAmount)}</span>
        </div>
        <div class="history-vs">vs @${opponent.username}</div>
        <div class="history-meta">
          <span class="history-time">${timeStr}</span>
          <span class="history-seed" title="${m.seed}">seed: ${m.seed.slice(0, 16)}…</span>
        </div>
      </div>
    `;
  }).join('');
}

// ── Toast ─────────────────────────────────────────────────────
function showToast(msg) {
  clearTimeout(toastTimer);
  dom.toast.textContent = msg;
  dom.toast.classList.remove('hidden');
  toastTimer = setTimeout(() => dom.toast.classList.add('hidden'), 3000);
}

// ── Init ──────────────────────────────────────────────────────
(function init() {
  if (loadSession()) {
    bootApp();
  }
})();
