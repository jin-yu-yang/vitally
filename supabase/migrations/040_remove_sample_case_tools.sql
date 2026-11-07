-- 040: remove the sample-case tools (OpenSpec change remove-sample-case-tools,
-- design D1-D5).
--
-- The sample cases, the reset that rebuilt them, the checkpoints that rewrote
-- one, the client bindings and the columns that marked the rows all go. In
-- order:
--   1. delete the sample rows (D1);
--   2. rewrite the four live functions that read the dropped columns (D2-D4);
--   3. drop the index and the constraints that depend on the dropped columns;
--   4. drop the sample functions (D5), the bindings table and the columns;
--   5. recreate the origin checks without 'fixture'.
--
-- No drop here uses CASCADE: every dependent object is dropped or rewritten by
-- name first, so a dependency missed fails the whole migration instead of
-- going quietly. The migration runs in one transaction.

-- ---------------------------------------------------------------------------
-- 1. The sample rows. Every case child row goes with its case through the
-- per-case foreign keys. The filing-notes trigger lets a cascade through,
-- because the case row is already gone when it fires. Receipts that named a
-- sample stay, as historical values.

delete from public.assistance_items
 where fixture or case_id in (select id from public.cases where fixture or origin='fixture');
delete from public.cases where fixture or origin='fixture';

-- ---------------------------------------------------------------------------
-- 2. The live functions, each copied from its latest definition.

-- From 035, without the sample-reload branch: a note goes only together with
-- its whole case.
create or replace function vitally_private.filing_notes_append_only() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 -- A note may go only together with its whole case (a case or workspace
 -- teardown), never on its own. A delete cascading from a deleted case sees the
 -- case row already gone, so it passes; a direct delete, or a cascade from
 -- deleting just a filing attempt, finds the case and is refused.
 if tg_op='DELETE' and not exists(select 1 from public.cases where id=old.case_id) then
  return old;
 end if;
 raise sqlstate 'VT007' using message='VALIDATION';
end;
$$;
revoke all on function vitally_private.filing_notes_append_only() from public,anon,authenticated,service_role;

-- From 003, without the generation: replay protection is the unique key
-- (workspace_id, actor_user_id, action_id).
create or replace function vitally_private.reserve_receipt(p_member public.memberships,p_action_id uuid,p_operation text,p_digest text,p_person_id uuid)
returns public.action_receipts language plpgsql security definer set search_path='' as $$
declare v_receipt public.action_receipts;
begin
 insert into public.action_receipts(workspace_id,actor_user_id,action_id,operation,request_digest,actor_person_id)
 values(p_member.workspace_id,p_member.user_id,p_action_id,p_operation,p_digest,p_person_id)
 on conflict(workspace_id,actor_user_id,action_id) do nothing;
 select * into v_receipt from public.action_receipts
  where workspace_id=p_member.workspace_id and actor_user_id=p_member.user_id and action_id=p_action_id for update;
 if v_receipt.operation<>p_operation or v_receipt.request_digest<>p_digest then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 return v_receipt;
end;
$$;

-- From 038, without the generation and without `fixture` in the insert.
create or replace function public.vitally_create_case(p_action_id uuid,p_mode text,p_person_id uuid,p_answers jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_person public.people;
 v_user uuid=auth.uid();
 v_digest text;
 v_receipt public.action_receipts;
 v_case uuid;
 v_reference text;
 v_result jsonb;
 v_random bytea;
 v_constraint text;
 v_owner uuid;
 v_capabilities text[];
begin
 select * into v_member from public.memberships where user_id=v_user and active for share;
 if v_user is null or not found then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 v_person=vitally_private.acting_person(v_member,p_person_id);
 if p_mode='client' then
  if v_member.access<>'applicant' or v_person.id is not null then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
  v_owner=v_user;
 elsif p_mode='assisted' then
  if v_member.access not in ('presenter','staff') then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
  select capabilities into v_capabilities from public.people where id=v_person.id and workspace_id=v_member.workspace_id;
  if not found then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
  if not ('admin'=any(v_capabilities)) then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 else raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 if p_action_id is null or p_answers is null or jsonb_typeof(p_answers)<>'object' then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 if p_answers<>'{}'::jsonb then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 v_digest=encode(extensions.digest(jsonb_build_object('operation','CREATE_CASE','mode',p_mode,'personId',v_person.id,'answers',p_answers)::text,'sha256'),'hex');
 insert into public.action_receipts(workspace_id,actor_user_id,action_id,operation,request_digest,actor_person_id)
 values(v_member.workspace_id,v_user,p_action_id,'CREATE_CASE',v_digest,v_person.id) on conflict(workspace_id,actor_user_id,action_id) do nothing;
 select * into v_receipt from public.action_receipts where workspace_id=v_member.workspace_id and actor_user_id=v_user and action_id=p_action_id for update;
 if v_receipt.operation<>'CREATE_CASE' or v_receipt.request_digest<>v_digest then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 if v_receipt.receipt is not null then return v_receipt.receipt;
 end if;
 loop
  v_random=extensions.gen_random_bytes(8);v_reference='VT-';
  for i in 0..7 loop
   if i=4 then v_reference=v_reference||'-';
 end if;
   v_reference=v_reference||substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',get_byte(v_random,i)%32+1,1);
  end loop;
  begin
   insert into public.cases(reference,workspace_id,owner_user_id,origin,created_by_user_id,created_by_person_id,answers)
   values(v_reference,v_member.workspace_id,v_owner,p_mode,v_user,v_person.id,p_answers) returning id into v_case;
   exit;
  exception when unique_violation then
   get stacked diagnostics v_constraint=constraint_name;
   if v_constraint<>'cases_reference_key' then raise;
 end if;
  end;
 end loop;
 v_result=jsonb_build_object('actionId',p_action_id,'caseId',v_case,'reference',v_reference,'revision',1);
 update public.action_receipts set target_id=v_case,target_reference=v_reference,receipt=v_result where id=v_receipt.id;
 return v_result;
end;
$$;
revoke all on function public.vitally_create_case(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.vitally_create_case(uuid,text,uuid,jsonb) to authenticated;

-- From 038, without the client bindings: the `p_bindings` parameter, its
-- validation and the bindings loop go. The old signature is dropped by name,
-- and the new one is a new function, so its execute is revoked explicitly.
drop function vitally_private.initialize_workspace(uuid,uuid[],uuid[],jsonb);
create function vitally_private.initialize_workspace(p_workspace_id uuid,p_presenters uuid[],p_applicants uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_new boolean;
 v_person record;
 v_existing public.people;
 v_id uuid;
 v_access text;
 v_member record;
 v_people jsonb='{}'::jsonb;
 v_default uuid;
begin
 if p_workspace_id is null or p_presenters is null or p_applicants is null then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_workspace_id::text,0));
 if exists(select 1 from vitally_private.test_workspaces where workspace_id=p_workspace_id and test_overrides_applied) then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 if exists(select 1 from unnest(p_presenters||p_applicants) u where u is null) or cardinality(p_presenters||p_applicants)<>(select count(distinct u) from unnest(p_presenters||p_applicants) u) then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 if exists(select 1 from unnest(p_presenters||p_applicants) u where not exists(select 1 from auth.users a where a.id=u)) then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 select not exists(select 1 from public.workspaces where id=p_workspace_id) into v_new;
 insert into public.workspaces(id) values(p_workspace_id) on conflict do nothing;
 if not v_new and (select count(*) from public.people where workspace_id=p_workspace_id and user_id is null)<>3 then -- 038
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 for v_person in select * from (values ('alex','Alex',array['prepare']),('morgan','Morgan',array['review']),('sam','Sam',array['admin','assist','followup','receive_documents'])) x(key,name,caps) loop
  select * into v_existing from public.people where workspace_id=p_workspace_id and person_key=v_person.key;
  if found then
   if v_existing.name<>v_person.name or v_existing.capabilities<>v_person.caps or v_existing.user_id is not null then -- 038
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
   v_id=v_existing.id;
  else
   if not v_new then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
   insert into public.people(workspace_id,person_key,name,capabilities) values(p_workspace_id,v_person.key,v_person.name,v_person.caps) returning id into v_id;
  end if;
  v_people=v_people||jsonb_build_object(v_person.key,v_id);
 end loop;
 select default_followup_person_id into v_default from public.workspaces where id=p_workspace_id;
 if not v_new and not exists(select 1 from public.people p where p.workspace_id=p_workspace_id and p.id=v_default and 'followup'=any(p.capabilities)) then -- 038
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 for v_member in select u as id,'presenter' as access from unnest(p_presenters) u union all select u,'applicant' from unnest(p_applicants) u loop
  if exists(select 1 from public.memberships where user_id=v_member.id and active and workspace_id<>p_workspace_id) then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
  if exists(select 1 from public.memberships where user_id=v_member.id and workspace_id=p_workspace_id and (access<>v_member.access or not active)) then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
  insert into public.memberships(workspace_id,user_id,access) values(p_workspace_id,v_member.id,v_member.access) on conflict do nothing;
 end loop;
 if v_new then -- 038
  update public.workspaces set default_followup_person_id=(v_people->>'sam')::uuid where id=p_workspace_id;
 end if; -- 038
 return jsonb_build_object('workspaceId',p_workspace_id,'people',v_people);
end;
$$;
revoke all on function vitally_private.initialize_workspace(uuid,uuid[],uuid[]) from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- 3. The index and constraints that depend on the dropped columns. The two
-- origin checks are recreated in step 5.

drop index public.cases_one_fixture_key;
alter table public.cases drop constraint cases_fixture_key;
alter table public.cases drop constraint cases_origin_owner;
alter table public.cases drop constraint cases_origin_check;
alter table public.workspaces drop constraint workspaces_fixture_generation_check;

-- ---------------------------------------------------------------------------
-- 4. The sample functions, each by its full signature, then the bindings table
-- and the columns. Each column's own default goes with it.

drop function public.vitally_reset_fixtures(uuid);
drop function public.vitally_load_checkpoint(uuid,uuid,bigint,text);
drop function vitally_private.seed_fixtures(uuid,bigint);
drop function vitally_private.apply_fixture_scenario(public.cases,text,uuid);
drop function vitally_private.checkpoint_scenario(text);
drop function vitally_private.fixture_keys();
drop function vitally_private.fixture_answers_v2(text);
drop function vitally_private.fixture_contact_v2(text);
drop function vitally_private.fixture_history(text);
drop function vitally_private.new_reference();
drop function vitally_private.backfill_client_numbers(uuid);
drop function vitally_private.version_one_blockers();
drop function vitally_private.version_one_blocks(smallint,boolean,boolean);
drop function vitally_private.version_one_disposable(smallint,boolean,boolean);

drop table vitally_private.fixture_client_bindings;

alter table public.cases drop column fixture;
alter table public.cases drop column fixture_key;
alter table public.assistance_items drop column fixture;
alter table public.workspaces drop column fixture_generation;
alter table public.action_receipts drop column generation;

-- ---------------------------------------------------------------------------
-- 5. The origin checks, without 'fixture'. The client and assisted branches of
-- cases_origin_owner are as in 001.

alter table public.cases add constraint cases_origin_check check(origin in ('client','assisted'));
alter table public.cases add constraint cases_origin_owner check((origin='client' and owner_user_id is not null and created_by_person_id is null) or (origin='assisted' and owner_user_id is null and created_by_person_id is not null));

revoke all on all functions in schema vitally_private from public,anon,authenticated,service_role;
