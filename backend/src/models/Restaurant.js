const mongoose = require('mongoose');

const BranchSchema = new mongoose.Schema({
  branchId:   { type: String, required: true, unique: true, index: true },
  name:       { type: String, required: true },
  address:    { type: String, default: '' },
  city:       { type: String, default: '' },
  phone:      { type: String, default: '' },
  apiKey:     { type: String, required: true, index: true },
  apiSecret:  { type: String, required: true }, // sha256(plainSecret)
  isActive:   { type: Boolean, default: true },
  lastSyncAt: { type: Date, default: null },
  syncStatus: { type: String, enum: ['online', 'offline', 'never'], default: 'never' },
}, { _id: false, timestamps: true });

const RestaurantSchema = new mongoose.Schema({
  restaurantId: { type: String, required: true, unique: true, index: true },
  name:         { type: String, required: true },
  plan:         { type: String, enum: ['trial', 'basic', 'pro', 'enterprise'], default: 'trial' },
  isActive:     { type: Boolean, default: true },
  ownerIds:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  branches:     [BranchSchema],
}, { timestamps: true });

module.exports = mongoose.models.Restaurant || mongoose.model('Restaurant', RestaurantSchema);
