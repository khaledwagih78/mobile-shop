-- =====================================================================
-- Migration 006: accounts WITHOUT SMS/WhatsApp OTP (phase 2)
--
-- Login = phone + password. Supabase Auth is used with an internal e-mail
-- derived from the phone (2010xxxxxxxx@phone.kmr.invalid) so no SMS provider
-- is needed; the real phone lives in user metadata -> profiles.phone.
--
-- Because the phone is NOT verified by OTP, an app account is never linked
-- automatically to data the shop recorded for that phone. It is linked only by:
--   (a) claim_customer_record(tracking_token): the customer opens the link of
--       their own e-receipt (secret token) AND the phone matches, or
--   (b) staff verifies the person face-to-face (booking check-in / intake).
-- When staff meet an existing customer whose app account is still unverified,
-- they must decide: VERIFY (the account is theirs) or DETACH (it is not).
-- If an SMS provider is added later, nothing here has to change.
-- =====================================================================

alter table public.customers add column account_verified_at timestamptz;

-- One account per phone.
create unique index profiles_phone_uidx on public.profiles (phone) where phone is not null;

-- ---------------------------------------------------------------------
-- New sign-up: profile + (only if the phone is unknown) a fresh, unverified customer row.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, private, pg_temp as $$
declare
  v_phone  text := private.normalize_phone(coalesce(nullif(new.phone, ''), new.raw_user_meta_data->>'phone'));
  v_name   text := nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', '')), '');
  v_branch uuid;
begin
  insert into public.profiles (id, role, full_name, phone)
  values (new.id, 'CUSTOMER', v_name, v_phone)
  on conflict (id) do nothing;

  if v_phone is not null
     and not exists (select 1 from public.customers where phone = v_phone and deleted_at is null) then
    select id into v_branch from public.branches where is_active and deleted_at is null order by created_at limit 1;
    if v_branch is not null then
      insert into public.customers (profile_id, branch_id, full_name, phone)
      values (new.id, v_branch, coalesce(v_name, 'عميل'), v_phone);
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- (a) Customer links their account using their e-receipt link.
-- ---------------------------------------------------------------------
create or replace function public.claim_customer_record(p_tracking_token text)
returns jsonb language plpgsql security definer set search_path = public, private, pg_temp as $$
declare v_phone text; c public.customers;
begin
  perform private.require(public.current_app_role() = 'CUSTOMER', 'FORBIDDEN');
  perform private.require(public.current_customer_id() is null, 'ALREADY_LINKED');
  select phone into v_phone from public.profiles where id = auth.uid();

  select cu.* into c from public.repair_orders ro join public.customers cu on cu.id = ro.customer_id
   where ro.tracking_token = coalesce(p_tracking_token, '') and ro.deleted_at is null
   for update of cu;
  perform private.require(found, 'CLAIM_NOT_FOUND');
  perform private.require(c.phone = v_phone, 'CLAIM_PHONE_MISMATCH');
  perform private.require(c.profile_id is null, 'CLAIM_ALREADY_LINKED');

  update public.customers set profile_id = auth.uid(), account_verified_at = now() where id = c.id;
  insert into public.audit_logs (actor_id, actor_role, action, table_name, record_id)
  values (auth.uid(), 'CUSTOMER', 'CLAIM_CUSTOMER_RECORD', 'customers', c.id);
  return public.my_customer();
end $$;

-- ---------------------------------------------------------------------
-- (b) Staff decision about an unverified app account on a customer row.
-- ---------------------------------------------------------------------
create or replace function private.resolve_customer_account(p_customer uuid, p_action text)
returns void language plpgsql security definer set search_path = public, private, pg_temp as $$
declare c public.customers;
begin
  select * into c from public.customers where id = p_customer for update;
  if not found or c.profile_id is null or c.account_verified_at is not null then
    return;  -- nothing to decide
  end if;
  if p_action = 'verify' then
    update public.customers set account_verified_at = now() where id = p_customer;
    insert into public.audit_logs (actor_id, actor_role, action, table_name, record_id)
    values (auth.uid(), public.current_app_role(), 'VERIFY_CUSTOMER_ACCOUNT', 'customers', p_customer);
  elsif p_action = 'detach' then
    update public.customers set profile_id = null where id = p_customer;
    insert into public.audit_logs (actor_id, actor_role, action, table_name, record_id, old_data)
    values (auth.uid(), public.current_app_role(), 'DETACH_CUSTOMER_ACCOUNT', 'customers', p_customer,
            jsonb_build_object('profile_id', c.profile_id));
  else
    raise exception 'UNVERIFIED_ACCOUNT_DECISION_REQUIRED' using errcode = 'P0001';
  end if;
end $$;

create or replace function public.staff_resolve_customer_account(p_customer uuid, p_action text)
returns jsonb language plpgsql security definer set search_path = public, private, pg_temp as $$
declare v_branch uuid;
begin
  perform private.require(public.is_front_office(), 'FORBIDDEN');
  perform private.require(p_action in ('verify', 'detach'), 'INVALID_ACTION');
  select branch_id into v_branch from public.customers where id = p_customer;
  perform private.require(v_branch is not null and public.can_access_branch(v_branch), 'FORBIDDEN_BRANCH');
  perform private.resolve_customer_account(p_customer, p_action);
  return jsonb_build_object('customer_id', p_customer, 'action', p_action);
end $$;

-- staff_upsert_customer gains p_account_action (verify | detach)
drop function public.staff_upsert_customer(text, text, text, text, text, uuid);
create or replace function public.staff_upsert_customer(
  p_phone text, p_full_name text, p_alt_phone text default null, p_email text default null,
  p_internal_notes text default null, p_branch uuid default null, p_account_action text default null
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
    perform private.resolve_customer_account(v_id, p_account_action);
    update public.customers
       set full_name = trim(p_full_name),
           alt_phone = coalesce(private.normalize_phone(p_alt_phone), alt_phone),
           email = coalesce(p_email, email),
           internal_notes = coalesce(p_internal_notes, internal_notes)
     where id = v_id;
  end if;
  return v_id;
end $$;

-- receive_device: same as 004 + account decision on walk-ins, and booking
-- check-in counts as face-to-face verification.
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
  v_action text := nullif(coalesce(p->>'account_action', p->'customer'->>'account_action'), '');
begin
  perform private.require(public.is_front_office(), 'FORBIDDEN');
  v_prev := private.idem_begin('receive_device', v_key);
  if v_prev is not null then return v_prev; end if;

  if nullif(p->>'booking_id', '') is not null then
    select * into b from public.bookings where id = (p->>'booking_id')::uuid for update;
    perform private.require(found, 'BOOKING_NOT_FOUND');
    perform private.require(b.status in ('PENDING','CONFIRMED','RESCHEDULE_PROPOSED'), 'BOOKING_NOT_OPEN');
    v_branch := b.branch_id; v_customer := b.customer_id; v_order := b.repair_order_id;
    -- the person who booked is in front of the staff with the device
    perform private.resolve_customer_account(v_customer, coalesce(v_action, 'verify'));
    v_device := private.upsert_device(v_customer, v_branch, coalesce(p->'device', '{}'::jsonb) || jsonb_build_object('id', b.device_id));
  else
    v_branch := coalesce(nullif(p->>'branch_id', '')::uuid, v_branch);
    v_customer := nullif(p->>'customer_id', '')::uuid;
    if v_customer is null then
      v_customer := public.staff_upsert_customer(p->'customer'->>'phone', p->'customer'->>'full_name',
                                                  null, null, null, v_branch, v_action);
    else
      perform private.require(exists (select 1 from public.customers where id = v_customer and deleted_at is null
                                      and public.can_access_branch(branch_id)), 'CUSTOMER_NOT_FOUND');
      perform private.resolve_customer_account(v_customer, v_action);
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

-- my_customer: expose verification state to the app
create or replace function public.my_customer()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c public.customers;
begin
  select * into c from public.customers where profile_id = auth.uid() and deleted_at is null;
  if not found then return null; end if;
  return jsonb_build_object('id', c.id, 'full_name', c.full_name, 'phone', c.phone,
                            'alt_phone', c.alt_phone, 'email', c.email, 'branch_id', c.branch_id,
                            'verified', c.account_verified_at is not null);
end $$;

-- ---------------------------------------------------------------------
-- Session bootstrap for the apps: who am I and where do I go.
-- ---------------------------------------------------------------------
create or replace function public.whoami()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare pr public.profiles;
begin
  select * into pr from public.profiles where id = auth.uid();
  if not found then return null; end if;
  return jsonb_build_object(
    'id', pr.id, 'role', pr.role, 'full_name', pr.full_name, 'phone', pr.phone,
    'branch_id', pr.branch_id, 'is_active', pr.is_active,
    'employee_id', (select id from public.employees where profile_id = pr.id and is_active),
    'customer', case when pr.role = 'CUSTOMER' then public.my_customer() end);
end $$;

-- ---------------------------------------------------------------------
-- Admin: user list with search (staff + customers' accounts)
-- ---------------------------------------------------------------------
create or replace function public.admin_list_users(p_search text default null, p_role public.app_role default null)
returns table (id uuid, full_name text, phone text, role public.app_role, branch_id uuid, is_active boolean,
               job_title text, created_at timestamptz)
language plpgsql stable security definer set search_path = public, private, pg_temp as $$
begin
  perform private.require(public.current_app_role() = 'ADMIN', 'FORBIDDEN');
  return query
    select pr.id, pr.full_name, pr.phone, pr.role, pr.branch_id, pr.is_active, e.job_title, pr.created_at
      from public.profiles pr left join public.employees e on e.profile_id = pr.id
     where (p_role is null or pr.role = p_role)
       and (p_search is null or p_search = ''
            or pr.phone like '%' || regexp_replace(p_search, '[^0-9]', '', 'g') || '%'
            or pr.full_name ilike '%' || p_search || '%')
     order by (pr.role = 'CUSTOMER'), pr.created_at desc
     limit 200;
end $$;

revoke execute on all functions in schema public from public;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function public.claim_customer_record(text) to authenticated;
grant execute on function public.staff_resolve_customer_account(uuid, text) to authenticated;
grant execute on function public.staff_upsert_customer(text, text, text, text, text, uuid, text) to authenticated;
grant execute on function public.whoami() to authenticated;
grant execute on function public.admin_list_users(text, public.app_role) to authenticated;
