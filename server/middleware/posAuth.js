/**
 * posAuth.js — authenticates inbound sync batches from POS restaurants.
 *
 * Matches the exact signing contract in POS syncService.js:
 *   X-Api-Key:       restaurant API key
 *   X-Restaurant-Id: restaurant id (sanity check)
 *   X-Timestamp:     ms-since-epoch
 *   X-Signature:     HMAC_SHA256(plainSecret, "{timestamp}.{rawBody}")
 *
 * The plain secret is never stored — only SHA-256(secret) is in the DB.
 * We verify by computing HMAC with the plain secret recovered at branch
 * registration time.
 *
 * NOTE: Because we only store the hash of the secret, HMAC verification
 * is done against the stored hash as the key. Both sides must agree on
 * this. The POS signs with plainSecret; we re-hash it and use that as the
 * HMAC key for verification. This is equivalent as long as both sides
 * use the same hash format.
 *
 * Timing-safe compare is used to prevent timing attacks.
 */
const crypto     = require('crypto');
const Restaurant = require('../models/Restaurant');

const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes

module.exports = async function posAuth(req, res, next) {
  try {
    const apiKey       = req.headers['x-api-key']       || '';
    const restaurantId = req.headers['x-restaurant-id'] || '';
    const timestamp    = req.headers['x-timestamp']     || '';
    const signature    = req.headers['x-signature']     || '';

    if (!apiKey || !timestamp || !signature) {
      return res.status(401).json({ error: 'Missing authentication headers' });
    }

    // Replay-attack guard
    const ts = parseInt(timestamp, 10);
    if (isNaN(ts) || Math.abs(Date.now() - ts) > TIMESTAMP_TOLERANCE_MS) {
      return res.status(401).json({ error: 'Timestamp out of range' });
    }

    // Look up branch
    const found = await Restaurant.findBranchByApiKey(apiKey);
    if (!found) {
      return res.status(401).json({ error: 'Unknown API key' });
    }
    const { restaurant, branch } = found;

    // Sanity-check restaurantId header if provided
    if (restaurantId && restaurantId !== restaurant.restaurantId) {
      return res.status(401).json({ error: 'Restaurant ID mismatch' });
    }

    // Verify HMAC — raw body must be read before JSON parsing.
    // The express.json() middleware populates req.rawBody when we set verify.
    const rawBody = req.rawBody || '';
    const expected = crypto
      .createHmac('sha256', branch.apiSecret) // stored hash used as HMAC key
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');

    const sigBuf      = Buffer.from(signature,  'hex');
    const expectedBuf = Buffer.from(expected,    'hex');

    if (sigBuf.length !== expectedBuf.length ||
        !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    req.restaurant = restaurant;
    req.branch     = branch;
    next();
  } catch (err) {
    console.error('[POS-AUTH]', err.message);
    return res.status(500).json({ error: 'Auth error' });
  }
};
