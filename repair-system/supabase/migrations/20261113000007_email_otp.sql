-- =====================================================================
-- Migration 007: second login method — e-mail + one-time code (OTP)
--
-- Accounts now use ONE of two methods (chosen at sign-up):
--   PHONE : phone + password  (auth e-mail = <digits>@phone.kmr.invalid)
--   EMAIL : real e-mail + 6-digit code sent by Supabase Auth
-- Both carry the phone in user metadata -> profiles.phone (unique), so one
-- phone = one account. An e-mail code proves the e-mail, NOT the phone, so
-- the shop-record linking rules of migration 006 apply to both methods.
-- =====================================================================

create or replace function private.login_method(p_email text)
returns text language sql immutable as $$
  select case when p_email like '%@phone.kmr.invalid' then 'PHONE' else 'EMAIL' end
$$;

-- whoami: + login method and the real e-mail (never the internal one)
create or replace function public.whoami()
returns jsonb language plpgsql stable security definer set search_path = public, private, pg_temp as $$
declare pr public.profiles; v_email text;
begin
  select * into pr from public.profiles where id = auth.uid();
  if not found then return null; end if;
  select email into v_email from auth.users where id = pr.id;
  return jsonb_build_object(
    'id', pr.id, 'role', pr.role, 'full_name', pr.full_name, 'phone', pr.phone,
    'branch_id', pr.branch_id, 'is_active', pr.is_active,
    'login_method', private.login_method(v_email),
    'email', case when private.login_method(v_email) = 'EMAIL' then v_email end,
    'employee_id', (select id from public.employees where profile_id = pr.id and is_active),
    'customer', case when pr.role = 'CUSTOMER' then public.my_customer() end);
end $$;

-- admin list: + login method + real e-mail, searchable by e-mail too
drop function public.admin_list_users(text, public.app_role);
create function public.admin_list_users(p_search text default null, p_role public.app_role default null)
returns table (id uuid, full_name text, phone text, email text, login_method text, role public.app_role,
               branch_id uuid, is_active boolean, job_title text, created_at timestamptz)
language plpgsql stable security definer set search_path = public, private, pg_temp as $$
begin
  perform private.require(public.current_app_role() = 'ADMIN', 'FORBIDDEN');
  return query
    select pr.id, pr.full_name, pr.phone,
           case when private.login_method(u.email) = 'EMAIL' then u.email::text end,
           private.login_method(u.email),
           pr.role, pr.branch_id, pr.is_active, e.job_title, pr.created_at
      from public.profiles pr
      join auth.users u on u.id = pr.id
      left join public.employees e on e.profile_id = pr.id
     where (p_role is null or pr.role = p_role)
       and (p_search is null or p_search = ''
            or (regexp_replace(p_search, '[^0-9]', '', 'g') <> ''
                and pr.phone like '%' || regexp_replace(p_search, '[^0-9]', '', 'g') || '%')
            or pr.full_name ilike '%' || p_search || '%'
            or (private.login_method(u.email) = 'EMAIL' and u.email ilike '%' || p_search || '%'))
     order by (pr.role = 'CUSTOMER'), pr.created_at desc
     limit 200;
end $$;

revoke execute on all functions in schema public from public;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function public.admin_list_users(text, public.app_role) to authenticated;
grant execute on function public.whoami() to authenticated;
