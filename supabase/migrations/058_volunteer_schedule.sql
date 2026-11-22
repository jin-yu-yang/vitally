-- 058: the volunteer schedule (OpenSpec change add-volunteer-schedule, design
-- D1-D12).
--
-- An hourly schedule of who works when, with site hours and coverage targets.
-- Admins plan shifts; every staff member reads. In order:
--   §1 storage (design D1): shifts and schedule_settings, with the site hours
--      validator;
--   §2 who reads (design D3): schedule_viewer and its caller-only policy
--      helper, and the SELECT policies on both tables. Both tables are
--      granted SELECT for realtime only, and no write grant; the RPCs of
--      later sections are the only writers;
--   §3 realtime (design D10): both tables join the publication;
--   §4 the site hours and targets save, and the Season settings read;
--   §5 saving and removing shifts (design D2, D4);
--   §6 the schedule day read, with the flags and coverage counts for admins
--      (design D3, D5, D6);
--   §7 the caller's own shifts this week, for My profile (design D5);
--   §8 the clearance answer gains scheduleViewer (design D3, D11).
-- Later sections add the other RPCs, the seed and the Workload read.
-- Usual days are main's (057_my_profile: volunteer_profiles.usual_days text[],
-- 'mon'..'sun', saved through vitally_save_volunteer and vitally_save_my_profile);
-- this migration only reads them, for an admin's Add shift candidates.
-- Nothing existing changes except the publication, and the Season settings
-- and clearance reads gaining one key each.

-- ---------------------------------------------------------------------------
-- §1. Storage (design D1).

-- Site hours: an object keyed "1".."7" (ISO weekday, Monday = 1), each value
-- {open, close} with whole hours, 0 <= open < close <= 24. A missing key means
-- closed; an empty object means every day is closed. A null or non-object
-- answers false rather than null, so a caller can test it directly. Hours of
-- more than three digits are false without being cast, so a huge number never
-- overflows an integer. Extra keys inside a day are not refused here; the save
-- (section 4) stores only open and close.
create function vitally_private.valid_site_hours(p_hours jsonb)
returns boolean language sql immutable security definer set search_path='' as $$
 select coalesce(
  jsonb_typeof(p_hours)='object'
  and not exists(
   select 1 from jsonb_each(p_hours) d(day,hours)
   where d.day not in ('1','2','3','4','5','6','7')
    or coalesce(jsonb_typeof(d.hours),'')<>'object'
    or coalesce(jsonb_typeof(d.hours->'open'),'')<>'number' or coalesce(jsonb_typeof(d.hours->'close'),'')<>'number'
    or case when (d.hours->>'open') ~ '^[0-9]{1,3}$' and (d.hours->>'close') ~ '^[0-9]{1,3}$'
     then not ((d.hours->>'open')::int < (d.hours->>'close')::int and (d.hours->>'close')::int<=24)
     else true end),
  false);
$$;
revoke all on function vitally_private.valid_site_hours(jsonb) from public,anon,authenticated,service_role;

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

-- ---------------------------------------------------------------------------
-- §4. Site hours and coverage targets on Season settings (design D4, D5).

-- The settings answer: the site hours and the three targets with the
-- revision. A workspace with no row has every day closed, the default
-- targets and revision 0.
create function vitally_private.schedule_settings_answer(p_workspace_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('siteHours',coalesce(s.site_hours,'{}'::jsonb),
  'targets',jsonb_build_object('preparersNeeded',coalesce(s.preparers_needed,2),
   'reviewersNeeded',coalesce(s.reviewers_needed,1),'onSiteNeeded',coalesce(s.on_site_needed,1)),
  'revision',coalesce(s.revision,0))
 from (select 1) one
 left join public.schedule_settings s on s.workspace_id=p_workspace_id;
$$;
revoke all on function vitally_private.schedule_settings_answer(uuid) from public,anon,authenticated,service_role;

-- One coverage target as sent: a whole number 0-9 or VALIDATION naming the
-- field (p_field).
create function vitally_private.schedule_target(p_value jsonb,p_field text)
returns smallint language plpgsql immutable security definer set search_path='' as $$
begin
 if jsonb_typeof(p_value) is distinct from 'number' or (p_value #>> '{}') !~ '^[0-9]$' then
  raise sqlstate 'VT007' using message='VALIDATION',detail=p_field;
 end if;
 return (p_value #>> '{}')::smallint;
end;
$$;
revoke all on function vitally_private.schedule_target(jsonb,text) from public,anon,authenticated,service_role;

-- The Season settings read, replaced from 052 to add `schedule`, the answer
-- above (design D5). Everything else is 052's body, unchanged.
create or replace function public.vitally_season_settings()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_person public.people;
 v_workspace uuid;
begin
 v_member=vitally_private.require_membership();
 v_person=vitally_private.acting_person(v_member);
 if v_member.access<>'staff' or v_person.id is null
  or not vitally_policy.is_workspace_admin(v_member.workspace_id) then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 v_workspace=v_member.workspace_id;
 return vitally_private.season_settings_answer(v_workspace)
  || jsonb_build_object(
   'siteNumber',(select jsonb_build_object('set',n.workspace_id is not null,'updatedAt',n.updated_at)
    from (select 1) one left join vitally_private.site_numbers n on n.workspace_id=v_workspace),
   'canEdit',vitally_private.is_site_coordinator(v_workspace,v_person.id),
   'schedule',vitally_private.schedule_settings_answer(v_workspace), -- 058
   'siteCoordinators',coalesce((select jsonb_agg(jsonb_build_object(
     'volunteerId',p.id,'name',p.name,'email',v.email,
     'since',(select max(c.changed_at) from public.site_coordinator_changes c
      where c.workspace_id=v_workspace and c.person_id=p.id and c.granted),
     'onRoster',exists(select 1 from public.roster_entries r join public.workspaces w on w.id=r.workspace_id
      where r.workspace_id=v_workspace and r.person_id=p.id and r.season=w.current_season),
     'accountRevision',a.revision) order by p.name,p.id)
    from public.accounts a
    join public.people p on p.workspace_id=a.workspace_id and p.id=a.person_id
    left join public.volunteer_profiles v on v.workspace_id=p.workspace_id and v.person_id=p.id
    where a.workspace_id=v_workspace and a.status='active' and a.is_site_coordinator),'[]'::jsonb),
   'candidates',coalesce((select jsonb_agg(jsonb_build_object('volunteerId',p.id,'name',p.name,
     'accountRevision',a.revision) order by p.name,p.id)
    from public.accounts a
    join public.memberships m on m.workspace_id=a.workspace_id and m.user_id=a.user_id
    join public.people p on p.workspace_id=a.workspace_id and p.id=a.person_id
    where a.workspace_id=v_workspace and a.status='active' and not a.is_site_coordinator
     and m.active and m.access='staff'),'[]'::jsonb),
   'history',coalesce((select jsonb_agg(jsonb_build_object('personName',h.person_name,'granted',h.granted,
     'changedByName',h.changed_by_name,'changedAt',h.changed_at) order by h.changed_at desc,h.id desc)
    from (select c.id,c.granted,c.changed_at,p.name as person_name,b.name as changed_by_name
     from public.site_coordinator_changes c
     join public.people p on p.workspace_id=c.workspace_id and p.id=c.person_id
     left join public.people b on b.workspace_id=c.workspace_id and b.id=c.changed_by_person_id
     where c.workspace_id=v_workspace
     order by c.changed_at desc,c.id desc limit 50) h),'[]'::jsonb));
end;
$$;
revoke all on function public.vitally_season_settings() from public,anon,authenticated,service_role;
grant execute on function public.vitally_season_settings() to authenticated;

-- Saves the site hours and targets at the revision the page read, for a site
-- coordinator only. Order: FORBIDDEN (nothing written, no receipt), VALIDATION
-- (a missing argument or settings not an object; then siteHours.<weekday>,
-- preparersNeeded, reviewersNeeded or onSiteNeeded as detail), then under the
-- workspace lock the receipt (a replay returns the stored answer) and CONFLICT
-- (a stale revision; with no row the revision is 0, and a save at 0 inserts).
-- Each day is stored as {open, close} only, whatever else was sent. Answers
-- with the settings answer.
create function public.vitally_save_schedule_settings(p_action_id uuid,p_expected_revision bigint,p_settings jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_person public.people;
 v_receipt public.action_receipts;
 v_settings public.schedule_settings;
 v_hours jsonb='{}'::jsonb;
 v_day record;
 v_preparers smallint;
 v_reviewers smallint;
 v_on_site smallint;
 v_digest text;
 v_result jsonb;
begin
 v_member=vitally_private.require_membership();
 v_person=vitally_private.acting_person(v_member);
 if v_member.access<>'staff' or v_person.id is null
  or not vitally_private.is_site_coordinator(v_member.workspace_id,v_person.id) then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 if p_action_id is null or p_expected_revision is null or p_settings is null
  or jsonb_typeof(p_settings)<>'object' then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 if jsonb_typeof(p_settings->'siteHours') is distinct from 'object' then
  raise sqlstate 'VT007' using message='VALIDATION',detail='siteHours';
 end if;
 for v_day in select e.key,e.value from jsonb_each(p_settings->'siteHours') e order by e.key loop
  if not vitally_private.valid_site_hours(jsonb_build_object(v_day.key,v_day.value)) then
   raise sqlstate 'VT007' using message='VALIDATION',detail='siteHours.'||left(v_day.key,20);
  end if;
  v_hours=v_hours||jsonb_build_object(v_day.key,jsonb_build_object(
   'open',(v_day.value->>'open')::int,'close',(v_day.value->>'close')::int));
 end loop;
 v_preparers=vitally_private.schedule_target(p_settings#>'{targets,preparersNeeded}','preparersNeeded');
 v_reviewers=vitally_private.schedule_target(p_settings#>'{targets,reviewersNeeded}','reviewersNeeded');
 v_on_site=vitally_private.schedule_target(p_settings#>'{targets,onSiteNeeded}','onSiteNeeded');
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_member.workspace_id::text,0));
 v_digest=encode(extensions.digest(jsonb_build_object('operation','SAVE_SCHEDULE_SETTINGS',
  'expectedRevision',p_expected_revision,'siteHours',v_hours,'preparersNeeded',v_preparers,
  'reviewersNeeded',v_reviewers,'onSiteNeeded',v_on_site,'personId',v_person.id)::text,'sha256'),'hex');
 v_receipt=vitally_private.reserve_receipt(v_member,p_action_id,'SAVE_SCHEDULE_SETTINGS',v_digest,v_person.id);
 if v_receipt.receipt is not null then
  return v_receipt.receipt;
 end if;
 select * into v_settings from public.schedule_settings where workspace_id=v_member.workspace_id for update;
 if coalesce(v_settings.revision,0)<>p_expected_revision then
  raise sqlstate 'VT003' using message='CONFLICT';
 end if;
 if v_settings.workspace_id is null then
  insert into public.schedule_settings(workspace_id,site_hours,preparers_needed,reviewers_needed,on_site_needed,updated_by_person_id)
   values(v_member.workspace_id,v_hours,v_preparers,v_reviewers,v_on_site,v_person.id);
 else
  update public.schedule_settings set site_hours=v_hours,preparers_needed=v_preparers,
   reviewers_needed=v_reviewers,on_site_needed=v_on_site,
   revision=revision+1,updated_at=now(),updated_by_person_id=v_person.id
   where workspace_id=v_member.workspace_id;
 end if;
 v_result=vitally_private.schedule_settings_answer(v_member.workspace_id);
 update public.action_receipts set target_id=v_member.workspace_id,receipt=v_result where id=v_receipt.id;
 return v_result;
end;
$$;
revoke all on function public.vitally_save_schedule_settings(uuid,bigint,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.vitally_save_schedule_settings(uuid,bigint,jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- §5. Saving and removing shifts (design D2, D4).

-- Adds a shift (p_shift_id and p_expected_revision both null) or edits one
-- (both present), for a workspace admin only, cleared or not. p_shift is
-- {volunteerId, date, startHour, endHour, role}; on an edit volunteerId must be
-- the stored person. Order: FORBIDDEN (nothing written, no receipt);
-- VALIDATION of the shape, which needs no stored state (a missing argument, a
-- p_shift that is not an object, then volunteerId, date, startHour, endHour,
-- role as detail); then under the workspace lock the receipt (a replay returns
-- the stored answer); NOT_FOUND (VT002) for an unknown or removed shift, which
-- comes before CONFLICT so that editing a removed shift with its old revision
-- says it is gone; CONFLICT (a stale revision); then the VALIDATION reasons
-- that read stored state, as the detail, in this order: volunteerId (an edit
-- names another person), NOT_ON_ROSTER, DEACTIVATED, ROLE_NOT_HELD,
-- SITE_CLOSED, OUTSIDE_SITE_HOURS, OVERLAP. Holding the role means the role is
-- on the person's current-season roster entry; a person with no sign-in can be
-- scheduled. A new shift takes the current season. Answers {shiftId, revision}.
create function public.vitally_save_shift(p_action_id uuid,p_shift_id uuid,p_expected_revision bigint,p_shift jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_person public.people;
 v_workspace public.workspaces;
 v_shift public.shifts;
 v_receipt public.action_receipts;
 v_volunteer uuid;
 v_date date;
 v_start smallint;
 v_end smallint;
 v_role text;
 v_roles text[];
 v_hours jsonb;
 v_open int;
 v_close int;
 v_digest text;
 v_result jsonb;
begin
 v_member=vitally_private.require_membership();
 v_person=vitally_private.acting_person(v_member);
 if v_member.access<>'staff' or v_person.id is null
  or not vitally_policy.is_workspace_admin(v_member.workspace_id) then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 if p_action_id is null or p_shift is null or jsonb_typeof(p_shift)<>'object'
  or (p_shift_id is null)<>(p_expected_revision is null) then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 if jsonb_typeof(p_shift->'volunteerId') is distinct from 'string'
  or (p_shift->>'volunteerId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  raise sqlstate 'VT007' using message='VALIDATION',detail='volunteerId';
 end if;
 v_volunteer=(p_shift->>'volunteerId')::uuid;
 if jsonb_typeof(p_shift->'date') is distinct from 'string'
  or (p_shift->>'date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
  raise sqlstate 'VT007' using message='VALIDATION',detail='date';
 end if;
 begin
  v_date=(p_shift->>'date')::date;
 exception when others then
  raise sqlstate 'VT007' using message='VALIDATION',detail='date';
 end;
 if to_char(v_date,'YYYY-MM-DD')<>(p_shift->>'date') then
  raise sqlstate 'VT007' using message='VALIDATION',detail='date';
 end if;
 if jsonb_typeof(p_shift->'startHour') is distinct from 'number'
  or (p_shift->>'startHour') !~ '^[0-9]{1,2}$' or (p_shift->>'startHour')::int>23 then
  raise sqlstate 'VT007' using message='VALIDATION',detail='startHour';
 end if;
 v_start=(p_shift->>'startHour')::int;
 if jsonb_typeof(p_shift->'endHour') is distinct from 'number'
  or (p_shift->>'endHour') !~ '^[0-9]{1,2}$' or (p_shift->>'endHour')::int>24
  or (p_shift->>'endHour')::int<=v_start then
  raise sqlstate 'VT007' using message='VALIDATION',detail='endHour';
 end if;
 v_end=(p_shift->>'endHour')::int;
 if jsonb_typeof(p_shift->'role') is distinct from 'string'
  or (p_shift->>'role') not in ('greeter','intaker','preparer','reviewer','admin') then
  raise sqlstate 'VT007' using message='VALIDATION',detail='role';
 end if;
 v_role=p_shift->>'role';
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_member.workspace_id::text,0));
 v_digest=encode(extensions.digest(jsonb_build_object('operation','SAVE_SHIFT','shiftId',p_shift_id,
  'expectedRevision',p_expected_revision,'volunteerId',v_volunteer,'date',v_date,'startHour',v_start,
  'endHour',v_end,'role',v_role,'personId',v_person.id)::text,'sha256'),'hex');
 v_receipt=vitally_private.reserve_receipt(v_member,p_action_id,'SAVE_SHIFT',v_digest,v_person.id);
 if v_receipt.receipt is not null then
  return v_receipt.receipt;
 end if;
 if p_shift_id is not null then
  select * into v_shift from public.shifts
   where id=p_shift_id and workspace_id=v_member.workspace_id and removed_at is null for update;
  if not found then
   raise sqlstate 'VT002' using message='NOT_FOUND';
  end if;
  if v_shift.revision<>p_expected_revision then
   raise sqlstate 'VT003' using message='CONFLICT';
  end if;
  if v_shift.person_id<>v_volunteer then
   raise sqlstate 'VT007' using message='VALIDATION',detail='volunteerId';
  end if;
 end if;
 select * into v_workspace from public.workspaces where id=v_member.workspace_id;
 select r.roles into v_roles from public.roster_entries r
  where r.workspace_id=v_member.workspace_id and r.person_id=v_volunteer and r.season=v_workspace.current_season;
 if v_roles is null then
  raise sqlstate 'VT007' using message='VALIDATION',detail='NOT_ON_ROSTER';
 end if;
 if exists(select 1 from public.accounts a
  where a.workspace_id=v_member.workspace_id and a.person_id=v_volunteer and a.status='deactivated') then
  raise sqlstate 'VT007' using message='VALIDATION',detail='DEACTIVATED';
 end if;
 if not v_role=any(v_roles) then
  raise sqlstate 'VT007' using message='VALIDATION',detail='ROLE_NOT_HELD';
 end if;
 select s.site_hours->(extract(isodow from v_date)::int)::text into v_hours
  from public.schedule_settings s where s.workspace_id=v_member.workspace_id;
 if v_hours is null then
  raise sqlstate 'VT007' using message='VALIDATION',detail='SITE_CLOSED';
 end if;
 v_open=(v_hours->>'open')::int;
 v_close=(v_hours->>'close')::int;
 if v_start<v_open or v_end>v_close then
  raise sqlstate 'VT007' using message='VALIDATION',detail='OUTSIDE_SITE_HOURS';
 end if;
 if exists(select 1 from public.shifts x
  where x.workspace_id=v_member.workspace_id and x.person_id=v_volunteer and x.shift_date=v_date
   and x.removed_at is null and x.id is distinct from p_shift_id
   and x.start_hour<v_end and x.end_hour>v_start) then
  raise sqlstate 'VT007' using message='VALIDATION',detail='OVERLAP';
 end if;
 if p_shift_id is null then
  insert into public.shifts(workspace_id,season,person_id,shift_date,start_hour,end_hour,role,
    created_by_person_id,updated_by_person_id)
   values(v_member.workspace_id,v_workspace.current_season,v_volunteer,v_date,v_start,v_end,v_role,
    v_person.id,v_person.id)
   returning * into v_shift;
 else
  update public.shifts set shift_date=v_date,start_hour=v_start,end_hour=v_end,role=v_role,
   revision=revision+1,updated_at=now(),updated_by_person_id=v_person.id
   where id=p_shift_id returning * into v_shift;
 end if;
 v_result=jsonb_build_object('shiftId',v_shift.id,'revision',v_shift.revision);
 update public.action_receipts set target_id=v_shift.id,receipt=v_result where id=v_receipt.id;
 return v_result;
end;
$$;
revoke all on function public.vitally_save_shift(uuid,uuid,bigint,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.vitally_save_shift(uuid,uuid,bigint,jsonb) to authenticated;

-- Removes a shift for a workspace admin only: removed_at is set and the
-- revision goes up, which is the UPDATE realtime delivers (design D2). Order:
-- FORBIDDEN, VALIDATION (a missing argument), the lock and receipt, NOT_FOUND
-- (unknown or already removed), CONFLICT (a stale revision). Answers
-- {shiftId, revision, removed: true}.
create function public.vitally_remove_shift(p_action_id uuid,p_shift_id uuid,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_person public.people;
 v_shift public.shifts;
 v_receipt public.action_receipts;
 v_digest text;
 v_result jsonb;
begin
 v_member=vitally_private.require_membership();
 v_person=vitally_private.acting_person(v_member);
 if v_member.access<>'staff' or v_person.id is null
  or not vitally_policy.is_workspace_admin(v_member.workspace_id) then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 if p_action_id is null or p_shift_id is null or p_expected_revision is null then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_member.workspace_id::text,0));
 v_digest=encode(extensions.digest(jsonb_build_object('operation','REMOVE_SHIFT','shiftId',p_shift_id,
  'expectedRevision',p_expected_revision,'personId',v_person.id)::text,'sha256'),'hex');
 v_receipt=vitally_private.reserve_receipt(v_member,p_action_id,'REMOVE_SHIFT',v_digest,v_person.id);
 if v_receipt.receipt is not null then
  return v_receipt.receipt;
 end if;
 select * into v_shift from public.shifts
  where id=p_shift_id and workspace_id=v_member.workspace_id and removed_at is null for update;
 if not found then
  raise sqlstate 'VT002' using message='NOT_FOUND';
 end if;
 if v_shift.revision<>p_expected_revision then
  raise sqlstate 'VT003' using message='CONFLICT';
 end if;
 update public.shifts set removed_at=now(),revision=revision+1,updated_at=now(),updated_by_person_id=v_person.id
  where id=p_shift_id returning * into v_shift;
 v_result=jsonb_build_object('shiftId',v_shift.id,'revision',v_shift.revision,'removed',true);
 update public.action_receipts set target_id=v_shift.id,receipt=v_result where id=v_receipt.id;
 return v_result;
end;
$$;
revoke all on function public.vitally_remove_shift(uuid,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.vitally_remove_shift(uuid,uuid,bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- §6. The schedule day read (design D3, D5, D6).

-- Why a shift may not count, for admins: notCleared (the volunteer is not
-- cleared), noSignIn (the person has no sign-in), roleRemoved (the role is no
-- longer on the current-season roster entry) and outsideSiteHours (the weekday
-- is closed, or the shift starts before opening or ends after closing), in that
-- order.
create function vitally_private.shift_flags(p_workspace_id uuid,p_shift public.shifts)
returns text[] language sql stable security definer set search_path='' as $$
 select array_remove(array[
  case when not vitally_private.cleared(p_workspace_id,p_shift.person_id) then 'notCleared' end,
  case when exists(select 1 from public.people p
    where p.workspace_id=p_workspace_id and p.id=p_shift.person_id and p.user_id is null) then 'noSignIn' end,
  case when not exists(select 1 from public.workspaces w
    join public.roster_entries r on r.workspace_id=w.id and r.season=w.current_season
    where w.id=p_workspace_id and r.person_id=p_shift.person_id and p_shift.role=any(r.roles)) then 'roleRemoved' end,
  case when not coalesce((select (h.hours->>'open')::int<=p_shift.start_hour and p_shift.end_hour<=(h.hours->>'close')::int
    from (select s.site_hours->(extract(isodow from p_shift.shift_date)::int)::text as hours
     from public.schedule_settings s where s.workspace_id=p_workspace_id) h
    where h.hours is not null),false) then 'outsideSiteHours' end
 ],null);
$$;
revoke all on function vitally_private.shift_flags(uuid,public.shifts) from public,anon,authenticated,service_role;

-- What a shift counts toward (design D6): null unless the volunteer is cleared
-- and the shift is neither roleRemoved nor outsideSiteHours; then preparer for
-- a preparer, reviewer for a reviewer, and onSite for a greeter or intaker who
-- works on site (on_site or on_site_and_remote). An admin shift counts nowhere.
create function vitally_private.shift_counts(p_workspace_id uuid,p_shift public.shifts)
returns text language sql stable security definer set search_path='' as $$
 select case
  when 'notCleared'=any(f.flags) or 'roleRemoved'=any(f.flags) or 'outsideSiteHours'=any(f.flags) then null
  when p_shift.role='preparer' then 'preparer'
  when p_shift.role='reviewer' then 'reviewer'
  when p_shift.role in ('greeter','intaker') and exists(select 1 from public.volunteer_profiles v
    where v.workspace_id=p_workspace_id and v.person_id=p_shift.person_id
     and v.works in ('on_site','on_site_and_remote')) then 'onSite'
 end
 from (select vitally_private.shift_flags(p_workspace_id,p_shift) as flags) f;
$$;
revoke all on function vitally_private.shift_counts(uuid,public.shifts) from public,anon,authenticated,service_role;

-- One day of the schedule for a schedule viewer (a workspace admin or anyone on
-- the current roster with an active staff account); FORBIDDEN otherwise,
-- clients included. Answers {date, weekday, hours (null when closed),
-- anyOpen (some weekday has hours), targets, settingsRevision, canEdit (a
-- workspace admin), canEditSettings (a site coordinator), shifts}, the live
-- current-season shifts of the day by name then start. A non-admin gets names,
-- roles and hours only, and not the shifts of people with no sign-in. A
-- workspace admin also gets, on each shift, flags and counts, and the
-- candidates for Add shift: current-season roster people with a role and an
-- account that is not deactivated.
create function public.vitally_schedule_day(p_date date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_person public.people;
 v_workspace public.workspaces;
 v_admin boolean;
 v_settings jsonb;
 v_result jsonb;
begin
 v_member=vitally_private.require_membership();
 v_person=vitally_private.acting_person(v_member);
 if v_member.access<>'staff' or v_person.id is null
  or not vitally_policy.is_schedule_viewer(v_member.workspace_id) then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 if p_date is null then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 select * into v_workspace from public.workspaces where id=v_member.workspace_id;
 v_admin=vitally_policy.is_workspace_admin(v_member.workspace_id);
 v_settings=vitally_private.schedule_settings_answer(v_member.workspace_id);
 v_result=jsonb_build_object('date',to_char(p_date,'YYYY-MM-DD'),'weekday',extract(isodow from p_date)::int,
  'hours',v_settings->'siteHours'->(extract(isodow from p_date)::int)::text,
  'anyOpen',v_settings->'siteHours'<>'{}'::jsonb,'targets',v_settings->'targets',
  'settingsRevision',v_settings->'revision','canEdit',v_admin,
  'canEditSettings',vitally_private.is_site_coordinator(v_member.workspace_id,v_person.id),
  'shifts',coalesce((select jsonb_agg(
    jsonb_build_object('shiftId',s.id,'revision',s.revision,'volunteerId',s.person_id,'name',p.name,
     'role',s.role,'startHour',s.start_hour,'endHour',s.end_hour)
    || case when v_admin then jsonb_build_object(
     'flags',to_jsonb(vitally_private.shift_flags(v_member.workspace_id,s)),
     'counts',to_jsonb(vitally_private.shift_counts(v_member.workspace_id,s))) else '{}'::jsonb end
    order by p.name,s.start_hour,s.id)
   from public.shifts s
   join public.people p on p.workspace_id=s.workspace_id and p.id=s.person_id
   where s.workspace_id=v_member.workspace_id and s.season=v_workspace.current_season
    and s.shift_date=p_date and s.removed_at is null
    and (v_admin or p.user_id is not null)),'[]'::jsonb));
 if v_admin then
  v_result=v_result||jsonb_build_object('candidates',coalesce((select jsonb_agg(jsonb_build_object(
    'volunteerId',p.id,'name',p.name,'roles',to_jsonb(r.roles),
    'usualDays',to_jsonb(coalesce(v.usual_days,'{}'::text[])), -- 058
    'cleared',vitally_private.cleared(v_member.workspace_id,p.id),'works',v.works,
    'signedIn',p.user_id is not null) order by p.name,p.id)
   from public.roster_entries r
   join public.people p on p.workspace_id=r.workspace_id and p.id=r.person_id
   left join public.volunteer_profiles v on v.workspace_id=p.workspace_id and v.person_id=p.id
   where r.workspace_id=v_member.workspace_id and r.season=v_workspace.current_season
    and cardinality(r.roles)>0
    and not exists(select 1 from public.accounts a
     where a.workspace_id=p.workspace_id and a.person_id=p.id and a.status='deactivated')),'[]'::jsonb));
 end if;
 return v_result;
end;
$$;
revoke all on function public.vitally_schedule_day(date) from public,anon,authenticated,service_role;
grant execute on function public.vitally_schedule_day(date) to authenticated;

-- ---------------------------------------------------------------------------
-- §7. The caller's own shifts this week, for My profile (design D5).

-- The Monday and Sunday of the week that holds p_at in America/New_York, as
-- dates. It reads the New York calendar date first, so a moment that is still
-- Sunday evening in New York belongs to that week even when it is Monday in
-- UTC, and the daylight-saving days need no hour arithmetic.
create function vitally_private.ny_week(p_at timestamptz)
returns table(monday date, sunday date) language sql stable security definer set search_path='' as $$
 select d-(extract(isodow from d)::int-1), d+(7-extract(isodow from d)::int)
 from (select (p_at at time zone 'America/New_York')::date as d) x;
$$;
revoke all on function vitally_private.ny_week(timestamptz) from public,anon,authenticated,service_role;

-- The signed-in staff member's own live current-season shifts from Monday to
-- Sunday of the New York week that holds now, by date then start. Answers
-- {weekStart, weekEnd, shifts: [{shiftId, date, startHour, endHour, role}]}.
-- It answers for the caller alone and holds nothing about anyone else. Gated
-- as main's vitally_my_profile (057 §6) is, but not by clearance: FORBIDDEN
-- for a client or an anonymous caller (require_membership), a staff caller
-- with no person row, or an account still invited (the first-sign-in site
-- check not passed). It does not need a volunteer profile row or a roster
-- entry: with neither, the week is simply empty.
create function public.vitally_my_shifts()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_person public.people;
 v_season smallint;
 v_week record;
begin
 v_member=vitally_private.require_membership();
 if v_member.access<>'staff' then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 select * into v_person from public.people
  where workspace_id=v_member.workspace_id and user_id=v_member.user_id;
 if v_person.id is null then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 if exists(select 1 from public.accounts a
  where a.workspace_id=v_person.workspace_id and a.user_id=v_member.user_id and a.status='invited') then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 select w.current_season into v_season from public.workspaces w where w.id=v_person.workspace_id;
 select * into v_week from vitally_private.ny_week(now());
 return jsonb_build_object(
  'weekStart',to_char(v_week.monday,'YYYY-MM-DD'),'weekEnd',to_char(v_week.sunday,'YYYY-MM-DD'),
  'shifts',coalesce((select jsonb_agg(jsonb_build_object('shiftId',s.id,
     'date',to_char(s.shift_date,'YYYY-MM-DD'),'startHour',s.start_hour,'endHour',s.end_hour,'role',s.role)
    order by s.shift_date,s.start_hour,s.id)
   from public.shifts s
   where s.workspace_id=v_person.workspace_id and s.season=v_season
    and s.person_id=v_person.id and s.removed_at is null
    and s.shift_date between v_week.monday and v_week.sunday),'[]'::jsonb));
end;
$$;
revoke all on function public.vitally_my_shifts() from public,anon,authenticated,service_role;
grant execute on function public.vitally_my_shifts() to authenticated;

-- ---------------------------------------------------------------------------
-- §8. The clearance answer gains scheduleViewer (design D3, D11).

-- From 057_my_profile §2, verbatim, with one change marked `-- 058`:
-- scheduleViewer, true for a schedule viewer (a workspace admin, or anyone on
-- the current roster with an active staff account) whether cleared or not.
-- Every 057 key stays.
create or replace function public.vitally_my_clearance()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_person public.people;
 v_entry public.roster_entries;
 v_held text[];
 v_missing jsonb='[]'::jsonb;
 v_role text;
 v_lacks text[];
 v_coordinator text;
 v_site_coordinator boolean; -- 052
 v_cleared boolean; -- 053
 v_site_check boolean; -- 057
begin
 v_member=vitally_private.require_membership();
 if v_member.access<>'staff' then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 select * into v_person from public.people
  where workspace_id=v_member.workspace_id and user_id=v_member.user_id;
 if v_person.id is null then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 v_site_coordinator=vitally_private.is_site_coordinator(v_person.workspace_id,v_person.id); -- 052
 v_cleared=vitally_private.cleared(v_person.workspace_id,v_person.id); -- 053
 v_site_check=exists(select 1 from public.accounts a where a.workspace_id=v_person.workspace_id and a.user_id=v_member.user_id and a.status='invited'); -- 057
 select r.* into v_entry from public.roster_entries r
  join public.workspaces w on w.id=r.workspace_id and w.current_season=r.season
  where r.workspace_id=v_person.workspace_id and r.person_id=v_person.id;
 if v_entry.person_id is null or cardinality(v_entry.roles)=0 then
  v_missing=v_missing||jsonb_build_array(jsonb_build_object('kind','form13615','sentAt',v_entry.form_13615_sent_at,'reviewedAt',v_entry.form_13615_reviewed_at,'reviewReason',v_entry.form_13615_review_reason)); -- 057
 end if;
 if v_entry.person_id is not null and v_entry.is_new and v_entry.photo_id_checked_at is null then
  v_missing=v_missing||jsonb_build_array(jsonb_build_object('kind','photoId','sentAt',v_entry.photo_id_sent_at,'reviewedAt',v_entry.photo_id_reviewed_at,'reviewReason',v_entry.photo_id_review_reason)); -- 057
 end if;
 if v_entry.person_id is not null then
  v_held=vitally_private.confirmed_certificates(v_entry.workspace_id,v_entry.person_id,v_entry.season);
  foreach v_role in array v_entry.roles loop
   v_lacks=vitally_private.missing_certificates(v_role,v_held);
   if cardinality(v_lacks)>0 then
    v_missing=v_missing||jsonb_build_array(jsonb_build_object('kind','role','role',v_role,'certificates',to_jsonb(v_lacks)));
   end if;
  end loop;
  if v_site_coordinator and not ('sc'=any(v_held)) then -- 052
   v_missing=v_missing||jsonb_build_array(jsonb_build_object('kind','siteCoordinator','certificates',jsonb_build_array('SC'))); -- 052
  end if; -- 052
 end if;
 select d.name into v_coordinator from public.workspaces w
  join public.people d on d.workspace_id=w.id and d.id=w.default_followup_person_id
  where w.id=v_person.workspace_id;
 return jsonb_build_object(
  'cleared',v_cleared, -- 053
  'missing',v_missing,
  'capabilities',case when v_cleared then to_jsonb(vitally_private.effective_capabilities(v_person.workspace_id,v_person.id)) else '[]'::jsonb end, -- 053
  'isAdmin',vitally_policy.is_workspace_admin(v_person.workspace_id), -- 052
  'isSiteCoordinator',v_site_coordinator, -- 052
  'scheduleViewer',vitally_private.schedule_viewer(v_person.workspace_id,v_person.id) or vitally_policy.is_workspace_admin(v_person.workspace_id), -- 058
  'siteCoordinatorName',to_jsonb(v_coordinator),
  'siteCheck',v_site_check, -- 057
  'uploadUrl',case when v_entry.person_id is not null and not v_site_check then (select s.certificate_upload_url from public.season_settings s where s.workspace_id=v_person.workspace_id) end); -- 057
end;
$$;
revoke all on function public.vitally_my_clearance() from public,anon,authenticated,service_role;
grant execute on function public.vitally_my_clearance() to authenticated;
