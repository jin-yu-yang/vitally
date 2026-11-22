-- Issue #157: OneDrive is the sole repository for client files.
-- Do not record filenames or binary uploads in ViTally. A client confirmation
-- records a claim, not a receipt. A staff action confirms receipt/verification.
-- Requires migration 052. Existing historical demo rows remain readable.

-- Applicant-safe access to the *client* link only. The site coordinator's
-- certificate / ID upload URL is never exposed through this function.
create or replace function public.vitally_client_documents_link()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
begin
 v_member=vitally_private.require_membership();
 if v_member.access not in ('applicant','staff') then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 return jsonb_build_object('clientDocumentsUrl', (select s.client_documents_url
   from public.season_settings s where s.workspace_id=v_member.workspace_id));
end;
$$;
revoke all on function public.vitally_client_documents_link() from public,anon,authenticated,service_role;
grant execute on function public.vitally_client_documents_link() to authenticated;

-- The cards are a record of the client's report and office's decision;
-- this table never stores any taxpayer document itself.
alter table public.case_document_cards drop constraint if exists case_document_cards_status_check;
alter table public.case_document_cards add constraint case_document_cards_status_check
 check (status is null or status in ('later','none','sent','received','verified'));

-- Use the most recent check_payload contract (046), updating only document
-- response and document-card statuses. Do not replace with an older version.
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
   -- Both document-response actions report a client or office confirmation;
   -- the filename is generated server-side, and callers supply requestId only.
   if vitally_private.payload_keys(p_payload)<>array['requestId']
    or vitally_private.payload_uuid(p_payload,'requestId') is null then
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
    or coalesce(p_payload->>'status','') not in ('later','none','not_done','sent','received','verified') then
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
  when 'MARK_READY_TO_EFILE' then -- 054
   if vitally_private.payload_keys(p_payload)<>array['confirmed'] -- 032
    or p_payload->'confirmed'<>'true'::jsonb then -- 032
    raise sqlstate 'VT007' using message='VALIDATION'; -- 032
   end if; -- 032
  when 'RETURN_TO_SIGNING' then -- 054
   -- The confirmation, and optionally the corrected Exit Form values and remarks. -- 054
   -- Which groups fit the case is the handler's. -- 054
   if p_payload->'confirmed' is distinct from 'true'::jsonb -- 054
    or not (vitally_private.payload_keys(p_payload)<@array['confirmed','exitForm','remarks']) -- 054
    or (p_payload ? 'exitForm' and not coalesce(vitally_private.check_exit_form(p_payload->'exitForm'),false)) -- 054
    or (p_payload ? 'remarks' and not vitally_private.payload_text(p_payload,'remarks',2000)) then -- 054
    raise sqlstate 'VT007' using message='VALIDATION'; -- 054
   end if; -- 054
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
   -- The slot, the person and the holder the admin saw (JSON null for an empty -- 046
   -- slot), nothing else; whether the person exists is the handler's. -- 046
   if vitally_private.payload_keys(p_payload)<>array['expectedHolderId','personId','slot'] -- 046
    or jsonb_typeof(p_payload->'slot')<>'string' -- 046
    or (p_payload->>'slot') not in ('preparer','reviewer') -- 046
    or vitally_private.payload_uuid(p_payload,'personId') is null -- 046
    or (jsonb_typeof(p_payload->'expectedHolderId')<>'null' -- 046
     and vitally_private.payload_uuid(p_payload,'expectedHolderId') is null) then -- 046
    raise sqlstate 'VT007' using message='VALIDATION'; -- 046
   end if; -- 046
  else raise sqlstate 'VT007' using message='VALIDATION';
 end case;
end;
$$;

create or replace function vitally_private.act_set_document_card(p_member public.memberships,p_case public.cases,p_person public.people,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_case.stage='closed' then raise sqlstate 'VT004' using message='INVALID_TRANSITION'; end if;
 -- Only staff actually working on this case may confirm receipt or verification.
 -- Clients may report an upload, but must not make a claim of staff verification.
 -- Reporting an upload is possible only when the site configured its client link.
 if p_payload->>'status'='sent' and not exists (
  select 1 from public.season_settings s where s.workspace_id=p_case.workspace_id
   and s.client_documents_url is not null
 ) then
  raise sqlstate 'VT004' using message='INVALID_TRANSITION';
 end if;
 if p_payload->>'status' in ('received','verified') and p_member.access<>'staff' then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 -- A client's follow-up mark must not erase a staff-confirmed result.
 if p_member.access='applicant' and exists (
  select 1 from public.case_document_cards d where d.case_id=p_case.id
   and d.slot_id=p_payload->>'slotId' and d.status in ('received','verified')
 ) then
  raise sqlstate 'VT004' using message='INVALID_TRANSITION';
 end if;
 insert into public.case_document_cards as d (workspace_id, case_id, slot_id, status, changed_at)
 values (p_case.workspace_id, p_case.id, p_payload->>'slotId',
  case when p_payload->>'status'='not_done' then null else p_payload->>'status' end, now())
 on conflict (case_id, slot_id) do update set status=excluded.status, changed_at=now();
 return jsonb_build_object('detail',jsonb_build_object('slotId',p_payload->>'slotId','status',p_payload->>'status'));
end;
$$;

create or replace function vitally_private.receive_document(p_case public.cases,p_payload jsonb,p_source text,p_user_id uuid,p_person_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_request public.document_requests;
 v_document uuid;
begin
 if not (p_case.stage in ('preparing','corrections_required','awaiting_documents') -- 036
   or (p_case.stage='on_hold' and p_case.hold_origin='awaiting_documents')) then -- 036
  raise sqlstate 'VT004' using message='INVALID_TRANSITION';
 end if;
 select * into v_request from public.document_requests
  where workspace_id=p_case.workspace_id and case_id=p_case.id
   and id=vitally_private.payload_uuid(p_payload,'requestId') for update;
 -- An already answered request takes no second receipt, even at a fresh revision.
 if v_request.status is distinct from 'open' then
  raise sqlstate 'VT004' using message='INVALID_TRANSITION';
 end if;
 insert into public.documents(workspace_id,case_id,request_id,filename,source,submitted_by_user_id,submitted_by_person_id)
 values(p_case.workspace_id,p_case.id,v_request.id,case when p_source='client' then 'OneDrive upload reported' else 'Received by PCDC office' end,p_source,p_user_id,p_person_id)
 returning id into v_document;
 -- Receipt is not verification: the preparer still confirms the response.
 update public.document_requests set status='awaiting_verification',updated_at=now() where id=v_request.id;
 return jsonb_build_object('requestId',v_request.id,'documentId',v_document,'source',p_source);
end;
$$;

create or replace function vitally_private.act_respond_document(p_member public.memberships,p_case public.cases,p_person public.people,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 -- As for a card marked "sent": a client reports an upload only when the site
 -- configured its client link. (The office's RECORD_DOCUMENT_RESPONSE needs no link.)
 if not exists (
  select 1 from public.season_settings s where s.workspace_id=p_case.workspace_id
   and s.client_documents_url is not null
 ) then
  raise sqlstate 'VT004' using message='INVALID_TRANSITION';
 end if;
 return jsonb_build_object(
  'detail',vitally_private.receive_document(p_case,p_payload,'client',p_member.user_id,null),
  'message','You reported uploading a document to PCDC OneDrive. Staff will check it before verifying.');
end;
$$;

create or replace function vitally_private.act_record_document_response(p_member public.memberships,p_case public.cases,p_person public.people,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 return jsonb_build_object(
  'detail',vitally_private.receive_document(p_case,p_payload,'staff_recorded',p_member.user_id,p_person.id),
  'message','The office recorded receiving a document and is awaiting verification.');
end;
$$;
