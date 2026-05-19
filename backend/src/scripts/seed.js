require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Restaurant = require('../models/Restaurant');
const {
  genApiKey, genPlainSecret, hashSecret,
  genRestaurantId, genBranchId,
} = require('../utils/crypto');

async function ensureSeed() {
  const existing = await User.findOne({ email: 'admin@grillsync.app' });
  if (existing) return { skipped: true };

  const passwordHash = await bcrypt.hash('Admin@1234', 10);
  const admin = await User.create({
    email: 'admin@grillsync.app',
    passwordHash,
    name: 'Super Admin',
    role: 'superadmin',
  });

  // Demo restaurant + branch
  const restaurantId = genRestaurantId();
  const branchId     = genBranchId();
  const apiKey       = genApiKey();
  const plainSecret  = genPlainSecret();
  const apiSecret    = hashSecret(plainSecret);

  await Restaurant.create({
    restaurantId,
    name: 'Demo Restaurant',
    plan: 'trial',
    branches: [{
      branchId, name: 'Main Branch', address: '', city: '', phone: '',
      apiKey, apiSecret, isActive: true, syncStatus: 'never',
    }],
  });

  console.log('========================================');
  console.log('[seed] Superadmin created');
  console.log('  email:    admin@grillsync.app');
  console.log('  password: Admin@1234');
  console.log('[seed] Demo branch credentials (save these — apiSecret will not be shown again):');
  console.log('  restaurantId:', restaurantId);
  console.log('  branchId:    ', branchId);
  console.log('  apiKey:      ', apiKey);
  console.log('  apiSecret:   ', plainSecret);
  console.log('========================================');
  return { created: true, admin: admin.email };
}

module.exports = { ensureSeed };

if (require.main === module) {
  (async () => {
    await mongoose.connect(process.env.MONGO_URI);
    await ensureSeed();
    await mongoose.disconnect();
  })().catch(e => { console.error(e); process.exit(1); });
}
