-- 042: anyone holding `followup` works any open office follow-up, and
-- `followup` requires `admin` (OpenSpec change
-- let-follow-up-holders-work-any-follow-up, design D1, D2 and D6; issue #172).
--
--   * `lock_open_followup` (004, its only definition) no longer checks the
--     assignee: the assignee is a label. A task that doesn't exist here, or
--     belongs to another case, is still FORBIDDEN; a task that isn't open is
--     INVALID_TRANSITION, whoever asks. Its callers, act_resolve_followup (041)
--     and vitally_log_contact (038), check `followup` before calling it and
--     are unchanged; `p_person` stays in the signature for them.
--   * `add_staff_member` (038, its latest definition) also refuses capabilities
--     with `followup` and no `admin`. The one changed line ends `-- 042`.
--   * The check `people_followup_needs_admin` refuses any person with
--     `followup` and no `admin`, whoever writes the row.
--
-- #136 (remove-presenter-access) also numbers its migration 042 and also
-- redefines add_staff_member: whichever change merges second renumbers its
-- migration and copies add_staff_member from the latest migration that
-- defines it.
--
-- Written to be safe to apply again on a local test stack: `create or
-- replace`, and the check dropped if it exists before it is added.
--
-- If adding the check fails, a follow-up-only person exists, usually left in
-- a test workspace by an aborted test run. Find it with
--   select workspace_id, person_key, capabilities from public.people
--    where 'followup'=any(capabilities) and not 'admin'=any(capabilities);
-- then give that person `admin` or remove its test workspace, and run the
-- migrator again.

-- ---------------------------------------------------------------------------
-- 1. The lock: the task exists on this case and is open.

create or replace function vitally_private.lock_open_followup(p_case public.cases,p_person public.people,p_payload jsonb)
returns public.admin_followups language plpgsql security definer set search_path='' as $$
declare v_followup public.admin_followups;
begin
 select * into v_followup from public.admin_followups
  where workspace_id=p_case.workspace_id and case_id=p_case.id
   and id=vitally_private.payload_uuid(p_payload,'followupId') for update;
 if not found then -- 042
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 if v_followup.status is distinct from 'open' then
  raise sqlstate 'VT004' using message='INVALID_TRANSITION';
 end if;
 return v_followup;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. add_staff_member, from 038.

create or replace function vitally_private.add_staff_member(p_workspace_id uuid,p_user_id uuid,p_person_key text,p_name text,p_capabilities text[])
returns uuid language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_has_member boolean;
 v_person_id uuid;
begin
 if p_workspace_id is null or p_user_id is null or p_person_key is null or p_name is null or p_capabilities is null
  or p_person_key in ('alex','morgan','sam') or p_person_key !~ '^[a-z][a-z0-9_]{0,39}$'
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
 -- this staff member.
 if exists(select 1 from public.people p where p.workspace_id=p_workspace_id
  and (p.person_key=p_person_key or p.user_id=p_user_id)
  and not (p.person_key=p_person_key and p.user_id is not distinct from p_user_id and p.name=p_name
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
 insert into public.memberships(workspace_id,user_id,access) values(p_workspace_id,p_user_id,'staff');
 insert into public.people(workspace_id,person_key,name,capabilities,user_id)
  values(p_workspace_id,p_person_key,p_name,p_capabilities,p_user_id) returning id into v_person_id;
 return v_person_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Follow-up access needs admin, whoever writes the person.

alter table public.people drop constraint if exists people_followup_needs_admin;
alter table public.people add constraint people_followup_needs_admin
 check (not ('followup'=any(capabilities)) or 'admin'=any(capabilities));

revoke all on all functions in schema vitally_private from public,anon,authenticated,service_role;
