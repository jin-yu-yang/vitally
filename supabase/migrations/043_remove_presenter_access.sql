-- 043: remove presenter access (OpenSpec change remove-presenter-access,
-- design D1-D6).
--
-- The presenter access type, the person parameter on the six public RPCs and
-- the demonstration people (Alex, Morgan and Sam) go. In order:
--   1. refuse, changing nothing, if a presenter account is referenced (D4);
--   2. delete the presenter receipts;
--   3. delete the presenter memberships;
--   4. delete those accounts from auth.users;
--   5. delete every demonstration person nothing references (D5);
--   6. re-add the access check with 'applicant' and 'staff' only (D1);
--   7. change the 22 policies in place and rename the 16 staff-only ones (D2);
--   8. replace acting_person, the six RPCs and initialize_workspace (D3, D6);
--   9. rewrite the helpers that tested for a presenter, with the same
--      signatures, so their grants stay.
--
-- No drop here uses CASCADE: every old signature is dropped by its full
-- identity. Supabase's own auth foreign keys cascade from auth.users to the
-- account's identities, sessions, tokens and factors. Every function body is
-- copied from its definition at 040 (041 redefines none of them; #172's 042
-- redefines add_staff_member, marked below) and changes only as stated. The migration runs in one transaction.

-- ---------------------------------------------------------------------------
-- 1. The refusal. The presenter memberships are captured before anything is
-- deleted. A reference by any row that stays (the seven columns keyed on the
-- membership, cases.created_by_user_id, or another membership of the same
-- account) stops the migration with SQLSTATE VT008 and the count per column.

create temporary table vitally_043_presenters on commit drop as
 select workspace_id,user_id from public.memberships where access='presenter';

do $$
declare v_counts text;
begin
 select string_agg(x.kind||'='||x.n,', ' order by x.ord) into v_counts from (
  select 1 as ord,'cases.owner_user_id' as kind,(select count(*) from public.cases t
    join vitally_043_presenters p on p.workspace_id=t.workspace_id and p.user_id=t.owner_user_id) as n
  union all select 2,'case_events.actor_user_id',(select count(*) from public.case_events t
    join vitally_043_presenters p on p.workspace_id=t.workspace_id and p.user_id=t.actor_user_id)
  union all select 3,'documents.submitted_by_user_id',(select count(*) from public.documents t
    join vitally_043_presenters p on p.workspace_id=t.workspace_id and p.user_id=t.submitted_by_user_id)
  union all select 4,'contact_attempts.actor_user_id',(select count(*) from public.contact_attempts t
    join vitally_043_presenters p on p.workspace_id=t.workspace_id and p.user_id=t.actor_user_id)
  union all select 5,'contact_log.logged_by_user_id',(select count(*) from public.contact_log t
    join vitally_043_presenters p on p.workspace_id=t.workspace_id and p.user_id=t.logged_by_user_id)
  union all select 6,'contact_log_versions.edited_by_user_id',(select count(*) from public.contact_log_versions t
    join vitally_043_presenters p on p.workspace_id=t.workspace_id and p.user_id=t.edited_by_user_id)
  union all select 7,'people.user_id',(select count(*) from public.people t
    join vitally_043_presenters p on p.workspace_id=t.workspace_id and p.user_id=t.user_id)
  union all select 8,'cases.created_by_user_id',(select count(*) from public.cases t
    where t.created_by_user_id in (select user_id from vitally_043_presenters))
  union all select 9,'memberships.user_id',(select count(*) from public.memberships t
    join vitally_043_presenters p on p.user_id=t.user_id and p.workspace_id<>t.workspace_id)
 ) x where x.n>0;
 if v_counts is not null then
  raise exception using errcode='VT008',
   message='043 refused: presenter accounts are referenced ('||v_counts||')',
   detail=v_counts;
 end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2-4. The presenter receipts (test-run history), memberships and accounts.

delete from public.action_receipts where actor_user_id in (select user_id from vitally_043_presenters);
delete from public.memberships m using vitally_043_presenters p
 where m.workspace_id=p.workspace_id and m.user_id=p.user_id;
delete from auth.users where id in (select user_id from vitally_043_presenters);

-- ---------------------------------------------------------------------------
-- 5. The demonstration people nothing references. A reference is any
-- foreign-key column that points at public.people (read from the catalog, so
-- a column added later is covered), or a receipt's actor_person_id, which has
-- no foreign key. Referenced rows are kept.

do $$
declare v_ref record;
begin
 create temporary table vitally_043_personas on commit drop as
  select p.id from public.people p where p.person_key in ('alex','morgan','sam') and p.user_id is null;
 delete from vitally_043_personas c using public.action_receipts r where r.actor_person_id=c.id;
 for v_ref in
  select c.conrelid::regclass as rel,a.attname
   from pg_catalog.pg_constraint c
   cross join lateral unnest(c.conkey) k(attnum)
   join pg_catalog.pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum
  where c.contype='f' and c.confrelid='public.people'::regclass and a.attname not in ('workspace_id','id')
  order by 1,2
 loop
  execute format('delete from vitally_043_personas c where exists(select 1 from %s t where t.%I=c.id)',v_ref.rel,v_ref.attname);
 end loop;
 delete from public.people p using vitally_043_personas c where p.id=c.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. The access check, with no presenter value.

alter table public.memberships drop constraint memberships_access_check,
 add constraint memberships_access_check check (access in ('applicant','staff'));

-- ---------------------------------------------------------------------------
-- 7. The 22 policies, from their 038/039 definitions with
-- `m.access in ('presenter','staff')` as `m.access='staff'` and every other
-- branch kept. Then the 16 staff-only policies are renamed.

alter policy presenter_people on public.people using(exists(select 1 from public.memberships m where m.workspace_id=people.workspace_id and m.user_id=(select auth.uid()) and m.active and m.access='staff'));
alter policy visible_cases on public.cases using(exists(select 1 from public.memberships m where m.workspace_id=cases.workspace_id and m.user_id=(select auth.uid()) and m.active and ((m.access='applicant' and cases.owner_user_id=m.user_id) or (m.access='staff' and (cases.origin<>'client' or cases.stage<>'draft')))));
alter policy visible_document_requests on public.document_requests using(exists(select 1 from public.memberships m join public.cases c on c.workspace_id=m.workspace_id and c.id=document_requests.case_id where m.workspace_id=document_requests.workspace_id and m.user_id=(select auth.uid()) and m.active and ((m.access='applicant' and c.owner_user_id=m.user_id) or (m.access='staff' and (c.origin<>'client' or c.stage<>'draft')))));
alter policy visible_documents on public.documents using(exists(select 1 from public.memberships m join public.cases c on c.workspace_id=m.workspace_id and c.id=documents.case_id where m.workspace_id=documents.workspace_id and m.user_id=(select auth.uid()) and m.active and ((m.access='applicant' and c.owner_user_id=m.user_id) or (m.access='staff' and (c.origin<>'client' or c.stage<>'draft')))));
alter policy visible_client_events on public.client_events using(exists(select 1 from public.memberships m join public.cases c on c.workspace_id=m.workspace_id and c.id=client_events.case_id where m.workspace_id=client_events.workspace_id and m.user_id=(select auth.uid()) and m.active and ((m.access='applicant' and c.owner_user_id=m.user_id) or (m.access='staff' and (c.origin<>'client' or c.stage<>'draft')))));
alter policy presenter_preparation_participants on public.preparation_participants using(exists(select 1 from public.memberships m join public.cases c on c.workspace_id=m.workspace_id and c.id=preparation_participants.case_id where m.workspace_id=preparation_participants.workspace_id and m.user_id=(select auth.uid()) and m.active and m.access='staff' and (c.origin<>'client' or c.stage<>'draft')));
alter policy presenter_admin_followups on public.admin_followups using(exists(select 1 from public.memberships m join public.cases c on c.workspace_id=m.workspace_id and c.id=admin_followups.case_id where m.workspace_id=admin_followups.workspace_id and m.user_id=(select auth.uid()) and m.active and m.access='staff' and (c.origin<>'client' or c.stage<>'draft')));
alter policy presenter_contact_attempts on public.contact_attempts using(exists(select 1 from public.memberships m join public.cases c on c.workspace_id=m.workspace_id and c.id=contact_attempts.case_id where m.workspace_id=contact_attempts.workspace_id and m.user_id=(select auth.uid()) and m.active and m.access='staff' and (c.origin<>'client' or c.stage<>'draft')));
alter policy presenter_case_events on public.case_events using(exists(select 1 from public.memberships m join public.cases c on c.workspace_id=m.workspace_id and c.id=case_events.case_id where m.workspace_id=case_events.workspace_id and m.user_id=(select auth.uid()) and m.active and m.access='staff' and (c.origin<>'client' or c.stage<>'draft')));
alter policy presenter_assistance_items on public.assistance_items using(exists(select 1 from public.memberships m where m.workspace_id=assistance_items.workspace_id and m.user_id=(select auth.uid()) and m.active and m.access='staff') and (assistance_items.case_id is null or exists(select 1 from public.cases c where c.workspace_id=assistance_items.workspace_id and c.id=assistance_items.case_id and (c.origin<>'client' or c.stage<>'draft'))));
alter policy presenter_reviews on public.reviews using(exists(select 1 from public.memberships m join public.cases c on c.workspace_id=m.workspace_id and c.id=reviews.case_id where m.workspace_id=reviews.workspace_id and m.user_id=(select auth.uid()) and m.active and m.access='staff' and (c.origin<>'client' or c.stage<>'draft')));
alter policy visible_case_contacts on public.case_contacts using(exists(select 1 from public.memberships m join public.cases c on c.workspace_id=m.workspace_id and c.id=case_contacts.case_id where m.workspace_id=case_contacts.workspace_id and m.user_id=(select auth.uid()) and m.active and ((m.access='applicant' and c.owner_user_id=m.user_id) or (m.access='staff' and (c.origin<>'client' or c.stage<>'draft')))));
alter policy presenter_case_materials on public.case_materials using(exists(select 1 from public.memberships m join public.cases c on c.workspace_id=m.workspace_id and c.id=case_materials.case_id where m.workspace_id=case_materials.workspace_id and m.user_id=(select auth.uid()) and m.active and m.access='staff' and (c.origin<>'client' or c.stage<>'draft')));
alter policy visible_case_document_cards on public.case_document_cards using(exists(select 1 from public.memberships m join public.cases c on c.workspace_id=m.workspace_id and c.id=case_document_cards.case_id where m.workspace_id=case_document_cards.workspace_id and m.user_id=(select auth.uid()) and m.active and ((m.access='applicant' and c.owner_user_id=m.user_id) or (m.access='staff' and (c.origin<>'client' or c.stage<>'draft')))));
alter policy presenter_contact_log on public.contact_log using(exists(select 1 from public.memberships m join public.cases c on c.workspace_id=m.workspace_id and c.id=contact_log.case_id where m.workspace_id=contact_log.workspace_id and m.user_id=(select auth.uid()) and m.active and m.access='staff' and (c.origin<>'client' or c.stage<>'draft')));
alter policy presenter_contact_log_versions on public.contact_log_versions using(exists(select 1 from public.memberships m join public.cases c on c.workspace_id=m.workspace_id and c.id=contact_log_versions.case_id where m.workspace_id=contact_log_versions.workspace_id and m.user_id=(select auth.uid()) and m.active and m.access='staff' and (c.origin<>'client' or c.stage<>'draft')));
alter policy presenter_preparer_questionnaires on public.preparer_questionnaires using(exists(select 1 from public.memberships m join public.cases c on c.workspace_id=m.workspace_id and c.id=preparer_questionnaires.case_id where m.workspace_id=preparer_questionnaires.workspace_id and m.user_id=(select auth.uid()) and m.active and m.access='staff' and (c.origin<>'client' or c.stage<>'draft')));
alter policy presenter_reviewer_questionnaires on public.reviewer_questionnaires using(exists(select 1 from public.memberships m join public.cases c on c.workspace_id=m.workspace_id and c.id=reviewer_questionnaires.case_id where m.workspace_id=reviewer_questionnaires.workspace_id and m.user_id=(select auth.uid()) and m.active and m.access='staff' and (c.origin<>'client' or c.stage<>'draft')));
alter policy presenter_filing_attempts on public.filing_attempts using(exists(select 1 from public.memberships m join public.cases c on c.workspace_id=m.workspace_id and c.id=filing_attempts.case_id where m.workspace_id=filing_attempts.workspace_id and m.user_id=(select auth.uid()) and m.active and m.access='staff' and (c.origin<>'client' or c.stage<>'draft')));
alter policy presenter_filing_returns on public.filing_returns using(exists(select 1 from public.memberships m join public.cases c on c.workspace_id=m.workspace_id and c.id=filing_returns.case_id where m.workspace_id=filing_returns.workspace_id and m.user_id=(select auth.uid()) and m.active and m.access='staff' and (c.origin<>'client' or c.stage<>'draft')));
alter policy presenter_filing_notes on public.filing_notes using(exists(select 1 from public.memberships m join public.cases c on c.workspace_id=m.workspace_id and c.id=filing_notes.case_id where m.workspace_id=filing_notes.workspace_id and m.user_id=(select auth.uid()) and m.active and m.access='staff' and (c.origin<>'client' or c.stage<>'draft')));
alter policy presenter_preparer_shaded_fields on public.preparer_shaded_fields using(exists(select 1 from public.memberships m join public.cases c on c.workspace_id=m.workspace_id and c.id=preparer_shaded_fields.case_id where m.workspace_id=preparer_shaded_fields.workspace_id and m.user_id=(select auth.uid()) and m.active and m.access='staff' and (c.origin<>'client' or c.stage<>'draft')));

alter policy presenter_admin_followups on public.admin_followups rename to staff_admin_followups;
alter policy presenter_assistance_items on public.assistance_items rename to staff_assistance_items;
alter policy presenter_case_events on public.case_events rename to staff_case_events;
alter policy presenter_case_materials on public.case_materials rename to staff_case_materials;
alter policy presenter_contact_attempts on public.contact_attempts rename to staff_contact_attempts;
alter policy presenter_contact_log on public.contact_log rename to staff_contact_log;
alter policy presenter_contact_log_versions on public.contact_log_versions rename to staff_contact_log_versions;
alter policy presenter_filing_attempts on public.filing_attempts rename to staff_filing_attempts;
alter policy presenter_filing_notes on public.filing_notes rename to staff_filing_notes;
alter policy presenter_filing_returns on public.filing_returns rename to staff_filing_returns;
alter policy presenter_people on public.people rename to staff_people;
alter policy presenter_preparation_participants on public.preparation_participants rename to staff_preparation_participants;
alter policy presenter_preparer_questionnaires on public.preparer_questionnaires rename to staff_preparer_questionnaires;
alter policy presenter_preparer_shaded_fields on public.preparer_shaded_fields rename to staff_preparer_shaded_fields;
alter policy presenter_reviewer_questionnaires on public.reviewer_questionnaires rename to staff_reviewer_questionnaires;
alter policy presenter_reviews on public.reviews rename to staff_reviews;

-- ---------------------------------------------------------------------------
-- 8. The new functions. The old signatures are dropped by name first; nothing
-- in the catalog depends on them. Each new function is revoked from every
-- client role; only the six RPCs are granted back, to `authenticated`.

drop function public.vitally_apply_action(uuid,uuid,bigint,uuid,text,jsonb);
drop function public.vitally_assistance_action(uuid,uuid,bigint,uuid,text,text);
drop function public.vitally_close_unsigned(uuid,uuid,jsonb,boolean);
drop function public.vitally_create_case(uuid,text,uuid,jsonb);
drop function public.vitally_log_contact(uuid,uuid,uuid,uuid,jsonb);
drop function public.vitally_edit_contact(uuid,uuid,bigint,uuid,jsonb);
drop function vitally_private.acting_person(public.memberships,uuid);
drop function vitally_private.initialize_workspace(uuid,uuid[],uuid[]);

-- From 038, without the person parameter: staff act as their own linked
-- person, a client as no person, and any other access is FORBIDDEN.
create function vitally_private.acting_person(p_member public.memberships)
returns public.people language plpgsql stable security definer set search_path='' as $$
declare v_person public.people;
begin
 if p_member.access='staff' then
  select * into v_person from public.people
   where workspace_id=p_member.workspace_id and user_id=p_member.user_id;
  if not found then
   raise sqlstate 'VT001' using message='FORBIDDEN';
  end if;
 elsif p_member.access='applicant' then
  null;
 else
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 return v_person;
end;
$$;
revoke all on function vitally_private.acting_person(public.memberships) from public,anon,authenticated,service_role;

-- The six RPCs, each from its definition at 040 without `p_person_id`. The
-- digest keeps its 'personId' key, filled with the resolved person, so a
-- receipt stored before 043 still matches its replay.
create function public.vitally_apply_action(p_action_id uuid,p_case_id uuid,p_expected_revision bigint,p_type text,p_payload jsonb)
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

create function public.vitally_assistance_action(p_action_id uuid,p_item_id uuid,p_expected_revision bigint,p_type text,p_note text)
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

create function public.vitally_close_unsigned(p_action_id uuid,p_cases jsonb,p_confirmed boolean)
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

create function public.vitally_create_case(p_action_id uuid,p_mode text,p_answers jsonb)
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
 v_person=vitally_private.acting_person(v_member);
 if p_mode='client' then
  if v_member.access<>'applicant' or v_person.id is not null then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
  v_owner=v_user;
 elsif p_mode='assisted' then
  if v_member.access<>'staff' then
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
revoke all on function public.vitally_create_case(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.vitally_create_case(uuid,text,jsonb) to authenticated;

create function public.vitally_log_contact(p_action_id uuid,p_case_id uuid,p_followup_id uuid,p_entry jsonb)
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

create function public.vitally_edit_contact(p_action_id uuid,p_contact_id uuid,p_expected_revision bigint,p_entry jsonb)
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

-- From 040, without the presenter list, the demonstration people, the
-- "exactly three unlinked people" check and the Sam default. A new
-- workspace's default follow-up person stays null until set_default_followup
-- runs; an existing workspace's default must still hold `followup`.
create function vitally_private.initialize_workspace(p_workspace_id uuid,p_applicants uuid[])
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
 end loop;
 return jsonb_build_object('workspaceId',p_workspace_id);
end;
$$;
revoke all on function vitally_private.initialize_workspace(uuid,uuid[]) from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- 9. The helpers that tested for a presenter, from their definitions at 040,
-- with `in ('presenter','staff')` as `='staff'` and their comments reworded.
-- CREATE OR REPLACE keeps each signature and its grants.

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
 return v_person;
end;
$$;

create or replace function vitally_private.lock_case(p_member public.memberships,p_case_id uuid)
returns public.cases language plpgsql security definer set search_path='' as $$
declare v_case public.cases;
begin
 select * into v_case from public.cases c
  where c.id=p_case_id and c.workspace_id=p_member.workspace_id
   and ((p_member.access='applicant' and c.owner_user_id=p_member.user_id)
     or (p_member.access='staff' and (c.origin<>'client' or c.stage<>'draft')))
  for update;
 if not found then
  raise sqlstate 'VT002' using message='NOT_FOUND';
 end if;
 return v_case;
end;
$$;

create or replace function vitally_private.lock_assistance_item(p_member public.memberships,p_item_id uuid)
returns public.assistance_items language plpgsql security definer set search_path='' as $$
declare v_item public.assistance_items;
begin
 select * into v_item from public.assistance_items i
  where i.id=p_item_id and i.workspace_id=p_member.workspace_id and p_member.access='staff'
   and (i.case_id is null or exists(select 1 from public.cases c
    where c.workspace_id=i.workspace_id and c.id=i.case_id and (c.origin<>'client' or c.stage<>'draft')))
  for update;
 if not found then
  raise sqlstate 'VT002' using message='NOT_FOUND';
 end if;
 return v_item;
end;
$$;

-- Comment only: case_events is staff-only.
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
  if not found or not ('followup'=any(v_assignee.capabilities)) then -- 036
   raise sqlstate 'VT007' using message='VALIDATION'; -- 036
  end if; -- 036
 end if; -- 036
 perform vitally_private.close_case_steps(p_case,p_payload->>'reason'); -- 036
 if v_assignee.id is not null then -- 036
  insert into public.admin_followups(workspace_id,case_id,request_id,purpose,assignee_person_id,reason,created_by_person_id) -- 036
  values(p_case.workspace_id,p_case.id,null,'withdrawal_notice',v_assignee.id, -- 036
   case when p_payload->>'reason'='withdrawn' -- 036
    then 'The client withdrew; make sure the return is not transmitted in TaxSlayer.' -- 036
    else 'The case was closed before filing; make sure the return is not transmitted in TaxSlayer.' end, -- 036
   v_assignee.id); -- 036
 end if; -- 036
 -- The reason and note are staff context: case_events is staff-only, and the client
 -- message says plainly that an office decision, not a filing, has changed.
 return jsonb_build_object('detail',jsonb_build_object('reason',p_payload->>'reason') -- 036
   ||case when p_payload ? 'note' then jsonb_build_object('note',p_payload->>'note') else '{}'::jsonb end, -- 036
  'message',vitally_private.closed_line(p_payload->>'reason')); -- 036
end;
$$;

-- Without the reserved demonstration keys: a key held by any other person of
-- the workspace is still refused below.
-- TODO(#172): re-copy from #172's migration 042
create or replace function vitally_private.add_staff_member(p_workspace_id uuid,p_user_id uuid,p_person_key text,p_name text,p_capabilities text[])
returns uuid language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_has_member boolean;
 v_person_id uuid;
begin
 if p_workspace_id is null or p_user_id is null or p_person_key is null or p_name is null or p_capabilities is null
  or p_person_key !~ '^[a-z][a-z0-9_]{0,39}$'
  or length(p_name) not between 1 and 80
  or array_position(p_capabilities,null) is not null
  or not (p_capabilities <@ array['prepare','review','admin','followup','receive_documents','assist']::text[])
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
