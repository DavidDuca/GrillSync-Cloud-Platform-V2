// Local fallback dev server (when you don't want to run `vercel dev`).
// Mounts the same Express app on a normal http.Server and statically serves /public.
require('dotenv').config();
const path    = require('path');
const express = require('express');
const { getApp } = require('../lib/app');

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(getApp());

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`\n  GrillSync Cloud (dev) — http://localhost:${PORT}`);
  console.log(`  POS sync endpoint     → POST /api/sync/branch-upload`);
  console.log(`  Dashboard             → http://localhost:${PORT}\n`);
});
