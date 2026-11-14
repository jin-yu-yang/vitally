-- 047: sign-in accounts (OpenSpec change add-account-invitations, design D1,
-- D2, D6, D7).
--
-- Part 1: one account row per membership, and clearance needs an active one.
-- In order:
--   §1 the accounts table, its commit-time person check and its row security;
--   §2 insert_active_account, and the backfill: every existing membership
--      gets a row (active, or deactivated when the membership is inactive);
--   §3 the first sign-in trigger on auth.users: invited becomes active;
--   §4 add_staff_member and initialize_workspace write active accounts;
--   §5 cleared requires an active account;
--   §5a the site number, and the name a volunteer gives at the site check.
-- Part 2 (the account functions) follows at the end of the file.
-- The migration runs in one transaction. It adds rows only: no existing
-- membership, person or other row is changed. It adds one nullable column to
-- volunteer_profiles (§5a).

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
 -- An invitation never completed by this time is cancelled (design D11);
 -- null for an account that is not invited.
 expires_at timestamptz,
 -- Wrong site numbers entered at a volunteer's first sign-in (design D12).
 site_check_attempts integer not null default 0 check (site_check_attempts between 0 and 5),
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
-- publication, like the Roster tables. service_role holds nothing, as on the
-- Roster tables: the accounts Edge Function reaches the database with the
-- admin's own JWT and uses the service key only for Auth's createUser.
alter table public.accounts enable row level security;
revoke all on public.accounts from public,anon,authenticated,service_role;
grant select on public.accounts to authenticated;
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
-- §3. The first sign-in (design D2, D11, D12). Auth stamps last_sign_in_at
-- while it issues the session, so the account is settled before the
-- session's first request reaches the database. Only `invited` rows change: a
-- deactivated account stays deactivated however often its person signs in.
--   - an invitation past its expiry is cancelled (expire_invitations, Part 2),
--     under the workspace lock every account write takes, and judged again
--     once the lock is held, so a Resend that just restarted it is kept;
--   - a client's invitation becomes active;
--   - a volunteer's stays invited until the site check passes
--     (vitally_complete_site_check, Part 2).
-- expire_invitations is defined below; plpgsql resolves it when this runs.

create function vitally_private.account_signed_in()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_workspace uuid;
begin
 if new.last_sign_in_at is not null and new.last_sign_in_at is distinct from old.last_sign_in_at then
  for v_workspace in select distinct a.workspace_id from public.accounts a
   where a.user_id=new.id and a.status='invited' and a.activated_at is null and a.expires_at<now() loop
   perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_workspace::text,0));
   perform vitally_private.expire_invitations(v_workspace);
  end loop;
  update public.accounts set status='active',activated_at=new.last_sign_in_at,expires_at=null,
    revision=revision+1,updated_at=now()
   where user_id=new.id and status='invited' and person_id is null;
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
  perform vitally_private.insert_active_account(p_workspace_id,p_user_id,v_link); -- 047
  return v_link;
 end if;
 insert into public.people(workspace_id,person_key,name,capabilities,user_id)
  values(p_workspace_id,p_person_key,p_name,p_capabilities,p_user_id) returning id into v_person_id;
 insert into public.volunteer_profiles(workspace_id,person_id,email) values(p_workspace_id,v_person_id,v_email);
 insert into public.roster_entries(workspace_id,person_id,season)
  select p_workspace_id,v_person_id,w.current_season from public.workspaces w where w.id=p_workspace_id;
 perform vitally_private.insert_active_account(p_workspace_id,p_user_id,v_person_id); -- 047
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
  perform vitally_private.insert_active_account(p_workspace_id,v_member.id,null); -- 047
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

-- ---------------------------------------------------------------------------
-- §5a. The site check (design D12). The site's number (its SIDN) is a
-- workspace setting the developer sets with the roster command for now; a
-- later Season settings change owns it. Nobody reads it through the API: only
-- vitally_complete_site_check compares against it. The repository, the seed
-- and the tests use fictional numbers only.

create table vitally_private.site_numbers (
 workspace_id uuid primary key references public.workspaces(id) on delete cascade,
 sidn text not null check (sidn ~ '^S[0-9]{8}$'),
 updated_at timestamptz not null default now()
);
revoke all on vitally_private.site_numbers from public,anon,authenticated,service_role;

-- A site number as typed: upper-cased, with spaces and hyphens removed.
create function vitally_private.normalize_sidn(p_sidn text)
returns text language sql immutable security definer set search_path='' as $$
 select upper(regexp_replace(coalesce(p_sidn,''),'[[:space:]-]','','g'));
$$;
revoke all on function vitally_private.normalize_sidn(text) from public,anon,authenticated,service_role;

-- Sets (or replaces) a workspace's site number. The roster command's only
-- door; VALIDATION for an unknown workspace or a number not shaped S + 8 digits.
create function vitally_private.set_site_number(p_workspace_id uuid,p_sidn text)
returns void language plpgsql security definer set search_path='' as $$
declare v_sidn text=vitally_private.normalize_sidn(p_sidn);
begin
 if p_workspace_id is null or v_sidn !~ '^S[0-9]{8}$'
  or not exists(select 1 from public.workspaces where id=p_workspace_id) then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 insert into vitally_private.site_numbers(workspace_id,sidn) values(p_workspace_id,v_sidn)
  on conflict (workspace_id) do update set sidn=excluded.sidn,updated_at=now();
end;
$$;
revoke all on function vitally_private.set_site_number(uuid,text) from public,anon,authenticated,service_role;

-- The name a volunteer gives at the site check: admin-only, like the rest of
-- the profile, and never on people (whose name every cleared staff member reads).
alter table public.volunteer_profiles add column signed_in_name text
 check (signed_in_name is null or length(signed_in_name) between 1 and 80);

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
--   §7a cancel_invitation and expire_invitations (design D10, D11);
--   §8 the public RPCs: vitally_prepare_account, vitally_record_account,
--      vitally_deactivate_account, vitally_reactivate_account and
--      vitally_client_invitations;
--   §9 vitally_cancel_invitation, vitally_expire_invitations,
--      vitally_complete_site_check and vitally_my_clearance (design D10-D12).
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
 -- Back to invited: a fresh seven days and a fresh five site-check attempts
 -- (brainstorm, "Decided without the user" 19).
 update public.accounts set status=v_status,deactivated_at=null,
   expires_at=case when v_status='invited' then now()+interval '7 days' end,
   site_check_attempts=0,revision=revision+1,updated_at=now()
  where workspace_id=p_workspace_id and user_id=p_user_id;
 return v_status;
end;
$$;
revoke all on function vitally_private.reactivate_account(uuid,uuid) from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- §7a. Cancel invitation and expiry (design D10, D11). An invitation that was
-- never completed rolls back: nobody has acted as that user, so nothing refers
-- to the membership but the account and the person's link. The account row
-- and the membership go, the person loses the link and the ceiling Create
-- account gave (back to none, as a Roster-added person starts), and the
-- profile revision is bumped, so the email is the drawer's to change again.
-- The auth user stays: with no account row it is the reusable kind (design
-- D5), so a later Create account or Invite for the email links it again, and
-- its sign-in code reaches nothing meanwhile. Refused (INVALID_TRANSITION)
-- unless the account is invited and was never activated.
create function vitally_private.cancel_invitation(p_workspace_id uuid,p_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_account public.accounts;
begin
 select * into v_account from public.accounts
  where workspace_id=p_workspace_id and user_id=p_user_id for update;
 if not found then
  raise sqlstate 'VT002' using message='NOT_FOUND';
 end if;
 if v_account.status<>'invited' or v_account.activated_at is not null then
  raise sqlstate 'VT004' using message='INVALID_TRANSITION';
 end if;
 if v_account.person_id is not null then
  -- First the link: people(workspace_id,user_id) refers to the membership.
  update public.people set user_id=null,capabilities='{}'
   where workspace_id=p_workspace_id and id=v_account.person_id;
  update public.volunteer_profiles set revision=revision+1,updated_at=now()
   where workspace_id=p_workspace_id and person_id=v_account.person_id;
 end if;
 -- The account goes with the membership (on delete cascade).
 delete from public.memberships where workspace_id=p_workspace_id and user_id=p_user_id;
end;
$$;
revoke all on function vitally_private.cancel_invitation(uuid,uuid) from public,anon,authenticated,service_role;

-- Every invitation of the workspace past its expiry, cancelled; returns how
-- many. Expiry is applied when it is next looked at, not by a timer (brainstorm,
-- "Decided without the user" 17): every account RPC, the office list, the
-- Roster's read and the first sign-in call this first, and an expired invitee
-- was never cleared, so nothing could act as them in between. A caller that
-- then refuses (a Resend of the expired invitation, say) rolls the
-- cancellation back with everything else; the next reader that commits applies
-- it again, and until then every reader treats the row as gone.
create function vitally_private.expire_invitations(p_workspace_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare v_user uuid;
 v_count integer=0;
begin
 for v_user in select a.user_id from public.accounts a
  where a.workspace_id=p_workspace_id and a.status='invited' and a.activated_at is null and a.expires_at<now()
  order by a.user_id for update loop
  perform vitally_private.cancel_invitation(p_workspace_id,v_user);
  v_count=v_count+1;
 end loop;
 return v_count;
end;
$$;
revoke all on function vitally_private.expire_invitations(uuid) from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- §8. The public RPCs (design D3). Each resolves the caller as
-- vitally_save_volunteer does (045): an active staff membership, its person,
-- and the workspace admin check on the ceiling. The writing ones take the
-- workspace lock that add_staff_member and the Roster save take, then the
-- digest (with the resolved person) and the receipt; a replay returns the
-- stored result. A refusal rolls everything back, the receipt included.

-- Read-only: the check alone, for the Edge Function's step 2. A retried
-- Create or Invite reaches this again with the same action id after its record
-- succeeded; the check would now refuse it (ALREADY_INVITED), so when the
-- caller already holds a stored RECORD_ACCOUNT receipt for p_action_id the
-- answer is {replay: <that receipt>}, before any check. The receipt is read as
-- reserve_receipt keys it: the caller's workspace, user and action id.
-- p_action_id may be null (resend).
create function public.vitally_prepare_account(p_action_id uuid,p_op text,p_target jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_person public.people;
 v_stored jsonb;
begin
 v_member=vitally_private.require_membership();
 v_person=vitally_private.acting_person(v_member);
 if v_member.access<>'staff' or v_person.id is null or not vitally_policy.is_workspace_admin(v_member.workspace_id) then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 -- The lock first, so a retry that arrives while its first request is still
 -- recording waits for that record and then finds its receipt.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_member.workspace_id::text,0));
 if p_action_id is not null then
  select r.receipt into v_stored from public.action_receipts r
   where r.workspace_id=v_member.workspace_id and r.actor_user_id=v_member.user_id and r.action_id=p_action_id
    and r.operation='RECORD_ACCOUNT' and r.receipt is not null;
  if v_stored is not null then
   return jsonb_build_object('replay',v_stored);
  end if;
 end if;
 -- An expired invitation is cancelled before it is judged.
 perform vitally_private.expire_invitations(v_member.workspace_id);
 return vitally_private.account_check(v_member.workspace_id,p_op,p_target);
end;
$$;
revoke all on function public.vitally_prepare_account(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.vitally_prepare_account(uuid,text,jsonb) to authenticated;

-- Create account (create) or Invite (invite) for an auth user the Edge
-- Function created or reused. The check runs again under the lock, and the
-- user must have exactly the checked email and no account row: an arbitrary
-- p_user_id gains nothing.
--   - create: the active staff membership, the person linked with the
--     four-capability ceiling, the profile revision bumped, and the account
--     `invited`, naming the person;
--   - invite: the active applicant membership and an `invited` account naming
--     no person;
--   - resend (design D11): the invited account's seven days start again. No
--     receipt: a second restart is the same restart. p_action_id and
--     p_user_id are not used.
-- create and invite set the expiry seven days on.
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
   update public.people set user_id=p_user_id,capabilities=array['assist','prepare','receive_documents','review']::text[]
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
 perform vitally_private.expire_invitations(v_member.workspace_id);
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

-- The workspace's invited and active client accounts (the panel shows no
-- deactivated ones) for the office panel, newest first by
-- invitation (or activation, for a backfilled or roster-made client). The
-- email is read from auth.users here, inside the definer. Expired invitations
-- are cancelled first (design D11), so the list never shows one.
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
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_member.workspace_id::text,0));
 perform vitally_private.expire_invitations(v_member.workspace_id);
 return coalesce((
  select jsonb_agg(jsonb_build_object('email',lower(u.email),'status',a.status,'invitedAt',a.invited_at,
    'activatedAt',a.activated_at,'expiresAt',a.expires_at,'accountRevision',a.revision)
   order by coalesce(a.invited_at,a.activated_at) desc nulls last,lower(u.email) collate "C")
  from public.accounts a
  join public.memberships m on m.workspace_id=a.workspace_id and m.user_id=a.user_id and m.access='applicant'
  join auth.users u on u.id=a.user_id
  where a.workspace_id=v_member.workspace_id and a.status<>'deactivated'),'[]'::jsonb);
end;
$$;
revoke all on function public.vitally_client_invitations() from public,anon,authenticated,service_role;
grant execute on function public.vitally_client_invitations() to authenticated;

-- ---------------------------------------------------------------------------
-- §9. Cancel invitation, expiry, the site check and the caller's clearance
-- (design D10, D11, D12).

-- Cancel invitation (design D10), from the drawer ({volunteerId}) or the office
-- list ({email}), at the account revision the window read. Order: NOT_FOUND
-- (no such volunteer, or no client account with that email), CONFLICT (stale
-- revision), then cancel_invitation's INVALID_TRANSITION (not invited, or
-- activated before). An invitation that expired meanwhile is already gone:
-- NOT_FOUND for an email, INVALID_TRANSITION (no account) for a volunteer.
create function public.vitally_cancel_invitation(p_action_id uuid,p_target jsonb,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_person public.people;
 v_receipt public.action_receipts;
 v_account public.accounts;
 v_digest text;
 v_key text;
 v_volunteer uuid;
 v_email text;
 v_result jsonb;
begin
 v_member=vitally_private.require_membership();
 v_person=vitally_private.acting_person(v_member);
 if v_member.access<>'staff' or v_person.id is null or not vitally_policy.is_workspace_admin(v_member.workspace_id) then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 if p_action_id is null or p_expected_revision is null or p_target is null or jsonb_typeof(p_target)<>'object' then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 if (select count(*) from jsonb_object_keys(p_target))<>1 then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 select k into v_key from jsonb_object_keys(p_target) k;
 if v_key not in ('volunteerId','email') or jsonb_typeof(p_target->v_key)<>'string'
  or (v_key='volunteerId' and (p_target->>'volunteerId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_member.workspace_id::text,0));
 v_digest=encode(extensions.digest(jsonb_build_object('operation','CANCEL_INVITATION','target',p_target,
  'expectedRevision',p_expected_revision,'personId',v_person.id)::text,'sha256'),'hex');
 v_receipt=vitally_private.reserve_receipt(v_member,p_action_id,'CANCEL_INVITATION',v_digest,v_person.id);
 if v_receipt.receipt is not null then
  return v_receipt.receipt;
 end if;
 perform vitally_private.expire_invitations(v_member.workspace_id);
 if v_key='volunteerId' then
  v_volunteer=(p_target->>'volunteerId')::uuid;
  if not exists(select 1 from public.people p where p.workspace_id=v_member.workspace_id and p.id=v_volunteer) then
   raise sqlstate 'VT002' using message='NOT_FOUND';
  end if;
  select * into v_account from public.accounts
   where workspace_id=v_member.workspace_id and person_id=v_volunteer for update;
  if not found then
   raise sqlstate 'VT004' using message='INVALID_TRANSITION';
  end if;
 else
  v_email=lower(btrim(p_target->>'email'));
  select a.* into v_account from public.accounts a
   join public.memberships m on m.workspace_id=a.workspace_id and m.user_id=a.user_id and m.access='applicant'
   join auth.users u on u.id=a.user_id
   where a.workspace_id=v_member.workspace_id and lower(u.email)=v_email
   order by a.invited_at desc nulls last limit 1 for update of a;
  if not found then
   raise sqlstate 'VT002' using message='NOT_FOUND';
  end if;
 end if;
 if v_account.revision<>p_expected_revision then
  raise sqlstate 'VT003' using message='CONFLICT';
 end if;
 perform vitally_private.cancel_invitation(v_member.workspace_id,v_account.user_id);
 v_result=jsonb_build_object('actionId',p_action_id,'status','none');
 update public.action_receipts set target_id=coalesce(v_volunteer,v_account.user_id),receipt=v_result where id=v_receipt.id;
 return v_result;
end;
$$;
revoke all on function public.vitally_cancel_invitation(uuid,jsonb,bigint) from public,anon,authenticated,service_role;
grant execute on function public.vitally_cancel_invitation(uuid,jsonb,bigint) to authenticated;

-- The Roster's read calls this first (design D11): the workspace's expired
-- invitations, cancelled. Answers {cancelled: <how many>}.
create function public.vitally_expire_invitations()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_person public.people;
begin
 v_member=vitally_private.require_membership();
 v_person=vitally_private.acting_person(v_member);
 if v_member.access<>'staff' or v_person.id is null or not vitally_policy.is_workspace_admin(v_member.workspace_id) then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_member.workspace_id::text,0));
 return jsonb_build_object('cancelled',vitally_private.expire_invitations(v_member.workspace_id));
end;
$$;
revoke all on function public.vitally_expire_invitations() from public,anon,authenticated,service_role;
grant execute on function public.vitally_expire_invitations() to authenticated;

-- The site check (design D12): a volunteer at their first sign-in gives their
-- name and the site's number. The caller is the signed-in volunteer whose
-- account is invited (FORBIDDEN for anyone else: a client, an admin,
-- someone with no account; INVALID_TRANSITION once it is not invited). In
-- order, each answer a result, not an error, when it writes:
--   - past its expiry: the invitation is cancelled, {status:'cancelled',reason:'EXPIRED'};
--   - no name (blank or over 80 characters): VALIDATION NO_NAME, nothing counted;
--   - no site number typed: VALIDATION NO_SIDN, nothing counted;
--   - the workspace has no site number: VALIDATION SITE_NOT_SET, nothing counted;
--   - the right number: the name is stored on the profile and the account is
--     active, {status:'active'};
--   - a wrong number: one more attempt, {status:'invited',reason:'WRONG_SITE',
--     attemptsLeft}; the fifth cancels the invitation,
--     {status:'cancelled',reason:'TOO_MANY_ATTEMPTS'}.
create function public.vitally_complete_site_check(p_name text,p_sidn text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_account public.accounts;
 v_name text=btrim(coalesce(p_name,''));
 v_site text;
 v_attempts integer;
begin
 v_member=vitally_private.require_membership();
 if v_member.access<>'staff' then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_member.workspace_id::text,0));
 select * into v_account from public.accounts
  where workspace_id=v_member.workspace_id and user_id=v_member.user_id for update;
 if not found or v_account.person_id is null then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 if v_account.status<>'invited' or v_account.activated_at is not null then
  raise sqlstate 'VT004' using message='INVALID_TRANSITION';
 end if;
 if v_account.expires_at<now() then
  perform vitally_private.cancel_invitation(v_member.workspace_id,v_member.user_id);
  return jsonb_build_object('status','cancelled','reason','EXPIRED');
 end if;
 if v_name='' or length(v_name)>80 then
  raise sqlstate 'VT007' using message='VALIDATION',detail='NO_NAME';
 end if;
 if vitally_private.normalize_sidn(p_sidn)='' then
  raise sqlstate 'VT007' using message='VALIDATION',detail='NO_SIDN';
 end if;
 select n.sidn into v_site from vitally_private.site_numbers n where n.workspace_id=v_member.workspace_id;
 if v_site is null then
  raise sqlstate 'VT007' using message='VALIDATION',detail='SITE_NOT_SET';
 end if;
 if vitally_private.normalize_sidn(p_sidn)=v_site then
  update public.volunteer_profiles set signed_in_name=v_name,revision=revision+1,updated_at=now()
   where workspace_id=v_member.workspace_id and person_id=v_account.person_id;
  update public.accounts set status='active',activated_at=now(),expires_at=null,site_check_attempts=0,
    revision=revision+1,updated_at=now()
   where workspace_id=v_member.workspace_id and user_id=v_member.user_id;
  return jsonb_build_object('status','active');
 end if;
 v_attempts=v_account.site_check_attempts+1;
 if v_attempts>=5 then
  perform vitally_private.cancel_invitation(v_member.workspace_id,v_member.user_id);
  return jsonb_build_object('status','cancelled','reason','TOO_MANY_ATTEMPTS');
 end if;
 update public.accounts set site_check_attempts=v_attempts,revision=revision+1,updated_at=now()
  where workspace_id=v_member.workspace_id and user_id=v_member.user_id;
 return jsonb_build_object('status','invited','reason','WRONG_SITE','attemptsLeft',5-v_attempts);
end;
$$;
revoke all on function public.vitally_complete_site_check(text,text) from public,anon,authenticated,service_role;
grant execute on function public.vitally_complete_site_check(text,text) to authenticated;

-- From 045, with one change (design D12): `siteCheck` is true while the
-- caller's own account is invited, so the window shows the site check
-- instead of the setup screen. Nothing else in the answer changes.
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
 end if;
 select d.name into v_coordinator from public.workspaces w
  join public.people d on d.workspace_id=w.id and d.id=w.default_followup_person_id
  where w.id=v_person.workspace_id;
 return jsonb_build_object(
  'cleared',vitally_private.cleared(v_person.workspace_id,v_person.id),
  'missing',v_missing,
  'capabilities',to_jsonb(vitally_private.effective_capabilities(v_person.workspace_id,v_person.id)),
  'isAdmin','admin'=any(v_person.capabilities),
  'siteCoordinatorName',to_jsonb(v_coordinator),
  'siteCheck',exists(select 1 from public.accounts a where a.workspace_id=v_person.workspace_id and a.user_id=v_member.user_id and a.status='invited'));
end;
$$;
revoke all on function public.vitally_my_clearance() from public,anon,authenticated,service_role;
grant execute on function public.vitally_my_clearance() to authenticated;
