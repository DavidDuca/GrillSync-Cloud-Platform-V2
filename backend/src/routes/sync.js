const express = require('express');
const { posAuth } = require('../middleware/posAuth');
const SyncedOrder = require('../models/SyncedOrder');
const Notification = require('../models/Notification');
const { broadcast } = require('../services/sseBus');

const router = express.Router();

router.get('/status', (_req, res) => res.json({ ok: true, serverTime: new Date().toISOString() }));

async function ingestBatch(req, res) {
  const branch  = req.branch;
  const rest    = req.restaurant;
  const records = Array.isArray(req.body?.records) ? req.body.records : [];

  const accepted = [];
  const rejected = [];

  for (const rec of records) {
    try {
      if (!rec || !rec.entity || !rec.entityId) {
        rejected.push({ id: rec?.id, error: 'missing entity/entityId' }); continue;
      }
      if (rec.entity === 'order' || rec.entity === 'sale') {
        const p = rec.payload || {};
        const orderId = p.orderId || rec.entityId;
        const cloudId = `${branch.branchId}:${orderId}`;
        if (rec.op === 'delete') {
          await SyncedOrder.deleteOne({ branchId: branch.branchId, orderId });
        } else {
          await SyncedOrder.findOneAndUpdate(
            { branchId: branch.branchId, orderId },
            {
              $set: {
                restaurantId: rest.restaurantId,
                branchId:     branch.branchId,
                orderId,
                customerNo:   p.customerNo,
                items:        p.items || [],
                totalPrice:   p.totalPrice || 0,
                cashReceived: p.cashReceived || 0,
                changeDue:    p.changeDue || 0,
                status:       p.status,
                stations:     p.stations,
                placedAt:     p.placedAt,
                paidAt:       p.paidAt,
                readyAt:      p.readyAt,
                completedAt:  p.completedAt,
                updatedAt:    p.updatedAt || new Date(),
                syncQueueId:  rec.id,
              },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
        }
        accepted.push({ id: rec.id, cloudId });
      } else {
        // accept other entities silently for now (expense/product/inventory/analytics_daily)
        accepted.push({ id: rec.id, cloudId: `${branch.branchId}:${rec.entity}:${rec.entityId}` });
      }
    } catch (e) {
      console.error('[sync] record error', e);
      rejected.push({ id: rec?.id, error: e.message });
    }
  }

  // Update branch sync status
  branch.lastSyncAt = new Date();
  branch.syncStatus = 'online';
  await rest.save();

  // Fire SSE event scoped to this restaurant
  broadcast(
    'sync:batchReceived',
    {
      restaurantId: rest.restaurantId,
      branchId: branch.branchId,
      acceptedCount: accepted.length,
      rejectedCount: rejected.length,
      at: new Date().toISOString(),
    },
    c => c.user.role === 'superadmin' || c.user.restaurantId === rest.restaurantId
  );

  // Optional: notification for large batches
  if (accepted.length >= 10) {
    try {
      await Notification.create({
        restaurantId: rest.restaurantId,
        branchId: branch.branchId,
        title: `Synced ${accepted.length} records`,
        message: `Branch ${branch.name} uploaded a batch`,
        severity: 'info',
      });
    } catch {}
  }

  res.json({
    accepted, rejected,
    branchId: branch.branchId,
    restaurantId: rest.restaurantId,
    serverTime: new Date().toISOString(),
  });
}

router.post('/batch', posAuth, ingestBatch);
router.post('/branch-upload', posAuth, ingestBatch);

module.exports = router;
