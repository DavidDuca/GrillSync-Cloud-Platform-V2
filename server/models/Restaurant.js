/**
 * Restaurant.js — top-level tenant.
 * One restaurant org can have multiple branches.
 * The POS at each branch identifies itself via apiKey + restaurantId.
 */
const mongoose = require('mongoose');
const crypto   = require('crypto');

const BranchSchema = new mongoose.Schema({
  branchId:    { type: String, required: true, unique: true },
  name:        { type: String, required: true },
  address:     { type: String, default: '' },
  city:        { type: String, default: '' },
  phone:       { type: String, default: '' },
  timezone:    { type: String, default: 'Asia/Manila' },
  // API credentials for POS sync
  apiKey:      { type: String, required: true, unique: true, index: true },
  apiSecret:   { type: String, required: true }, // HMAC secret, stored hashed
  isActive:    { type: Boolean, default: true },
  lastSyncAt:  { type: Date },
  syncStatus:  { type: String, enum: ['online','offline','never'], default: 'never' },
  createdAt:   { type: Date, default: Date.now }
}, { _id: false });

const RestaurantSchema = new mongoose.Schema({
  restaurantId: { type: String, required: true, unique: true, index: true },
  name:         { type: String, required: true },
  logo:         { type: String, default: null },
  plan:         { type: String, enum: ['trial','basic','pro','enterprise'], default: 'trial' },
  isActive:     { type: Boolean, default: true },
  branches:     { type: [BranchSchema], default: [] },
  // Owner user ids
  ownerIds:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  createdAt:    { type: Date, default: Date.now },
  updatedAt:    { type: Date, default: Date.now }
});

RestaurantSchema.pre('save', function (next) { this.updatedAt = new Date(); next(); });

/**
 * Generate a new API key + secret pair for a branch.
 * Returns { apiKey, plainSecret } — store plainSecret in .env on the POS,
 * only the hash goes in the database.
 */
RestaurantSchema.statics.generateBranchCredentials = function () {
  const apiKey      = 'rk_' + crypto.randomBytes(20).toString('hex');
  const plainSecret = 'whsec_' + crypto.randomBytes(32).toString('hex');
  const apiSecret   = crypto.createHash('sha256').update(plainSecret).digest('hex');
  return { apiKey, plainSecret, apiSecret };
};

/**
 * Find a branch by its apiKey across all restaurants.
 */
RestaurantSchema.statics.findBranchByApiKey = async function (apiKey) {
  const restaurant = await this.findOne({ 'branches.apiKey': apiKey, isActive: true });
  if (!restaurant) return null;
  const branch = restaurant.branches.find(b => b.apiKey === apiKey && b.isActive);
  if (!branch) return null;
  return { restaurant, branch };
};

module.exports = mongoose.model('Restaurant', RestaurantSchema);
