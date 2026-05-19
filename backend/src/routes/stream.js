const express = require('express');
const { authRequired } = require('../middleware/auth');
const { addClient } = require('../services/sseBus');

const router = express.Router();

router.get('/', authRequired, (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  res.write(`event: ready\ndata: ${JSON.stringify({ ok: true, time: Date.now() })}\n\n`);

  const client = { res, user: req.user };
  const remove = addClient(client);

  req.on('close', () => { remove(); try { res.end(); } catch {} });
});

module.exports = router;
