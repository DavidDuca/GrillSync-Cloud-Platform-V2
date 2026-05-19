/**
 * Renders a self-contained sync agent script for a branch.
 * The script polls the local POS Mongo (`jonels_inasalan.syncqueues`)
 * and uploads pending rows to the cloud /sync/batch endpoint.
 */
function renderSyncScript({ restaurantId, branchId, apiKey, plainSecret, syncEndpoint, publicBaseUrl }) {
  const baseUrl = publicBaseUrl || syncEndpoint.replace(/\/sync\/batch\/?$/, '');
  return `#!/usr/bin/env node
/* eslint-disable */
// GrillSync Cloud — sync agent for branch ${branchId}
// Generated ${new Date().toISOString()}
//
// Usage:
//   Standalone:  node grillsync-sync-${branchId}.js
//   Embedded:    require('./grillsync-sync-${branchId}.js') inside server.js
//
// Env overrides:
//   LOCAL_MONGO_URI / MONGO_URI   (default: mongodb://127.0.0.1:27017/jonels_inasalan)
//   SYNC_POLL_MS                  (default: 15000)
//   SYNC_BATCH_SIZE               (default: 25)

const crypto   = require('crypto');
const mongoose = require('mongoose');

const CLOUD_BASE     = ${JSON.stringify(baseUrl)};
const SYNC_ENDPOINT  = CLOUD_BASE.replace(/\\/+$/, '') + '/sync/batch';
const RESTAURANT_ID  = ${JSON.stringify(restaurantId)};
const BRANCH_ID      = ${JSON.stringify(branchId)};
const API_KEY        = ${JSON.stringify(apiKey)};
const PLAIN_SECRET   = ${JSON.stringify(plainSecret)};
// HMAC key = sha256(plainSecret); this matches the cloud-side stored apiSecret
const HMAC_KEY       = crypto.createHash('sha256').update(PLAIN_SECRET).digest('hex');

const POLL_MS    = Number(process.env.SYNC_POLL_MS || 15000);
const BATCH_SIZE = Number(process.env.SYNC_BATCH_SIZE || 25);
const MONGO_URI  = process.env.LOCAL_MONGO_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/jonels_inasalan';

const SyncQueueSchema = new mongoose.Schema({
  entity:        String,
  entityId:      String,
  op:            String,
  payload:       mongoose.Schema.Types.Mixed,
  status:        { type: String, default: 'pending' },
  attempts:      { type: Number, default: 0 },
  lastError:     String,
  lastAttemptAt: Date,
  nextAttemptAt: Date,
  syncedAt:      Date,
  cloudId:       String,
}, { timestamps: true, collection: 'syncqueues' });

const SyncQueue = mongoose.models.SyncQueue || mongoose.model('SyncQueue', SyncQueueSchema);

let timer = null;
let running = false;
let shuttingDown = false;
let consecutiveFailures = 0;

function backoffMs() {
  // exponential: 15s, 30s, 60s, 2m, 5m max
  const ladder = [15000, 30000, 60000, 120000, 300000];
  return ladder[Math.min(consecutiveFailures, ladder.length - 1)];
}

async function tick() {
  if (running || shuttingDown) return;
  running = true;
  try {
    const now = new Date();
    const rows = await SyncQueue.find({
      status: 'pending',
      $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }],
    }).sort({ createdAt: 1 }).limit(BATCH_SIZE).lean();

    if (!rows.length) { consecutiveFailures = 0; return; }

    const records = rows.map(r => ({
      id: String(r._id),
      entity: r.entity,
      entityId: r.entityId,
      op: r.op,
      payload: r.payload,
      createdAt: r.createdAt,
    }));

    const body = JSON.stringify({
      restaurantId: RESTAURANT_ID,
      branchId: BRANCH_ID,
      sentAt: new Date().toISOString(),
      records,
    });

    const ts = Date.now().toString();
    const sig = crypto.createHmac('sha256', HMAC_KEY).update(ts + '.' + body).digest('hex');

    const resp = await fetch(SYNC_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': API_KEY,
        'X-Restaurant-Id': RESTAURANT_ID,
        'X-Timestamp': ts,
        'X-Signature': sig,
      },
      body,
    });

    if (!resp.ok) {
      consecutiveFailures++;
      const text = await resp.text().catch(() => '');
      console.warn('[grillsync] upload failed', resp.status, text.slice(0, 200));
      const next = new Date(Date.now() + backoffMs());
      await SyncQueue.updateMany(
        { _id: { $in: rows.map(r => r._id) } },
        { $inc: { attempts: 1 }, $set: { lastError: 'HTTP ' + resp.status, lastAttemptAt: now, nextAttemptAt: next } }
      );
      return;
    }

    const json = await resp.json().catch(() => ({}));
    const accepted = Array.isArray(json.accepted) ? json.accepted : [];
    const rejected = Array.isArray(json.rejected) ? json.rejected : [];

    for (const a of accepted) {
      await SyncQueue.updateOne(
        { _id: a.id },
        { $set: { status: 'synced', syncedAt: new Date(), cloudId: a.cloudId, lastError: null } }
      );
    }
    for (const r of rejected) {
      await SyncQueue.updateOne(
        { _id: r.id },
        { $inc: { attempts: 1 }, $set: { status: 'failed', lastError: r.error || 'rejected', lastAttemptAt: now, nextAttemptAt: new Date(Date.now() + backoffMs()) } }
      );
    }

    consecutiveFailures = 0;
    if (accepted.length) console.log('[grillsync] synced', accepted.length, 'rejected', rejected.length);
  } catch (e) {
    consecutiveFailures++;
    console.warn('[grillsync] tick error:', e.message);
  } finally {
    running = false;
  }
}

async function start() {
  const standalone = require.main === module;
  if (standalone) {
    await mongoose.connect(MONGO_URI);
    console.log('[grillsync] connected to', MONGO_URI);
  } else if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGO_URI);
  }
  if (timer) return;
  timer = setInterval(tick, POLL_MS);
  tick().catch(() => {});
  console.log('[grillsync] agent started — branch ' + BRANCH_ID + ' → ' + CLOUD_BASE);
}

async function stop() {
  shuttingDown = true;
  if (timer) { clearInterval(timer); timer = null; }
  // wait briefly for in-flight tick
  for (let i = 0; i < 50 && running; i++) await new Promise(r => setTimeout(r, 100));
  if (require.main === module) {
    try { await mongoose.disconnect(); } catch {}
    process.exit(0);
  }
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);

if (require.main === module) {
  start().catch(err => { console.error(err); process.exit(1); });
} else {
  module.exports = { start, stop };
  // Auto-start in embedded mode after the host connects mongoose
  if (mongoose.connection.readyState === 1) start().catch(() => {});
  else mongoose.connection.once('connected', () => start().catch(() => {}));
}
`;
}

module.exports = { renderSyncScript };
