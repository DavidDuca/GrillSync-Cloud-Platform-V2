const express     = require('express');
const router      = express.Router();
const auth        = require('../middleware/auth');
const SyncedOrder = require('../models/SyncedOrder');

// GET /api/orders?branchId=&date=&status=&page=&limit=
router.get('/', auth, async (req, res) => {
  try {
    const filter = { restaurantId: req.user.restaurantId };
    if (req.query.branchId) filter.branchId = req.query.branchId;
    if (req.query.status)   filter.status   = req.query.status;
    if (req.query.date) {
      const d    = new Date(req.query.date + 'T00:00:00+08:00');
      const dEnd = new Date(d.getTime() + 24 * 60 * 60 * 1000);
      filter.paidAt = { $gte: d, $lt: dEnd };
    }

    const page  = Math.max(1, parseInt(req.query.page  || '1',  10));
    const limit = Math.min(100, parseInt(req.query.limit || '30', 10));

    const [orders, total] = await Promise.all([
      SyncedOrder.find(filter).sort({ placedAt: -1 }).skip((page-1)*limit).limit(limit).lean(),
      SyncedOrder.countDocuments(filter)
    ]);

    res.json({ orders, total, page, pages: Math.ceil(total/limit) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/orders/:orderId
router.get('/:orderId', auth, async (req, res) => {
  try {
    const order = await SyncedOrder.findOne({
      restaurantId: req.user.restaurantId,
      orderId: req.params.orderId
    });
    if (!order) return res.status(404).json({ error: 'Not found' });
    res.json({ order });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
