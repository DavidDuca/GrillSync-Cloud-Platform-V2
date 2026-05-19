const mongoose = require('mongoose');

const ItemSchema = new mongoose.Schema({
  itemId:      String,
  name:        String,
  category:    String,
  cookingArea: String,
  basePrice:   Number,
  quantity:    Number,
  addOns:      [{ name: String, price: Number }],
  lineTotal:   Number,
}, { _id: false });

const SyncedOrderSchema = new mongoose.Schema({
  restaurantId: { type: String, required: true, index: true },
  branchId:     { type: String, required: true, index: true },
  orderId:      { type: String, required: true },
  customerNo:   Number,
  items:        [ItemSchema],
  totalPrice:   Number,
  cashReceived: Number,
  changeDue:    Number,
  status:       String,
  stations:     mongoose.Schema.Types.Mixed,
  placedAt:     Date,
  paidAt:       Date,
  readyAt:      Date,
  completedAt:  Date,
  updatedAt:    Date,
  syncQueueId:  String,
}, { timestamps: true });

SyncedOrderSchema.index({ branchId: 1, orderId: 1 }, { unique: true });
SyncedOrderSchema.index({ restaurantId: 1, placedAt: -1 });

module.exports = mongoose.models.SyncedOrder || mongoose.model('SyncedOrder', SyncedOrderSchema);
