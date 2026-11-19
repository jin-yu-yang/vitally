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
--      capabilities (design D1, D9).
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
