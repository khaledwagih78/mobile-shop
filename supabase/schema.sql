-- ============================================================
-- Khaled ERP — Supabase Schema
-- Run this once in your Supabase SQL editor:
--   Dashboard → SQL Editor → New Query → paste → Run
-- ============================================================
-- Each table stores records in a `data` jsonb column.
-- This lets us add new fields to the app without schema changes.
-- RLS is enabled with open policies (auth is handled by the app's own PIN system).
-- ============================================================

DO $$
DECLARE
  tbl text;
  tbls text[] := ARRAY[
    'items', 'customers', 'suppliers', 'invoices',
    'payments', 'stockMoves', 'expenses', 'recurringExpenses',
    'employees', 'empRecords', 'users'
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
      DROP POLICY IF EXISTS "open_access" ON public.%I;
      CREATE POLICY "open_access" ON public.%I
        FOR ALL USING (true) WITH CHECK (true);
    ', tbl, tbl, tbl, tbl);
  END LOOP;
END $$;

-- Settings uses a text primary key (not bigint)
CREATE TABLE IF NOT EXISTS public.settings (
  key  text    PRIMARY KEY,
  data jsonb   NOT NULL,
  _at  timestamptz DEFAULT now()
);
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "open_access" ON public.settings;
CREATE POLICY "open_access" ON public.settings
  FOR ALL USING (true) WITH CHECK (true);
