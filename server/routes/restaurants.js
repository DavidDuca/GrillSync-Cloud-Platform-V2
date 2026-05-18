/**
 * restaurants.js — restaurant + branch CRUD for cloud platform.
 */
const express      = require('express');
const router       = express.Router();
const { v4: uuid } = require('uuid');
const fs           = require('fs');
const path         = require('path');
const auth         = require('../middleware/auth');
const requireRole  = require('../middleware/requireRole');
const Restaurant   = require('../models/Restaurant');
const User         = require('../models/User');

// Sync-script template is read once at cold-start.
let _SYNC_TEMPLATE = null;
function syncTemplate() {
  if (_SYNC_TEMPLATE) return _SYNC_TEMPLATE;
  const p = path.join(__dirname, '..', '..', 'lib', 'sync-script-template.js');
  _SYNC_TEMPLATE = fs.readFileSync(p, 'utf8');
  return _SYNC_TEMPLATE;
}

function renderSyncScript({ cloudUrl, branchId, branchName, restaurantId, apiKey, apiSecret }) {
  return syncTemplate()
    .replaceAll('{{CLOUD_URL}}',     cloudUrl)
    .replaceAll('{{BRANCH_ID}}',     branchId)
    .replaceAll('{{BRANCH_NAME}}',   branchName)
    .replaceAll('{{RESTAURANT_ID}}', restaurantId)
    .replaceAll('{{API_KEY}}',       apiKey)
    .replaceAll('{{API_SECRET}}',    apiSecret)
    .replaceAll('{{GENERATED_AT}}',  new Date().toISOString());
}

function cloudUrlFromReq(req) {
  // Honour Vercel's forwarded proto/host; fall back to PUBLIC_BASE_URL env.
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host  = req.headers['x-forwarded-host']  || req.headers.host;
  return `${proto}://${host}`;
}


// GET /api/restaurants — list (superadmin sees all; owner sees own)
router.get('/', auth, async (req, res) => {
  try {
    const filter = req.user.role === 'superadmin' ? {} : { restaurantId: req.user.restaurantId };
    const list   = await Restaurant.find(filter).sort({ createdAt: -1 });
    res.json({ restaurants: list });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/restaurants — create new restaurant + owner account
router.post('/', auth, requireRole('superadmin', 'owner'), async (req, res) => {
  try {
    const { name, ownerEmail, ownerName, ownerPassword, firstBranchName, firstBranchAddress } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });

    const restaurantId = 'rest_' + uuid().replace(/-/g, '').slice(0, 16);

    // Create first branch with credentials
    const branchId = 'br_' + uuid().replace(/-/g, '').slice(0, 12);
    const creds    = Restaurant.generateBranchCredentials();
    const branch   = {
      branchId,
      name:      firstBranchName || `${name} - Main`,
      address:   firstBranchAddress || '',
      apiKey:    creds.apiKey,
      apiSecret: creds.apiSecret
    };

    const restaurant = await Restaurant.create({ restaurantId, name, branches: [branch] });

    // Create owner user if credentials provided
    let owner = null;
    if (ownerEmail && ownerPassword) {
      const passwordHash = await User.hashPassword(ownerPassword);
      owner = await User.create({
        email: ownerEmail,
        passwordHash,
        name:  ownerName || 'Owner',
        role:  'owner',
        restaurantId
      });
      restaurant.ownerIds.push(owner._id);
      await restaurant.save();
    }

    res.status(201).json({
      restaurant,
      // Return plain secret ONCE — store in POS .env
      branchCredentials: {
        branchId,
        apiKey:       creds.apiKey,
        apiSecret:    creds.plainSecret,  // <-- plain secret, shown once
        restaurantId
      },
      owner: owner ? owner.toPublic() : null
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/restaurants/:restaurantId — get single restaurant
router.get('/:restaurantId', auth, async (req, res) => {
  try {
    if (req.user.role !== 'superadmin' && req.user.restaurantId !== req.params.restaurantId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const r = await Restaurant.findOne({ restaurantId: req.params.restaurantId });
    if (!r) return res.status(404).json({ error: 'Not found' });
    res.json({ restaurant: r });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/restaurants/:restaurantId/branches — add branch
router.post('/:restaurantId/branches', auth, requireRole('superadmin', 'owner', 'manager'), async (req, res) => {
  try {
    if (req.user.role !== 'superadmin' && req.user.restaurantId !== req.params.restaurantId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const r = await Restaurant.findOne({ restaurantId: req.params.restaurantId });
    if (!r) return res.status(404).json({ error: 'Restaurant not found' });

    const { name, address, city, phone } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });

    const branchId = 'br_' + uuid().replace(/-/g, '').slice(0, 12);
    const creds    = Restaurant.generateBranchCredentials();

    r.branches.push({ branchId, name, address, city, phone, apiKey: creds.apiKey, apiSecret: creds.apiSecret });
    await r.save();

    const cloudUrl = cloudUrlFromReq(req);
    const syncScript = renderSyncScript({
      cloudUrl,
      branchId,
      branchName:   name,
      restaurantId: req.params.restaurantId,
      apiKey:       creds.apiKey,
      apiSecret:    creds.plainSecret,
    });

    res.status(201).json({
      branch: r.branches[r.branches.length - 1],
      branchCredentials: {
        branchId,
        apiKey:       creds.apiKey,
        apiSecret:    creds.plainSecret,
        restaurantId: req.params.restaurantId,
        cloudUrl,
        syncEndpoint: `${cloudUrl}/api/sync/branch-upload`,
      },
      // Self-contained POS worker — paste into local POS server.
      syncScript,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/restaurants/:restaurantId/branches/:branchId/sync-script
//   Re-download the sync worker. apiSecret is NOT included (we don't store it
//   in plaintext). Caller must use rotate-keys first if the secret was lost.
router.get('/:restaurantId/branches/:branchId/sync-script.js', auth, requireRole('superadmin','owner','manager'), async (req, res) => {
  try {
    const r = await Restaurant.findOne({ restaurantId: req.params.restaurantId });
    if (!r) return res.status(404).json({ error: 'Not found' });
    const b = r.branches.find(x => x.branchId === req.params.branchId);
    if (!b) return res.status(404).json({ error: 'Branch not found' });

    const cloudUrl = cloudUrlFromReq(req);
    const script = renderSyncScript({
      cloudUrl,
      branchId:     b.branchId,
      branchName:   b.name,
      restaurantId: r.restaurantId,
      apiKey:       b.apiKey,
      apiSecret:    'PASTE_SECRET_HERE — the plain secret is only shown once. Use POST /branches/:id/rotate-keys to regenerate.',
    });
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Content-Disposition',
      `attachment; filename="grillsync-sync-${b.branchId}.js"`);
    res.send(script);
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// PATCH /api/restaurants/:restaurantId/branches/:branchId — update branch
router.patch('/:restaurantId/branches/:branchId', auth, requireRole('superadmin','owner','manager'), async (req, res) => {
  try {
    const r = await Restaurant.findOne({ restaurantId: req.params.restaurantId });
    if (!r) return res.status(404).json({ error: 'Not found' });
    const b = r.branches.find(x => x.branchId === req.params.branchId);
    if (!b) return res.status(404).json({ error: 'Branch not found' });

    ['name','address','city','phone','isActive'].forEach(f => { if (req.body[f] !== undefined) b[f] = req.body[f]; });
    await r.save();
    res.json({ branch: b });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/restaurants/:restaurantId/branches/:branchId/rotate-keys — regenerate API credentials
router.post('/:restaurantId/branches/:branchId/rotate-keys', auth, requireRole('superadmin','owner'), async (req, res) => {
  try {
    const r = await Restaurant.findOne({ restaurantId: req.params.restaurantId });
    if (!r) return res.status(404).json({ error: 'Not found' });
    const b = r.branches.find(x => x.branchId === req.params.branchId);
    if (!b) return res.status(404).json({ error: 'Branch not found' });

    const creds = Restaurant.generateBranchCredentials();
    b.apiKey    = creds.apiKey;
    b.apiSecret = creds.apiSecret;
    await r.save();

    const cloudUrl = cloudUrlFromReq(req);
    res.json({
      message: 'Keys rotated. Update your POS .env immediately.',
      branchCredentials: {
        branchId:     b.branchId,
        apiKey:       creds.apiKey,
        apiSecret:    creds.plainSecret,
        restaurantId: req.params.restaurantId,
        cloudUrl,
        syncEndpoint: `${cloudUrl}/api/sync/branch-upload`,
      },
      syncScript: renderSyncScript({
        cloudUrl,
        branchId:     b.branchId,
        branchName:   b.name,
        restaurantId: r.restaurantId,
        apiKey:       creds.apiKey,
        apiSecret:    creds.plainSecret,
      }),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/restaurants/:restaurantId/users — list users for this restaurant
router.get('/:restaurantId/users', auth, requireRole('superadmin','owner','manager'), async (req, res) => {
  try {
    if (req.user.role !== 'superadmin' && req.user.restaurantId !== req.params.restaurantId)
      return res.status(403).json({ error: 'Access denied' });
    const users = await User.find({ restaurantId: req.params.restaurantId }).select('-passwordHash');
    res.json({ users: users.map(u => u.toPublic()) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/restaurants/:restaurantId/users — invite user
router.post('/:restaurantId/users', auth, requireRole('superadmin','owner','manager'), async (req, res) => {
  try {
    const { email, password, name, role, branchId } = req.body;
    if (!email || !password || !name) return res.status(400).json({ error: 'email, password, name required' });
    if (await User.findOne({ email })) return res.status(409).json({ error: 'Email taken' });
    const passwordHash = await User.hashPassword(password);
    const user = await User.create({ email, passwordHash, name, role: role || 'staff', restaurantId: req.params.restaurantId, branchId: branchId || null });
    res.status(201).json({ user: user.toPublic() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
