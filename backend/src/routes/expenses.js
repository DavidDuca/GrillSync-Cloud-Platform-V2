const express = require('express');
const Expense = require('../models/Expense');
const { authRequired, scopeFilter } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired);

router.get('/', async (req, res) => {
  const filter = scopeFilter(req.user);
  if (req.query.branchId) filter.branchId = req.query.branchId;
  const items = await Expense.find(filter).sort({ expenseDate: -1 }).lean();
  res.json({ expenses: items });
});

router.post('/', async (req, res) => {
  if (req.user.role === 'staff') return res.status(403).json({ error: 'Forbidden' });
  const { description, amount, category, expenseDate, branchId } = req.body || {};
  if (!description || amount == null) return res.status(400).json({ error: 'description and amount required' });

  const restaurantId = req.user.role === 'superadmin'
    ? (req.body.restaurantId || null)
    : req.user.restaurantId;
  if (!restaurantId) return res.status(400).json({ error: 'restaurantId required' });

  const created = await Expense.create({
    restaurantId,
    branchId: branchId || req.user.branchId || null,
    description,
    amount: Number(amount),
    category: category || 'general',
    expenseDate: expenseDate ? new Date(expenseDate) : new Date(),
    createdBy: req.user._id,
  });
  res.status(201).json({ expense: created });
});

router.patch('/:id', async (req, res) => {
  if (req.user.role === 'staff') return res.status(403).json({ error: 'Forbidden' });
  const filter = scopeFilter(req.user, { _id: req.params.id });
  const update = {};
  for (const k of ['description', 'amount', 'category', 'expenseDate', 'status', 'branchId']) {
    if (req.body[k] !== undefined) update[k] = req.body[k];
  }
  if (update.amount !== undefined) update.amount = Number(update.amount);
  if (update.expenseDate) update.expenseDate = new Date(update.expenseDate);
  const updated = await Expense.findOneAndUpdate(filter, update, { new: true });
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.json({ expense: updated });
});

router.delete('/:id', async (req, res) => {
  if (req.user.role === 'staff') return res.status(403).json({ error: 'Forbidden' });
  const filter = scopeFilter(req.user, { _id: req.params.id });
  const deleted = await Expense.findOneAndDelete(filter);
  if (!deleted) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

module.exports = router;
