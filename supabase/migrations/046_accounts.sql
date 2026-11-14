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
-- The sign-in trigger (§3) and the account functions (Part 2) find a user's
-- rows by user_id alone. Created here, before the backfill: an index cannot be
-- built on a table with pending trigger events.
create index accounts_user on public.accounts(user_id);

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
--
-- In order:
--   §6 account_check: every refusal rule for Create account, Invite and
--      Resend (design D5, in the table's order), writing nothing;
--   §7 deactivate_account and reactivate_account: one membership each, so a
--      season rollover can call them in a loop later;
--   §8 the public RPCs: vitally_prepare_account, vitally_record_account,
--      vitally_deactivate_account, vitally_reactivate_account and
--      vitally_client_invitations.
-- Every email is trimmed and lower-cased before it is compared or stored, and
-- an auth user's email is compared lower-cased.

-- ---------------------------------------------------------------------------
-- §6. The check (design D3, D5). The target is {volunteerId} for create,
-- {email} for invite, and either for resend. Answers
-- {op, email, reusableUserId, volunteerId, accountRevision}:
--   - email: the address the account is for (the profile's, the invited one,
--     or, for resend, the account user's);
--   - reusableUserId: an auth user with that email and no account row in any
--     workspace, which the caller links instead of creating a second one;
--   - volunteerId: the person (create, or resend of a staff account);
--   - accountRevision: the account's revision (resend), else null.
-- Refusals are VT007 VALIDATION with the reason as the detail, NOT_FOUND for a
-- volunteer outside the workspace's current roster, and INVALID_TRANSITION for
-- a resend to an account that is not invited.
create function vitally_private.account_check(p_workspace_id uuid,p_op text,p_target jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_key text;
 v_volunteer uuid;
 v_email text;
 v_person public.people;
 v_account public.accounts;
 v_reusable uuid;
begin
 if p_workspace_id is null or p_op is null or p_op not in ('create','invite','resend')
  or p_target is null or jsonb_typeof(p_target)<>'object' then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 -- Only now is p_target known to be an object that has keys to count.
 if (select count(*) from jsonb_object_keys(p_target))<>1 then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 select k into v_key from jsonb_object_keys(p_target) k;
 if v_key not in ('volunteerId','email') or jsonb_typeof(p_target->v_key)<>'string'
  or (p_op='create' and v_key<>'volunteerId') or (p_op='invite' and v_key<>'email') then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;

 if v_key='volunteerId' then
  if (p_target->>'volunteerId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
   raise sqlstate 'VT007' using message='VALIDATION';
  end if;
  v_volunteer=(p_target->>'volunteerId')::uuid;
  -- A person of this workspace on its current-season roster.
  select p.* into v_person from public.people p
   join public.workspaces w on w.id=p.workspace_id
   join public.roster_entries r on r.workspace_id=p.workspace_id and r.person_id=p.id and r.season=w.current_season
   where p.workspace_id=p_workspace_id and p.id=v_volunteer;
  if not found then
   raise sqlstate 'VT002' using message='NOT_FOUND';
  end if;
  select * into v_account from public.accounts a where a.workspace_id=p_workspace_id and a.person_id=v_volunteer;
 else
  v_email=lower(btrim(p_target->>'email'));
  if length(v_email)>254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@.]+(\.[^[:space:]@.]+)+$' then
   raise sqlstate 'VT007' using message='VALIDATION';
  end if;
 end if;

 if p_op='resend' then
  if v_key='email' then
   select a.* into v_account from public.accounts a join auth.users u on u.id=a.user_id
    where a.workspace_id=p_workspace_id and lower(u.email)=v_email
    order by a.invited_at desc nulls last limit 1;
   if not found then
    raise sqlstate 'VT002' using message='NOT_FOUND';
   end if;
  end if;
  if v_account.status is distinct from 'invited' then
   raise sqlstate 'VT004' using message='INVALID_TRANSITION';
  end if;
  select lower(u.email) into v_email from auth.users u where u.id=v_account.user_id;
  return jsonb_build_object('op',p_op,'email',v_email,'reusableUserId',null,
   'volunteerId',v_account.person_id,'accountRevision',v_account.revision);
 end if;

 if p_op='create' then
  -- NO_EMAIL, then the volunteer's own account: ALREADY_INVITED while it is
  -- invited or active (or the person is linked to a sign-in at all), and
  -- USE_REACTIVATE once it is deactivated.
  select lower(btrim(v.email)) into v_email from public.volunteer_profiles v
   where v.workspace_id=p_workspace_id and v.person_id=v_volunteer;
  if v_email is null or v_email='' then
   raise sqlstate 'VT007' using message='VALIDATION',detail='NO_EMAIL';
  end if;
  if v_account.status in ('invited','active') then
   raise sqlstate 'VT007' using message='VALIDATION',detail='ALREADY_INVITED';
  end if;
  if v_account.status='deactivated' then
   raise sqlstate 'VT007' using message='VALIDATION',detail='USE_REACTIVATE';
  end if;
  if v_person.user_id is not null then
   raise sqlstate 'VT007' using message='VALIDATION',detail='ALREADY_INVITED';
  end if;
 else
  -- invite: an email whose user has a client account, in any workspace.
  if exists(select 1 from auth.users u
   join public.accounts a on a.user_id=u.id
   join public.memberships m on m.workspace_id=a.workspace_id and m.user_id=a.user_id and m.access='applicant'
   where lower(u.email)=v_email) then
   raise sqlstate 'VT007' using message='VALIDATION',detail='ALREADY_INVITED';
  end if;
 end if;
 -- The email belongs to a user with any account row, staff or client, in any
 -- status and any workspace. The target has none at this point.
 if exists(select 1 from auth.users u join public.accounts a on a.user_id=u.id where lower(u.email)=v_email) then
  raise sqlstate 'VT007' using message='VALIDATION',detail='EMAIL_IN_USE';
 end if;
 if p_op='invite' and exists(select 1 from public.volunteer_profiles v where v.email=v_email) then
  raise sqlstate 'VT007' using message='VALIDATION',detail='EMAIL_ON_ROSTER';
 end if;
 -- An auth user with this email and no account row at all is reused.
 select u.id into v_reusable from auth.users u
  where lower(u.email)=v_email and not exists(select 1 from public.accounts a where a.user_id=u.id)
  order by u.created_at,u.id limit 1;
 return jsonb_build_object('op',p_op,'email',v_email,'reusableUserId',v_reusable,
  'volunteerId',v_volunteer,'accountRevision',null);
end;
$$;
revoke all on function vitally_private.account_check(uuid,text,jsonb) from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- §7. One membership each (design D3). The callers check the revision.

-- Deactivate: an invited or active account becomes deactivated and its
-- membership inactive. The auth user and the person's link stay, so the email
-- stays locked and the person stays on the Roster. Refused, as a volunteer
-- save is (045), while the person holds open work.
create function vitally_private.deactivate_account(p_workspace_id uuid,p_user_id uuid)
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
 update public.accounts set status='deactivated',deactivated_at=now(),revision=revision+1,updated_at=now()
  where workspace_id=p_workspace_id and user_id=p_user_id;
 update public.memberships set active=false where workspace_id=p_workspace_id and user_id=p_user_id;
end;
$$;
revoke all on function vitally_private.deactivate_account(uuid,uuid) from public,anon,authenticated,service_role;

-- Reactivate: the membership is active again, and the account is `active` if
-- this account was ever activated by a sign-in, else `invited`. Nothing else is
-- restored: clearance still needs roles, certificates and any photo ID check.
-- Refused with EMAIL_IN_USE when the user meanwhile has an active membership
-- in another workspace. Returns the new status.
create function vitally_private.reactivate_account(p_workspace_id uuid,p_user_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare v_account public.accounts;
 v_status text;
begin
 select * into v_account from public.accounts
  where workspace_id=p_workspace_id and user_id=p_user_id for update;
 if not found then
  raise sqlstate 'VT002' using message='NOT_FOUND';
 end if;
 if v_account.status<>'deactivated' then
  raise sqlstate 'VT004' using message='INVALID_TRANSITION';
 end if;
 if exists(select 1 from public.memberships
  where user_id=p_user_id and active and workspace_id<>p_workspace_id) then
  raise sqlstate 'VT007' using message='VALIDATION',detail='EMAIL_IN_USE';
 end if;
 v_status=case when v_account.activated_at is not null then 'active' else 'invited' end;
 begin
  update public.memberships set active=true where workspace_id=p_workspace_id and user_id=p_user_id;
 exception when unique_violation then
  -- memberships_one_active_workspace: another workspace won the race.
  raise sqlstate 'VT007' using message='VALIDATION',detail='EMAIL_IN_USE';
 end;
 update public.accounts set status=v_status,deactivated_at=null,revision=revision+1,updated_at=now()
  where workspace_id=p_workspace_id and user_id=p_user_id;
 return v_status;
end;
$$;
revoke all on function vitally_private.reactivate_account(uuid,uuid) from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- §8. The public RPCs (design D3). Each resolves the caller as
-- vitally_save_volunteer does (045): an active staff membership, its person,
-- and the workspace admin check on the ceiling. The writing ones take the
-- workspace lock that add_staff_member and the Roster save take, then the
-- digest (with the resolved person) and the receipt; a replay returns the
-- stored result. A refusal rolls everything back, the receipt included.

-- Read-only: the check alone, for the Edge Function's step 2.
create function public.vitally_prepare_account(p_op text,p_target jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_person public.people;
begin
 v_member=vitally_private.require_membership();
 v_person=vitally_private.acting_person(v_member);
 if v_member.access<>'staff' or v_person.id is null or not vitally_policy.is_workspace_admin(v_member.workspace_id) then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 return vitally_private.account_check(v_member.workspace_id,p_op,p_target);
end;
$$;
revoke all on function public.vitally_prepare_account(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.vitally_prepare_account(text,jsonb) to authenticated;

-- Create account (create) or Invite (invite) for an auth user the Edge
-- Function created or reused. The check runs again under the lock, and the
-- user must have exactly the checked email and no account row: an arbitrary
-- p_user_id gains nothing.
--   - create: the active staff membership, the person linked with the
--     four-capability ceiling, the profile revision bumped, and the account
--     `invited`, naming the person;
--   - invite: the active applicant membership and an `invited` account naming
--     no person.
create function public.vitally_record_account(p_action_id uuid,p_op text,p_target jsonb,p_user_id uuid)
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
 if p_action_id is null or p_user_id is null or p_op is null or p_op not in ('create','invite') then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_member.workspace_id::text,0));
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
   update public.people set user_id=p_user_id,capabilities=array['assist','prepare','receive_documents','review']::text[]
    where workspace_id=v_member.workspace_id and id=v_volunteer;
   update public.volunteer_profiles set revision=revision+1,updated_at=now()
    where workspace_id=v_member.workspace_id and person_id=v_volunteer;
  else
   insert into public.memberships(workspace_id,user_id,access) values(v_member.workspace_id,p_user_id,'applicant');
  end if;
  insert into public.accounts(workspace_id,user_id,person_id,status,invited_at,invited_by)
   values(v_member.workspace_id,p_user_id,v_volunteer,'invited',now(),v_person.id);
 exception when unique_violation then
  -- Another active membership for this user (memberships_one_active_workspace)
  -- or a row that appeared meanwhile.
  raise sqlstate 'VT007' using message='VALIDATION',detail='EMAIL_IN_USE';
 end;
 v_result=jsonb_build_object('actionId',p_action_id,'status','invited','email',v_email,'accountRevision',1);
 update public.action_receipts set target_id=coalesce(v_volunteer,p_user_id),receipt=v_result where id=v_receipt.id;
 return v_result;
end;
$$;
revoke all on function public.vitally_record_account(uuid,text,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.vitally_record_account(uuid,text,jsonb,uuid) to authenticated;

-- Deactivate a volunteer's account at the account revision the drawer read.
-- Order: NOT_FOUND (not a person of this workspace), SELF (the caller's own
-- account), INVALID_TRANSITION (no account), CONFLICT (stale revision), then
-- deactivate_account's own refusals (status, OPEN_WORK).
create function public.vitally_deactivate_account(p_action_id uuid,p_volunteer_id uuid,p_expected_revision bigint)
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
 perform vitally_private.deactivate_account(v_member.workspace_id,v_account.user_id);
 v_result=jsonb_build_object('actionId',p_action_id,'status','deactivated','accountRevision',v_account.revision+1);
 update public.action_receipts set target_id=p_volunteer_id,receipt=v_result where id=v_receipt.id;
 return v_result;
end;
$$;
revoke all on function public.vitally_deactivate_account(uuid,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.vitally_deactivate_account(uuid,uuid,bigint) to authenticated;

-- Reactivate a volunteer's deactivated account at the revision the drawer
-- read. No email is sent. Order: NOT_FOUND, INVALID_TRANSITION (no account),
-- CONFLICT, then reactivate_account's own refusals (status, EMAIL_IN_USE).
create function public.vitally_reactivate_account(p_action_id uuid,p_volunteer_id uuid,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_person public.people;
 v_receipt public.action_receipts;
 v_account public.accounts;
 v_digest text;
 v_status text;
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
 v_digest=encode(extensions.digest(jsonb_build_object('operation','REACTIVATE_ACCOUNT','volunteerId',p_volunteer_id,
  'expectedRevision',p_expected_revision,'personId',v_person.id)::text,'sha256'),'hex');
 v_receipt=vitally_private.reserve_receipt(v_member,p_action_id,'REACTIVATE_ACCOUNT',v_digest,v_person.id);
 if v_receipt.receipt is not null then
  return v_receipt.receipt;
 end if;
 if not exists(select 1 from public.people p where p.workspace_id=v_member.workspace_id and p.id=p_volunteer_id) then
  raise sqlstate 'VT002' using message='NOT_FOUND';
 end if;
 select * into v_account from public.accounts
  where workspace_id=v_member.workspace_id and person_id=p_volunteer_id for update;
 if not found then
  raise sqlstate 'VT004' using message='INVALID_TRANSITION';
 end if;
 if v_account.revision<>p_expected_revision then
  raise sqlstate 'VT003' using message='CONFLICT';
 end if;
 v_status=vitally_private.reactivate_account(v_member.workspace_id,v_account.user_id);
 v_result=jsonb_build_object('actionId',p_action_id,'status',v_status,'accountRevision',v_account.revision+1);
 update public.action_receipts set target_id=p_volunteer_id,receipt=v_result where id=v_receipt.id;
 return v_result;
end;
$$;
revoke all on function public.vitally_reactivate_account(uuid,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.vitally_reactivate_account(uuid,uuid,bigint) to authenticated;

-- The workspace's client accounts for the office panel, newest first by
-- invitation (or activation, for a backfilled or roster-made client). The
-- email is read from auth.users here, inside the definer.
create function public.vitally_client_invitations()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_person public.people;
begin
 v_member=vitally_private.require_membership();
 v_person=vitally_private.acting_person(v_member);
 if v_member.access<>'staff' or v_person.id is null or not vitally_policy.is_workspace_admin(v_member.workspace_id) then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 return coalesce((
  select jsonb_agg(jsonb_build_object('email',lower(u.email),'status',a.status,'invitedAt',a.invited_at,
    'activatedAt',a.activated_at,'accountRevision',a.revision)
   order by coalesce(a.invited_at,a.activated_at) desc nulls last,lower(u.email) collate "C")
  from public.accounts a
  join public.memberships m on m.workspace_id=a.workspace_id and m.user_id=a.user_id and m.access='applicant'
  join auth.users u on u.id=a.user_id
  where a.workspace_id=v_member.workspace_id),'[]'::jsonb);
end;
$$;
revoke all on function public.vitally_client_invitations() from public,anon,authenticated,service_role;
grant execute on function public.vitally_client_invitations() to authenticated;
