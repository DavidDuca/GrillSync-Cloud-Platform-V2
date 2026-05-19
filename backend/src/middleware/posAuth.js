const Restaurant = require('../models/Restaurant');
const { signPayload, timingSafeEqualHex } = require('../utils/crypto');

const MAX_SKEW_MS = 5 * 60 * 1000;

async function posAuth(req, res, next) {
  try {
    const apiKey       = req.headers['x-api-key'];
    const restaurantId = req.headers['x-restaurant-id'];
    const timestamp    = req.headers['x-timestamp'];
    const signature    = req.headers['x-signature'];

    if (!apiKey || !restaurantId || !timestamp || !signature) {
      return res.status(401).json({ error: 'Missing auth headers' });
    }

    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_SKEW_MS) {
      return res.status(401).json({ error: 'Stale or invalid timestamp' });
    }

    const rest = await Restaurant.findOne({ restaurantId, 'branches.apiKey': apiKey });
    if (!rest) return res.status(401).json({ error: 'Unknown api key' });

    const branch = rest.branches.find(b => b.apiKey === apiKey);
    if (!branch || !branch.isActive) return res.status(401).json({ error: 'Branch inactive' });

    const rawBody = req.rawBody ?? '';
    const expected = signPayload(branch.apiSecret, timestamp, rawBody);

    if (!timingSafeEqualHex(expected, String(signature))) {
      return res.status(401).json({ error: 'Bad signature' });
    }

    req.restaurant = rest;
    req.branch     = branch;
    next();
  } catch (e) {
    console.error('[posAuth]', e);
    res.status(500).json({ error: 'Auth error' });
  }
}

module.exports = { posAuth };
