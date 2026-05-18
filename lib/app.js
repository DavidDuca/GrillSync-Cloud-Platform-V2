/**
 * Express app factory for the Vercel serverless wrapper.
 *
 * This is a refactor of the original server/index.js that removes:
 *   - http.createServer / Socket.IO       (Vercel functions can't host sockets)
 *   - app.listen                          (Vercel invokes the exported handler)
 *   - Static SPA fallback                 (Vercel serves /public via rewrites)
 *
 * It preserves:
 *   - express.json({ verify }) raw-body capture for HMAC verification
 *   - helmet, compression, cors, rate limiting
 *   - All existing /api routes and the POS /sync routes
 *
 * The app instance is cached at module scope so warm invocations skip
 * re-mounting routes.
 */
const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const compression = require('compression');
const rateLimit   = require('express-rate-limit');
const morgan      = require('morgan');

const { connectDB } = require('./db');

const syncRoutes         = require('../server/routes/sync');
const authRoutes         = require('../server/routes/auth');
const restaurantRoutes   = require('../server/routes/restaurants');
const analyticsRoutes    = require('../server/routes/analytics');
const expenseRoutes      = require('../server/routes/expenses');
const orderRoutes        = require('../server/routes/orders');
const notificationRoutes = require('../server/routes/notifications');

let _app = null;

function buildApp() {
  const app = express();

  // Raw body capture for HMAC verification (must run before any route).
  app.use(express.json({
    limit: '2mb',
    verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); },
  }));

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(compression());
  app.use(cors({
    origin: (process.env.ALLOWED_ORIGINS || '*')
      .split(',').map((s) => s.trim()).filter(Boolean),
    credentials: true,
  }));
  if (process.env.NODE_ENV !== 'test' && process.env.NODE_ENV !== 'production') {
    app.use(morgan('dev'));
  }

  // Lazy-connect on first request so cold starts don't block on DB before
  // serving health checks etc.
  app.use(async (req, _res, next) => {
    try {
      await connectDB();
      next();
    } catch (err) {
      console.error('[DB] connection failure on request', err.message);
      next(); // let the route fail with a clear error rather than 500-ing here
    }
  });

  // Global rate limit
  app.use(rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
    max:      parseInt(process.env.RATE_LIMIT_MAX       || '500',    10),
    standardHeaders: true,
    legacyHeaders:   false,
    message: { error: 'Too many requests' },
  }));

  const syncLimiter = rateLimit({
    windowMs: 60 * 1000,
    max:      parseInt(process.env.SYNC_RATE_LIMIT_MAX || '200', 10),
    message:  { error: 'Sync rate limit exceeded' },
  });

  // POS ingest — keep BOTH legacy + new aliases pointing at the same router.
  //   /sync/*              (legacy POS contract from POS syncService.js)
  //   /api/sync/*          (Vercel-friendly canonical path)
  //   /api/sync/branch-upload  (new, alias of /sync/batch)
  app.use('/sync',     syncLimiter, syncRoutes);
  app.use('/api/sync', syncLimiter, syncRoutes);

  // Dashboard API
  app.use('/api/auth',          authRoutes);
  app.use('/api/restaurants',   restaurantRoutes);
  app.use('/api/analytics',     analyticsRoutes);
  app.use('/api/expenses',      expenseRoutes);
  app.use('/api/orders',        orderRoutes);
  app.use('/api/notifications', notificationRoutes);

  app.get('/api/health', (_req, res) => res.json({
    ok: true, time: new Date(), runtime: 'vercel-serverless',
  }));

  // Centralised error handler so failures return JSON, not HTML.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error('[ERR]', err);
    res.status(err.status || 500).json({ error: err.message || 'Internal error' });
  });

  return app;
}

function getApp() {
  if (!_app) _app = buildApp();
  return _app;
}

module.exports = { getApp };
