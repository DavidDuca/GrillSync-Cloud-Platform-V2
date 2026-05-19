const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
  restaurantId: { type: String, required: true, index: true },
  branchId:     { type: String, default: null },
  title:        { type: String, required: true },
  message:      { type: String, default: '' },
  severity:     { type: String, enum: ['info', 'warning', 'error'], default: 'info' },
  isRead:       { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.models.Notification || mongoose.model('Notification', NotificationSchema);
