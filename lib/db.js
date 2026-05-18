/**
 * Cached MongoDB connection for serverless (Vercel) cold starts.
 *
 * In a serverless environment each invocation may run in a new sandbox.
 * Without caching we'd open a fresh TCP connection per request and quickly
 * exhaust the MongoDB Atlas connection pool. The `global._mongoose` pattern
 * survives across warm invocations within the same Lambda container.
 *
 * Required env: MONGO_URI
 */
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI && process.env.NODE_ENV !== 'test') {
  console.warn('[DB] MONGO_URI is not set — DB calls will fail until it is configured.');
}

let cached = global._mongooseCache;
if (!cached) {
  cached = global._mongooseCache = { conn: null, promise: null };
}

async function connectDB() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose
      .connect(MONGO_URI, {
        // serverSelectionTimeoutMS keeps cold-start latency bounded.
        serverSelectionTimeoutMS: 8000,
        maxPoolSize: 5,
      })
      .then((m) => {
        console.log('[DB] connected');
        return m;
      })
      .catch((err) => {
        cached.promise = null; // allow retry on next invocation
        throw err;
      });
  }
  cached.conn = await cached.promise;
  return cached.conn;
}

module.exports = { connectDB };
