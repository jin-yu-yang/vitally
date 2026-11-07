-- 041: a go-over task resolved while the case is on Hold switches the signing
-- plan (issue #171; no contract change).
--
-- 033's `act_resolve_followup` switched a Go over first case to the reviewer's
-- signing method only when the case was at Ready to exit (`review_approved`).
-- 036 then let the office put a Ready to exit case on Hold, and the go-over task
-- stays open during the Hold. Resolving it there skipped the switch, and Got in
-- touch only copies `hold_origin` back into the stage, so the client kept reading
-- "PCDC will contact you to go over your return" after the office had done so.
-- The canonical specs say resolving the go-over task, with either outcome,
-- switches the plan (office-follow-up, "The office works a go-over follow-up
-- like any other"; case-lifecycle, the Ready to exit variants).
--
-- `act_resolve_followup` is copied from 033, its latest definition. The one
-- changed line ends `-- 041`: the switch also runs on a Hold that came from
-- Ready to exit. The client sees the hold message until Got in touch, then the
-- signing variant. Cases that already resumed with the old plan are left as
-- they are; this migration repairs no rows.

create or replace function vitally_private.act_resolve_followup(p_member public.memberships,p_case public.cases,p_person public.people,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_followup public.admin_followups;
 v_q public.reviewer_questionnaires; -- 033
 v_plan text; -- 033
begin
 v_followup=vitally_private.lock_open_followup(p_case,p_person,p_payload);
 -- Resolution closes the contact task only: the document request, its
 -- verification, the preparer and the participants are all left as they are.
 update public.admin_followups set status='resolved',resolution_outcome=p_payload->>'outcome',
  resolution_note=p_payload->>'note',resolved_at=now() where id=v_followup.id;
 if v_followup.purpose='go_over_return' and (p_case.stage='review_approved' or (p_case.stage='on_hold' and p_case.hold_origin='review_approved')) and p_case.signing_plan='go_over_first' then -- 041
  select q.* into v_q from public.reviewer_questionnaires q -- 033
   join public.reviews r on r.id=q.review_id and r.status='approved' -- 033
   where q.workspace_id=p_case.workspace_id and q.case_id=p_case.id -- 033
   order by r.created_at desc limit 1; -- 033
  if found then -- 033
   v_plan=case when v_q.sign_method='portal' then 'portal' -- 033
    when coalesce(p_case.answers->>'service'='same_day',false) then 'same_day' else 'appointment' end; -- 033
   update public.cases set signing_plan=v_plan, -- 033
    signing_appointment_at=case when v_plan='appointment' then v_q.sign_appointment_at else null end -- 033
    where id=p_case.id; -- 033
  end if; -- 033
 end if; -- 033
 return jsonb_build_object('detail',jsonb_build_object('followupId',v_followup.id,'outcome',p_payload->>'outcome'));
end;
$$;

revoke all on all functions in schema vitally_private from public,anon,authenticated,service_role;
