const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
  restaurantId: { type: String, required: true, index: true },
  branchId:     { type: String, default: null },
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  type: {
    type: String,
    enum: ['low_sales','branch_offline','sync_failed','unusual_expense','branch_online','system'],
    required: true
  },
  title:    { type: String, required: true },
  message:  { type: String, required: true },
  severity: { type: String, enum: ['info','warning','error'], default: 'info' },
  isRead:   { type: Boolean, default: false, index: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt:{ type: Date, default: Date.now, index: true }
});

NotificationSchema.index({ restaurantId: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', NotificationSchema);
