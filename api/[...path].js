/**
 * Vercel catch-all serverless function.
 *
 * Every request that doesn't match a static file in /public is rewritten
 * here by vercel.json. We dispatch to the cached Express app — Vercel's
 * Node runtime accepts an (req, res) handler, which is exactly what an
 * Express app already is.
 */
const { getApp } = require('../lib/app');

module.exports = (req, res) => getApp()(req, res);
