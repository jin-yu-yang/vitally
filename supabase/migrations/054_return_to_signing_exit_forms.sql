-- 054: the corrected values entered at Return to signing (OpenSpec change
-- add-exit-form-at-return-to-signing, design D1, D7).
--
-- One row per Return to signing event that carried corrected values. Staff
-- read it under the same gate as the reviewer questionnaire (cleared staff,
-- no private client draft); nobody writes it directly, only the action's
-- handler, which runs as a definer. `check_exit_form` (033) is reused as it
-- is, so no account number or routing number can ever be stored.
--
-- apply_fixture_scenario is not copied here: migration 040 dropped it with the
-- sample cases, and the rows go with their case through the cascade.

create table public.return_to_signing_exit_forms (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 case_id uuid not null,
 entered_by_person_id uuid not null,
 created_at timestamptz not null default now(),
 exit_form jsonb not null,
 remarks text,
 foreign key (workspace_id,case_id) references public.cases(workspace_id,id) on delete cascade,
 foreign key (workspace_id,entered_by_person_id) references public.people(workspace_id,id),
 check(vitally_private.check_exit_form(exit_form)),
 check(remarks is null or char_length(remarks) between 1 and 2000)
);
create index return_to_signing_exit_forms_case_idx on public.return_to_signing_exit_forms(workspace_id,case_id,created_at);

alter table public.return_to_signing_exit_forms enable row level security;
create policy staff_return_to_signing_exit_forms on public.return_to_signing_exit_forms for select to authenticated using(exists(select 1 from public.memberships m join public.cases c on c.workspace_id=m.workspace_id and c.id=return_to_signing_exit_forms.case_id where m.workspace_id=return_to_signing_exit_forms.workspace_id and m.user_id=(select auth.uid()) and m.active and m.access='staff' and (c.origin<>'client' or c.stage<>'draft') and return_to_signing_exit_forms.workspace_id=(select vitally_policy.cleared_workspace_id())));
revoke all on public.return_to_signing_exit_forms from public, anon, authenticated;
grant select on public.return_to_signing_exit_forms to authenticated;
grant select, insert, update, delete on public.return_to_signing_exit_forms to service_role;

-- Realtime, with 033's pattern.
do $$
begin
 if not exists(select 1 from pg_publication where pubname='supabase_realtime') then
  raise exception 'The supabase_realtime publication is missing; enable Realtime on this project before migrating.';
 end if;
 if not exists(
  select 1 from pg_publication_tables
  where pubname='supabase_realtime' and schemaname='public' and tablename='return_to_signing_exit_forms'
 ) then
  alter publication supabase_realtime add table public.return_to_signing_exit_forms;
 end if;
end $$;

-- ---------------------------------------------------------------------------
-- check_payload, verbatim from 046 with RETURN_TO_SIGNING split out of the
-- shared confirmation branch.

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
revoke all on function vitally_private.check_payload(text,jsonb) from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- act_return_to_signing, from 035: the corrected Exit Form values (D2, D3).
-- A group is allowed only for a return the case filed, and a return that was
-- accepted keeps its filing method; a rejected one may change it.

create or replace function vitally_private.act_return_to_signing(p_member public.memberships,p_case public.cases,p_person public.people,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_kind text; -- 054
 v_method text; -- 054
 v_result text; -- 054
 v_group jsonb; -- 054
 v_given boolean; -- 054
 v_id uuid; -- 054
 v_detail jsonb:='{}'::jsonb; -- 054
begin
 if p_case.stage<>'rejected'
  or (p_case.federal_method is not null and p_case.federal_result is null)
  or (p_case.state_method is not null and p_case.state_result is null) then
  raise sqlstate 'VT004' using message='INVALID_TRANSITION';
 end if;
 if p_payload ? 'exitForm' then -- 054
  foreach v_kind in array array['federal','state'] loop -- 054
   v_group:=p_payload->'exitForm'->v_kind; -- 054
   if jsonb_typeof(v_group)<>'null' then -- 054
    v_method:=case v_kind when 'federal' then p_case.federal_method else p_case.state_method end; -- 054
    v_result:=case v_kind when 'federal' then p_case.federal_result else p_case.state_result end; -- 054
    if v_method is null or (v_result<>'rejected' and v_group->>'method'<>v_method) then -- 054
     raise sqlstate 'VT007' using message='VALIDATION'; -- 054
    end if; -- 054
   end if; -- 054
  end loop; -- 054
 end if; -- 054
 v_given:=(p_payload ? 'remarks') -- 054
  or (p_payload ? 'exitForm' and (jsonb_typeof(p_payload->'exitForm'->'federal')<>'null' -- 054
   or jsonb_typeof(p_payload->'exitForm'->'state')<>'null' -- 054
   or jsonb_array_length(p_payload->'exitForm'->'local')>0)); -- 054
 update public.cases set stage='review_approved' where id=p_case.id;
 if v_given then -- 054
  insert into public.return_to_signing_exit_forms(workspace_id,case_id,entered_by_person_id,exit_form,remarks) -- 054
  values(p_case.workspace_id,p_case.id,p_person.id, -- 054
   coalesce(p_payload->'exitForm','{"federal":null,"state":null,"local":[]}'::jsonb), -- 054
   case when p_payload ? 'remarks' then btrim(p_payload->>'remarks') end) returning id into v_id; -- 054
  v_detail:=jsonb_build_object('exitFormId',v_id); -- 054
 end if; -- 054
 return jsonb_build_object('detail',v_detail, -- 054
  'message','PCDC corrected your return. You need to sign it again.');
end; $$;
