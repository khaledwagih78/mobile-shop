-- =====================================================================
-- Migration 005: private storage bucket for device photos + Realtime
-- =====================================================================

-- Private bucket: files are only reachable via short-lived signed URLs.
insert into storage.buckets (id, name, public)
values ('device-media', 'device-media', false)
on conflict (id) do update set public = false;

-- Path convention: <branch_id>/<device_id>/<file>
-- Staff (front office) of the branch: upload + read.
create policy "media_front_rw" on storage.objects for all to authenticated
  using (bucket_id = 'device-media' and public.is_front_office()
         and public.can_access_branch(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'device-media' and public.is_front_office()
              and public.can_access_branch(((storage.foldername(name))[1])::uuid));

-- Technician: only devices of orders currently assigned to them.
create policy "media_tech_rw" on storage.objects for all to authenticated
  using (bucket_id = 'device-media' and exists (
           select 1 from public.repair_orders ro
           where ro.device_id::text = (storage.foldername(name))[2] and public.is_assigned_technician(ro.id)))
  with check (bucket_id = 'device-media' and exists (
           select 1 from public.repair_orders ro
           where ro.device_id::text = (storage.foldername(name))[2] and public.is_assigned_technician(ro.id)));

-- Customer: upload photos of own devices (booking), read only files marked visible.
create policy "media_customer_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'device-media' and exists (
           select 1 from public.devices d
           where d.id::text = (storage.foldername(name))[2] and d.customer_id = public.current_customer_id()));
create policy "media_customer_read" on storage.objects for select to authenticated
  using (bucket_id = 'device-media' and exists (
           select 1 from public.device_media m
           join public.devices d on d.id = m.device_id
           where m.storage_path = name and m.visible_to_customer and m.deleted_at is null
             and d.customer_id = public.current_customer_id()));

-- ---------------------------------------------------------------------
-- Realtime: RLS-filtered change streams.
--   customers  -> customer_tracking (+ notifications)
--   staff      -> repair_orders, bookings, technician_assignments, notifications
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table
  public.customer_tracking,
  public.notifications,
  public.repair_orders,
  public.bookings,
  public.technician_assignments;
