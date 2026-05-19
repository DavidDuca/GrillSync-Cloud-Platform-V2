const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  email:        { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  name:         { type: String, required: true },
  role:         { type: String, enum: ['superadmin', 'owner', 'manager', 'staff'], default: 'staff' },
  restaurantId: { type: String, default: null }, // null for superadmin
  branchId:     { type: String, default: null }, // optional for manager/staff
}, { timestamps: true });

module.exports = mongoose.models.User || mongoose.model('User', UserSchema);
