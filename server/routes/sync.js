/**
 * sync.js — receives batched order uploads from POS restaurants.
 *
 * POST /sync/batch
 *   Body: { restaurantId, sentAt, records: [{ id, entity, entityId, op, payload, createdAt }] }
 *   Auth: posAuth middleware (X-Api-Key + HMAC signature)
 *
 * The handler is idempotent: duplicate orderId+branchId rows are upserted,
 * so POS retries never cause duplicate data.
 */
const express      = require('express');
const router       = express.Router();
const posAuth      = require('../middleware/posAuth');
const SyncedOrder  = require('../models/SyncedOrder');
const Notification = require('../models/Notification');

// POST /sync/batch
router.post('/batch', posAuth, async (req, res) => {
  const { records } = req.body;
  const { restaurant, branch } = req;

  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'records array required' });
  }
  if (records.length > 200) {
    return res.status(400).json({ error: 'Max 200 records per batch' });
  }

  const accepted = [];
  const rejected = [];

  // Update branch last-seen
  try {
    const b = restaurant.branches.find(br => br.branchId === branch.branchId);
    if (b) { b.lastSyncAt = new Date(); b.syncStatus = 'online'; }
    await restaurant.save();
  } catch (_) {}

  for (const rec of records) {
    try {
      if (rec.entity === 'order') {
        await ingestOrder(rec, restaurant.restaurantId, branch.branchId);
        accepted.push({ id: rec.id, cloudId: `${branch.branchId}:${rec.entityId}` });
      } else if (rec.entity === 'sale') {
        // Sales are derived from orders — we keep them in SyncedOrder with
        // paidAt indexing. No separate collection needed for basic analytics.
        accepted.push({ id: rec.id, cloudId: null });
      } else {
        // Future entities (expense, product, inventory, analytics_daily)
        accepted.push({ id: rec.id, cloudId: null });
      }
    } catch (err) {
      console.error(`[SYNC-INGEST] ${rec.entity}/${rec.entityId}:`, err.message);
      rejected.push({ id: rec.id, error: err.message });
    }
  }

  // Emit realtime update to any connected dashboard clients watching this restaurant
  const io = req.app.get('io');
  if (io && accepted.length > 0) {
    io.to(`restaurant:${restaurant.restaurantId}`).emit('sync:batchReceived', {
      restaurantId: restaurant.restaurantId,
      branchId:     branch.branchId,
      count:        accepted.length,
      receivedAt:   new Date()
    });
  }

  res.json({ accepted, rejected });
});

async function ingestOrder(rec, restaurantId, branchId) {
  const p = rec.payload;
  if (!p || !p.orderId) throw new Error('payload.orderId missing');

  // Normalise stations Map → plain object
  let stations = p.stations || {};
  if (stations instanceof Map) {
    const out = {};
    stations.forEach((v, k) => { out[k] = v; });
    stations = out;
  }

  const doc = {
    restaurantId,
    branchId,
    orderId:      p.orderId,
    customerNo:   p.customerNo,
    items:        p.items || [],
    totalPrice:   p.totalPrice || 0,
    cashReceived: p.cashReceived || 0,
    changeDue:    p.changeDue   || 0,
    paymentMethod:p.paymentMethod || 'cash',
    status:       p.status || 'pending',
    stations,
    placedAt:     p.placedAt   ? new Date(p.placedAt)   : null,
    paidAt:       p.paidAt     ? new Date(p.paidAt)     : null,
    readyAt:      p.readyAt    ? new Date(p.readyAt)    : null,
    completedAt:  p.completedAt? new Date(p.completedAt): null,
    updatedAt:    p.updatedAt  ? new Date(p.updatedAt)  : new Date(),
    syncQueueId:  rec.id || null
  };

  await SyncedOrder.findOneAndUpdate(
    { branchId, orderId: p.orderId },
    { $set: doc },
    { upsert: true, new: true }
  );
}

// GET /sync/status — health check for POS
router.get('/status', posAuth, (req, res) => {
  res.json({
    ok: true,
    restaurantId: req.restaurant.restaurantId,
    branchId:     req.branch.branchId,
    serverTime:   new Date()
  });
});

module.exports = router;
