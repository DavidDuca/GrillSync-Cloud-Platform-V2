const jwt = require('jsonwebtoken');
const User = require('../models/User');

function sign(user) {
  return jwt.sign(
    { sub: String(user._id), role: user.role, restaurantId: user.restaurantId, branchId: user.branchId, email: user.email, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

async function authRequired(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
    const token  = bearer || req.query.token;
    if (!token) return res.status(401).json({ error: 'No token' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.sub);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    req.auth = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

// Helper: build a restaurant-scoping filter from the authed user
function scopeFilter(user, extra = {}) {
  const base = { ...extra };
  if (user.role !== 'superadmin') {
    if (!user.restaurantId) return { restaurantId: '__none__' };
    base.restaurantId = user.restaurantId;
  }
  return base;
}

module.exports = { sign, authRequired, requireRole, scopeFilter };
