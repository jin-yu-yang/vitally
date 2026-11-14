-- 046: volunteer workload (OpenSpec change add-volunteer-workload, design D5
-- and D7). An admin assigns or reassigns a case's preparer or reviewer with one
-- audited case action, ASSIGN_CASE {slot, personId}, through vitally_apply_action.
--
-- Every function below that already existed is re-created in full from its
-- latest definition, with only the ASSIGN_CASE lines (marked -- 046) added:
--   * check_operation_authority (045): ASSIGN_CASE in the admin-only group;
--   * check_payload (039): the ASSIGN_CASE shape;
--   * vitally_apply_action (045): the dispatch line.
-- check_authority (036) and check_related (023) end in `else null` and need no
-- branch: the handler looks the person up itself and refuses one outside the
-- case's workspace with FORBIDDEN, as contact_person does. CREATE OR REPLACE
-- keeps each signature; the revoke and grant lines are re-applied.

-- ---------------------------------------------------------------------------
-- 1. check_operation_authority, verbatim from 045 with ASSIGN_CASE in the
-- admin-only group (effective `admin`).

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
  when 'VERIFY_INTAKE','REMIND','CLOSE_CASE','START_SCREENING','MARK_READY_TO_EFILE','MARK_EFILED','RECORD_FILING_RESULT','RETURN_TO_SIGNING','REQUEST_DOCUMENTS_AT_INTAKE','PUT_ON_HOLD','RESUME_FROM_HOLD','ASSIGN_CASE' then -- 036, 046
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
revoke all on function vitally_private.check_operation_authority(public.memberships,uuid,text) from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- 2. check_payload, verbatim from 039 with the ASSIGN_CASE branch: keys exactly
-- slot and personId, slot preparer or reviewer, personId a UUID string.

create or replace function vitally_private.check_payload(p_type text,p_payload jsonb) returns void
language plpgsql immutable security definer set search_path='' as $$
declare v_e record; -- 035
 v_d date; -- 035
 v_n record; -- 036
begin
 case p_type
  when 'SAVE_ANSWERS' then
   -- The per-key answer checks are check_related's: they depend on the case's version.
   if vitally_private.payload_keys(p_payload) not in (array['answers'], array['answers','visited'])
    or jsonb_typeof(p_payload->'answers')<>'object'
    or (p_payload ? 'visited' and (jsonb_typeof(p_payload->'visited')<>'array'
     or jsonb_array_length(p_payload->'visited')>64
     or exists(select 1 from jsonb_array_elements(p_payload->'visited') v
      where jsonb_typeof(v)<>'string' or (v#>>'{}') !~ '^[a-z]+\.[a-z_]+$'))) then
    raise sqlstate 'VT007' using message='VALIDATION';
   end if;
  when 'SUBMIT' then
   if vitally_private.payload_keys(p_payload)<>array['confirmed'] or p_payload->'confirmed'<>'true'::jsonb then
    raise sqlstate 'VT007' using message='VALIDATION';
   end if;
  when 'VERIFY_INTAKE' then
   if vitally_private.payload_keys(p_payload)<>array['checks'] or jsonb_typeof(p_payload->'checks')<>'object'
    or vitally_private.payload_keys(p_payload->'checks') not in (array['documents','in_scope','phone'], array['documents','identity','in_scope','phone']) -- 034
    or exists(select 1 from jsonb_each(p_payload->'checks') c where c.value<>'true'::jsonb) then
    raise sqlstate 'VT007' using message='VALIDATION';
   end if;
  when 'CLAIM_PREPARATION','REMIND','CLAIM_REVIEW','START_SCREENING' then -- 033
   if vitally_private.payload_keys(p_payload)<>array[]::text[] then
    raise sqlstate 'VT007' using message='VALIDATION';
   end if;
  when 'REQUEST_DOCUMENT' then
   if vitally_private.payload_keys(p_payload)<>array['message','title']
    or not vitally_private.payload_text(p_payload,'title',120)
    or not vitally_private.payload_text(p_payload,'message',2000) then
    raise sqlstate 'VT007' using message='VALIDATION';
   end if;
  when 'REQUEST_DOCUMENTS_AT_INTAKE' then -- 036
   -- One to five requests, each with the same limits as a preparer's. -- 036
   if vitally_private.payload_keys(p_payload)<>array['requests'] -- 036
    or jsonb_typeof(p_payload->'requests')<>'array' -- 036
    or jsonb_array_length(p_payload->'requests') not between 1 and 5 then -- 036
    raise sqlstate 'VT007' using message='VALIDATION'; -- 036
   end if; -- 036
   for v_n in select e.value from jsonb_array_elements(p_payload->'requests') e loop -- 036
    if jsonb_typeof(v_n.value)<>'object' -- 036
     or vitally_private.payload_keys(v_n.value)<>array['message','title'] -- 036
     or not vitally_private.payload_text(v_n.value,'title',120) -- 036
     or not vitally_private.payload_text(v_n.value,'message',2000) then -- 036
     raise sqlstate 'VT007' using message='VALIDATION'; -- 036
    end if; -- 036
   end loop; -- 036
  when 'PUT_ON_HOLD' then -- 036
   -- An explicit confirmation and an optional staff note (1 to 1000 characters). -- 036
   if vitally_private.payload_keys(p_payload) not in (array['confirmed'], array['confirmed','note']) -- 036
    or p_payload->'confirmed'<>'true'::jsonb -- 036
    or (p_payload ? 'note' and not vitally_private.payload_text(p_payload,'note',1000)) then -- 036
    raise sqlstate 'VT007' using message='VALIDATION'; -- 036
   end if; -- 036
  when 'RESUME_FROM_HOLD' then -- 036
   if vitally_private.payload_keys(p_payload)<>array['confirmed'] -- 036
    or p_payload->'confirmed'<>'true'::jsonb then -- 036
    raise sqlstate 'VT007' using message='VALIDATION'; -- 036
   end if; -- 036
  when 'WITHDRAW' then -- 036
   if vitally_private.payload_keys(p_payload)<>array['confirmed'] -- 036
    or p_payload->'confirmed'<>'true'::jsonb then -- 036
    raise sqlstate 'VT007' using message='VALIDATION'; -- 036
   end if; -- 036
  when 'RESPOND_DOCUMENT','RECORD_DOCUMENT_RESPONSE' then
   -- One simulated document exists in this demo; its name is fixed.
   if vitally_private.payload_keys(p_payload)<>array['filename','requestId']
    or vitally_private.payload_uuid(p_payload,'requestId') is null
    or p_payload->>'filename'<>'demo-mileage-record-2025.pdf' then
    raise sqlstate 'VT007' using message='VALIDATION';
   end if;
  when 'VERIFY_DOCUMENT' then
   if vitally_private.payload_keys(p_payload)<>array['requestId']
    or vitally_private.payload_uuid(p_payload,'requestId') is null then
    raise sqlstate 'VT007' using message='VALIDATION';
   end if;
  when 'ESCALATE_CONTACT' then
   -- The assignee is derived from workspace setup, so any assignee-shaped
   -- extra field is rejected rather than ignored.
   if vitally_private.payload_keys(p_payload)<>array['reason','requestId']
    or vitally_private.payload_uuid(p_payload,'requestId') is null
    or not vitally_private.payload_text(p_payload,'reason',1000) then
    raise sqlstate 'VT007' using message='VALIDATION';
   end if;
  when 'RECORD_CONTACT','RESOLVE_FOLLOWUP' then
   -- Resolution accepts only the two conclusive outcomes.
   if vitally_private.payload_keys(p_payload)<>array['followupId','note','outcome']
    or vitally_private.payload_uuid(p_payload,'followupId') is null
    or not vitally_private.payload_text(p_payload,'note',1000)
    or (p_type='RECORD_CONTACT' and p_payload->>'outcome' not in ('no_answer','reached','no_further_contact','closure_requested'))
    or (p_type='RESOLVE_FOLLOWUP' and p_payload->>'outcome' not in ('reached','no_further_contact')) then
    raise sqlstate 'VT007' using message='VALIDATION';
   end if;
  when 'REQUEST_CORRECTIONS' then
   -- The findings are the whole request body: internal text with content.
   if vitally_private.payload_keys(p_payload)<>array['findings']
    or not vitally_private.payload_text(p_payload,'findings',2000) then
    raise sqlstate 'VT007' using message='VALIDATION';
   end if;
  when 'SUBMIT_REVIEW' then -- 033
   if vitally_private.payload_keys(p_payload)<>array['questionnaire'] -- 033
    or not coalesce(vitally_private.check_preparer_questionnaire(p_payload->'questionnaire'),false) then -- 033
    raise sqlstate 'VT007' using message='VALIDATION'; -- 033
   end if; -- 033
  when 'APPROVE_REVIEW' then -- 033
   if vitally_private.payload_keys(p_payload)<>array['questionnaire'] -- 033
    or not coalesce(vitally_private.check_reviewer_questionnaire(p_payload->'questionnaire'),false) then -- 033
    raise sqlstate 'VT007' using message='VALIDATION'; -- 033
   end if; -- 033
  when 'RESUBMIT_REVIEW' then
   if vitally_private.payload_keys(p_payload)<>array['questionnaire','resolution'] -- 033
    or not coalesce(vitally_private.check_preparer_questionnaire(p_payload->'questionnaire'),false) -- 033
    or not vitally_private.payload_text(p_payload,'resolution',2000) then
    raise sqlstate 'VT007' using message='VALIDATION';
   end if;
  when 'RECORD_REVIEW_CONTACT' then
   -- A contact attempt records what happened, never a payment detail.
   if vitally_private.payload_keys(p_payload)<>array['note','outcome']
    or not vitally_private.payload_text(p_payload,'note',1000)
    or p_payload->>'outcome' not in ('no_answer','reached','no_further_contact','closure_requested') then
    raise sqlstate 'VT007' using message='VALIDATION';
   end if;
  when 'UPDATE_CONTACT' then
   -- Best time and note only, at least one of them. A phone is changed
   -- through the form (SAVE_ANSWERS), never here. Each value's type check
   -- reads the catalogue, so it is act_update_contact's.
   if cardinality(vitally_private.payload_keys(p_payload))=0
    or not (vitally_private.payload_keys(p_payload)<@array['bestContactNote','bestContactTime']) then
    raise sqlstate 'VT007' using message='VALIDATION';
   end if;
  when 'RECORD_MATERIALS' then
   -- The whole set now received: known items, each at most once.
   if vitally_private.payload_keys(p_payload)<>array['received'] or jsonb_typeof(p_payload->'received')<>'array' then
    raise sqlstate 'VT007' using message='VALIDATION';
   end if;
   if exists(select 1 from jsonb_array_elements(p_payload->'received') e
     where jsonb_typeof(e)<>'string' or (e#>>'{}')<>all(vitally_private.materials_items())) then
    raise sqlstate 'VT007' using message='VALIDATION';
   end if;
   if (select count(distinct e) from jsonb_array_elements_text(p_payload->'received') e)<>jsonb_array_length(p_payload->'received') then
    raise sqlstate 'VT007' using message='VALIDATION';
   end if;
  when 'SET_DOCUMENT_CARD' then
   if vitally_private.payload_keys(p_payload)<>array['slotId','status']
    or jsonb_typeof(p_payload->'slotId')<>'string'
    or (p_payload->>'slotId') !~ '^[a-z0-9_]+\.(tp|sp|household|hh\.[0-9a-f]{32})$'
    or coalesce(p_payload->>'status','') not in ('later','none','not_done') then
    raise sqlstate 'VT007' using message='VALIDATION';
   end if;
  when 'SET_DOCUMENT_GROUP' then
   if vitally_private.payload_keys(p_payload)<>array['group','slotId']
    or jsonb_typeof(p_payload->'slotId')<>'string'
    or (p_payload->>'slotId') !~ '^[a-z0-9_]+\.(tp|sp|household|hh\.[0-9a-f]{32})$'
    or coalesce(p_payload->>'group','') not in ('needed','maybe') then
    raise sqlstate 'VT007' using message='VALIDATION';
   end if;
  when 'CLOSE_CASE' then
   -- Closing is deliberate: one of six reasons, an optional staff note, and an explicit confirmation. -- 036
   if vitally_private.payload_keys(p_payload) not in (array['confirmed','reason'], array['confirmed','note','reason']) -- 036
    or p_payload->'confirmed'<>'true'::jsonb
    or jsonb_typeof(p_payload->'reason')<>'string' -- 036
    or (p_payload->>'reason') not in ('out_of_scope','no_need_to_file','duplicate','dismissed','withdrawn','other') -- 036
    or (p_payload ? 'note' and not vitally_private.payload_text(p_payload,'note',1000)) -- 036
    or (p_payload->>'reason'='other' and not p_payload ? 'note') then -- 036
    raise sqlstate 'VT007' using message='VALIDATION';
   end if;
  when 'MARK_READY_TO_EFILE','RETURN_TO_SIGNING' then -- 035
   if vitally_private.payload_keys(p_payload)<>array['confirmed'] -- 032
    or p_payload->'confirmed'<>'true'::jsonb then -- 032
    raise sqlstate 'VT007' using message='VALIDATION'; -- 032
   end if; -- 032
  when 'MARK_EFILED' then -- 035
   -- The case-dependent rules (which returns, which pairs) are the handler's.
   if vitally_private.payload_keys(p_payload)<>array['confirmed','methods'] -- 035
    or p_payload->'confirmed'<>'true'::jsonb -- 035
    or jsonb_typeof(p_payload->'methods')<>'object' -- 035
    or not (vitally_private.payload_keys(p_payload->'methods')<@array['federal','state']) -- 035
    or exists(select 1 from jsonb_each(p_payload->'methods') m where m.value not in ('"efile"'::jsonb,'"paper"'::jsonb)) then -- 035
    raise sqlstate 'VT007' using message='VALIDATION'; -- 035
   end if; -- 035
  when 'RECORD_FILING_RESULT' then -- 035
   -- The shape and the rules that need no case; whether a return is waiting, the
   -- method fit and the date window are the handler's.
   if vitally_private.payload_keys(p_payload) not in (array['confirmed','results'], array['confirmed','fixNote','results']) -- 035
    or p_payload->'confirmed'<>'true'::jsonb -- 035
    or jsonb_typeof(p_payload->'results')<>'object' then -- 035
    raise sqlstate 'VT007' using message='VALIDATION'; -- 035
   end if; -- 035
   if p_payload ? 'fixNote' and not vitally_private.payload_text(p_payload,'fixNote',1000) then -- 035
    raise sqlstate 'VT007' using message='VALIDATION'; -- 035
   end if; -- 035
   if cardinality(vitally_private.payload_keys(p_payload->'results'))=0 -- 035
    or not (vitally_private.payload_keys(p_payload->'results')<@array['federal','state']) then -- 035
    raise sqlstate 'VT007' using message='VALIDATION'; -- 035
   end if; -- 035
   for v_e in select r.key,r.value from jsonb_each(p_payload->'results') r loop -- 035
    if jsonb_typeof(v_e.value)<>'object' then -- 035
     raise sqlstate 'VT007' using message='VALIDATION'; -- 035
    end if; -- 035
    -- A rejection carries its code (1 to 40 characters, not blank); nothing else does. -- 035
    if vitally_private.payload_keys(v_e.value) not in (array['date','result'], array['code','date','result']) -- 035
     or coalesce(v_e.value->>'result','') not in ('accepted','rejected') -- 037
     or (v_e.value->>'result'='rejected')<>(v_e.value ? 'code') -- 035
     or (v_e.value ? 'code' and not vitally_private.payload_text(v_e.value,'code',40)) -- 035
     or jsonb_typeof(v_e.value->'date')<>'string' -- 035
     or (v_e.value->>'date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then -- 035
     raise sqlstate 'VT007' using message='VALIDATION'; -- 035
    end if; -- 035
    begin -- 035
     v_d:=(v_e.value->>'date')::date; -- 035
    exception when others then -- 035
     raise sqlstate 'VT007' using message='VALIDATION'; -- 035
    end; -- 035
   end loop; -- 035
  when 'SAVE_PREPARER_FIELDS' then -- 039
   -- The whole set, based on the version the preparer last saw (a whole number, 0 for none). -- 039
   if vitally_private.payload_keys(p_payload)<>array['basedOnVersion','fields'] -- 039
    or jsonb_typeof(p_payload->'basedOnVersion')<>'number' -- 039
    or (p_payload->>'basedOnVersion') !~ '^[0-9]{1,15}$' -- 039
    or jsonb_typeof(p_payload->'fields')<>'object' -- 039
    or not coalesce(vitally_private.check_preparer_fields(p_payload->'fields'),false) then -- 039
    raise sqlstate 'VT007' using message='VALIDATION'; -- 039
   end if; -- 039
  when 'ASSIGN_CASE' then -- 046
   -- The slot and the person, nothing else; whether the person exists is the handler's. -- 046
   if vitally_private.payload_keys(p_payload)<>array['personId','slot'] -- 046
    or jsonb_typeof(p_payload->'slot')<>'string' -- 046
    or (p_payload->>'slot') not in ('preparer','reviewer') -- 046
    or vitally_private.payload_uuid(p_payload,'personId') is null then -- 046
    raise sqlstate 'VT007' using message='VALIDATION'; -- 046
   end if; -- 046
  else raise sqlstate 'VT007' using message='VALIDATION';
 end case;
end;
$$;
revoke all on function vitally_private.check_payload(text,jsonb) from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- 3. The handler (design D5). The refusals come first, in this order:
--   1. the stage allows the slot, and the person is not its current holder
--      (INVALID_TRANSITION);
--   2. the person exists in the case's workspace (FORBIDDEN);
--   3. the person is cleared (require_cleared_assignee, INELIGIBLE);
--   4. the person's effective capabilities hold the slot's capability:
--      `prepare` for preparer, `review` for reviewer (INELIGIBLE);
--   5. independence (SELF_REVIEW): a reviewer is not a preparation
--      participant; a preparer is not the case's current reviewer.
-- The assignee is read as a people row with `capabilities` replaced by the
-- effective capabilities (design D7), as contact_person does.

create or replace function vitally_private.act_assign_case(p_member public.memberships,p_case public.cases,p_person public.people,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_slot text;
 v_person_id uuid;
 v_holder uuid;
 v_allowed boolean;
 v_assignee public.people;
begin
 v_slot=p_payload->>'slot';
 v_person_id=vitally_private.payload_uuid(p_payload,'personId');
 -- 1. The stage allows the slot; the current holder again is no change.
 if v_slot='preparer' then
  v_holder=p_case.preparer_id;
  v_allowed=case when v_holder is null then p_case.stage='preparation_ready'
   else p_case.stage in ('preparing','corrections_required','review_ready','reviewing') end;
 else
  v_holder=p_case.reviewer_id;
  v_allowed=case when v_holder is null then p_case.stage='review_ready'
   else p_case.stage='reviewing' end;
 end if;
 if not v_allowed or v_holder is not distinct from v_person_id then
  raise sqlstate 'VT004' using message='INVALID_TRANSITION';
 end if;
 -- 2. The person, in the case's workspace, with effective capabilities.
 select * into v_assignee from public.people where workspace_id=p_case.workspace_id and id=v_person_id;
 if not found then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 v_assignee.capabilities=vitally_private.effective_capabilities(p_case.workspace_id,v_assignee.id);
 -- 3. Cleared.
 perform vitally_private.require_cleared_assignee(p_case.workspace_id,v_assignee.id);
 -- 4. The slot's effective capability.
 if not ((case v_slot when 'preparer' then 'prepare' else 'review' end)=any(v_assignee.capabilities)) then
  raise sqlstate 'VT006' using message='INELIGIBLE';
 end if;
 -- 5. Independence. require_review_eligibility checks participation first;
 -- its capability check cannot fail after step 4.
 if v_slot='reviewer' then
  perform vitally_private.require_review_eligibility(p_case,v_assignee);
 elsif p_case.reviewer_id is not distinct from v_assignee.id then
  raise sqlstate 'VT005' using message='SELF_REVIEW';
 end if;
 -- ------------------------------------------------------------------------
 -- Effects (design D5): added by the next task of this change. Until then an
 -- accepted assignment changes nothing and is refused.
 raise sqlstate 'VT004' using message='INVALID_TRANSITION';
end;
$$;
revoke all on function vitally_private.act_assign_case(public.memberships,public.cases,public.people,jsonb) from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- 4. vitally_apply_action, verbatim from 045 with the ASSIGN_CASE dispatch line.

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
  when 'ASSIGN_CASE' then v_outcome=vitally_private.act_assign_case(v_member,v_case,v_person,p_payload); -- 046
  else raise sqlstate 'VT007' using message='VALIDATION';
 end case;
 return vitally_private.commit_action(v_member,v_case,v_person,p_action_id,p_type,v_outcome,v_receipt);
end;
$$;
revoke all on function public.vitally_apply_action(uuid,uuid,bigint,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.vitally_apply_action(uuid,uuid,bigint,text,jsonb) to authenticated;
