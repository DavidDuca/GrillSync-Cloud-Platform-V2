/**
 * GrillSync Cloud Management Platform
 * server/index.js — main entry point
 *
 * Architecture:
 *   Express + Socket.IO for API and realtime
 *   MongoDB via Mongoose for data
 *   Multi-tenant: all queries scoped by restaurantId
 *
 * Endpoints:
 *   POST /sync/batch          ← receives POS order batches (posAuth)
 *   GET  /sync/status         ← health check for POS
 *   /api/auth/*               ← JWT auth
 *   /api/restaurants/*        ← restaurant + branch management
 *   /api/analytics/*          ← all analytics queries
 *   /api/expenses/*           ← expense tracker
 *   /api/orders/*             ← cloud order history
 *   /api/notifications/*      ← notification center
 */
require('dotenv').config();

const express       = require('express');
const http          = require('http');
const { Server }    = require('socket.io');
const mongoose      = require('mongoose');
const cors          = require('cors');
const helmet        = require('helmet');
const compression   = require('compression');
const morgan        = require('morgan');
const rateLimit     = require('express-rate-limit');
const path          = require('path');

// ── Route modules ─────────────────────────────────────────────────────────────
const syncRoutes          = require('./routes/sync');
const authRoutes          = require('./routes/auth');
const restaurantRoutes    = require('./routes/restaurants');
const analyticsRoutes     = require('./routes/analytics');
const expenseRoutes       = require('./routes/expenses');
const orderRoutes         = require('./routes/orders');
const notificationRoutes  = require('./routes/notifications');

// ── CORS origin helper ────────────────────────────────────────────────────────
// Parses the ALLOWED_ORIGINS env var:
//   - '*'            → allow all origins (useful for dev / open APIs)
//   - 'a.com,b.com'  → allow those specific origins
//   - ''  / unset    → fall back to '*' so the server is never silently blocked
function getAllowedOrigins() {
  const raw = (process.env.ALLOWED_ORIGINS || '').trim();
  if (!raw || raw === '*') return '*';                           // wildcard
  return raw.split(',').map(s => s.trim()).filter(Boolean);     // list
}

const ALLOWED_ORIGINS = getAllowedOrigins();

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    credentials: true
  }
});

app.set('io', io);

// ── Raw body capture (needed for HMAC verification in posAuth) ────────────────
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); }
}));

// ── Security & utilities ──────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors({
  origin: ALLOWED_ORIGINS,
  credentials: true
}));
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

// Global rate limiter
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
  max:      parseInt(process.env.RATE_LIMIT_MAX       || '500',    10),
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests' }
});
app.use(limiter);

// Sync-specific tighter rate limit
const syncLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      parseInt(process.env.SYNC_RATE_LIMIT_MAX || '200', 10),
  message:  { error: 'Sync rate limit exceeded' }
});

// ── MongoDB ───────────────────────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/grillsync_cloud')
  .then(() => console.log('[DB] MongoDB connected'))
  .catch(err => console.error('[DB] Error:', err));

// ── Static dashboard ──────────────────────────────────────────────────────────
// Serves the compiled frontend from public/
const publicDir = path.join(__dirname, '../public');
app.use(express.static(publicDir));

// ── API Routes ────────────────────────────────────────────────────────────────

// POS sync ingest — NOT under /api, matches POS syncService.js contract exactly
// POST  /sync/batch
// GET   /sync/status
app.use('/sync', syncLimiter, syncRoutes);

// Cloud dashboard API
app.use('/api/auth',          authRoutes);
app.use('/api/restaurants',   restaurantRoutes);
app.use('/api/analytics',     analyticsRoutes);
app.use('/api/expenses',      expenseRoutes);
app.use('/api/orders',        orderRoutes);
app.use('/api/notifications', notificationRoutes);

// Health check
app.get('/health', (_req, res) => res.json({ ok: true, uptime: process.uptime(), time: new Date() }));

// SPA fallback — serve dashboard for any non-API route
app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// ── Socket.IO ─────────────────────────────────────────────────────────────────
// Dashboard clients join a room for their restaurant so they only receive
// events relevant to their data.
io.on('connection', socket => {
  const { restaurantId, token } = socket.handshake.auth;
  if (restaurantId) {
    socket.join(`restaurant:${restaurantId}`);
    console.log(`[WS] client joined restaurant:${restaurantId}`);
  }

  socket.on('disconnect', () => {
    console.log(`[WS] client disconnected: ${socket.id}`);
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  GrillSync Cloud Platform — port ${PORT}`);
  console.log(`  POS Sync endpoint → POST http://0.0.0.0:${PORT}/sync/batch`);
  console.log(`  Dashboard API     → http://0.0.0.0:${PORT}/api`);
  console.log(`  Health check      → http://0.0.0.0:${PORT}/health\n`);
});

module.exports = { app, server, io };