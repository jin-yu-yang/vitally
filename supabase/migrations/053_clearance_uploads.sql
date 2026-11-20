-- 053: clearance uploads (OpenSpec change add-clearance-uploads, design D1, D5).
--
-- A volunteer says they have sent a document; an admin marks it reviewed.
-- This migration holds the columns, the new clearance answer and the send RPC:
--   §1 the sent dates on the current-season roster entry (design D1);
--   §2 vitally_my_clearance(): the form13615 and photoId items gain sentAt,
--      the answer gains uploadUrl, and capabilities is [] while uncleared
--      (design D5, #193 item 7). Every 052 key stays.
--   §3 vitally_mark_upload_sent(): a volunteer marks their own 13615 or photo ID
--      sent (design D2).
-- Re-appliable: the columns use `if not exists`, the function `create or replace`.

-- 053 §1
alter table public.roster_entries
 add column if not exists form_13615_sent_at timestamptz,
 add column if not exists photo_id_sent_at timestamptz;

-- 053 §2
-- From 052, with these changes marked `-- 053`: sentAt on the two document
-- items, uploadUrl, and empty capabilities when not cleared.
create or replace function public.vitally_my_clearance()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_person public.people;
 v_entry public.roster_entries;
 v_held text[];
 v_missing jsonb='[]'::jsonb;
 v_role text;
 v_lacks text[];
 v_coordinator text;
 v_site_coordinator boolean; -- 052
 v_cleared boolean; -- 053
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
 v_site_coordinator=vitally_private.is_site_coordinator(v_person.workspace_id,v_person.id); -- 052
 v_cleared=vitally_private.cleared(v_person.workspace_id,v_person.id); -- 053
 select r.* into v_entry from public.roster_entries r
  join public.workspaces w on w.id=r.workspace_id and w.current_season=r.season
  where r.workspace_id=v_person.workspace_id and r.person_id=v_person.id;
 if v_entry.person_id is null or cardinality(v_entry.roles)=0 then
  v_missing=v_missing||jsonb_build_array(jsonb_build_object('kind','form13615','sentAt',v_entry.form_13615_sent_at)); -- 053
 end if;
 if v_entry.person_id is not null and v_entry.is_new and v_entry.photo_id_checked_at is null then
  v_missing=v_missing||jsonb_build_array(jsonb_build_object('kind','photoId','sentAt',v_entry.photo_id_sent_at)); -- 053
 end if;
 if v_entry.person_id is not null then
  v_held=vitally_private.confirmed_certificates(v_entry.workspace_id,v_entry.person_id,v_entry.season);
  foreach v_role in array v_entry.roles loop
   v_lacks=vitally_private.missing_certificates(v_role,v_held);
   if cardinality(v_lacks)>0 then
    v_missing=v_missing||jsonb_build_array(jsonb_build_object('kind','role','role',v_role,'certificates',to_jsonb(v_lacks)));
   end if;
  end loop;
  if v_site_coordinator and not ('sc'=any(v_held)) then -- 052
   v_missing=v_missing||jsonb_build_array(jsonb_build_object('kind','siteCoordinator','certificates',jsonb_build_array('SC'))); -- 052
  end if; -- 052
 end if;
 select d.name into v_coordinator from public.workspaces w
  join public.people d on d.workspace_id=w.id and d.id=w.default_followup_person_id
  where w.id=v_person.workspace_id;
 return jsonb_build_object(
  'cleared',v_cleared, -- 053
  'missing',v_missing,
  'capabilities',case when v_cleared then to_jsonb(vitally_private.effective_capabilities(v_person.workspace_id,v_person.id)) else '[]'::jsonb end, -- 053
  'isAdmin',vitally_policy.is_workspace_admin(v_person.workspace_id), -- 052
  'isSiteCoordinator',v_site_coordinator, -- 052
  'siteCoordinatorName',to_jsonb(v_coordinator),
  'siteCheck',exists(select 1 from public.accounts a where a.workspace_id=v_person.workspace_id and a.user_id=v_member.user_id and a.status='invited'),
  'uploadUrl',case when v_entry.person_id is not null then (select s.certificate_upload_url from public.season_settings s where s.workspace_id=v_person.workspace_id) end); -- 053
end;
$$;
revoke all on function public.vitally_my_clearance() from public,anon,authenticated,service_role;
grant execute on function public.vitally_my_clearance() to authenticated;

-- 053 §3
-- A volunteer says they have sent a document (design D2). It writes only the
-- caller's own current-season entry, and bumps the volunteer's revision so an
-- admin's open Edit goes stale.
create or replace function public.vitally_mark_upload_sent(p_action_id uuid, p_document text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_person public.people;
 v_entry public.roster_entries;
 v_receipt record;
 v_digest text;
 v_sent timestamptz;
 v_result jsonb;
begin
 v_member=vitally_private.require_membership();
 select * into v_person from public.people
  where workspace_id=v_member.workspace_id and user_id=v_member.user_id;
 if v_member.access<>'staff' or v_person.id is null then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 if p_action_id is null or p_document is null or p_document not in ('form13615','photoId') then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 select r.* into v_entry from public.roster_entries r
  join public.workspaces w on w.id=r.workspace_id and w.current_season=r.season
  where r.workspace_id=v_person.workspace_id and r.person_id=v_person.id for update of r;
 if v_entry.person_id is null then
  raise sqlstate 'VT007' using message='VALIDATION',detail='NO_ROSTER_ENTRY';
 end if;
 if p_document='photoId' and (not v_entry.is_new or v_entry.photo_id_checked_at is not null) then
  raise sqlstate 'VT007' using message='VALIDATION',detail='PHOTO_ID_NOT_NEEDED';
 end if;
 v_digest=encode(extensions.digest(jsonb_build_object('operation','MARK_UPLOAD_SENT','document',p_document,
  'personId',v_person.id)::text,'sha256'),'hex');
 v_receipt=vitally_private.reserve_receipt(v_member,p_action_id,'MARK_UPLOAD_SENT',v_digest,v_person.id);
 if v_receipt.receipt is not null then
  return v_receipt.receipt;
 end if;
 v_sent=now();
 if p_document='form13615' then
  update public.roster_entries set form_13615_sent_at=v_sent
   where workspace_id=v_entry.workspace_id and person_id=v_entry.person_id and season=v_entry.season;
 else
  update public.roster_entries set photo_id_sent_at=v_sent
   where workspace_id=v_entry.workspace_id and person_id=v_entry.person_id and season=v_entry.season;
 end if;
 update public.volunteer_profiles set revision=revision+1,updated_at=now()
  where workspace_id=v_person.workspace_id and person_id=v_person.id;
 v_result=jsonb_build_object('actionId',p_action_id,'document',p_document,'sentAt',v_sent);
 update public.action_receipts set target_id=v_person.id,receipt=v_result where id=v_receipt.id;
 return v_result;
end;
$$;
revoke all on function public.vitally_mark_upload_sent(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.vitally_mark_upload_sent(uuid,text) to authenticated;
