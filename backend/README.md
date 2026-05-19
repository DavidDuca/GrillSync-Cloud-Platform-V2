# GrillSync Cloud — Backend

Express + MongoDB cloud sync backend for GrillSync POS.

## Run locally

```bash
cd backend
cp .env.example .env   # fill MONGO_URI, JWT_SECRET, PUBLIC_BASE_URL
npm install
npm run dev
```

First boot auto-seeds:
- Superadmin `admin@grillsync.app` / `Admin@1234`
- Demo restaurant + branch (credentials logged to console — save them)

## Deploy to Render

1. New Web Service → connect this repo (root = `backend/`)
2. Build command: `npm install`
3. Start command: `npm start`
4. Env vars:
   - `MONGO_URI` — MongoDB Atlas connection string
   - `JWT_SECRET` — long random string
   - `PUBLIC_BASE_URL` — `https://<your-service>.onrender.com`
   - `CORS_ORIGINS` — `https://<your-vercel-domain>` (or `*` while testing)

## Key endpoints

- `POST /api/auth/login` — `{ email, password }` → `{ token, user }`
- `GET  /api/auth/me`
- `GET  /api/restaurants` (scoped)
- `POST /api/restaurants` (superadmin/owner) → returns `branchCredentials` + `syncScript`
- `POST /api/restaurants/:rid/branches`
- `POST /api/restaurants/:rid/branches/:bid/rotate-keys`
- `GET  /api/restaurants/:rid/branches/:bid/sync-script.js`
- `POST /sync/batch` (POS HMAC-signed)
- `POST /api/sync/branch-upload` (alias)
- `GET  /sync/status`
- `GET  /api/analytics/{summary,daily,hourly,bestsellers,categories}`
- `GET  /api/orders`
- `*    /api/expenses`
- `*    /api/notifications`
- `GET  /api/stream` — SSE (token via `?token=`)

## HMAC contract (must match POS)

- Cloud stores `apiSecret = sha256(plainSecret)` per branch
- Both sides sign as: `HMAC_SHA256( sha256(plainSecret), "{X-Timestamp}.{rawBody}" )`
- Raw body is captured by `express.json({ verify })` before parsing
