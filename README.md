# GrillSync Cloud — v2 (Vercel-ready)

Multi-tenant SaaS dashboard for restaurant branches, with a zero-config
"Add Branch" flow that generates a self-contained sync worker for each
local POS instance.

## What changed vs v1

| Concern                | v1 (Express + Socket.IO)                 | v2 (Vercel serverless)                          |
|------------------------|------------------------------------------|-------------------------------------------------|
| Runtime                | Long-lived Node process                  | Cloudflare/Vercel serverless functions          |
| Entry point            | `server/index.js` (`app.listen`)         | `api/[...path].js` → cached Express app         |
| MongoDB connection     | Single global, opened at boot            | Per-cold-start cached pool (`lib/db.js`)        |
| Realtime (Socket.IO)   | In-process rooms                         | Removed; dashboard polls `branch.lastSyncAt`    |
| Static dashboard       | `app.use(express.static)` + SPA fallback | Vercel serves `/public` directly via rewrites   |
| Sync endpoint          | `POST /sync/batch` only                  | `POST /sync/batch` **and** `/api/sync/branch-upload` |
| Add Branch flow        | Backend route only                       | Backend + dashboard modal + downloadable script |
| Env var config         | Mixed                                    | Pure `process.env`, no hardcoded URLs           |

The legacy `POST /sync/batch` path is preserved for backward compatibility
with already-deployed POS instances. The new canonical path is
`POST /api/sync/branch-upload` (same contract).

## Deploy to Vercel

1. Push this repo to GitHub.
2. In the Vercel dashboard → New Project → import the repo.
3. Add environment variables (Settings → Environment Variables):
   - `MONGO_URI` (MongoDB Atlas connection string — required)
   - `JWT_SECRET` (long random string — required)
   - `ALLOWED_ORIGINS` (comma-separated, or `*`)
   - `PUBLIC_BASE_URL` (optional; auto-detected from request if omitted)
4. Deploy. Vercel will route everything through `api/[...path].js` and
   serve the dashboard from `/public/index.html`.

No build step is required.

## Local dev

```bash
cp .env.example .env       # then fill in MONGO_URI + JWT_SECRET
npm install
npm start                  # http://localhost:4000
```

Or use the Vercel emulator (matches production routing exactly):

```bash
npx vercel dev
```

## Add Branch flow (end-to-end)

1. Sign in to the dashboard as an owner/superadmin.
2. Go to **Settings → Restaurants & Branches**.
3. Click **Add Branch**, fill in name / address / contact, save.
4. The success dialog shows the Branch ID, API key, **API secret (once!)**,
   and a **Download sync script** button.
5. Drop the downloaded `grillsync-sync-<branchId>.js` file into the local
   POS server directory and run:

   ```bash
   node grillsync-sync-<branchId>.js
   ```

   The script reads pending records from the POS's local `syncqueues`
   collection, batches them, signs with HMAC-SHA256, and uploads to
   `/api/sync/branch-upload`. It retries with exponential backoff on
   failure and never blocks POS operation.

If the secret is lost: hit **rotate keys** on that branch — the response
contains a fresh script. The `/sync-script.js` download endpoint will
issue a script with a placeholder secret (we don't store secrets in
plaintext).

## Sync wire contract

Every sync request includes these headers; the body is signed verbatim.

| Header             | Value                                                |
|--------------------|------------------------------------------------------|
| `X-Api-Key`        | Branch API key (`rk_…`)                              |
| `X-Restaurant-Id`  | Parent restaurant ID (`rest_…`)                      |
| `X-Timestamp`      | `Date.now().toString()` (must be within 5 min)       |
| `X-Signature`      | `HMAC_SHA256(sha256(apiSecret), "{ts}.{rawBody}")`   |

`apiSecret` is the plain secret that was shown once at branch creation;
the cloud stores only its SHA-256, and both sides use that hash as the
HMAC key. The generated script handles this automatically.

Body:

```json
{
  "restaurantId": "rest_…",
  "branchId":     "br_…",
  "sentAt":       "2026-05-18T12:00:00.000Z",
  "records": [
    { "id": "…", "entity": "order", "entityId": "…", "op": "upsert",
      "payload": { "orderId": "…", "items": [...], "totalPrice": 123, ... },
      "createdAt": "…" }
  ]
}
```

Response:

```json
{
  "accepted":  [{ "id": "…", "cloudId": "br_…:orderId" }],
  "rejected":  [{ "id": "…", "error": "payload.orderId missing" }],
  "branchId":  "br_…",
  "restaurantId": "rest_…",
  "serverTime": "…"
}
```

Ingest is idempotent (`{branchId, orderId}` upsert), so retries are safe.

## Project layout

```
api/
  [...path].js              ← Vercel catch-all → Express app
lib/
  app.js                    ← Express app factory (formerly server/index.js)
  db.js                     ← Cached mongoose connect for cold starts
  sync-script-template.js   ← Template rendered at Add Branch time
public/
  index.html                ← Dashboard SPA (+ Add Branch UI)
server/
  routes/                   ← auth, restaurants, sync, analytics, ...
  models/                   ← Mongoose schemas
  middleware/               ← auth, posAuth, requireRole
scripts/
  dev-server.js             ← Local fallback (no vercel CLI needed)
vercel.json                 ← Routing + function config
.env.example                ← Required env vars
```

## What was intentionally NOT done

- Socket.IO was removed. Restoring push updates needs an external broker
  (Pusher / Ably / Supabase Realtime) — wire it where the comment in
  `server/routes/sync.js` marks the fan-out point.
- Mongo migrations: schemas are unchanged from v1, so no migration is
  needed if you point this build at the existing database.
- No Vercel Edge runtime (yet) — bcryptjs and mongoose both pull Node
  built-ins. Edge migration would require swapping bcryptjs for a
  Web-Crypto password hasher and using Mongo Data API instead of the
  driver. Out of scope for v2.
