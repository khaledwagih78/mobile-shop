-- ============================================================
-- Khaled ERP — Supabase Schema (SECURED + public storefront)
-- Run this once in your Supabase SQL editor:
--   Dashboard → SQL Editor → New Query → paste → Run
-- ============================================================
-- Each table stores records in a `data` jsonb column.
-- This lets us add new fields to the app without schema changes.
--
-- SECURITY MODEL (changed):
--   * Base tables (items, customers, invoices, ...) are now readable/writable
--     ONLY by a signed-in user (role `authenticated`). The public (role `anon`)
--     gets NOTHING on them — so cost, profit, customers, invoices never leak.
--   * A single read-only view `public_catalog` exposes ONLY name + sale price
--     (+ brand/category/code) of items flagged `showOnline = true`. This is the
--     ONLY thing the public website is allowed to read.
--
--   >>> Because of this, the ERP app MUST sign in to Supabase before syncing.
--       Create ONE owner account for the shop (one time), see the bottom of
--       this file, and put its email/password in the app's .env
--       (VITE_SUPABASE_OWNER_EMAIL / VITE_SUPABASE_OWNER_PASSWORD).
-- ============================================================

-- ------------------------------------------------------------
-- 1) Base tables + authenticated-only policies
-- ------------------------------------------------------------
DO $$
DECLARE
  tbl text;
  tbls text[] := ARRAY[
    'items', 'customers', 'suppliers', 'invoices',
    'payments', 'stockMoves', 'expenses', 'recurringExpenses',
    'employees', 'empRecords', 'users',
    'lines', 'transactions', 'profiles',
    'auditLog', 'deliveries', 'branches', 'requests', 'productions',
    'accounts', 'journalEntries', 'installmentPlans', 'leads', 'priceLists', 'coupons', 'assets', 'payslips', 'projects', 'workOrders', 'repVisits', 'cashCloses'
  ];
BEGIN
  FOREACH tbl IN ARRAY tbls LOOP
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS public.%I (
        id   bigint  PRIMARY KEY,
        data jsonb   NOT NULL,
        _at  timestamptz DEFAULT now()
      );
      ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;

      -- Remove the old wide-open policy if this DB had it
      DROP POLICY IF EXISTS "open_access" ON public.%I;

      -- Signed-in users (the ERP app after login) get full access
      DROP POLICY IF EXISTS "authenticated_all" ON public.%I;
      CREATE POLICY "authenticated_all" ON public.%I
        FOR ALL TO authenticated
        USING (true) WITH CHECK (true);

      -- The public (anon) gets no policy at all here => zero rows.
      -- Belt-and-braces: strip any direct table grant the anon role may hold.
      REVOKE ALL ON public.%I FROM anon;
    ', tbl, tbl, tbl, tbl, tbl, tbl, tbl);
  END LOOP;
END $$;

-- Settings uses a text primary key (not bigint). Same lock-down.
CREATE TABLE IF NOT EXISTS public.settings (
  key  text    PRIMARY KEY,
  data jsonb   NOT NULL,
  _at  timestamptz DEFAULT now()
);
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "open_access" ON public.settings;
DROP POLICY IF EXISTS "authenticated_all" ON public.settings;
CREATE POLICY "authenticated_all" ON public.settings
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.settings FROM anon;

-- ------------------------------------------------------------
-- 2) Public storefront view — the ONLY thing the website can read.
--    Exposes name + sale price only. No cost, no profit, no stock,
--    no customers. `security_invoker = false` (the default) means the
--    view reads `items` with the view owner's rights, so it keeps working
--    even though `anon` has no access to the `items` table itself.
-- ------------------------------------------------------------
DROP VIEW IF EXISTS public.public_catalog;
CREATE VIEW public.public_catalog
WITH (security_invoker = false) AS
SELECT
  i.id,
  i.data->>'name'                     AS name,
  (i.data->>'salePrice')::numeric     AS price,
  i.data->>'brand'                    AS brand,
  i.data->>'category'                 AS category,
  i.data->>'code'                     AS code,
  i.data->>'barcode'                  AS barcode
FROM public.items i
WHERE COALESCE((i.data->>'showOnline')::boolean, false) = true
  AND COALESCE((i.data->>'salePrice')::numeric, 0) > 0;

-- Only the public website (and, harmlessly, the app) may read the view.
REVOKE ALL ON public.public_catalog FROM PUBLIC;
GRANT SELECT ON public.public_catalog TO anon, authenticated;

-- ------------------------------------------------------------
-- 2b) Public repair-status lookup — the customer's tracking link.
--     A SECURITY DEFINER function returns ONE order's SAFE fields and
--     ONLY when the caller already knows its random token, so the public
--     can never enumerate orders or read names/phones/issues/costs.
--     Exposes: number, status, device TYPE, stage timestamps, created.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.repair_status(text);
CREATE FUNCTION public.repair_status(p_token text)
RETURNS TABLE (
  number  text,
  status  text,
  device  text,
  stamps  jsonb,
  created text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    w.data->>'number'     AS number,
    w.data->>'status'     AS status,
    w.data->>'deviceType' AS device,
    w.data->'stamps'      AS stamps,
    w.data->>'createdAt'  AS created
  FROM public."workOrders" w
  WHERE COALESCE(p_token, '') <> ''
    AND w.data->>'trackToken' = p_token
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.repair_status(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.repair_status(text) TO anon, authenticated;

-- ============================================================
-- 3) ONE-TIME: create the shop owner account (do this once per shop)
-- ============================================================
-- In the Supabase Dashboard:
--   Authentication → Users → "Add user" → enter an email + password
--   → tick "Auto Confirm User" → Create.
-- Then put the SAME email + password into the app's .env file:
--   VITE_SUPABASE_OWNER_EMAIL=owner@theshop.example
--   VITE_SUPABASE_OWNER_PASSWORD=••••••••
-- Rebuild the app. The app will log in automatically before each sync.
--
-- (Optional, if you prefer SQL — requires the auth admin API; the Dashboard
--  button above is the simplest and recommended way.)
-- ============================================================
