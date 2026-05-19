const express = require('express');
const SyncedOrder = require('../models/SyncedOrder');
const { authRequired, scopeFilter } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired);

router.get('/', async (req, res) => {
  const page  = Math.max(1, Number(req.query.page)  || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 30));
  const filter = scopeFilter(req.user);
  if (req.query.branchId) filter.branchId = req.query.branchId;
  if (req.query.date) {
    const d = new Date(req.query.date); d.setHours(0,0,0,0);
    const end = new Date(d); end.setDate(end.getDate() + 1);
    filter.placedAt = { $gte: d, $lt: end };
  }

  const [items, total] = await Promise.all([
    SyncedOrder.find(filter).sort({ placedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    SyncedOrder.countDocuments(filter),
  ]);

  res.json({ orders: items, total, page, limit, pages: Math.ceil(total / limit) });
});

module.exports = router;
