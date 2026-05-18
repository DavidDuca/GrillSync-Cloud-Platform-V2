/**
 * require(...roles) — RBAC guard middleware.
 * Usage: router.get('/path', auth, require('owner','manager'), handler)
 */
module.exports = function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (roles.includes(req.user.role) || req.user.role === 'superadmin') return next();
    return res.status(403).json({ error: `Requires role: ${roles.join(' or ')}` });
  };
};

/**
 * requireSameRestaurant — ensures the user can only access their own data.
 * Attach after auth + RBAC.
 */
module.exports.requireSameRestaurant = function (req, res, next) {
  const paramId = req.params.restaurantId || req.query.restaurantId;
  if (!paramId) return next();
  if (req.user.role === 'superadmin') return next();
  if (req.user.restaurantId !== paramId) {
    return res.status(403).json({ error: 'Access denied to this restaurant' });
  }
  next();
};
