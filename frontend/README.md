# GrillSync Cloud — Frontend

Pure static HTML/CSS/JS SPA. No build step.

## Local

Open `frontend/index.html` in a browser, or:

```bash
cd frontend
npx serve .
```

On first load, the login screen lets you set the backend URL (saved to localStorage). Default `http://localhost:4000`.

You can also pass `?backend=https://your-api.onrender.com` once to set it.

## Deploy to Vercel

1. New Project → import this repo, Root Directory = `frontend/`
2. Framework preset: **Other** (no build)
3. Build command: leave empty
4. Output directory: `.` (or leave default)
5. After deploy, visit `https://your-app.vercel.app/?backend=https://your-backend.onrender.com` once to set the backend URL.

`vercel.json` rewrites all routes to `index.html` for SPA hash-routing fallback.

## Login

Seeded by backend on first boot:
- `admin@grillsync.app` / `Admin@1234`
