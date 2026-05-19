const crypto = require('crypto');

function genApiKey() {
  return 'rk_' + crypto.randomBytes(20).toString('hex');
}

function genPlainSecret() {
  return 'whsec_' + crypto.randomBytes(32).toString('hex');
}

function hashSecret(plain) {
  return crypto.createHash('sha256').update(plain).digest('hex');
}

function genRestaurantId() {
  return 'rest_' + crypto.randomBytes(8).toString('hex');
}

function genBranchId() {
  return 'br_' + crypto.randomBytes(6).toString('hex');
}

// HMAC used by both POS and cloud: key = sha256(plainSecret) (i.e. the stored apiSecret)
function signPayload(apiSecretHashed, timestamp, rawBody) {
  return crypto
    .createHmac('sha256', apiSecretHashed)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
}

function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch { return false; }
}

module.exports = {
  genApiKey, genPlainSecret, hashSecret,
  genRestaurantId, genBranchId,
  signPayload, timingSafeEqualHex,
};
