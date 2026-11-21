-- 056: the volunteer schedule (OpenSpec change add-volunteer-schedule, design
-- D1-D12).
--
-- An hourly schedule of who works when, with site hours and coverage targets.
-- Admins plan shifts; every staff member reads. In order:
--   §1 storage (design D1): shifts, schedule_settings and the usual days on
--      the volunteer profile, with the site hours validator;
--   §2 who reads (design D3): schedule_viewer and its caller-only policy
--      helper, and the SELECT policies on both tables. Both tables are
--      granted SELECT for realtime only, and no write grant; the RPCs of
--      later sections are the only writers;
--   §3 realtime (design D10): both tables join the publication.
-- Later sections add the RPCs, the seed and the Workload read.
-- Nothing existing changes except volunteer_profiles gaining one column and
-- the publication.

-- ---------------------------------------------------------------------------
-- §1. Storage (design D1).

-- Site hours: an object keyed "1".."7" (ISO weekday, Monday = 1), each value
-- {open, close} with whole hours, 0 <= open < close <= 24. A missing key means
-- closed; an empty object means every day is closed. A null or non-object
-- answers false rather than null, so a caller can test it directly.
create function vitally_private.valid_site_hours(p_hours jsonb)
returns boolean language sql immutable set search_path='' as $$
 select coalesce(
  jsonb_typeof(p_hours)='object'
  and not exists(
   select 1 from jsonb_each(p_hours) d(day,hours)
   where d.day not in ('1','2','3','4','5','6','7')
    or coalesce(jsonb_typeof(d.hours),'')<>'object'
    or coalesce(jsonb_typeof(d.hours->'open'),'')<>'number' or coalesce(jsonb_typeof(d.hours->'close'),'')<>'number'
    or (d.hours->>'open') !~ '^[0-9]+$' or (d.hours->>'close') !~ '^[0-9]+$'
    or not ((d.hours->>'open')::int < (d.hours->>'close')::int and (d.hours->>'close')::int<=24)),
  false);
$$;
revoke all on function vitally_private.valid_site_hours(jsonb) from public,anon,authenticated,service_role;

-- Usual days: ISO weekdays 1-7, strictly increasing, so sorted with no
-- duplicates (design D1). A check constraint cannot hold a subquery, so the
-- test lives in a function.
create function vitally_private.valid_usual_days(p_days smallint[])
returns boolean language sql immutable set search_path='' as $$
 select coalesce(
  not exists(select 1 from generate_subscripts(p_days,1) i
   where p_days[i] is null or p_days[i] not between 1 and 7
    or (i>1 and p_days[i]<=p_days[i-1])),
  false);
$$;
revoke all on function vitally_private.valid_usual_days(smallint[]) from public,anon,authenticated,service_role;

-- One row per planned stretch of one person on one date. Removing a shift
-- sets removed_at (design D2): the store watches INSERT and UPDATE only. The
-- person key follows 044's roster keys: deleting a person deletes their shifts.
-- The creator and updater are historical scalars, as receipts' actors are.
create table public.shifts (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 season smallint not null,
 person_id uuid not null,
 shift_date date not null,
 start_hour smallint not null,
 end_hour smallint not null,
 role text not null check (role in ('greeter','intaker','preparer','reviewer','admin')),
 revision bigint not null default 1,
 created_at timestamptz not null default now(),
 created_by_person_id uuid,
 updated_at timestamptz not null default now(),
 updated_by_person_id uuid,
 removed_at timestamptz,
 constraint shifts_hours check (start_hour>=0 and start_hour<end_hour and end_hour<=24),
 foreign key (workspace_id,person_id) references public.people(workspace_id,id) on delete cascade
);
create index shifts_day on public.shifts(workspace_id,season,shift_date);

-- One row per workspace: site hours and the coverage targets. A missing row
-- means every day is closed and the targets are at their defaults. It has its
-- own table, not columns on season_settings, so every Schedule window can
-- learn of a change through realtime while season_settings stays unreadable.
create table public.schedule_settings (
 workspace_id uuid primary key references public.workspaces(id) on delete cascade,
 site_hours jsonb not null default '{}' check (vitally_private.valid_site_hours(site_hours)),
 preparers_needed smallint not null default 2 check (preparers_needed between 0 and 9),
 reviewers_needed smallint not null default 1 check (reviewers_needed between 0 and 9),
 on_site_needed smallint not null default 1 check (on_site_needed between 0 and 9),
 revision bigint not null default 1,
 updated_at timestamptz not null default now(),
 updated_by_person_id uuid
);

-- A volunteer's usual days (ISO weekdays 1-7, no duplicates, stored sorted):
-- a per-volunteer, cross-season attribute like `works`, so it sits on the
-- profile and inherits its admin-only row security.
alter table public.volunteer_profiles
 add column usual_days smallint[] not null default '{}'
 check (vitally_private.valid_usual_days(usual_days));

alter table public.shifts enable row level security;
alter table public.schedule_settings enable row level security;
revoke all on public.shifts from public,anon,authenticated,service_role;
revoke all on public.schedule_settings from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- §2. Who reads (design D3).

-- A schedule viewer: a workspace admin (052's rule applied to that person: an
-- active account on an active staff membership that is a site coordinator or
-- holds the Admin role on the current-season roster entry), or anyone on the
-- current roster with an active staff account (audience_member, 049).
-- Clearance does not matter.
create function vitally_private.schedule_viewer(p_workspace_id uuid,p_person_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.people p
   join public.accounts a on a.workspace_id=p.workspace_id and a.person_id=p.id and a.status='active'
   join public.memberships m on m.workspace_id=a.workspace_id and m.user_id=a.user_id
    and m.active and m.access='staff'
   where p.workspace_id=p_workspace_id and p.id=p_person_id
    and (vitally_private.is_site_coordinator(p_workspace_id,p_person_id)
     or exists(select 1 from public.workspaces w
      join public.roster_entries r on r.workspace_id=w.id and r.season=w.current_season
      where w.id=p_workspace_id and r.person_id=p_person_id and 'admin'=any(r.roles))))
  or vitally_private.audience_member(p_workspace_id,p_person_id,'everyone','{}');
$$;
revoke all on function vitally_private.schedule_viewer(uuid,uuid) from public,anon,authenticated,service_role;

-- The same check for the caller. It takes no user id: it answers only for the
-- caller, as a workspace admin or as the caller's own person.
create function vitally_policy.is_schedule_viewer(p_workspace_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select vitally_policy.is_workspace_admin(p_workspace_id)
  or exists(select 1 from public.people p
   where p.workspace_id=p_workspace_id and p.user_id=(select auth.uid())
    and vitally_private.schedule_viewer(p_workspace_id,p.id));
$$;
revoke all on function vitally_policy.is_schedule_viewer(uuid) from public,anon,authenticated,service_role;
grant execute on function vitally_policy.is_schedule_viewer(uuid) to authenticated;

-- SELECT for realtime only: the browser reads through the RPCs, and admins
-- also read shifts directly for the Workload's hours. No write grant.
grant select on public.shifts to authenticated;
grant select on public.schedule_settings to authenticated;

-- A viewer reads the shifts of people with a sign-in; only a workspace admin
-- also reads a no-sign-in volunteer's (volunteer-roster keeps those admin-only).
-- removed_at is not tested: a removed row stays readable so realtime can
-- deliver the removal UPDATE; every RPC and the store filter removed_at is null.
create policy viewer_shifts on public.shifts for select to authenticated
 using (vitally_policy.is_schedule_viewer(workspace_id)
  and (exists(select 1 from public.people p
    where p.workspace_id=shifts.workspace_id and p.id=shifts.person_id and p.user_id is not null)
   or vitally_policy.is_workspace_admin(workspace_id)));
create policy viewer_schedule_settings on public.schedule_settings for select to authenticated
 using (vitally_policy.is_schedule_viewer(workspace_id));

-- ---------------------------------------------------------------------------
-- §3. Realtime (design D10), with 049's pattern: INSERT and UPDATE reach open
-- windows under the same policies.
do $$
declare v_table text;
begin
 if not exists(select 1 from pg_publication where pubname='supabase_realtime') then
  raise exception 'The supabase_realtime publication is missing; enable Realtime on this project before migrating.';
 end if;
 foreach v_table in array array['shifts','schedule_settings'] loop
  if not exists(
   select 1 from pg_publication_tables
   where pubname='supabase_realtime' and schemaname='public' and tablename=v_table
  ) then
   execute format('alter publication supabase_realtime add table public.%I',v_table);
  end if;
 end loop;
end $$;
