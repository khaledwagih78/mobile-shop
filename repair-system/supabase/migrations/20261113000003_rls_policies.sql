-- =====================================================================
-- Migration 003: Row Level Security + grants
-- Principle: clients get SELECT (filtered by RLS) on what they may see.
-- Every write goes through SECURITY DEFINER RPCs (migration 004) that
-- re-check role, branch and assignment on the server. Hiding a button in
-- the UI is never the protection.
-- =====================================================================

-- Start from zero: Supabase grants ALL on public tables to anon/authenticated by default.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated, public;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated, public;

-- Helper functions used inside policies must be executable.
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.has_any_role(public.app_role[]) to authenticated;
grant execute on function public.is_manager() to authenticated;
grant execute on function public.is_front_office() to authenticated;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.current_employee_id() to authenticated;
grant execute on function public.current_customer_id() to authenticated;
grant execute on function public.can_access_branch(uuid) to authenticated;
grant execute on function public.is_assigned_technician(uuid) to authenticated;
grant execute on function public.repair_status_label(public.repair_status) to anon, authenticated;

-- Enable RLS everywhere
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- branches: public contact info (customers & anonymous tracking page)
-- ---------------------------------------------------------------------
grant select on public.branches to anon, authenticated;
create policy branches_read on public.branches for select
  using (is_active and deleted_at is null);

-- ---------------------------------------------------------------------
-- status_transitions: read-only reference (UI uses it to show buttons)
-- ---------------------------------------------------------------------
grant select on public.status_transitions to authenticated;
create policy transitions_read on public.status_transitions for select to authenticated using (true);

-- ---------------------------------------------------------------------
-- profiles
--   self: always. Front office: staff + customers. Technicians: staff only.
--   Customers can NEVER see other profiles (=> no technician names).
--   Self-update limited to full_name (role/branch changed only via RPC).
-- ---------------------------------------------------------------------
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;
create policy profiles_self_read on public.profiles for select to authenticated
  using (id = auth.uid());
create policy profiles_front_read on public.profiles for select to authenticated
  using (public.is_front_office() and (branch_id is null or public.can_access_branch(branch_id)));
-- technicians see staff colleagues only (never customers' names/phones)
create policy profiles_tech_read on public.profiles for select to authenticated
  using (public.is_staff() and role <> 'CUSTOMER' and branch_id is not null and public.can_access_branch(branch_id));
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- ---------------------------------------------------------------------
-- customers: front office in branch only. Technicians: none.
--   Customers read their own record through the my_customer() RPC
--   (so internal_notes is never exposed to them).
-- ---------------------------------------------------------------------
grant select on public.customers to authenticated;
create policy customers_front_read on public.customers for select to authenticated
  using (public.is_front_office() and public.can_access_branch(branch_id));

-- ---------------------------------------------------------------------
-- employees: staff only
-- ---------------------------------------------------------------------
grant select on public.employees to authenticated;
create policy employees_staff_read on public.employees for select to authenticated
  using (public.is_staff() and public.can_access_branch(branch_id));

-- ---------------------------------------------------------------------
-- devices (passcode column is never granted to clients)
-- ---------------------------------------------------------------------
grant select (id, customer_id, branch_id, device_type, brand, model, color, imei, serial_number,
              created_at, updated_at, deleted_at) on public.devices to authenticated;
create policy devices_customer_read on public.devices for select to authenticated
  using (customer_id = public.current_customer_id() and deleted_at is null);
create policy devices_front_read on public.devices for select to authenticated
  using (public.is_front_office() and public.can_access_branch(branch_id));
create policy devices_tech_read on public.devices for select to authenticated
  using (exists (select 1 from public.repair_orders ro
                 where ro.device_id = devices.id and public.is_assigned_technician(ro.id)));

-- ---------------------------------------------------------------------
-- bookings
-- ---------------------------------------------------------------------
grant select on public.bookings to authenticated;
create policy bookings_customer_read on public.bookings for select to authenticated
  using (customer_id = public.current_customer_id());
create policy bookings_front_read on public.bookings for select to authenticated
  using (public.is_front_office() and public.can_access_branch(branch_id));

-- ---------------------------------------------------------------------
-- repair_orders: staff only (customers use customer_tracking)
--   technicians: only orders CURRENTLY assigned to them.
-- ---------------------------------------------------------------------
grant select on public.repair_orders to authenticated;
create policy repair_orders_front_read on public.repair_orders for select to authenticated
  using (public.is_front_office() and public.can_access_branch(branch_id));
create policy repair_orders_tech_read on public.repair_orders for select to authenticated
  using (public.is_assigned_technician(id));

-- ---------------------------------------------------------------------
-- customer_tracking: the customer-safe projection (Realtime source)
-- ---------------------------------------------------------------------
grant select on public.customer_tracking to authenticated;
create policy tracking_customer_read on public.customer_tracking for select to authenticated
  using (customer_id = public.current_customer_id());
create policy tracking_front_read on public.customer_tracking for select to authenticated
  using (public.is_front_office() and public.can_access_branch(branch_id));

-- ---------------------------------------------------------------------
-- repair_status_history: staff (customers get a filtered RPC timeline)
-- ---------------------------------------------------------------------
grant select on public.repair_status_history to authenticated;
create policy rsh_front_read on public.repair_status_history for select to authenticated
  using (public.is_front_office() and exists (
    select 1 from public.repair_orders ro where ro.id = repair_order_id and public.can_access_branch(ro.branch_id)));
create policy rsh_tech_read on public.repair_status_history for select to authenticated
  using (public.is_assigned_technician(repair_order_id));

-- ---------------------------------------------------------------------
-- technician_assignments: managers/front office; technicians their own
-- ---------------------------------------------------------------------
grant select on public.technician_assignments to authenticated;
create policy ta_front_read on public.technician_assignments for select to authenticated
  using (public.is_front_office() and exists (
    select 1 from public.repair_orders ro where ro.id = repair_order_id and public.can_access_branch(ro.branch_id)));
create policy ta_tech_read on public.technician_assignments for select to authenticated
  using (technician_id = public.current_employee_id());

-- ---------------------------------------------------------------------
-- diagnostics
-- ---------------------------------------------------------------------
grant select on public.diagnostics to authenticated;
create policy diagnostics_front_read on public.diagnostics for select to authenticated
  using (public.is_front_office() and exists (
    select 1 from public.repair_orders ro where ro.id = repair_order_id and public.can_access_branch(ro.branch_id)));
create policy diagnostics_tech_read on public.diagnostics for select to authenticated
  using (public.is_assigned_technician(repair_order_id));

-- ---------------------------------------------------------------------
-- spare_parts catalog: staff
-- ---------------------------------------------------------------------
grant select on public.spare_parts to authenticated;
create policy spare_parts_staff_read on public.spare_parts for select to authenticated
  using (public.is_staff() and public.can_access_branch(branch_id) and deleted_at is null);

-- ---------------------------------------------------------------------
-- repair_parts
-- ---------------------------------------------------------------------
grant select on public.repair_parts to authenticated;
create policy repair_parts_front_read on public.repair_parts for select to authenticated
  using (public.is_front_office() and exists (
    select 1 from public.repair_orders ro where ro.id = repair_order_id and public.can_access_branch(ro.branch_id)));
create policy repair_parts_tech_read on public.repair_parts for select to authenticated
  using (public.is_assigned_technician(repair_order_id));

-- ---------------------------------------------------------------------
-- customer_approvals (token_hash and staff ids are never granted to clients)
-- ---------------------------------------------------------------------
grant select (id, repair_order_id, diagnostic_id, amount, customer_details, parts_summary, status,
              token_expires_at, requested_at, responded_at, responded_via, response_note, created_at)
  on public.customer_approvals to authenticated;
create policy ca_customer_read on public.customer_approvals for select to authenticated
  using (exists (select 1 from public.repair_orders ro
                 where ro.id = repair_order_id and ro.customer_id = public.current_customer_id()));
create policy ca_front_read on public.customer_approvals for select to authenticated
  using (public.is_front_office() and exists (
    select 1 from public.repair_orders ro where ro.id = repair_order_id and public.can_access_branch(ro.branch_id)));
create policy ca_tech_read on public.customer_approvals for select to authenticated
  using (public.is_assigned_technician(repair_order_id));

-- ---------------------------------------------------------------------
-- notifications: recipients read their own; customers read theirs
-- ---------------------------------------------------------------------
grant select on public.notifications to authenticated;
create policy notifications_recipient_read on public.notifications for select to authenticated
  using (recipient_profile_id = auth.uid());
create policy notifications_customer_read on public.notifications for select to authenticated
  using (audience = 'CUSTOMER' and customer_id = public.current_customer_id());
create policy notifications_manager_read on public.notifications for select to authenticated
  using (public.is_manager() and public.can_access_branch(branch_id));

grant select on public.notification_logs to authenticated;
create policy notification_logs_manager_read on public.notification_logs for select to authenticated
  using (public.is_manager());

-- ---------------------------------------------------------------------
-- device_media
-- ---------------------------------------------------------------------
grant select on public.device_media to authenticated;
create policy media_front_read on public.device_media for select to authenticated
  using (public.is_front_office() and deleted_at is null and exists (
    select 1 from public.devices d where d.id = device_id and public.can_access_branch(d.branch_id)));
create policy media_tech_read on public.device_media for select to authenticated
  using (deleted_at is null and repair_order_id is not null and public.is_assigned_technician(repair_order_id));
create policy media_customer_read on public.device_media for select to authenticated
  using (deleted_at is null and visible_to_customer and exists (
    select 1 from public.devices d where d.id = device_id and d.customer_id = public.current_customer_id()));

-- ---------------------------------------------------------------------
-- handover_records
-- ---------------------------------------------------------------------
grant select on public.handover_records to authenticated;
create policy handover_front_read on public.handover_records for select to authenticated
  using (public.is_front_office() and exists (
    select 1 from public.repair_orders ro where ro.id = repair_order_id and public.can_access_branch(ro.branch_id)));

-- ---------------------------------------------------------------------
-- audit_logs: ADMIN / MANAGER only
-- ---------------------------------------------------------------------
grant select on public.audit_logs to authenticated;
create policy audit_manager_read on public.audit_logs for select to authenticated
  using (public.is_manager());

-- ---------------------------------------------------------------------
-- customer_reviews
-- ---------------------------------------------------------------------
grant select on public.customer_reviews to authenticated;
create policy reviews_customer_read on public.customer_reviews for select to authenticated
  using (customer_id = public.current_customer_id());
create policy reviews_staff_read on public.customer_reviews for select to authenticated
  using (public.is_front_office());

-- ---------------------------------------------------------------------
-- repair_settings: everyone signed in can read (terms shown in receipt)
-- ---------------------------------------------------------------------
grant select on public.repair_settings to authenticated;
create policy settings_read on public.repair_settings for select to authenticated using (true);

-- ---------------------------------------------------------------------
-- push_tokens: owner manages own tokens
-- ---------------------------------------------------------------------
grant select, delete on public.push_tokens to authenticated;
create policy push_tokens_own_read on public.push_tokens for select to authenticated
  using (profile_id = auth.uid());
create policy push_tokens_own_delete on public.push_tokens for delete to authenticated
  using (profile_id = auth.uid());

-- service_role (Edge Functions) bypasses RLS by design in Supabase.
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;
