require('dotenv').config();
const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const User    = require('../models/User');
const auth    = require('../middleware/auth');

function signToken(user) {
  return jwt.sign(
    { sub: user._id, role: user.role, restaurantId: user.restaurantId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { email, password, name, restaurantId, role } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'email, password, name required' });
    }
    if (await User.findOne({ email })) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    const passwordHash = await User.hashPassword(password);
    const user = await User.create({
      email, passwordHash, name,
      role: role || 'owner',
      restaurantId: restaurantId || null
    });
    const token = signToken(user);
    res.status(201).json({ token, user: user.toPublic() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });
    const user = await User.findOne({ email, isActive: true });
    if (!user || !(await user.verifyPassword(password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    user.lastLoginAt = new Date();
    await user.save();
    const token = signToken(user);
    res.json({ token, user: user.toPublic() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me
router.get('/me', auth, (req, res) => {
  res.json({ user: req.user.toPublic ? req.user.toPublic() : req.user });
});

// PATCH /api/auth/me — update profile
router.patch('/me', auth, async (req, res) => {
  try {
    const { name, password } = req.body;
    if (name) req.user.name = name;
    if (password) req.user.passwordHash = await User.hashPassword(password);
    await req.user.save();
    res.json({ user: req.user.toPublic() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// POST /api/auth/bootstrap
// One-shot superadmin creation. Succeeds only when:
//   (a) the users collection is empty, OR
//   (b) the request includes header "x-bootstrap-token" matching env BOOTSTRAP_TOKEN
// Safe to leave deployed — becomes a no-op after the first user exists
// (unless BOOTSTRAP_TOKEN is set, in which case it stays gated by that secret).
router.post('/bootstrap', async (req, res) => {
  try {
    const { email, password, name } = req.body || {};
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'email, password, name required' });
    }

    const userCount = await User.countDocuments();
    const token = req.headers['x-bootstrap-token'];
    const tokenOk = process.env.BOOTSTRAP_TOKEN && token === process.env.BOOTSTRAP_TOKEN;

    if (userCount > 0 && !tokenOk) {
      return res.status(403).json({
        error: 'Bootstrap disabled: users already exist. Set BOOTSTRAP_TOKEN env var and send x-bootstrap-token header to override.'
      });
    }

    if (await User.findOne({ email })) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await User.hashPassword(password);
    const user = await User.create({
      email, passwordHash, name,
      role: 'superadmin',
      restaurantId: null
    });
    const jwtToken = signToken(user);
    res.status(201).json({ token: jwtToken, user: user.toPublic(), bootstrapped: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
