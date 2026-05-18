# GrillSync Cloud Management Platform

A multi-tenant SaaS restaurant management platform that receives synchronized
data from locally-hosted GrillSync POS systems installed in restaurant branches.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                      CLOUD PLATFORM (This repo)                     │
│                                                                     │
│  ┌──────────────┐   ┌──────────────┐   ┌─────────────────────────┐ │
│  │  Dashboard   │   │  REST API    │   │  Socket.IO              │ │
│  │  (SPA HTML)  │◄──│  Express.js  │◄──│  Realtime events        │ │
│  └──────────────┘   └──────┬───────┘   └─────────────────────────┘ │
│                             │                                       │
│                     ┌───────▼────────┐                             │
│                     │   MongoDB      │                             │
│                     │   (Cloud DB)   │                             │
│                     └────────────────┘                             │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ HTTPS POST /sync/batch
                               │ (HMAC-signed batches)
        ┌──────────────────────▼──────────────────────────┐
        │              LOCAL POS SYSTEM                   │
        │  (Jonel's Inasalan — or any GrillSync branch)   │
        │                                                 │
        │  server.js ──► syncService.js ──► SyncQueue     │
        │  Orders placed → queued → uploaded when online  │
        └─────────────────────────────────────────────────┘
```

---

## How the Sync Works

The POS system already has a complete sync architecture (syncService.js,
SyncQueue.js, syncRoutes.js). The cloud platform is the **receiving end**.

### POS side (already built)
1. Order is placed and saved to local MongoDB
2. `syncService.enqueueOrder(order)` adds it to the SyncQueue collection
3. Every 30 seconds (or on demand), the sync worker batches up to 50 pending records
4. Batch is HMAC-signed with the branch secret and POSTed to `CLOUD_SYNC_URL/sync/batch`
5. On success, queue items are marked `synced`; on failure they retry with backoff

### Cloud side (this repo)
1. `POST /sync/batch` receives the signed batch
2. `posAuth` middleware verifies the HMAC signature against the stored key
3. Each record is upserted into `SyncedOrder` (idempotent — retries are safe)
4. A Socket.IO event fires to all dashboard clients watching that restaurant
5. Analytics queries run against `SyncedOrder` in real time

---

## Quick Start

### 1. Prerequisites
- Node.js 18+
- MongoDB 6+ (local or Atlas)
- A running GrillSync POS instance

### 2. Install
```bash
cd grillsync-cloud
npm install
```

### 3. Configure
```bash
cp .env.example .env
# Edit .env with your MongoDB URI and JWT secret
```

Minimum `.env`:
```env
PORT=4000
MONGO_URI=mongodb://127.0.0.1:27017/grillsync_cloud
JWT_SECRET=replace_with_64_char_random_string
ALLOWED_ORIGINS=http://localhost:4000
```

### 4. Seed initial data
```bash
node server/scripts/seed.js
```

This creates:
- Superadmin: `admin@grillsync.app` / `Admin@1234`
- Demo restaurant: Jonel's Inasalan
- One branch with API credentials (printed to console)

### 5. Start
```bash
# Production
npm start

# Development (auto-restart)
npm run dev
```

Dashboard: http://localhost:4000

---

## Connect a POS Branch

After seeding, copy the printed credentials into your POS `.env`:

```env
# In your POS server .env file:
CLOUD_SYNC_URL=http://your-cloud-server:4000
CLOUD_SYNC_API_KEY=rk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
CLOUD_SYNC_SECRET=whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
CLOUD_RESTAURANT_ID=rest_jonels_main
CLOUD_SYNC_ENABLED=true
CLOUD_SYNC_INTERVAL_MS=30000
```

The POS syncService.js reads these variables automatically and begins uploading.

---

## API Reference

### Authentication
All `/api/*` endpoints require:
```
Authorization: Bearer <jwt_token>
```

Get a token via `POST /api/auth/login`.

### POS Sync Endpoints (no JWT — uses API key + HMAC)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/sync/batch` | Receive order batch from POS |
| GET | `/sync/status` | Health check for POS |

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Login → JWT token |
| POST | `/api/auth/register` | Create account |
| GET | `/api/auth/me` | Current user |
| PATCH | `/api/auth/me` | Update profile/password |

### Analytics
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/analytics/summary?range=30&branchId=` | KPI summary |
| GET | `/api/analytics/daily?range=30&branchId=` | Day-by-day data |
| GET | `/api/analytics/hourly?branchId=` | Today hourly |
| GET | `/api/analytics/bestsellers?range=30&limit=10` | Top items |
| GET | `/api/analytics/categories?range=30` | By category |
| GET | `/api/analytics/branches?range=30` | Branch comparison |
| GET | `/api/analytics/profit?range=30&branchId=` | P&L data |
| GET | `/api/analytics/realtime` | Live active orders |

### Restaurants
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/restaurants` | List restaurants |
| POST | `/api/restaurants` | Create restaurant + owner |
| GET | `/api/restaurants/:id` | Get restaurant |
| POST | `/api/restaurants/:id/branches` | Add branch |
| PATCH | `/api/restaurants/:id/branches/:bid` | Update branch |
| POST | `/api/restaurants/:id/branches/:bid/rotate-keys` | Rotate API keys |
| GET | `/api/restaurants/:id/users` | List users |
| POST | `/api/restaurants/:id/users` | Invite user |

### Expenses
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/expenses?range=30&branchId=&category=` | List expenses |
| POST | `/api/expenses` | Create expense |
| PATCH | `/api/expenses/:id` | Update / approve |
| DELETE | `/api/expenses/:id` | Delete |

### Orders
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/orders?page=1&limit=30&branchId=&date=` | Order history |
| GET | `/api/orders/:orderId` | Single order |

### Notifications
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/notifications` | List notifications |
| PATCH | `/api/notifications/:id/read` | Mark read |
| POST | `/api/notifications/read-all` | Mark all read |

---

## Multi-Tenant Design

Every document in MongoDB has `restaurantId` and (where relevant) `branchId`.
Every authenticated API request is automatically scoped to `req.user.restaurantId`
— users can never access other restaurants' data.

```
Restaurant (tenant)
  └── Branch[] (one POS per branch)
        └── SyncedOrder[] (all orders from that branch)
        └── Expense[] (expenses logged for that branch)

User
  └── restaurantId (belongs to one restaurant)
  └── branchId (optional — null = all branches)
  └── role (owner | manager | cashier | staff | superadmin)
```

### Adding a new restaurant
```bash
POST /api/restaurants
{
  "name": "My Restaurant",
  "ownerEmail": "owner@myrest.com",
  "ownerPassword": "SecurePass123",
  "firstBranchName": "Main Branch",
  "firstBranchAddress": "123 Main St"
}
```

Response includes `branchCredentials.apiSecret` — shown once, copy to POS `.env`.

---

## Security Architecture

| Layer | Implementation |
|-------|---------------|
| POS Authentication | API Key + HMAC-SHA256 signature per request |
| Replay attack guard | Timestamp tolerance ±5 minutes |
| User authentication | JWT (HS256, configurable expiry) |
| Data isolation | All queries scoped by `restaurantId` from JWT |
| Role-based access | `requireRole()` middleware per endpoint |
| Rate limiting | Global 500 req/15min + Sync 200 req/min |
| CORS | Explicit origin allowlist |
| Headers | Helmet.js security headers |
| Secret storage | API secrets stored as SHA-256 hash only |

---

## Database Schema

### SyncedOrder (mirrors POS Order exactly)
```
restaurantId    String   (tenant routing)
branchId        String   (branch routing)
orderId         String   (POS order ID — unique per branch)
customerNo      Number   (daily sequential customer number)
items[]         Array    (itemId, name, category, cookingArea, qty, addOns, lineTotal)
totalPrice      Number
cashReceived    Number
changeDue       Number
paymentMethod   String
status          String   (pending|paid|preparing|partially-ready|ready|completed|cancelled)
stations        Map      (grill|kitchen → { status, startedAt, readyAt })
placedAt        Date
paidAt          Date     (indexed for analytics queries)
readyAt         Date
completedAt     Date
receivedAt      Date     (when cloud received it)
syncQueueId     String   (POS queue ID for dedup)
```

### Expense
```
restaurantId    String
branchId        String
title           String
amount          Number
category        String   (ingredients|utilities|salaries|maintenance|supplies|delivery|misc)
description     String
isRecurring     Boolean
recurringInterval String
status          String   (pending|approved|rejected)
submittedBy     ObjectId → User
approvedBy      ObjectId → User
expenseDate     Date     (indexed)
```

### Restaurant (tenant)
```
restaurantId    String   (unique slug, e.g. rest_jonels_main)
name            String
plan            String   (trial|basic|pro|enterprise)
branches[]      Array    (branchId, name, apiKey, apiSecret-hash, syncStatus, lastSyncAt)
ownerIds[]      Array    → User
```

---

## Deployment (Production)

### Option A — Same server as POS (small setup)
```bash
# Run on port 4000 alongside POS on port 3000
PORT=4000 npm start
```

### Option B — Separate cloud server (recommended)
1. Provision a VPS (DigitalOcean, Linode, AWS EC2)
2. Install Node.js 18+ and MongoDB (or use MongoDB Atlas)
3. Clone this repo, `npm install`, configure `.env`
4. Use PM2 for process management:
```bash
npm install -g pm2
pm2 start server/index.js --name grillsync-cloud
pm2 startup && pm2 save
```
5. Use Nginx as reverse proxy with HTTPS (Let's Encrypt)

### Option C — MongoDB Atlas (cloud DB)
Replace `MONGO_URI` with your Atlas connection string:
```env
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/grillsync_cloud
```

---

## File Structure

```
grillsync-cloud/
├── package.json
├── .env.example
├── README.md
├── server/
│   ├── index.js                Main Express + Socket.IO server
│   ├── models/
│   │   ├── Restaurant.js       Tenant model with branch credentials
│   │   ├── User.js             RBAC user model
│   │   ├── SyncedOrder.js      Cloud order mirror (matches POS schema)
│   │   ├── Expense.js          Expense tracker
│   │   └── Notification.js     In-app notifications
│   ├── middleware/
│   │   ├── auth.js             JWT verification
│   │   ├── posAuth.js          POS HMAC signature verification
│   │   └── requireRole.js      RBAC guard
│   ├── routes/
│   │   ├── auth.js             Login, register, me
│   │   ├── sync.js             POS batch ingest
│   │   ├── analytics.js        All aggregation queries
│   │   ├── restaurants.js      Restaurant + branch management
│   │   ├── expenses.js         Expense CRUD
│   │   ├── orders.js           Order history
│   │   └── notifications.js    Notification center
│   └── scripts/
│       └── seed.js             Initial data seeder
└── public/
    └── index.html              Single-page dashboard (Chart.js + Socket.IO)
```
