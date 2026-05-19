const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { sign, authRequired } = require('../middleware/auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const user = await User.findOne({ email: String(email).toLowerCase().trim() });
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  const token = sign(user);
  res.json({
    token,
    user: {
      id: user._id, email: user.email, name: user.name, role: user.role,
      restaurantId: user.restaurantId, branchId: user.branchId,
    },
  });
});

router.get('/me', authRequired, (req, res) => {
  const u = req.user;
  res.json({
    user: {
      id: u._id, email: u.email, name: u.name, role: u.role,
      restaurantId: u.restaurantId, branchId: u.branchId,
    },
  });
});

module.exports = router;
