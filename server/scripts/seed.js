/**
 * seed.js — creates superadmin + demo restaurant + branch with FIXED credentials
 * that match the POS .env. Re-runnable: upserts instead of skipping.
 *
 * Run: node server/scripts/seed.js
 */
require('dotenv').config();
const mongoose   = require('mongoose');
const User       = require('../models/User');
const Restaurant = require('../models/Restaurant');

// ── Hardcoded credentials that MUST match the POS .env ──────────────────────
const RESTAURANT_ID = 'rest_jonels_main';
const BRANCH_ID     = 'br_jonels_001';
const API_KEY       = 'rk_f26f12abeea143ae9ed152a0b989173c3ec060ff';
const API_SECRET    = 'whsec_14c24404c287dacd3f5bc1f153b8395ee5f3c9'; // PLAIN — used as HMAC key

async function seed() {
  await mongoose.connect(
    process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/grillsync_cloud'
  );
  console.log('[SEED] Connected to MongoDB');

  // ── Superadmin (idempotent) ────────────────────────────────────────────────
  let admin = await User.findOne({ role: 'superadmin' });
  if (!admin) {
    admin = await User.create({
      email:        'admin@grillsync.app',
      passwordHash: await User.hashPassword('Admin@1234'),
      name:         'GrillSync Admin',
      role:         'superadmin'
    });
    console.log('[SEED] Superadmin created: admin@grillsync.app / Admin@1234');
  } else {
    console.log('[SEED] Superadmin exists:', admin.email);
  }

  // ── Owner (idempotent) ─────────────────────────────────────────────────────
  let owner = await User.findOne({ email: 'owner@jonels.com' });
  if (!owner) {
    owner = await User.create({
      email:        'owner@jonels.com',
      passwordHash: await User.hashPassword('Owner@1234'),
      name:         "Jonel's Owner",
      role:         'owner',
      restaurantId: RESTAURANT_ID
    });
    console.log('[SEED] Owner created: owner@jonels.com / Owner@1234');
  } else {
    console.log('[SEED] Owner exists:', owner.email);
  }

  // ── Restaurant + branch (UPSERT so credentials always match POS env) ───────
  const branchDoc = {
    branchId:  BRANCH_ID,
    name:      'Main Branch',
    address:   '123 Rizal St., Silay City',
    city:      'Silay City',
    phone:     '(049) 000-0000',
    timezone:  'Asia/Manila',
    apiKey:    API_KEY,
    apiSecret: API_SECRET, // plain — posAuth uses this directly as HMAC key
    isActive:  true
  };

  let rest = await Restaurant.findOne({ restaurantId: RESTAURANT_ID });
  if (!rest) {
    rest = await Restaurant.create({
      restaurantId: RESTAURANT_ID,
      name:         "Jonel's Inasalan",
      plan:         'pro',
      branches:     [branchDoc],
      ownerIds:     [owner._id]
    });
    console.log('[SEED] Restaurant created:', RESTAURANT_ID);
  } else {
    // Force the branch credentials to match the POS .env on every run.
    const idx = rest.branches.findIndex(b => b.branchId === BRANCH_ID);
    if (idx === -1) {
      rest.branches.push(branchDoc);
    } else {
      Object.assign(rest.branches[idx], branchDoc);
    }
    if (!rest.ownerIds.some(id => id.equals(owner._id))) {
      rest.ownerIds.push(owner._id);
    }
    await rest.save();
    console.log('[SEED] Restaurant updated (branch creds refreshed):', RESTAURANT_ID);
  }

  console.log('\n[SEED] ┌─ POS .env values (must match) ─────────────────────┐');
  console.log(`[SEED] │ CLOUD_SYNC_URL=http://localhost:4000`);
  console.log(`[SEED] │ CLOUD_SYNC_API_KEY=${API_KEY}`);
  console.log(`[SEED] │ CLOUD_SYNC_SECRET=${API_SECRET}`);
  console.log(`[SEED] │ CLOUD_RESTAURANT_ID=${RESTAURANT_ID}`);
  console.log('[SEED] └─────────────────────────────────────────────────────┘\n');

  await mongoose.disconnect();
  console.log('[SEED] Done.');
}

seed().catch(err => { console.error('[SEED] Error:', err); process.exit(1); });
