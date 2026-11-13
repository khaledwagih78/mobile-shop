-- =====================================================================
-- Migration 008 (phase 3): read RPCs for the manager / reception screens
-- Dashboard stats, devices list with filters, full device details with
-- movement history, bookings list, customer search, technicians list.
-- All are front-office only and branch-scoped. No revenue / profit data.
-- =====================================================================

-- Statuses where the device is physically in the shop and still being worked on
create or replace function public.is_active_repair(s public.repair_status)
returns boolean language sql immutable as $$
  select s in ('DEVICE_RECEIVED','UNDER_DIAGNOSIS','WAITING_CUSTOMER_APPROVAL','CUSTOMER_APPROVED',
               'CUSTOMER_REJECTED','WAITING_SPARE_PART','UNDER_REPAIR','UNDER_TESTING','WAITING_MANAGER_APPROVAL')
$$;

create or replace function private.cairo_today()
returns date language sql stable as $$
  select (now() at time zone 'Africa/Cairo')::date
$$;

-- ---------------------------------------------------------------------
-- Dashboard
-- ---------------------------------------------------------------------
create or replace function public.staff_dashboard_stats(p_branch uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public, private, pg_temp as $$
declare v jsonb;
begin
  perform private.require(public.is_front_office(), 'FORBIDDEN');
  with o as (
    select * from public.repair_orders ro
     where ro.deleted_at is null and public.can_access_branch(ro.branch_id)
       and (p_branch is null or ro.branch_id = p_branch)
  )
  select jsonb_build_object(
    'received_today',  (select count(*) from o where (received_at at time zone 'Africa/Cairo')::date = private.cairo_today()),
    'under_diagnosis', (select count(*) from o where status = 'UNDER_DIAGNOSIS'),
    'under_repair',    (select count(*) from o where status in ('CUSTOMER_APPROVED','UNDER_REPAIR','UNDER_TESTING')),
    'waiting_customer',(select count(*) from o where status = 'WAITING_CUSTOMER_APPROVAL'),
    'waiting_part',    (select count(*) from o where status = 'WAITING_SPARE_PART'),
    'waiting_manager', (select count(*) from o where status = 'WAITING_MANAGER_APPROVAL'),
    'ready',           (select count(*) from o where status = 'READY_FOR_PICKUP'),
    'overdue',         (select count(*) from o where public.is_active_repair(status) and expected_ready_at < now()),
    'delivered_today', (select count(*) from o where (delivered_at at time zone 'Africa/Cairo')::date = private.cairo_today()),
    'delivered_total', (select count(*) from o where status = 'DELIVERED'),
    'unassigned',      (select count(*) from o where public.is_active_repair(status) and current_technician_id is null),
    'in_shop',         (select count(*) from o where public.is_active_repair(status) or status = 'READY_FOR_PICKUP'),
    'pending_bookings',(select count(*) from public.bookings b where b.status in ('PENDING','RESCHEDULE_PROPOSED')
                          and public.can_access_branch(b.branch_id) and (p_branch is null or b.branch_id = p_branch)),
    'today_appointments', (select count(*) from public.bookings b where b.status = 'CONFIRMED'
                          and (b.confirmed_at at time zone 'Africa/Cairo')::date = private.cairo_today()
                          and public.can_access_branch(b.branch_id) and (p_branch is null or b.branch_id = p_branch))
  ) into v;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- All devices list (search + filters)
-- ---------------------------------------------------------------------
create or replace function public.staff_list_orders(
  p_statuses public.repair_status[] default null,
  p_search text default null,
  p_technician uuid default null,
  p_from date default null,
  p_to date default null,
  p_overdue_only boolean default false,
  p_device_type public.device_type default null,
  p_limit integer default 100,
  p_offset integer default 0,
  p_unassigned_only boolean default false
) returns table (
  id uuid, order_number text, status public.repair_status, status_label text,
  customer_id uuid, customer_name text, customer_phone text,
  device_type public.device_type, brand text, model text, imei text,
  issue_description text, technician_id uuid, technician_name text,
  received_at timestamptz, expected_ready_at timestamptz, is_overdue boolean,
  hours_in_shop numeric, updated_at timestamptz, version integer
) language plpgsql stable security definer set search_path = public, private, pg_temp as $$
declare
  q text := nullif(trim(coalesce(p_search, '')), '');
  qd text := nullif(regexp_replace(coalesce(p_search, ''), '[^0-9]', '', 'g'), '');
begin
  perform private.require(public.is_front_office(), 'FORBIDDEN');
  return query
    select ro.id, ro.order_number, ro.status, public.repair_status_label(ro.status),
           c.id, c.full_name, c.phone, d.device_type, d.brand, d.model, d.imei,
           ro.issue_description, ro.current_technician_id, tp.full_name,
           ro.received_at, ro.expected_ready_at,
           (public.is_active_repair(ro.status) and ro.expected_ready_at < now()),
           case when ro.received_at is null then null
                else round(extract(epoch from (coalesce(ro.delivered_at, now()) - ro.received_at)) / 3600.0, 1) end,
           ro.updated_at, ro.version
      from public.repair_orders ro
      join public.customers c on c.id = ro.customer_id
      join public.devices d on d.id = ro.device_id
      left join public.employees te on te.id = ro.current_technician_id
      left join public.profiles tp on tp.id = te.profile_id
     where ro.deleted_at is null and public.can_access_branch(ro.branch_id)
       and (p_statuses is null or ro.status = any (p_statuses))
       and (p_technician is null or ro.current_technician_id = p_technician)
       and (p_device_type is null or d.device_type = p_device_type)
       and (p_from is null or (coalesce(ro.received_at, ro.created_at) at time zone 'Africa/Cairo')::date >= p_from)
       and (p_to is null or (coalesce(ro.received_at, ro.created_at) at time zone 'Africa/Cairo')::date <= p_to)
       and (not coalesce(p_overdue_only, false) or (public.is_active_repair(ro.status) and ro.expected_ready_at < now()))
       and (not coalesce(p_unassigned_only, false) or (public.is_active_repair(ro.status) and ro.current_technician_id is null))
       and (q is null
            or ro.order_number ilike '%' || q || '%'
            or c.full_name ilike '%' || q || '%'
            or d.brand ilike '%' || q || '%' or d.model ilike '%' || q || '%'
            or (qd is not null and length(qd) >= 4 and (c.phone like '%' || qd || '%' or d.imei like '%' || qd || '%'))
            or d.serial_number ilike '%' || q || '%')
     order by coalesce(ro.received_at, ro.created_at) desc
     limit least(greatest(coalesce(p_limit, 100), 1), 500) offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- ---------------------------------------------------------------------
-- Device details (the most important manager screen): everything + who did what
-- ---------------------------------------------------------------------
create or replace function private.profile_name(p uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select full_name from public.profiles where id = p
$$;

create or replace function public.staff_order_details(p_order uuid)
returns jsonb language plpgsql stable security definer set search_path = public, private, pg_temp as $$
declare ro public.repair_orders; c public.customers; d public.devices; b public.bookings;
begin
  perform private.require(public.is_front_office(), 'FORBIDDEN');
  select * into ro from public.repair_orders where id = p_order and deleted_at is null;
  perform private.require(found and public.can_access_branch(ro.branch_id), 'ORDER_NOT_FOUND');
  select * into c from public.customers where id = ro.customer_id;
  select * into d from public.devices where id = ro.device_id;
  select * into b from public.bookings where id = ro.booking_id;

  return jsonb_build_object(
    'order', jsonb_build_object(
      'id', ro.id, 'order_number', ro.order_number, 'status', ro.status,
      'status_label', public.repair_status_label(ro.status), 'version', ro.version,
      'issue_description', ro.issue_description, 'intake_condition', ro.intake_condition,
      'intake_damages', ro.intake_damages, 'accessories', ro.accessories,
      'received_at', ro.received_at, 'received_by', private.profile_name(ro.received_by),
      'expected_ready_at', ro.expected_ready_at,
      'is_overdue', public.is_active_repair(ro.status) and ro.expected_ready_at < now(),
      'quoted_cost', ro.quoted_cost, 'approved_cost', ro.approved_cost, 'warranty_days', ro.warranty_days,
      'repair_report', ro.repair_report, 'test_passed', ro.test_passed, 'test_notes', ro.test_notes,
      'internal_notes', ro.internal_notes, 'tracking_token', ro.tracking_token,
      'completed_at', ro.completed_at, 'ready_at', ro.ready_at, 'delivered_at', ro.delivered_at,
      'cancelled_at', ro.cancelled_at, 'cancel_reason', ro.cancel_reason, 'created_at', ro.created_at,
      'current_technician_id', ro.current_technician_id,
      'current_technician_name', (select p.full_name from public.employees e join public.profiles p on p.id = e.profile_id
                                   where e.id = ro.current_technician_id)),
    'customer', jsonb_build_object('id', c.id, 'full_name', c.full_name, 'phone', c.phone, 'alt_phone', c.alt_phone,
      'has_account', c.profile_id is not null, 'account_verified', c.account_verified_at is not null,
      'internal_notes', c.internal_notes),
    'device', jsonb_build_object('id', d.id, 'device_type', d.device_type, 'brand', d.brand, 'model', d.model,
      'color', d.color, 'imei', d.imei, 'serial_number', d.serial_number, 'has_passcode', d.passcode_encrypted is not null),
    'booking', case when b.id is null then null else jsonb_build_object('id', b.id, 'status', b.status,
      'preferred_at', b.preferred_at, 'confirmed_at', b.confirmed_at, 'created_at', b.created_at) end,
    'timeline', coalesce((select jsonb_agg(jsonb_build_object(
        'id', h.id, 'event_type', h.event_type, 'from_status', h.from_status, 'to_status', h.to_status,
        'to_label', public.repair_status_label(h.to_status), 'actor', private.profile_name(h.actor_profile_id),
        'actor_role', h.actor_role, 'public_note', h.public_note, 'internal_note', h.internal_note,
        'metadata', h.metadata, 'at', h.created_at) order by h.created_at, h.id)
      from public.repair_status_history h where h.repair_order_id = ro.id), '[]'::jsonb),
    'assignments', coalesce((select jsonb_agg(jsonb_build_object(
        'id', ta.id, 'technician_id', ta.technician_id,
        'technician_name', (select p.full_name from public.employees e join public.profiles p on p.id = e.profile_id where e.id = ta.technician_id),
        'assigned_by', private.profile_name(ta.assigned_by), 'assigned_at', ta.assigned_at,
        'accepted_at', ta.accepted_at, 'ended_at', ta.ended_at, 'end_reason', ta.end_reason, 'is_current', ta.is_current)
        order by ta.assigned_at)
      from public.technician_assignments ta where ta.repair_order_id = ro.id), '[]'::jsonb),
    'diagnostics', coalesce((select jsonb_agg(jsonb_build_object(
        'id', dg.id, 'findings', dg.findings, 'fault_category', dg.fault_category,
        'proposed_solution', dg.proposed_solution, 'estimated_minutes', dg.estimated_minutes,
        'status', dg.status, 'submitted_at', dg.submitted_at,
        'technician_name', (select p.full_name from public.employees e join public.profiles p on p.id = e.profile_id where e.id = dg.technician_id))
        order by dg.created_at)
      from public.diagnostics dg where dg.repair_order_id = ro.id), '[]'::jsonb),
    'parts', coalesce((select jsonb_agg(jsonb_build_object(
        'id', rp.id, 'part_name', rp.part_name, 'qty', rp.qty, 'unit_price', rp.unit_price, 'status', rp.status,
        'added_by', private.profile_name(rp.added_by), 'installed_at', rp.installed_at, 'created_at', rp.created_at)
        order by rp.created_at)
      from public.repair_parts rp where rp.repair_order_id = ro.id), '[]'::jsonb),
    'approvals', coalesce((select jsonb_agg(jsonb_build_object(
        'id', ca.id, 'amount', ca.amount, 'customer_details', ca.customer_details, 'status', ca.status,
        'requested_by', private.profile_name(ca.requested_by), 'requested_at', ca.requested_at,
        'responded_at', ca.responded_at, 'responded_via', ca.responded_via, 'response_note', ca.response_note,
        'token_expires_at', ca.token_expires_at)
        order by ca.requested_at)
      from public.customer_approvals ca where ca.repair_order_id = ro.id), '[]'::jsonb),
    'media', coalesce((select jsonb_agg(jsonb_build_object(
        'id', m.id, 'storage_path', m.storage_path, 'kind', m.kind, 'caption', m.caption,
        'visible_to_customer', m.visible_to_customer, 'uploaded_by', private.profile_name(m.uploaded_by), 'created_at', m.created_at)
        order by m.created_at)
      from public.device_media m where m.device_id = ro.device_id and m.deleted_at is null
        and (m.repair_order_id = ro.id or (m.booking_id is not null and m.booking_id = ro.booking_id))), '[]'::jsonb),
    'handover', (select jsonb_build_object('outcome', h.outcome, 'handed_by', private.profile_name(h.handed_by),
        'handed_at', h.handed_at, 'received_by_name', h.received_by_name, 'received_by_phone', h.received_by_phone,
        'verification_method', h.verification_method, 'notes', h.notes)
      from public.handover_records h where h.repair_order_id = ro.id),
    'review', (select jsonb_build_object('rating', r.rating, 'comment', r.comment, 'created_at', r.created_at)
      from public.customer_reviews r where r.repair_order_id = ro.id)
  );
end $$;

-- Internal notes on an order (front office)
create or replace function public.staff_set_internal_notes(p_order uuid, p_notes text)
returns void language plpgsql security definer set search_path = public, private, pg_temp as $$
declare v_branch uuid;
begin
  perform private.require(public.is_front_office(), 'FORBIDDEN');
  select branch_id into v_branch from public.repair_orders where id = p_order;
  perform private.require(v_branch is not null and public.can_access_branch(v_branch), 'ORDER_NOT_FOUND');
  update public.repair_orders set internal_notes = nullif(trim(coalesce(p_notes, '')), '') where id = p_order;
end $$;

-- Expected completion date can be updated (front office)
create or replace function public.staff_set_expected_ready(p_order uuid, p_expected timestamptz)
returns void language plpgsql security definer set search_path = public, private, pg_temp as $$
declare ro public.repair_orders;
begin
  perform private.require(public.is_front_office(), 'FORBIDDEN');
  select * into ro from public.repair_orders where id = p_order;
  perform private.require(found and public.can_access_branch(ro.branch_id), 'ORDER_NOT_FOUND');
  perform private.require(p_expected is not null, 'INVALID_DATE');
  update public.repair_orders set expected_ready_at = p_expected where id = p_order;
  perform public.log_order_event(p_order, 'ETA_CHANGED', null, null, 'تم تحديث موعد الانتهاء المتوقع', null, true,
    jsonb_build_object('from', ro.expected_ready_at, 'to', p_expected));
  perform public.refresh_customer_tracking(p_order);
end $$;

-- ---------------------------------------------------------------------
-- Bookings list
-- ---------------------------------------------------------------------
create or replace function public.staff_list_bookings(
  p_statuses public.booking_status[] default null, p_search text default null, p_day date default null
) returns table (
  id uuid, status public.booking_status, repair_order_id uuid, customer_id uuid, customer_name text,
  customer_phone text, device_type public.device_type, brand text, model text, issue_description text,
  preferred_at timestamptz, proposed_at timestamptz, confirmed_at timestamptz, reject_reason text,
  staff_note text, created_at timestamptz
) language plpgsql stable security definer set search_path = public, private, pg_temp as $$
declare
  q text := nullif(trim(coalesce(p_search, '')), '');
  qd text := nullif(regexp_replace(coalesce(p_search, ''), '[^0-9]', '', 'g'), '');
begin
  perform private.require(public.is_front_office(), 'FORBIDDEN');
  return query
    select b.id, b.status, b.repair_order_id, c.id, c.full_name, c.phone, d.device_type, d.brand, d.model,
           b.issue_description, b.preferred_at, b.proposed_at, b.confirmed_at, b.reject_reason, b.staff_note, b.created_at
      from public.bookings b
      join public.customers c on c.id = b.customer_id
      join public.devices d on d.id = b.device_id
     where public.can_access_branch(b.branch_id)
       and (p_statuses is null or b.status = any (p_statuses))
       and (p_day is null or (coalesce(b.confirmed_at, b.proposed_at, b.preferred_at) at time zone 'Africa/Cairo')::date = p_day)
       and (q is null or c.full_name ilike '%' || q || '%'
            or (qd is not null and length(qd) >= 4 and c.phone like '%' || qd || '%'))
     order by coalesce(b.confirmed_at, b.proposed_at, b.preferred_at)
     limit 300;
end $$;

-- ---------------------------------------------------------------------
-- Customer search for intake (with their devices + account state)
-- ---------------------------------------------------------------------
create or replace function public.staff_search_customers(p_q text)
returns table (id uuid, full_name text, phone text, has_account boolean, account_verified boolean,
               orders_count bigint, last_visit timestamptz, devices jsonb)
language plpgsql stable security definer set search_path = public, private, pg_temp as $$
declare
  q text := trim(coalesce(p_q, ''));
  qd text := nullif(regexp_replace(coalesce(p_q, ''), '[^0-9]', '', 'g'), '');
begin
  perform private.require(public.is_front_office(), 'FORBIDDEN');
  if length(q) < 2 then return; end if;
  return query
    select c.id, c.full_name, c.phone, c.profile_id is not null, c.account_verified_at is not null,
           (select count(*) from public.repair_orders ro where ro.customer_id = c.id and ro.received_at is not null),
           (select max(ro.received_at) from public.repair_orders ro where ro.customer_id = c.id),
           coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'device_type', d.device_type, 'brand', d.brand,
                       'model', d.model, 'color', d.color, 'imei', d.imei) order by d.created_at desc)
                     from public.devices d where d.customer_id = c.id and d.deleted_at is null), '[]'::jsonb)
      from public.customers c
     where c.deleted_at is null and public.can_access_branch(c.branch_id)
       and (c.full_name ilike '%' || q || '%' or (qd is not null and length(qd) >= 4 and c.phone like '%' || qd || '%'))
     order by c.updated_at desc
     limit 20;
end $$;

-- ---------------------------------------------------------------------
-- Technicians (for assignment) with current workload
-- ---------------------------------------------------------------------
create or replace function public.staff_list_technicians()
returns table (employee_id uuid, full_name text, role public.app_role, job_title text, specialties text[], open_orders bigint)
language plpgsql stable security definer set search_path = public, private, pg_temp as $$
begin
  perform private.require(public.is_front_office(), 'FORBIDDEN');
  return query
    select e.id, p.full_name, p.role, e.job_title, e.specialties,
           (select count(*) from public.repair_orders ro where ro.current_technician_id = e.id and public.is_active_repair(ro.status))
      from public.employees e join public.profiles p on p.id = e.profile_id
     where e.is_active and e.deleted_at is null and p.is_active
       and p.role in ('TECHNICIAN', 'MANAGER', 'ADMIN') and public.can_access_branch(e.branch_id)
     order by (p.role = 'TECHNICIAN') desc, p.full_name;
end $$;

-- ---------------------------------------------------------------------
-- Staff-side receipt data (full, unmasked — for sending via WhatsApp link)
-- ---------------------------------------------------------------------
create or replace function public.staff_receipt_share(p_order uuid)
returns jsonb language plpgsql stable security definer set search_path = public, private, pg_temp as $$
declare ro public.repair_orders; c public.customers; st public.repair_settings;
begin
  perform private.require(public.is_front_office(), 'FORBIDDEN');
  select * into ro from public.repair_orders where id = p_order;
  perform private.require(found and public.can_access_branch(ro.branch_id), 'ORDER_NOT_FOUND');
  select * into c from public.customers where id = ro.customer_id;
  select * into st from public.repair_settings where branch_id = ro.branch_id;
  return jsonb_build_object('order_number', ro.order_number, 'tracking_token', ro.tracking_token,
    'customer_name', c.full_name, 'customer_phone', c.phone, 'tracking_base_url', st.tracking_base_url);
end $$;


-- ---------------------------------------------------------------------
-- Branch + repair settings (admin / manager): contact info shown on the
-- receipt and tracking page, terms, defaults, and the public site URL used
-- to build tracking / approval links.
-- ---------------------------------------------------------------------
create or replace function public.get_branch_settings(p_branch uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public, private, pg_temp as $$
declare v_branch uuid; br public.branches; st public.repair_settings;
begin
  perform private.require(public.is_front_office(), 'FORBIDDEN');
  v_branch := coalesce(p_branch, (select branch_id from public.profiles where id = auth.uid()),
                       (select id from public.branches where is_active order by created_at limit 1));
  perform private.require(public.can_access_branch(v_branch), 'FORBIDDEN_BRANCH');
  select * into br from public.branches where id = v_branch;
  select * into st from public.repair_settings where branch_id = v_branch;
  return jsonb_build_object('branch_id', br.id, 'name', br.name, 'phone', br.phone, 'whatsapp', br.whatsapp,
    'address', br.address, 'map_url', br.map_url,
    'default_eta_hours', st.default_eta_hours, 'delay_threshold_hours', st.delay_threshold_hours,
    'approval_link_ttl_hours', st.approval_link_ttl_hours, 'default_warranty_days', st.default_warranty_days,
    'receipt_terms', st.receipt_terms, 'warranty_terms', st.warranty_terms, 'tracking_base_url', st.tracking_base_url);
end $$;

create or replace function public.update_branch_settings(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, private, pg_temp as $$
declare v_branch uuid := (p->>'branch_id')::uuid; v_url text := rtrim(trim(coalesce(p->>'tracking_base_url', '')), '/');
begin
  perform private.require(public.is_manager(), 'FORBIDDEN');
  perform private.require(v_branch is not null and public.can_access_branch(v_branch), 'FORBIDDEN_BRANCH');
  perform private.require(length(trim(coalesce(p->>'name', ''))) >= 2, 'NAME_REQUIRED');
  perform private.require(v_url = '' or v_url ~ '^https?://[^ ]+$', 'INVALID_URL');
  update public.branches set name = trim(p->>'name'), phone = nullif(trim(coalesce(p->>'phone', '')), ''),
         whatsapp = nullif(trim(coalesce(p->>'whatsapp', '')), ''), address = nullif(trim(coalesce(p->>'address', '')), ''),
         map_url = nullif(trim(coalesce(p->>'map_url', '')), '')
   where id = v_branch;
  update public.repair_settings set
    default_eta_hours = greatest(coalesce((p->>'default_eta_hours')::integer, default_eta_hours), 1),
    delay_threshold_hours = greatest(coalesce((p->>'delay_threshold_hours')::integer, delay_threshold_hours), 0),
    approval_link_ttl_hours = greatest(coalesce((p->>'approval_link_ttl_hours')::integer, approval_link_ttl_hours), 1),
    default_warranty_days = greatest(coalesce((p->>'default_warranty_days')::integer, default_warranty_days), 0),
    receipt_terms = coalesce(p->>'receipt_terms', receipt_terms),
    warranty_terms = coalesce(p->>'warranty_terms', warranty_terms),
    tracking_base_url = v_url
   where branch_id = v_branch;
  return public.get_branch_settings(v_branch);
end $$;

revoke execute on all functions in schema public from public;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function public.is_active_repair(public.repair_status) to authenticated;
grant execute on function public.staff_dashboard_stats(uuid) to authenticated;
grant execute on function public.staff_list_orders(public.repair_status[], text, uuid, date, date, boolean, public.device_type, integer, integer, boolean) to authenticated;
grant execute on function public.staff_order_details(uuid) to authenticated;
grant execute on function public.staff_set_internal_notes(uuid, text) to authenticated;
grant execute on function public.staff_set_expected_ready(uuid, timestamptz) to authenticated;
grant execute on function public.staff_list_bookings(public.booking_status[], text, date) to authenticated;
grant execute on function public.staff_search_customers(text) to authenticated;
grant execute on function public.staff_list_technicians() to authenticated;
grant execute on function public.staff_receipt_share(uuid) to authenticated;
grant execute on function public.get_branch_settings(uuid) to authenticated;
grant execute on function public.update_branch_settings(jsonb) to authenticated;
