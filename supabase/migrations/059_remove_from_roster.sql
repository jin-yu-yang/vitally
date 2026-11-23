-- 059: Remove from this season's roster (OpenSpec change add-remove-from-roster,
-- design D1-D11; #232, #269).
--
-- In order:
--   §1 the roster_removals table: one row per removal (design D7);
--   §2 vitally_remove_from_roster: an admin takes a person off the current
--      season's roster, and deactivates their account in the same transaction
--      unless it is a site coordinator's (design D1-D6), and takes their
--      shifts from today on off the Schedule (design D12).
-- No existing function is changed. The only existing rows it changes are the
-- removed person's own: their entry, account, profile revision and shifts.
-- D8-D11 are the browser's (the drawer, the confirmation, the Reactivate
-- pointer, other windows); they need nothing more from the database.

-- ---------------------------------------------------------------------------
-- §1. The record of removals (design D7). A removal deletes the season's
-- certificates and sent and reviewed dates, and receipts carry no time, so
-- this is the only record of who removed whom, and when. The person ids are
-- historical scalars, as in season_starts (055), so no person key holds them.
-- Row security is on with no policy and no grant to signed-in users; only §2
-- writes it, and no screen reads it (design D9).

create table public.roster_removals (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 season smallint not null,
 person_id uuid not null,
 removed_by_person_id uuid not null,
 removed_at timestamptz not null default now(),
 account_deactivated boolean not null,
 shifts_removed integer not null default 0
);
alter table public.roster_removals enable row level security;
revoke all on public.roster_removals from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- §2. Remove a volunteer from this season's roster (design D1-D6), for a
-- workspace admin, in one transaction under the workspace lock. Order of
-- checks (design D4): FORBIDDEN (not a workspace admin: no receipt),
-- VALIDATION (a missing argument), VALIDATION (SELF: the caller's own row, no
-- receipt), the workspace lock, ADMIN_ROLE (the person
-- holds the Admin role this season and the caller isn't a site coordinator: no
-- receipt, as Save), the stored answer for a repeated action id (so a retry
-- after a lost reply is not a CONFLICT), NOT_FOUND (no profile in the caller's
-- workspace), CONFLICT (a stale profile revision), NOT_FOUND (no current-season
-- entry), FORBIDDEN (a site coordinator, and the caller isn't one), then
-- OPEN_WORK with the labels. Then, in order: the entry is
-- deleted, and its certificates with it; the person's live shifts from today
-- on (America/New_York) are marked removed; the account is deactivated as
-- Deactivate does, unless there is nothing to deactivate or it is a site
-- coordinator's; the profile revision is raised; the removal is recorded; the
-- receipt is stored. No email is sent.
--
-- The lock order is Save's: the workspace lock, the profile, the entry, then
-- the shifts and the account. Saving or removing a shift takes the workspace
-- lock first too. Save, Deactivate, Start next season and this all take the
-- workspace lock first, so none of them can deadlock with another.

create function public.vitally_remove_from_roster(p_action_id uuid,p_volunteer_id uuid,p_expected_revision bigint)
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
 -- take first too.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_member.workspace_id::text,0));
 -- 4. Removal takes the Admin role away, which only a site coordinator may do
 -- (052 rule 3, design D3). Refused before the receipt is reserved, as Save
 -- does, from the stored roles of the current-season entry.
 select r.roles into v_stored_roles from public.roster_entries r
  join public.workspaces w on w.id=r.workspace_id and w.current_season=r.season
  where r.workspace_id=v_member.workspace_id and r.person_id=p_volunteer_id;
 if 'admin'=any(coalesce(v_stored_roles,'{}'::text[]))
  and not vitally_private.is_site_coordinator(v_member.workspace_id,v_person.id) then
  raise sqlstate 'VT001' using message='ADMIN_ROLE';
 end if;
 -- 5. The receipt, before the revision is compared: a repeated action id
 -- returns the stored answer although its revision is now stale.
 v_digest=encode(extensions.digest(jsonb_build_object('operation','REMOVE_FROM_ROSTER','volunteerId',p_volunteer_id,
  'expectedRevision',p_expected_revision,'personId',v_person.id)::text,'sha256'),'hex');
 v_receipt=vitally_private.reserve_receipt(v_member,p_action_id,'REMOVE_FROM_ROSTER',v_digest,v_person.id);
 if v_receipt.receipt is not null then
  return v_receipt.receipt;
 end if;
 -- 6. An invitation past its expiry is cancelled first, as the other account
 -- RPCs do, so step 13 sees the account as it now stands.
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
 -- 13. The account, as Deactivate does (design D1, D2). Skipped with no
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
 -- 14. The profile revision (design D5). Save inserts or updates the
 -- current-season entry, so without this a second admin's open drawer could
 -- save afterwards and quietly put the person back. With it, that save gets
 -- CONFLICT.
 update public.volunteer_profiles set revision=revision+1,updated_at=now()
  where workspace_id=v_member.workspace_id and person_id=p_volunteer_id;
 -- 15. The record (design D7, D12).
 insert into public.roster_removals(workspace_id,season,person_id,removed_by_person_id,account_deactivated,shifts_removed)
  values(v_member.workspace_id,v_entry.season,p_volunteer_id,v_person.id,v_deactivated,v_shifts_removed);
 -- 16. The receipt.
 v_result=jsonb_build_object('actionId',p_action_id,'volunteerId',p_volunteer_id,
  'revision',v_profile.revision+1,'accountDeactivated',v_deactivated,'shiftsRemoved',v_shifts_removed);
 update public.action_receipts set target_id=p_volunteer_id,receipt=v_result where id=v_receipt.id;
 return v_result;
end;
$$;
revoke all on function public.vitally_remove_from_roster(uuid,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.vitally_remove_from_roster(uuid,uuid,bigint) to authenticated;
