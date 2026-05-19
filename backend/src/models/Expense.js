const mongoose = require('mongoose');

const ExpenseSchema = new mongoose.Schema({
  restaurantId: { type: String, required: true, index: true },
  branchId:     { type: String, default: null, index: true },
  description:  { type: String, required: true },
  amount:       { type: Number, required: true },
  category:     { type: String, default: 'general' },
  expenseDate:  { type: Date, default: Date.now },
  status:       { type: String, enum: ['pending', 'approved', 'rejected'], default: 'approved' },
  createdBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.models.Expense || mongoose.model('Expense', ExpenseSchema);
