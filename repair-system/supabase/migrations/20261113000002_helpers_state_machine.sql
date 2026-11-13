-- =====================================================================
-- Migration 002: auth helpers, state machine, immutability, audit,
--                customer-safe tracking projection, notification queue
-- =====================================================================

-- ---------------------------------------------------------------------
-- Auth / role helpers  (SECURITY DEFINER to avoid RLS recursion)
-- ---------------------------------------------------------------------
create or replace function public.current_app_role()
returns public.app_role
language sql stable security definer set search_path = public, pg_temp as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.is_active
$$;

create or replace function public.has_any_role(roles public.app_role[])
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.current_app_role() = any (roles), false)
$$;

create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.has_any_role(array['ADMIN','MANAGER']::public.app_role[])
$$;

create or replace function public.is_front_office()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.has_any_role(array['ADMIN','MANAGER','RECEPTIONIST']::public.app_role[])
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.has_any_role(array['ADMIN','MANAGER','RECEPTIONIST','TECHNICIAN']::public.app_role[])
$$;

create or replace function public.current_employee_id()
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select e.id from public.employees e
  where e.profile_id = auth.uid() and e.is_active and e.deleted_at is null
$$;

create or replace function public.current_customer_id()
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select c.id from public.customers c
  where c.profile_id = auth.uid() and c.deleted_at is null
$$;

-- ADMIN sees every branch; other staff see their own branch only.
create or replace function public.can_access_branch(p_branch uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active
      and (p.role = 'ADMIN' or p.branch_id = p_branch)
  )
$$;

create or replace function public.is_assigned_technician(p_order uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.technician_assignments ta
    where ta.repair_order_id = p_order and ta.is_current
      and ta.technician_id = public.current_employee_id()
  )
$$;

-- ---------------------------------------------------------------------
-- Arabic labels (single source in DB; mirrored in packages/shared)
-- ---------------------------------------------------------------------
create or replace function public.repair_status_label(s public.repair_status)
returns text language sql immutable as $$
  select case s
    when 'NEW_REQUEST' then 'طلب جديد'
    when 'BOOKING_CONFIRMED' then 'تم تأكيد الحجز'
    when 'DEVICE_RECEIVED' then 'تم استلام الجهاز'
    when 'UNDER_DIAGNOSIS' then 'تحت الفحص'
    when 'WAITING_CUSTOMER_APPROVAL' then 'انتظار موافقة العميل'
    when 'CUSTOMER_APPROVED' then 'تمت الموافقة'
    when 'CUSTOMER_REJECTED' then 'تم رفض الإصلاح'
    when 'WAITING_SPARE_PART' then 'انتظار قطعة غيار'
    when 'UNDER_REPAIR' then 'تحت الصيانة'
    when 'UNDER_TESTING' then 'تحت الاختبار'
    when 'WAITING_MANAGER_APPROVAL' then 'انتظار اعتماد المدير'
    when 'READY_FOR_PICKUP' then 'جاهز للاستلام'
    when 'DELIVERED' then 'تم التسليم'
    when 'CANCELLED' then 'ملغي'
  end
$$;

-- ---------------------------------------------------------------------
-- State machine: the ONLY legal transitions.
--   actors: role names and/or the special token ASSIGNED_TECH
--   via_rpc: when not null, the transition is only allowed through that RPC
-- ---------------------------------------------------------------------
create table public.status_transitions (
  from_status public.repair_status not null,
  to_status   public.repair_status not null,
  actors      text[] not null,
  via_rpc     text,
  primary key (from_status, to_status)
);

insert into public.status_transitions (from_status, to_status, actors, via_rpc) values
  ('NEW_REQUEST',              'BOOKING_CONFIRMED',        '{ADMIN,MANAGER,RECEPTIONIST}', 'confirm_booking'),
  ('NEW_REQUEST',              'DEVICE_RECEIVED',          '{ADMIN,MANAGER,RECEPTIONIST}', 'receive_device'),
  ('NEW_REQUEST',              'CANCELLED',                '{ADMIN,MANAGER,RECEPTIONIST,CUSTOMER}', 'cancel_booking'),
  ('BOOKING_CONFIRMED',        'DEVICE_RECEIVED',          '{ADMIN,MANAGER,RECEPTIONIST}', 'receive_device'),
  ('BOOKING_CONFIRMED',        'CANCELLED',                '{ADMIN,MANAGER,RECEPTIONIST,CUSTOMER}', 'cancel_booking'),
  ('DEVICE_RECEIVED',          'UNDER_DIAGNOSIS',          '{ASSIGNED_TECH}', null),
  ('DEVICE_RECEIVED',          'READY_FOR_PICKUP',         '{ADMIN,MANAGER}', null),           -- العميل سحب الجهاز قبل الفحص
  ('UNDER_DIAGNOSIS',          'WAITING_CUSTOMER_APPROVAL','{ADMIN,MANAGER}', 'send_quote'),
  ('UNDER_DIAGNOSIS',          'READY_FOR_PICKUP',         '{ADMIN,MANAGER}', null),           -- غير قابل للإصلاح
  ('WAITING_CUSTOMER_APPROVAL','CUSTOMER_APPROVED',        '{CUSTOMER,ADMIN,MANAGER,RECEPTIONIST}', 'respond_quote'),
  ('WAITING_CUSTOMER_APPROVAL','CUSTOMER_REJECTED',        '{CUSTOMER,ADMIN,MANAGER,RECEPTIONIST}', 'respond_quote'),
  ('WAITING_CUSTOMER_APPROVAL','UNDER_DIAGNOSIS',          '{ADMIN,MANAGER}', 'withdraw_quote'),
  ('CUSTOMER_APPROVED',        'UNDER_REPAIR',             '{ASSIGNED_TECH}', null),
  ('CUSTOMER_APPROVED',        'WAITING_SPARE_PART',       '{ASSIGNED_TECH,ADMIN,MANAGER}', null),
  ('CUSTOMER_REJECTED',        'READY_FOR_PICKUP',         '{ADMIN,MANAGER}', null),
  ('CUSTOMER_REJECTED',        'WAITING_CUSTOMER_APPROVAL','{ADMIN,MANAGER}', 'send_quote'),
  ('WAITING_SPARE_PART',       'UNDER_REPAIR',             '{ASSIGNED_TECH}', null),
  ('WAITING_SPARE_PART',       'WAITING_CUSTOMER_APPROVAL','{ADMIN,MANAGER}', 'send_quote'),
  ('UNDER_REPAIR',             'WAITING_SPARE_PART',       '{ASSIGNED_TECH,ADMIN,MANAGER}', null),
  ('UNDER_REPAIR',             'UNDER_TESTING',            '{ASSIGNED_TECH}', null),
  ('UNDER_REPAIR',             'UNDER_DIAGNOSIS',          '{ASSIGNED_TECH,ADMIN,MANAGER}', null),
  ('UNDER_REPAIR',             'WAITING_CUSTOMER_APPROVAL','{ADMIN,MANAGER}', 'send_quote'),
  ('UNDER_TESTING',            'UNDER_REPAIR',             '{ASSIGNED_TECH}', null),
  ('UNDER_TESTING',            'WAITING_MANAGER_APPROVAL', '{ASSIGNED_TECH}', 'finish_repair'),
  ('WAITING_MANAGER_APPROVAL', 'READY_FOR_PICKUP',         '{ADMIN,MANAGER}', 'approve_completion'),
  ('WAITING_MANAGER_APPROVAL', 'UNDER_REPAIR',             '{ADMIN,MANAGER}', 'request_recheck'),
  ('WAITING_MANAGER_APPROVAL', 'UNDER_DIAGNOSIS',          '{ADMIN,MANAGER}', 'request_recheck'),
  ('READY_FOR_PICKUP',         'DELIVERED',                '{ADMIN,MANAGER}', 'deliver_device');

-- ---------------------------------------------------------------------
-- Order number: KMR-YYYY-NNNNNN (atomic, gap-tolerant, never duplicated)
-- ---------------------------------------------------------------------
create or replace function private.next_order_number()
returns text language plpgsql security definer set search_path = private, public, pg_temp as $$
declare
  y integer := extract(year from (now() at time zone 'Africa/Cairo'))::integer;
  n integer;
begin
  insert into private.order_counters as c (year, last_value) values (y, 1)
  on conflict (year) do update set last_value = c.last_value + 1
  returning last_value into n;
  return 'KMR-' || y || '-' || lpad(n::text, 6, '0');
end $$;

-- ---------------------------------------------------------------------
-- repair_orders BEFORE trigger: validates transitions on EVERY write path
-- (RPC, service role, SQL editor) + stamps timestamps / version / number.
-- ---------------------------------------------------------------------
create or replace function public.tg_repair_orders_before()
returns trigger language plpgsql security definer set search_path = public, private, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if new.status not in ('NEW_REQUEST', 'DEVICE_RECEIVED') then
      raise exception 'INVALID_INITIAL_STATUS: %', new.status using errcode = 'P0001';
    end if;
  else
    if new.order_number is distinct from old.order_number and old.order_number is not null then
      raise exception 'ORDER_NUMBER_IMMUTABLE' using errcode = 'P0001';
    end if;
    if new.tracking_token is distinct from old.tracking_token then
      raise exception 'TRACKING_TOKEN_IMMUTABLE' using errcode = 'P0001';
    end if;
    if new.status is distinct from old.status then
      if not exists (select 1 from public.status_transitions t
                     where t.from_status = old.status and t.to_status = new.status) then
        raise exception 'INVALID_TRANSITION: % -> %', old.status, new.status using errcode = 'P0001';
      end if;
    end if;
    new.version := old.version + 1;
  end if;

  if new.status = 'DEVICE_RECEIVED' and (tg_op = 'INSERT' or old.status is distinct from 'DEVICE_RECEIVED') then
    if new.order_number is null then
      new.order_number := private.next_order_number();
    end if;
    new.received_at := coalesce(new.received_at, now());
  end if;
  if new.status = 'WAITING_MANAGER_APPROVAL' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    new.completed_at := now();
  end if;
  if new.status = 'READY_FOR_PICKUP' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    new.ready_at := now();
  end if;
  if new.status = 'DELIVERED' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    new.delivered_at := now();
  end if;
  if new.status = 'CANCELLED' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    new.cancelled_at := now();
  end if;
  return new;
end $$;

create trigger repair_orders_before
before insert or update on public.repair_orders
for each row execute function public.tg_repair_orders_before();

-- ---------------------------------------------------------------------
-- Timeline writer (used by RPCs and by the status trigger)
-- Notes passed by RPCs via transaction-local settings kmr.public_note /
-- kmr.internal_note / kmr.event_meta.
-- ---------------------------------------------------------------------
create or replace function public.log_order_event(
  p_order uuid, p_event text,
  p_from public.repair_status default null, p_to public.repair_status default null,
  p_public_note text default null, p_internal_note text default null,
  p_visible boolean default false, p_meta jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  insert into public.repair_status_history
    (repair_order_id, event_type, from_status, to_status, actor_profile_id, actor_role,
     public_note, internal_note, visible_to_customer, metadata)
  values
    (p_order, p_event, p_from, p_to, auth.uid(), public.current_app_role(),
     p_public_note, p_internal_note, p_visible, coalesce(p_meta, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.log_order_event(uuid, text, public.repair_status, public.repair_status, text, text, boolean, jsonb) from public;

create or replace function public.tg_repair_orders_after()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_order_event(new.id, 'CREATED', null, new.status,
      nullif(current_setting('kmr.public_note', true), ''),
      nullif(current_setting('kmr.internal_note', true), ''),
      true, coalesce(nullif(current_setting('kmr.event_meta', true), '')::jsonb, '{}'::jsonb));
  elsif new.status is distinct from old.status then
    perform public.log_order_event(new.id, 'STATUS_CHANGED', old.status, new.status,
      nullif(current_setting('kmr.public_note', true), ''),
      nullif(current_setting('kmr.internal_note', true), ''),
      true, coalesce(nullif(current_setting('kmr.event_meta', true), '')::jsonb, '{}'::jsonb));
  end if;
  perform public.refresh_customer_tracking(new.id);
  return null;
end $$;

-- ---------------------------------------------------------------------
-- Immutability guards
-- ---------------------------------------------------------------------
create or replace function public.tg_block_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'IMMUTABLE_RECORD: % on % is not allowed', tg_op, tg_table_name using errcode = 'P0001';
end $$;

create trigger rsh_no_update before update or delete on public.repair_status_history
  for each row execute function public.tg_block_mutation();
create trigger rsh_no_truncate before truncate on public.repair_status_history
  for each statement execute function public.tg_block_mutation();
create trigger audit_no_update before update or delete on public.audit_logs
  for each row execute function public.tg_block_mutation();
create trigger audit_no_truncate before truncate on public.audit_logs
  for each statement execute function public.tg_block_mutation();
create trigger handover_no_update before update or delete on public.handover_records
  for each row execute function public.tg_block_mutation();
create trigger approvals_no_delete before delete on public.customer_approvals
  for each row execute function public.tg_block_mutation();
create trigger approvals_no_truncate before truncate on public.customer_approvals
  for each statement execute function public.tg_block_mutation();
create trigger assignments_no_delete before delete on public.technician_assignments
  for each row execute function public.tg_block_mutation();
create trigger reviews_no_delete before delete on public.customer_reviews
  for each row execute function public.tg_block_mutation();

-- customer_approvals: only a PENDING row may change, and only its response fields.
create or replace function public.tg_approvals_guard()
returns trigger language plpgsql as $$
begin
  if old.status <> 'PENDING' then
    raise exception 'APPROVAL_FINALIZED' using errcode = 'P0001';
  end if;
  if new.amount <> old.amount or new.customer_details <> old.customer_details
     or new.repair_order_id <> old.repair_order_id or new.token_hash <> old.token_hash
     or new.requested_at <> old.requested_at or new.requested_by <> old.requested_by then
    raise exception 'APPROVAL_TERMS_IMMUTABLE' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger approvals_guard before update on public.customer_approvals
  for each row execute function public.tg_approvals_guard();

-- technician_assignments: history rows can only be closed / accepted, never rewritten.
create or replace function public.tg_assignments_guard()
returns trigger language plpgsql as $$
begin
  if new.repair_order_id <> old.repair_order_id or new.technician_id <> old.technician_id
     or new.assigned_by <> old.assigned_by or new.assigned_at <> old.assigned_at then
    raise exception 'ASSIGNMENT_HISTORY_IMMUTABLE' using errcode = 'P0001';
  end if;
  if old.ended_at is not null then
    raise exception 'ASSIGNMENT_CLOSED' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger assignments_guard before update on public.technician_assignments
  for each row execute function public.tg_assignments_guard();

-- repair_parts: price snapshot is frozen once the part is installed.
create or replace function public.tg_repair_parts_guard()
returns trigger language plpgsql as $$
begin
  if old.status = 'INSTALLED' and (new.unit_price <> old.unit_price or new.qty <> old.qty or new.part_name <> old.part_name) then
    raise exception 'INSTALLED_PART_IMMUTABLE' using errcode = 'P0001';
  end if;
  if new.status = 'INSTALLED' and old.status <> 'INSTALLED' then
    new.installed_at := now();
  end if;
  return new;
end $$;
create trigger repair_parts_guard before update on public.repair_parts
  for each row execute function public.tg_repair_parts_guard();
create trigger repair_parts_no_delete before delete on public.repair_parts
  for each row execute function public.tg_block_mutation();

-- ---------------------------------------------------------------------
-- Audit log (generic). Secrets are stripped before logging.
-- ---------------------------------------------------------------------
create or replace function public.tg_audit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o jsonb; n jsonb;
  strip text[] := array['passcode_encrypted','token_hash','tracking_token'];
begin
  if tg_op in ('UPDATE','DELETE') then o := to_jsonb(old) - strip; end if;
  if tg_op in ('UPDATE','INSERT') then n := to_jsonb(new) - strip; end if;
  if tg_op = 'UPDATE' and o = n then return null; end if;
  insert into public.audit_logs (actor_id, actor_role, action, table_name, record_id, old_data, new_data)
  values (auth.uid(), public.current_app_role(), tg_op, tg_table_name,
          coalesce((n->>'id')::uuid, (o->>'id')::uuid), o, n);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['branches','profiles','customers','employees','devices','bookings','repair_orders',
                           'technician_assignments','diagnostics','spare_parts','repair_parts',
                           'customer_approvals','device_media','handover_records','repair_settings','customer_reviews']
  loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I
                    for each row execute function public.tg_audit()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Customer-safe tracking projection.
-- Customers NEVER read repair_orders directly (it holds technician ids and
-- internal notes). They read this projection, which is also published to
-- Realtime so their screen updates live.
-- ---------------------------------------------------------------------
create table public.customer_tracking (
  repair_order_id   uuid primary key references public.repair_orders (id),
  customer_id       uuid not null references public.customers (id),
  branch_id         uuid not null references public.branches (id),
  booking_id        uuid,
  order_number      text,
  status            public.repair_status not null,
  status_label      text not null,
  device_type       public.device_type not null,
  device_brand      text not null,
  device_model      text not null,
  issue_description text not null,
  received_at       timestamptz,
  expected_ready_at timestamptz,
  approved_cost     numeric(12,2),
  pending_approval_id uuid,
  pending_amount    numeric(12,2),
  diagnosis_summary text,
  warranty_days     integer not null default 0,
  last_update_at    timestamptz not null default now()
);
create index customer_tracking_customer_idx on public.customer_tracking (customer_id);

create or replace function public.refresh_customer_tracking(p_order uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.customer_tracking as ct (
    repair_order_id, customer_id, branch_id, booking_id, order_number, status, status_label,
    device_type, device_brand, device_model, issue_description, received_at, expected_ready_at,
    approved_cost, pending_approval_id, pending_amount, diagnosis_summary, warranty_days, last_update_at)
  select ro.id, ro.customer_id, ro.branch_id, ro.booking_id, ro.order_number, ro.status,
         public.repair_status_label(ro.status), d.device_type, d.brand, d.model, ro.issue_description,
         ro.received_at, ro.expected_ready_at, ro.approved_cost, ca.id, ca.amount,
         (select ca2.customer_details from public.customer_approvals ca2
            where ca2.repair_order_id = ro.id order by ca2.requested_at desc limit 1),
         ro.warranty_days, now()
  from public.repair_orders ro
  join public.devices d on d.id = ro.device_id
  left join public.customer_approvals ca on ca.repair_order_id = ro.id and ca.status = 'PENDING'
  where ro.id = p_order
  on conflict (repair_order_id) do update set
    customer_id = excluded.customer_id, booking_id = excluded.booking_id,
    order_number = excluded.order_number, status = excluded.status, status_label = excluded.status_label,
    device_type = excluded.device_type, device_brand = excluded.device_brand, device_model = excluded.device_model,
    issue_description = excluded.issue_description, received_at = excluded.received_at,
    expected_ready_at = excluded.expected_ready_at, approved_cost = excluded.approved_cost,
    pending_approval_id = excluded.pending_approval_id, pending_amount = excluded.pending_amount,
    diagnosis_summary = excluded.diagnosis_summary, warranty_days = excluded.warranty_days,
    last_update_at = now();
end $$;
revoke all on function public.refresh_customer_tracking(uuid) from public;

create trigger repair_orders_after
after insert or update on public.repair_orders
for each row execute function public.tg_repair_orders_after();

create or replace function public.tg_approvals_after()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.refresh_customer_tracking(new.repair_order_id);
  return null;
end $$;
create trigger approvals_after after insert or update on public.customer_approvals
  for each row execute function public.tg_approvals_after();

-- ---------------------------------------------------------------------
-- Notification queue.
-- Every STATUS_CHANGED / CREATED timeline row enqueues (at most once —
-- dedupe_key is unique and derived from the timeline row id) customer
-- and staff notifications. Delivery to WhatsApp/FCM is done by the
-- Edge Function dispatcher reading notification_logs (QUEUED rows).
-- ---------------------------------------------------------------------
create or replace function public.enqueue_notification(
  p_branch uuid, p_audience text, p_recipient uuid, p_customer uuid, p_order uuid,
  p_event text, p_title text, p_body text, p_template text, p_params jsonb,
  p_channels public.notify_channel[], p_dedupe text
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; ch public.notify_channel;
begin
  insert into public.notifications
    (branch_id, audience, recipient_profile_id, customer_id, repair_order_id, event_key,
     title, body, template_name, template_params, channels, dedupe_key)
  values (p_branch, p_audience, p_recipient, p_customer, p_order, p_event,
          p_title, p_body, p_template, coalesce(p_params, '[]'::jsonb), p_channels, p_dedupe)
  on conflict (dedupe_key) do nothing
  returning id into v_id;

  if v_id is null then
    return null;  -- duplicate: already queued once
  end if;

  foreach ch in array p_channels loop
    if ch <> 'IN_APP' then
      insert into public.notification_logs (notification_id, channel)
      values (v_id, ch) on conflict (notification_id, channel) do nothing;
    end if;
  end loop;
  return v_id;
end $$;
revoke all on function public.enqueue_notification(uuid, text, uuid, uuid, uuid, text, text, text, text, jsonb, public.notify_channel[], text) from public;

create or replace function public.tg_history_notify()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ro         public.repair_orders;
  cust       public.customers;
  st         public.repair_settings;
  v_title    text;
  v_body     text;
  v_template text;
  v_params   jsonb;
  v_url      text;
  v_ch       public.notify_channel[];
  v_staff_ch public.notify_channel[];
  v_bname    text;
  r          record;
begin
  if new.event_type not in ('CREATED', 'STATUS_CHANGED') or new.to_status is null then
    return null;
  end if;

  select * into ro from public.repair_orders where id = new.repair_order_id;
  select * into cust from public.customers where id = ro.customer_id;
  select * into st from public.repair_settings where branch_id = ro.branch_id;
  select name into v_bname from public.branches where id = ro.branch_id;

  v_url := coalesce(nullif(st.tracking_base_url, ''), '') || '/track/' || ro.tracking_token;
  v_ch := array['IN_APP']::public.notify_channel[];
  if coalesce(st.whatsapp_enabled, false) then v_ch := v_ch || 'WHATSAPP'::public.notify_channel; end if;
  if coalesce(st.push_enabled, false) and cust.profile_id is not null then v_ch := v_ch || 'FCM'::public.notify_channel; end if;
  v_staff_ch := array['IN_APP']::public.notify_channel[];
  if coalesce(st.push_enabled, false) then v_staff_ch := v_staff_ch || 'FCM'::public.notify_channel; end if;

  -- ------------------------ customer messages ------------------------
  v_title := null; v_template := null;
  v_params := jsonb_build_array(coalesce(ro.order_number, ''), v_url);
  case new.to_status
    when 'BOOKING_CONFIRMED' then
      v_title := 'تم تأكيد حجزك';
      v_body := 'تم تأكيد موعد حجز الصيانة في ' || v_bname || '. نسعد بزيارتك.';
      v_template := 'kmr_booking_confirmed';
      v_params := jsonb_build_array(to_char((select b.confirmed_at at time zone 'Africa/Cairo' from public.bookings b where b.id = ro.booking_id), 'YYYY-MM-DD HH24:MI'));
    when 'DEVICE_RECEIVED' then
      v_title := 'تم استلام جهازك';
      v_body := 'مرحبًا بك في خالد لصيانة المحمول. تم استلام جهازك بنجاح. رقم طلب الصيانة: '
                || ro.order_number || '. يمكنك متابعة حالة جهازك من الرابط: ' || v_url;
      v_template := 'kmr_device_received';
    when 'UNDER_DIAGNOSIS' then
      v_title := 'بدأ فحص جهازك';
      v_body := 'بدأ فحص جهازك. رقم الطلب: ' || ro.order_number;
      v_template := 'kmr_status_update';
      v_params := jsonb_build_array(ro.order_number, 'تحت الفحص', v_url);
    when 'WAITING_CUSTOMER_APPROVAL' then
      v_title := 'تقرير الفحص والتكلفة جاهزين';
      v_body := 'انتهى فحص جهازك والتكلفة المقترحة ' || coalesce(ro.quoted_cost::text, '') ||
                ' ج.م. برجاء الموافقة أو الرفض من الرابط: ' ||
                coalesce(nullif(current_setting('kmr.approval_url', true), ''), v_url);
      v_template := 'kmr_quote_ready';
      v_params := jsonb_build_array(ro.order_number, coalesce(ro.quoted_cost::text, ''),
                  coalesce(nullif(current_setting('kmr.approval_url', true), ''), v_url));
    when 'CUSTOMER_APPROVED' then
      v_title := 'تم تسجيل موافقتك';
      v_body := 'تم تسجيل موافقتك على تكلفة الإصلاح. سنبدأ العمل على جهازك.';
      v_template := 'kmr_status_update';
      v_params := jsonb_build_array(ro.order_number, 'تمت الموافقة', v_url);
    when 'CUSTOMER_REJECTED' then
      v_title := 'تم تسجيل رفض الإصلاح';
      v_body := 'تم تسجيل رفضك للإصلاح. سنبلغك عند تجهيز الجهاز للاستلام.';
      v_template := 'kmr_status_update';
      v_params := jsonb_build_array(ro.order_number, 'تم رفض الإصلاح', v_url);
    when 'WAITING_SPARE_PART' then
      v_title := 'جهازك في انتظار قطعة غيار';
      v_body := 'جهازك في انتظار وصول قطعة الغيار المطلوبة. رقم الطلب: ' || ro.order_number;
      v_template := 'kmr_status_update';
      v_params := jsonb_build_array(ro.order_number, 'انتظار قطعة غيار', v_url);
    when 'UNDER_REPAIR' then
      v_title := 'بدأ إصلاح جهازك';
      v_body := 'بدأ العمل على إصلاح جهازك. رقم الطلب: ' || ro.order_number;
      v_template := 'kmr_status_update';
      v_params := jsonb_build_array(ro.order_number, 'تحت الصيانة', v_url);
    when 'WAITING_MANAGER_APPROVAL' then
      v_title := 'انتهى إصلاح جهازك';
      v_body := 'انتهى إصلاح جهازك وجارٍ المراجعة النهائية قبل التسليم.';
      v_template := 'kmr_status_update';
      v_params := jsonb_build_array(ro.order_number, 'المراجعة النهائية', v_url);
    when 'READY_FOR_PICKUP' then
      v_title := 'جهازك جاهز للاستلام';
      v_body := 'عميلنا العزيز، تم الانتهاء من صيانة جهازك واعتماد جاهزيته للاستلام. رقم طلب الصيانة: '
                || ro.order_number || '. يسعدنا استقبالكم في محل خالد لصيانة المحمول.';
      v_template := 'kmr_ready_for_pickup';
      v_params := jsonb_build_array(ro.order_number);
    when 'DELIVERED' then
      v_title := 'تم تسليم جهازك';
      v_body := 'شكرًا لثقتك في خالد لصيانة المحمول. يسعدنا تقييمك للخدمة: ' || v_url;
      v_template := 'kmr_delivered';
      v_params := jsonb_build_array(coalesce(ro.order_number, ''), v_url);
    when 'CANCELLED' then
      v_title := 'تم إلغاء الطلب';
      v_body := 'تم إلغاء طلب الصيانة.' || coalesce(' السبب: ' || nullif(current_setting('kmr.public_note', true), ''), '');
      v_template := 'kmr_booking_cancelled';
      v_params := jsonb_build_array(coalesce(nullif(current_setting('kmr.public_note', true), ''), '-'));
    else
      null; -- NEW_REQUEST / UNDER_TESTING: no customer message
  end case;

  if v_title is not null then
    perform public.enqueue_notification(ro.branch_id, 'CUSTOMER', cust.profile_id, cust.id, ro.id,
      new.to_status::text, v_title, v_body, v_template, v_params, v_ch,
      'hist:' || new.id || ':customer');
  end if;

  -- ------------------------ staff messages ---------------------------
  if new.to_status = 'NEW_REQUEST' then
    for r in select p.id from public.profiles p
             where p.is_active and p.role in ('ADMIN','MANAGER','RECEPTIONIST')
               and (p.role = 'ADMIN' or p.branch_id = ro.branch_id) loop
      perform public.enqueue_notification(ro.branch_id, 'STAFF', r.id, null, ro.id, 'NEW_BOOKING',
        'حجز صيانة جديد', 'حجز جديد: ' || cust.full_name || ' — ' || ro.issue_description,
        null, '[]'::jsonb, v_staff_ch, 'hist:' || new.id || ':staff:' || r.id);
    end loop;
  elsif new.to_status in ('WAITING_MANAGER_APPROVAL', 'CUSTOMER_APPROVED', 'CUSTOMER_REJECTED') then
    for r in select p.id from public.profiles p
             where p.is_active and p.role in ('ADMIN','MANAGER')
               and (p.role = 'ADMIN' or p.branch_id = ro.branch_id) loop
      perform public.enqueue_notification(ro.branch_id, 'STAFF', r.id, null, ro.id,
        'STAFF_' || new.to_status::text,
        case new.to_status when 'WAITING_MANAGER_APPROVAL' then 'جهاز ينتظر اعتمادك'
                           when 'CUSTOMER_APPROVED' then 'العميل وافق على التكلفة'
                           else 'العميل رفض الإصلاح' end,
        'طلب ' || coalesce(ro.order_number, '') || ' — ' || public.repair_status_label(new.to_status),
        null, '[]'::jsonb, v_staff_ch, 'hist:' || new.id || ':staff:' || r.id);
    end loop;
  end if;

  -- assigned technician learns about customer decisions
  if new.to_status in ('CUSTOMER_APPROVED', 'CUSTOMER_REJECTED') then
    for r in select e.profile_id as id from public.technician_assignments ta
             join public.employees e on e.id = ta.technician_id
             where ta.repair_order_id = ro.id and ta.is_current loop
      perform public.enqueue_notification(ro.branch_id, 'STAFF', r.id, null, ro.id,
        'TECH_' || new.to_status::text,
        case new.to_status when 'CUSTOMER_APPROVED' then 'يمكنك بدء الإصلاح' else 'العميل رفض الإصلاح' end,
        'طلب ' || coalesce(ro.order_number, ''), null, '[]'::jsonb, v_staff_ch,
        'hist:' || new.id || ':tech:' || r.id);
    end loop;
  end if;
  return null;
end $$;

create trigger history_notify after insert on public.repair_status_history
  for each row execute function public.tg_history_notify();
