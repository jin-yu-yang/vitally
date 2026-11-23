-- 059: volunteer check-in (OpenSpec change add-volunteer-check-in, design
-- D1, D2, D5, D9).
--
-- Who actually came, and for how long. One row per check-in: a volunteer
-- checks in and out, and an admin may correct or add rows. In order:
--   §1 storage (design D1): the check_ins table and its checks;
--   §2 the counted span (design D5): the day's end, and the state, end and
--      minutes of one check-in;
--   §3 who reads (design D9): a caller-only policy helper, the SELECT policy
--      and the SELECT grant. No write grant; the RPCs are the only writers;
--   §4 realtime (design D9): check_ins joins the publication;
--   §5 the self RPCs (design D3): vitally_my_check_in, vitally_check_in and
--      vitally_check_out, with three private helpers.
-- Nothing existing changes except the publication.

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
-- §2. The counted span (design D5).

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
-- §3. Who reads (design D9).

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
 v_now=clock_timestamp();
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
 v_now=greatest(clock_timestamp(),v_open.checked_in_at+interval '1 microsecond');
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
