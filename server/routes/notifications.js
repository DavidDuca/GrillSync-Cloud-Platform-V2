const express      = require('express');
const router       = express.Router();
const auth         = require('../middleware/auth');
const Notification = require('../models/Notification');

// GET /api/notifications
router.get('/', auth, async (req, res) => {
  try {
    const filter = { restaurantId: req.user.restaurantId };
    if (req.query.unread === 'true') filter.isRead = false;
    const notes = await Notification.find(filter).sort({ createdAt: -1 }).limit(50);
    const unreadCount = await Notification.countDocuments({ restaurantId: req.user.restaurantId, isRead: false });
    res.json({ notifications: notes, unreadCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/notifications/:id/read
router.patch('/:id/read', auth, async (req, res) => {
  try {
    await Notification.updateOne({ _id: req.params.id, restaurantId: req.user.restaurantId }, { $set: { isRead: true } });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/notifications/read-all
router.post('/read-all', auth, async (req, res) => {
  try {
    await Notification.updateMany({ restaurantId: req.user.restaurantId, isRead: false }, { $set: { isRead: true } });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
