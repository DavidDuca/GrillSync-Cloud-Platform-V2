/**
 * grillsync-branch-sync.js — drop-in cloud sync worker for a POS branch.
 *
 * This file is auto-generated for branch {{BRANCH_NAME}} ({{BRANCH_ID}}).
 * Copy it into your local POS server directory and run:
 *
 *     node grillsync-branch-sync.js
 *
 * Or load it from your existing POS process:
 *
 *     require('./grillsync-branch-sync.js');
 *
 * It reads pending records from your local Mongo `syncqueues` collection
 * (created by the existing POS SyncQueue model), batches them, signs with
 * HMAC-SHA256, and uploads to /api/sync/branch-upload on the cloud.
 *
 * No additional env vars required — all credentials are embedded below.
 * On network failures the worker backs off exponentially and retries
 * forever; POS operation is never blocked.
 *
 * Generated:    {{GENERATED_AT}}
 * Cloud target: {{CLOUD_URL}}
 */
'use strict';

const crypto   = require('crypto');
const mongoose = require('mongoose');

// ── EMBEDDED BRANCH CREDENTIALS — keep this file private ─────────────────────
const CONFIG = {
  cloudUrl:     '{{CLOUD_URL}}',          // base URL of the cloud platform
  branchId:     '{{BRANCH_ID}}',
  restaurantId: '{{RESTAURANT_ID}}',
  apiKey:       '{{API_KEY}}',
  apiSecret:    '{{API_SECRET}}',         // plain HMAC secret — shown ONCE on creation

  // Local DB the POS already writes to. Override via LOCAL_MONGO_URI if needed.
  localMongoUri: process.env.LOCAL_MONGO_URI || 'mongodb://127.0.0.1:27017/grillsync',

  // Tuning
  batchSize:   25,
  intervalMs:  15_000,
  timeoutMs:   12_000,
  maxAttempts: 50,
};
// ─────────────────────────────────────────────────────────────────────────────

const SyncQueueSchema = new mongoose.Schema({
  entity:        String,
  entityId:      String,
  op:            { type: String, default: 'upsert' },
  payload:       mongoose.Schema.Types.Mixed,
  status:        { type: String, default: 'pending' }, // pending|uploading|done|dead
  attempts:      { type: Number, default: 0 },
  lastError:     String,
  lastAttemptAt: Date,
  nextAttemptAt: { type: Date, default: Date.now },
  createdAt:     { type: Date, default: Date.now },
}, { collection: 'syncqueues' });

const SyncQueue = mongoose.models.SyncQueue || mongoose.model('SyncQueue', SyncQueueSchema);

function sign(body, ts) {
  // The cloud stores the SHA-256 of the secret and verifies HMAC using
  // that hash as the key (see server/middleware/posAuth.js). The POS must
  // therefore sign with the SAME hash, not the plain secret.
  const key = crypto.createHash('sha256').update(CONFIG.apiSecret).digest('hex');
  return crypto.createHmac('sha256', key).update(`${ts}.${body}`).digest('hex');
}

async function postBatch(batch) {
  const body = JSON.stringify({
    restaurantId: CONFIG.restaurantId,
    branchId:     CONFIG.branchId,
    sentAt:       new Date().toISOString(),
    records: batch.map((r) => ({
      id:        r._id.toString(),
      entity:    r.entity,
      entityId:  r.entityId,
      op:        r.op,
      payload:   r.payload,
      createdAt: r.createdAt,
    })),
  });
  const ts  = Date.now().toString();
  const sig = sign(body, ts);

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), CONFIG.timeoutMs);
  try {
    const resp = await fetch(`${CONFIG.cloudUrl.replace(/\/$/, '')}/api/sync/branch-upload`, {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'X-Api-Key':       CONFIG.apiKey,
        'X-Restaurant-Id': CONFIG.restaurantId,
        'X-Timestamp':     ts,
        'X-Signature':     sig,
      },
      body,
      signal: ctrl.signal,
    });
    let json = null;
    try { json = await resp.json(); } catch (_) { /* non-JSON body */ }
    return { ok: resp.ok, status: resp.status, json };
  } finally {
    clearTimeout(t);
  }
}

function nextDelayMs(attempts) {
  const base = Math.min(30 * 60 * 1000, 5_000 * Math.pow(2, Math.min(attempts, 10)));
  return base * (0.7 + Math.random() * 0.6);
}

let running = false;

async function drainOnce() {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    const batch = await SyncQueue
      .find({ status: 'pending', nextAttemptAt: { $lte: now } })
      .sort({ createdAt: 1 })
      .limit(CONFIG.batchSize);

    if (batch.length === 0) return;

    const ids = batch.map((b) => b._id);
    await SyncQueue.updateMany(
      { _id: { $in: ids } },
      { $set: { status: 'uploading', lastAttemptAt: now }, $inc: { attempts: 1 } },
    );

    let result;
    try {
      result = await postBatch(batch);
    } catch (err) {
      const delay = nextDelayMs(batch[0].attempts + 1);
      await SyncQueue.updateMany(
        { _id: { $in: ids } },
        { $set: { status: 'pending', lastError: err.message, nextAttemptAt: new Date(Date.now() + delay) } },
      );
      console.warn(`[SYNC] network error: ${err.message} (retry in ${Math.round(delay / 1000)}s)`);
      return;
    }

    if (result.ok) {
      const acceptedIds = new Set((result.json?.accepted || []).map((a) => a.id));
      await SyncQueue.updateMany(
        { _id: { $in: ids.filter((id) => acceptedIds.has(id.toString())) } },
        { $set: { status: 'done', lastError: null } },
      );
      const rejected = result.json?.rejected || [];
      for (const r of rejected) {
        await SyncQueue.updateOne(
          { _id: r.id },
          { $set: { status: 'dead', lastError: r.error || 'rejected' } },
        );
      }
      console.log(`[SYNC] uploaded ${acceptedIds.size}, rejected ${rejected.length}`);
    } else if (result.status >= 400 && result.status < 500) {
      // Permanent failure (auth, validation). Park as dead.
      await SyncQueue.updateMany(
        { _id: { $in: ids } },
        { $set: { status: 'dead', lastError: `HTTP ${result.status}: ${JSON.stringify(result.json)}` } },
      );
      console.error(`[SYNC] permanent failure ${result.status} — parked ${ids.length} rows`);
    } else {
      // Transient (5xx). Back off and retry.
      const delay = nextDelayMs(batch[0].attempts + 1);
      await SyncQueue.updateMany(
        { _id: { $in: ids } },
        { $set: { status: 'pending', lastError: `HTTP ${result.status}`, nextAttemptAt: new Date(Date.now() + delay) } },
      );
      console.warn(`[SYNC] transient ${result.status} — retry in ${Math.round(delay / 1000)}s`);
    }
  } finally {
    running = false;
  }
}

async function start() {
  await mongoose.connect(CONFIG.localMongoUri);
  console.log(`[SYNC] worker started for branch ${CONFIG.branchId} → ${CONFIG.cloudUrl}`);
  setInterval(() => { drainOnce().catch((e) => console.error('[SYNC] drain crash', e)); }, CONFIG.intervalMs);
  drainOnce().catch(() => {});
}

if (require.main === module) {
  start().catch((err) => {
    console.error('[SYNC] fatal:', err);
    process.exit(1);
  });
} else {
  module.exports = { start, drainOnce, CONFIG };
}
