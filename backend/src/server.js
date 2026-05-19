require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const mongoose = require('mongoose');

const authRoutes = require('./routes/auth');
const restaurantRoutes = require('./routes/restaurants');
const syncRoutes = require('./routes/sync');
const analyticsRoutes = require('./routes/analytics');
const orderRoutes = require('./routes/orders');
const expenseRoutes = require('./routes/expenses');
const notificationRoutes = require('./routes/notifications');
const streamRoutes = require('./routes/stream');

const { ensureSeed } = require('./scripts/seed');

const app = express();

// CORS
const origins = (process.env.CORS_ORIGINS || '*').split(',').map(s => s.trim());
app.use(cors({
  origin: origins.includes('*') ? true : origins,
  credentials: true,
}));

// Raw body capture for HMAC verification on /sync/* and /api/sync/*
app.use(express.json({
  limit: '5mb',
  verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); },
}));

app.use(morgan('tiny'));

app.get('/', (_req, res) => res.json({ ok: true, service: 'grillsync-cloud', time: new Date().toISOString() }));
app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/restaurants', restaurantRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/stream', streamRoutes);

// Sync ingest — mounted at both /sync and /api/sync
app.use('/sync', syncRoutes);
app.use('/api/sync', syncRoutes);

// 404
app.use((req, res) => res.status(404).json({ error: 'Not found', path: req.path }));

// Error handler
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

const PORT = process.env.PORT || 4000;

async function start() {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI not set');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  console.log('[mongo] connected');

  try { await ensureSeed(); } catch (e) { console.warn('[seed] skipped:', e.message); }

  app.listen(PORT, () => console.log(`[grillsync-cloud] listening on :${PORT}`));
}

start().catch(err => { console.error(err); process.exit(1); });
