const express = require('express');
const Notification = require('../models/Notification');
const { authRequired, scopeFilter } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired);

router.get('/', async (req, res) => {
  const filter = scopeFilter(req.user);
  const items = await Notification.find(filter).sort({ createdAt: -1 }).limit(100).lean();
  const unreadCount = await Notification.countDocuments({ ...filter, isRead: false });
  res.json({ notifications: items, unreadCount });
});

router.post('/read-all', async (req, res) => {
  const filter = scopeFilter(req.user, { isRead: false });
  await Notification.updateMany(filter, { $set: { isRead: true } });
  res.json({ ok: true });
});

router.patch('/:id/read', async (req, res) => {
  const filter = scopeFilter(req.user, { _id: req.params.id });
  const n = await Notification.findOneAndUpdate(filter, { $set: { isRead: true } }, { new: true });
  if (!n) return res.status(404).json({ error: 'Not found' });
  res.json({ notification: n });
});

module.exports = router;
