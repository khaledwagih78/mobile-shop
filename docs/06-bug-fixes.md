# 06 — Bug Fixes

## Bug 1 — Duplicate Admin Users in Login Screen

**Symptom:** The login screen showed 3 entries for "المدير" (Admin) in the user dropdown.

**Root Cause:** React 18 **StrictMode** intentionally mounts every component **twice** in development to detect side effects. The `ensureSeed()` function in `db.js` was called twice on startup, inserting the default admin user twice (or three times due to race conditions).

**Fixes Applied (two layers):**

### Layer 1 — `src/db.js` (`ensureSeed`)

Made seed insertion idempotent by checking for existing records before inserting:

```js
const existing = await db.users.where('name').equals('المدير').first();
if (!existing) {
  await db.users.add({
    name: 'المدير',
    role: 'admin',
    pin: '1234',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}
```

### Layer 2 — `src/pages/Login.jsx` (UI deduplication via `useMemo`)

Added a safety net at the UI level to deduplicate by `name + role` key, so even if duplicate DB rows exist, only one option is shown:

```jsx
const users = useMemo(() => {
  if (!rawUsers || !rawUsers.length) return [];
  const map = new Map();
  for (const u of rawUsers) {
    const key = `${u.name}_${u.role}`;
    if (!map.has(key)) map.set(key, u);
  }
  return Array.from(map.values());
}, [rawUsers]);
```

---

## Bug 2 — Wrong Supabase URL

**Symptom:** API calls to the new Supabase project failed with DNS resolution errors.

**Root Cause:** A typo introduced an extra `b` in the project reference:
- Wrong: `https://pbqxoxtbhlrsqwinebiar.supabase.co`
- Correct: `https://pbqxoxthlrsqwinebiar.supabase.co`

**Fix:** Corrected the URL in `.env` and in the `src/supabase.js` fallback constant. Verified by DNS lookup and direct API call.

---

## Bug 3 — `npm` / `git` Not Found in Tool Sandbox

**Symptom:** `npm` and `git` commands failed with "not recognized" errors when run from automated tools.

**Root Cause:** `fnm` (Fast Node Manager) adds Node to PATH only in interactive terminal sessions. Tool-executed commands run in a fresh PowerShell session without the user's profile.

**Fix:** Always prefix tool-run commands with:

```powershell
$env:PATH = "C:\Users\khaled\AppData\Roaming\fnm\node-versions\v26.13.0\installation;C:\Program Files\Git\cmd;$env:PATH"
```

This is not a code bug — just an environment setup note.

---

## Bug 4 — Old Supabase Credentials in `src/supabase.js`

**Symptom:** The app was pointing at the previous developer's Supabase project even after `.env` was updated.

**Root Cause:** `src/supabase.js` had the old URL and key hardcoded as string literals, and was not reading from `import.meta.env`.

**Fix:** Updated `src/supabase.js` to read from environment variables first:

```js
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
  || 'https://pbqxoxthlrsqwinebiar.supabase.co';

const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
  || 'eyJhbGci...';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
```
