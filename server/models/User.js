/**
 * User.js — cloud platform user.
 * Roles: owner | manager | cashier | staff | superadmin
 */
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  email:        { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  name:         { type: String, required: true },
  role:         {
    type: String,
    enum: ['superadmin', 'owner', 'manager', 'cashier', 'staff'],
    default: 'staff'
  },
  // Which restaurant(s) this user belongs to
  restaurantId: { type: String, index: true },
  // Optional branch restriction (null = all branches)
  branchId:     { type: String, default: null },
  isActive:     { type: Boolean, default: true },
  lastLoginAt:  { type: Date },
  createdAt:    { type: Date, default: Date.now },
  updatedAt:    { type: Date, default: Date.now }
});

UserSchema.pre('save', async function (next) {
  this.updatedAt = new Date();
  if (!this.isModified('passwordHash')) return next();
  next();
});

UserSchema.statics.hashPassword = async function (plain) {
  return bcrypt.hash(plain, 12);
};

UserSchema.methods.verifyPassword = async function (plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

UserSchema.methods.toPublic = function () {
  return {
    id:           this._id,
    email:        this.email,
    name:         this.name,
    role:         this.role,
    restaurantId: this.restaurantId,
    branchId:     this.branchId,
    lastLoginAt:  this.lastLoginAt,
    createdAt:    this.createdAt
  };
};

module.exports = mongoose.model('User', UserSchema);
