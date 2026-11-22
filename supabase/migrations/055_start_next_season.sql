-- 055: Start next season (OpenSpec change add-start-next-season, design D1-D6,
-- D10).
--
-- In order:
--   §1 the past-season check: a case numbered in an earlier season than the
--      workspace's current one is read-only (lock_case and
--      vitally_assistance_action);
--   §2 open_work counts only current-season cases;
--   §3 drop vitally_private.capabilities_before_052;
--   §4 the season_starts table;
--   §5 vitally_start_next_season.
-- Replaced functions are copied from their latest migration, with changed
-- lines marked `-- 055`.

-- ---------------------------------------------------------------------------
-- §1. Past seasons are read-only (design D5). lock_case (043) is the one choke
-- point for vitally_apply_action, vitally_log_contact, vitally_edit_contact,
-- vitally_set_case_label and vitally_close_unsigned, for staff and clients
-- alike. A draft has no season yet (010 numbers a case on submit), so it stays
-- writable and submits into the current season. Reads are unchanged: a client
-- still sees their past-season application. No table grant or storage policy
-- lets a signed-in user write a case row directly, so nothing else needs the
-- check.

create or replace function vitally_private.lock_case(p_member public.memberships,p_case_id uuid)
returns public.cases language plpgsql security definer set search_path='' as $$
declare v_case public.cases;
begin
 select * into v_case from public.cases c
  where c.id=p_case_id and c.workspace_id=p_member.workspace_id
   and ((p_member.access='applicant' and c.owner_user_id=p_member.user_id)
     or (p_member.access='staff' and (c.origin<>'client' or c.stage<>'draft')))
  for update;
 if not found then
  raise sqlstate 'VT002' using message='NOT_FOUND';
 end if;
 if v_case.season is not null -- 055
   and v_case.season<>(select w.current_season from public.workspaces w where w.id=v_case.workspace_id) then -- 055
  raise sqlstate 'VT004' using message='INVALID_TRANSITION',detail='PAST_SEASON'; -- 055
 end if; -- 055
 return v_case;
end;
$$;

-- vitally_assistance_action (045): a help request naming a past-season case
-- can't be claimed or resolved. One with no case is unaffected.
create or replace function public.vitally_assistance_action(p_action_id uuid,p_item_id uuid,p_expected_revision bigint,p_type text,p_note text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_receipt public.action_receipts;
 v_item public.assistance_items;
 v_person public.people;
 v_operation text;
 v_digest text;
 v_revision bigint;
begin
 v_member=vitally_private.require_membership();
 v_person=vitally_private.acting_person(v_member);
 perform vitally_private.require_cleared(v_member);
 -- A malformed envelope cannot be digested or reserved; the note is still
 -- checked at step 5, after the target and authority checks.
 if p_action_id is null or p_item_id is null or p_expected_revision is null or p_type is null then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 v_operation='ASSISTANCE:'||p_type;
 v_digest=encode(extensions.digest(jsonb_build_object('operation',v_operation,'itemId',p_item_id,'expectedRevision',p_expected_revision,'personId',v_person.id,'note',p_note)::text,'sha256'),'hex');
 v_receipt=vitally_private.reserve_receipt(v_member,p_action_id,v_operation,v_digest,v_person.id);
 -- An identical accepted replay returns its receipt after the current membership
 -- and operation-authority checks, without repeating the mutation and without
 -- reaching the target.
 if v_receipt.receipt is not null then
  perform vitally_private.check_operation_authority(v_member,v_person.id,v_operation);
  return v_receipt.receipt;
 end if;
 v_item=vitally_private.lock_assistance_item(v_member,p_item_id);
 if v_item.case_id is not null and exists(select 1 from public.cases c -- 055
   join public.workspaces w on w.id=c.workspace_id -- 055
   where c.workspace_id=v_item.workspace_id and c.id=v_item.case_id -- 055
    and c.season is not null and c.season<>w.current_season) then -- 055
  raise sqlstate 'VT004' using message='INVALID_TRANSITION',detail='PAST_SEASON'; -- 055
 end if; -- 055
 v_person=vitally_private.check_operation_authority(v_member,v_person.id,v_operation);
 if v_item.revision<>p_expected_revision then
  raise sqlstate 'VT003' using message='CONFLICT';
 end if;
 perform vitally_private.check_assistance_note(p_type,p_note);
 case p_type
  when 'CLAIM' then v_revision=vitally_private.act_assistance_claim(v_item,v_person);
  when 'RESOLVE' then v_revision=vitally_private.act_assistance_resolve(v_item,v_person,p_note);
  else raise sqlstate 'VT007' using message='VALIDATION';
 end case;
 return vitally_private.commit_assistance(p_action_id,v_item,v_revision,v_receipt);
end;
$$;
revoke all on function public.vitally_assistance_action(uuid,uuid,bigint,text,text) from public,anon,authenticated,service_role;
grant execute on function public.vitally_assistance_action(uuid,uuid,bigint,text,text) to authenticated;

-- ---------------------------------------------------------------------------
-- §2. Open work counts only the current season's cases (design D6). open_work
-- is from 045. A case a past season left behind keeps naming its preparer and
-- reviewer, so without the season bound a returning volunteer could never lose
-- Preparer or be deactivated. A case with no season yet still counts. Branches
-- 3-5 are unchanged.

create or replace function vitally_private.open_work(p_workspace_id uuid,p_person_id uuid)
returns table(needs text,label text) language sql stable security definer set search_path='' as $$
 select w.needs,w.label from (
  select 1 as ord,c.client_number as n,'prepare' as needs,'preparing client '||coalesce(c.client_number::text,c.reference) as label
   from public.cases c join public.workspaces ws on ws.id=c.workspace_id -- 055
   where c.workspace_id=p_workspace_id and c.preparer_id=p_person_id and c.stage<>'closed' -- 055
    and (c.season=ws.current_season or c.season is null) -- 055
  union all
  select 2,c.client_number,'review','reviewing client '||coalesce(c.client_number::text,c.reference)
   from public.cases c join public.workspaces ws on ws.id=c.workspace_id -- 055
   where c.workspace_id=p_workspace_id and c.reviewer_id=p_person_id and c.stage<>'closed' -- 055
    and (c.season=ws.current_season or c.season is null) -- 055
  union all
  select 3,c.client_number,'followup','follow-up for client '||coalesce(c.client_number::text,c.reference)
   from public.admin_followups t join public.cases c on c.workspace_id=t.workspace_id and c.id=t.case_id
   where t.workspace_id=p_workspace_id and t.assignee_person_id=p_person_id and t.status='open'
  union all
  select 4,null,'followup','default follow-up person'
   from public.workspaces ws where ws.id=p_workspace_id and ws.default_followup_person_id=p_person_id
  union all
  select 5,null,'assist','a help request'
   from public.assistance_items a where a.workspace_id=p_workspace_id and a.assignee_person_id=p_person_id and a.status='assigned'
 ) w order by w.ord,w.n nulls last,w.label collate "C";
$$;
revoke all on function vitally_private.open_work(uuid,uuid) from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- §3. 052 kept a copy of everyone's capabilities from before it, for a
-- rollback. Nothing reads it.

drop table vitally_private.capabilities_before_052;

-- ---------------------------------------------------------------------------
-- §4. The record of starts (design D4 step 6): one row per Start next season.
-- The follow-up columns are both null when the default follow-up person was
-- kept. The person ids are historical scalars, as receipts' actors are, so no
-- person key holds them. Row security is on with no policy and no grant to
-- signed-in users; only §5 writes it.

create table public.season_starts (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 from_season smallint not null,
 to_season smallint not null check (to_season=from_season+1),
 started_by_person_id uuid not null,
 started_at timestamptz not null default now(),
 default_followup_from uuid,
 default_followup_to uuid,
 deactivated_count integer not null check (deactivated_count>=0)
);
alter table public.season_starts enable row level security;
revoke all on public.season_starts from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- §5. Start next season (design D1-D4), for a site coordinator, in one
-- transaction under the workspace lock. Order of checks: FORBIDDEN (not an
-- active site coordinator: nothing written, no receipt), the workspace lock,
-- FORBIDDEN again (removed or deactivated while waiting for the lock), the
-- staff membership locks and the table locks, the stored answer for a repeated action id (so a retry after a lost reply is
-- not a CONFLICT), CONFLICT (the season already moved), VALIDATION (the typed
-- year is not the next season, or the next season is past 2100), then
-- SEASON_NOT_FINISHED with the counts while work is open. Then, in order: the
-- default follow-up person moves to the starter unless a site coordinator; the
-- season moves; the starter goes on the new roster with no roles; every other
-- staff account that is invited or active and isn't a site coordinator's is
-- deactivated as Deactivate does (the season has moved, so open_work sees no
-- past case, and the default no longer names them); the mirror is recomputed,
-- since its triggers don't fire on workspaces; the start is recorded; the
-- receipt is stored. No email is sent.

create function public.vitally_start_next_season(p_action_id uuid,p_expected_season smallint,p_typed_year smallint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_person public.people;
 v_receipt public.action_receipts;
 v_workspace public.workspaces;
 v_digest text;
 v_season smallint;
 v_open_cases integer;
 v_open_followups integer;
 v_claimed_help integer;
 v_unclaimed_help integer;
 v_default_from uuid;
 v_default_to uuid;
 v_user uuid;
 v_deactivated integer=0;
 v_result jsonb;
begin
 v_member=vitally_private.require_membership();
 v_person=vitally_private.acting_person(v_member);
 if v_member.access<>'staff' or v_person.id is null
  or not vitally_private.is_site_coordinator(v_member.workspace_id,v_person.id) then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 if p_action_id is null or p_expected_season is null or p_typed_year is null then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_member.workspace_id::text,0));
 -- Again under the lock: removing a site coordinator and Deactivate take the
 -- same lock, so one that committed while this call waited is seen here. Still
 -- FORBIDDEN with no receipt.
 if not vitally_private.is_site_coordinator(v_member.workspace_id,v_person.id) then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 -- The memberships step 4 will deactivate, in user order, before the table
 -- locks: staff, with an invited or active account that isn't a site
 -- coordinator's (the same set as step 4's loop). A staff write takes FOR
 -- SHARE on its own membership first (require_membership), then its case or
 -- follow-up row. Without this, a write holding FOR SHARE and waiting on the
 -- table locks, and this call waiting on that FOR SHARE, would deadlock. A
 -- write already holding its membership finishes first; one that comes later
 -- waits here. The set can't change while this runs: granting or removing site
 -- coordinator, and every account change, take the workspace lock above.
 -- Site coordinators' memberships are not locked. Another site coordinator
 -- pressing Start, or saving Season settings, holds FOR SHARE on their own
 -- membership while waiting for the workspace lock, so locking theirs would
 -- deadlock (40P01) instead of answering CONFLICT. Client memberships are not
 -- changed, so they are not locked either.
 perform 1 from public.memberships m
  join public.accounts a on a.workspace_id=m.workspace_id and a.user_id=m.user_id
  where m.workspace_id=v_member.workspace_id and m.access='staff'
   and a.status in ('invited','active') and not a.is_site_coordinator
  order by m.user_id for update of m;
 -- Case writes don't take the workspace lock, so without these the counts
 -- below could miss a case reopened, a follow-up opened or a help request
 -- claimed while the start runs. Writes already in flight finish first. A
 -- staff write that comes after is refused once this commits: a deactivated
 -- person's by the membership check (their membership is no longer active), a
 -- site coordinator's as PAST_SEASON (§1), since it reads the new
 -- current_season. Reads are not blocked.
 -- tools/admin/relabel-season.mjs locks cases the same way.
 lock table public.cases,public.admin_followups,public.assistance_items in exclusive mode;
 v_digest=encode(extensions.digest(jsonb_build_object('operation','START_NEXT_SEASON',
  'expectedSeason',p_expected_season,'typedYear',p_typed_year,'personId',v_person.id)::text,'sha256'),'hex');
 v_receipt=vitally_private.reserve_receipt(v_member,p_action_id,'START_NEXT_SEASON',v_digest,v_person.id);
 if v_receipt.receipt is not null then
  return v_receipt.receipt;
 end if;
 -- No key update, not update: a case RPC that has stored its receipt holds
 -- KEY SHARE on this row (the receipt's workspace key) and may be waiting on
 -- the table locks above, so FOR UPDATE could deadlock with it. The advisory
 -- lock already orders this against other writers of the row, and the updates
 -- below change no key column. The later locks (accounts, memberships,
 -- people, all without key changes) don't conflict with KEY SHARE either.
 select * into v_workspace from public.workspaces where id=v_member.workspace_id for no key update;
 if v_workspace.current_season<>p_expected_season then
  raise sqlstate 'VT003' using message='CONFLICT';
 end if;
 if p_typed_year<>p_expected_season+1 or p_expected_season+1>2100 then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 v_season=p_expected_season+1;
 -- The refusal counts (design D3): open cases in any season, since a past
 -- case left open could never be finished; help requests with no case carry
 -- over.
 select count(*) into v_open_cases from public.cases c
  where c.workspace_id=v_member.workspace_id and c.stage not in ('draft','accepted','closed');
 select count(*) into v_open_followups from public.admin_followups t
  where t.workspace_id=v_member.workspace_id and t.status='open';
 select count(*) into v_claimed_help from public.assistance_items a
  where a.workspace_id=v_member.workspace_id and a.status='assigned';
 select count(*) into v_unclaimed_help from public.assistance_items a
  where a.workspace_id=v_member.workspace_id and a.status='open' and a.case_id is not null;
 if v_open_cases+v_open_followups+v_claimed_help+v_unclaimed_help>0 then
  raise sqlstate 'VT004' using message='SEASON_NOT_FINISHED',
   detail=jsonb_build_object('openCases',v_open_cases,'openFollowups',v_open_followups,
    'claimedHelp',v_claimed_help,'unclaimedHelpOnCases',v_unclaimed_help)::text;
 end if;
 -- 1. The default follow-up person: the starter, unless a site coordinator.
 -- Before step 4, since open_work counts the default follow-up person.
 if v_workspace.default_followup_person_id is null
  or not vitally_private.is_site_coordinator(v_member.workspace_id,v_workspace.default_followup_person_id) then
  v_default_from=v_workspace.default_followup_person_id;
  v_default_to=v_person.id;
  update public.workspaces set default_followup_person_id=v_person.id where id=v_member.workspace_id;
 end if;
 -- 2. The season. Client numbers are per (workspace, season), so the new
 -- season's start at 1.
 update public.workspaces set current_season=v_season where id=v_member.workspace_id;
 -- 3. The starter on the new roster: no roles, no certificates, not new.
 insert into public.roster_entries(workspace_id,person_id,season,roles,added_by_person_id,is_new,photo_id_checked_at)
  values(v_member.workspace_id,v_person.id,v_season,'{}',v_person.id,false,null);
 -- 4. Every other staff sign-in, as Deactivate does. A refusal from it (such
 -- as OPEN_WORK) aborts the whole start; the counts above leave nothing that
 -- could cause one.
 for v_user in select a.user_id from public.accounts a
  join public.memberships m on m.workspace_id=a.workspace_id and m.user_id=a.user_id
  where a.workspace_id=v_member.workspace_id and m.access='staff'
   and a.status in ('invited','active') and not a.is_site_coordinator
  order by a.person_id
 loop
  -- The starter is a site coordinator (checked under the lock), so never in
  -- this set. If they were, the whole start is refused rather than leaving no
  -- one signed in to finish it.
  if v_user=v_member.user_id then
   raise sqlstate 'VT001' using message='FORBIDDEN';
  end if;
  perform vitally_private.deactivate_account(v_member.workspace_id,v_user,v_person.id);
  v_deactivated=v_deactivated+1;
 end loop;
 -- 5. The mirror: the people trigger (052) stores each person's new-season
 -- capabilities.
 update public.people set capabilities=capabilities where workspace_id=v_member.workspace_id;
 -- 6. The record.
 insert into public.season_starts(workspace_id,from_season,to_season,started_by_person_id,
   default_followup_from,default_followup_to,deactivated_count)
  values(v_member.workspace_id,p_expected_season,v_season,v_person.id,v_default_from,v_default_to,v_deactivated);
 -- 7. The receipt.
 v_result=jsonb_build_object('actionId',p_action_id,'season',v_season,'deactivated',v_deactivated,
  'defaultFollowupMoved',v_default_to is not null);
 update public.action_receipts set target_id=v_member.workspace_id,receipt=v_result where id=v_receipt.id;
 return v_result;
end;
$$;
revoke all on function public.vitally_start_next_season(uuid,smallint,smallint) from public,anon,authenticated,service_role;
grant execute on function public.vitally_start_next_season(uuid,smallint,smallint) to authenticated;
