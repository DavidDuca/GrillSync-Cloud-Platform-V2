/**
 * SyncedOrder.js — cloud copy of a POS order.
 *
 * The schema mirrors the POS Order model exactly so payloads from
 * syncService.enqueueOrder() can be inserted without transformation.
 * Extra fields (restaurantId, branchId) are added at ingest time.
 *
 * This is intentionally denormalized: analytics queries should not need
 * to join other collections. All relevant data lives here.
 */
const mongoose = require('mongoose');

const AddOnSchema = new mongoose.Schema({
  name:  String,
  price: Number
}, { _id: false });

const OrderItemSchema = new mongoose.Schema({
  itemId:      String,
  name:        String,
  category:    String,
  cookingArea: String,
  basePrice:   Number,
  quantity:    Number,
  addOns:      [AddOnSchema],
  lineTotal:   Number
}, { _id: false });

const StationStateSchema = new mongoose.Schema({
  status:      String,
  startedAt:   Date,
  readyAt:     Date,
  completedAt: Date,
  updatedAt:   Date
}, { _id: false });

const SyncedOrderSchema = new mongoose.Schema({
  // ── Tenant routing ────────────────────────────────────────────────────────
  restaurantId: { type: String, required: true, index: true },
  branchId:     { type: String, required: true, index: true },

  // ── POS fields (verbatim from POS payload) ────────────────────────────────
  orderId:     { type: String, required: true },
  customerNo:  Number,
  items:       [OrderItemSchema],
  totalPrice:  Number,
  cashReceived:Number,
  changeDue:   Number,
  paymentMethod:{ type: String, default: 'cash' },
  status:      {
    type: String,
    enum: ['pending','paid','preparing','partially-ready','ready','completed','cancelled'],
    default: 'pending',
    index: true
  },
  stations:    { type: Map, of: StationStateSchema },

  placedAt:    { type: Date, index: true },
  paidAt:      { type: Date, index: true },
  readyAt:     Date,
  completedAt: Date,
  updatedAt:   Date,

  // ── Cloud metadata ─────────────────────────────────────────────────────────
  receivedAt:  { type: Date, default: Date.now },
  // Local queue id from the POS (for dedup / idempotency)
  syncQueueId: { type: String }
});

// Compound unique: one cloud record per (branch, orderId)
SyncedOrderSchema.index({ branchId: 1, orderId: 1 }, { unique: true });
// Analytics query patterns
SyncedOrderSchema.index({ restaurantId: 1, paidAt: -1 });
SyncedOrderSchema.index({ branchId: 1, paidAt: -1 });
SyncedOrderSchema.index({ restaurantId: 1, status: 1, paidAt: -1 });

module.exports = mongoose.model('SyncedOrder', SyncedOrderSchema);
