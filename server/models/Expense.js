/**
 * Expense.js — restaurant expense tracking.
 */
const mongoose = require('mongoose');

const ExpenseSchema = new mongoose.Schema({
  restaurantId: { type: String, required: true, index: true },
  branchId:     { type: String, required: true, index: true },

  title:        { type: String, required: true },
  amount:       { type: Number, required: true, min: 0 },
  category: {
    type: String,
    enum: ['ingredients','utilities','salaries','maintenance','supplies','delivery','miscellaneous'],
    required: true
  },
  description:  { type: String, default: '' },
  receiptUrl:   { type: String, default: null },

  // Recurring support
  isRecurring:  { type: Boolean, default: false },
  recurringInterval: { type: String, enum: ['daily','weekly','monthly','yearly'], default: null },

  // Approval workflow
  status:       { type: String, enum: ['pending','approved','rejected'], default: 'approved' },
  submittedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approvedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  approvedAt:   { type: Date, default: null },

  expenseDate:  { type: Date, required: true, index: true },
  createdAt:    { type: Date, default: Date.now },
  updatedAt:    { type: Date, default: Date.now }
});

ExpenseSchema.pre('save', function (next) { this.updatedAt = new Date(); next(); });
ExpenseSchema.index({ restaurantId: 1, expenseDate: -1 });
ExpenseSchema.index({ branchId: 1, expenseDate: -1 });

module.exports = mongoose.model('Expense', ExpenseSchema);
