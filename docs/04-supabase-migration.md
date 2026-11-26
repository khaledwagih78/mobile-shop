# 04 — Supabase Migration

## Why We Migrated

The original Supabase project belonged to a **previous developer**:
- Project URL: `https://btdhhabcczvhmhfgocza.supabase.co`
- That developer's credentials — we had no ownership or admin access

A **new Supabase project** was created under your account to take full ownership.

## New Project Details

| Field | Value |
|---|---|
| Project URL | `https://pbqxoxthlrsqwinebiar.supabase.co` |
| Region | (your chosen region) |
| Anon Key | See `.env` file |
| Ownership | Your Supabase account — transfer to client on delivery |

> **Common typo:** An earlier version of this setup had an extra `b` in the URL: `pbqxoxtbhlrsqwinebiar` — this is **wrong**. The correct URL has no extra `b`: `pbqxoxthlrsqwinebiar`.

## Schema Applied

The full SQL schema was run on the new Supabase project via the SQL Editor.  
It creates **31 tables** mirroring the local Dexie schema, plus:

- Indexes on commonly queried columns
- RLS enabled on all tables (policies set to `USING(true)` — open access via anon key)
- `updated_at` / `_at` timestamp columns for incremental sync

### Verification

After running the schema, the setup was verified by calling the Supabase REST API directly:

```
GET https://pbqxoxthlrsqwinebiar.supabase.co/rest/v1/settings?select=count
```

Response: `[{"count": 0}]` — table exists and is empty as expected. ✅

## Delivery Instructions for Client

When handing over the project:

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Open the project: `pbqxoxthlrsqwinebiar`
3. Go to **Project Settings → General → Transfer project**
4. Enter the client's email address
5. The client accepts the transfer via email

After transfer, regenerate the anon key if desired, update `.env` and GitHub Secrets, and redeploy.
