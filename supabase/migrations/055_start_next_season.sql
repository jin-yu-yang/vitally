-- 055: Start next season (OpenSpec change add-start-next-season, design D5,
-- D6, D10).
--
-- In order:
--   §1 the past-season check: a case numbered in an earlier season than the
--      workspace's current one is read-only (lock_case and
--      vitally_assistance_action);
--   §2 open_work counts only current-season cases;
--   §3 drop vitally_private.capabilities_before_052;
--   §4 the season_starts table;
--   §5 vitally_start_next_season.
-- Replaced functions are copied from their latest migration, with changed
-- lines marked `-- 055`.

-- ---------------------------------------------------------------------------
-- §1. Past seasons are read-only (design D5). lock_case (043) is the one choke
-- point for vitally_apply_action, vitally_log_contact, vitally_edit_contact,
-- vitally_set_case_label and vitally_close_unsigned, for staff and clients
-- alike. A draft has no season yet (010 numbers a case on submit), so it stays
-- writable and submits into the current season. Reads are unchanged: a client
-- still sees their past-season application. No table grant or storage policy
-- lets a signed-in user write a case row directly, so nothing else needs the
-- check.

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
 if v_case.season is not null -- 055
   and v_case.season<>(select w.current_season from public.workspaces w where w.id=v_case.workspace_id) then -- 055
  raise sqlstate 'VT004' using message='INVALID_TRANSITION',detail='PAST_SEASON'; -- 055
 end if; -- 055
 return v_case;
end;
$$;

-- vitally_assistance_action (045): a help request naming a past-season case
-- can't be claimed or resolved. One with no case is unaffected.
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
 if v_item.case_id is not null and exists(select 1 from public.cases c -- 055
   join public.workspaces w on w.id=c.workspace_id -- 055
   where c.workspace_id=v_item.workspace_id and c.id=v_item.case_id -- 055
    and c.season is not null and c.season<>w.current_season) then -- 055
  raise sqlstate 'VT004' using message='INVALID_TRANSITION',detail='PAST_SEASON'; -- 055
 end if; -- 055
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
