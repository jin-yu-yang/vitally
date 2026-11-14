-- 047: a close after a filing says what was filed (issue #170, OpenSpec change
-- fix-closed-lines-after-filing). A case closed after a return was filed was
-- told "Your return was not filed". The close history line now reads what each
-- return is, and the staff notice no longer says "closed before filing" for a
-- return that was filed.
--
-- THE NUMBER 047 IS PROVISIONAL: it is final only when this change's pull
-- request is merged, and is renumbered if another migration takes it first.
--
--   * vitally_private.return_outcome (new): one return's outcome (design D1).
--   * vitally_private.closed_line (new, five arguments): the reason, the filing
--     method and result of each return. Replaces closed_line(text) from 036,
--     which is dropped at the end.
--   * act_close_case: verbatim from 043, with the lines marked -- 047 changed
--     (the message, and the staff notice after a filing).
--   * public.vitally_close_unsigned: verbatim from 045, with the closed_line
--     call marked -- 047 changed.
-- CREATE OR REPLACE keeps each signature; the revoke and grant of
-- vitally_close_unsigned are re-applied as in 045.

-- ---------------------------------------------------------------------------
-- 1. return_outcome: accepted, waiting for an answer, on paper, or not filed
-- (rejected, or no method). "No Pennsylvania return needed" is not told apart
-- from not filed.

create or replace function vitally_private.return_outcome(p_method text,p_result text) returns text
language sql immutable security definer set search_path='' as $$
 select case
  when p_result='accepted' then 'accepted'
  when p_result='given_to_client' or (p_method='paper' and p_result is null) then 'paper'
  when p_method='efile' and p_result is null then 'waiting'
  else 'not_filed'
 end;
$$;

-- ---------------------------------------------------------------------------
-- 2. closed_line: the client's line for each closing reason. With a filed
-- return, a close for dismissed, withdrawn, out_of_scope or no_need_to_file
-- reads the reason, the federal sentence, then the Pennsylvania sentence,
-- joined by one space. Every other case keeps 036's line.

create or replace function vitally_private.closed_line(p_reason text,p_federal_method text,p_federal_result text,p_state_method text,p_state_result text) returns text
language sql immutable security definer set search_path='' as $$
 select case
  when p_reason in ('dismissed','withdrawn','out_of_scope','no_need_to_file')
   and (o.federal<>'not_filed' or o.state<>'not_filed') then
   (case p_reason
    when 'dismissed' then 'PCDC could not reach you, so this application was closed.'
    when 'withdrawn' then 'You withdrew this application.'
    when 'out_of_scope' then 'This application was closed because the return is outside what VITA volunteers can prepare.'
    else 'A PCDC volunteer confirmed with you that nothing more needs to be prepared this year, so this application was closed.'
   end)
   || ' ' ||
   (case o.federal
    when 'accepted' then 'Your federal return was filed and accepted. Do not file it again.'
    when 'waiting' then 'Your federal return was e-filed and is waiting for an answer. Do not file it again.'
    when 'paper' then 'PCDC gave you your federal return on paper. It is filed only after you mail it.'
    else 'Your federal return was not filed.'
   end)
   || ' ' ||
   (case o.state
    when 'accepted' then 'Your Pennsylvania return was filed and accepted. Do not file it again.'
    when 'waiting' then 'Your Pennsylvania return was e-filed and is waiting for an answer. Do not file it again.'
    when 'paper' then 'PCDC gave you your Pennsylvania return on paper. It is filed only after you mail it.'
    else 'Your Pennsylvania return was not filed.'
   end)
  else
   case p_reason
    when 'out_of_scope' then 'This application was closed because the return is outside what VITA volunteers can prepare. Your return was not filed by PCDC.'
    when 'no_need_to_file' then 'A PCDC volunteer confirmed with you that you don''t need to file a return this year, so this application was closed.'
    when 'duplicate' then 'This application was closed. Your return continues under your other application with PCDC.'
    when 'dismissed' then 'PCDC could not reach you, so this application was closed. Your return was not filed.'
    when 'withdrawn' then 'You withdrew this application. Your return was not filed.'
    else 'Your application was closed by the office. This does not change any return filed elsewhere. Contact PCDC if you have questions.'
   end
 end
 from (select vitally_private.return_outcome(p_federal_method,p_federal_result) as federal,
  vitally_private.return_outcome(p_state_method,p_state_result) as state) o;
$$;
revoke all on function vitally_private.return_outcome(text,text) from public,anon,authenticated,service_role;
revoke all on function vitally_private.closed_line(text,text,text,text,text) from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- 3. act_close_case, verbatim from 043 with the message and the staff notice
-- after a filing changed (-- 047).

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
    when vitally_private.return_outcome(p_case.federal_method,p_case.federal_result)<>'not_filed' -- 047
     or vitally_private.return_outcome(p_case.state_method,p_case.state_result)<>'not_filed' -- 047
    then 'The case was closed after a return was filed; make sure the rejected return is not transmitted again in TaxSlayer.' -- 047
    else 'The case was closed before filing; make sure the return is not transmitted in TaxSlayer.' end, -- 036
   v_assignee.id); -- 036
 end if; -- 036
 -- The reason and note are staff context: case_events is staff-only, and the client
 -- message says plainly that an office decision, not a filing, has changed.
 return jsonb_build_object('detail',jsonb_build_object('reason',p_payload->>'reason') -- 036
   ||case when p_payload ? 'note' then jsonb_build_object('note',p_payload->>'note') else '{}'::jsonb end, -- 036
  'message',vitally_private.closed_line(p_payload->>'reason',p_case.federal_method,p_case.federal_result,p_case.state_method,p_case.state_result)); -- 047
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. vitally_close_unsigned, verbatim from 045 with the closed_line call
-- changed (-- 047).

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
  values(v_case.workspace_id,v_case.id,'CLOSE_CASE',vitally_private.closed_line('dismissed',v_case.federal_method,v_case.federal_result,v_case.state_method,v_case.state_result)); -- 047
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

-- ---------------------------------------------------------------------------
-- 5. The one-argument closed_line is gone, so no caller can fall back to the
-- reason-only rule. Its only callers in a latest definition were the two
-- functions above (checked with grep over every migration).

drop function vitally_private.closed_line(text);
