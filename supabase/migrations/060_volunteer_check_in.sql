-- 060: volunteer check-in (OpenSpec change add-volunteer-check-in, design
-- D1 to D5 and D7 to D9).
--
-- Who actually came, and for how long. One row per check-in: a volunteer
-- checks in and out, and an admin may correct or add rows. In order:
--   §1 storage (design D1): the check_ins table and its checks;
--   §2 the counted span (design D2): the day's end, and the state, end and
--      minutes of one check-in;
--   §3 who reads (design D5): a caller-only policy helper, the SELECT policy
--      and the SELECT grant. No write grant; the RPCs are the only writers;
--   §4 realtime (design D9): check_ins joins the publication;
--   §5 the self RPCs (design D3): vitally_my_check_in, vitally_check_in and
--      vitally_check_out, with three private helpers. They take every time
--      from now(), the clock the open check-in test uses;
--   §6 admin corrections (design D4): one check-in as an answer item, then
--      vitally_save_check_in and vitally_remove_check_in;
--   §7 the schedule day read (design D7), replaced to add checkIns for admins;
--   §8 hours this week (design D8): vitally_hours_this_week.
-- Nothing existing changes except the publication and vitally_schedule_day.

-- ---------------------------------------------------------------------------
-- §1. Storage (design D1).

-- One row per check-in of one person on one New York date. checked_out_at is
-- null while the volunteer has not checked out. Removing a check-in sets
-- removed_at (as shifts do): the store watches INSERT and UPDATE only. The
-- person key follows 058's: deleting a person deletes their check-ins. The
-- creator, updater and corrector are historical scalars.
create table public.check_ins (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 season smallint not null,
 person_id uuid not null,
 check_in_date date not null,
 checked_in_at timestamptz not null,
 checked_out_at timestamptz,
 revision bigint not null default 1,
 created_at timestamptz not null default now(),
 created_by_person_id uuid,
 updated_at timestamptz not null default now(),
 updated_by_person_id uuid,
 corrected_by_person_id uuid,
 removed_at timestamptz,
 constraint check_ins_out_after_in check (checked_out_at is null or checked_out_at>checked_in_at),
 -- The date is the New York date of the check-in, and a check-out falls no
 -- later than the midnight that ends that date ("24:00").
 constraint check_ins_on_date check (
  (checked_in_at at time zone 'America/New_York')::date=check_in_date
  and (checked_out_at is null
   or checked_out_at<=((check_in_date+1)::timestamp at time zone 'America/New_York'))),
 foreign key (workspace_id,person_id) references public.people(workspace_id,id) on delete cascade
);
create index check_ins_day on public.check_ins(workspace_id,season,check_in_date);

alter table public.check_ins enable row level security;
revoke all on public.check_ins from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- §2. The counted span (design D2).

-- When a person's day ends, as an instant, or null for no end: the latest
-- live shift end_hour that day for the person, else the close of the site
-- hours for that weekday (schedule_settings.site_hours, keyed by ISO weekday),
-- else null. An hour h is the New York wall-clock time date + h hours, so
-- 24 is the next midnight and a daylight saving Sunday is converted right.
create function vitally_private.check_in_day_end(p_workspace_id uuid,p_person_id uuid,p_date date)
returns timestamptz language sql stable security definer set search_path='' as $$
 select (p_date+make_interval(hours=>h.hour))::timestamp at time zone 'America/New_York'
 from (select coalesce(
   (select max(s.end_hour) from public.shifts s
     where s.workspace_id=p_workspace_id and s.person_id=p_person_id
      and s.shift_date=p_date and s.removed_at is null),
   (select (ss.site_hours->(extract(isodow from p_date)::int)::text->>'close')::int
     from public.schedule_settings ss where ss.workspace_id=p_workspace_id)) as hour) h
 where h.hour is not null;
$$;
revoke all on function vitally_private.check_in_day_end(uuid,uuid,date) from public,anon,authenticated,service_role;

-- The state, end and counted minutes of one check-in at p_now:
--   out    when checked out: the end is the check-out;
--   open   when not out and it is still the check-in's New York date: the end
--          is the earlier of now and the day's end (the check-in itself when
--          the day has no end);
--   missed when not out and the date has passed: the end is the day's end
--          (the check-in itself when the day has no end).
-- An end before the check-in is the check-in, so minutes are never negative.
create function vitally_private.check_in_span(p_check_in public.check_ins,p_now timestamptz)
returns table(state text,ends_at timestamptz,minutes int)
language plpgsql stable security definer set search_path='' as $$
declare
 v_state text;
 v_end timestamptz;
 v_day_end timestamptz;
begin
 if p_check_in.checked_out_at is not null then
  v_state:='out';
  v_end:=p_check_in.checked_out_at;
 else
  v_day_end:=vitally_private.check_in_day_end(p_check_in.workspace_id,p_check_in.person_id,p_check_in.check_in_date);
  if p_check_in.check_in_date=(p_now at time zone 'America/New_York')::date then
   v_state:='open';
   v_end:=case when v_day_end is null then p_check_in.checked_in_at else least(p_now,v_day_end) end;
  else
   v_state:='missed';
   v_end:=coalesce(v_day_end,p_check_in.checked_in_at);
  end if;
 end if;
 if v_end<p_check_in.checked_in_at then v_end:=p_check_in.checked_in_at; end if;
 return query select v_state,v_end,floor(extract(epoch from v_end-p_check_in.checked_in_at)/60)::int;
end;
$$;
revoke all on function vitally_private.check_in_span(public.check_ins,timestamptz) from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- §3. Who reads (design D5).

-- Whether a person is the caller's own person in that workspace. It takes no
-- user id: it answers only for the caller.
create function vitally_policy.is_own_person(p_workspace_id uuid,p_person_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.people p
  where p.workspace_id=p_workspace_id and p.id=p_person_id and p.user_id=(select auth.uid()));
$$;
revoke all on function vitally_policy.is_own_person(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function vitally_policy.is_own_person(uuid,uuid) to authenticated;

-- SELECT only, for realtime: an admin reads every row, anyone else only their
-- own. removed_at is not tested, so realtime can deliver the removal UPDATE.
grant select on public.check_ins to authenticated;
create policy check_ins_read on public.check_ins for select to authenticated
 using (vitally_policy.is_workspace_admin(workspace_id)
  or vitally_policy.is_own_person(workspace_id,person_id));

-- ---------------------------------------------------------------------------
-- §4. Realtime (design D9), with 058's pattern: INSERT and UPDATE reach open
-- windows under the same policy.
do $$
begin
 if not exists(select 1 from pg_publication where pubname='supabase_realtime') then
  raise exception 'The supabase_realtime publication is missing; enable Realtime on this project before migrating.';
 end if;
 if not exists(
  select 1 from pg_publication_tables
  where pubname='supabase_realtime' and schemaname='public' and tablename='check_ins'
 ) then
  alter publication supabase_realtime add table public.check_ins;
 end if;
end $$;

-- ---------------------------------------------------------------------------
-- §5. The self check-in RPCs (design D3).

-- The caller's person, gated as vitally_my_shifts (058 §7) gates it, for a
-- membership require_membership has already returned: FORBIDDEN for a client
-- (a client or an anonymous caller does not pass require_membership), a staff
-- caller with no person row, or an account still invited.
create function vitally_private.check_in_person(p_member public.memberships)
returns public.people language plpgsql stable security definer set search_path='' as $$
declare v_person public.people;
begin
 if p_member.access<>'staff' then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 select * into v_person from public.people
  where workspace_id=p_member.workspace_id and user_id=p_member.user_id;
 if v_person.id is null then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 if exists(select 1 from public.accounts a
  where a.workspace_id=v_person.workspace_id and a.user_id=p_member.user_id and a.status='invited') then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 return v_person;
end;
$$;
revoke all on function vitally_private.check_in_person(public.memberships) from public,anon,authenticated,service_role;

-- Whether the person may check in: cleared, with a current-season roster
-- entry.
create function vitally_private.can_check_in(p_person public.people)
returns boolean language sql stable security definer set search_path='' as $$
 select vitally_private.cleared(p_person.workspace_id,p_person.id)
  and exists(select 1 from public.roster_entries r
   join public.workspaces w on w.id=r.workspace_id and r.season=w.current_season
   where r.workspace_id=p_person.workspace_id and r.person_id=p_person.id);
$$;
revoke all on function vitally_private.can_check_in(public.people) from public,anon,authenticated,service_role;

-- The person's live check-in dated today (New York) with no check-out, if
-- any. Yesterday's open row is not open.
create function vitally_private.open_check_in(p_workspace_id uuid,p_person_id uuid)
returns public.check_ins language sql stable security definer set search_path='' as $$
 select c.* from public.check_ins c
  where c.workspace_id=p_workspace_id and c.person_id=p_person_id and c.removed_at is null
   and c.checked_out_at is null
   and c.check_in_date=(now() at time zone 'America/New_York')::date
  order by c.checked_in_at desc limit 1;
$$;
revoke all on function vitally_private.open_check_in(uuid,uuid) from public,anon,authenticated,service_role;

-- {today, canCheckIn, open}. Not gated by clearance: an uncleared staff member
-- gets canCheckIn false, so a window can learn it has no strip.
create function public.vitally_my_check_in()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_person public.people;
 v_open public.check_ins;
begin
 v_member=vitally_private.require_membership();
 v_person=vitally_private.check_in_person(v_member);
 v_open=vitally_private.open_check_in(v_person.workspace_id,v_person.id);
 return jsonb_build_object(
  'today',to_char((now() at time zone 'America/New_York')::date,'YYYY-MM-DD'),
  'canCheckIn',vitally_private.can_check_in(v_person),
  'open',case when v_open.id is null then null
   else jsonb_build_object('checkInId',v_open.id,'checkedInAt',to_jsonb(v_open.checked_in_at)) end);
end;
$$;
revoke all on function public.vitally_my_check_in() from public,anon,authenticated,service_role;
grant execute on function public.vitally_my_check_in() to authenticated;

-- Adds a check-in for the caller at the current time. FORBIDDEN, then
-- NOT_CLEARED (VT009; neither writes nor stores a receipt), then the workspace
-- lock, the receipt (a replay returns the stored answer), then VALIDATION
-- ALREADY_CHECKED_IN when an open check-in exists today. Answers {open}.
create function public.vitally_check_in(p_action_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_person public.people;
 v_receipt public.action_receipts;
 v_now timestamptz;
 v_row public.check_ins;
 v_result jsonb;
begin
 v_member=vitally_private.require_membership();
 v_person=vitally_private.check_in_person(v_member);
 if not vitally_private.can_check_in(v_person) then
  raise sqlstate 'VT009' using message='NOT_CLEARED';
 end if;
 if p_action_id is null then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_member.workspace_id::text,0));
 v_receipt=vitally_private.reserve_receipt(v_member,p_action_id,'CHECK_IN',
  encode(extensions.digest(jsonb_build_object('operation','CHECK_IN','personId',v_person.id)::text,'sha256'),'hex'),
  v_person.id);
 if v_receipt.receipt is not null then
  return v_receipt.receipt;
 end if;
 if (vitally_private.open_check_in(v_person.workspace_id,v_person.id)).id is not null then
  raise sqlstate 'VT007' using message='VALIDATION',detail='ALREADY_CHECKED_IN';
 end if;
 v_now=now();
 insert into public.check_ins(workspace_id,season,person_id,check_in_date,checked_in_at,
   created_at,created_by_person_id,updated_at,updated_by_person_id)
  select w.id,w.current_season,v_person.id,(v_now at time zone 'America/New_York')::date,v_now,
   v_now,v_person.id,v_now,v_person.id
  from public.workspaces w where w.id=v_person.workspace_id
  returning * into v_row;
 v_result=jsonb_build_object('open',jsonb_build_object('checkInId',v_row.id,'checkedInAt',to_jsonb(v_row.checked_in_at)));
 update public.action_receipts set target_id=v_row.id,receipt=v_result where id=v_receipt.id;
 return v_result;
end;
$$;
revoke all on function public.vitally_check_in(uuid) from public,anon,authenticated,service_role;
grant execute on function public.vitally_check_in(uuid) to authenticated;

-- Sets the current time as the check-out of the caller's open check-in today
-- and raises its revision. The same refusal order as vitally_check_in, with
-- VALIDATION NOT_CHECKED_IN when nothing is open. It never sets
-- corrected_by_person_id: that is for an admin's correction. Answers
-- {checkInId, checkedInAt, checkedOutAt}.
create function public.vitally_check_out(p_action_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_person public.people;
 v_receipt public.action_receipts;
 v_open public.check_ins;
 v_row public.check_ins;
 v_now timestamptz;
 v_result jsonb;
begin
 v_member=vitally_private.require_membership();
 v_person=vitally_private.check_in_person(v_member);
 if not vitally_private.can_check_in(v_person) then
  raise sqlstate 'VT009' using message='NOT_CLEARED';
 end if;
 if p_action_id is null then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_member.workspace_id::text,0));
 v_receipt=vitally_private.reserve_receipt(v_member,p_action_id,'CHECK_OUT',
  encode(extensions.digest(jsonb_build_object('operation','CHECK_OUT','personId',v_person.id)::text,'sha256'),'hex'),
  v_person.id);
 if v_receipt.receipt is not null then
  return v_receipt.receipt;
 end if;
 v_open=vitally_private.open_check_in(v_person.workspace_id,v_person.id);
 if v_open.id is null then
  raise sqlstate 'VT007' using message='VALIDATION',detail='NOT_CHECKED_IN';
 end if;
 v_now=greatest(now(),v_open.checked_in_at+interval '1 microsecond');
 update public.check_ins set checked_out_at=v_now,revision=revision+1,updated_at=v_now,
   updated_by_person_id=v_person.id
  where id=v_open.id returning * into v_row;
 v_result=jsonb_build_object('checkInId',v_row.id,'checkedInAt',to_jsonb(v_row.checked_in_at),
  'checkedOutAt',to_jsonb(v_row.checked_out_at));
 update public.action_receipts set target_id=v_row.id,receipt=v_result where id=v_receipt.id;
 return v_result;
end;
$$;
revoke all on function public.vitally_check_out(uuid) from public,anon,authenticated,service_role;
grant execute on function public.vitally_check_out(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- §6. Admin corrections (design D4).

-- One check-in as the schedule day read and the save answer show it:
-- {checkInId, revision, volunteerId, name, checkedInAt, checkedOutAt, endsAt,
-- state, minutes, flags: {noCheckOut, notScheduled, corrected,
-- outsideSiteHours}, correctedByName}, with the span counted at now().
-- noCheckOut is state missed; notScheduled is no live shift for the person that
-- day; corrected is an admin's save; outsideSiteHours is a closed weekday, a
-- check-in before the open hour or an end after the close hour.
create function vitally_private.check_in_item(p_check_in public.check_ins)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_span record;
 v_hours jsonb;
 v_name text;
 v_by text;
begin
 select * into v_span from vitally_private.check_in_span(p_check_in,now());
 select p.name into v_name from public.people p
  where p.workspace_id=p_check_in.workspace_id and p.id=p_check_in.person_id;
 select p.name into v_by from public.people p
  where p.workspace_id=p_check_in.workspace_id and p.id=p_check_in.corrected_by_person_id;
 select s.site_hours->(extract(isodow from p_check_in.check_in_date)::int)::text into v_hours
  from public.schedule_settings s where s.workspace_id=p_check_in.workspace_id;
 return jsonb_build_object('checkInId',p_check_in.id,'revision',p_check_in.revision,
  'volunteerId',p_check_in.person_id,'name',v_name,
  'checkedInAt',to_jsonb(p_check_in.checked_in_at),'checkedOutAt',to_jsonb(p_check_in.checked_out_at),
  'endsAt',to_jsonb(v_span.ends_at),'state',v_span.state,'minutes',v_span.minutes,
  'flags',jsonb_build_object(
   'noCheckOut',v_span.state='missed',
   'notScheduled',not exists(select 1 from public.shifts x
     where x.workspace_id=p_check_in.workspace_id and x.person_id=p_check_in.person_id
      and x.shift_date=p_check_in.check_in_date and x.removed_at is null),
   'corrected',p_check_in.corrected_by_person_id is not null,
   'outsideSiteHours',(v_hours->>'open') is null
    or p_check_in.checked_in_at<(p_check_in.check_in_date+make_interval(hours=>(v_hours->>'open')::int))::timestamp at time zone 'America/New_York'
    or v_span.ends_at>(p_check_in.check_in_date+make_interval(hours=>(v_hours->>'close')::int))::timestamp at time zone 'America/New_York'),
  'correctedByName',v_by);
end;
$$;
revoke all on function vitally_private.check_in_item(public.check_ins) from public,anon,authenticated,service_role;

-- Adds a check-in (p_check_in_id and p_expected_revision both null) or edits
-- one (both present), for a workspace admin only, cleared or not. p_check_in is
-- {volunteerId, date, checkedIn, checkedOut}: checkedIn is a New York "HH:MM"
-- on the date, checkedOut is "HH:MM", "24:00" (the next midnight) or null. An
-- add needs volunteerId and date; an edit keeps the stored person and date, and
-- may leave both out or repeat them. Order, as vitally_save_shift (058 §5):
-- FORBIDDEN (nothing written, no receipt); VALIDATION of the shape (a missing
-- argument, p_check_in not an object, mismatched ids and revision, then
-- volunteerId, date, checkedIn, checkedOut as detail); then under the workspace
-- lock the receipt (a replay returns the stored answer); NOT_FOUND (VT002) for
-- an unknown or removed check-in; CONFLICT (a stale revision); then the
-- VALIDATION reasons that read stored state, as the detail, in this order:
-- volunteerId and date (an edit names another person or date), NOT_ON_ROSTER,
-- DEACTIVATED, OUT_BEFORE_IN, IN_FUTURE, OVERLAP (design D4: spans as
-- check_in_span counts them, except that a check-in dated the New York today
-- with no check-out runs on with no end, the one being saved included; spans
-- may meet). Every save sets
-- corrected_by_person_id; the original times are not kept. Answers the
-- check-in as check_in_item does.
create function public.vitally_save_check_in(p_action_id uuid,p_check_in_id uuid,p_expected_revision bigint,p_check_in jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_person public.people;
 v_workspace public.workspaces;
 v_row public.check_ins;
 v_new public.check_ins;
 v_receipt public.action_receipts;
 v_volunteer uuid;
 v_date date;
 v_in timestamptz;
 v_out timestamptz;
 v_end timestamptz;
 v_today date;
 v_digest text;
 v_result jsonb;
begin
 v_member=vitally_private.require_membership();
 v_person=vitally_private.acting_person(v_member);
 if v_member.access<>'staff' or v_person.id is null
  or not vitally_policy.is_workspace_admin(v_member.workspace_id) then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 if p_action_id is null or p_check_in is null or jsonb_typeof(p_check_in)<>'object'
  or (p_check_in_id is null)<>(p_expected_revision is null) then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 -- volunteerId and date: required for an add, optional for an edit.
 if p_check_in_id is null or coalesce(jsonb_typeof(p_check_in->'volunteerId'),'null')<>'null' then
  if jsonb_typeof(p_check_in->'volunteerId') is distinct from 'string'
   or (p_check_in->>'volunteerId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
   raise sqlstate 'VT007' using message='VALIDATION',detail='volunteerId';
  end if;
  v_volunteer=(p_check_in->>'volunteerId')::uuid;
 end if;
 if p_check_in_id is null or coalesce(jsonb_typeof(p_check_in->'date'),'null')<>'null' then
  if jsonb_typeof(p_check_in->'date') is distinct from 'string'
   or (p_check_in->>'date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
   raise sqlstate 'VT007' using message='VALIDATION',detail='date';
  end if;
  begin
   v_date=(p_check_in->>'date')::date;
  exception when others then
   raise sqlstate 'VT007' using message='VALIDATION',detail='date';
  end;
  if to_char(v_date,'YYYY-MM-DD')<>(p_check_in->>'date') then
   raise sqlstate 'VT007' using message='VALIDATION',detail='date';
  end if;
 end if;
 if jsonb_typeof(p_check_in->'checkedIn') is distinct from 'string'
  or (p_check_in->>'checkedIn') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
  raise sqlstate 'VT007' using message='VALIDATION',detail='checkedIn';
 end if;
 if not (p_check_in ? 'checkedOut') or (jsonb_typeof(p_check_in->'checkedOut')<>'null'
  and (jsonb_typeof(p_check_in->'checkedOut')<>'string'
   or (p_check_in->>'checkedOut') !~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$')) then
  raise sqlstate 'VT007' using message='VALIDATION',detail='checkedOut';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_member.workspace_id::text,0));
 v_digest=encode(extensions.digest(jsonb_build_object('operation','SAVE_CHECK_IN','checkInId',p_check_in_id,
  'expectedRevision',p_expected_revision,'volunteerId',v_volunteer,'date',v_date,
  'checkedIn',p_check_in->'checkedIn','checkedOut',p_check_in->'checkedOut','personId',v_person.id)::text,'sha256'),'hex');
 v_receipt=vitally_private.reserve_receipt(v_member,p_action_id,'SAVE_CHECK_IN',v_digest,v_person.id);
 if v_receipt.receipt is not null then
  return v_receipt.receipt;
 end if;
 if p_check_in_id is not null then
  select * into v_row from public.check_ins
   where id=p_check_in_id and workspace_id=v_member.workspace_id and removed_at is null for update;
  if not found then
   raise sqlstate 'VT002' using message='NOT_FOUND';
  end if;
  if v_row.revision<>p_expected_revision then
   raise sqlstate 'VT003' using message='CONFLICT';
  end if;
  if v_volunteer is not null and v_volunteer<>v_row.person_id then
   raise sqlstate 'VT007' using message='VALIDATION',detail='volunteerId';
  end if;
  if v_date is not null and v_date<>v_row.check_in_date then
   raise sqlstate 'VT007' using message='VALIDATION',detail='date';
  end if;
  v_volunteer=v_row.person_id;
  v_date=v_row.check_in_date;
 end if;
 select * into v_workspace from public.workspaces where id=v_member.workspace_id;
 if not exists(select 1 from public.roster_entries r
  where r.workspace_id=v_member.workspace_id and r.person_id=v_volunteer and r.season=v_workspace.current_season) then
  raise sqlstate 'VT007' using message='VALIDATION',detail='NOT_ON_ROSTER';
 end if;
 if exists(select 1 from public.accounts a
  where a.workspace_id=v_member.workspace_id and a.person_id=v_volunteer and a.status='deactivated') then
  raise sqlstate 'VT007' using message='VALIDATION',detail='DEACTIVATED';
 end if;
 v_in=(v_date+(p_check_in->>'checkedIn')::time)::timestamp at time zone 'America/New_York';
 if jsonb_typeof(p_check_in->'checkedOut')='string' then
  v_out=case when (p_check_in->>'checkedOut')='24:00'
   then (v_date+1)::timestamp at time zone 'America/New_York'
   else (v_date+(p_check_in->>'checkedOut')::time)::timestamp at time zone 'America/New_York' end;
 end if;
 -- An edit that sends the minute already stored keeps the stored instant, its
 -- seconds included (design D4: a saved time stays as it is unless the admin
 -- changes that field). Otherwise an unchanged Save could move a volunteer's
 -- own 12:54:45 back to 12:54:00 and be refused OVERLAP or OUT_BEFORE_IN.
 if p_check_in_id is not null then
  if date_trunc('minute',v_row.checked_in_at at time zone 'America/New_York')
   =v_in at time zone 'America/New_York' then
   v_in=v_row.checked_in_at;
  end if;
  if v_out is not null and v_row.checked_out_at is not null
   and date_trunc('minute',v_row.checked_out_at at time zone 'America/New_York')
    =v_out at time zone 'America/New_York' then
   v_out=v_row.checked_out_at;
  end if;
 end if;
 if v_out is not null and v_out<=v_in then
  raise sqlstate 'VT007' using message='VALIDATION',detail='OUT_BEFORE_IN';
 end if;
 if v_in>now() or v_out>now() then
  raise sqlstate 'VT007' using message='VALIDATION',detail='IN_FUTURE';
 end if;
 -- The new span: to the check-out, else to the end the row would be counted
 -- to. For this check only, a check-in dated today with no check-out, this one
 -- or another, runs on with no end: its capped end is only an estimate, and it
 -- grows when the volunteer checks out.
 v_today=(now() at time zone 'America/New_York')::date;
 v_new.workspace_id=v_member.workspace_id;
 v_new.person_id=v_volunteer;
 v_new.check_in_date=v_date;
 v_new.checked_in_at=v_in;
 v_new.checked_out_at=v_out;
 if v_out is null and v_date=v_today then
  v_end='infinity';
 else
  select s.ends_at into v_end from vitally_private.check_in_span(v_new,now()) s;
 end if;
 if exists(select 1 from public.check_ins c
   cross join lateral vitally_private.check_in_span(c,now()) s
  where c.workspace_id=v_member.workspace_id and c.person_id=v_volunteer and c.check_in_date=v_date
   and c.removed_at is null and c.id is distinct from p_check_in_id
   and c.checked_in_at<v_end
   and v_in<case when c.checked_out_at is null and c.check_in_date=v_today
    then 'infinity'::timestamptz else s.ends_at end) then
  raise sqlstate 'VT007' using message='VALIDATION',detail='OVERLAP';
 end if;
 if p_check_in_id is null then
  insert into public.check_ins(workspace_id,season,person_id,check_in_date,checked_in_at,checked_out_at,
    created_by_person_id,updated_by_person_id,corrected_by_person_id)
   values(v_member.workspace_id,v_workspace.current_season,v_volunteer,v_date,v_in,v_out,
    v_person.id,v_person.id,v_person.id)
   returning * into v_row;
 else
  update public.check_ins set checked_in_at=v_in,checked_out_at=v_out,
   revision=revision+1,updated_at=now(),updated_by_person_id=v_person.id,corrected_by_person_id=v_person.id
   where id=p_check_in_id returning * into v_row;
 end if;
 v_result=vitally_private.check_in_item(v_row);
 update public.action_receipts set target_id=v_row.id,receipt=v_result where id=v_receipt.id;
 return v_result;
end;
$$;
revoke all on function public.vitally_save_check_in(uuid,uuid,bigint,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.vitally_save_check_in(uuid,uuid,bigint,jsonb) to authenticated;

-- Removes a check-in for a workspace admin only: removed_at is set and the
-- revision goes up, which is the UPDATE realtime delivers. Order as
-- vitally_remove_shift: FORBIDDEN, VALIDATION (a missing argument), the lock
-- and receipt, NOT_FOUND (unknown or already removed), CONFLICT. Answers
-- {checkInId, revision}.
create function public.vitally_remove_check_in(p_action_id uuid,p_check_in_id uuid,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_person public.people;
 v_row public.check_ins;
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
 if p_action_id is null or p_check_in_id is null or p_expected_revision is null then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_member.workspace_id::text,0));
 v_digest=encode(extensions.digest(jsonb_build_object('operation','REMOVE_CHECK_IN','checkInId',p_check_in_id,
  'expectedRevision',p_expected_revision,'personId',v_person.id)::text,'sha256'),'hex');
 v_receipt=vitally_private.reserve_receipt(v_member,p_action_id,'REMOVE_CHECK_IN',v_digest,v_person.id);
 if v_receipt.receipt is not null then
  return v_receipt.receipt;
 end if;
 select * into v_row from public.check_ins
  where id=p_check_in_id and workspace_id=v_member.workspace_id and removed_at is null for update;
 if not found then
  raise sqlstate 'VT002' using message='NOT_FOUND';
 end if;
 if v_row.revision<>p_expected_revision then
  raise sqlstate 'VT003' using message='CONFLICT';
 end if;
 update public.check_ins set removed_at=now(),revision=revision+1,updated_at=now(),updated_by_person_id=v_person.id
  where id=p_check_in_id returning * into v_row;
 v_result=jsonb_build_object('checkInId',v_row.id,'revision',v_row.revision);
 update public.action_receipts set target_id=v_row.id,receipt=v_result where id=v_receipt.id;
 return v_result;
end;
$$;
revoke all on function public.vitally_remove_check_in(uuid,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.vitally_remove_check_in(uuid,uuid,bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- §7. The schedule day read (design D7).

-- 060: replaced from 058 §6, verbatim except the lines marked `-- 060`: for a
-- workspace admin the answer also holds checkIns, the day's live check-ins as
-- check_in_item builds them. Every 058 key stays, and a non-admin answer has no
-- checkIns key. The comment below is 058's, with its last sentence added.
-- One day of the schedule for a schedule viewer (a workspace admin or anyone on
-- the current roster with an active staff account); FORBIDDEN otherwise,
-- clients included. Answers {date, weekday, hours (null when closed),
-- anyOpen (some weekday has hours), targets, settingsRevision, canEdit (a
-- workspace admin), canEditSettings (a site coordinator), shifts}, the live
-- current-season shifts of the day by name then start. A non-admin gets names,
-- roles and hours only, and not the shifts of people with no sign-in. A
-- workspace admin also gets, on each shift, flags and counts, and the
-- candidates for Add shift: current-season roster people with a role and an
-- account that is not deactivated. -- 060: A workspace admin also gets checkIns.
create or replace function public.vitally_schedule_day(p_date date)
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
 -- 060: an admin also gets the day's live current-season check-ins (design D7),
 -- by check-in time. Nobody else gets the key, so a non-admin answer is 058's.
 v_result=v_result||jsonb_build_object('checkIns',coalesce((select jsonb_agg( -- 060
    vitally_private.check_in_item(c) order by c.checked_in_at,c.id) -- 060
   from public.check_ins c -- 060
   where c.workspace_id=v_member.workspace_id and c.season=v_workspace.current_season -- 060
    and c.check_in_date=p_date and c.removed_at is null),'[]'::jsonb)); -- 060
 end if;
 return v_result;
end;
$$;
revoke all on function public.vitally_schedule_day(date) from public,anon,authenticated,service_role;
grant execute on function public.vitally_schedule_day(date) to authenticated;

-- ---------------------------------------------------------------------------
-- §8. Hours this week (design D8).

-- For a workspace admin only (FORBIDDEN otherwise): each volunteer's counted
-- minutes this week, the sum of the check_in_span minutes of their live
-- current-season check-ins dated from Monday to Sunday of the New York week that
-- holds now (058's ny_week). Answers {weekStart, weekEnd, hours: [{volunteerId,
-- minutes}]}, ordered by volunteer, with only the volunteers who have any.
create function public.vitally_hours_this_week()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_person public.people;
 v_season smallint;
 v_week record;
begin
 v_member=vitally_private.require_membership();
 v_person=vitally_private.acting_person(v_member);
 if v_member.access<>'staff' or v_person.id is null
  or not vitally_policy.is_workspace_admin(v_member.workspace_id) then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 select w.current_season into v_season from public.workspaces w where w.id=v_member.workspace_id;
 select * into v_week from vitally_private.ny_week(now());
 return jsonb_build_object(
  'weekStart',to_char(v_week.monday,'YYYY-MM-DD'),'weekEnd',to_char(v_week.sunday,'YYYY-MM-DD'),
  'hours',coalesce((select jsonb_agg(jsonb_build_object('volunteerId',t.person_id,'minutes',t.minutes)
    order by t.person_id)
   from (select c.person_id,sum(s.minutes)::int as minutes
    from public.check_ins c
    cross join lateral vitally_private.check_in_span(c,now()) s
    where c.workspace_id=v_member.workspace_id and c.season=v_season and c.removed_at is null
     and c.check_in_date between v_week.monday and v_week.sunday
    group by c.person_id) t),'[]'::jsonb));
end;
$$;
revoke all on function public.vitally_hours_this_week() from public,anon,authenticated,service_role;
grant execute on function public.vitally_hours_this_week() to authenticated;
