-- 062: Remove from roster checks out today's open check-in, and a replay returns
-- its stored result before the Admin role is checked (OpenSpec change
-- close-check-in-on-roster-removal, design D1-D8; #277, #300).
--
-- In order:
--   §1 roster_removals.check_in_closed: whether the removal checked a person
--      out (design D4);
--   §2 vitally_remove_from_roster, re-created from 059 §2 with each changed or
--      new line marked -- 062, as 061 marks its lines, so a reviewer can diff
--      it against 059 (design D7). The changes:
--      - the volunteer's open check-in from today is checked out at the
--        removal, as the remover's correction (design D1-D3);
--      - ADMIN_ROLE is checked after the receipt lookup, as Save has since 061
--        (design D6, #300).
-- 059 is not edited. Its comment "Refused before the receipt is reserved, as
-- Save does" no longer holds; the function body below carries the corrected
-- wording.
--
-- The lock order is now the workspace lock, the person's membership, the
-- profile, the entry, the shifts, the check-in, then the account (design D5).
-- Every other writer of check_ins takes the workspace lock first
-- (vitally_check_in, vitally_check_out, vitally_save_check_in and
-- vitally_remove_check_in), and this holds it throughout, so it waits on no
-- check-in row that another holder of the workspace lock could hold.
--
-- Two 060 lock shapes this change leaves as they are (design Risks 2 and 3,
-- follow-up #305):
--   - a volunteer's own check-in or check-out holds their membership FOR SHARE
--     (require_membership) and then waits for the workspace lock, while this
--     holds the workspace lock and wants that membership FOR UPDATE, so they
--     can deadlock (40P01); Postgres aborts one, and nothing half-written
--     remains;
--   - a site coordinator's check-in tests can_check_in before the workspace
--     lock, and this does not lock a site coordinator's membership, so such a
--     check-in can land just after their removal and stay open.

-- ---------------------------------------------------------------------------
-- §1. Whether the removal closed a check-in (design D4). The default keeps
-- earlier rows valid, which closed none.

alter table public.roster_removals add column check_in_closed boolean not null default false;

-- ---------------------------------------------------------------------------
-- §2. Remove a volunteer from this season's roster. Order of checks: FORBIDDEN
-- (not a workspace admin: no receipt), VALIDATION (a missing argument),
-- VALIDATION (SELF: the caller's own row, no receipt), the workspace lock, the
-- person's membership (if this will deactivate it), the stored answer for a
-- repeated action id (so a retry after a lost reply is not a CONFLICT, and not
-- ADMIN_ROLE although the roles changed since), ADMIN_ROLE (the person holds
-- the Admin role this season and the caller isn't a site coordinator: no
-- receipt is stored, the refusal rolls the reserved one back), NOT_FOUND (no
-- profile in the caller's workspace), CONFLICT (a stale profile revision),
-- NOT_FOUND (no current-season entry), FORBIDDEN (a site coordinator, and the
-- caller isn't one), then OPEN_WORK with the labels. Then, in order: the entry
-- is deleted, and its certificates with it; the person's live shifts from today
-- on (America/New_York) are marked removed; their open check-in from today is
-- checked out; the account is deactivated as Deactivate does, unless there is
-- nothing to deactivate or it is a site coordinator's; the profile revision is
-- raised; the removal is recorded; the receipt is stored. No email is sent.

create or replace function public.vitally_remove_from_roster(p_action_id uuid,p_volunteer_id uuid,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_person public.people;
 v_receipt public.action_receipts;
 v_profile public.volunteer_profiles;
 v_entry public.roster_entries;
 v_account public.accounts;
 v_stored_roles text[];
 v_digest text;
 v_open_work jsonb;
 v_deactivated boolean=false;
 v_shifts_removed integer=0;
 v_check_ins_closed integer=0; -- 062
 v_result jsonb;
begin
 -- 1. A workspace admin: a site coordinator, or the Admin role this season,
 -- cleared or not (052).
 v_member=vitally_private.require_membership();
 v_person=vitally_private.acting_person(v_member);
 if v_member.access<>'staff' or v_person.id is null or not vitally_policy.is_workspace_admin(v_member.workspace_id) then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 -- 2. A malformed envelope cannot be digested or reserved. Then the caller's
 -- own row (design D3), before ADMIN_ROLE: every admin who isn't a site
 -- coordinator holds the Admin role, so after it they would never see SELF.
 if p_action_id is null or p_volunteer_id is null or p_expected_revision is null then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 if p_volunteer_id=v_person.id then
  raise sqlstate 'VT007' using message='VALIDATION',detail='SELF';
 end if;
 -- 3. The workspace lock, which Save, the account RPCs and Start next season
 -- take first too. Then the person's membership, if step 14 will deactivate -- 062
 -- it, before their profile, as their own writes take them (see the header).
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_member.workspace_id::text,0));
 perform 1 from public.memberships m
  join public.accounts a on a.workspace_id=m.workspace_id and a.user_id=m.user_id
  where m.workspace_id=v_member.workspace_id and a.person_id=p_volunteer_id
   and a.status in ('invited','active') and not a.is_site_coordinator
  for update of m;
 -- 4. The receipt, before the revision is compared: a repeated action id -- 062
 -- returns the stored answer although its revision is now stale. -- 062
 v_digest=encode(extensions.digest(jsonb_build_object('operation','REMOVE_FROM_ROSTER','volunteerId',p_volunteer_id,
  'expectedRevision',p_expected_revision,'personId',v_person.id)::text,'sha256'),'hex');
 v_receipt=vitally_private.reserve_receipt(v_member,p_action_id,'REMOVE_FROM_ROSTER',v_digest,v_person.id);
 if v_receipt.receipt is not null then
  return v_receipt.receipt;
 end if;
 -- 5. Removal takes the Admin role away, which only a site coordinator may do -- 062
 -- (052 rule 3, design D3). Refused after the receipt lookup, as Save is since -- 062
 -- 061, so a replay of a landed removal returns its stored result although the -- 062
 -- stored roles have changed since (#300). The refusal rolls the reserved -- 062
 -- receipt back with the rest, so none is stored. From the stored roles of the -- 062
 -- current-season entry. -- 062
 select r.roles into v_stored_roles from public.roster_entries r -- 062
  join public.workspaces w on w.id=r.workspace_id and w.current_season=r.season -- 062
  where r.workspace_id=v_member.workspace_id and r.person_id=p_volunteer_id; -- 062
 if 'admin'=any(coalesce(v_stored_roles,'{}'::text[])) -- 062
  and not vitally_private.is_site_coordinator(v_member.workspace_id,v_person.id) then -- 062
  raise sqlstate 'VT001' using message='ADMIN_ROLE'; -- 062
 end if; -- 062
 -- 6. An invitation past its expiry is cancelled first, as the other account
 -- RPCs do, so step 14 sees the account as it now stands. -- 062
 perform vitally_private.expire_invitations(v_member.workspace_id);
 -- 7. The profile, whose revision the Edit drawer holds (design D5).
 select * into v_profile from public.volunteer_profiles
  where workspace_id=v_member.workspace_id and person_id=p_volunteer_id for update;
 if not found then
  raise sqlstate 'VT002' using message='NOT_FOUND';
 end if;
 if v_profile.revision<>p_expected_revision then
  raise sqlstate 'VT003' using message='CONFLICT';
 end if;
 -- 8. The current-season entry. Earlier seasons' entries are never touched.
 select r.* into v_entry from public.roster_entries r
  join public.workspaces w on w.id=r.workspace_id and w.current_season=r.season
  where r.workspace_id=v_member.workspace_id and r.person_id=p_volunteer_id
  for update of r;
 if not found then
  raise sqlstate 'VT002' using message='NOT_FOUND';
 end if;
 -- 9. Only a site coordinator removes a site coordinator, as only one
 -- deactivates one (052, design D3).
 if vitally_private.is_site_coordinator(v_member.workspace_id,p_volunteer_id)
  and not vitally_private.is_site_coordinator(v_member.workspace_id,v_person.id) then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 -- 10. All of the open work, before anything is written. Save excuses a site
 -- coordinator who is the default follow-up person; removal does not, since it
 -- leaves them with no roles.
 select jsonb_agg(w.label) into v_open_work from vitally_private.open_work(v_member.workspace_id,p_volunteer_id) w;
 if v_open_work is not null then
  raise sqlstate 'VT004' using message='OPEN_WORK',detail=v_open_work::text;
 end if;
 -- 11. The entry, and with it the season's certificates (on delete cascade)
 -- and the sent and reviewed fields. The mirror trigger (052) empties
 -- people.capabilities. The person and profile, usual days included, stay.
 delete from public.roster_entries
  where workspace_id=v_entry.workspace_id and person_id=v_entry.person_id and season=v_entry.season;
 -- 12. The person's live shifts this season from today on, where today is the
 -- America/New_York date as in 058 (design D12). Shifts refer to people, not
 -- to the entry, so without this they would stay on the Schedule, tagged Not
 -- cleared and Role removed, under the person's name. They are marked removed
 -- as Remove shift does, so Realtime announces each as an UPDATE and open
 -- Schedule windows re-read. Earlier days stay, so this week's hours on
 -- Workload still count what was worked. A shift already removed is left.
 update public.shifts set removed_at=now(),revision=revision+1,updated_at=now(),updated_by_person_id=v_person.id
  where workspace_id=v_member.workspace_id and person_id=p_volunteer_id and season=v_entry.season
   and removed_at is null and shift_date>=(now() at time zone 'America/New_York')::date;
 get diagnostics v_shifts_removed=row_count;
 -- 13. The person's open check-in from today, checked out at this moment as the -- 062
 -- remover's correction (design D1-D3), so it doesn't stay open with nobody -- 062
 -- able to close it. The predicate is open_check_in's: a live row, no -- 062
 -- check-out, on today's America/New_York date. An earlier day's open row stays, -- 062
 -- missed to its day's end, as it already counts. The check-out is the -- 062
 -- later of now and a microsecond after the check-in, as vitally_check_out -- 062
 -- has it, for check_ins_out_after_in. The row reads as Corrected with the -- 062
 -- remover's name, and the UPDATE is a Realtime event, so open Schedules -- 062
 -- re-read. The workspace lock is held, as every writer of check_ins takes -- 062
 -- it first (design D5). -- 062
 update public.check_ins set checked_out_at=greatest(now(),checked_in_at+interval '1 microsecond'), -- 062
  revision=revision+1,updated_at=now(),updated_by_person_id=v_person.id,corrected_by_person_id=v_person.id -- 062
  where workspace_id=v_member.workspace_id and person_id=p_volunteer_id and removed_at is null -- 062
   and checked_out_at is null and check_in_date=(now() at time zone 'America/New_York')::date; -- 062
 get diagnostics v_check_ins_closed=row_count; -- 062
 -- 14. The account, as Deactivate does (design D1, D2). Skipped with no -- 062
 -- account, or one already deactivated (design D6): deactivate_account would
 -- raise INVALID_TRANSITION there, and a Remove racing a Deactivate in another
 -- window must either succeed or get CONFLICT. If Deactivate ran first, this
 -- succeeds and skips it; if this ran first, deactivate_account raised the
 -- account revision, so Deactivate's own check answers CONFLICT. A site
 -- coordinator's account is never passed to it either: it would clear their
 -- mark and record a change, or refuse LAST_SITE_COORDINATOR. They stay a
 -- site coordinator, with no roles this season.
 select * into v_account from public.accounts
  where workspace_id=v_member.workspace_id and person_id=p_volunteer_id for update;
 if found and v_account.status in ('invited','active') and not v_account.is_site_coordinator then
  perform vitally_private.deactivate_account(v_member.workspace_id,v_account.user_id,v_person.id);
  v_deactivated=true;
 end if;
 -- 15. The profile revision (design D5). Save inserts or updates the -- 062
 -- current-season entry, so without this a second admin's open drawer could
 -- save afterwards and quietly put the person back. With it, that save gets
 -- CONFLICT.
 update public.volunteer_profiles set revision=revision+1,updated_at=now()
  where workspace_id=v_member.workspace_id and person_id=p_volunteer_id;
 -- 16. The record (design D7, D12, D4). -- 062
 insert into public.roster_removals(workspace_id,season,person_id,removed_by_person_id,account_deactivated,shifts_removed,check_in_closed) -- 062
  values(v_member.workspace_id,v_entry.season,p_volunteer_id,v_person.id,v_deactivated,v_shifts_removed,v_check_ins_closed>0); -- 062
 -- 17. The receipt. -- 062
 v_result=jsonb_build_object('actionId',p_action_id,'volunteerId',p_volunteer_id,
  'revision',v_profile.revision+1,'accountDeactivated',v_deactivated,'shiftsRemoved',v_shifts_removed);
 update public.action_receipts set target_id=p_volunteer_id,receipt=v_result where id=v_receipt.id;
 return v_result;
end;
$$;
revoke all on function public.vitally_remove_from_roster(uuid,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.vitally_remove_from_roster(uuid,uuid,bigint) to authenticated;
