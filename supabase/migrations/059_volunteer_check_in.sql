-- 059: volunteer check-in (OpenSpec change add-volunteer-check-in, design
-- D1, D2, D5, D9).
--
-- Who actually came, and for how long. One row per check-in: a volunteer
-- checks in and out, and an admin may correct or add rows. In order:
--   §1 storage (design D1): the check_ins table and its checks;
--   §2 the counted span (design D5): the day's end, and the state, end and
--      minutes of one check-in;
--   §3 who reads (design D9): a caller-only policy helper, the SELECT policy
--      and the SELECT grant. No write grant; the RPCs of later tasks are the
--      only writers;
--   §4 realtime (design D9): check_ins joins the publication.
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
