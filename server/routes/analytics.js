/**
 * analytics.js — all analytics aggregation endpoints.
 * Every endpoint is scoped by restaurantId (from JWT).
 * Optional ?branchId= filter narrows to a single branch.
 * Optional ?range=7|30|90 sets the lookback window (default 30).
 */
const express      = require('express');
const router       = express.Router();
const auth         = require('../middleware/auth');
const SyncedOrder  = require('../models/SyncedOrder');
const Expense      = require('../models/Expense');

// ── Helpers ──────────────────────────────────────────────────────────────────
function getRange(req) {
  const r = parseInt(req.query.range || '30', 10);
  return [7, 30, 90, 180, 365].includes(r) ? r : 30;
}

function branchFilter(req) {
  const base = { restaurantId: req.user.restaurantId };
  if (req.query.branchId) base.branchId = req.query.branchId;
  return base;
}

function phDayStart(daysAgo = 0) {
  const now = new Date();
  const ph  = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  ph.setUTCHours(0, 0, 0, 0);
  ph.setUTCDate(ph.getUTCDate() - daysAgo);
  return new Date(ph.getTime() - 8 * 60 * 60 * 1000);
}

const PAID = ['paid','preparing','partially-ready','ready','completed'];

// ── GET /api/analytics/summary ────────────────────────────────────────────────
// KPI cards: today / period revenue, AOV, order count, trend
router.get('/summary', auth, async (req, res) => {
  try {
    const days   = getRange(req);
    const filter = branchFilter(req);
    const today  = phDayStart(0);
    const start  = phDayStart(days - 1);

    const [todayAgg, periodAgg, expAgg] = await Promise.all([
      SyncedOrder.aggregate([
        { $match: { ...filter, status: { $in: PAID }, paidAt: { $gte: today } } },
        { $group: { _id: null, total: { $sum: '$totalPrice' }, count: { $sum: 1 } } }
      ]),
      SyncedOrder.aggregate([
        { $match: { ...filter, status: { $in: PAID }, paidAt: { $gte: start } } },
        { $group: { _id: null, total: { $sum: '$totalPrice' }, count: { $sum: 1 }, avgOrder: { $avg: '$totalPrice' } } }
      ]),
      Expense.aggregate([
        { $match: { restaurantId: filter.restaurantId, ...(filter.branchId ? { branchId: filter.branchId } : {}), status: 'approved', expenseDate: { $gte: start } } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ])
    ]);

    const periodRevenue  = periodAgg[0]?.total    || 0;
    const periodExpenses = expAgg[0]?.total        || 0;
    const estimatedProfit= periodRevenue - periodExpenses;

    res.json({
      today:   { total: todayAgg[0]?.total || 0, count: todayAgg[0]?.count || 0 },
      period:  { total: periodRevenue, count: periodAgg[0]?.count || 0, avg: periodAgg[0]?.avgOrder || 0, days },
      expenses:{ total: periodExpenses },
      profit:  { estimated: estimatedProfit, margin: periodRevenue > 0 ? (estimatedProfit / periodRevenue * 100).toFixed(1) : 0 }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/analytics/daily ──────────────────────────────────────────────────
// Day-by-day revenue + order count for the range (fills zero-days)
router.get('/daily', auth, async (req, res) => {
  try {
    const days   = getRange(req);
    const filter = branchFilter(req);
    const start  = phDayStart(days - 1);

    const rows = await SyncedOrder.aggregate([
      { $match: { ...filter, status: { $in: PAID }, paidAt: { $gte: start } } },
      { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$paidAt', timezone: '+08:00' } },
          total:    { $sum: '$totalPrice' },
          count:    { $sum: 1 },
          avgOrder: { $avg: '$totalPrice' }
      }},
      { $sort: { _id: 1 } }
    ]);

    // Fill sparse data
    const map = {};
    rows.forEach(r => { map[r._id] = r; });
    const filled = [];
    for (let i = days - 1; i >= 0; i--) {
      const d   = phDayStart(i);
      const key = d.toISOString().slice(0,10).replace('T','');
      // Use PH date string
      const ph  = new Date(d.getTime() + 8 * 60 * 60 * 1000);
      const phKey = ph.toISOString().slice(0,10);
      const row = map[phKey] || { total: 0, count: 0, avgOrder: 0 };
      filled.push({ date: phKey, total: row.total, count: row.count, avgOrder: row.avgOrder || 0 });
    }

    res.json({ daily: filled, range: days });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/analytics/hourly ─────────────────────────────────────────────────
// Today's hourly revenue breakdown
router.get('/hourly', auth, async (req, res) => {
  try {
    const filter = branchFilter(req);
    const today  = phDayStart(0);

    const rows = await SyncedOrder.aggregate([
      { $match: { ...filter, status: { $in: PAID }, paidAt: { $gte: today } } },
      { $group: {
          _id: { $hour: { date: '$paidAt', timezone: '+08:00' } },
          total: { $sum: '$totalPrice' },
          count: { $sum: 1 }
      }},
      { $sort: { _id: 1 } }
    ]);

    const map = {};
    rows.forEach(r => { map[r._id] = r; });
    const hourly = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      label: `${String(h).padStart(2,'0')}:00`,
      total: map[h]?.total || 0,
      count: map[h]?.count || 0
    }));

    const peak = hourly.reduce((b, h) => h.total > b.total ? h : b, hourly[0]);
    res.json({ hourly, peak, date: today });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/analytics/bestsellers ───────────────────────────────────────────
router.get('/bestsellers', auth, async (req, res) => {
  try {
    const days   = getRange(req);
    const limit  = Math.min(20, parseInt(req.query.limit || '10', 10));
    const filter = branchFilter(req);
    const start  = phDayStart(days - 1);

    const rows = await SyncedOrder.aggregate([
      { $match: { ...filter, status: { $in: PAID }, paidAt: { $gte: start } } },
      { $unwind: '$items' },
      { $group: {
          _id:         '$items.itemId',
          name:        { $first: '$items.name' },
          category:    { $first: '$items.category' },
          totalQty:    { $sum: '$items.quantity' },
          totalRevenue:{ $sum: '$items.lineTotal' }
      }},
      { $sort: { totalQty: -1 } },
      { $limit: limit }
    ]);

    res.json({ items: rows.map(r => ({
      itemId: r._id, name: r.name, category: r.category,
      totalQty: r.totalQty, totalRevenue: r.totalRevenue
    })), range: days });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/analytics/categories ────────────────────────────────────────────
// Revenue by menu category
router.get('/categories', auth, async (req, res) => {
  try {
    const days   = getRange(req);
    const filter = branchFilter(req);
    const start  = phDayStart(days - 1);

    const rows = await SyncedOrder.aggregate([
      { $match: { ...filter, status: { $in: PAID }, paidAt: { $gte: start } } },
      { $unwind: '$items' },
      { $group: {
          _id:         '$items.category',
          totalRevenue:{ $sum: '$items.lineTotal' },
          totalQty:    { $sum: '$items.quantity' }
      }},
      { $sort: { totalRevenue: -1 } }
    ]);

    res.json({ categories: rows.map(r => ({ category: r._id, totalRevenue: r.totalRevenue, totalQty: r.totalQty })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/analytics/branches ───────────────────────────────────────────────
// Branch performance comparison
router.get('/branches', auth, async (req, res) => {
  try {
    const days  = getRange(req);
    const start = phDayStart(days - 1);

    const rows = await SyncedOrder.aggregate([
      { $match: { restaurantId: req.user.restaurantId, status: { $in: PAID }, paidAt: { $gte: start } } },
      { $group: {
          _id:          '$branchId',
          totalRevenue: { $sum: '$totalPrice' },
          orderCount:   { $sum: 1 },
          avgOrder:     { $avg: '$totalPrice' }
      }},
      { $sort: { totalRevenue: -1 } }
    ]);

    res.json({ branches: rows.map(r => ({
      branchId: r._id, totalRevenue: r.totalRevenue,
      orderCount: r.orderCount, avgOrder: Math.round(r.avgOrder)
    })), range: days });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/analytics/profit ─────────────────────────────────────────────────
// Profit summary with daily trend
router.get('/profit', auth, async (req, res) => {
  try {
    const days   = getRange(req);
    const filter = branchFilter(req);
    const start  = phDayStart(days - 1);

    const [revenueRows, expenseRows] = await Promise.all([
      SyncedOrder.aggregate([
        { $match: { ...filter, status: { $in: PAID }, paidAt: { $gte: start } } },
        { $group: {
            _id:   { $dateToString: { format: '%Y-%m-%d', date: '$paidAt', timezone: '+08:00' } },
            total: { $sum: '$totalPrice' }
        }},
        { $sort: { _id: 1 } }
      ]),
      Expense.aggregate([
        { $match: { restaurantId: filter.restaurantId, ...(filter.branchId ? { branchId: filter.branchId } : {}), status: 'approved', expenseDate: { $gte: start } } },
        { $group: {
            _id:   { $dateToString: { format: '%Y-%m-%d', date: '$expenseDate', timezone: '+08:00' } },
            total: { $sum: '$amount' }
        }},
        { $sort: { _id: 1 } }
      ])
    ]);

    const revMap = {}, expMap = {};
    revenueRows.forEach(r => { revMap[r._id] = r.total; });
    expenseRows.forEach(r => { expMap[r._id] = r.total; });

    // Build combined daily profit
    const allKeys = new Set([...Object.keys(revMap), ...Object.keys(expMap)]);
    const daily = [...allKeys].sort().map(date => {
      const revenue  = revMap[date]  || 0;
      const expenses = expMap[date]  || 0;
      return { date, revenue, expenses, profit: revenue - expenses };
    });

    const totals = daily.reduce((acc, d) => ({
      revenue:  acc.revenue  + d.revenue,
      expenses: acc.expenses + d.expenses,
      profit:   acc.profit   + d.profit
    }), { revenue: 0, expenses: 0, profit: 0 });

    res.json({ daily, totals, margin: totals.revenue > 0 ? (totals.profit / totals.revenue * 100).toFixed(1) : 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/analytics/realtime ───────────────────────────────────────────────
// Live active orders across all branches (last 2 hours)
router.get('/realtime', auth, async (req, res) => {
  try {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const filter = branchFilter(req);

    const orders = await SyncedOrder.find({
      ...filter,
      status: { $in: ['paid','preparing','partially-ready','ready'] },
      paidAt: { $gte: twoHoursAgo }
    }).sort({ paidAt: -1 }).limit(100).lean();

    const statusCounts = orders.reduce((acc, o) => {
      acc[o.status] = (acc[o.status] || 0) + 1;
      return acc;
    }, {});

    res.json({
      orders,
      summary: statusCounts,
      activeCount: orders.length,
      asOf: new Date()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
