const express     = require('express');
const router      = express.Router();
const auth        = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const Expense     = require('../models/Expense');

// GET /api/expenses?branchId=&range=30&category=
router.get('/', auth, async (req, res) => {
  try {
    const days  = Math.min(365, parseInt(req.query.range || '30', 10));
    const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const filter = { restaurantId: req.user.restaurantId, expenseDate: { $gte: start } };
    if (req.query.branchId)  filter.branchId  = req.query.branchId;
    if (req.query.category)  filter.category  = req.query.category;
    if (req.query.status)    filter.status     = req.query.status;

    const page  = Math.max(1, parseInt(req.query.page  || '1',  10));
    const limit = Math.min(100, parseInt(req.query.limit || '50', 10));

    const [expenses, total] = await Promise.all([
      Expense.find(filter).sort({ expenseDate: -1 }).skip((page-1)*limit).limit(limit).populate('submittedBy', 'name email').lean(),
      Expense.countDocuments(filter)
    ]);

    // Category totals
    const catAgg = await Expense.aggregate([
      { $match: filter },
      { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } }
    ]);

    res.json({ expenses, total, page, pages: Math.ceil(total/limit), categoryBreakdown: catAgg });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/expenses
router.post('/', auth, requireRole('superadmin','owner','manager','cashier'), async (req, res) => {
  try {
    const { title, amount, category, description, branchId, expenseDate, isRecurring, recurringInterval } = req.body;
    if (!title || !amount || !category || !branchId) {
      return res.status(400).json({ error: 'title, amount, category, branchId required' });
    }
    const expense = await Expense.create({
      restaurantId: req.user.restaurantId,
      branchId,
      title, amount: parseFloat(amount), category,
      description: description || '',
      expenseDate: expenseDate ? new Date(expenseDate) : new Date(),
      isRecurring: !!isRecurring,
      recurringInterval: isRecurring ? recurringInterval : null,
      submittedBy: req.user._id,
      // Auto-approve for owner/manager; pending for staff
      status: ['owner','manager','superadmin'].includes(req.user.role) ? 'approved' : 'pending'
    });
    res.status(201).json({ expense });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/expenses/:id — update or approve
router.patch('/:id', auth, requireRole('superadmin','owner','manager'), async (req, res) => {
  try {
    const expense = await Expense.findOne({ _id: req.params.id, restaurantId: req.user.restaurantId });
    if (!expense) return res.status(404).json({ error: 'Not found' });

    ['title','amount','category','description','expenseDate','status'].forEach(f => {
      if (req.body[f] !== undefined) expense[f] = req.body[f];
    });
    if (req.body.status === 'approved') { expense.approvedBy = req.user._id; expense.approvedAt = new Date(); }
    await expense.save();
    res.json({ expense });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/expenses/:id
router.delete('/:id', auth, requireRole('superadmin','owner','manager'), async (req, res) => {
  try {
    await Expense.deleteOne({ _id: req.params.id, restaurantId: req.user.restaurantId });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
