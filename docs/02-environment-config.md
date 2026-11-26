# 02 — Environment & Configuration

## `.env` File

A `.env` file was created at the project root to hold Supabase credentials.  
**This file is gitignored and must never be committed.**

```
c:\Users\khaled\Documents\Projects\ERP\.env
```

### Contents

```env
VITE_SUPABASE_URL=https://pbqxoxthlrsqwinebiar.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBicXhveHRobHJzcXdpbmViaWFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQxNjIyNjgsImV4cCI6MjEwOTczODI2OH0.MeHQKHIfU02jEqondkXOsvVPOAUmWHkV-Z_DTRN5dP0

# Google Gemini AI Configuration (Analyze-Only, locked from user editing)
VITE_GEMINI_API_KEY=your-gemini-api-key
VITE_GEMINI_MODEL=gemini-3.5-flash-lite
```

> **Note:** `VITE_` prefix is required. Vite only exposes env variables that start with `VITE_` to the client bundle via `import.meta.env`.

## `.env.example`

A `.env.example` file was created at the project root for handover documentation — it shows the required variable names with placeholder values:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here

VITE_GEMINI_API_KEY=your-google-gemini-api-key
VITE_GEMINI_MODEL=gemini-3.5-flash-lite
```

This file **is safe to commit** and should be kept up to date.

## `src/supabase.js`

Updated to read credentials from `import.meta.env` with hardcoded fallbacks:

```js
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://pbqxoxthlrsqwinebiar.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '...';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
```

The fallback ensures the app still works even if `.env` is missing (e.g., on GitHub Pages where you set env vars at build time via GitHub Secrets).

## Supabase RLS (Row Level Security)

All Supabase tables use **open RLS policies** (`USING(true)`) — this is intentional.  
Authentication is handled on the **client side** via PIN codes stored in the local Dexie database.  
The anon key gives read/write access to all tables — keep it private (gitignore `.env`).

## GitHub Pages Deployment

The anon key will be embedded in the built JS bundle. This is acceptable for this use case because:
1. The ERP is for internal/shop use — not a public consumer product
2. Supabase RLS is open to all anon users anyway
3. The anon key cannot access Supabase Auth admin or service-role operations

For production hardening later: set up RLS policies that check a session token or restrict by IP.

## Node / npm PATH Issue

`fnm` (Fast Node Manager) is installed but **not added to the system PATH** by default.  
When running commands from tools or scripts (not the user's interactive terminal), prefix with:

```powershell
$env:PATH = "C:\Users\khaled\AppData\Roaming\fnm\node-versions\v26.13.0\installation;C:\Program Files\Git\cmd;$env:PATH"
```

- Node binary: `C:\Users\khaled\AppData\Roaming\fnm\node-versions\v26.13.0\installation\node.exe`
- Git binary: `C:\Program Files\Git\cmd\git.exe`
