-- =====================================================================
-- خالد لصيانة المحمول — Khaled Mobile Repair System
-- Migration 001: core schema (enums, tables, relations, indexes)
-- =====================================================================
-- ملاحظات:
--  * كل المفاتيح الأساسية UUID.
--  * كل جدول تشغيلي فيه branch_id لدعم الفروع مستقبلاً.
--  * لا يوجد أي جدول مالي/خزينة/مخزون محاسبي/رواتب.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
create type public.app_role as enum ('ADMIN', 'MANAGER', 'RECEPTIONIST', 'TECHNICIAN', 'CUSTOMER');

create type public.repair_status as enum (
  'NEW_REQUEST',
  'BOOKING_CONFIRMED',
  'DEVICE_RECEIVED',
  'UNDER_DIAGNOSIS',
  'WAITING_CUSTOMER_APPROVAL',
  'CUSTOMER_APPROVED',
  'CUSTOMER_REJECTED',
  'WAITING_SPARE_PART',
  'UNDER_REPAIR',
  'UNDER_TESTING',
  'WAITING_MANAGER_APPROVAL',
  'READY_FOR_PICKUP',
  'DELIVERED',
  'CANCELLED'
);

create type public.booking_status as enum ('PENDING', 'CONFIRMED', 'RESCHEDULE_PROPOSED', 'REJECTED', 'CANCELLED', 'CHECKED_IN');
create type public.device_type as enum ('PHONE', 'TABLET', 'SMARTWATCH', 'LAPTOP', 'OTHER');
create type public.diagnostic_status as enum ('DRAFT', 'SUBMITTED', 'RETURNED', 'ACCEPTED');
create type public.part_status as enum ('REQUIRED', 'ORDERED', 'RECEIVED', 'INSTALLED', 'CANCELLED');
create type public.approval_status as enum ('PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED', 'EXPIRED');
create type public.approval_channel as enum ('APP', 'LINK', 'STAFF_ON_BEHALF');
create type public.media_kind as enum ('INTAKE', 'DIAGNOSIS', 'REPAIR', 'TEST', 'HANDOVER', 'CUSTOMER_UPLOAD');
create type public.notify_channel as enum ('IN_APP', 'WHATSAPP', 'FCM', 'APNS');
create type public.notify_status as enum ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED');
create type public.handover_outcome as enum ('REPAIRED', 'RETURNED_UNREPAIRED');

-- ---------------------------------------------------------------------
-- Generic updated_at trigger
-- ---------------------------------------------------------------------
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 1. branches
-- ---------------------------------------------------------------------
create table public.branches (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  phone         text,
  whatsapp      text,
  address       text,
  map_url       text,
  working_hours jsonb not null default '{}'::jsonb,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

-- ---------------------------------------------------------------------
-- 2. profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        public.app_role not null default 'CUSTOMER',
  full_name   text,
  phone       text,
  branch_id   uuid references public.branches (id),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index profiles_phone_idx on public.profiles (phone);
create index profiles_role_idx on public.profiles (role);

-- ---------------------------------------------------------------------
-- 3. customers (may exist without an app account — walk-in customers)
-- ---------------------------------------------------------------------
create table public.customers (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid unique references public.profiles (id) on delete set null,
  branch_id   uuid not null references public.branches (id),
  full_name   text not null,
  phone       text not null,
  alt_phone   text,
  email       text,
  internal_notes text,
  created_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  constraint customers_phone_format check (phone ~ '^\+?[0-9]{8,15}$')
);
create unique index customers_phone_uidx on public.customers (phone) where deleted_at is null;
create index customers_name_idx on public.customers (full_name);

-- ---------------------------------------------------------------------
-- 4. employees (staff details; no salaries in this edition)
-- ---------------------------------------------------------------------
create table public.employees (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null unique references public.profiles (id) on delete cascade,
  branch_id   uuid not null references public.branches (id),
  job_title   text,
  specialties text[] not null default '{}',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- ---------------------------------------------------------------------
-- 5. devices
-- ---------------------------------------------------------------------
create table public.devices (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references public.customers (id),
  branch_id     uuid not null references public.branches (id),
  device_type   public.device_type not null default 'PHONE',
  brand         text not null,
  model         text not null,
  color         text,
  imei          text,
  serial_number text,
  -- رمز قفل الجهاز مشفّر (pgp_sym_encrypt) — لا يُخزّن كنص عادي أبداً
  passcode_encrypted bytea,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  constraint devices_imei_format check (imei is null or imei ~ '^[0-9]{14,16}$')
);
create index devices_customer_idx on public.devices (customer_id);
create index devices_imei_idx on public.devices (imei);
create index devices_serial_idx on public.devices (serial_number);

-- ---------------------------------------------------------------------
-- 7. repair_orders  (declared before bookings so bookings can FK it)
-- ---------------------------------------------------------------------
create table public.repair_orders (
  id                 uuid primary key default gen_random_uuid(),
  order_number       text unique,                    -- KMR-2026-000001 (assigned at device receipt)
  branch_id          uuid not null references public.branches (id),
  customer_id        uuid not null references public.customers (id),
  device_id          uuid not null references public.devices (id),
  status             public.repair_status not null default 'NEW_REQUEST',
  issue_description  text not null,
  intake_condition   text,                            -- الحالة الخارجية عند الاستلام
  intake_damages     jsonb not null default '[]'::jsonb, -- خدوش/كسور [{area, note}]
  accessories        text[] not null default '{}',
  received_at        timestamptz,
  received_by        uuid references public.profiles (id),
  expected_ready_at  timestamptz,
  current_technician_id uuid references public.employees (id),
  repair_report      text,
  test_passed        boolean,
  test_notes         text,
  quoted_cost        numeric(12,2) check (quoted_cost is null or quoted_cost >= 0),
  approved_cost      numeric(12,2) check (approved_cost is null or approved_cost >= 0),
  warranty_days      integer not null default 0 check (warranty_days >= 0),
  tracking_token     text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  parent_order_id    uuid references public.repair_orders (id), -- إعادة إصلاح (rework)
  is_rework          boolean not null default false,
  internal_notes     text,
  completed_at       timestamptz,   -- وقت إرسال الفني للاعتماد
  ready_at           timestamptz,   -- وقت اعتماد المدير
  delivered_at       timestamptz,
  cancelled_at       timestamptz,
  cancel_reason      text,
  version            integer not null default 1,      -- optimistic concurrency
  created_by         uuid references public.profiles (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  constraint repair_orders_number_format check (order_number is null or order_number ~ '^KMR-[0-9]{4}-[0-9]{6}$')
);
create index repair_orders_status_idx on public.repair_orders (branch_id, status);
create index repair_orders_customer_idx on public.repair_orders (customer_id);
create index repair_orders_tech_idx on public.repair_orders (current_technician_id);
create index repair_orders_received_idx on public.repair_orders (received_at);

-- ---------------------------------------------------------------------
-- 6. bookings
-- ---------------------------------------------------------------------
create table public.bookings (
  id                 uuid primary key default gen_random_uuid(),
  branch_id          uuid not null references public.branches (id),
  customer_id        uuid not null references public.customers (id),
  device_id          uuid not null references public.devices (id),
  repair_order_id    uuid not null unique references public.repair_orders (id),
  issue_description  text not null,
  preferred_at       timestamptz not null,
  confirmed_at       timestamptz,       -- الموعد المؤكد
  proposed_at        timestamptz,       -- موعد مقترح من المحل
  status             public.booking_status not null default 'PENDING',
  reject_reason      text,
  staff_note         text,
  created_by         uuid references public.profiles (id),
  handled_by         uuid references public.profiles (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index bookings_status_idx on public.bookings (branch_id, status, preferred_at);
create index bookings_customer_idx on public.bookings (customer_id);

alter table public.repair_orders add column booking_id uuid unique references public.bookings (id);

-- ---------------------------------------------------------------------
-- 8. repair_status_history  (append-only timeline of every event)
-- ---------------------------------------------------------------------
create table public.repair_status_history (
  id               uuid primary key default gen_random_uuid(),
  repair_order_id  uuid not null references public.repair_orders (id),
  event_type       text not null,   -- CREATED, STATUS_CHANGED, TECH_ASSIGNED, TECH_ACCEPTED, ...
  from_status      public.repair_status,
  to_status        public.repair_status,
  actor_profile_id uuid references public.profiles (id),
  actor_role       public.app_role,
  public_note      text,            -- يظهر للعميل
  internal_note    text,            -- داخلي فقط
  visible_to_customer boolean not null default false,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
create index rsh_order_idx on public.repair_status_history (repair_order_id, created_at);

-- ---------------------------------------------------------------------
-- 9. technician_assignments  (full history of technician changes)
-- ---------------------------------------------------------------------
create table public.technician_assignments (
  id               uuid primary key default gen_random_uuid(),
  repair_order_id  uuid not null references public.repair_orders (id),
  technician_id    uuid not null references public.employees (id),
  assigned_by      uuid not null references public.profiles (id),
  assigned_at      timestamptz not null default now(),
  accepted_at      timestamptz,
  ended_at         timestamptz,
  end_reason       text,
  is_current       boolean not null default true
);
create unique index ta_one_current_uidx on public.technician_assignments (repair_order_id) where is_current;
create index ta_tech_idx on public.technician_assignments (technician_id, is_current);

-- ---------------------------------------------------------------------
-- 10. diagnostics
-- ---------------------------------------------------------------------
create table public.diagnostics (
  id                uuid primary key default gen_random_uuid(),
  repair_order_id   uuid not null references public.repair_orders (id),
  technician_id     uuid not null references public.employees (id),
  findings          text not null,
  fault_category    text,              -- لتقرير "أكثر الأعطال تكراراً"
  proposed_solution text not null,
  estimated_minutes integer check (estimated_minutes is null or estimated_minutes >= 0),
  customer_summary  text,              -- ملخص يظهر للعميل بعد الاعتماد
  status            public.diagnostic_status not null default 'SUBMITTED',
  submitted_at      timestamptz not null default now(),
  reviewed_by       uuid references public.profiles (id),
  reviewed_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index diagnostics_order_idx on public.diagnostics (repair_order_id, created_at);
create index diagnostics_fault_idx on public.diagnostics (fault_category);

-- ---------------------------------------------------------------------
-- 11. spare_parts  (catalog only — no stock balances in this edition)
-- ---------------------------------------------------------------------
create table public.spare_parts (
  id                uuid primary key default gen_random_uuid(),
  branch_id         uuid not null references public.branches (id),
  name              text not null,
  brand             text,
  part_number       text,
  compatible_models text[] not null default '{}',
  default_price     numeric(12,2) not null default 0 check (default_price >= 0),
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);
create index spare_parts_name_idx on public.spare_parts (name);

-- ---------------------------------------------------------------------
-- 12. repair_parts  (price snapshot at time of use)
-- ---------------------------------------------------------------------
create table public.repair_parts (
  id               uuid primary key default gen_random_uuid(),
  repair_order_id  uuid not null references public.repair_orders (id),
  spare_part_id    uuid references public.spare_parts (id),
  diagnostic_id    uuid references public.diagnostics (id),
  part_name        text not null,
  qty              integer not null default 1 check (qty > 0),
  unit_price       numeric(12,2) not null default 0 check (unit_price >= 0),
  status           public.part_status not null default 'REQUIRED',
  added_by         uuid references public.profiles (id),
  installed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index repair_parts_order_idx on public.repair_parts (repair_order_id);

-- ---------------------------------------------------------------------
-- 13. customer_approvals  (never deleted; one row per quote version)
-- ---------------------------------------------------------------------
create table public.customer_approvals (
  id               uuid primary key default gen_random_uuid(),
  repair_order_id  uuid not null references public.repair_orders (id),
  diagnostic_id    uuid references public.diagnostics (id),
  amount           numeric(12,2) not null check (amount >= 0),
  customer_details text not null,          -- وصف العطل والحل كما يراه العميل
  parts_summary    jsonb not null default '[]'::jsonb,
  status           public.approval_status not null default 'PENDING',
  token_hash       text not null unique,   -- sha256 للرابط الآمن (الرمز نفسه لا يُخزّن)
  token_expires_at timestamptz not null,
  requested_by     uuid not null references public.profiles (id),
  requested_at     timestamptz not null default now(),
  responded_at     timestamptz,
  responded_via    public.approval_channel,
  responded_by     uuid references public.profiles (id),
  response_note    text,
  created_at       timestamptz not null default now()
);
create unique index ca_one_pending_uidx on public.customer_approvals (repair_order_id) where status = 'PENDING';
create index ca_order_idx on public.customer_approvals (repair_order_id, requested_at);

-- ---------------------------------------------------------------------
-- 14. notifications  (logical notification; dedupe_key prevents duplicates)
-- ---------------------------------------------------------------------
create table public.notifications (
  id               uuid primary key default gen_random_uuid(),
  branch_id        uuid not null references public.branches (id),
  recipient_profile_id uuid references public.profiles (id),  -- مستلم داخل التطبيق
  customer_id      uuid references public.customers (id),     -- عميل (واتساب/تطبيق)
  repair_order_id  uuid references public.repair_orders (id),
  event_key        text not null,          -- e.g. DEVICE_RECEIVED, READY_FOR_PICKUP, STAFF_APPROVAL_NEEDED
  audience         text not null check (audience in ('CUSTOMER', 'STAFF')),
  title            text not null,
  body             text not null,
  template_name    text,                   -- اسم قالب واتساب المعتمد
  template_params  jsonb not null default '[]'::jsonb,
  channels         public.notify_channel[] not null default '{IN_APP}',
  dedupe_key       text not null unique,
  read_at          timestamptz,
  created_at       timestamptz not null default now()
);
create index notifications_recipient_idx on public.notifications (recipient_profile_id, created_at desc);
create index notifications_customer_idx on public.notifications (customer_id, created_at desc);

-- ---------------------------------------------------------------------
-- 15. notification_logs  (one row per channel delivery, retries tracked)
-- ---------------------------------------------------------------------
create table public.notification_logs (
  id                  uuid primary key default gen_random_uuid(),
  notification_id     uuid not null references public.notifications (id),
  channel             public.notify_channel not null,
  status              public.notify_status not null default 'QUEUED',
  attempts            integer not null default 0,
  max_attempts        integer not null default 5,
  next_attempt_at     timestamptz not null default now(),
  provider_message_id text,
  last_error          text,
  sent_at             timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (notification_id, channel)
);
create index notification_logs_queue_idx on public.notification_logs (status, next_attempt_at);

-- ---------------------------------------------------------------------
-- 16. device_media  (files live in private storage bucket "device-media")
-- ---------------------------------------------------------------------
create table public.device_media (
  id                  uuid primary key default gen_random_uuid(),
  repair_order_id     uuid references public.repair_orders (id),
  booking_id          uuid references public.bookings (id),
  device_id           uuid not null references public.devices (id),
  storage_path        text not null unique,
  kind                public.media_kind not null,
  caption             text,
  visible_to_customer boolean not null default false,
  uploaded_by         uuid references public.profiles (id),
  created_at          timestamptz not null default now(),
  deleted_at          timestamptz
);
create index device_media_order_idx on public.device_media (repair_order_id);

-- ---------------------------------------------------------------------
-- 17. handover_records
-- ---------------------------------------------------------------------
create table public.handover_records (
  id                  uuid primary key default gen_random_uuid(),
  repair_order_id     uuid not null unique references public.repair_orders (id),
  outcome             public.handover_outcome not null,
  handed_by           uuid not null references public.profiles (id),
  handed_at           timestamptz not null default now(),
  received_by_name    text not null,
  received_by_phone   text,
  verification_method text not null,   -- PHONE_MATCH / ORDER_QR / NATIONAL_ID ...
  notes               text,
  created_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 18. audit_logs  (append-only)
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id          bigint generated always as identity primary key,
  actor_id    uuid,
  actor_role  public.app_role,
  action      text not null,
  table_name  text,
  record_id   uuid,
  old_data    jsonb,
  new_data    jsonb,
  created_at  timestamptz not null default now()
);
create index audit_logs_record_idx on public.audit_logs (table_name, record_id);

-- ---------------------------------------------------------------------
-- 19. customer_reviews
-- ---------------------------------------------------------------------
create table public.customer_reviews (
  id               uuid primary key default gen_random_uuid(),
  repair_order_id  uuid not null unique references public.repair_orders (id),
  customer_id      uuid not null references public.customers (id),
  rating           smallint not null check (rating between 1 and 5),
  comment          text,
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 20. repair_settings (per branch)
-- ---------------------------------------------------------------------
create table public.repair_settings (
  id                     uuid primary key default gen_random_uuid(),
  branch_id              uuid not null unique references public.branches (id),
  default_eta_hours      integer not null default 48 check (default_eta_hours > 0),
  delay_threshold_hours  integer not null default 24 check (delay_threshold_hours >= 0),
  approval_link_ttl_hours integer not null default 72 check (approval_link_ttl_hours > 0),
  default_warranty_days  integer not null default 30 check (default_warranty_days >= 0),
  receipt_terms          text not null default '',
  warranty_terms         text not null default '',
  tracking_base_url      text not null default '',
  whatsapp_enabled       boolean not null default false,
  push_enabled           boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Support tables (not user-facing)
-- ---------------------------------------------------------------------
-- push tokens for FCM / APNs
create table public.push_tokens (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  token       text not null unique,
  platform    text not null check (platform in ('android', 'ios', 'web')),
  created_at  timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- idempotency for sensitive RPCs
create table private.idempotency_keys (
  actor_id    uuid not null,
  operation   text not null,
  key         text not null,
  result      jsonb,
  created_at  timestamptz not null default now(),
  primary key (actor_id, operation, key)
);

-- yearly order counter -> KMR-YYYY-NNNNNN
create table private.order_counters (
  year        integer primary key,
  last_value  integer not null default 0
);

-- server-side secrets (e.g. passcode encryption key). Never exposed.
create table private.app_secrets (
  name   text primary key,
  value  text not null
);
insert into private.app_secrets (name, value)
values ('passcode_key', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict do nothing;

-- ---------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['branches','profiles','customers','employees','devices','repair_orders',
                           'bookings','diagnostics','spare_parts','repair_parts','notification_logs','repair_settings']
  loop
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function public.tg_set_updated_at()', t);
  end loop;
end $$;
