const express = require('express');
const bcrypt = require('bcryptjs');
const Restaurant = require('../models/Restaurant');
const User = require('../models/User');
const { authRequired, requireRole } = require('../middleware/auth');
const {
  genApiKey, genPlainSecret, hashSecret,
  genRestaurantId, genBranchId,
} = require('../utils/crypto');
const { renderSyncScript } = require('../services/syncScript');

const router = express.Router();

function publicBase(req) {
  return (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
}

function makeBranchCreds(req, { restaurantId, branchId, apiKey, plainSecret }) {
  const base = publicBase(req);
  const syncEndpoint = `${base}/sync/batch`;
  const syncScript = renderSyncScript({
    restaurantId, branchId, apiKey, plainSecret, syncEndpoint, publicBaseUrl: base,
  });
  return {
    branchCredentials: {
      restaurantId, branchId, apiKey, apiSecret: plainSecret, syncEndpoint, publicBaseUrl: base,
    },
    syncScript,
  };
}

// List restaurants (scoped)
router.get('/', authRequired, async (req, res) => {
  const q = req.user.role === 'superadmin' ? {} : { restaurantId: req.user.restaurantId };
  const list = await Restaurant.find(q).sort({ createdAt: -1 }).lean();
  // strip apiSecret hashes from output
  for (const r of list) for (const b of (r.branches || [])) delete b.apiSecret;
  res.json({ restaurants: list });
});

// Create restaurant (+ first branch, + optional owner account)
router.post('/', authRequired, requireRole('superadmin', 'owner'), async (req, res) => {
  const { name, branchName, branchAddress, branchCity, branchPhone, ownerEmail, ownerPassword, ownerName, plan } = req.body || {};
  if (!name || !branchName) return res.status(400).json({ error: 'name and branchName required' });

  const restaurantId = genRestaurantId();
  const branchId     = genBranchId();
  const apiKey       = genApiKey();
  const plainSecret  = genPlainSecret();
  const apiSecret    = hashSecret(plainSecret);

  const ownerIds = [];
  if (ownerEmail && ownerPassword) {
    const passwordHash = await bcrypt.hash(ownerPassword, 10);
    const owner = await User.create({
      email: ownerEmail.toLowerCase().trim(),
      passwordHash,
      name: ownerName || ownerEmail,
      role: 'owner',
      restaurantId,
    });
    ownerIds.push(owner._id);
  } else if (req.user.role === 'owner') {
    ownerIds.push(req.user._id);
  }

  const rest = await Restaurant.create({
    restaurantId,
    name,
    plan: plan || 'trial',
    ownerIds,
    branches: [{
      branchId, name: branchName,
      address: branchAddress || '', city: branchCity || '', phone: branchPhone || '',
      apiKey, apiSecret, isActive: true, syncStatus: 'never',
    }],
  });

  const creds = makeBranchCreds(req, { restaurantId, branchId, apiKey, plainSecret });
  res.status(201).json({ restaurant: { ...rest.toObject(), branches: rest.branches.map(b => ({ ...b.toObject(), apiSecret: undefined })) }, ...creds });
});

// Add branch
router.post('/:restaurantId/branches', authRequired, requireRole('superadmin', 'owner'), async (req, res) => {
  const { restaurantId } = req.params;
  if (req.user.role !== 'superadmin' && req.user.restaurantId !== restaurantId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const rest = await Restaurant.findOne({ restaurantId });
  if (!rest) return res.status(404).json({ error: 'Restaurant not found' });

  const { name, address, city, phone } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });

  const branchId    = genBranchId();
  const apiKey      = genApiKey();
  const plainSecret = genPlainSecret();
  const apiSecret   = hashSecret(plainSecret);

  rest.branches.push({
    branchId, name, address: address || '', city: city || '', phone: phone || '',
    apiKey, apiSecret, isActive: true, syncStatus: 'never',
  });
  await rest.save();

  const creds = makeBranchCreds(req, { restaurantId, branchId, apiKey, plainSecret });
  res.status(201).json({ ok: true, ...creds });
});

// Rotate keys
router.post('/:restaurantId/branches/:branchId/rotate-keys', authRequired, requireRole('superadmin', 'owner'), async (req, res) => {
  const { restaurantId, branchId } = req.params;
  if (req.user.role !== 'superadmin' && req.user.restaurantId !== restaurantId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const rest = await Restaurant.findOne({ restaurantId });
  if (!rest) return res.status(404).json({ error: 'Restaurant not found' });
  const branch = rest.branches.find(b => b.branchId === branchId);
  if (!branch) return res.status(404).json({ error: 'Branch not found' });

  const apiKey      = genApiKey();
  const plainSecret = genPlainSecret();
  branch.apiKey    = apiKey;
  branch.apiSecret = hashSecret(plainSecret);
  await rest.save();

  const creds = makeBranchCreds(req, { restaurantId, branchId, apiKey, plainSecret });
  res.json({ ok: true, ...creds });
});

// Download sync script (secret is placeholder — full plaintext only available at create/rotate)
router.get('/:restaurantId/branches/:branchId/sync-script.js', authRequired, async (req, res) => {
  const { restaurantId, branchId } = req.params;
  if (req.user.role !== 'superadmin' && req.user.restaurantId !== restaurantId) {
    return res.status(403).send('// Forbidden');
  }
  const rest = await Restaurant.findOne({ restaurantId });
  if (!rest) return res.status(404).send('// Restaurant not found');
  const branch = rest.branches.find(b => b.branchId === branchId);
  if (!branch) return res.status(404).send('// Branch not found');

  const script = renderSyncScript({
    restaurantId, branchId,
    apiKey: branch.apiKey,
    plainSecret: 'REPLACE_WITH_PLAIN_SECRET_FROM_ROTATE_KEYS',
    syncEndpoint: `${publicBase(req)}/sync/batch`,
    publicBaseUrl: publicBase(req),
  });
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="grillsync-sync-${branchId}.js"`);
  res.send(script);
});

module.exports = router;
