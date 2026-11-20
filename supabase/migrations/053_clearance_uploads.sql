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
--   §4 vitally_save_volunteer(): a save clears the sent dates it acts on (design D4).
--   §5 vitally_mark_upload_reviewed(): an admin marks a sent document reviewed
--      (design D3).
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
 -- The stored answer first, so a retry whose answer was lost still gets it; a
 -- refusal below rolls the reservation back.
 v_digest=encode(extensions.digest(jsonb_build_object('operation','MARK_UPLOAD_SENT','document',p_document,
  'personId',v_person.id)::text,'sha256'),'hex');
 v_receipt=vitally_private.reserve_receipt(v_member,p_action_id,'MARK_UPLOAD_SENT',v_digest,v_person.id);
 if v_receipt.receipt is not null then
  return v_receipt.receipt;
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
 if not found then -- 053
  raise sqlstate 'VT002' using message='NOT_FOUND'; -- 053
 end if; -- 053
 v_result=jsonb_build_object('actionId',p_action_id,'document',p_document,'sentAt',v_sent);
 update public.action_receipts set target_id=v_person.id,receipt=v_result where id=v_receipt.id;
 return v_result;
end;
$$;
revoke all on function public.vitally_mark_upload_sent(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.vitally_mark_upload_sent(uuid,text) to authenticated;

-- 053 §4
-- From 052, with these changes marked `-- 053`: the roster entry write clears
-- form_13615_sent_at when the save changes the roles or the confirmed
-- certificates, and photo_id_sent_at when it ticks Photo ID checked or unticks
-- New volunteer (design D4). The signature, payload and every other rule stay.
create or replace function public.vitally_save_volunteer(p_action_id uuid,p_volunteer_id uuid,p_expected_revision bigint,p_volunteer jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_person public.people;
 v_receipt public.action_receipts;
 v_profile public.volunteer_profiles;
 v_entry public.roster_entries;
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
 v_requested text[];
 v_roles text[]='{}';
 v_role text;
 v_missing text[];
 v_certificates text[];
 v_is_new boolean;
 v_photo_checked_at timestamptz;
 v_stored_roles text[]='{}'; -- 052
 v_capabilities text[];
 v_cleared boolean;
 v_was_capable text[];
 v_was_cleared boolean;
 v_default_met boolean; -- 052
 v_caller_coordinator boolean; -- 052
 v_open_work jsonb;
 v_clear_13615 boolean=false; -- 053
 v_result jsonb;
begin
 v_member=vitally_private.require_membership();
 v_person=vitally_private.acting_person(v_member);
 -- The workspace admin check (design D2): a site coordinator, or the Admin -- 052
 -- role this season, cleared or not. -- 052
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
 -- Only a site coordinator adds or removes the Admin role (design D3), -- 052
 -- refused before the receipt is reserved. -- 052
 v_caller_coordinator=vitally_private.is_site_coordinator(v_member.workspace_id,v_person.id); -- 052
 if p_volunteer_id is not null then -- 052
  select r.roles into v_stored_roles from public.roster_entries r -- 052
   join public.workspaces w on w.id=r.workspace_id and w.current_season=r.season -- 052
   where r.workspace_id=v_member.workspace_id and r.person_id=p_volunteer_id; -- 052
 end if; -- 052
 if not v_caller_coordinator -- 052
  and ('admin'=any(coalesce(v_stored_roles,'{}'::text[])))<>(jsonb_typeof(p_volunteer->'roles')='array' and p_volunteer->'roles' ? 'admin') then -- 052
  raise sqlstate 'VT001' using message='ADMIN_ROLE'; -- 052
 end if; -- 052
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
 if array(select k from jsonb_object_keys(p_volunteer) k order by k collate "C")
   <>array['certificates','email','isNew','languages','name','otherLanguage','phone','photoIdChecked','roles','works']::text[]
  or jsonb_typeof(p_volunteer->'name')<>'string' or jsonb_typeof(p_volunteer->'email')<>'string'
  or jsonb_typeof(p_volunteer->'works')<>'string'
  or jsonb_typeof(p_volunteer->'phone') not in ('string','null')
  or jsonb_typeof(p_volunteer->'otherLanguage') not in ('string','null')
  or jsonb_typeof(p_volunteer->'isNew')<>'boolean'
  or jsonb_typeof(p_volunteer->'photoIdChecked')<>'boolean' then
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
 v_requested=array(select jsonb_array_elements_text(p_volunteer->'roles'));
 v_certificates=array(select jsonb_array_elements_text(p_volunteer->'certificates'));
 v_is_new=(p_volunteer->'isNew')::boolean;
 if length(v_name) not between 1 and 80
  or length(v_email)>254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@.]+(\.[^[:space:]@.]+)+$'
  or length(v_phone)>30
  or v_works not in ('on_site','remote','on_site_and_remote')
  or not (v_languages <@ array['english','mandarin','cantonese','other']::text[])
  or cardinality(v_languages)<>(select count(distinct c) from unnest(v_languages) c)
  or length(v_other)>40
  or (v_other is not null)<>('other'=any(v_languages))
  or not (v_requested <@ array['greeter','intaker','preparer','reviewer','admin']::text[])
  or cardinality(v_requested)<>(select count(distinct c) from unnest(v_requested) c)
  or not (v_certificates <@ array['vsc','itqr','sc','basic','advanced']::text[])
  or cardinality(v_certificates)<>(select count(distinct c) from unnest(v_certificates) c) then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 if exists(select 1 from public.volunteer_profiles
  where workspace_id=v_member.workspace_id and email=v_email and person_id is distinct from p_volunteer_id) then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 select current_season into v_season from public.workspaces where id=v_member.workspace_id;
 if p_volunteer_id is not null then
  select user_id into v_target_user from public.people where id=p_volunteer_id; -- 052
  -- A sign-in's address belongs to its account.
  if v_target_user is not null and v_email<>v_profile.email then
   raise sqlstate 'VT007' using message='VALIDATION';
  end if;
  select * into v_entry from public.roster_entries
   where workspace_id=v_member.workspace_id and person_id=p_volunteer_id and season=v_season for update;
 end if;

 -- Each requested role against the ticked certificates. A role the entry
 -- already holds had its certificates (role_certificates_check), so one that
 -- lacks one now lost it in this save, and is dropped with it.
 foreach v_role in array v_requested loop
  v_missing=vitally_private.missing_certificates(v_role,v_certificates);
  if cardinality(v_missing)=0 then
   v_roles=v_roles||v_role;
  elsif not (v_role=any(coalesce(v_entry.roles,'{}'::text[]))) then
   raise sqlstate 'VT007' using message='ROLE_NEEDS',detail=v_role||': '||array_to_string(v_missing,', ');
  end if;
 end loop;
 -- Whether this save acts on a sent Form 13615 (design D4): the roles change as -- 053
 -- sets, or the confirmed certificates change, which includes an uploaded -- 053
 -- certificate being confirmed. Computed before the certificate writes. -- 053
 if v_entry.person_id is not null then -- 053
  v_clear_13615=array(select r from unnest(v_roles) r order by r collate "C") -- 053
    is distinct from array(select r from unnest(v_entry.roles) r order by r collate "C") -- 053
   or vitally_private.confirmed_certificates(v_member.workspace_id,v_target_id,v_season) -- 053
    is distinct from array(select c from unnest(v_certificates) c order by c collate "C") -- 053
   or exists(select 1 from public.certificates c where c.workspace_id=v_member.workspace_id -- 053
    and c.person_id=v_target_id and c.season=v_season and c.status='uploaded' and c.certificate=any(v_certificates)); -- 053
 end if; -- 053
 -- A photo ID check that stays ticked keeps its time.
 if (p_volunteer->'photoIdChecked')::boolean then
  v_photo_checked_at=coalesce(v_entry.photo_id_checked_at,now());
 end if;
 -- A non-site-coordinator cannot remove the Admin role by unticking a -- 052
 -- certificate it needs either (design D3). -- 052
 if not v_caller_coordinator and 'admin'=any(coalesce(v_entry.roles,'{}'::text[])) and not ('admin'=any(v_roles)) then -- 052
  raise sqlstate 'VT001' using message='ADMIN_ROLE'; -- 052
 end if; -- 052

 -- The open-work rule (design D7): the role capabilities and clearance -- 052
 -- now, before any write, against those of the would-be roles. -- 052
 -- Only what this save takes away counts: a capability the work -- 052
 -- needs that they hold now and would lose, or clearance they hold now and
 -- would lose while holding any work (then all of it is listed). A person
 -- who already lacks either can still be saved. A site coordinator meets -- 052
 -- the default follow-up person's need whatever their roles or clearance. -- 052
 if p_volunteer_id is not null then
  v_was_capable=vitally_private.role_capabilities(coalesce(v_entry.roles,'{}'::text[])); -- 052
  v_was_cleared=vitally_private.cleared(v_member.workspace_id,p_volunteer_id);
  v_capabilities=vitally_private.role_capabilities(v_roles); -- 052
  -- A site coordinator also needs SC ticked to stay cleared (design D6); an -- 052
  -- uploaded SC left unticked doesn't count. -- 052
  v_default_met=vitally_private.is_site_coordinator(v_member.workspace_id,p_volunteer_id); -- 052
  v_cleared=cardinality(v_roles)>0 and (not v_is_new or v_photo_checked_at is not null)
   and (not v_default_met or 'sc'=any(v_certificates)); -- 052
  select jsonb_agg(w.label) into v_open_work from vitally_private.open_work(v_member.workspace_id,p_volunteer_id) w
   where not (v_default_met and w.label='default follow-up person') and ( -- 052
    (v_was_cleared and not v_cleared) -- 052
    or (w.needs=any(v_was_capable) and not (w.needs=any(v_capabilities)))); -- 052
  if v_open_work is not null then
   raise sqlstate 'VT004' using message='OPEN_WORK',detail=v_open_work::text;
  end if;
 end if;

 begin
  if p_volunteer_id is null then
   insert into public.people(workspace_id,person_key,name,capabilities)
    values(v_member.workspace_id,'v_'||substr(replace(gen_random_uuid()::text,'-',''),1,12),v_name,'{}')
    returning id into v_target_id;
   insert into public.volunteer_profiles(workspace_id,person_id,email,phone,works,languages,other_language)
    values(v_member.workspace_id,v_target_id,v_email,v_phone,v_works,v_languages,v_other);
  else
   update public.people set name=v_name where id=p_volunteer_id;
   update public.volunteer_profiles set email=v_email,phone=v_phone,works=v_works,languages=v_languages,
     other_language=v_other,revision=v_revision,updated_at=now()
    where workspace_id=v_member.workspace_id and person_id=p_volunteer_id;
  end if;
  insert into public.roster_entries(workspace_id,person_id,season,roles,added_by_person_id,is_new,photo_id_checked_at)
   values(v_member.workspace_id,v_target_id,v_season,v_roles,v_person.id,v_is_new,v_photo_checked_at)
   on conflict(workspace_id,person_id,season) do update
    set roles=excluded.roles,is_new=excluded.is_new,photo_id_checked_at=excluded.photo_id_checked_at, -- 053
     form_13615_sent_at=case when v_clear_13615 then null else public.roster_entries.form_13615_sent_at end, -- 053
     photo_id_sent_at=case when (v_entry.photo_id_checked_at is null and v_photo_checked_at is not null) -- 053
       or (coalesce(v_entry.is_new,false) and not v_is_new) then null else public.roster_entries.photo_id_sent_at end; -- 053
  -- Only a confirmed certificate an admin has unticked is deleted: an uploaded
  -- one is the volunteer's own and stays (design D14). A sent certificate is
  -- inserted confirmed, or confirms an uploaded row; a confirmed row that stays
  -- ticked keeps its time and confirmer.
  delete from public.certificates where workspace_id=v_member.workspace_id and person_id=v_target_id
   and season=v_season and status='confirmed' and certificate<>all(v_certificates);
  insert into public.certificates(workspace_id,person_id,season,certificate,status,confirmed_at,confirmed_by_person_id)
   select v_member.workspace_id,v_target_id,v_season,c,'confirmed',now(),v_person.id from unnest(v_certificates) c
   on conflict(workspace_id,person_id,season,certificate) do update
    set status='confirmed',confirmed_at=excluded.confirmed_at,confirmed_by_person_id=excluded.confirmed_by_person_id
    where public.certificates.status='uploaded';
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

-- 053 §5
-- An admin marks a sent document reviewed (design D3). It follows Save: the same
-- opening, argument order, refusals and result. When nothing is waiting it
-- writes nothing and returns the current revision.
create or replace function public.vitally_mark_upload_reviewed(p_action_id uuid, p_volunteer_id uuid, p_expected_revision bigint, p_document text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_person public.people;
 v_receipt public.action_receipts;
 v_profile public.volunteer_profiles;
 v_digest text;
 v_season smallint;
 v_waiting boolean;
 v_revision bigint;
 v_result jsonb;
begin
 v_member=vitally_private.require_membership();
 v_person=vitally_private.acting_person(v_member);
 if v_member.access<>'staff' or v_person.id is null or not vitally_policy.is_workspace_admin(v_member.workspace_id) then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 if p_action_id is null or p_volunteer_id is null or p_expected_revision is null
  or p_document is null or p_document not in ('form13615','photoId') then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 v_digest=encode(extensions.digest(jsonb_build_object('operation','MARK_UPLOAD_REVIEWED','volunteerId',p_volunteer_id,
  'expectedRevision',p_expected_revision,'document',p_document,'personId',v_person.id)::text,'sha256'),'hex');
 v_receipt=vitally_private.reserve_receipt(v_member,p_action_id,'MARK_UPLOAD_REVIEWED',v_digest,v_person.id);
 if v_receipt.receipt is not null then
  return v_receipt.receipt;
 end if;
 select * into v_profile from public.volunteer_profiles
  where workspace_id=v_member.workspace_id and person_id=p_volunteer_id for update;
 if not found then
  raise sqlstate 'VT002' using message='NOT_FOUND';
 end if;
 if v_profile.revision<>p_expected_revision then
  raise sqlstate 'VT003' using message='CONFLICT';
 end if;
 v_revision=v_profile.revision;
 select current_season into v_season from public.workspaces where id=v_member.workspace_id;
 if p_document='form13615' then
  update public.roster_entries set form_13615_sent_at=null
   where workspace_id=v_member.workspace_id and person_id=p_volunteer_id and season=v_season and form_13615_sent_at is not null;
 else
  update public.roster_entries set photo_id_sent_at=null
   where workspace_id=v_member.workspace_id and person_id=p_volunteer_id and season=v_season and photo_id_sent_at is not null;
 end if;
 v_waiting=found;
 if v_waiting then
  v_revision=v_profile.revision+1;
  update public.volunteer_profiles set revision=v_revision,updated_at=now()
   where workspace_id=v_member.workspace_id and person_id=p_volunteer_id;
 end if;
 v_result=jsonb_build_object('actionId',p_action_id,'personId',p_volunteer_id,'revision',v_revision);
 update public.action_receipts set target_id=p_volunteer_id,receipt=v_result where id=v_receipt.id;
 return v_result;
end;
$$;
revoke all on function public.vitally_mark_upload_reviewed(uuid,uuid,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.vitally_mark_upload_reviewed(uuid,uuid,bigint,text) to authenticated;
