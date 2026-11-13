-- =====================================================================
-- Migration 004: business operations (SECURITY DEFINER RPCs)
-- Every RPC:
--   * re-checks the caller's role / branch / assignment on the server
--   * goes through the state machine (private._transition)
--   * writes the timeline (repair_status_history) + audit (trigger)
--   * sensitive ones accept an idempotency key: replaying the same key
--     returns the first result instead of executing twice.
-- Errors are raised as 'CODE: message' so the apps can map them to Arabic.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------
create or replace function private.require(p_cond boolean, p_code text)
returns void language plpgsql as $$
begin
  if not coalesce(p_cond, false) then
    raise exception '%', p_code using errcode = 'P0001';
  end if;
end $$;

create or replace function private.normalize_phone(p text)
returns text language sql immutable as $$
  -- يقبل 01xxxxxxxxx أو +201xxxxxxxxx أو 00201xxxxxxxxx ويحوّلها لـ +201xxxxxxxxx
  select case
    when p is null then null
    when regexp_replace(p, '[^0-9+]', '', 'g') ~ '^01[0-9]{9}$'
      then '+2' || regexp_replace(p, '[^0-9]', '', 'g')
    when regexp_replace(p, '[^0-9+]', '', 'g') ~ '^00'
      then '+' || substr(regexp_replace(p, '[^0-9]', '', 'g'), 3)
    when regexp_replace(p, '[^0-9+]', '', 'g') ~ '^\+'
      then regexp_replace(p, '[^0-9+]', '', 'g')
    else '+' || regexp_replace(p, '[^0-9]', '', 'g')
  end
$$;

-- Idempotency: returns the stored result if (actor, op, key) was already
-- executed; otherwise reserves the key (row lock serializes concurrent retries).
create or replace function private.idem_begin(p_op text, p_key text)
returns jsonb language plpgsql security definer set search_path = private, public, pg_temp as $$
declare v_res jsonb; v_ins integer;
begin
  if p_key is null or length(p_key) = 0 then return null; end if;
  if length(p_key) > 200 then raise exception 'IDEMPOTENCY_KEY_TOO_LONG' using errcode = 'P0001'; end if;
  insert into private.idempotency_keys (actor_id, operation, key)
  values (coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'), p_op, p_key)
  on conflict do nothing;
  get diagnostics v_ins = row_count;
  if v_ins = 1 then return null; end if;
  select result into v_res from private.idempotency_keys
   where actor_id = coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000')
     and operation = p_op and key = p_key;
  return coalesce(v_res, '{"replayed":true}'::jsonb) || '{"replayed":true}'::jsonb;
end $$;

create or replace function private.idem_end(p_op text, p_key text, p_result jsonb)
returns jsonb language plpgsql security definer set search_path = private, public, pg_temp as $$
begin
  if p_key is not null and length(p_key) > 0 then
    update private.idempotency_keys set result = p_result
     where actor_id = coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000')
       and operation = p_op and key = p_key;
  end if;
  return p_result;
end $$;

-- The single gate for status changes.
create or replace function private._transition(
  p_order uuid, p_to public.repair_status, p_via text,
  p_public_note text default null, p_internal_note text default null,
  p_meta jsonb default '{}'::jsonb, p_expected_version integer default null,
  p_actor_override text default null  -- 'CUSTOMER_LINK' for token-based approvals (anon)
) returns public.repair_orders
language plpgsql security definer set search_path = public, private, pg_temp as $$
declare
  ro   public.repair_orders;
  t    public.status_transitions;
  v_role public.app_role := public.current_app_role();
  v_ok boolean := false;
begin
  select * into ro from public.repair_orders where id = p_order and deleted_at is null for update;
  perform private.require(found, 'ORDER_NOT_FOUND');

  if p_expected_version is not null and ro.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT: expected %, current %', p_expected_version, ro.version using errcode = 'P0001';
  end if;

  select * into t from public.status_transitions where from_status = ro.status and to_status = p_to;
  if not found then
    raise exception 'INVALID_TRANSITION: % -> %', ro.status, p_to using errcode = 'P0001';
  end if;
  if p_actor_override = 'CUSTOMER_LINK' then
    v_ok := 'CUSTOMER' = any (t.actors);
  elsif p_actor_override = 'SYSTEM' then
    v_ok := true;  -- internal callers that already verified the actor (private schema only)
  else
    perform private.require(v_role is not null, 'NOT_AUTHENTICATED');
    if v_role = 'CUSTOMER' then
      v_ok := 'CUSTOMER' = any (t.actors) and ro.customer_id = public.current_customer_id();
    else
      v_ok := (v_role::text = any (t.actors) and public.can_access_branch(ro.branch_id))
              or ('ASSIGNED_TECH' = any (t.actors) and public.is_assigned_technician(ro.id));
    end if;
  end if;
  if not v_ok then
    raise exception 'FORBIDDEN_TRANSITION: % -> %', ro.status, p_to using errcode = 'P0001';
  end if;
  if t.via_rpc is not null and t.via_rpc is distinct from p_via then
    raise exception 'TRANSITION_REQUIRES_RPC: %', t.via_rpc using errcode = 'P0001';
  end if;

  perform set_config('kmr.public_note', coalesce(p_public_note, ''), true);
  perform set_config('kmr.internal_note', coalesce(p_internal_note, ''), true);
  perform set_config('kmr.event_meta', coalesce(p_meta, '{}'::jsonb)::text, true);

  update public.repair_orders set status = p_to where id = p_order returning * into ro;

  perform set_config('kmr.public_note', '', true);
  perform set_config('kmr.internal_note', '', true);
  perform set_config('kmr.event_meta', '', true);
  return ro;
end $$;

-- ---------------------------------------------------------------------
-- Auth: new user -> profile (+ link/create customer row by phone)
-- Staff accounts are promoted later by an ADMIN via admin_set_role().
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, private, pg_temp as $$
declare
  v_phone text := private.normalize_phone(coalesce(new.phone, new.raw_user_meta_data->>'phone'));
  v_name  text := coalesce(new.raw_user_meta_data->>'full_name', '');
  v_branch uuid;
begin
  insert into public.profiles (id, role, full_name, phone)
  values (new.id, 'CUSTOMER', nullif(v_name, ''), v_phone)
  on conflict (id) do nothing;

  if v_phone is not null then
    select id into v_branch from public.branches where is_active and deleted_at is null order by created_at limit 1;
    -- link an existing walk-in customer with the same phone, else create one
    update public.customers set profile_id = new.id,
           full_name = case when full_name = '' then coalesce(nullif(v_name, ''), full_name) else full_name end
     where phone = v_phone and profile_id is null and deleted_at is null;
    if not found and v_branch is not null then
      insert into public.customers (profile_id, branch_id, full_name, phone)
      values (new.id, v_branch, coalesce(nullif(v_name, ''), 'عميل'), v_phone)
      on conflict do nothing;
    end if;
  end if;
  return new;
end $$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Customer: own record / update name
-- ---------------------------------------------------------------------
create or replace function public.my_customer()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c public.customers;
begin
  select * into c from public.customers where profile_id = auth.uid() and deleted_at is null;
  if not found then return null; end if;
  return jsonb_build_object('id', c.id, 'full_name', c.full_name, 'phone', c.phone,
                            'alt_phone', c.alt_phone, 'email', c.email, 'branch_id', c.branch_id);
end $$;

create or replace function public.update_my_customer(p_full_name text, p_alt_phone text default null, p_email text default null)
returns jsonb language plpgsql security definer set search_path = public, private, pg_temp as $$
begin
  perform private.require(public.current_app_role() = 'CUSTOMER', 'FORBIDDEN');
  perform private.require(length(trim(coalesce(p_full_name, ''))) >= 2, 'NAME_REQUIRED');
  update public.customers
     set full_name = trim(p_full_name), alt_phone = private.normalize_phone(p_alt_phone), email = p_email
   where profile_id = auth.uid() and deleted_at is null;
  update public.profiles set full_name = trim(p_full_name) where id = auth.uid();
  return public.my_customer();
end $$;

-- ---------------------------------------------------------------------
-- Admin: user & role management
-- ---------------------------------------------------------------------
create or replace function public.admin_set_role(
  p_profile uuid, p_role public.app_role, p_branch uuid default null,
  p_job_title text default null, p_specialties text[] default '{}'
) returns jsonb language plpgsql security definer set search_path = public, private, pg_temp as $$
declare v_branch uuid;
begin
  perform private.require(public.current_app_role() = 'ADMIN', 'FORBIDDEN');
  perform private.require(p_profile <> auth.uid() or p_role = 'ADMIN', 'CANNOT_DEMOTE_SELF');
  v_branch := coalesce(p_branch, (select id from public.branches where is_active order by created_at limit 1));

  update public.profiles
     set role = p_role, branch_id = case when p_role = 'CUSTOMER' then null else v_branch end
   where id = p_profile;
  perform private.require(found, 'PROFILE_NOT_FOUND');

  if p_role in ('MANAGER', 'RECEPTIONIST', 'TECHNICIAN', 'ADMIN') then
    insert into public.employees (profile_id, branch_id, job_title, specialties)
    values (p_profile, v_branch, p_job_title, coalesce(p_specialties, '{}'))
    on conflict (profile_id) do update
      set branch_id = excluded.branch_id, job_title = coalesce(excluded.job_title, employees.job_title),
          specialties = excluded.specialties, is_active = true, deleted_at = null;
  else
    update public.employees set is_active = false where profile_id = p_profile;
  end if;
  return jsonb_build_object('profile_id', p_profile, 'role', p_role, 'branch_id', v_branch);
end $$;

create or replace function public.admin_set_active(p_profile uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public, private, pg_temp as $$
begin
  perform private.require(public.current_app_role() = 'ADMIN', 'FORBIDDEN');
  perform private.require(p_profile <> auth.uid(), 'CANNOT_DEACTIVATE_SELF');
  update public.profiles set is_active = p_active where id = p_profile;
  update public.employees set is_active = p_active where profile_id = p_profile;
end $$;

-- ---------------------------------------------------------------------
-- Customers / devices (front office)
-- ---------------------------------------------------------------------
create or replace function public.staff_upsert_customer(
  p_phone text, p_full_name text, p_alt_phone text default null, p_email text default null,
  p_internal_notes text default null, p_branch uuid default null
) returns uuid language plpgsql security definer set search_path = public, private, pg_temp as $$
declare
  v_phone text := private.normalize_phone(p_phone);
  v_branch uuid := coalesce(p_branch, (select branch_id from public.profiles where id = auth.uid()));
  v_id uuid;
begin
  perform private.require(public.is_front_office(), 'FORBIDDEN');
  perform private.require(v_branch is not null and public.can_access_branch(v_branch), 'FORBIDDEN_BRANCH');
  perform private.require(v_phone ~ '^\+?[0-9]{8,15}$', 'INVALID_PHONE');
  perform private.require(length(trim(coalesce(p_full_name, ''))) >= 2, 'NAME_REQUIRED');

  select id into v_id from public.customers where phone = v_phone and deleted_at is null;
  if v_id is null then
    insert into public.customers (branch_id, full_name, phone, alt_phone, email, internal_notes, created_by)
    values (v_branch, trim(p_full_name), v_phone, private.normalize_phone(p_alt_phone), p_email, p_internal_notes, auth.uid())
    returning id into v_id;
  else
    update public.customers
       set full_name = trim(p_full_name),
           alt_phone = coalesce(private.normalize_phone(p_alt_phone), alt_phone),
           email = coalesce(p_email, email),
           internal_notes = coalesce(p_internal_notes, internal_notes)
     where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function private.upsert_device(p_customer uuid, p_branch uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public, private, pg_temp as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_imei text := nullif(regexp_replace(coalesce(p->>'imei', ''), '\s', '', 'g'), '');
begin
  if v_id is not null then
    perform private.require(exists (select 1 from public.devices where id = v_id and customer_id = p_customer), 'DEVICE_NOT_FOUND');
    update public.devices set
      color = coalesce(nullif(p->>'color', ''), color),
      imei = coalesce(v_imei, imei),
      serial_number = coalesce(nullif(p->>'serial_number', ''), serial_number)
    where id = v_id;
    return v_id;
  end if;
  perform private.require(length(coalesce(p->>'brand', '')) > 0 and length(coalesce(p->>'model', '')) > 0, 'DEVICE_BRAND_MODEL_REQUIRED');
  insert into public.devices (customer_id, branch_id, device_type, brand, model, color, imei, serial_number)
  values (p_customer, p_branch, coalesce(nullif(p->>'device_type', ''), 'PHONE')::public.device_type,
          trim(p->>'brand'), trim(p->>'model'), nullif(p->>'color', ''), v_imei, nullif(p->>'serial_number', ''))
  returning id into v_id;
  return v_id;
end $$;

-- Device passcode: encrypted at rest, revealed only to manager / assigned tech, every reveal audited.
create or replace function public.set_device_passcode(p_device uuid, p_passcode text)
returns void language plpgsql security definer set search_path = public, private, extensions, pg_temp as $$
declare v_branch uuid;
begin
  select branch_id into v_branch from public.devices where id = p_device;
  perform private.require(public.is_front_office() and public.can_access_branch(v_branch), 'FORBIDDEN');
  update public.devices
     set passcode_encrypted = case when coalesce(p_passcode, '') = '' then null
                                   else extensions.pgp_sym_encrypt(p_passcode, (select value from private.app_secrets where name = 'passcode_key')) end
   where id = p_device;
end $$;

create or replace function public.reveal_device_passcode(p_order uuid)
returns text language plpgsql security definer set search_path = public, private, extensions, pg_temp as $$
declare ro public.repair_orders; v_enc bytea;
begin
  select * into ro from public.repair_orders where id = p_order;
  perform private.require(found, 'ORDER_NOT_FOUND');
  perform private.require((public.is_manager() and public.can_access_branch(ro.branch_id))
                          or public.is_assigned_technician(ro.id), 'FORBIDDEN');
  select passcode_encrypted into v_enc from public.devices where id = ro.device_id;
  insert into public.audit_logs (actor_id, actor_role, action, table_name, record_id)
  values (auth.uid(), public.current_app_role(), 'REVEAL_PASSCODE', 'devices', ro.device_id);
  if v_enc is null then return null; end if;
  return extensions.pgp_sym_decrypt(v_enc, (select value from private.app_secrets where name = 'passcode_key'));
end $$;

-- ---------------------------------------------------------------------
-- Bookings
-- ---------------------------------------------------------------------
-- p: {device:{id?|device_type,brand,model,color}, issue_description, preferred_at, idempotency_key}
create or replace function public.customer_create_booking(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, private, pg_temp as $$
declare
  v_key text := p->>'idempotency_key';
  v_prev jsonb;
  v_cust public.customers;
  v_device uuid; v_order uuid; v_booking uuid;
  v_pref timestamptz := (p->>'preferred_at')::timestamptz;
  v_issue text := trim(coalesce(p->>'issue_description', ''));
begin
  perform private.require(public.current_app_role() = 'CUSTOMER', 'FORBIDDEN');
  v_prev := private.idem_begin('customer_create_booking', v_key);
  if v_prev is not null then return v_prev; end if;

  select * into v_cust from public.customers where profile_id = auth.uid() and deleted_at is null;
  perform private.require(found, 'CUSTOMER_PROFILE_MISSING');
  perform private.require(length(v_issue) >= 3, 'ISSUE_REQUIRED');
  perform private.require(v_pref is not null and v_pref > now() - interval '1 hour', 'INVALID_PREFERRED_TIME');
  perform private.require(
    (select count(*) from public.bookings b where b.customer_id = v_cust.id and b.status in ('PENDING','CONFIRMED','RESCHEDULE_PROPOSED')) < 5,
    'TOO_MANY_OPEN_BOOKINGS');

  v_device := private.upsert_device(v_cust.id, v_cust.branch_id, coalesce(p->'device', '{}'::jsonb));

  insert into public.repair_orders (branch_id, customer_id, device_id, status, issue_description, created_by)
  values (v_cust.branch_id, v_cust.id, v_device, 'NEW_REQUEST', v_issue, auth.uid())
  returning id into v_order;

  insert into public.bookings (branch_id, customer_id, device_id, repair_order_id, issue_description, preferred_at, created_by)
  values (v_cust.branch_id, v_cust.id, v_device, v_order, v_issue, v_pref, auth.uid())
  returning id into v_booking;

  update public.repair_orders set booking_id = v_booking where id = v_order;

  return private.idem_end('customer_create_booking', v_key,
    jsonb_build_object('booking_id', v_booking, 'repair_order_id', v_order, 'device_id', v_device));
end $$;

create or replace function public.cancel_booking(p_booking uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public, private, pg_temp as $$
declare b public.bookings;
begin
  select * into b from public.bookings where id = p_booking for update;
  perform private.require(found, 'BOOKING_NOT_FOUND');
  perform private.require(b.status in ('PENDING','CONFIRMED','RESCHEDULE_PROPOSED'), 'BOOKING_NOT_OPEN');
  perform private._transition(b.repair_order_id, 'CANCELLED', 'cancel_booking', p_reason, null);
  update public.bookings set status = 'CANCELLED', staff_note = coalesce(p_reason, staff_note), handled_by = auth.uid()
   where id = p_booking;
  update public.repair_orders set cancel_reason = p_reason where id = b.repair_order_id;
  return jsonb_build_object('booking_id', p_booking, 'status', 'CANCELLED');
end $$;

create or replace function public.confirm_booking(p_booking uuid, p_confirmed_at timestamptz default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, private, pg_temp as $$
declare b public.bookings;
begin
  perform private.require(public.is_front_office(), 'FORBIDDEN');
  select * into b from public.bookings where id = p_booking for update;
  perform private.require(found, 'BOOKING_NOT_FOUND');
  perform private.require(public.can_access_branch(b.branch_id), 'FORBIDDEN_BRANCH');
  perform private.require(b.status in ('PENDING', 'RESCHEDULE_PROPOSED'), 'BOOKING_NOT_PENDING');
  update public.bookings
     set status = 'CONFIRMED', confirmed_at = coalesce(p_confirmed_at, b.proposed_at, b.preferred_at),
         staff_note = coalesce(p_note, staff_note), handled_by = auth.uid()
   where id = p_booking;
  perform private._transition(b.repair_order_id, 'BOOKING_CONFIRMED', 'confirm_booking', p_note, null);
  return jsonb_build_object('booking_id', p_booking, 'status', 'CONFIRMED');
end $$;

-- Shop proposes a different time; order stays NEW_REQUEST until confirmed.
create or replace function public.propose_booking_time(p_booking uuid, p_proposed_at timestamptz, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, private, pg_temp as $$
declare b public.bookings;
begin
  perform private.require(public.is_front_office(), 'FORBIDDEN');
  select * into b from public.bookings where id = p_booking for update;
  perform private.require(found, 'BOOKING_NOT_FOUND');
  perform private.require(public.can_access_branch(b.branch_id), 'FORBIDDEN_BRANCH');
  perform private.require(b.status in ('PENDING', 'RESCHEDULE_PROPOSED'), 'BOOKING_NOT_PENDING');
  perform private.require(p_proposed_at > now(), 'INVALID_PROPOSED_TIME');
  update public.bookings set status = 'RESCHEDULE_PROPOSED', proposed_at = p_proposed_at,
         staff_note = p_note, handled_by = auth.uid() where id = p_booking;
  perform public.log_order_event(b.repair_order_id, 'BOOKING_RESCHEDULE_PROPOSED', null, null,
    'المحل اقترح موعدًا جديدًا', p_note, true, jsonb_build_object('proposed_at', p_proposed_at));
  perform public.enqueue_notification(b.branch_id, 'CUSTOMER',
    (select profile_id from public.customers where id = b.customer_id), b.customer_id, b.repair_order_id,
    'BOOKING_RESCHEDULE', 'اقتراح موعد جديد', 'اقترح المحل موعدًا جديدًا لحجزك، برجاء التأكيد من التطبيق.',
    null, '[]'::jsonb, array['IN_APP']::public.notify_channel[], 'resched:' || p_booking || ':' || extract(epoch from p_proposed_at));
  return jsonb_build_object('booking_id', p_booking, 'status', 'RESCHEDULE_PROPOSED');
end $$;

-- Customer accepts the proposed time (or picks a new preferred time -> back to PENDING).
create or replace function public.customer_respond_reschedule(p_booking uuid, p_accept boolean, p_new_preferred timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public, private, pg_temp as $$
declare b public.bookings;
begin
  perform private.require(public.current_app_role() = 'CUSTOMER', 'FORBIDDEN');
  select * into b from public.bookings where id = p_booking for update;
  perform private.require(found and b.customer_id = public.current_customer_id(), 'BOOKING_NOT_FOUND');
  perform private.require(b.status = 'RESCHEDULE_PROPOSED', 'NO_PROPOSAL');
  if p_accept then
    update public.bookings set status = 'CONFIRMED', confirmed_at = b.proposed_at where id = p_booking;
    -- customer accepting the shop's own proposal confirms the booking
    perform private._transition(b.repair_order_id, 'BOOKING_CONFIRMED', 'confirm_booking',
      'تم تأكيد الموعد المقترح', null, '{}'::jsonb, null, 'SYSTEM');
  else
    perform private.require(p_new_preferred is not null and p_new_preferred > now(), 'INVALID_PREFERRED_TIME');
    update public.bookings set status = 'PENDING', preferred_at = p_new_preferred, proposed_at = null where id = p_booking;
    perform public.log_order_event(b.repair_order_id, 'BOOKING_TIME_CHANGED', null, null,
      'تم طلب موعد آخر', null, true, jsonb_build_object('preferred_at', p_new_preferred));
  end if;
  return jsonb_build_object('booking_id', p_booking, 'accepted', p_accept);
end $$;

create or replace function public.reject_booking(p_booking uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, private, pg_temp as $$
declare b public.bookings;
begin
  perform private.require(public.is_front_office(), 'FORBIDDEN');
  perform private.require(length(trim(coalesce(p_reason, ''))) >= 3, 'REASON_REQUIRED');
  select * into b from public.bookings where id = p_booking for update;
  perform private.require(found, 'BOOKING_NOT_FOUND');
  perform private.require(public.can_access_branch(b.branch_id), 'FORBIDDEN_BRANCH');
  perform private.require(b.status in ('PENDING','CONFIRMED','RESCHEDULE_PROPOSED'), 'BOOKING_NOT_OPEN');
  update public.bookings set status = 'REJECTED', reject_reason = p_reason, handled_by = auth.uid() where id = p_booking;
  perform private._transition(b.repair_order_id, 'CANCELLED', 'cancel_booking', p_reason, null);
  update public.repair_orders set cancel_reason = p_reason where id = b.repair_order_id;
  return jsonb_build_object('booking_id', p_booking, 'status', 'REJECTED');
end $$;

-- ---------------------------------------------------------------------
-- Device receipt (intake) — booking check-in or walk-in.
-- p: {booking_id?, customer_id? | customer:{phone,full_name}, device:{...}, issue_description,
--     intake_condition, intake_damages:[{area,note}], accessories:[...], expected_ready_at?,
--     passcode?, warranty_days?, idempotency_key}
-- ---------------------------------------------------------------------
create or replace function public.receive_device(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, private, pg_temp as $$
declare
  v_key text := p->>'idempotency_key';
  v_prev jsonb;
  v_branch uuid := (select branch_id from public.profiles where id = auth.uid());
  b public.bookings;
  ro public.repair_orders;
  st public.repair_settings;
  v_customer uuid; v_device uuid; v_order uuid;
  v_eta timestamptz;
begin
  perform private.require(public.is_front_office(), 'FORBIDDEN');
  v_prev := private.idem_begin('receive_device', v_key);
  if v_prev is not null then return v_prev; end if;

  if nullif(p->>'booking_id', '') is not null then
    select * into b from public.bookings where id = (p->>'booking_id')::uuid for update;
    perform private.require(found, 'BOOKING_NOT_FOUND');
    perform private.require(b.status in ('PENDING','CONFIRMED','RESCHEDULE_PROPOSED'), 'BOOKING_NOT_OPEN');
    v_branch := b.branch_id; v_customer := b.customer_id; v_order := b.repair_order_id;
    v_device := private.upsert_device(v_customer, v_branch, coalesce(p->'device', '{}'::jsonb) || jsonb_build_object('id', b.device_id));
  else
    v_branch := coalesce(nullif(p->>'branch_id', '')::uuid, v_branch);
    v_customer := nullif(p->>'customer_id', '')::uuid;
    if v_customer is null then
      v_customer := public.staff_upsert_customer(p->'customer'->>'phone', p->'customer'->>'full_name',
                                                  null, null, null, v_branch);
    end if;
    v_device := private.upsert_device(v_customer, v_branch, coalesce(p->'device', '{}'::jsonb));
  end if;
  perform private.require(v_branch is not null and public.can_access_branch(v_branch), 'FORBIDDEN_BRANCH');

  select * into st from public.repair_settings where branch_id = v_branch;
  v_eta := coalesce(nullif(p->>'expected_ready_at', '')::timestamptz,
                    now() + make_interval(hours => coalesce(st.default_eta_hours, 48)));

  if v_order is not null then
    update public.repair_orders set
      issue_description = coalesce(nullif(trim(p->>'issue_description'), ''), issue_description),
      intake_condition = p->>'intake_condition',
      intake_damages = coalesce(p->'intake_damages', '[]'::jsonb),
      accessories = coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'accessories', '[]'::jsonb)) x), '{}'),
      expected_ready_at = v_eta,
      received_by = auth.uid(),
      warranty_days = coalesce((p->>'warranty_days')::integer, st.default_warranty_days, 0)
    where id = v_order;
    perform private._transition(v_order, 'DEVICE_RECEIVED', 'receive_device', 'تم استلام الجهاز في المحل', null);
    update public.bookings set status = 'CHECKED_IN', handled_by = auth.uid() where id = b.id;
  else
    perform private.require(length(trim(coalesce(p->>'issue_description', ''))) >= 3, 'ISSUE_REQUIRED');
    perform set_config('kmr.public_note', 'تم استلام الجهاز في المحل', true);
    insert into public.repair_orders (branch_id, customer_id, device_id, status, issue_description,
      intake_condition, intake_damages, accessories, expected_ready_at, received_by, warranty_days, created_by)
    values (v_branch, v_customer, v_device, 'DEVICE_RECEIVED', trim(p->>'issue_description'),
      p->>'intake_condition', coalesce(p->'intake_damages', '[]'::jsonb),
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'accessories', '[]'::jsonb)) x), '{}'),
      v_eta, auth.uid(), coalesce((p->>'warranty_days')::integer, st.default_warranty_days, 0), auth.uid())
    returning id into v_order;
    perform set_config('kmr.public_note', '', true);
  end if;

  if coalesce(p->>'passcode', '') <> '' then
    perform public.set_device_passcode(v_device, p->>'passcode');
  end if;

  select * into ro from public.repair_orders where id = v_order;
  return private.idem_end('receive_device', v_key, jsonb_build_object(
    'repair_order_id', ro.id, 'order_number', ro.order_number, 'tracking_token', ro.tracking_token,
    'customer_id', v_customer, 'device_id', v_device));
end $$;

-- ---------------------------------------------------------------------
-- Technician assignment (keeps the full history of previous technicians)
-- ---------------------------------------------------------------------
create or replace function public.assign_technician(p_order uuid, p_technician uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public, private, pg_temp as $$
declare
  ro public.repair_orders;
  e  public.employees;
  v_prev uuid;
  v_role public.app_role;
begin
  perform private.require(public.is_manager(), 'FORBIDDEN');
  select * into ro from public.repair_orders where id = p_order for update;
  perform private.require(found, 'ORDER_NOT_FOUND');
  perform private.require(public.can_access_branch(ro.branch_id), 'FORBIDDEN_BRANCH');
  perform private.require(ro.status not in ('NEW_REQUEST','BOOKING_CONFIRMED','READY_FOR_PICKUP','DELIVERED','CANCELLED'),
                          'ORDER_NOT_ASSIGNABLE');

  select * into e from public.employees where id = p_technician and is_active and deleted_at is null;
  perform private.require(found, 'TECHNICIAN_NOT_FOUND');
  select role into v_role from public.profiles where id = e.profile_id and is_active;
  perform private.require(v_role in ('TECHNICIAN', 'MANAGER', 'ADMIN'), 'NOT_A_TECHNICIAN');
  perform private.require(e.branch_id = ro.branch_id, 'TECHNICIAN_OTHER_BRANCH');
  perform private.require(ro.current_technician_id is distinct from p_technician, 'ALREADY_ASSIGNED');

  v_prev := ro.current_technician_id;
  update public.technician_assignments
     set is_current = false, ended_at = now(), end_reason = coalesce(p_reason, 'REASSIGNED')
   where repair_order_id = p_order and is_current;

  insert into public.technician_assignments (repair_order_id, technician_id, assigned_by)
  values (p_order, p_technician, auth.uid());

  update public.repair_orders set current_technician_id = p_technician where id = p_order;

  perform public.log_order_event(p_order, case when v_prev is null then 'TECH_ASSIGNED' else 'TECH_CHANGED' end,
    ro.status, ro.status, null, p_reason, false,
    jsonb_build_object('technician_id', p_technician, 'previous_technician_id', v_prev));

  perform public.enqueue_notification(ro.branch_id, 'STAFF', e.profile_id, null, p_order, 'TECH_ASSIGNED',
    'جهاز جديد مسند إليك', 'طلب ' || coalesce(ro.order_number, '') || ' — ' || ro.issue_description,
    null, '[]'::jsonb, array['IN_APP','FCM']::public.notify_channel[],
    'assign:' || p_order || ':' || p_technician || ':' || extract(epoch from clock_timestamp()));
  return jsonb_build_object('repair_order_id', p_order, 'technician_id', p_technician, 'previous_technician_id', v_prev);
end $$;

create or replace function public.tech_accept_assignment(p_order uuid)
returns jsonb language plpgsql security definer set search_path = public, private, pg_temp as $$
declare v_id uuid;
begin
  perform private.require(public.is_assigned_technician(p_order), 'FORBIDDEN');
  update public.technician_assignments set accepted_at = now()
   where repair_order_id = p_order and is_current and accepted_at is null
  returning id into v_id;
  if v_id is null then
    return jsonb_build_object('repair_order_id', p_order, 'already_accepted', true);
  end if;
  perform public.log_order_event(p_order, 'TECH_ACCEPTED', null, null, null, null, false,
    jsonb_build_object('assignment_id', v_id));
  return jsonb_build_object('repair_order_id', p_order, 'accepted', true);
end $$;

-- ---------------------------------------------------------------------
-- Generic status change for transitions that don't need a dedicated RPC
-- (e.g. tech: start diagnosis, start repair, waiting part, testing).
-- ---------------------------------------------------------------------
create or replace function public.change_repair_status(
  p_order uuid, p_to public.repair_status,
  p_public_note text default null, p_internal_note text default null,
  p_expected_version integer default null, p_idempotency_key text default null
) returns jsonb language plpgsql security definer set search_path = public, private, pg_temp as $$
declare v_prev jsonb; ro public.repair_orders;
begin
  v_prev := private.idem_begin('change_repair_status', p_idempotency_key);
  if v_prev is not null then return v_prev; end if;

  if p_to = 'UNDER_DIAGNOSIS' and public.is_assigned_technician(p_order) then
    perform private.require(exists (select 1 from public.technician_assignments
      where repair_order_id = p_order and is_current and accepted_at is not null), 'ASSIGNMENT_NOT_ACCEPTED');
  end if;

  ro := private._transition(p_order, p_to, null, p_public_note, p_internal_note, '{}'::jsonb, p_expected_version);
  return private.idem_end('change_repair_status', p_idempotency_key,
    jsonb_build_object('repair_order_id', ro.id, 'status', ro.status, 'version', ro.version));
end $$;

-- ---------------------------------------------------------------------
-- Diagnosis (technician) — report goes to manager for pricing.
-- p_parts: [{spare_part_id?, part_name, qty}]
-- ---------------------------------------------------------------------
create or replace function public.tech_submit_diagnosis(
  p_order uuid, p_findings text, p_proposed_solution text,
  p_fault_category text default null, p_estimated_minutes integer default null,
  p_parts jsonb default '[]'::jsonb, p_idempotency_key text default null
) returns jsonb language plpgsql security definer set search_path = public, private, pg_temp as $$
declare
  v_prev jsonb; ro public.repair_orders; v_diag uuid; v_emp uuid := public.current_employee_id(); x jsonb;
  v_price numeric;
begin
  perform private.require(public.is_assigned_technician(p_order), 'FORBIDDEN');
  v_prev := private.idem_begin('tech_submit_diagnosis', p_idempotency_key);
  if v_prev is not null then return v_prev; end if;

  select * into ro from public.repair_orders where id = p_order for update;
  perform private.require(ro.status = 'UNDER_DIAGNOSIS', 'ORDER_NOT_UNDER_DIAGNOSIS');
  perform private.require(length(trim(coalesce(p_findings, ''))) >= 3, 'FINDINGS_REQUIRED');
  perform private.require(length(trim(coalesce(p_proposed_solution, ''))) >= 3, 'SOLUTION_REQUIRED');

  -- previous submitted reports for this order become history (RETURNED)
  update public.diagnostics set status = 'RETURNED' where repair_order_id = p_order and status = 'SUBMITTED';

  insert into public.diagnostics (repair_order_id, technician_id, findings, fault_category, proposed_solution, estimated_minutes)
  values (p_order, v_emp, trim(p_findings), nullif(trim(coalesce(p_fault_category, '')), ''), trim(p_proposed_solution), p_estimated_minutes)
  returning id into v_diag;

  for x in select * from jsonb_array_elements(coalesce(p_parts, '[]'::jsonb)) loop
    v_price := (select default_price from public.spare_parts where id = nullif(x->>'spare_part_id', '')::uuid);
    insert into public.repair_parts (repair_order_id, spare_part_id, diagnostic_id, part_name, qty, unit_price, status, added_by)
    values (p_order, nullif(x->>'spare_part_id', '')::uuid, v_diag,
            coalesce(nullif(x->>'part_name', ''), (select name from public.spare_parts where id = nullif(x->>'spare_part_id', '')::uuid)),
            coalesce((x->>'qty')::integer, 1), coalesce(v_price, 0), 'REQUIRED', auth.uid());
  end loop;

  perform public.log_order_event(p_order, 'DIAGNOSIS_SUBMITTED', null, null, null, p_findings, false,
    jsonb_build_object('diagnostic_id', v_diag));

  perform public.enqueue_notification(ro.branch_id, 'STAFF', p.id, null, p_order, 'DIAGNOSIS_SUBMITTED',
      'تقرير فحص جديد', 'طلب ' || coalesce(ro.order_number, '') || ' جاهز للتسعير', null, '[]'::jsonb,
      array['IN_APP']::public.notify_channel[], 'diag:' || v_diag || ':' || p.id)
  from public.profiles p
  where p.is_active and p.role in ('ADMIN','MANAGER') and (p.role = 'ADMIN' or p.branch_id = ro.branch_id);

  return private.idem_end('tech_submit_diagnosis', p_idempotency_key,
    jsonb_build_object('diagnostic_id', v_diag, 'repair_order_id', p_order));
end $$;

-- ---------------------------------------------------------------------
-- Quote (manager) -> customer approval request with secure, expiring link.
-- Returns the plain token ONCE (only its sha256 is stored).
-- Any previous PENDING quote is SUPERSEDED (price change = new approval).
-- ---------------------------------------------------------------------
create or replace function public.send_quote(
  p_order uuid, p_amount numeric, p_customer_details text,
  p_part_prices jsonb default '[]'::jsonb,   -- [{repair_part_id, unit_price}]
  p_idempotency_key text default null
) returns jsonb language plpgsql security definer set search_path = public, private, extensions, pg_temp as $$
declare
  v_prev jsonb; ro public.repair_orders; st public.repair_settings;
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
  v_appr uuid; v_diag uuid; x jsonb; v_parts jsonb; v_url text;
begin
  perform private.require(public.is_manager(), 'FORBIDDEN');
  v_prev := private.idem_begin('send_quote', p_idempotency_key);
  if v_prev is not null then return v_prev; end if;

  select * into ro from public.repair_orders where id = p_order for update;
  perform private.require(found, 'ORDER_NOT_FOUND');
  perform private.require(public.can_access_branch(ro.branch_id), 'FORBIDDEN_BRANCH');
  perform private.require(p_amount is not null and p_amount >= 0, 'INVALID_AMOUNT');
  perform private.require(length(trim(coalesce(p_customer_details, ''))) >= 3, 'DETAILS_REQUIRED');
  select * into st from public.repair_settings where branch_id = ro.branch_id;

  for x in select * from jsonb_array_elements(coalesce(p_part_prices, '[]'::jsonb)) loop
    update public.repair_parts set unit_price = (x->>'unit_price')::numeric
     where id = (x->>'repair_part_id')::uuid and repair_order_id = p_order and status <> 'INSTALLED';
  end loop;

  select id into v_diag from public.diagnostics
   where repair_order_id = p_order and status in ('SUBMITTED','ACCEPTED') order by created_at desc limit 1;
  update public.diagnostics set status = 'ACCEPTED', reviewed_by = auth.uid(), reviewed_at = now(),
         customer_summary = trim(p_customer_details)
   where id = v_diag;

  select coalesce(jsonb_agg(jsonb_build_object('name', part_name, 'qty', qty, 'unit_price', unit_price) order by created_at), '[]'::jsonb)
    into v_parts from public.repair_parts where repair_order_id = p_order and status <> 'CANCELLED';

  update public.customer_approvals set status = 'SUPERSEDED', responded_at = now()
   where repair_order_id = p_order and status = 'PENDING';

  insert into public.customer_approvals (repair_order_id, diagnostic_id, amount, customer_details, parts_summary,
         token_hash, token_expires_at, requested_by)
  values (p_order, v_diag, p_amount, trim(p_customer_details), v_parts,
          encode(extensions.digest(v_token, 'sha256'), 'hex'),
          now() + make_interval(hours => coalesce(st.approval_link_ttl_hours, 72)), auth.uid())
  returning id into v_appr;

  update public.repair_orders set quoted_cost = p_amount where id = p_order;

  v_url := coalesce(nullif(st.tracking_base_url, ''), '') || '/approve/' || v_token;
  perform set_config('kmr.approval_url', v_url, true);
  if ro.status = 'WAITING_CUSTOMER_APPROVAL' then
    -- price changed while waiting: new approval, same status; notify explicitly
    perform public.log_order_event(p_order, 'QUOTE_REVISED', null, null, 'تم تحديث التكلفة المقترحة', null, true,
      jsonb_build_object('approval_id', v_appr, 'amount', p_amount));
    perform public.enqueue_notification(ro.branch_id, 'CUSTOMER',
      (select profile_id from public.customers where id = ro.customer_id), ro.customer_id, p_order, 'QUOTE_REVISED',
      'تحديث تكلفة الإصلاح', 'تم تحديث تكلفة الإصلاح إلى ' || p_amount || ' ج.م. برجاء الموافقة من الرابط: ' || v_url,
      'kmr_quote_ready', jsonb_build_array(ro.order_number, p_amount::text, v_url),
      array['IN_APP','WHATSAPP']::public.notify_channel[], 'quote:' || v_appr);
  else
    perform private._transition(p_order, 'WAITING_CUSTOMER_APPROVAL', 'send_quote',
      'تقرير الفحص والتكلفة بانتظار موافقتك', null, jsonb_build_object('approval_id', v_appr, 'amount', p_amount));
  end if;
  perform set_config('kmr.approval_url', '', true);

  return private.idem_end('send_quote', p_idempotency_key, jsonb_build_object(
    'approval_id', v_appr, 'approval_token', v_token, 'approval_url', v_url,
    'expires_at', now() + make_interval(hours => coalesce(st.approval_link_ttl_hours, 72))));
end $$;

create or replace function public.withdraw_quote(p_order uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, private, pg_temp as $$
begin
  perform private.require(public.is_manager(), 'FORBIDDEN');
  update public.customer_approvals set status = 'SUPERSEDED', responded_at = now(), response_note = p_reason
   where repair_order_id = p_order and status = 'PENDING';
  perform private._transition(p_order, 'UNDER_DIAGNOSIS', 'withdraw_quote', null, p_reason);
  return jsonb_build_object('repair_order_id', p_order, 'status', 'UNDER_DIAGNOSIS');
end $$;

-- Shared core for all approval paths.
create or replace function private.apply_quote_response(
  p_approval public.customer_approvals, p_approve boolean, p_note text, p_via public.approval_channel, p_actor_override text
) returns jsonb language plpgsql security definer set search_path = public, private, pg_temp as $$
declare ro public.repair_orders;
begin
  perform private.require(p_approval.status = 'PENDING', 'APPROVAL_NOT_PENDING');
  perform private.require(p_approval.token_expires_at > now() or p_via = 'STAFF_ON_BEHALF', 'APPROVAL_EXPIRED');

  update public.customer_approvals
     set status = case when p_approve then 'APPROVED' else 'REJECTED' end::public.approval_status,
         responded_at = now(), responded_via = p_via, responded_by = auth.uid(), response_note = p_note
   where id = p_approval.id;

  if p_approve then
    update public.repair_orders set approved_cost = p_approval.amount where id = p_approval.repair_order_id;
  end if;

  ro := private._transition(p_approval.repair_order_id,
          case when p_approve then 'CUSTOMER_APPROVED' else 'CUSTOMER_REJECTED' end::public.repair_status,
          'respond_quote', case when p_approve then 'تمت الموافقة على التكلفة' else 'تم رفض الإصلاح' end,
          p_note, jsonb_build_object('approval_id', p_approval.id, 'via', p_via, 'amount', p_approval.amount),
          null, p_actor_override);
  return jsonb_build_object('approval_id', p_approval.id, 'repair_order_id', ro.id, 'status', ro.status);
end $$;

-- Logged-in customer (app)
create or replace function public.customer_respond_quote(p_approval uuid, p_approve boolean, p_note text default null, p_idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path = public, private, pg_temp as $$
declare v_prev jsonb; a public.customer_approvals;
begin
  perform private.require(public.current_app_role() = 'CUSTOMER', 'FORBIDDEN');
  v_prev := private.idem_begin('respond_quote', p_idempotency_key);
  if v_prev is not null then return v_prev; end if;
  select ca.* into a from public.customer_approvals ca
    join public.repair_orders ro on ro.id = ca.repair_order_id
   where ca.id = p_approval and ro.customer_id = public.current_customer_id()
   for update of ca;
  perform private.require(found, 'APPROVAL_NOT_FOUND');
  return private.idem_end('respond_quote', p_idempotency_key, private.apply_quote_response(a, p_approve, p_note, 'APP', null));
end $$;

-- Secure link (WhatsApp) — no login, but requires the token AND the last 4 digits of the customer's phone.
create or replace function public.respond_quote_by_token(p_token text, p_phone_last4 text, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, private, extensions, pg_temp as $$
declare a public.customer_approvals; v_phone text;
begin
  select * into a from public.customer_approvals
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') for update;
  perform private.require(found, 'APPROVAL_NOT_FOUND');
  select c.phone into v_phone from public.repair_orders ro join public.customers c on c.id = ro.customer_id
   where ro.id = a.repair_order_id;
  perform private.require(right(v_phone, 4) = coalesce(p_phone_last4, ''), 'IDENTITY_CHECK_FAILED');
  return private.apply_quote_response(a, p_approve, p_note, 'LINK', 'CUSTOMER_LINK');
end $$;

-- Staff records a decision the customer gave by phone / in person.
create or replace function public.staff_record_quote_response(p_approval uuid, p_approve boolean, p_note text)
returns jsonb language plpgsql security definer set search_path = public, private, pg_temp as $$
declare a public.customer_approvals;
begin
  perform private.require(public.is_front_office(), 'FORBIDDEN');
  perform private.require(length(trim(coalesce(p_note, ''))) >= 3, 'NOTE_REQUIRED');
  select * into a from public.customer_approvals where id = p_approval for update;
  perform private.require(found, 'APPROVAL_NOT_FOUND');
  return private.apply_quote_response(a, p_approve, p_note, 'STAFF_ON_BEHALF', null);
end $$;

-- Public view of a quote by token (no login) — customer-safe fields only.
create or replace function public.get_quote_by_token(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, private, extensions, pg_temp as $$
declare a public.customer_approvals; ct public.customer_tracking;
begin
  select * into a from public.customer_approvals
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  if not found then return null; end if;
  select * into ct from public.customer_tracking where repair_order_id = a.repair_order_id;
  return jsonb_build_object(
    'order_number', ct.order_number, 'device', ct.device_brand || ' ' || ct.device_model,
    'amount', a.amount, 'details', a.customer_details, 'parts', a.parts_summary,
    'status', a.status, 'expired', a.token_expires_at <= now(), 'expires_at', a.token_expires_at);
end $$;

-- ---------------------------------------------------------------------
-- Parts during repair (technician) — price snapshot from catalog
-- ---------------------------------------------------------------------
create or replace function public.add_repair_part(
  p_order uuid, p_part_name text default null, p_qty integer default 1,
  p_spare_part uuid default null, p_status public.part_status default 'INSTALLED'
) returns uuid language plpgsql security definer set search_path = public, private, pg_temp as $$
declare v_id uuid; sp public.spare_parts;
begin
  perform private.require(public.is_assigned_technician(p_order) or public.is_manager(), 'FORBIDDEN');
  perform private.require((select status from public.repair_orders where id = p_order)
    in ('UNDER_DIAGNOSIS','CUSTOMER_APPROVED','WAITING_SPARE_PART','UNDER_REPAIR','UNDER_TESTING'), 'ORDER_NOT_IN_REPAIR');
  if p_spare_part is not null then
    select * into sp from public.spare_parts where id = p_spare_part and deleted_at is null;
    perform private.require(found, 'SPARE_PART_NOT_FOUND');
  end if;
  perform private.require(coalesce(p_part_name, sp.name) is not null, 'PART_NAME_REQUIRED');
  insert into public.repair_parts (repair_order_id, spare_part_id, part_name, qty, unit_price, status, added_by)
  values (p_order, p_spare_part, coalesce(nullif(p_part_name, ''), sp.name), coalesce(p_qty, 1),
          coalesce(sp.default_price, 0), p_status, auth.uid())
  returning id into v_id;
  perform public.log_order_event(p_order, 'PART_ADDED', null, null, null, coalesce(p_part_name, sp.name), false,
    jsonb_build_object('repair_part_id', v_id, 'qty', p_qty, 'status', p_status, 'unit_price', coalesce(sp.default_price, 0)));
  return v_id;
end $$;

create or replace function public.set_repair_part_status(p_part uuid, p_status public.part_status)
returns void language plpgsql security definer set search_path = public, private, pg_temp as $$
declare v_order uuid;
begin
  select repair_order_id into v_order from public.repair_parts where id = p_part;
  perform private.require(v_order is not null, 'PART_NOT_FOUND');
  perform private.require(public.is_assigned_technician(v_order) or public.is_manager(), 'FORBIDDEN');
  update public.repair_parts set status = p_status where id = p_part;
  perform public.log_order_event(v_order, 'PART_STATUS', null, null, null, null, false,
    jsonb_build_object('repair_part_id', p_part, 'status', p_status));
end $$;

-- ---------------------------------------------------------------------
-- Testing & finishing (technician). Technician can NEVER approve delivery.
-- ---------------------------------------------------------------------
create or replace function public.tech_record_test(p_order uuid, p_passed boolean, p_notes text)
returns jsonb language plpgsql security definer set search_path = public, private, pg_temp as $$
begin
  perform private.require(public.is_assigned_technician(p_order), 'FORBIDDEN');
  perform private.require((select status from public.repair_orders where id = p_order) = 'UNDER_TESTING', 'ORDER_NOT_UNDER_TESTING');
  update public.repair_orders set test_passed = p_passed, test_notes = p_notes where id = p_order;
  perform public.log_order_event(p_order, 'TEST_RECORDED', null, null, null, p_notes, false,
    jsonb_build_object('passed', p_passed));
  return jsonb_build_object('repair_order_id', p_order, 'test_passed', p_passed);
end $$;

create or replace function public.tech_finish_repair(p_order uuid, p_repair_report text, p_idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path = public, private, pg_temp as $$
declare v_prev jsonb; ro public.repair_orders;
begin
  perform private.require(public.is_assigned_technician(p_order), 'FORBIDDEN');
  v_prev := private.idem_begin('tech_finish_repair', p_idempotency_key);
  if v_prev is not null then return v_prev; end if;
  select * into ro from public.repair_orders where id = p_order for update;
  perform private.require(ro.test_passed is true, 'TEST_NOT_PASSED');
  perform private.require(length(trim(coalesce(p_repair_report, ''))) >= 3, 'REPORT_REQUIRED');
  update public.repair_orders set repair_report = trim(p_repair_report) where id = p_order;
  ro := private._transition(p_order, 'WAITING_MANAGER_APPROVAL', 'finish_repair', 'انتهى الإصلاح وجارٍ المراجعة', p_repair_report);
  return private.idem_end('tech_finish_repair', p_idempotency_key,
    jsonb_build_object('repair_order_id', ro.id, 'status', ro.status));
end $$;

-- ---------------------------------------------------------------------
-- Manager approval of completion / recheck
-- ---------------------------------------------------------------------
create or replace function public.approve_completion(p_order uuid, p_note text default null, p_idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path = public, private, pg_temp as $$
declare v_prev jsonb; ro public.repair_orders;
begin
  perform private.require(public.is_manager(), 'FORBIDDEN');
  v_prev := private.idem_begin('approve_completion', p_idempotency_key);
  if v_prev is not null then return v_prev; end if;
  ro := private._transition(p_order, 'READY_FOR_PICKUP', 'approve_completion', 'جهازك جاهز للاستلام', p_note);
  return private.idem_end('approve_completion', p_idempotency_key,
    jsonb_build_object('repair_order_id', ro.id, 'status', ro.status));
end $$;

create or replace function public.request_recheck(p_order uuid, p_reason text, p_back_to public.repair_status default 'UNDER_REPAIR')
returns jsonb language plpgsql security definer set search_path = public, private, pg_temp as $$
declare ro public.repair_orders;
begin
  perform private.require(public.is_manager(), 'FORBIDDEN');
  perform private.require(length(trim(coalesce(p_reason, ''))) >= 3, 'REASON_REQUIRED');
  perform private.require(p_back_to in ('UNDER_REPAIR', 'UNDER_DIAGNOSIS'), 'INVALID_TARGET');
  update public.repair_orders set test_passed = null where id = p_order;
  ro := private._transition(p_order, p_back_to, 'request_recheck', null, p_reason);
  return jsonb_build_object('repair_order_id', ro.id, 'status', ro.status);
end $$;

-- ---------------------------------------------------------------------
-- Handover (manager only)
-- ---------------------------------------------------------------------
create or replace function public.deliver_device(
  p_order uuid, p_received_by_name text, p_verification_method text,
  p_received_by_phone text default null, p_notes text default null, p_idempotency_key text default null
) returns jsonb language plpgsql security definer set search_path = public, private, pg_temp as $$
declare v_prev jsonb; ro public.repair_orders; v_outcome public.handover_outcome; v_h uuid;
begin
  perform private.require(public.is_manager(), 'FORBIDDEN');
  v_prev := private.idem_begin('deliver_device', p_idempotency_key);
  if v_prev is not null then return v_prev; end if;
  select * into ro from public.repair_orders where id = p_order for update;
  perform private.require(found, 'ORDER_NOT_FOUND');
  perform private.require(ro.status = 'READY_FOR_PICKUP', 'ORDER_NOT_READY');
  perform private.require(length(trim(coalesce(p_received_by_name, ''))) >= 2, 'RECEIVER_NAME_REQUIRED');
  perform private.require(length(trim(coalesce(p_verification_method, ''))) >= 2, 'VERIFICATION_REQUIRED');

  v_outcome := case when ro.repair_report is not null and ro.test_passed then 'REPAIRED' else 'RETURNED_UNREPAIRED' end;
  insert into public.handover_records (repair_order_id, outcome, handed_by, received_by_name, received_by_phone, verification_method, notes)
  values (p_order, v_outcome, auth.uid(), trim(p_received_by_name), private.normalize_phone(p_received_by_phone), p_verification_method, p_notes)
  returning id into v_h;

  -- close the technician assignment
  update public.technician_assignments set is_current = false, ended_at = now(), end_reason = 'DELIVERED'
   where repair_order_id = p_order and is_current;

  ro := private._transition(p_order, 'DELIVERED', 'deliver_device', 'تم تسليم الجهاز', p_notes,
                            jsonb_build_object('handover_id', v_h, 'outcome', v_outcome));
  return private.idem_end('deliver_device', p_idempotency_key,
    jsonb_build_object('repair_order_id', ro.id, 'status', ro.status, 'handover_id', v_h, 'outcome', v_outcome));
end $$;

-- ---------------------------------------------------------------------
-- Customer: timeline (no technician names, no internal notes) & review
-- ---------------------------------------------------------------------
create or replace function public.customer_order_timeline(p_order uuid)
returns table (event_type text, status public.repair_status, status_label text, note text, at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.repair_orders ro where ro.id = p_order
                 and (ro.customer_id = public.current_customer_id()
                      or (public.is_front_office() and public.can_access_branch(ro.branch_id)))) then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;
  return query
    select h.event_type, h.to_status, public.repair_status_label(h.to_status), h.public_note, h.created_at
      from public.repair_status_history h
     where h.repair_order_id = p_order and h.visible_to_customer
     order by h.created_at, h.id;
end $$;

create or replace function public.customer_submit_review(p_order uuid, p_rating integer, p_comment text default null)
returns uuid language plpgsql security definer set search_path = public, private, pg_temp as $$
declare ro public.repair_orders; v_id uuid;
begin
  perform private.require(public.current_app_role() = 'CUSTOMER', 'FORBIDDEN');
  select * into ro from public.repair_orders where id = p_order and customer_id = public.current_customer_id();
  perform private.require(found, 'ORDER_NOT_FOUND');
  perform private.require(ro.status = 'DELIVERED', 'ORDER_NOT_DELIVERED');
  perform private.require(p_rating between 1 and 5, 'INVALID_RATING');
  insert into public.customer_reviews (repair_order_id, customer_id, rating, comment)
  values (p_order, ro.customer_id, p_rating, nullif(trim(coalesce(p_comment, '')), ''))
  on conflict (repair_order_id) do nothing
  returning id into v_id;
  perform private.require(v_id is not null, 'ALREADY_REVIEWED');
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Public tracking page & e-receipt (QR link, no login). Safe fields only.
-- ---------------------------------------------------------------------
create or replace function public.track_order(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare ro public.repair_orders; ct public.customer_tracking; br public.branches;
begin
  if p_token is null or length(p_token) < 20 then return null; end if;
  select * into ro from public.repair_orders where tracking_token = p_token and deleted_at is null;
  if not found then return null; end if;
  select * into ct from public.customer_tracking where repair_order_id = ro.id;
  select * into br from public.branches where id = ro.branch_id;
  return jsonb_build_object(
    'order_number', ro.order_number, 'status', ro.status, 'status_label', public.repair_status_label(ro.status),
    'device_type', ct.device_type, 'device', ct.device_brand || ' ' || ct.device_model,
    'received_at', ro.received_at, 'expected_ready_at', ro.expected_ready_at,
    'approved_cost', ro.approved_cost, 'pending_amount', ct.pending_amount,
    'diagnosis_summary', ct.diagnosis_summary, 'last_update_at', ct.last_update_at,
    'branch', jsonb_build_object('name', br.name, 'phone', br.phone, 'whatsapp', br.whatsapp, 'address', br.address, 'map_url', br.map_url),
    'timeline', coalesce((select jsonb_agg(jsonb_build_object('status', h.to_status,
                     'label', public.repair_status_label(h.to_status), 'note', h.public_note, 'at', h.created_at)
                     order by h.created_at, h.id)
                   from public.repair_status_history h
                  where h.repair_order_id = ro.id and h.visible_to_customer and h.to_status is not null), '[]'::jsonb));
end $$;

create or replace function public.get_receipt(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare ro public.repair_orders; c public.customers; d public.devices; br public.branches; st public.repair_settings;
begin
  if p_token is null or length(p_token) < 20 then return null; end if;
  select * into ro from public.repair_orders where tracking_token = p_token and deleted_at is null;
  if not found or ro.order_number is null then return null; end if;
  select * into c from public.customers where id = ro.customer_id;
  select * into d from public.devices where id = ro.device_id;
  select * into br from public.branches where id = ro.branch_id;
  select * into st from public.repair_settings where branch_id = ro.branch_id;
  return jsonb_build_object(
    'shop_name', 'خالد لصيانة المحمول', 'branch', br.name, 'branch_phone', br.phone, 'branch_address', br.address,
    'order_number', ro.order_number, 'customer_name', c.full_name,
    -- رقم الهاتف مخفي جزئياً لأن الرابط قابل للمشاركة
    'customer_phone', left(c.phone, 4) || repeat('*', greatest(length(c.phone) - 7, 0)) || right(c.phone, 3),
    'device_type', d.device_type, 'brand', d.brand, 'model', d.model, 'color', d.color,
    'imei', case when d.imei is null then null else repeat('*', length(d.imei) - 4) || right(d.imei, 4) end,
    'intake_condition', ro.intake_condition, 'intake_damages', ro.intake_damages, 'accessories', ro.accessories,
    'issue_description', ro.issue_description, 'received_at', ro.received_at, 'expected_ready_at', ro.expected_ready_at,
    'warranty_days', ro.warranty_days,
    'tracking_url', coalesce(nullif(st.tracking_base_url, ''), '') || '/track/' || ro.tracking_token,
    'receipt_terms', st.receipt_terms, 'warranty_terms', st.warranty_terms);
end $$;

-- ---------------------------------------------------------------------
-- Notifications: mark read / push tokens
-- ---------------------------------------------------------------------
create or replace function public.mark_notifications_read(p_ids uuid[])
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  update public.notifications set read_at = now()
   where id = any (p_ids) and read_at is null
     and (recipient_profile_id = auth.uid()
          or (audience = 'CUSTOMER' and customer_id = public.current_customer_id()));
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.register_push_token(p_token text, p_platform text)
returns void language plpgsql security definer set search_path = public, private, pg_temp as $$
begin
  perform private.require(auth.uid() is not null, 'NOT_AUTHENTICATED');
  perform private.require(p_platform in ('android','ios','web'), 'INVALID_PLATFORM');
  insert into public.push_tokens (profile_id, token, platform) values (auth.uid(), p_token, p_platform)
  on conflict (token) do update set profile_id = auth.uid(), platform = excluded.platform, last_seen_at = now();
end $$;

-- ---------------------------------------------------------------------
-- Media registration (file uploaded to Storage first, then registered)
-- Path convention: <branch_id>/<device_id>/<uuid>.<ext>
-- ---------------------------------------------------------------------
create or replace function public.register_device_media(
  p_device uuid, p_path text, p_kind public.media_kind, p_order uuid default null,
  p_caption text default null, p_visible boolean default false
) returns uuid language plpgsql security definer set search_path = public, private, pg_temp as $$
declare d public.devices; v_id uuid;
begin
  select * into d from public.devices where id = p_device;
  perform private.require(found, 'DEVICE_NOT_FOUND');
  perform private.require(split_part(p_path, '/', 1) = d.branch_id::text and split_part(p_path, '/', 2) = d.id::text, 'INVALID_MEDIA_PATH');
  if public.current_app_role() = 'CUSTOMER' then
    perform private.require(d.customer_id = public.current_customer_id() and p_kind = 'CUSTOMER_UPLOAD', 'FORBIDDEN');
    p_visible := true;
  else
    perform private.require((public.is_front_office() and public.can_access_branch(d.branch_id))
                            or (p_order is not null and public.is_assigned_technician(p_order)), 'FORBIDDEN');
  end if;
  if p_order is not null then
    perform private.require(exists (select 1 from public.repair_orders where id = p_order and device_id = p_device), 'ORDER_DEVICE_MISMATCH');
  end if;
  insert into public.device_media (repair_order_id, device_id, storage_path, kind, caption, visible_to_customer, uploaded_by)
  values (p_order, p_device, p_path, p_kind, p_caption, p_visible, auth.uid())
  returning id into v_id;
  if p_order is not null then
    perform public.log_order_event(p_order, 'MEDIA_ADDED', null, null, null, p_caption, false,
      jsonb_build_object('media_id', v_id, 'kind', p_kind));
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Grants: which roles may CALL which RPC (each RPC re-checks inside).
-- ---------------------------------------------------------------------
revoke all on all functions in schema private from public, anon, authenticated;
-- PostgreSQL grants EXECUTE to PUBLIC on every new function by default;
-- remove it so only the explicit grants below (and in migration 003) apply.
revoke execute on all functions in schema public from public, anon;

grant execute on function public.my_customer() to authenticated;
grant execute on function public.update_my_customer(text, text, text) to authenticated;
grant execute on function public.admin_set_role(uuid, public.app_role, uuid, text, text[]) to authenticated;
grant execute on function public.admin_set_active(uuid, boolean) to authenticated;
grant execute on function public.staff_upsert_customer(text, text, text, text, text, uuid) to authenticated;
grant execute on function public.set_device_passcode(uuid, text) to authenticated;
grant execute on function public.reveal_device_passcode(uuid) to authenticated;
grant execute on function public.customer_create_booking(jsonb) to authenticated;
grant execute on function public.cancel_booking(uuid, text) to authenticated;
grant execute on function public.confirm_booking(uuid, timestamptz, text) to authenticated;
grant execute on function public.propose_booking_time(uuid, timestamptz, text) to authenticated;
grant execute on function public.customer_respond_reschedule(uuid, boolean, timestamptz) to authenticated;
grant execute on function public.reject_booking(uuid, text) to authenticated;
grant execute on function public.receive_device(jsonb) to authenticated;
grant execute on function public.assign_technician(uuid, uuid, text) to authenticated;
grant execute on function public.tech_accept_assignment(uuid) to authenticated;
grant execute on function public.change_repair_status(uuid, public.repair_status, text, text, integer, text) to authenticated;
grant execute on function public.tech_submit_diagnosis(uuid, text, text, text, integer, jsonb, text) to authenticated;
grant execute on function public.send_quote(uuid, numeric, text, jsonb, text) to authenticated;
grant execute on function public.withdraw_quote(uuid, text) to authenticated;
grant execute on function public.customer_respond_quote(uuid, boolean, text, text) to authenticated;
grant execute on function public.staff_record_quote_response(uuid, boolean, text) to authenticated;
grant execute on function public.respond_quote_by_token(text, text, boolean, text) to anon, authenticated;
grant execute on function public.get_quote_by_token(text) to anon, authenticated;
grant execute on function public.add_repair_part(uuid, text, integer, uuid, public.part_status) to authenticated;
grant execute on function public.set_repair_part_status(uuid, public.part_status) to authenticated;
grant execute on function public.tech_record_test(uuid, boolean, text) to authenticated;
grant execute on function public.tech_finish_repair(uuid, text, text) to authenticated;
grant execute on function public.approve_completion(uuid, text, text) to authenticated;
grant execute on function public.request_recheck(uuid, text, public.repair_status) to authenticated;
grant execute on function public.deliver_device(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.customer_order_timeline(uuid) to authenticated;
grant execute on function public.customer_submit_review(uuid, integer, text) to authenticated;
grant execute on function public.track_order(text) to anon, authenticated;
grant execute on function public.get_receipt(text) to anon, authenticated;
grant execute on function public.repair_status_label(public.repair_status) to anon, authenticated;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;
grant execute on function public.register_push_token(text, text) to authenticated;
grant execute on function public.register_device_media(uuid, text, public.media_kind, uuid, text, boolean) to authenticated;
