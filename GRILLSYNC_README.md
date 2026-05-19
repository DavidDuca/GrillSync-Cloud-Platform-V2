# GrillSync Cloud

Complete rewrite of the cloud sync + analytics platform for the GrillSync POS.

This repo contains **two independently deployable apps**:

- **`backend/`** — Node.js + Express + Mongoose API. Deploy to Render or Railway.
- **`frontend/`** — Vanilla HTML/CSS/JS SPA. Deploy to Vercel as a static site.

Lovable's live preview does not run this app — it's a TanStack Start template under the hood. To test, run the two folders locally or deploy them.

## Quickstart (local)

```bash
# 1. Backend
cd backend
cp .env.example .env       # fill MONGO_URI, JWT_SECRET
npm install
npm run dev                # http://localhost:4000

# 2. Frontend (separate terminal)
cd frontend
npx serve .                # http://localhost:3000
```

Open the frontend, accept default backend `http://localhost:4000`, log in with:
- `admin@grillsync.app` / `Admin@1234`

On first backend boot, the seed script logs a demo restaurant + branch with API key and **plaintext API secret** — copy these to configure the POS or download a sync script from Settings → Restaurants.

## Sync contract with the POS

- POS POSTs batches every 30s to `POST {CLOUD_SYNC_URL}/sync/batch`
- Body: `{ restaurantId, branchId, sentAt, records: [{ id, entity, entityId, op, payload, createdAt }] }`
- Headers: `X-Api-Key`, `X-Restaurant-Id`, `X-Timestamp`, `X-Signature`
- HMAC: `HMAC_SHA256( sha256(plainSecret), "{X-Timestamp}.{rawBody}" )` — both POS and cloud use the **sha256 hash of the plain secret** as the HMAC key
- Cloud stores `apiSecret = sha256(plainSecret)`; plaintext is shown to user once at create/rotate
- Response: `{ accepted: [{id, cloudId}], rejected: [{id, error}], branchId, restaurantId, serverTime }`

The cloud also serves a self-contained **sync agent script** (`grillsync-sync-<branchId>.js`) generated server-side with the branch's credentials baked in. It works standalone (`node grillsync-sync-br_xxx.js`) or embedded inside the POS `server.js` (`require()`).

## Deployment URLs

When deploying, set in Render:
- `PUBLIC_BASE_URL=https://your-backend.onrender.com`
- `CORS_ORIGINS=https://your-frontend.vercel.app`

Then point the frontend at it on first visit: `https://your-frontend.vercel.app/?backend=https://your-backend.onrender.com`
