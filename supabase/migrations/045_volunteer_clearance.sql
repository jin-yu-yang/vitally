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
