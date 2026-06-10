# FLIP

Real-time PvP coin flip game. Two players bet the same amount of fake money. A provably fair RNG picks a winner who takes both bets. No house edge.

## Setup

```bash
cd flip
npm install
npm start
```

App runs at **http://localhost:3000**

Open in two browser tabs (or two different browsers) to play against yourself.

## How to play

1. Register an account — starts with $1,000 fake balance
2. Pick a bet amount ($10 – $500)
3. Click **FLIP** to enter the queue
4. When matched, a 3-second countdown runs, then the coin flips
5. Winner gets both bets. Loser gets nothing.
6. Balance hits $0? Hit "Reload $1,000 free"

## Provably Fair RNG

The RNG uses a commit-reveal scheme:

1. **Before the flip** — server generates a random secret seed and sends you its `SHA-256` hash (the *commitment*)
2. **After the flip** — server reveals the actual seed
3. **You verify** — `SHA-256(revealed_seed) === commitment_hash` you received earlier

**Winner formula:**
```
input      = seed + ":" + player1_id + ":" + player2_id
result     = SHA-256(input)
index      = parseInt(result.slice(0, 8), 16) % 2
index == 0 → player1 wins
index == 1 → player2 wins
```

Every result screen shows the seed, commitment hash, and result hash so you can independently verify any match.

The RNG code lives in `lib/rng.js`.

## Stack

- **Backend**: Node.js + Express + Socket.io
- **Database**: SQLite (via better-sqlite3)
- **Auth**: JWT + bcrypt
- **Frontend**: Vanilla JS, no framework, no build step
- **Real-time**: Socket.io WebSockets

## Project structure

```
flip/
├── server.js          # Express + Socket.io server, matchmaking logic
├── lib/
│   ├── rng.js         # Provably fair RNG — all randomness lives here
│   └── db.js          # SQLite setup + transactions
├── routes/
│   ├── auth.js        # POST /api/auth/register, /api/auth/login
│   └── game.js        # GET /api/game/history, POST /api/game/reload
└── public/
    ├── index.html
    ├── style.css
    └── app.js
```

## Dev mode (auto-restart)

```bash
npm run dev
```

Requires nodemon (installed as a dev dependency).
