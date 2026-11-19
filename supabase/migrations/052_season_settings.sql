-- 052: season settings (OpenSpec change add-season-settings, design D1-D8).
--
-- people.capabilities becomes a mirror of the person's current-season role
-- capabilities while they have a sign-in, and empty otherwise (design D1).
-- In order (design D8):
--   §1 the guard: refuse with VT008, changing nothing, if any person with an
--      active staff membership holds `admin` in people.capabilities without
--      the Admin role on their current-season roster entry;
--   §2 the snapshot of every person's capabilities, for a rollback migration;
--   §3 the schema: effective_capabilities (role capabilities only), the
--      mirror helper and its two triggers; the site coordinator flag on
--      accounts and its history (design D4);
--   §4 the recompute of every person's capabilities;
--   §5 onwards, the functions: §5 site coordinators, the workspace admin
--      check and clearance (design D2, D4, D6); §6 staff setup without
--      capabilities (design D1, D9); §7 granting and removing site
--      coordinators (design D4); §8 the default follow-up person (design D7).
-- The migration runs in one transaction.

-- ---------------------------------------------------------------------------
-- §1. The guard. Only active staff memberships are counted: a person with no
-- sign-in, or an inactive one, already has no admin to lose.

-- 052 §1 begin
do $$
declare v_count bigint;
begin
 select count(*) into v_count
  from public.memberships m
  join public.people p on p.workspace_id=m.workspace_id and p.user_id=m.user_id
  where m.active and m.access='staff' and 'admin'=any(p.capabilities)
   and not exists(select 1 from public.workspaces w
    join public.roster_entries r on r.workspace_id=w.id and r.season=w.current_season
    where w.id=p.workspace_id and r.person_id=p.id and 'admin'=any(r.roles));
 if v_count>0 then
  raise exception using errcode='VT008',
   message='052 refused: people with a sign-in hold admin without the Admin role ('||v_count||')',
   detail=v_count::text;
 end if;
end;
$$;
-- 052 §1 end

-- ---------------------------------------------------------------------------
-- §2. The snapshot. The old ceiling can't be rebuilt from roles, so a
-- follow-up migration can restore it from here. No client reaches it; Start
-- next season (a later change) drops it.

create table vitally_private.capabilities_before_052 (
 workspace_id uuid not null,
 person_id uuid not null,
 capabilities text[] not null,
 primary key (workspace_id,person_id)
);
insert into vitally_private.capabilities_before_052(workspace_id,person_id,capabilities)
 select p.workspace_id,p.id,p.capabilities from public.people p;
revoke all on table vitally_private.capabilities_before_052 from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- §3. The mirror (design D1). 042's check (`followup` needs `admin`) stays:
-- the Admin role gives both.

-- The effective capabilities: from 045, now the current season's role
-- capabilities alone. people.capabilities is the mirror of the same roles, so
-- there is no ceiling to intersect with. Replaced before §4's recompute.
create or replace function vitally_private.effective_capabilities(p_workspace_id uuid,p_person_id uuid)
returns text[] language sql stable security definer set search_path='' as $$
 select coalesce((
  select vitally_private.role_capabilities(r.roles) -- 052
   from public.workspaces w
   join public.roster_entries r on r.workspace_id=w.id and r.season=w.current_season
   where w.id=p_workspace_id and r.person_id=p_person_id),'{}'::text[]);
$$;
revoke all on function vitally_private.effective_capabilities(uuid,uuid) from public,anon,authenticated,service_role;

-- The effective capabilities when the person has a sign-in; empty with no
-- sign-in or no current-season entry.
create function vitally_private.mirror_capabilities(p_workspace_id uuid,p_person_id uuid,p_user_id uuid)
returns text[] language sql stable security definer set search_path='' as $$
 select case when p_user_id is null then '{}'::text[]
  else vitally_private.effective_capabilities(p_workspace_id,p_person_id) end;
$$;
revoke all on function vitally_private.mirror_capabilities(uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- Every write of a people row stores the mirror, whatever it wrote: a direct
-- write of a different value is replaced, and linking or unlinking a sign-in
-- recomputes it.
create function vitally_private.people_mirror_capabilities()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 new.capabilities=vitally_private.mirror_capabilities(new.workspace_id,new.id,new.user_id);
 return new;
end;
$$;
revoke all on function vitally_private.people_mirror_capabilities() from public,anon,authenticated,service_role;

create trigger people_mirror_capabilities
 before insert or update on public.people
 for each row execute function vitally_private.people_mirror_capabilities();

-- A change to a current-season roster entry touches its person's people row
-- (OLD and NEW, for a move or a delete), so the trigger above recomputes it
-- and the change reaches staff windows through people realtime.
create function vitally_private.roster_entries_mirror_capabilities()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.people p set capabilities=p.capabilities
  from (
   select new.workspace_id,new.person_id,new.season where tg_op<>'DELETE'
   union
   select old.workspace_id,old.person_id,old.season where tg_op<>'INSERT'
  ) k(workspace_id,person_id,season)
  join public.workspaces w on w.id=k.workspace_id and w.current_season=k.season
  where p.workspace_id=k.workspace_id and p.id=k.person_id;
 return null;
end;
$$;
revoke all on function vitally_private.roster_entries_mirror_capabilities() from public,anon,authenticated,service_role;

create trigger roster_entries_mirror_capabilities
 after insert or update of roles,season,person_id or delete on public.roster_entries
 for each row execute function vitally_private.roster_entries_mirror_capabilities();

-- The site coordinator flag (design D4): kept across seasons, on the account,
-- so it lasts while the account is active. Migration 052 marks nobody.
alter table public.accounts add column is_site_coordinator boolean not null default false;

-- Every grant and removal, one row each. A null changed_by_person_id is the
-- roster command. No signed-in user reads or writes it directly; the person
-- keys are deferred, as 047's are, so a workspace delete can cascade in any
-- order.
create table public.site_coordinator_changes (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 person_id uuid not null,
 granted boolean not null,
 changed_by_person_id uuid,
 changed_at timestamptz not null default now(),
 foreign key (workspace_id,person_id) references public.people(workspace_id,id) on delete cascade deferrable initially deferred,
 foreign key (workspace_id,changed_by_person_id) references public.people(workspace_id,id) deferrable initially deferred
);
create index site_coordinator_changes_person on public.site_coordinator_changes(workspace_id,person_id,changed_at);
alter table public.site_coordinator_changes enable row level security;
revoke all on public.site_coordinator_changes from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- §4. The recompute: every person's capabilities become the mirror.

update public.people set capabilities=capabilities;

-- ---------------------------------------------------------------------------
-- §5. Site coordinators, the workspace admin check and clearance (design D2,
-- D4, D6).

-- Whether the person is a site coordinator of the workspace: their account
-- there is active and marked. The season, the roster and roles don't matter.
create function vitally_private.is_site_coordinator(p_workspace_id uuid,p_person_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.accounts a
  where a.workspace_id=p_workspace_id and a.person_id=p_person_id
   and a.status='active' and a.is_site_coordinator);
$$;
revoke all on function vitally_private.is_site_coordinator(uuid,uuid) from public,anon,authenticated,service_role;

-- The roster command's grant (design D4): marks the active staff account of a
-- user as site coordinator. Idempotent: a grant to someone who already is one
-- changes nothing and records nothing. A real change raises the account's
-- revision and records a grant with no person named as its maker. VALIDATION
-- (NO_ACTIVE_ACCOUNT) for a user with no active staff account in the
-- workspace. It never removes.
create function vitally_private.grant_site_coordinator(p_workspace_id uuid,p_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_account public.accounts;
begin
 select a.* into v_account from public.accounts a
  join public.memberships m on m.workspace_id=a.workspace_id and m.user_id=a.user_id
  where a.workspace_id=p_workspace_id and a.user_id=p_user_id
   and a.status='active' and a.person_id is not null and m.active and m.access='staff'
  for update of a;
 if v_account.user_id is null then
  raise sqlstate 'VT007' using message='VALIDATION',detail='NO_ACTIVE_ACCOUNT';
 end if;
 if v_account.is_site_coordinator then
  return;
 end if;
 update public.accounts set is_site_coordinator=true,revision=revision+1,updated_at=now()
  where workspace_id=p_workspace_id and user_id=p_user_id;
 insert into public.site_coordinator_changes(workspace_id,person_id,granted,changed_by_person_id)
  values(p_workspace_id,v_account.person_id,true,null);
end;
$$;
revoke all on function vitally_private.grant_site_coordinator(uuid,uuid) from public,anon,authenticated,service_role;

-- From 044, with a new body (design D2): a workspace admin is the caller with
-- an active staff membership and either the Admin role this season (`admin`
-- in the people.capabilities mirror) or an active site coordinator account.
-- No clearance check: an uncleared admin still reaches the Roster.
create or replace function vitally_policy.is_workspace_admin(p_workspace_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.memberships m
  join public.people p on p.workspace_id=m.workspace_id and p.user_id=m.user_id
  where m.workspace_id=p_workspace_id and m.user_id=(select auth.uid()) and m.active and m.access='staff'
   and ('admin'=any(p.capabilities) -- 052
    or exists(select 1 from public.accounts a -- 052
     where a.workspace_id=m.workspace_id and a.user_id=m.user_id -- 052
      and a.status='active' and a.is_site_coordinator))); -- 052
$$;
revoke all on function vitally_policy.is_workspace_admin(uuid) from public,anon,authenticated,service_role;
grant execute on function vitally_policy.is_workspace_admin(uuid) to authenticated;

-- From 047, with one change (design D6): a site coordinator also needs the SC
-- certificate confirmed this season.
create or replace function vitally_private.cleared(p_workspace_id uuid,p_person_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((
  select cardinality(r.roles)>0 and (not r.is_new or r.photo_id_checked_at is not null)
   and (not vitally_private.is_site_coordinator(w.id,r.person_id) -- 052
    or 'sc'=any(vitally_private.confirmed_certificates(w.id,r.person_id,r.season))) -- 052
   from public.workspaces w
   join public.roster_entries r on r.workspace_id=w.id and r.season=w.current_season
   where w.id=p_workspace_id and r.person_id=p_person_id),false)
  and exists(select 1 from public.accounts a
   where a.workspace_id=p_workspace_id and a.person_id=p_person_id and a.status='active');
$$;
revoke all on function vitally_private.cleared(uuid,uuid) from public,anon,authenticated,service_role;

-- From 047, with three changes (design D2, D6): `isAdmin` is the workspace
-- admin check, `isSiteCoordinator` is new, and a site coordinator with a
-- current-season entry and no confirmed SC has the SC item after the role
-- items.
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
 select r.* into v_entry from public.roster_entries r
  join public.workspaces w on w.id=r.workspace_id and w.current_season=r.season
  where r.workspace_id=v_person.workspace_id and r.person_id=v_person.id;
 if v_entry.person_id is null or cardinality(v_entry.roles)=0 then
  v_missing=v_missing||jsonb_build_array(jsonb_build_object('kind','form13615'));
 end if;
 if v_entry.person_id is not null and v_entry.is_new and v_entry.photo_id_checked_at is null then
  v_missing=v_missing||jsonb_build_array(jsonb_build_object('kind','photoId'));
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
  'cleared',vitally_private.cleared(v_person.workspace_id,v_person.id),
  'missing',v_missing,
  'capabilities',to_jsonb(vitally_private.effective_capabilities(v_person.workspace_id,v_person.id)),
  'isAdmin',vitally_policy.is_workspace_admin(v_person.workspace_id), -- 052
  'isSiteCoordinator',v_site_coordinator, -- 052
  'siteCoordinatorName',to_jsonb(v_coordinator),
  'siteCheck',exists(select 1 from public.accounts a where a.workspace_id=v_person.workspace_id and a.user_id=v_member.user_id and a.status='invited'));
end;
$$;
revoke all on function public.vitally_my_clearance() from public,anon,authenticated,service_role;
grant execute on function public.vitally_my_clearance() to authenticated;

-- ---------------------------------------------------------------------------
-- §6. Staff setup takes no capabilities (design D1, D9). Linking a sign-in
-- recomputes people.capabilities through the mirror trigger (§3).

-- From 047 §4, with the capabilities argument gone: the 5-argument form is
-- dropped, the link and the insert write no capabilities, and the identical
-- re-run compares the key and the link only.
drop function vitally_private.add_staff_member(uuid,uuid,text,text,text[]); -- 052
create function vitally_private.add_staff_member(p_workspace_id uuid,p_user_id uuid,p_person_key text,p_name text) -- 052
returns uuid language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_has_member boolean;
 v_person_id uuid;
 v_email text;
 v_link uuid;
begin
 if p_workspace_id is null or p_user_id is null or p_person_key is null or p_name is null -- 052
  or p_person_key !~ '^[a-z][a-z0-9_]{0,39}$'
  or length(p_name) not between 1 and 80 then -- 052
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_workspace_id::text,0));
 if not exists(select 1 from public.workspaces where id=p_workspace_id)
  or not exists(select 1 from auth.users a where a.id=p_user_id)
  or exists(select 1 from vitally_private.test_workspaces where workspace_id=p_workspace_id and test_overrides_applied) then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 if exists(select 1 from public.memberships where user_id=p_user_id and active and workspace_id<>p_workspace_id) then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 select * into v_member from public.memberships where workspace_id=p_workspace_id and user_id=p_user_id;
 v_has_member=found;
 if v_has_member and (v_member.access<>'staff' or not v_member.active) then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 -- Any person of the workspace with this key or this account must be exactly
 -- this staff member. The name is the Roster's to change, so it is not compared,
 -- and the capabilities are the mirror of the roles (052), so neither are they.
 if exists(select 1 from public.people p where p.workspace_id=p_workspace_id
  and (p.person_key=p_person_key or p.user_id=p_user_id)
  and not (p.person_key=p_person_key and p.user_id is not distinct from p_user_id)) then -- 052
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 select p.id into v_person_id from public.people p where p.workspace_id=p_workspace_id and p.person_key=p_person_key;
 if found then
  -- Both already exist with these values: the identical re-run.
  if not v_has_member then
   raise sqlstate 'VT007' using message='VALIDATION';
  end if;
  return v_person_id;
 end if;
 if v_has_member then
  -- A staff membership with no person is not a state this function completes.
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 select lower(u.email) into v_email from auth.users u where u.id=p_user_id;
 select p.id into v_link from public.people p
  join public.volunteer_profiles v on v.workspace_id=p.workspace_id and v.person_id=p.id
  where p.workspace_id=p_workspace_id and p.user_id is null and v.email=v_email for update of p;
 insert into public.memberships(workspace_id,user_id,access) values(p_workspace_id,p_user_id,'staff');
 if v_link is not null then
  update public.people set person_key=p_person_key,user_id=p_user_id where id=v_link; -- 052
  update public.volunteer_profiles set revision=revision+1,updated_at=now() where workspace_id=p_workspace_id and person_id=v_link;
  perform vitally_private.insert_active_account(p_workspace_id,p_user_id,v_link); -- 047
  return v_link;
 end if;
 insert into public.people(workspace_id,person_key,name,user_id) -- 052
  values(p_workspace_id,p_person_key,p_name,p_user_id) returning id into v_person_id; -- 052
 insert into public.volunteer_profiles(workspace_id,person_id,email) values(p_workspace_id,v_person_id,v_email);
 insert into public.roster_entries(workspace_id,person_id,season)
  select p_workspace_id,v_person_id,w.current_season from public.workspaces w where w.id=p_workspace_id;
 perform vitally_private.insert_active_account(p_workspace_id,p_user_id,v_person_id); -- 047
 return v_person_id;
end;
$$;
revoke all on function vitally_private.add_staff_member(uuid,uuid,text,text) from public,anon,authenticated,service_role;

-- From 047, with one change: create links the volunteer without writing the
-- four-capability ceiling; the mirror gives them their roles' capabilities.
create or replace function public.vitally_record_account(p_action_id uuid,p_op text,p_target jsonb,p_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_person public.people;
 v_receipt public.action_receipts;
 v_digest text;
 v_check jsonb;
 v_email text;
 v_volunteer uuid;
 v_user_email text;
 v_result jsonb;
begin
 v_member=vitally_private.require_membership();
 v_person=vitally_private.acting_person(v_member);
 if v_member.access<>'staff' or v_person.id is null or not vitally_policy.is_workspace_admin(v_member.workspace_id) then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 if p_op='resend' then
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_member.workspace_id::text,0));
  perform vitally_private.expire_invitations(v_member.workspace_id);
  v_check=vitally_private.account_check(v_member.workspace_id,'resend',p_target);
  update public.accounts a set invited_at=now(),expires_at=now()+interval '7 days',revision=revision+1,updated_at=now()
   from auth.users u
   where a.workspace_id=v_member.workspace_id and a.status='invited' and u.id=a.user_id
    and a.revision=(v_check->>'accountRevision')::bigint and lower(u.email)=v_check->>'email'
   returning to_jsonb(a.revision) into v_result;
  return jsonb_build_object('status','invited','email',v_check->>'email','accountRevision',v_result);
 end if;
 if p_action_id is null or p_user_id is null or p_op is null or p_op not in ('create','invite') then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_member.workspace_id::text,0));
 perform vitally_private.expire_invitations(v_member.workspace_id);
 v_digest=encode(extensions.digest(jsonb_build_object('operation','RECORD_ACCOUNT','op',p_op,'target',p_target,
  'userId',p_user_id,'personId',v_person.id)::text,'sha256'),'hex');
 v_receipt=vitally_private.reserve_receipt(v_member,p_action_id,'RECORD_ACCOUNT',v_digest,v_person.id);
 if v_receipt.receipt is not null then
  return v_receipt.receipt;
 end if;
 v_check=vitally_private.account_check(v_member.workspace_id,p_op,p_target);
 v_email=v_check->>'email';
 v_volunteer=(v_check->>'volunteerId')::uuid;
 select lower(u.email) into v_user_email from auth.users u where u.id=p_user_id;
 if v_user_email is null or v_user_email<>v_email then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 if exists(select 1 from public.accounts a where a.user_id=p_user_id) then
  raise sqlstate 'VT007' using message='VALIDATION',detail='EMAIL_IN_USE';
 end if;
 begin
  if p_op='create' then
   insert into public.memberships(workspace_id,user_id,access) values(v_member.workspace_id,p_user_id,'staff');
   update public.people set user_id=p_user_id -- 052
    where workspace_id=v_member.workspace_id and id=v_volunteer;
   update public.volunteer_profiles set revision=revision+1,updated_at=now()
    where workspace_id=v_member.workspace_id and person_id=v_volunteer;
  else
   insert into public.memberships(workspace_id,user_id,access) values(v_member.workspace_id,p_user_id,'applicant');
  end if;
  insert into public.accounts(workspace_id,user_id,person_id,status,invited_at,invited_by,expires_at)
   values(v_member.workspace_id,p_user_id,v_volunteer,'invited',now(),v_person.id,now()+interval '7 days');
 exception when unique_violation then
  -- Another active membership for this user (memberships_one_active_workspace)
  -- or a row that appeared meanwhile.
  -- An accounts (workspace_id,person_id) clash is unreachable: the advisory lock serializes the re-check.
  raise sqlstate 'VT007' using message='VALIDATION',detail='EMAIL_IN_USE';
 end;
 v_result=jsonb_build_object('actionId',p_action_id,'status','invited','email',v_email,'accountRevision',1);
 update public.action_receipts set target_id=coalesce(v_volunteer,p_user_id),receipt=v_result where id=v_receipt.id;
 return v_result;
end;
$$;
revoke all on function public.vitally_record_account(uuid,text,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.vitally_record_account(uuid,text,jsonb,uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- §7. Granting and removing site coordinators, and deactivation (design D4).

-- Grant or remove site coordinator at the account revision the page read, for
-- a site coordinator only. Order: FORBIDDEN (the caller is not a site
-- coordinator: nothing written, no receipt), NOT_FOUND (not a person of this
-- workspace), VALIDATION NO_ACTIVE_ACCOUNT, CONFLICT (stale revision),
-- INVALID_TRANSITION (no change), then on removal DEFAULT_FOLLOWUP and
-- LAST_SITE_COORDINATOR. A change raises the account's revision and records
-- who made it. The workspace lock serializes it with deactivation, so two
-- requests can't remove the last two site coordinators at once.
create function public.vitally_set_site_coordinator(p_action_id uuid,p_volunteer_id uuid,p_expected_revision bigint,p_granted boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_person public.people;
 v_receipt public.action_receipts;
 v_account public.accounts;
 v_digest text;
 v_result jsonb;
begin
 v_member=vitally_private.require_membership();
 v_person=vitally_private.acting_person(v_member);
 if v_member.access<>'staff' or v_person.id is null
  or not vitally_private.is_site_coordinator(v_member.workspace_id,v_person.id) then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 if p_action_id is null or p_volunteer_id is null or p_expected_revision is null or p_granted is null then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_member.workspace_id::text,0));
 v_digest=encode(extensions.digest(jsonb_build_object('operation','SET_SITE_COORDINATOR','volunteerId',p_volunteer_id,
  'expectedRevision',p_expected_revision,'granted',p_granted,'personId',v_person.id)::text,'sha256'),'hex');
 v_receipt=vitally_private.reserve_receipt(v_member,p_action_id,'SET_SITE_COORDINATOR',v_digest,v_person.id);
 if v_receipt.receipt is not null then
  return v_receipt.receipt;
 end if;
 if not exists(select 1 from public.people p where p.workspace_id=v_member.workspace_id and p.id=p_volunteer_id) then
  raise sqlstate 'VT002' using message='NOT_FOUND';
 end if;
 select a.* into v_account from public.accounts a
  join public.memberships m on m.workspace_id=a.workspace_id and m.user_id=a.user_id
  where a.workspace_id=v_member.workspace_id and a.person_id=p_volunteer_id
   and a.status='active' and m.active and m.access='staff'
  for update of a;
 if not found then
  raise sqlstate 'VT007' using message='VALIDATION',detail='NO_ACTIVE_ACCOUNT';
 end if;
 if v_account.revision<>p_expected_revision then
  raise sqlstate 'VT003' using message='CONFLICT';
 end if;
 if v_account.is_site_coordinator=p_granted then
  raise sqlstate 'VT004' using message='INVALID_TRANSITION';
 end if;
 if not p_granted then
  if exists(select 1 from public.workspaces w
   where w.id=v_member.workspace_id and w.default_followup_person_id=p_volunteer_id) then
   raise sqlstate 'VT004' using message='DEFAULT_FOLLOWUP';
  end if;
  if not exists(select 1 from public.accounts a
   where a.workspace_id=v_member.workspace_id and a.user_id<>v_account.user_id
    and a.status='active' and a.is_site_coordinator) then
   raise sqlstate 'VT004' using message='LAST_SITE_COORDINATOR';
  end if;
 end if;
 update public.accounts set is_site_coordinator=p_granted,revision=revision+1,updated_at=now()
  where workspace_id=v_member.workspace_id and user_id=v_account.user_id;
 insert into public.site_coordinator_changes(workspace_id,person_id,granted,changed_by_person_id)
  values(v_member.workspace_id,p_volunteer_id,p_granted,v_person.id);
 v_result=jsonb_build_object('actionId',p_action_id,'volunteerId',p_volunteer_id,
  'isSiteCoordinator',p_granted,'accountRevision',v_account.revision+1);
 update public.action_receipts set target_id=p_volunteer_id,receipt=v_result where id=v_receipt.id;
 return v_result;
end;
$$;
revoke all on function public.vitally_set_site_coordinator(uuid,uuid,bigint,boolean) from public,anon,authenticated,service_role;
grant execute on function public.vitally_set_site_coordinator(uuid,uuid,bigint,boolean) to authenticated;

-- From 047, with a third parameter (design D4): after the open work check, the
-- last active site coordinator is refused (INVALID_TRANSITION,
-- LAST_SITE_COORDINATOR); any other site coordinator loses the mark in the
-- same update, recorded as a removal by p_changed_by, so a reactivated account
-- is not a site coordinator again. The 2-argument form is dropped first: a
-- defaulted extra parameter would make 2-argument calls ambiguous.
drop function vitally_private.deactivate_account(uuid,uuid); -- 052
create function vitally_private.deactivate_account(p_workspace_id uuid,p_user_id uuid,p_changed_by uuid) -- 052
returns void language plpgsql security definer set search_path='' as $$
declare v_account public.accounts;
 v_open_work jsonb;
begin
 select * into v_account from public.accounts
  where workspace_id=p_workspace_id and user_id=p_user_id for update;
 if not found then
  raise sqlstate 'VT002' using message='NOT_FOUND';
 end if;
 if v_account.status not in ('invited','active') then
  raise sqlstate 'VT004' using message='INVALID_TRANSITION';
 end if;
 if v_account.person_id is not null then
  select jsonb_agg(w.label) into v_open_work from vitally_private.open_work(p_workspace_id,v_account.person_id) w;
  if v_open_work is not null then
   raise sqlstate 'VT004' using message='OPEN_WORK',detail=v_open_work::text;
  end if;
 end if;
 if v_account.status='active' and v_account.is_site_coordinator -- 052
  and not exists(select 1 from public.accounts a -- 052
   where a.workspace_id=p_workspace_id and a.user_id<>p_user_id -- 052
    and a.status='active' and a.is_site_coordinator) then -- 052
  raise sqlstate 'VT004' using message='LAST_SITE_COORDINATOR'; -- 052
 end if; -- 052
 update public.accounts set status='deactivated',deactivated_at=now(),revision=revision+1,updated_at=now()
  ,is_site_coordinator=false -- 052
  where workspace_id=p_workspace_id and user_id=p_user_id;
 if v_account.is_site_coordinator then -- 052
  insert into public.site_coordinator_changes(workspace_id,person_id,granted,changed_by_person_id) -- 052
   values(p_workspace_id,v_account.person_id,false,p_changed_by); -- 052
 end if; -- 052
 update public.memberships set active=false where workspace_id=p_workspace_id and user_id=p_user_id;
end;
$$;
revoke all on function vitally_private.deactivate_account(uuid,uuid,uuid) from public,anon,authenticated,service_role; -- 052

-- From 047, with one change: the acting person is passed to
-- deactivate_account, which records them as the remover of a site coordinator.
create or replace function public.vitally_deactivate_account(p_action_id uuid,p_volunteer_id uuid,p_expected_revision bigint) -- 052
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_person public.people;
 v_receipt public.action_receipts;
 v_account public.accounts;
 v_digest text;
 v_result jsonb;
begin
 v_member=vitally_private.require_membership();
 v_person=vitally_private.acting_person(v_member);
 if v_member.access<>'staff' or v_person.id is null or not vitally_policy.is_workspace_admin(v_member.workspace_id) then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 if p_action_id is null or p_volunteer_id is null or p_expected_revision is null then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_member.workspace_id::text,0));
 v_digest=encode(extensions.digest(jsonb_build_object('operation','DEACTIVATE_ACCOUNT','volunteerId',p_volunteer_id,
  'expectedRevision',p_expected_revision,'personId',v_person.id)::text,'sha256'),'hex');
 v_receipt=vitally_private.reserve_receipt(v_member,p_action_id,'DEACTIVATE_ACCOUNT',v_digest,v_person.id);
 if v_receipt.receipt is not null then
  return v_receipt.receipt;
 end if;
 perform vitally_private.expire_invitations(v_member.workspace_id);
 if not exists(select 1 from public.people p where p.workspace_id=v_member.workspace_id and p.id=p_volunteer_id) then
  raise sqlstate 'VT002' using message='NOT_FOUND';
 end if;
 if p_volunteer_id=v_person.id then
  raise sqlstate 'VT007' using message='VALIDATION',detail='SELF';
 end if;
 select * into v_account from public.accounts
  where workspace_id=v_member.workspace_id and person_id=p_volunteer_id for update;
 if not found then
  raise sqlstate 'VT004' using message='INVALID_TRANSITION';
 end if;
 if v_account.revision<>p_expected_revision then
  raise sqlstate 'VT003' using message='CONFLICT';
 end if;
 perform vitally_private.deactivate_account(v_member.workspace_id,v_account.user_id,v_person.id); -- 052
 v_result=jsonb_build_object('actionId',p_action_id,'status','deactivated','accountRevision',v_account.revision+1);
 update public.action_receipts set target_id=p_volunteer_id,receipt=v_result where id=v_receipt.id;
 return v_result;
end;
$$;
revoke all on function public.vitally_deactivate_account(uuid,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.vitally_deactivate_account(uuid,uuid,bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- §8. The default follow-up person (design D7): a person with a sign-in who is
-- a site coordinator or has `followup` (the Admin role). Every check of the
-- default asks this helper: setting it, the workspace setup re-run, and the
-- four case actions that assign work to it. Clearance is never asked.

create function vitally_private.can_be_default_followup(p_workspace_id uuid,p_person_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.people p
  where p.workspace_id=p_workspace_id and p.id=p_person_id and p.user_id is not null
   and (vitally_private.is_site_coordinator(p_workspace_id,p_person_id) or 'followup'=any(p.capabilities)));
$$;
revoke all on function vitally_private.can_be_default_followup(uuid,uuid) from public,anon,authenticated,service_role;

-- From 038, with one change: the helper replaces the sign-in and `followup`
-- test.
create or replace function vitally_private.set_default_followup(p_workspace_id uuid,p_person_key text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_person public.people;
begin
 if p_workspace_id is null or p_person_key is null then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_workspace_id::text,0));
 select * into v_person from public.people where workspace_id=p_workspace_id and person_key=p_person_key;
 if not found or not vitally_private.can_be_default_followup(p_workspace_id,v_person.id) then -- 052
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 update public.workspaces set default_followup_person_id=v_person.id where id=p_workspace_id;
 return v_person.id;
end;
$$;
revoke all on function vitally_private.set_default_followup(uuid,text) from public,anon,authenticated,service_role;

-- From 047, with one change: the re-run check of the current default asks the
-- helper.
create or replace function vitally_private.initialize_workspace(p_workspace_id uuid,p_applicants uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_new boolean;
 v_member record;
 v_default uuid;
begin
 if p_workspace_id is null or p_applicants is null then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_workspace_id::text,0));
 if exists(select 1 from vitally_private.test_workspaces where workspace_id=p_workspace_id and test_overrides_applied) then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 if exists(select 1 from unnest(p_applicants) u where u is null) or cardinality(p_applicants)<>(select count(distinct u) from unnest(p_applicants) u) then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 if exists(select 1 from unnest(p_applicants) u where not exists(select 1 from auth.users a where a.id=u)) then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 select not exists(select 1 from public.workspaces where id=p_workspace_id) into v_new;
 insert into public.workspaces(id) values(p_workspace_id) on conflict do nothing;
 select default_followup_person_id into v_default from public.workspaces where id=p_workspace_id;
 if not v_new and not vitally_private.can_be_default_followup(p_workspace_id,v_default) then -- 052
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 for v_member in select u as id,'applicant' as access from unnest(p_applicants) u loop
  if exists(select 1 from public.memberships where user_id=v_member.id and active and workspace_id<>p_workspace_id) then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
  if exists(select 1 from public.memberships where user_id=v_member.id and workspace_id=p_workspace_id and (access<>v_member.access or not active)) then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
  insert into public.memberships(workspace_id,user_id,access) values(p_workspace_id,v_member.id,v_member.access) on conflict do nothing;
  perform vitally_private.insert_active_account(p_workspace_id,v_member.id,null); -- 047
 end loop;
 return jsonb_build_object('workspaceId',p_workspace_id);
end;
$$;
revoke all on function vitally_private.initialize_workspace(uuid,uuid[]) from public,anon,authenticated,service_role;

-- From 004, with one change: the assignee check asks the helper.
create or replace function vitally_private.act_escalate_contact(p_member public.memberships,p_case public.cases,p_person public.people,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_request public.document_requests;
 v_assignee public.people;
 v_followup uuid;
begin
 if p_case.stage not in ('preparing','corrections_required') then
  raise sqlstate 'VT004' using message='INVALID_TRANSITION';
 end if;
 perform vitally_private.require_case_preparer(p_case,p_person);
 select * into v_request from public.document_requests
  where workspace_id=p_case.workspace_id and case_id=p_case.id
   and id=vitally_private.payload_uuid(p_payload,'requestId') for update;
 -- One active task per unresolved request: repeated clicks add none.
 if v_request.status is distinct from 'open'
  or exists(select 1 from public.admin_followups t where t.request_id=v_request.id and t.status='open') then
  raise sqlstate 'VT004' using message='INVALID_TRANSITION';
 end if;
 -- The workspace's configured follow-up person, never a browser-supplied one.
 -- A missing or unqualified default is a setup error that creates no task.
 select p.* into v_assignee from public.people p
  join public.workspaces w on w.id=p.workspace_id and w.default_followup_person_id=p.id
  where w.id=p_case.workspace_id;
 if not found or not vitally_private.can_be_default_followup(p_case.workspace_id,v_assignee.id) then -- 052
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 insert into public.admin_followups(workspace_id,case_id,request_id,assignee_person_id,reason,created_by_person_id)
 values(p_case.workspace_id,p_case.id,v_request.id,v_assignee.id,p_payload->>'reason',p_person.id)
 returning id into v_followup;
 -- Contact work is internal: staff notes never become client-visible progress.
 return jsonb_build_object('detail',jsonb_build_object('requestId',v_request.id,'followupId',v_followup,'assigneePersonId',v_assignee.id));
end;
$$;

-- From 033, with one change: the assignee check asks the helper.
create or replace function vitally_private.act_approve_review(p_member public.memberships,p_case public.cases,p_person public.people,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_review public.reviews;
 v_q jsonb=p_payload->'questionnaire'; -- 033
 v_went_over boolean=(p_payload->'questionnaire'->>'wentOver')::boolean; -- 033
 v_in_person boolean=p_payload->'questionnaire'->>'signMethod'='in_person'; -- 033
 v_same_day boolean=coalesce(p_case.answers->>'service'='same_day',false); -- 033
 v_appointment timestamp=vitally_private.payload_minute(p_payload->'questionnaire','signAppointmentAt'); -- 033
 v_assignee public.people; -- 033
 v_plan text; -- 033
begin
 if p_case.stage<>'reviewing' then
  raise sqlstate 'VT004' using message='INVALID_TRANSITION';
 end if;
 perform vitally_private.require_case_reviewer(p_case,p_person);
 v_review=vitally_private.lock_active_review(p_case,p_person);
 perform vitally_private.check_taxslayer_date(p_case,vitally_private.payload_date(v_q,'completedOn')); -- 033
 if v_went_over then -- 033
  perform vitally_private.check_taxslayer_date(p_case,vitally_private.payload_date(v_q,'wentOverOn')); -- 033
 end if; -- 033
 -- D6: an appointment is required for an in-person signing that is not the same day, and absent otherwise.
 if (v_in_person and not v_same_day)<>(v_appointment is not null) then -- 033
  raise sqlstate 'VT007' using message='VALIDATION'; -- 033
 end if; -- 033
 insert into public.reviewer_questionnaires(workspace_id,case_id,review_id,answered_by_person_id,completed_on,pa_forgiveness,went_over,went_over_on,went_over_how,sign_method,sign_appointment_at,exit_form,remarks) -- 033
 values(p_case.workspace_id,p_case.id,v_review.id,p_person.id,vitally_private.payload_date(v_q,'completedOn'),v_q->>'paForgiveness',v_went_over, -- 033
  vitally_private.payload_date(v_q,'wentOverOn'),v_q->>'wentOverHow',v_q->>'signMethod',v_appointment,v_q->'exitForm',btrim(v_q->>'remarks')); -- 033
 if not v_went_over then -- 033
  -- D5: the office takes the conversation over. The assignee is the workspace's
  -- configured follow-up person, found as act_escalate_contact (004) finds them.
  select p.* into v_assignee from public.people p -- 033
   join public.workspaces w on w.id=p.workspace_id and w.default_followup_person_id=p.id -- 033
   where w.id=p_case.workspace_id; -- 033
  if not found or not vitally_private.can_be_default_followup(p_case.workspace_id,v_assignee.id) then -- 052
   raise sqlstate 'VT007' using message='VALIDATION'; -- 033
  end if; -- 033
  insert into public.admin_followups(workspace_id,case_id,request_id,purpose,assignee_person_id,reason,created_by_person_id) -- 033
  values(p_case.workspace_id,p_case.id,null,'go_over_return',v_assignee.id,'Go over the return with the client: the reviewer did not.',p_person.id); -- 033
 end if; -- 033
 -- D10: the contact step is settled at approval, never left pending.
 update public.reviews set status='approved',decided_at=now(),client_contact_status='completed', -- 033
  client_contacted_at=now(),client_contact_outcome=case when v_went_over then 'reached' else null end -- 033
  where id=v_review.id;
 -- D11: the plan the client reads, in the design's order.
 v_plan=case when not v_went_over then 'go_over_first' when not v_in_person then 'portal' -- 033
  when v_same_day then 'same_day' else 'appointment' end; -- 033
 -- The approving reviewer stays on the case: the contact task is theirs.
 update public.cases set stage='review_approved',signing_plan=v_plan, -- 033
  signing_appointment_at=case when v_plan='appointment' then v_appointment else null end where id=p_case.id; -- 033
 return jsonb_build_object('detail',jsonb_build_object('reviewId',v_review.id,'preparationVersion',v_review.preparation_version),
  'message','Your return has been checked by the reviewer. A volunteer will contact you soon to sign and file.');
end;
$$;

-- From 036, with one change: the assignee check asks the helper.
create or replace function vitally_private.act_withdraw(p_member public.memberships,p_case public.cases,p_person public.people,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_assignee public.people;
begin
 if not (p_case.stage in ('received','screening','awaiting_documents','preparation_ready','preparing','corrections_required','review_ready','reviewing')
   or (p_case.stage='on_hold' and p_case.hold_origin='awaiting_documents')) then
  raise sqlstate 'VT004' using message='INVALID_TRANSITION';
 end if;
 if p_case.stage in ('preparing','corrections_required','reviewing')
   and (p_case.preparer_id is not null or p_case.reviewer_id is not null) then
  select p.* into v_assignee from public.people p
   join public.workspaces w on w.id=p.workspace_id and w.default_followup_person_id=p.id
   where w.id=p_case.workspace_id;
  if not found or not vitally_private.can_be_default_followup(p_case.workspace_id,v_assignee.id) then -- 052
   raise sqlstate 'VT007' using message='VALIDATION';
  end if;
 end if;
 perform vitally_private.close_case_steps(p_case,'withdrawn');
 if v_assignee.id is not null then
  insert into public.admin_followups(workspace_id,case_id,request_id,purpose,assignee_person_id,reason,created_by_person_id)
  values(p_case.workspace_id,p_case.id,null,'withdrawal_notice',v_assignee.id,'The client withdrew the application: tell the volunteer to stop work.',v_assignee.id);
 end if;
 return jsonb_build_object('detail','{}'::jsonb,
  'message','You withdrew your application. Your return was not filed.');
end;
$$;

-- From 048, with one change: the assignee check asks the helper.
create or replace function vitally_private.act_close_case(p_member public.memberships,p_case public.cases,p_person public.people,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_assignee public.people;
 v_before_filing boolean:=p_case.stage in ('review_approved','ready_to_efile') -- 036
  or (p_case.stage='on_hold' and p_case.hold_origin='review_approved'); -- 036
begin
 if not (p_case.stage in ('received','screening','preparation_ready','preparing','review_ready','reviewing','corrections_required','rejected','awaiting_documents','on_hold') -- 036
   or (p_case.stage in ('review_approved','ready_to_efile') and p_payload->>'reason'='withdrawn') -- 036
   or (p_case.stage='draft' and p_case.owner_user_id is null)) then
  raise sqlstate 'VT004' using message='INVALID_TRANSITION';
 end if;
 -- Any close before filing (a withdrawal at Ready to exit or Ready to e-file, or any
 -- reason from a signing hold) leaves a reviewed, untransmitted return, so the office
 -- is told to make sure it is not transmitted (same assignee rule as act_withdraw). -- 036
 if v_before_filing then -- 036
  select p.* into v_assignee from public.people p -- 036
   join public.workspaces w on w.id=p.workspace_id and w.default_followup_person_id=p.id -- 036
   where w.id=p_case.workspace_id; -- 036
  if not found or not vitally_private.can_be_default_followup(p_case.workspace_id,v_assignee.id) then -- 052
   raise sqlstate 'VT007' using message='VALIDATION'; -- 036
  end if; -- 036
 end if; -- 036
 perform vitally_private.close_case_steps(p_case,p_payload->>'reason'); -- 036
 if v_assignee.id is not null then -- 036
  insert into public.admin_followups(workspace_id,case_id,request_id,purpose,assignee_person_id,reason,created_by_person_id) -- 036
  values(p_case.workspace_id,p_case.id,null,'withdrawal_notice',v_assignee.id, -- 036
   case when p_payload->>'reason'='withdrawn' -- 036
    then 'The client withdrew; make sure the return is not transmitted in TaxSlayer.' -- 036
    when vitally_private.return_outcome(p_case.federal_method,p_case.federal_result)<>'not_filed' -- 048
     or vitally_private.return_outcome(p_case.state_method,p_case.state_result)<>'not_filed' -- 048
    then 'The case was closed after a return was filed; make sure the rejected return is not transmitted again in TaxSlayer.' -- 048
    else 'The case was closed before filing; make sure the return is not transmitted in TaxSlayer.' end, -- 036
   v_assignee.id); -- 036
 end if; -- 036
 -- The reason and note are staff context: case_events is staff-only, and the client
 -- message says plainly that an office decision, not a filing, has changed.
 return jsonb_build_object('detail',jsonb_build_object('reason',p_payload->>'reason') -- 036
   ||case when p_payload ? 'note' then jsonb_build_object('note',p_payload->>'note') else '{}'::jsonb end, -- 036
  'message',vitally_private.closed_line(p_payload->>'reason',p_case.federal_method,p_case.federal_result,p_case.state_method,p_case.state_result)); -- 048
end;
$$;
