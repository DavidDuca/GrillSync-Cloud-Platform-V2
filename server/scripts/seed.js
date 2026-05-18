/**
 * seed.js — creates initial superadmin + demo restaurant + branch credentials
 * Run once: node server/scripts/seed.js
 */
require('dotenv').config();
const mongoose   = require('mongoose');
const User       = require('../models/User');
const Restaurant = require('../models/Restaurant');

async function seed() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/grillsync_cloud');
  console.log('[SEED] Connected to MongoDB');

  // ── Superadmin ──────────────────────────────────────────────────────────────
  let admin = await User.findOne({ role: 'superadmin' });
  if (!admin) {
    const passwordHash = await User.hashPassword('Admin@1234');
    admin = await User.create({
      email: 'admin@grillsync.app',
      passwordHash,
      name: 'GrillSync Admin',
      role: 'superadmin'
    });
    console.log('[SEED] Superadmin created: admin@grillsync.app / Admin@1234');
  } else {
    console.log('[SEED] Superadmin already exists:', admin.email);
  }

  // ── Demo restaurant ─────────────────────────────────────────────────────────
  let rest = await Restaurant.findOne({ restaurantId: 'rest_jonels_main' });
  if (!rest) {
    const branchId = 'br_jonels_001';
    const creds    = Restaurant.generateBranchCredentials();

    rest = await Restaurant.create({
      restaurantId: 'rest_jonels_main',
      name: "Jonel's Inasalan",
      plan: 'pro',
      branches: [{
        branchId,
        name:      'Main Branch',
        address:   '123 Rizal St., Calamba City',
        city:      'Calamba',
        phone:     '(049) 000-0000',
        apiKey:    creds.apiKey,
        apiSecret: creds.apiSecret
      }]
    });

    const ownerHash = await User.hashPassword('Owner@1234');
    const owner = await User.create({
      email: 'owner@jonels.com',
      passwordHash: ownerHash,
      name: "Jonel's Owner",
      role: 'owner',
      restaurantId: 'rest_jonels_main'
    });
    rest.ownerIds.push(owner._id);
    await rest.save();

    console.log('\n[SEED] Restaurant created: rest_jonels_main');
    console.log('[SEED] Owner login:  owner@jonels.com / Owner@1234');
    console.log('\n[SEED] ┌─────────────────────────────────────────────────────────────┐');
    console.log('[SEED] │  POS .env configuration (copy to your POS server .env)       │');
    console.log('[SEED] ├─────────────────────────────────────────────────────────────┤');
    console.log(`[SEED] │  CLOUD_SYNC_URL=http://your-cloud-server:4000              │`);
    console.log(`[SEED] │  CLOUD_SYNC_API_KEY=${creds.apiKey.padEnd(40)}│`);
    console.log(`[SEED] │  CLOUD_SYNC_SECRET=${creds.plainSecret.slice(0,44).padEnd(42)}│`);
    console.log(`[SEED] │  CLOUD_RESTAURANT_ID=rest_jonels_main                      │`);
    console.log('[SEED] └─────────────────────────────────────────────────────────────┘\n');
  } else {
    console.log('[SEED] Demo restaurant already exists:', rest.name);
  }

  await mongoose.disconnect();
  console.log('[SEED] Done.');
}

seed().catch(err => { console.error('[SEED] Error:', err); process.exit(1); });
