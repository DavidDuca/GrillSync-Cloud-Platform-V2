const express = require('express');
const SyncedOrder = require('../models/SyncedOrder');
const Expense = require('../models/Expense');
const { authRequired, scopeFilter } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired);

function rangeStart(days) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (Number(days) || 7) + 1);
  return d;
}

function dayKey(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

router.get('/summary', async (req, res) => {
  const range = Number(req.query.range) || 7;
  const branchId = req.query.branchId || null;
  const filter = scopeFilter(req.user);
  if (branchId) filter.branchId = branchId;

  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const periodStart = rangeStart(range);

  const [todayAgg, periodAgg, expAgg] = await Promise.all([
    SyncedOrder.aggregate([
      { $match: { ...filter, placedAt: { $gte: todayStart }, status: { $nin: ['cancelled'] } } },
      { $group: { _id: null, revenue: { $sum: '$totalPrice' }, count: { $sum: 1 } } },
    ]),
    SyncedOrder.aggregate([
      { $match: { ...filter, placedAt: { $gte: periodStart }, status: { $nin: ['cancelled'] } } },
      { $group: { _id: null, revenue: { $sum: '$totalPrice' }, count: { $sum: 1 } } },
    ]),
    Expense.aggregate([
      { $match: { ...filter, expenseDate: { $gte: periodStart } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
  ]);

  const todayRevenue  = todayAgg[0]?.revenue || 0;
  const todayCount    = todayAgg[0]?.count || 0;
  const periodRevenue = periodAgg[0]?.revenue || 0;
  const periodCount   = periodAgg[0]?.count || 0;
  const periodExpense = expAgg[0]?.total || 0;
  const profit        = periodRevenue - periodExpense;
  const margin        = periodRevenue ? (profit / periodRevenue) * 100 : 0;

  res.json({
    range,
    todayRevenue, todayCount,
    periodRevenue, periodCount,
    periodExpense,
    profit, margin,
  });
});

router.get('/daily', async (req, res) => {
  const range = Number(req.query.range) || 30;
  const branchId = req.query.branchId || null;
  const filter = scopeFilter(req.user);
  if (branchId) filter.branchId = branchId;
  const start = rangeStart(range);

  const orders = await SyncedOrder.find({ ...filter, placedAt: { $gte: start } })
    .select('placedAt totalPrice status').lean();
  const expenses = await Expense.find({ ...filter, expenseDate: { $gte: start } })
    .select('expenseDate amount').lean();

  const buckets = {};
  for (let i = 0; i < range; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    buckets[dayKey(d)] = { date: dayKey(d), revenue: 0, orders: 0, expense: 0 };
  }
  for (const o of orders) {
    if (o.status === 'cancelled') continue;
    const k = dayKey(o.placedAt || o.createdAt);
    if (buckets[k]) { buckets[k].revenue += o.totalPrice || 0; buckets[k].orders += 1; }
  }
  for (const e of expenses) {
    const k = dayKey(e.expenseDate);
    if (buckets[k]) buckets[k].expense += e.amount || 0;
  }

  res.json({ daily: Object.values(buckets) });
});

router.get('/hourly', async (req, res) => {
  const branchId = req.query.branchId || null;
  const filter = scopeFilter(req.user);
  if (branchId) filter.branchId = branchId;
  const start = rangeStart(Number(req.query.range) || 7);

  const orders = await SyncedOrder.find({ ...filter, placedAt: { $gte: start }, status: { $nin: ['cancelled'] } })
    .select('placedAt totalPrice').lean();

  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, revenue: 0, orders: 0 }));
  for (const o of orders) {
    const h = new Date(o.placedAt || o.createdAt).getHours();
    hours[h].revenue += o.totalPrice || 0;
    hours[h].orders += 1;
  }
  res.json({ hourly: hours });
});

router.get('/bestsellers', async (req, res) => {
  const range = Number(req.query.range) || 7;
  const limit = Number(req.query.limit) || 8;
  const branchId = req.query.branchId || null;
  const filter = scopeFilter(req.user);
  if (branchId) filter.branchId = branchId;
  const start = rangeStart(range);

  const rows = await SyncedOrder.aggregate([
    { $match: { ...filter, placedAt: { $gte: start }, status: { $nin: ['cancelled'] } } },
    { $unwind: '$items' },
    { $group: {
        _id: { itemId: '$items.itemId', name: '$items.name' },
        quantity: { $sum: '$items.quantity' },
        revenue:  { $sum: '$items.lineTotal' },
    } },
    { $sort: { revenue: -1 } },
    { $limit: limit },
  ]);

  res.json({
    bestsellers: rows.map(r => ({
      itemId: r._id.itemId, name: r._id.name,
      quantity: r.quantity, revenue: r.revenue,
    })),
  });
});

router.get('/categories', async (req, res) => {
  const range = Number(req.query.range) || 7;
  const branchId = req.query.branchId || null;
  const filter = scopeFilter(req.user);
  if (branchId) filter.branchId = branchId;
  const start = rangeStart(range);

  const rows = await SyncedOrder.aggregate([
    { $match: { ...filter, placedAt: { $gte: start }, status: { $nin: ['cancelled'] } } },
    { $unwind: '$items' },
    { $group: {
        _id: { $ifNull: ['$items.category', 'uncategorized'] },
        revenue: { $sum: '$items.lineTotal' },
        quantity: { $sum: '$items.quantity' },
    } },
    { $sort: { revenue: -1 } },
  ]);

  res.json({
    categories: rows.map(r => ({ category: r._id, revenue: r.revenue, quantity: r.quantity })),
  });
});

module.exports = router;
