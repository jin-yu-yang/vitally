-- 045: volunteer clearance (OpenSpec change add-volunteer-clearance, design
-- D1-D2).
--
-- Part 1: a role exists only once its certificates are confirmed. In order:
--   §1 find every current-season roster entry with a role its confirmed
--      certificates don't support; refuse with VT008, changing nothing, if
--      any belongs to a person with a sign-in; otherwise strip those roles;
--   then the photo ID columns on roster_entries, the role helpers, and the
--   deferred constraint trigger that refuses an unsupported role at commit.
-- The migration runs in one transaction.

-- ---------------------------------------------------------------------------
-- §1. The guard and the strip. The helpers below don't exist yet, so the needs
-- are written out inline: every role needs VSC; every role but Greeter needs
-- IT&QR; Preparer and Reviewer need Basic or Advanced. Certificates and every
-- other field of the entry are kept, and no work is unassigned.

-- 045 §1 begin
drop table if exists vitally_045_unsupported;
create temporary table vitally_045_unsupported on commit drop as
 select r.workspace_id,r.person_id,r.season,p.user_id is not null as signed_in,k.kept
  from public.roster_entries r
  join public.workspaces w on w.id=r.workspace_id and w.current_season=r.season
  join public.people p on p.workspace_id=r.workspace_id and p.id=r.person_id
  cross join lateral (
   select coalesce(array_agg(c.certificate),'{}'::text[]) as held from public.certificates c
    where c.workspace_id=r.workspace_id and c.person_id=r.person_id and c.season=r.season and c.status='confirmed'
  ) h
  cross join lateral (
   select array(select u.role from unnest(r.roles) with ordinality u(role,ord)
    where 'vsc'=any(h.held)
     and (u.role='greeter' or 'itqr'=any(h.held))
     and (u.role not in ('preparer','reviewer') or 'basic'=any(h.held) or 'advanced'=any(h.held))
    order by u.ord) as kept
  ) k
  where cardinality(k.kept)<cardinality(r.roles);

do $$
declare v_count bigint;
begin
 select count(*) into v_count from vitally_045_unsupported where signed_in;
 if v_count>0 then
  raise exception using errcode='VT008',
   message='045 refused: people with a sign-in hold roles their certificates don''t support ('||v_count||')',
   detail=v_count::text;
 end if;
end;
$$;

update public.roster_entries r set roles=u.kept
 from vitally_045_unsupported u
 where r.workspace_id=u.workspace_id and r.person_id=u.person_id and r.season=u.season;
-- 045 §1 end

-- ---------------------------------------------------------------------------
-- The photo ID check. Every existing entry is not new, with no check recorded.

alter table public.roster_entries
 add column is_new boolean not null default false,
 add column photo_id_checked_at timestamptz;

-- ---------------------------------------------------------------------------
-- The role helpers (design D2). None is reachable by a client.

-- The person's confirmed certificates for one season, sorted.
create function vitally_private.confirmed_certificates(p_workspace_id uuid,p_person_id uuid,p_season smallint)
returns text[] language sql stable security definer set search_path='' as $$
 select array(select c.certificate from public.certificates c
  where c.workspace_id=p_workspace_id and c.person_id=p_person_id and c.season=p_season and c.status='confirmed'
  order by c.certificate collate "C");
$$;

-- What a role lacks, as labels in the order VSC, IT&QR, Basic or Advanced;
-- empty when its needs are met. Greeter needs VSC; Intaker and Admin need VSC
-- and IT&QR; Preparer and Reviewer need VSC, IT&QR and Basic or Advanced.
create function vitally_private.missing_certificates(p_role text,p_certificates text[])
returns text[] language sql immutable security definer set search_path='' as $$
 select array(select n.label from (values
   (1,'VSC',not ('vsc'=any(coalesce(p_certificates,'{}'::text[])))),
   (2,'IT&QR',p_role<>'greeter' and not ('itqr'=any(coalesce(p_certificates,'{}'::text[])))),
   (3,'Basic or Advanced',p_role in ('preparer','reviewer')
     and not ('basic'=any(coalesce(p_certificates,'{}'::text[])) or 'advanced'=any(coalesce(p_certificates,'{}'::text[]))))
  ) n(ord,label,missing) where n.missing order by n.ord);
$$;

-- The capabilities the roles give, distinct and sorted.
create function vitally_private.role_capabilities(p_roles text[])
returns text[] language sql immutable security definer set search_path='' as $$
 select array(select distinct c.capability collate "C" from unnest(coalesce(p_roles,'{}'::text[])) r(role)
  cross join lateral unnest(case r.role
    when 'intaker' then array['receive_documents','assist']
    when 'preparer' then array['prepare']
    when 'reviewer' then array['prepare','review']
    when 'admin' then array['admin','followup','assist','receive_documents']
    else '{}'::text[] end) c(capability)
  order by 1);
$$;

-- The current season's role capabilities within the person's
-- people.capabilities (the roster ceiling); empty with no current-season entry.
create function vitally_private.effective_capabilities(p_workspace_id uuid,p_person_id uuid)
returns text[] language sql stable security definer set search_path='' as $$
 select coalesce((
  select array(select c from unnest(vitally_private.role_capabilities(r.roles)) c
    where c=any(p.capabilities) order by c collate "C")
   from public.workspaces w
   join public.roster_entries r on r.workspace_id=w.id and r.season=w.current_season
   join public.people p on p.workspace_id=r.workspace_id and p.id=r.person_id
   where w.id=p_workspace_id and r.person_id=p_person_id),'{}'::text[]);
$$;

-- Cleared: the current season's entry has a role, and is not new or has its
-- photo ID check recorded. A role exists only with its certificates, so the
-- certificates need no second look here.
create function vitally_private.cleared(p_workspace_id uuid,p_person_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((
  select cardinality(r.roles)>0 and (not r.is_new or r.photo_id_checked_at is not null)
   from public.workspaces w
   join public.roster_entries r on r.workspace_id=w.id and r.season=w.current_season
   where w.id=p_workspace_id and r.person_id=p_person_id),false);
$$;

revoke all on function vitally_private.confirmed_certificates(uuid,uuid,smallint) from public,anon,authenticated,service_role;
revoke all on function vitally_private.missing_certificates(text,text[]) from public,anon,authenticated,service_role;
revoke all on function vitally_private.role_capabilities(text[]) from public,anon,authenticated,service_role;
revoke all on function vitally_private.effective_capabilities(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function vitally_private.cleared(uuid,uuid) from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- The role check (design D1). Deferred to commit, so one transaction may write
-- roles and certificates in either order. It checks the entry of the changed
-- row (OLD for a delete, and also OLD for an update that moves a certificate),
-- in any season. It locks that entry's row first (see below).

create function vitally_private.role_certificates_check()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_keys record;
 v_roles text[];
 v_held text[];
 v_role text;
 v_missing text[];
begin
 for v_keys in
  select k.workspace_id,k.person_id,k.season from (
   select new.workspace_id,new.person_id,new.season where tg_op<>'DELETE'
   union
   select old.workspace_id,old.person_id,old.season where tg_op<>'INSERT'
  ) k(workspace_id,person_id,season)
 loop
  -- The entry's row lock serialises concurrent checks of one entry: without
  -- it, a role added in one transaction and a needed certificate deleted in
  -- another could each pass a check that can't see the other, and both commit.
  -- A transaction that waits here reads the other's committed roles, and its
  -- next statement reads the other's committed certificates.
  select r.roles into v_roles from public.roster_entries r
   where r.workspace_id=v_keys.workspace_id and r.person_id=v_keys.person_id and r.season=v_keys.season
   for update;
  continue when v_roles is null or cardinality(v_roles)=0;
  v_held=vitally_private.confirmed_certificates(v_keys.workspace_id,v_keys.person_id,v_keys.season);
  foreach v_role in array v_roles loop
   v_missing=vitally_private.missing_certificates(v_role,v_held);
   if cardinality(v_missing)>0 then
    raise sqlstate 'VT007' using message='ROLE_NEEDS',detail=v_role||': '||array_to_string(v_missing,', ');
   end if;
  end loop;
 end loop;
 return null;
end;
$$;
revoke all on function vitally_private.role_certificates_check() from public,anon,authenticated,service_role;

create constraint trigger roster_entries_role_certificates
 after insert or update on public.roster_entries
 deferrable initially deferred for each row
 execute function vitally_private.role_certificates_check();
create constraint trigger certificates_role_certificates
 after insert or update or delete on public.certificates
 deferrable initially deferred for each row
 execute function vitally_private.role_certificates_check();

-- ---------------------------------------------------------------------------
-- Part 2: the read gate (design D3). Only a cleared staff member reads case
-- data. The helper takes no argument and answers only for the caller; each
-- policy calls it as an uncorrelated subquery, so it is planned as an InitPlan
-- and runs once per statement, including each realtime change check.

-- The workspace of the caller's active staff membership when the caller's
-- person is cleared for its current season; otherwise null. One account has
-- one active membership (memberships_one_active_workspace).
create function vitally_policy.cleared_workspace_id()
returns uuid language sql stable security definer set search_path='' as $$
 select m.workspace_id from public.memberships m
  join public.people p on p.workspace_id=m.workspace_id and p.user_id=m.user_id
  where m.user_id=(select auth.uid()) and m.active and m.access='staff'
   and vitally_private.cleared(m.workspace_id,p.id);
$$;
revoke all on function vitally_policy.cleared_workspace_id() from public,anon,authenticated,service_role;
grant execute on function vitally_policy.cleared_workspace_id() to authenticated;

-- The 21 case-data policies, each from its 043 §7 definition under its current
-- name, with `and <table>.workspace_id=(select vitally_policy.cleared_workspace_id())`
-- added to the staff branch only. The client branches are unchanged, and
-- `people` (044) is not gated, so an uncleared staff member still reads the
-- staff names.
alter policy visible_cases on public.cases using(exists(select 1 from public.memberships m where m.workspace_id=cases.workspace_id and m.user_id=(select auth.uid()) and m.active and ((m.access='applicant' and cases.owner_user_id=m.user_id) or (m.access='staff' and (cases.origin<>'client' or cases.stage<>'draft') and cases.workspace_id=(select vitally_policy.cleared_workspace_id())))));
alter policy visible_document_requests on public.document_requests using(exists(select 1 from public.memberships m join public.cases c on c.workspace_id=m.workspace_id and c.id=document_requests.case_id where m.workspace_id=document_requests.workspace_id and m.user_id=(select auth.uid()) and m.active and ((m.access='applicant' and c.owner_user_id=m.user_id) or (m.access='staff' and (c.origin<>'client' or c.stage<>'draft') and document_requests.workspace_id=(select vitally_policy.cleared_workspace_id())))));
alter policy visible_documents on public.documents using(exists(select 1 from public.memberships m join public.cases c on c.workspace_id=m.workspace_id and c.id=documents.case_id where m.workspace_id=documents.workspace_id and m.user_id=(select auth.uid()) and m.active and ((m.access='applicant' and c.owner_user_id=m.user_id) or (m.access='staff' and (c.origin<>'client' or c.stage<>'draft') and documents.workspace_id=(select vitally_policy.cleared_workspace_id())))));
alter policy visible_client_events on public.client_events using(exists(select 1 from public.memberships m join public.cases c on c.workspace_id=m.workspace_id and c.id=client_events.case_id where m.workspace_id=client_events.workspace_id and m.user_id=(select auth.uid()) and m.active and ((m.access='applicant' and c.owner_user_id=m.user_id) or (m.access='staff' and (c.origin<>'client' or c.stage<>'draft') and client_events.workspace_id=(select vitally_policy.cleared_workspace_id())))));
alter policy staff_preparation_participants on public.preparation_participants using(exists(select 1 from public.memberships m join public.cases c on c.workspace_id=m.workspace_id and c.id=preparation_participants.case_id where m.workspace_id=preparation_participants.workspace_id and m.user_id=(select auth.uid()) and m.active and m.access='staff' and (c.origin<>'client' or c.stage<>'draft') and preparation_participants.workspace_id=(select vitally_policy.cleared_workspace_id())));
alter policy staff_admin_followups on public.admin_followups using(exists(select 1 from public.memberships m join public.cases c on c.workspace_id=m.workspace_id and c.id=admin_followups.case_id where m.workspace_id=admin_followups.workspace_id and m.user_id=(select auth.uid()) and m.active and m.access='staff' and (c.origin<>'client' or c.stage<>'draft') and admin_followups.workspace_id=(select vitally_policy.cleared_workspace_id())));
alter policy staff_contact_attempts on public.contact_attempts using(exists(select 1 from public.memberships m join public.cases c on c.workspace_id=m.workspace_id and c.id=contact_attempts.case_id where m.workspace_id=contact_attempts.workspace_id and m.user_id=(select auth.uid()) and m.active and m.access='staff' and (c.origin<>'client' or c.stage<>'draft') and contact_attempts.workspace_id=(select vitally_policy.cleared_workspace_id())));
alter policy staff_case_events on public.case_events using(exists(select 1 from public.memberships m join public.cases c on c.workspace_id=m.workspace_id and c.id=case_events.case_id where m.workspace_id=case_events.workspace_id and m.user_id=(select auth.uid()) and m.active and m.access='staff' and (c.origin<>'client' or c.stage<>'draft') and case_events.workspace_id=(select vitally_policy.cleared_workspace_id())));
alter policy staff_assistance_items on public.assistance_items using(exists(select 1 from public.memberships m where m.workspace_id=assistance_items.workspace_id and m.user_id=(select auth.uid()) and m.active and m.access='staff' and assistance_items.workspace_id=(select vitally_policy.cleared_workspace_id())) and (assistance_items.case_id is null or exists(select 1 from public.cases c where c.workspace_id=assistance_items.workspace_id and c.id=assistance_items.case_id and (c.origin<>'client' or c.stage<>'draft'))));
alter policy staff_reviews on public.reviews using(exists(select 1 from public.memberships m join public.cases c on c.workspace_id=m.workspace_id and c.id=reviews.case_id where m.workspace_id=reviews.workspace_id and m.user_id=(select auth.uid()) and m.active and m.access='staff' and (c.origin<>'client' or c.stage<>'draft') and reviews.workspace_id=(select vitally_policy.cleared_workspace_id())));
alter policy visible_case_contacts on public.case_contacts using(exists(select 1 from public.memberships m join public.cases c on c.workspace_id=m.workspace_id and c.id=case_contacts.case_id where m.workspace_id=case_contacts.workspace_id and m.user_id=(select auth.uid()) and m.active and ((m.access='applicant' and c.owner_user_id=m.user_id) or (m.access='staff' and (c.origin<>'client' or c.stage<>'draft') and case_contacts.workspace_id=(select vitally_policy.cleared_workspace_id())))));
alter policy staff_case_materials on public.case_materials using(exists(select 1 from public.memberships m join public.cases c on c.workspace_id=m.workspace_id and c.id=case_materials.case_id where m.workspace_id=case_materials.workspace_id and m.user_id=(select auth.uid()) and m.active and m.access='staff' and (c.origin<>'client' or c.stage<>'draft') and case_materials.workspace_id=(select vitally_policy.cleared_workspace_id())));
alter policy visible_case_document_cards on public.case_document_cards using(exists(select 1 from public.memberships m join public.cases c on c.workspace_id=m.workspace_id and c.id=case_document_cards.case_id where m.workspace_id=case_document_cards.workspace_id and m.user_id=(select auth.uid()) and m.active and ((m.access='applicant' and c.owner_user_id=m.user_id) or (m.access='staff' and (c.origin<>'client' or c.stage<>'draft') and case_document_cards.workspace_id=(select vitally_policy.cleared_workspace_id())))));
alter policy staff_contact_log on public.contact_log using(exists(select 1 from public.memberships m join public.cases c on c.workspace_id=m.workspace_id and c.id=contact_log.case_id where m.workspace_id=contact_log.workspace_id and m.user_id=(select auth.uid()) and m.active and m.access='staff' and (c.origin<>'client' or c.stage<>'draft') and contact_log.workspace_id=(select vitally_policy.cleared_workspace_id())));
alter policy staff_contact_log_versions on public.contact_log_versions using(exists(select 1 from public.memberships m join public.cases c on c.workspace_id=m.workspace_id and c.id=contact_log_versions.case_id where m.workspace_id=contact_log_versions.workspace_id and m.user_id=(select auth.uid()) and m.active and m.access='staff' and (c.origin<>'client' or c.stage<>'draft') and contact_log_versions.workspace_id=(select vitally_policy.cleared_workspace_id())));
alter policy staff_preparer_questionnaires on public.preparer_questionnaires using(exists(select 1 from public.memberships m join public.cases c on c.workspace_id=m.workspace_id and c.id=preparer_questionnaires.case_id where m.workspace_id=preparer_questionnaires.workspace_id and m.user_id=(select auth.uid()) and m.active and m.access='staff' and (c.origin<>'client' or c.stage<>'draft') and preparer_questionnaires.workspace_id=(select vitally_policy.cleared_workspace_id())));
alter policy staff_reviewer_questionnaires on public.reviewer_questionnaires using(exists(select 1 from public.memberships m join public.cases c on c.workspace_id=m.workspace_id and c.id=reviewer_questionnaires.case_id where m.workspace_id=reviewer_questionnaires.workspace_id and m.user_id=(select auth.uid()) and m.active and m.access='staff' and (c.origin<>'client' or c.stage<>'draft') and reviewer_questionnaires.workspace_id=(select vitally_policy.cleared_workspace_id())));
alter policy staff_filing_attempts on public.filing_attempts using(exists(select 1 from public.memberships m join public.cases c on c.workspace_id=m.workspace_id and c.id=filing_attempts.case_id where m.workspace_id=filing_attempts.workspace_id and m.user_id=(select auth.uid()) and m.active and m.access='staff' and (c.origin<>'client' or c.stage<>'draft') and filing_attempts.workspace_id=(select vitally_policy.cleared_workspace_id())));
alter policy staff_filing_returns on public.filing_returns using(exists(select 1 from public.memberships m join public.cases c on c.workspace_id=m.workspace_id and c.id=filing_returns.case_id where m.workspace_id=filing_returns.workspace_id and m.user_id=(select auth.uid()) and m.active and m.access='staff' and (c.origin<>'client' or c.stage<>'draft') and filing_returns.workspace_id=(select vitally_policy.cleared_workspace_id())));
alter policy staff_filing_notes on public.filing_notes using(exists(select 1 from public.memberships m join public.cases c on c.workspace_id=m.workspace_id and c.id=filing_notes.case_id where m.workspace_id=filing_notes.workspace_id and m.user_id=(select auth.uid()) and m.active and m.access='staff' and (c.origin<>'client' or c.stage<>'draft') and filing_notes.workspace_id=(select vitally_policy.cleared_workspace_id())));
alter policy staff_preparer_shaded_fields on public.preparer_shaded_fields using(exists(select 1 from public.memberships m join public.cases c on c.workspace_id=m.workspace_id and c.id=preparer_shaded_fields.case_id where m.workspace_id=preparer_shaded_fields.workspace_id and m.user_id=(select auth.uid()) and m.active and m.access='staff' and (c.origin<>'client' or c.stage<>'draft') and preparer_shaded_fields.workspace_id=(select vitally_policy.cleared_workspace_id())));

-- ---------------------------------------------------------------------------
-- Part 3: the action gate (design D4). A staff caller acts with their
-- effective capabilities, and the six case RPCs refuse an uncleared staff
-- member with NOT_CLEARED (VT009) right after resolving the caller, before any
-- lookup, digest or receipt, so the refusal says nothing about which ids
-- exist and a replay is refused too. A client is not checked.
-- vitally_save_volunteer is not gated, and its admin check stays on the
-- ceiling. Checks of another person's capability (the follow-up assignee,
-- the default follow-up person) keep reading people.capabilities.

-- VT009 for a staff member whose linked person is not cleared; nothing for a
-- client.
create function vitally_private.require_cleared(p_member public.memberships)
returns void language plpgsql stable security definer set search_path='' as $$
begin
 if p_member.access='staff' and not exists(select 1 from public.people p
   where p.workspace_id=p_member.workspace_id and p.user_id=p_member.user_id
    and vitally_private.cleared(p.workspace_id,p.id)) then
  raise sqlstate 'VT009' using message='NOT_CLEARED';
 end if;
end;
$$;
revoke all on function vitally_private.require_cleared(public.memberships) from public,anon,authenticated,service_role;

-- The caller's person, from its definition at 043 (acting_person,
-- check_operation_authority, contact_person), with `capabilities` replaced by
-- the effective capabilities. acting_person still refuses nobody it did not
-- refuse before. CREATE OR REPLACE keeps each signature and its grants.
create or replace function vitally_private.acting_person(p_member public.memberships)
returns public.people language plpgsql stable security definer set search_path='' as $$
declare v_person public.people;
begin
 if p_member.access='staff' then
  select * into v_person from public.people
   where workspace_id=p_member.workspace_id and user_id=p_member.user_id;
  if not found then
   raise sqlstate 'VT001' using message='FORBIDDEN';
  end if;
  v_person.capabilities=vitally_private.effective_capabilities(p_member.workspace_id,v_person.id);
 elsif p_member.access='applicant' then
  null;
 else
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 return v_person;
end;
$$;
revoke all on function vitally_private.acting_person(public.memberships) from public,anon,authenticated,service_role;

create or replace function vitally_private.check_operation_authority(p_member public.memberships,p_person_id uuid,p_type text)
returns public.people language plpgsql security definer set search_path='' as $$
declare v_person public.people;
begin
 -- Client actions carry no staff person; a staff member's person must exist in this workspace.
 if p_person_id is not null then
  if p_member.access<>'staff' then
   raise sqlstate 'VT001' using message='FORBIDDEN';
  end if;
  select * into v_person from public.people where workspace_id=p_member.workspace_id and id=p_person_id;
  if not found then
   raise sqlstate 'VT001' using message='FORBIDDEN';
  end if;
  v_person.capabilities=vitally_private.effective_capabilities(p_member.workspace_id,v_person.id);
 end if;
 case p_type
  when 'SAVE_ANSWERS','SUBMIT' then
   -- Client-permitted: an applicant answers for themselves, or a staff member
   -- with `admin` assists.
   if p_person_id is null then
    if p_member.access<>'applicant' then
     raise sqlstate 'VT001' using message='FORBIDDEN';
    end if;
   elsif not ('admin'=any(v_person.capabilities)) then
    raise sqlstate 'VT001' using message='FORBIDDEN';
   end if;
  when 'VERIFY_INTAKE','REMIND','CLOSE_CASE','START_SCREENING','MARK_READY_TO_EFILE','MARK_EFILED','RECORD_FILING_RESULT','RETURN_TO_SIGNING','REQUEST_DOCUMENTS_AT_INTAKE','PUT_ON_HOLD','RESUME_FROM_HOLD' then -- 036
   if p_person_id is null or not ('admin'=any(v_person.capabilities)) then
    raise sqlstate 'VT001' using message='FORBIDDEN';
   end if;
  when 'CLAIM_PREPARATION','REQUEST_DOCUMENT','VERIFY_DOCUMENT','ESCALATE_CONTACT',
       'SUBMIT_REVIEW','RESUBMIT_REVIEW','CLAIM_REVIEW','REQUEST_CORRECTIONS',
       'APPROVE_REVIEW','RECORD_REVIEW_CONTACT','SAVE_PREPARER_FIELDS' then -- 039
   if p_person_id is null then
    raise sqlstate 'VT001' using message='FORBIDDEN';
   end if;
  when 'RESPOND_DOCUMENT','WITHDRAW' then -- 036
   -- The client answers or withdraws for themselves: no staff person at all.
   if p_person_id is not null or p_member.access<>'applicant' then
    raise sqlstate 'VT001' using message='FORBIDDEN';
   end if;
  when 'RECORD_DOCUMENT_RESPONSE' then
   if p_person_id is null or not ('receive_documents'=any(v_person.capabilities)) then
    raise sqlstate 'VT001' using message='FORBIDDEN';
   end if;
  when 'RECORD_CONTACT','RESOLVE_FOLLOWUP' then
   if p_person_id is null or not ('followup'=any(v_person.capabilities)) then
    raise sqlstate 'VT001' using message='FORBIDDEN';
   end if;
  when 'UPDATE_CONTACT' then
   -- The client for themselves, or a selected staff person. Which staff person
   -- may depends on the case, so that half is check_authority's.
   if p_person_id is null and p_member.access<>'applicant' then
    raise sqlstate 'VT001' using message='FORBIDDEN';
   end if;
  when 'RECORD_MATERIALS' then
   -- Staff only; which staff person may depends on the case (check_authority).
   if p_person_id is null then
    raise sqlstate 'VT001' using message='FORBIDDEN';
   end if;
  when 'SET_DOCUMENT_CARD' then
   -- The client for themselves, or a selected staff person; which staff person
   -- may depends on the case, so that half is check_authority's.
   if p_person_id is null and p_member.access<>'applicant' then
    raise sqlstate 'VT001' using message='FORBIDDEN';
   end if;
  when 'SET_DOCUMENT_GROUP' then
   -- Staff only; which staff person may depends on the case (check_authority).
   if p_person_id is null then
    raise sqlstate 'VT001' using message='FORBIDDEN';
   end if;
  when 'ASSISTANCE:CLAIM','ASSISTANCE:RESOLVE' then
   -- Helping a client with their own forms is its own capability; holding it
   -- is still not holding the item, which is a step-7 rule on the target.
   if p_person_id is null or not ('assist'=any(v_person.capabilities)) then
    raise sqlstate 'VT001' using message='FORBIDDEN';
   end if;
  -- Unknown or not-yet-implemented actions never reach a handler.
  else raise sqlstate 'VT007' using message='VALIDATION';
 end case;
 return v_person;
end;
$$;

create or replace function vitally_private.contact_person(p_member public.memberships,p_person_id uuid)
returns public.people language plpgsql stable security definer set search_path='' as $$
declare v_person public.people;
begin
 if p_member.access<>'staff' or p_person_id is null then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 select * into v_person from public.people where workspace_id=p_member.workspace_id and id=p_person_id;
 if not found then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 v_person.capabilities=vitally_private.effective_capabilities(p_member.workspace_id,v_person.id);
 return v_person;
end;
$$;

revoke all on function vitally_private.check_operation_authority(public.memberships,uuid,text) from public,anon,authenticated,service_role;
revoke all on function vitally_private.contact_person(public.memberships,uuid) from public,anon,authenticated,service_role;

-- The six RPCs, each from its definition at 043 with `require_cleared` right
-- after `acting_person`. vitally_create_case's assisted branch reads `admin`
-- from the acting person instead of re-reading people.capabilities.
create or replace function public.vitally_apply_action(p_action_id uuid,p_case_id uuid,p_expected_revision bigint,p_type text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_receipt public.action_receipts;
 v_case public.cases;
 v_person public.people;
 v_outcome jsonb;
 v_digest text;
begin
 v_member=vitally_private.require_membership();
 v_person=vitally_private.acting_person(v_member);
 perform vitally_private.require_cleared(v_member);
 -- A malformed envelope cannot be digested or reserved; payload contents are
 -- still whitelisted at step 5, after the target and authority checks.
 if p_action_id is null or p_case_id is null or p_expected_revision is null or p_type is null
  or p_payload is null or jsonb_typeof(p_payload)<>'object' then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 v_digest=encode(extensions.digest(jsonb_build_object('operation',p_type,'caseId',p_case_id,'expectedRevision',p_expected_revision,'personId',v_person.id,'payload',p_payload)::text,'sha256'),'hex');
 v_receipt=vitally_private.reserve_receipt(v_member,p_action_id,p_type,v_digest,v_person.id);
 -- An identical accepted replay returns its receipt after the current membership
 -- and operation-authority checks, without repeating the mutation and without
 -- reaching the target, which may since have been deleted.
 if v_receipt.receipt is not null then
  perform vitally_private.check_operation_authority(v_member,v_person.id,p_type);
  return v_receipt.receipt;
 end if;
 v_case=vitally_private.lock_case(v_member,p_case_id);
 v_person=vitally_private.check_authority(v_member,v_case,v_person.id,p_type);
 if v_case.revision<>p_expected_revision then
  raise sqlstate 'VT003' using message='CONFLICT';
 end if;
 perform vitally_private.check_payload(p_type,p_payload);
 perform vitally_private.check_related(v_case,p_type,p_payload);
 case p_type
  when 'SAVE_ANSWERS' then v_outcome=vitally_private.act_save_answers(v_member,v_case,v_person,p_payload);
  when 'SUBMIT' then v_outcome=vitally_private.act_submit(v_member,v_case,v_person,p_payload);
  when 'VERIFY_INTAKE' then v_outcome=vitally_private.act_verify_intake(v_member,v_case,v_person,p_payload);
  when 'CLAIM_PREPARATION' then v_outcome=vitally_private.act_claim_preparation(v_member,v_case,v_person,p_payload);
  when 'REQUEST_DOCUMENT' then v_outcome=vitally_private.act_request_document(v_member,v_case,v_person,p_payload);
  when 'RESPOND_DOCUMENT' then v_outcome=vitally_private.act_respond_document(v_member,v_case,v_person,p_payload);
  when 'RECORD_DOCUMENT_RESPONSE' then v_outcome=vitally_private.act_record_document_response(v_member,v_case,v_person,p_payload);
  when 'VERIFY_DOCUMENT' then v_outcome=vitally_private.act_verify_document(v_member,v_case,v_person,p_payload);
  when 'ESCALATE_CONTACT' then v_outcome=vitally_private.act_escalate_contact(v_member,v_case,v_person,p_payload);
  when 'RECORD_CONTACT' then v_outcome=vitally_private.act_record_contact(v_member,v_case,v_person,p_payload);
  when 'RESOLVE_FOLLOWUP' then v_outcome=vitally_private.act_resolve_followup(v_member,v_case,v_person,p_payload);
  when 'SUBMIT_REVIEW' then v_outcome=vitally_private.act_submit_review(v_member,v_case,v_person,p_payload);
  when 'CLAIM_REVIEW' then v_outcome=vitally_private.act_claim_review(v_member,v_case,v_person,p_payload);
  when 'REQUEST_CORRECTIONS' then v_outcome=vitally_private.act_request_corrections(v_member,v_case,v_person,p_payload);
  when 'RESUBMIT_REVIEW' then v_outcome=vitally_private.act_resubmit_review(v_member,v_case,v_person,p_payload);
  when 'APPROVE_REVIEW' then v_outcome=vitally_private.act_approve_review(v_member,v_case,v_person,p_payload);
  when 'RECORD_REVIEW_CONTACT' then v_outcome=vitally_private.act_record_review_contact(v_member,v_case,v_person,p_payload);
  when 'REMIND' then v_outcome=vitally_private.act_remind(v_member,v_case,v_person,p_payload);
  when 'CLOSE_CASE' then v_outcome=vitally_private.act_close_case(v_member,v_case,v_person,p_payload);
  when 'START_SCREENING' then v_outcome=vitally_private.act_start_screening(v_member,v_case,v_person,p_payload); -- 032
  when 'MARK_READY_TO_EFILE' then v_outcome=vitally_private.act_mark_ready_to_efile(v_member,v_case,v_person,p_payload); -- 032
  when 'MARK_EFILED' then v_outcome=vitally_private.act_mark_efiled(v_member,v_case,v_person,p_payload); -- 032
  when 'RECORD_FILING_RESULT' then v_outcome=vitally_private.act_record_filing_result(v_member,v_case,v_person,p_payload); -- 035
  when 'RETURN_TO_SIGNING' then v_outcome=vitally_private.act_return_to_signing(v_member,v_case,v_person,p_payload); -- 035
  when 'REQUEST_DOCUMENTS_AT_INTAKE' then v_outcome=vitally_private.act_request_documents_at_intake(v_member,v_case,v_person,p_payload); -- 036
  when 'PUT_ON_HOLD' then v_outcome=vitally_private.act_put_on_hold(v_member,v_case,v_person,p_payload); -- 036
  when 'RESUME_FROM_HOLD' then v_outcome=vitally_private.act_resume_from_hold(v_member,v_case,v_person,p_payload); -- 036
  when 'WITHDRAW' then v_outcome=vitally_private.act_withdraw(v_member,v_case,v_person,p_payload); -- 036
  when 'UPDATE_CONTACT' then v_outcome=vitally_private.act_update_contact(v_member,v_case,v_person,p_payload);
  when 'RECORD_MATERIALS' then v_outcome=vitally_private.act_record_materials(v_member,v_case,v_person,p_payload);
  when 'SET_DOCUMENT_CARD' then v_outcome=vitally_private.act_set_document_card(v_member,v_case,v_person,p_payload);
  when 'SET_DOCUMENT_GROUP' then v_outcome=vitally_private.act_set_document_group(v_member,v_case,v_person,p_payload);
  when 'SAVE_PREPARER_FIELDS' then v_outcome=vitally_private.act_save_preparer_fields(v_member,v_case,v_person,p_payload); -- 039
  else raise sqlstate 'VT007' using message='VALIDATION';
 end case;
 return vitally_private.commit_action(v_member,v_case,v_person,p_action_id,p_type,v_outcome,v_receipt);
end;
$$;
revoke all on function public.vitally_apply_action(uuid,uuid,bigint,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.vitally_apply_action(uuid,uuid,bigint,text,jsonb) to authenticated;

create or replace function public.vitally_assistance_action(p_action_id uuid,p_item_id uuid,p_expected_revision bigint,p_type text,p_note text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_receipt public.action_receipts;
 v_item public.assistance_items;
 v_person public.people;
 v_operation text;
 v_digest text;
 v_revision bigint;
begin
 v_member=vitally_private.require_membership();
 v_person=vitally_private.acting_person(v_member);
 perform vitally_private.require_cleared(v_member);
 -- A malformed envelope cannot be digested or reserved; the note is still
 -- checked at step 5, after the target and authority checks.
 if p_action_id is null or p_item_id is null or p_expected_revision is null or p_type is null then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 v_operation='ASSISTANCE:'||p_type;
 v_digest=encode(extensions.digest(jsonb_build_object('operation',v_operation,'itemId',p_item_id,'expectedRevision',p_expected_revision,'personId',v_person.id,'note',p_note)::text,'sha256'),'hex');
 v_receipt=vitally_private.reserve_receipt(v_member,p_action_id,v_operation,v_digest,v_person.id);
 -- An identical accepted replay returns its receipt after the current membership
 -- and operation-authority checks, without repeating the mutation and without
 -- reaching the target.
 if v_receipt.receipt is not null then
  perform vitally_private.check_operation_authority(v_member,v_person.id,v_operation);
  return v_receipt.receipt;
 end if;
 v_item=vitally_private.lock_assistance_item(v_member,p_item_id);
 v_person=vitally_private.check_operation_authority(v_member,v_person.id,v_operation);
 if v_item.revision<>p_expected_revision then
  raise sqlstate 'VT003' using message='CONFLICT';
 end if;
 perform vitally_private.check_assistance_note(p_type,p_note);
 case p_type
  when 'CLAIM' then v_revision=vitally_private.act_assistance_claim(v_item,v_person);
  when 'RESOLVE' then v_revision=vitally_private.act_assistance_resolve(v_item,v_person,p_note);
  else raise sqlstate 'VT007' using message='VALIDATION';
 end case;
 return vitally_private.commit_assistance(p_action_id,v_item,v_revision,v_receipt);
end;
$$;
revoke all on function public.vitally_assistance_action(uuid,uuid,bigint,text,text) from public,anon,authenticated,service_role;
grant execute on function public.vitally_assistance_action(uuid,uuid,bigint,text,text) to authenticated;

create or replace function public.vitally_close_unsigned(p_action_id uuid,p_cases jsonb,p_confirmed boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_person public.people;
 v_receipt public.action_receipts;
 v_case public.cases;
 v_item jsonb;
 v_ids uuid[]:='{}';
 v_id uuid;
 v_revisions jsonb:='{}'::jsonb;
 v_digest text;
 v_cases jsonb:='[]'::jsonb;
 v_revision bigint;
 v_result jsonb;
begin
 v_member=vitally_private.require_membership();
 v_person=vitally_private.acting_person(v_member);
 perform vitally_private.require_cleared(v_member);
 -- Admin only: a null person and a person without `admin` are FORBIDDEN.
 perform vitally_private.check_operation_authority(v_member,v_person.id,'CLOSE_CASE');
 if p_action_id is null or p_confirmed is not true or p_cases is null or jsonb_typeof(p_cases)<>'array'
  or jsonb_array_length(p_cases)=0 then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 for v_item in select value from jsonb_array_elements(p_cases) loop
  if jsonb_typeof(v_item)<>'object'
   or (select count(*) from jsonb_object_keys(v_item))<>2
   or not (v_item ? 'caseId') or not (v_item ? 'revision')
   or jsonb_typeof(v_item->'caseId')<>'string'
   or (v_item->>'caseId')!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
   or jsonb_typeof(v_item->'revision')<>'number'
   or (v_item->>'revision')::numeric<>trunc((v_item->>'revision')::numeric) then
   raise sqlstate 'VT007' using message='VALIDATION';
  end if;
  v_id=(v_item->>'caseId')::uuid;
  if v_id=any(v_ids) then
   raise sqlstate 'VT007' using message='VALIDATION';
  end if;
  v_ids=array_append(v_ids,v_id);
  v_revisions=v_revisions||jsonb_build_object(v_id::text,v_item->'revision');
 end loop;
 v_digest=encode(extensions.digest(jsonb_build_object('operation','CLOSE_UNSIGNED','cases',p_cases,
  'personId',v_person.id)::text,'sha256'),'hex');
 v_receipt=vitally_private.reserve_receipt(v_member,p_action_id,'CLOSE_UNSIGNED',v_digest,v_person.id);
 if v_receipt.receipt is not null then
  return v_receipt.receipt;
 end if;
 -- Lock in a fixed order so two closes cannot deadlock, and check every case
 -- before changing any.
 select array_agg(x order by x) into v_ids from unnest(v_ids) as x;
 foreach v_id in array v_ids loop
  v_case=vitally_private.lock_case(v_member,v_id);
  if v_case.revision<>(v_revisions->>(v_id::text))::numeric
   or not (v_case.stage='review_approved' or (v_case.stage='on_hold' and v_case.hold_origin='review_approved')) then
   raise sqlstate 'VT003' using message='CONFLICT';
  end if;
 end loop;
 foreach v_id in array v_ids loop
  select * into v_case from public.cases where id=v_id;
  perform vitally_private.close_case_steps(v_case,'dismissed');
  insert into public.case_events(workspace_id,case_id,actor_user_id,actor_person_id,action,detail)
  values(v_case.workspace_id,v_case.id,v_member.user_id,v_person.id,'CLOSE_CASE',
   jsonb_build_object('reason','dismissed','seasonEnd',true));
  insert into public.client_events(workspace_id,case_id,action,message)
  values(v_case.workspace_id,v_case.id,'CLOSE_CASE',vitally_private.closed_line('dismissed'));
  update public.cases set revision=revision+1,updated_at=now() where id=v_id returning revision into v_revision;
  v_cases=v_cases||jsonb_build_array(jsonb_build_object('caseId',v_id,'reference',v_case.reference,'revision',v_revision));
 end loop;
 v_result=jsonb_build_object('actionId',p_action_id,'cases',v_cases);
 update public.action_receipts set target_id=null,target_reference=null,receipt=v_result where id=v_receipt.id;
 return v_result;
end;
$$;
revoke all on function public.vitally_close_unsigned(uuid,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.vitally_close_unsigned(uuid,jsonb,boolean) to authenticated;

create or replace function public.vitally_create_case(p_action_id uuid,p_mode text,p_answers jsonb)
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
begin
 select * into v_member from public.memberships where user_id=v_user and active for share;
 if v_user is null or not found then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 v_person=vitally_private.acting_person(v_member);
 perform vitally_private.require_cleared(v_member);
 if p_mode='client' then
  if v_member.access<>'applicant' or v_person.id is not null then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
  v_owner=v_user;
 elsif p_mode='assisted' then
  if v_member.access<>'staff' then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
  if not ('admin'=any(v_person.capabilities)) then
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
revoke all on function public.vitally_create_case(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.vitally_create_case(uuid,text,jsonb) to authenticated;

create or replace function public.vitally_log_contact(p_action_id uuid,p_case_id uuid,p_followup_id uuid,p_entry jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_receipt public.action_receipts;
 v_case public.cases;
 v_person public.people;
 v_entry jsonb;
 v_digest text;
 v_id uuid;
 v_result jsonb;
begin
 v_member=vitally_private.require_membership();
 v_person=vitally_private.acting_person(v_member);
 perform vitally_private.require_cleared(v_member);
 if p_action_id is null or p_case_id is null or p_entry is null or jsonb_typeof(p_entry)<>'object' then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 -- Staff only: an applicant is refused before any target is read.
 if v_member.access<>'staff' or v_person.id is null then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 v_digest=encode(extensions.digest(jsonb_build_object('operation','LOG_CONTACT','caseId',p_case_id,'personId',v_person.id,
  'followupId',p_followup_id,'entry',p_entry)::text,'sha256'),'hex');
 v_receipt=vitally_private.reserve_receipt(v_member,p_action_id,'LOG_CONTACT',v_digest,v_person.id);
 -- An identical accepted replay returns its receipt after re-checking the
 -- staff member's person, without reaching the target.
 if v_receipt.receipt is not null then
  perform vitally_private.contact_person(v_member,v_person.id);
  return v_receipt.receipt;
 end if;
 v_case=vitally_private.lock_case(v_member,p_case_id);
 v_person=vitally_private.contact_person(v_member,v_person.id);
 -- A contact linked to a follow-up task keeps RECORD_CONTACT's rule: the
 -- task's assignee, holding `followup`, on an open task.
 if p_followup_id is not null then
  if not ('followup'=any(v_person.capabilities)) then
   raise sqlstate 'VT001' using message='FORBIDDEN';
  end if;
  perform vitally_private.lock_open_followup(v_case,v_person,jsonb_build_object('followupId',p_followup_id));
 end if;
 v_entry=vitally_private.check_contact_entry(p_entry);
 insert into public.contact_log(workspace_id,case_id,followup_id,logged_by_user_id,logged_by_person_id,
   direction,contacted_at,with_whom,other_name,method,purpose,outcome,note)
 values(v_case.workspace_id,v_case.id,p_followup_id,v_member.user_id,v_person.id,
   v_entry->>'direction',(v_entry->>'contactedAt')::timestamptz,v_entry->>'withWhom',v_entry->>'otherName',
   v_entry->>'method',v_entry->>'purpose',v_entry->>'outcome',v_entry->>'note')
 returning id into v_id;
 insert into public.contact_log_versions(contact_id,version,workspace_id,case_id,edited_by_user_id,edited_by_person_id,created_at,
   direction,contacted_at,with_whom,other_name,method,purpose,outcome,note)
 select l.id,1,l.workspace_id,l.case_id,l.logged_by_user_id,l.logged_by_person_id,l.logged_at,
   l.direction,l.contacted_at,l.with_whom,l.other_name,l.method,l.purpose,l.outcome,l.note
 from public.contact_log l where l.id=v_id;
 v_result=jsonb_build_object('actionId',p_action_id,'contactId',v_id,'caseId',v_case.id,'revision',1);
 update public.action_receipts set target_id=v_id,receipt=v_result where id=v_receipt.id;
 return v_result;
end;
$$;
revoke all on function public.vitally_log_contact(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.vitally_log_contact(uuid,uuid,uuid,jsonb) to authenticated;

create or replace function public.vitally_edit_contact(p_action_id uuid,p_contact_id uuid,p_expected_revision bigint,p_entry jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_receipt public.action_receipts;
 v_contact public.contact_log;
 v_case public.cases;
 v_person public.people;
 v_entry jsonb;
 v_digest text;
 v_revision bigint;
 v_result jsonb;
begin
 v_member=vitally_private.require_membership();
 v_person=vitally_private.acting_person(v_member);
 perform vitally_private.require_cleared(v_member);
 if p_action_id is null or p_contact_id is null or p_expected_revision is null
  or p_entry is null or jsonb_typeof(p_entry)<>'object' then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 if v_member.access<>'staff' or v_person.id is null then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 v_digest=encode(extensions.digest(jsonb_build_object('operation','EDIT_CONTACT','contactId',p_contact_id,
  'expectedRevision',p_expected_revision,'personId',v_person.id,'entry',p_entry)::text,'sha256'),'hex');
 v_receipt=vitally_private.reserve_receipt(v_member,p_action_id,'EDIT_CONTACT',v_digest,v_person.id);
 if v_receipt.receipt is not null then
  perform vitally_private.contact_person(v_member,v_person.id);
  return v_receipt.receipt;
 end if;
 -- The case first, then the entry, in the same order as every case action;
 -- the entry is re-read under its lock and must still be on that case.
 select * into v_contact from public.contact_log
  where id=p_contact_id and workspace_id=v_member.workspace_id;
 if not found then
  raise sqlstate 'VT002' using message='NOT_FOUND';
 end if;
 v_case=vitally_private.lock_case(v_member,v_contact.case_id);
 select * into v_contact from public.contact_log
  where id=p_contact_id and workspace_id=v_member.workspace_id and case_id=v_case.id for update;
 if not found then
  raise sqlstate 'VT002' using message='NOT_FOUND';
 end if;
 v_person=vitally_private.contact_person(v_member,v_person.id);
 if v_contact.logged_by_person_id is distinct from v_person.id and not ('admin'=any(v_person.capabilities)) then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 if v_contact.revision<>p_expected_revision then
  raise sqlstate 'VT003' using message='CONFLICT';
 end if;
 v_entry=vitally_private.check_contact_entry(p_entry);
 v_revision=v_contact.revision+1;
 insert into public.contact_log_versions(contact_id,version,workspace_id,case_id,edited_by_user_id,edited_by_person_id,created_at,
   direction,contacted_at,with_whom,other_name,method,purpose,outcome,note)
 values(v_contact.id,v_revision,v_contact.workspace_id,v_contact.case_id,v_member.user_id,v_person.id,now(),
   v_entry->>'direction',(v_entry->>'contactedAt')::timestamptz,v_entry->>'withWhom',v_entry->>'otherName',
   v_entry->>'method',v_entry->>'purpose',v_entry->>'outcome',v_entry->>'note');
 update public.contact_log set direction=v_entry->>'direction',contacted_at=(v_entry->>'contactedAt')::timestamptz,
   with_whom=v_entry->>'withWhom',other_name=v_entry->>'otherName',method=v_entry->>'method',
   purpose=v_entry->>'purpose',outcome=v_entry->>'outcome',note=v_entry->>'note',
   revision=v_revision,edited_at=now()
  where id=v_contact.id;
 v_result=jsonb_build_object('actionId',p_action_id,'contactId',v_contact.id,'caseId',v_contact.case_id,'revision',v_revision);
 update public.action_receipts set target_id=v_contact.id,receipt=v_result where id=v_receipt.id;
 return v_result;
end;
$$;
revoke all on function public.vitally_edit_contact(uuid,uuid,bigint,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.vitally_edit_contact(uuid,uuid,bigint,jsonb) to authenticated;

-- vitally_save_volunteer, from its definition at 044 with only its admin check
-- changed: the acting person's capabilities are now the effective ones, and
-- the Roster stays on the ceiling, so an uncleared admin still saves.
create or replace function public.vitally_save_volunteer(p_action_id uuid,p_volunteer_id uuid,p_expected_revision bigint,p_volunteer jsonb)
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
 -- 045: the Roster stays on the ceiling, people.capabilities, through the
 -- policy helper; the acting person's capabilities are now the effective ones.
 if v_member.access<>'staff' or v_person.id is null or not vitally_policy.is_workspace_admin(v_member.workspace_id) then
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
-- Part 4: the caller's own clearance (design D10). Answers only for a staff
-- caller; no email, phone or other profile data. `isAdmin` is the ceiling
-- (people.capabilities), so an uncleared admin still reaches the Roster. A
-- role item lists what the role lacks, in the labels of missing_certificates
-- ("Basic or Advanced" for a Preparer or Reviewer with neither).
create function public.vitally_my_clearance()
returns jsonb language plpgsql stable security definer set search_path='' as $$
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
  'siteCoordinatorName',to_jsonb(v_coordinator));
end;
$$;
revoke all on function public.vitally_my_clearance() from public,anon,authenticated,service_role;
grant execute on function public.vitally_my_clearance() to authenticated;
