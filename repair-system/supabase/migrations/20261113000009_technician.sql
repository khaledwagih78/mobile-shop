-- =====================================================================
-- Migration 009 (phase 4): technician screens + spare-parts catalog
-- Technicians only ever see orders CURRENTLY assigned to them and never
-- see customer names / phones.
-- =====================================================================

-- ---------------------------------------------------------------------
-- "أجهزتي"
-- ---------------------------------------------------------------------
create or replace function public.tech_my_orders()
returns table (
  id uuid, order_number text, status public.repair_status, status_label text,
  device_type public.device_type, brand text, model text, color text, issue_description text,
  assigned_at timestamptz, accepted_at timestamptz, expected_ready_at timestamptz, is_overdue boolean,
  updated_at timestamptz
) language plpgsql stable security definer set search_path = public, private, pg_temp as $$
declare v_emp uuid := public.current_employee_id();
begin
  perform private.require(v_emp is not null and public.is_staff(), 'FORBIDDEN');
  return query
    select ro.id, ro.order_number, ro.status, public.repair_status_label(ro.status),
           d.device_type, d.brand, d.model, d.color, ro.issue_description,
           ta.assigned_at, ta.accepted_at, ro.expected_ready_at,
           (public.is_active_repair(ro.status) and ro.expected_ready_at < now()), ro.updated_at
      from public.technician_assignments ta
      join public.repair_orders ro on ro.id = ta.repair_order_id
      join public.devices d on d.id = ro.device_id
     where ta.is_current and ta.technician_id = v_emp and ro.deleted_at is null
       and ro.status not in ('DELIVERED', 'CANCELLED')
     order by (ta.accepted_at is null) desc, ro.expected_ready_at nulls last;
end $$;

-- ---------------------------------------------------------------------
-- Device details for the assigned technician (no customer identity)
-- ---------------------------------------------------------------------
create or replace function public.tech_order_details(p_order uuid)
returns jsonb language plpgsql stable security definer set search_path = public, private, pg_temp as $$
declare ro public.repair_orders; d public.devices; ta public.technician_assignments; v_appr public.customer_approvals;
begin
  perform private.require(public.is_assigned_technician(p_order), 'FORBIDDEN');
  select * into ro from public.repair_orders where id = p_order;
  select * into d from public.devices where id = ro.device_id;
  select * into ta from public.technician_assignments where repair_order_id = p_order and is_current;
  select * into v_appr from public.customer_approvals where repair_order_id = p_order order by requested_at desc limit 1;

  return jsonb_build_object(
    'order', jsonb_build_object(
      'id', ro.id, 'order_number', ro.order_number, 'status', ro.status,
      'status_label', public.repair_status_label(ro.status), 'version', ro.version,
      'issue_description', ro.issue_description, 'intake_condition', ro.intake_condition,
      'intake_damages', ro.intake_damages, 'accessories', ro.accessories,
      'received_at', ro.received_at, 'expected_ready_at', ro.expected_ready_at,
      'is_overdue', public.is_active_repair(ro.status) and ro.expected_ready_at < now(),
      'repair_report', ro.repair_report, 'test_passed', ro.test_passed, 'test_notes', ro.test_notes,
      'internal_notes', ro.internal_notes, 'warranty_days', ro.warranty_days, 'is_rework', ro.is_rework),
    'device', jsonb_build_object('id', d.id, 'branch_id', d.branch_id, 'device_type', d.device_type, 'brand', d.brand,
      'model', d.model, 'color', d.color, 'imei', d.imei, 'serial_number', d.serial_number,
      'has_passcode', d.passcode_encrypted is not null),
    'assignment', jsonb_build_object('assigned_at', ta.assigned_at, 'accepted_at', ta.accepted_at,
      'assigned_by', private.profile_name(ta.assigned_by)),
    -- the technician needs to know the decision, not the negotiation details
    'approval', case when v_appr.id is null then null else jsonb_build_object(
      'status', v_appr.status, 'amount', v_appr.amount, 'customer_details', v_appr.customer_details,
      'responded_at', v_appr.responded_at, 'response_note', v_appr.response_note) end,
    'diagnostics', coalesce((select jsonb_agg(jsonb_build_object(
        'id', dg.id, 'findings', dg.findings, 'fault_category', dg.fault_category,
        'proposed_solution', dg.proposed_solution, 'estimated_minutes', dg.estimated_minutes,
        'status', dg.status, 'submitted_at', dg.submitted_at) order by dg.created_at)
      from public.diagnostics dg where dg.repair_order_id = ro.id), '[]'::jsonb),
    'parts', coalesce((select jsonb_agg(jsonb_build_object(
        'id', rp.id, 'part_name', rp.part_name, 'qty', rp.qty, 'status', rp.status,
        'spare_part_id', rp.spare_part_id, 'installed_at', rp.installed_at, 'created_at', rp.created_at)
        order by rp.created_at)
      from public.repair_parts rp where rp.repair_order_id = ro.id), '[]'::jsonb),
    'media', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'storage_path', m.storage_path, 'kind', m.kind,
        'caption', m.caption, 'created_at', m.created_at) order by m.created_at)
      from public.device_media m where m.repair_order_id = ro.id and m.deleted_at is null), '[]'::jsonb),
    'timeline', coalesce((select jsonb_agg(jsonb_build_object(
        'event_type', h.event_type, 'to_status', h.to_status, 'actor', private.profile_name(h.actor_profile_id),
        'actor_role', h.actor_role, 'public_note', h.public_note, 'internal_note', h.internal_note, 'at', h.created_at)
        order by h.created_at, h.id)
      from public.repair_status_history h where h.repair_order_id = ro.id), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------
-- Spare-parts catalog (names + default price only; no stock in this edition)
-- ---------------------------------------------------------------------
create or replace function public.search_spare_parts(p_q text default null, p_include_inactive boolean default false)
returns table (id uuid, name text, brand text, part_number text, compatible_models text[], default_price numeric, is_active boolean)
language plpgsql stable security definer set search_path = public, private, pg_temp as $$
declare q text := nullif(trim(coalesce(p_q, '')), '');
begin
  perform private.require(public.is_staff(), 'FORBIDDEN');
  return query
    select sp.id, sp.name, sp.brand, sp.part_number, sp.compatible_models, sp.default_price, sp.is_active
      from public.spare_parts sp
     where sp.deleted_at is null and public.can_access_branch(sp.branch_id)
       and (sp.is_active or (coalesce(p_include_inactive, false) and public.is_manager()))
       and (q is null or sp.name ilike '%' || q || '%' or sp.brand ilike '%' || q || '%'
            or sp.part_number ilike '%' || q || '%'
            or exists (select 1 from unnest(sp.compatible_models) m where m ilike '%' || q || '%'))
     order by sp.name
     limit 50;
end $$;

create or replace function public.upsert_spare_part(p jsonb)
returns uuid language plpgsql security definer set search_path = public, private, pg_temp as $$
declare
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_branch uuid := coalesce(nullif(p->>'branch_id', '')::uuid, (select branch_id from public.profiles where id = auth.uid()),
                            (select id from public.branches where is_active order by created_at limit 1));
  v_models text[] := coalesce((select array_agg(trim(x)) from jsonb_array_elements_text(coalesce(p->'compatible_models', '[]'::jsonb)) x
                                where trim(x) <> ''), '{}');
begin
  perform private.require(public.is_manager(), 'FORBIDDEN');
  perform private.require(public.can_access_branch(v_branch), 'FORBIDDEN_BRANCH');
  perform private.require(length(trim(coalesce(p->>'name', ''))) >= 2, 'NAME_REQUIRED');
  perform private.require(coalesce((p->>'default_price')::numeric, 0) >= 0, 'INVALID_AMOUNT');
  if v_id is null then
    insert into public.spare_parts (branch_id, name, brand, part_number, compatible_models, default_price, is_active)
    values (v_branch, trim(p->>'name'), nullif(trim(coalesce(p->>'brand', '')), ''), nullif(trim(coalesce(p->>'part_number', '')), ''),
            v_models, coalesce((p->>'default_price')::numeric, 0), coalesce((p->>'is_active')::boolean, true))
    returning id into v_id;
  else
    update public.spare_parts set name = trim(p->>'name'), brand = nullif(trim(coalesce(p->>'brand', '')), ''),
           part_number = nullif(trim(coalesce(p->>'part_number', '')), ''), compatible_models = v_models,
           default_price = coalesce((p->>'default_price')::numeric, default_price),
           is_active = coalesce((p->>'is_active')::boolean, is_active)
     where id = v_id and public.can_access_branch(branch_id);
    perform private.require(found, 'SPARE_PART_NOT_FOUND');
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Common fault categories (for diagnosis + "most frequent faults" report)
-- ---------------------------------------------------------------------
create or replace function public.fault_categories()
returns text[] language sql immutable as $$
  select array['شاشة','بطارية','شحن','سوفت وير','مياه','بوردة','كاميرا','صوت/سماعة','مايك','شبكة/إشارة',
               'أزرار','بصمة/وجه','واي فاي/بلوتوث','حرارة','أخرى']
$$;

revoke execute on all functions in schema public from public;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function public.tech_my_orders() to authenticated;
grant execute on function public.tech_order_details(uuid) to authenticated;
grant execute on function public.search_spare_parts(text, boolean) to authenticated;
grant execute on function public.upsert_spare_part(jsonb) to authenticated;
grant execute on function public.fault_categories() to authenticated;
