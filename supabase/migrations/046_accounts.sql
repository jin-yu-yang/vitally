-- 046: sign-in accounts (OpenSpec change add-account-invitations, design D1,
-- D2, D6, D7).
--
-- Part 1: one account row per membership, and clearance needs an active one.
-- In order:
--   §1 the accounts table, its commit-time person check and its row security;
--   §2 insert_active_account, and the backfill: every existing membership
--      gets a row (active, or deactivated when the membership is inactive);
--   §3 the first sign-in trigger on auth.users: invited becomes active;
--   §4 add_staff_member and initialize_workspace write active accounts;
--   §5 cleared requires an active account.
-- Part 2 (the account functions) follows at the end of the file.
-- The migration runs in one transaction. It adds rows only: no existing
-- membership, person or other row is changed.

-- ---------------------------------------------------------------------------
-- §1. The table (design D1). "Not created" is no row. A staff membership's
-- account names its person; a client's names none (checked at commit below).
-- Both foreign keys to people are deferred, as 044's are: deleting a
-- workspace cascades to the person and, through the membership, to the
-- account, and an immediate check could see the person gone first.

create table public.accounts (
 workspace_id uuid not null,
 user_id uuid not null,
 person_id uuid,
 status text not null check (status in ('invited','active','deactivated')),
 invited_at timestamptz,
 activated_at timestamptz,
 deactivated_at timestamptz,
 invited_by uuid,
 revision bigint not null default 1,
 updated_at timestamptz not null default now(),
 primary key (workspace_id,user_id),
 unique (workspace_id,person_id),
 foreign key (workspace_id,user_id) references public.memberships(workspace_id,user_id) on delete cascade,
 foreign key (workspace_id,person_id) references public.people(workspace_id,id) deferrable initially deferred
);

-- Commit-time rule: person_id is set exactly when the membership is `staff`.
-- The row is read again at commit, so a row removed or changed later in the
-- transaction is judged as it ends.
create function vitally_private.accounts_person_matches_access()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_person uuid;
 v_access text;
begin
 select a.person_id into v_person from public.accounts a
  where a.workspace_id=new.workspace_id and a.user_id=new.user_id;
 if not found then
  return null;
 end if;
 select m.access into v_access from public.memberships m
  where m.workspace_id=new.workspace_id and m.user_id=new.user_id;
 if not found then
  return null;
 end if;
 if (v_person is not null) <> (v_access='staff') then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 return null;
end;
$$;
revoke all on function vitally_private.accounts_person_matches_access() from public,anon,authenticated,service_role;

create constraint trigger accounts_person_matches_access after insert or update on public.accounts
 deferrable initially deferred for each row execute function vitally_private.accounts_person_matches_access();

-- Only a workspace admin reads the rows; no signed-in user writes them. Every
-- write goes through the functions in this file. Not in the realtime
-- publication, like the Roster tables.
alter table public.accounts enable row level security;
revoke all on public.accounts from public,anon,authenticated,service_role;
grant select on public.accounts to authenticated;
grant all on public.accounts to service_role;
create policy admin_accounts on public.accounts for select to authenticated
 using (vitally_policy.is_workspace_admin(workspace_id));

-- ---------------------------------------------------------------------------
-- §2. An active account for a membership that has none (design D7). A row
-- that exists, in any status, is left as it is. The activation time is the
-- user's last sign-in, or now if they never signed in.

create function vitally_private.insert_active_account(p_workspace_id uuid,p_user_id uuid,p_person_id uuid)
returns void language sql security definer set search_path='' as $$
 insert into public.accounts(workspace_id,user_id,person_id,status,activated_at)
  values(p_workspace_id,p_user_id,p_person_id,'active',
   coalesce((select u.last_sign_in_at from auth.users u where u.id=p_user_id),now()))
  on conflict (workspace_id,user_id) do nothing;
$$;
revoke all on function vitally_private.insert_active_account(uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- The backfill: every membership with no account gets one. An active
-- membership's is `active`, from the last sign-in or now; an inactive one's is
-- `deactivated` (brainstorm, "Decided without the user" 4), keeping the last
-- sign-in, if any, as its activation time. A staff account names the linked
-- person. Called once below; a second call finds nothing to add.
create function vitally_private.backfill_accounts()
returns void language sql security definer set search_path='' as $$
 insert into public.accounts(workspace_id,user_id,person_id,status,activated_at,deactivated_at)
  select m.workspace_id,m.user_id,p.id,
   case when m.active then 'active' else 'deactivated' end,
   case when m.active then coalesce(u.last_sign_in_at,now()) else u.last_sign_in_at end,
   case when m.active then null else now() end
  from public.memberships m
  join auth.users u on u.id=m.user_id
  left join public.people p on m.access='staff' and p.workspace_id=m.workspace_id and p.user_id=m.user_id
  where not exists(select 1 from public.accounts a where a.workspace_id=m.workspace_id and a.user_id=m.user_id)
  on conflict (workspace_id,user_id) do nothing;
$$;
revoke all on function vitally_private.backfill_accounts() from public,anon,authenticated,service_role;

select vitally_private.backfill_accounts();

-- ---------------------------------------------------------------------------
-- §3. The first sign-in (design D2). Auth stamps last_sign_in_at while it
-- issues the session, so the account is active before the session's first
-- request reaches the database. Only `invited` rows change: a deactivated
-- account stays deactivated however often its person signs in.

create function vitally_private.account_signed_in()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.last_sign_in_at is not null and new.last_sign_in_at is distinct from old.last_sign_in_at then
  update public.accounts set status='active',activated_at=new.last_sign_in_at,
    revision=revision+1,updated_at=now()
   where user_id=new.id and status='invited';
 end if;
 return null;
end;
$$;
revoke all on function vitally_private.account_signed_in() from public,anon,authenticated,service_role;

create trigger vitally_account_signed_in after update of last_sign_in_at on auth.users
 for each row execute function vitally_private.account_signed_in();

-- ---------------------------------------------------------------------------
-- §4. From 044 (e), with one change: the link and the new-person paths each
-- give the membership an active account naming the person. The identical
-- re-run adds nothing.

create or replace function vitally_private.add_staff_member(p_workspace_id uuid,p_user_id uuid,p_person_key text,p_name text,p_capabilities text[])
returns uuid language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_has_member boolean;
 v_person_id uuid;
 v_email text;
 v_link uuid;
begin
 if p_workspace_id is null or p_user_id is null or p_person_key is null or p_name is null or p_capabilities is null
  or p_person_key !~ '^[a-z][a-z0-9_]{0,39}$'
  or length(p_name) not between 1 and 80
  or array_position(p_capabilities,null) is not null
  or not (p_capabilities <@ array['prepare','review','admin','followup','receive_documents','assist']::text[])
  or ('followup'=any(p_capabilities) and not 'admin'=any(p_capabilities)) -- 042
  or cardinality(p_capabilities)<>(select count(distinct c) from unnest(p_capabilities) c) then
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
 -- this staff member. The name is the Roster's to change, so it is not compared.
 if exists(select 1 from public.people p where p.workspace_id=p_workspace_id
  and (p.person_key=p_person_key or p.user_id=p_user_id)
  and not (p.person_key=p_person_key and p.user_id is not distinct from p_user_id
   and p.capabilities<@p_capabilities and p.capabilities@>p_capabilities)) then
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
  update public.people set person_key=p_person_key,capabilities=p_capabilities,user_id=p_user_id where id=v_link;
  update public.volunteer_profiles set revision=revision+1,updated_at=now() where workspace_id=p_workspace_id and person_id=v_link;
  perform vitally_private.insert_active_account(p_workspace_id,p_user_id,v_link); -- 046
  return v_link;
 end if;
 insert into public.people(workspace_id,person_key,name,capabilities,user_id)
  values(p_workspace_id,p_person_key,p_name,p_capabilities,p_user_id) returning id into v_person_id;
 insert into public.volunteer_profiles(workspace_id,person_id,email) values(p_workspace_id,v_person_id,v_email);
 insert into public.roster_entries(workspace_id,person_id,season)
  select p_workspace_id,v_person_id,w.current_season from public.workspaces w where w.id=p_workspace_id;
 perform vitally_private.insert_active_account(p_workspace_id,p_user_id,v_person_id); -- 046
 return v_person_id;
end;
$$;
revoke all on function vitally_private.add_staff_member(uuid,uuid,text,text,text[]) from public,anon,authenticated,service_role;

-- From 043, with one change: each client membership gets an active account
-- naming no person. A re-run leaves an existing account as it is.
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
 if not v_new and not exists(select 1 from public.people p where p.workspace_id=p_workspace_id and p.id=v_default and 'followup'=any(p.capabilities)) then -- 038
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
  perform vitally_private.insert_active_account(p_workspace_id,v_member.id,null); -- 046
 end loop;
 return jsonb_build_object('workspaceId',p_workspace_id);
end;
$$;
revoke all on function vitally_private.initialize_workspace(uuid,uuid[]) from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- §5. From 045, with one change (design D6): the person's account in the
-- workspace must be active. cleared_workspace_id, require_cleared, the
-- assignee check and vitally_my_clearance call this and follow unchanged.

create or replace function vitally_private.cleared(p_workspace_id uuid,p_person_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((
  select cardinality(r.roles)>0 and (not r.is_new or r.photo_id_checked_at is not null)
   from public.workspaces w
   join public.roster_entries r on r.workspace_id=w.id and r.season=w.current_season
   where w.id=p_workspace_id and r.person_id=p_person_id),false)
  and exists(select 1 from public.accounts a
   where a.workspace_id=p_workspace_id and a.person_id=p_person_id and a.status='active');
$$;
revoke all on function vitally_private.cleared(uuid,uuid) from public,anon,authenticated,service_role;

-- ===========================================================================
-- Part 2: the account functions (design D3, D5) follow below this line.
-- Nothing after this point may ALTER public.accounts: the backfill above has
-- left deferred trigger events pending on it until commit.
-- ===========================================================================
