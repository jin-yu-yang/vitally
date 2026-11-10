-- 044: volunteer roster records (OpenSpec change add-volunteer-roster-records,
-- design D2-D6).
--
-- The admin-only records behind the Roster. In order:
--   (a) the schema vitally_policy and its one admin check, for row policies
--       that must read `people` without recursing into its own policy;
--   (b) volunteer_profiles, roster_entries and certificates, readable only by
--       an admin of the workspace and not published to realtime;
--   (c) `staff_people` hides a person with no sign-in and no capabilities from
--       everyone but an admin;
--   (d) vitally_save_volunteer, the one way to write the records;
--   (e) add_staff_member links a matching volunteer with no sign-in;
--   (f) the backfill of existing staff, with no roles inferred.
-- Roles and certificates grant nothing: people.capabilities is untouched here.

-- ---------------------------------------------------------------------------
-- (a) The admin check. PostgREST exposes only `public`, so this is not an API,
-- and it takes no user id: it answers only for the caller.

create schema vitally_policy;
grant usage on schema vitally_policy to authenticated;

create function vitally_policy.is_workspace_admin(p_workspace_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.memberships m
  join public.people p on p.workspace_id=m.workspace_id and p.user_id=m.user_id
  where m.workspace_id=p_workspace_id and m.user_id=(select auth.uid()) and m.active and m.access='staff'
   and 'admin'=any(p.capabilities));
$$;
revoke all on function vitally_policy.is_workspace_admin(uuid) from public,anon,authenticated,service_role;
grant execute on function vitally_policy.is_workspace_admin(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- (b) The records. These are separate from `people` because row security
-- filters rows, not columns, and every staff member reads `people` (D1).

create table public.volunteer_profiles (
 workspace_id uuid not null, person_id uuid not null,
 email text not null check (email=lower(email) and length(email) between 3 and 254),
 phone text check (length(phone) between 1 and 30),
 works text not null default 'on_site' check (works in ('on_site','remote','on_site_and_remote')),
 languages text[] not null default '{}' check (languages <@ array['english','mandarin','cantonese','other']::text[]),
 other_language text check (length(other_language) between 1 and 40),
 revision bigint not null default 1,
 updated_at timestamptz not null default now(),
 primary key (workspace_id,person_id), unique (workspace_id,email),
 foreign key (workspace_id,person_id) references public.people(workspace_id,id) on delete cascade,
 check ((other_language is not null) = ('other'=any(languages)))
);
create table public.roster_entries (
 workspace_id uuid not null, person_id uuid not null, season smallint not null,
 roles text[] not null default '{}' check (roles <@ array['greeter','intaker','preparer','reviewer','admin']::text[]),
 added_by_person_id uuid,
 created_at timestamptz not null default now(),
 primary key (workspace_id,person_id,season),
 foreign key (workspace_id,person_id) references public.people(workspace_id,id) on delete cascade,
 -- Deferred, as 001's default follow-up key is: deleting a workspace cascades to
 -- both the adder and the entry, and an immediate check would see the adder
 -- gone before the entry is.
 foreign key (workspace_id,added_by_person_id) references public.people(workspace_id,id) deferrable initially deferred
);
create table public.certificates (
 workspace_id uuid not null, person_id uuid not null, season smallint not null,
 certificate text not null check (certificate in ('vsc','itqr','sc','basic','advanced')),
 status text not null default 'confirmed' check (status in ('uploaded','confirmed')),
 confirmed_at timestamptz, confirmed_by_person_id uuid,
 primary key (workspace_id,person_id,season,certificate),
 foreign key (workspace_id,person_id,season) references public.roster_entries(workspace_id,person_id,season) on delete cascade,
 foreign key (workspace_id,confirmed_by_person_id) references public.people(workspace_id,id) deferrable initially deferred
);

alter table public.volunteer_profiles enable row level security;
alter table public.roster_entries enable row level security;
alter table public.certificates enable row level security;
revoke all on public.volunteer_profiles from public,anon,authenticated,service_role;
revoke all on public.roster_entries from public,anon,authenticated,service_role;
revoke all on public.certificates from public,anon,authenticated,service_role;
grant select on public.volunteer_profiles to authenticated;
grant select on public.roster_entries to authenticated;
grant select on public.certificates to authenticated;
create policy admin_volunteer_profiles on public.volunteer_profiles for select to authenticated
 using (vitally_policy.is_workspace_admin(workspace_id));
create policy admin_roster_entries on public.roster_entries for select to authenticated
 using (vitally_policy.is_workspace_admin(workspace_id));
create policy admin_certificates on public.certificates for select to authenticated
 using (vitally_policy.is_workspace_admin(workspace_id));

-- ---------------------------------------------------------------------------
-- (c) A volunteer with no sign-in has no capabilities, so only admins read them.

alter policy staff_people on public.people using(
 exists(select 1 from public.memberships m where m.workspace_id=people.workspace_id and m.user_id=(select auth.uid()) and m.active and m.access='staff')
 and (people.user_id is not null or cardinality(people.capabilities)>0 or vitally_policy.is_workspace_admin(people.workspace_id)));

-- ---------------------------------------------------------------------------
-- (d) Both ids null adds; both present edits. The admin check comes before any
-- other check of the call, and before a receipt is reserved.

create function public.vitally_save_volunteer(p_action_id uuid,p_volunteer_id uuid,p_expected_revision bigint,p_volunteer jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_person public.people;
 v_receipt public.action_receipts;
 v_profile public.volunteer_profiles;
 v_digest text;
 v_key text;
 v_target_user uuid;
 v_target_id uuid=p_volunteer_id;
 v_season smallint;
 v_revision bigint=1;
 v_name text;
 v_email text;
 v_phone text;
 v_works text;
 v_other text;
 v_languages text[];
 v_roles text[];
 v_certificates text[];
 v_result jsonb;
begin
 v_member=vitally_private.require_membership();
 v_person=vitally_private.acting_person(v_member);
 -- A client's acting person is an empty row, so the capability test is null-safe.
 if v_member.access<>'staff' or v_person.id is null or not coalesce('admin'=any(v_person.capabilities),false) then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 if p_action_id is null or p_volunteer is null or jsonb_typeof(p_volunteer)<>'object'
  or (p_volunteer_id is null)<>(p_expected_revision is null) then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 -- The lock add_staff_member takes: an Edit and a roster link cannot deadlock,
 -- or link on an address that has just changed.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_member.workspace_id::text,0));
 v_digest=encode(extensions.digest(jsonb_build_object('operation','SAVE_VOLUNTEER','volunteerId',p_volunteer_id,
  'expectedRevision',p_expected_revision,'personId',v_person.id,'volunteer',p_volunteer)::text,'sha256'),'hex');
 v_receipt=vitally_private.reserve_receipt(v_member,p_action_id,'SAVE_VOLUNTEER',v_digest,v_person.id);
 if v_receipt.receipt is not null then
  return v_receipt.receipt;
 end if;
 if p_volunteer_id is not null then
  select * into v_profile from public.volunteer_profiles
   where workspace_id=v_member.workspace_id and person_id=p_volunteer_id for update;
  if not found then
   raise sqlstate 'VT002' using message='NOT_FOUND';
  end if;
  if v_profile.revision<>p_expected_revision then
   raise sqlstate 'VT003' using message='CONFLICT';
  end if;
  v_revision=v_profile.revision+1;
 end if;

 -- The payload: exactly these keys, each of its type.
 if array(select k from jsonb_object_keys(p_volunteer) k order by k)
   <>array['certificates','email','languages','name','otherLanguage','phone','roles','works']::text[]
  or jsonb_typeof(p_volunteer->'name')<>'string' or jsonb_typeof(p_volunteer->'email')<>'string'
  or jsonb_typeof(p_volunteer->'works')<>'string'
  or jsonb_typeof(p_volunteer->'phone') not in ('string','null')
  or jsonb_typeof(p_volunteer->'otherLanguage') not in ('string','null') then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 foreach v_key in array array['languages','roles','certificates'] loop
  if jsonb_typeof(p_volunteer->v_key)<>'array'
   or exists(select 1 from jsonb_array_elements(p_volunteer->v_key) e where jsonb_typeof(e)<>'string') then
   raise sqlstate 'VT007' using message='VALIDATION';
  end if;
 end loop;
 v_name=btrim(p_volunteer->>'name');
 v_email=lower(btrim(p_volunteer->>'email'));
 v_phone=nullif(btrim(p_volunteer->>'phone'),'');
 v_works=p_volunteer->>'works';
 v_other=nullif(btrim(p_volunteer->>'otherLanguage'),'');
 v_languages=array(select jsonb_array_elements_text(p_volunteer->'languages'));
 v_roles=array(select jsonb_array_elements_text(p_volunteer->'roles'));
 v_certificates=array(select jsonb_array_elements_text(p_volunteer->'certificates'));
 if length(v_name) not between 1 and 80
  or length(v_email)>254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@.]+(\.[^[:space:]@.]+)+$'
  or length(v_phone)>30
  or v_works not in ('on_site','remote','on_site_and_remote')
  or not (v_languages <@ array['english','mandarin','cantonese','other']::text[])
  or cardinality(v_languages)<>(select count(distinct c) from unnest(v_languages) c)
  or length(v_other)>40
  or (v_other is not null)<>('other'=any(v_languages))
  or cardinality(v_roles)=0
  or not (v_roles <@ array['greeter','intaker','preparer','reviewer','admin']::text[])
  or cardinality(v_roles)<>(select count(distinct c) from unnest(v_roles) c)
  or not (v_certificates <@ array['vsc','itqr','sc','basic','advanced']::text[])
  or cardinality(v_certificates)<>(select count(distinct c) from unnest(v_certificates) c) then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 if exists(select 1 from public.volunteer_profiles
  where workspace_id=v_member.workspace_id and email=v_email and person_id is distinct from p_volunteer_id) then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 select current_season into v_season from public.workspaces where id=v_member.workspace_id;

 begin
  if p_volunteer_id is null then
   insert into public.people(workspace_id,person_key,name,capabilities)
    values(v_member.workspace_id,'v_'||substr(replace(gen_random_uuid()::text,'-',''),1,12),v_name,'{}')
    returning id into v_target_id;
   insert into public.volunteer_profiles(workspace_id,person_id,email,phone,works,languages,other_language)
    values(v_member.workspace_id,v_target_id,v_email,v_phone,v_works,v_languages,v_other);
  else
   select user_id into v_target_user from public.people where id=p_volunteer_id;
   -- A sign-in's address belongs to its account.
   if v_target_user is not null and v_email<>v_profile.email then
    raise sqlstate 'VT007' using message='VALIDATION';
   end if;
   update public.people set name=v_name where id=p_volunteer_id;
   update public.volunteer_profiles set email=v_email,phone=v_phone,works=v_works,languages=v_languages,
     other_language=v_other,revision=v_revision,updated_at=now()
    where workspace_id=v_member.workspace_id and person_id=p_volunteer_id;
  end if;
  insert into public.roster_entries(workspace_id,person_id,season,roles,added_by_person_id)
   values(v_member.workspace_id,v_target_id,v_season,v_roles,v_person.id)
   on conflict(workspace_id,person_id,season) do update set roles=excluded.roles;
  delete from public.certificates where workspace_id=v_member.workspace_id and person_id=v_target_id
   and season=v_season and certificate<>all(v_certificates);
  insert into public.certificates(workspace_id,person_id,season,certificate,status,confirmed_at,confirmed_by_person_id)
   select v_member.workspace_id,v_target_id,v_season,c,'confirmed',now(),v_person.id from unnest(v_certificates) c
   on conflict do nothing;
 exception when unique_violation then
  raise sqlstate 'VT007' using message='VALIDATION';
 end;
 v_result=jsonb_build_object('actionId',p_action_id,'personId',v_target_id,'revision',v_revision);
 update public.action_receipts set target_id=v_target_id,receipt=v_result where id=v_receipt.id;
 return v_result;
end;
$$;
revoke all on function public.vitally_save_volunteer(uuid,uuid,bigint,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.vitally_save_volunteer(uuid,uuid,bigint,jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- (e) From 043, with two changes: a re-run no longer compares the name, and a
-- volunteer with no sign-in and this account's address is linked, not duplicated.

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
  return v_link;
 end if;
 insert into public.people(workspace_id,person_key,name,capabilities,user_id)
  values(p_workspace_id,p_person_key,p_name,p_capabilities,p_user_id) returning id into v_person_id;
 insert into public.volunteer_profiles(workspace_id,person_id,email) values(p_workspace_id,v_person_id,v_email);
 insert into public.roster_entries(workspace_id,person_id,season)
  select p_workspace_id,v_person_id,w.current_season from public.workspaces w where w.id=p_workspace_id;
 return v_person_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- (f) Everyone already linked to a staff membership gets records. Roles start
-- empty: inferring them from capabilities would suggest the two are connected.

insert into public.volunteer_profiles(workspace_id,person_id,email)
 select p.workspace_id,p.id,lower(u.email) from public.people p
  join public.memberships m on m.workspace_id=p.workspace_id and m.user_id=p.user_id and m.access='staff'
  join auth.users u on u.id=p.user_id;
insert into public.roster_entries(workspace_id,person_id,season)
 select v.workspace_id,v.person_id,w.current_season from public.volunteer_profiles v
  join public.workspaces w on w.id=v.workspace_id;
