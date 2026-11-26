# 01 — Project Overview

## What This Is

**Khaled Mobile Parts ERP** — a freelance project for a client who sells mobile phone spare parts.

It is a **offline-first PWA** (Progressive Web App) built to run entirely in the browser with no server required for day-to-day use. Data syncs to Supabase in the background when internet is available.

## Tech Stack

| Layer | Technology |
|---|---|
| UI Framework | React 18 |
| Build Tool | Vite 5 |
| Local Database | Dexie.js (IndexedDB wrapper) |
| Cloud Sync | Supabase (Postgres + REST API) |
| Styling | Custom CSS variables — no Tailwind |
| Font | Cairo (Arabic, Google Fonts via `@fontsource`) |
| Hosting | GitHub Pages (subpath `/mobile-shop/`) |
| Auth | Client-side PIN system (no Supabase Auth) |
| Language | Arabic — 100% RTL (`dir="rtl"`) |

## Key Files

```
src/
  db.js          — Dexie schema (v19), seed data, all local queries
  sync.js        — Supabase sync engine (push + pull, incremental)
  supabase.js    — Supabase client (reads from .env)
  auth.jsx       — Auth context (PIN login, role checking)
  utils.js       — Shared constants (ROLES, formatters, etc.)
  styles.css     — All CSS — single file, custom CSS variables
  pages/
    Login.jsx    — Login screen
    Dashboard.jsx
    POS.jsx      — Point of Sale
    ... (other pages)
```

## Business Context

- **Client:** owns a mobile phone parts shop
- **Freelancer (you):** building and handing over the ERP
- **Delivery plan:** hand over Supabase project ownership to client on completion
- **Previous developer:** had a Supabase project (`btdhhabcczvhmhfgocza`) — credentials removed and replaced with a fresh project

## Vite Config

- Base path: `/mobile-shop/` (required for GitHub Pages deployment under a repo subpath)
- Dev server runs at: `http://localhost:5173/mobile-shop/`
- Node version: v26.13.0 (managed via `fnm`)

## Running the Project

```powershell
# Node is managed by fnm — set PATH first if running from a tool or script:
$env:PATH = "C:\Users\khaled\AppData\Roaming\fnm\node-versions\v26.13.0\installation;$env:PATH"

npm install
npm run dev      # development server
npm run build    # production build
npm test         # run Vitest tests
```
