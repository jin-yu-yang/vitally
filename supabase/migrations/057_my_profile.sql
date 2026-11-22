-- 057: My profile (OpenSpec change add-my-profile, design D3, D4).
--
-- Sections:
--   §1 the review columns on roster_entries, usual_days on volunteer_profiles;
--   §2 vitally_my_clearance(): items gain reviewedAt and reviewReason, and
--      uploadUrl is null while the site check is owed;
--   §3 vitally_mark_upload_sent(): sending again clears the reviewed pair;
--   §4 vitally_save_volunteer(): accepts usualDays, and clears the reviewed pairs
--      with the sent dates;
--   §5 vitally_mark_upload_reviewed(): a required reason, stored with the time
--      (the four-argument version is dropped);
--   §6 vitally_my_profile(): the caller's own profile read;
--   §7 vitally_save_my_profile(): the caller's own details save.

-- 057 §1
alter table public.roster_entries
 add column form_13615_reviewed_at timestamptz,
 add column form_13615_review_reason text,
 add column photo_id_reviewed_at timestamptz,
 add column photo_id_review_reason text,
 add constraint roster_entries_13615_review_pair check (
  (form_13615_reviewed_at is null and form_13615_review_reason is null)
  or (form_13615_reviewed_at is not null and form_13615_review_reason=btrim(form_13615_review_reason,E' \t\n\r') and char_length(form_13615_review_reason) between 1 and 120)),
 add constraint roster_entries_photo_review_pair check (
  (photo_id_reviewed_at is null and photo_id_review_reason is null)
  or (photo_id_reviewed_at is not null and photo_id_review_reason=btrim(photo_id_review_reason,E' \t\n\r') and char_length(photo_id_review_reason) between 1 and 120));
alter table public.volunteer_profiles
 add column usual_days text[] not null default '{}',
 add constraint volunteer_profiles_usual_days check (
  usual_days <@ array['mon','tue','wed','thu','fri','sat','sun']::text[]
  and cardinality(usual_days)=('mon'=any(usual_days))::int+('tue'=any(usual_days))::int+('wed'=any(usual_days))::int
   +('thu'=any(usual_days))::int+('fri'=any(usual_days))::int+('sat'=any(usual_days))::int+('sun'=any(usual_days))::int);

-- 057 §2
-- From 053, with these changes marked `-- 057`: reviewedAt and reviewReason on
-- the two document items, and uploadUrl null while the site check is owed.
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
 v_site_check boolean; -- 057
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
 v_site_check=exists(select 1 from public.accounts a where a.workspace_id=v_person.workspace_id and a.user_id=v_member.user_id and a.status='invited'); -- 057
 select r.* into v_entry from public.roster_entries r
  join public.workspaces w on w.id=r.workspace_id and w.current_season=r.season
  where r.workspace_id=v_person.workspace_id and r.person_id=v_person.id;
 if v_entry.person_id is null or cardinality(v_entry.roles)=0 then
  v_missing=v_missing||jsonb_build_array(jsonb_build_object('kind','form13615','sentAt',v_entry.form_13615_sent_at,'reviewedAt',v_entry.form_13615_reviewed_at,'reviewReason',v_entry.form_13615_review_reason)); -- 057
 end if;
 if v_entry.person_id is not null and v_entry.is_new and v_entry.photo_id_checked_at is null then
  v_missing=v_missing||jsonb_build_array(jsonb_build_object('kind','photoId','sentAt',v_entry.photo_id_sent_at,'reviewedAt',v_entry.photo_id_reviewed_at,'reviewReason',v_entry.photo_id_review_reason)); -- 057
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
  'siteCheck',v_site_check, -- 057
  'uploadUrl',case when v_entry.person_id is not null and not v_site_check then (select s.certificate_upload_url from public.season_settings s where s.workspace_id=v_person.workspace_id) end); -- 057
end;
$$;
revoke all on function public.vitally_my_clearance() from public,anon,authenticated,service_role;
grant execute on function public.vitally_my_clearance() to authenticated;

-- 057 §3
-- A volunteer says they have sent a document (design D2). It writes only the
-- caller's own current-season entry, and bumps the volunteer's revision so an
-- admin's open Edit goes stale. From 053, with these changes marked `-- 057`:
-- sending again clears the reviewed pair.
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
 -- The lock order vitally_save_volunteer and vitally_mark_upload_reviewed
 -- share: the volunteer's profile row first, then the roster entry, so a send
 -- and an admin's Save or Mark reviewed on the same volunteer cannot deadlock.
 perform 1 from public.volunteer_profiles
  where workspace_id=v_person.workspace_id and person_id=v_person.id for update;
 if not found then
  raise sqlstate 'VT002' using message='NOT_FOUND';
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
  update public.roster_entries set form_13615_sent_at=v_sent,form_13615_reviewed_at=null,form_13615_review_reason=null -- 057
   where workspace_id=v_entry.workspace_id and person_id=v_entry.person_id and season=v_entry.season;
 else
  update public.roster_entries set photo_id_sent_at=v_sent,photo_id_reviewed_at=null,photo_id_review_reason=null -- 057
   where workspace_id=v_entry.workspace_id and person_id=v_entry.person_id and season=v_entry.season;
 end if;
 -- The profile row is locked above, so this update finds it.
 update public.volunteer_profiles set revision=revision+1,updated_at=now()
  where workspace_id=v_person.workspace_id and person_id=v_person.id;
 v_result=jsonb_build_object('actionId',p_action_id,'document',p_document,'sentAt',v_sent);
 update public.action_receipts set target_id=v_person.id,receipt=v_result where id=v_receipt.id;
 return v_result;
end;
$$;
revoke all on function public.vitally_mark_upload_sent(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.vitally_mark_upload_sent(uuid,text) to authenticated;

-- 057 §4
-- From 053 §4, with these changes marked `-- 057`: the payload may carry usualDays
-- (the ten keys, or the ten plus usualDays), and the roster entry write clears the
-- reviewed pair of each document under the conditions that clear its sent date.
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
 v_days text[]; -- 057
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
   not in (array['certificates','email','isNew','languages','name','otherLanguage','phone','photoIdChecked','roles','works']::text[], -- 057
    array['certificates','email','isNew','languages','name','otherLanguage','phone','photoIdChecked','roles','usualDays','works']::text[]) -- 057
  or jsonb_typeof(p_volunteer->'name')<>'string' or jsonb_typeof(p_volunteer->'email')<>'string'
  or jsonb_typeof(p_volunteer->'works')<>'string'
  or jsonb_typeof(p_volunteer->'phone') not in ('string','null')
  or jsonb_typeof(p_volunteer->'otherLanguage') not in ('string','null')
  or jsonb_typeof(p_volunteer->'isNew')<>'boolean'
  or jsonb_typeof(p_volunteer->'photoIdChecked')<>'boolean' then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 if p_volunteer ? 'usualDays' then -- 057
  if jsonb_typeof(p_volunteer->'usualDays')<>'array' -- 057
   or exists(select 1 from jsonb_array_elements(p_volunteer->'usualDays') e where jsonb_typeof(e)<>'string') then -- 057
   raise sqlstate 'VT007' using message='VALIDATION'; -- 057
  end if; -- 057
  v_days=array(select jsonb_array_elements_text(p_volunteer->'usualDays')); -- 057
  if not (v_days <@ array['mon','tue','wed','thu','fri','sat','sun']::text[]) -- 057
   or cardinality(v_days)<>(select count(distinct d) from unnest(v_days) d) then -- 057
   raise sqlstate 'VT007' using message='VALIDATION'; -- 057
  end if; -- 057
  v_days=array(select d from unnest(v_days) d order by array_position(array['mon','tue','wed','thu','fri','sat','sun'], d)); -- 057
 end if; -- 057
 foreach v_key in array array['languages','roles','certificates'] loop
  if jsonb_typeof(p_volunteer->v_key)<>'array'
   or exists(select 1 from jsonb_array_elements(p_volunteer->v_key) e where jsonb_typeof(e)<>'string') then
   raise sqlstate 'VT007' using message='VALIDATION';
  end if;
 end loop;
 v_name=btrim(p_volunteer->>'name',E' \t\n\r'); -- 057
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
   insert into public.volunteer_profiles(workspace_id,person_id,email,phone,works,languages,other_language,usual_days) -- 057
    values(v_member.workspace_id,v_target_id,v_email,v_phone,v_works,v_languages,v_other,coalesce(v_days,'{}'::text[])); -- 057
  else
   update public.people set name=v_name where id=p_volunteer_id;
   update public.volunteer_profiles set email=v_email,phone=v_phone,works=v_works,languages=v_languages,
     other_language=v_other,usual_days=coalesce(v_days,usual_days),revision=v_revision,updated_at=now() -- 057
    where workspace_id=v_member.workspace_id and person_id=p_volunteer_id;
  end if;
  insert into public.roster_entries(workspace_id,person_id,season,roles,added_by_person_id,is_new,photo_id_checked_at)
   values(v_member.workspace_id,v_target_id,v_season,v_roles,v_person.id,v_is_new,v_photo_checked_at)
   on conflict(workspace_id,person_id,season) do update
    set roles=excluded.roles,is_new=excluded.is_new,photo_id_checked_at=excluded.photo_id_checked_at, -- 053
     form_13615_sent_at=case when v_clear_13615 then null else public.roster_entries.form_13615_sent_at end, -- 053
     form_13615_reviewed_at=case when v_clear_13615 then null else public.roster_entries.form_13615_reviewed_at end, -- 057
     form_13615_review_reason=case when v_clear_13615 then null else public.roster_entries.form_13615_review_reason end, -- 057
     photo_id_sent_at=case when (v_entry.photo_id_checked_at is null and v_photo_checked_at is not null) -- 053
       or (coalesce(v_entry.is_new,false) and not v_is_new) then null else public.roster_entries.photo_id_sent_at end, -- 053
     photo_id_reviewed_at=case when (v_entry.photo_id_checked_at is null and v_photo_checked_at is not null) -- 057
       or (coalesce(v_entry.is_new,false) and not v_is_new) then null else public.roster_entries.photo_id_reviewed_at end, -- 057
     photo_id_review_reason=case when (v_entry.photo_id_checked_at is null and v_photo_checked_at is not null) -- 057
       or (coalesce(v_entry.is_new,false) and not v_is_new) then null else public.roster_entries.photo_id_review_reason end; -- 057
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


-- 057 §5
-- From 053 §5, with these changes marked `-- 057`: a required reason (trimmed,
-- 1-120 characters), stored with the reviewed time when a sent date is cleared.
drop function public.vitally_mark_upload_reviewed(uuid,uuid,bigint,text); -- 057
create or replace function public.vitally_mark_upload_reviewed(p_action_id uuid, p_volunteer_id uuid, p_expected_revision bigint, p_document text, p_reason text) -- 057
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
 if p_reason is null or char_length(btrim(p_reason,E' \t\n\r')) not between 1 and 120 then -- 057
  raise sqlstate 'VT007' using message='VALIDATION'; -- 057
 end if; -- 057
 v_digest=encode(extensions.digest(jsonb_build_object('operation','MARK_UPLOAD_REVIEWED','volunteerId',p_volunteer_id,
  'expectedRevision',p_expected_revision,'document',p_document,'reason',btrim(p_reason,E' \t\n\r'),'personId',v_person.id)::text,'sha256'),'hex'); -- 057
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
  update public.roster_entries set form_13615_sent_at=null,form_13615_reviewed_at=now(),form_13615_review_reason=btrim(p_reason,E' \t\n\r') -- 057
   where workspace_id=v_member.workspace_id and person_id=p_volunteer_id and season=v_season and form_13615_sent_at is not null;
 else
  update public.roster_entries set photo_id_sent_at=null,photo_id_reviewed_at=now(),photo_id_review_reason=btrim(p_reason,E' \t\n\r') -- 057
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
revoke all on function public.vitally_mark_upload_reviewed(uuid,uuid,bigint,text,text) from public,anon,authenticated,service_role;
grant execute on function public.vitally_mark_upload_reviewed(uuid,uuid,bigint,text,text) to authenticated;

-- 057 §6
-- The signed-in staff member's own profile (design D1). It answers for the
-- caller alone, and is not gated by clearance. It is refused FORBIDDEN while
-- the caller's account is invited (the first-sign-in site check is not passed),
-- as the upload link is withheld then: an invitation sent to a mistyped email
-- must not let a stranger read the volunteer's details.
create or replace function public.vitally_my_profile()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_person public.people;
 v_profile public.volunteer_profiles;
 v_entry public.roster_entries;
 v_status text;
 v_coordinator text;
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
 select * into v_profile from public.volunteer_profiles
  where workspace_id=v_person.workspace_id and person_id=v_person.id;
 if v_profile.person_id is null then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 select a.status into v_status from public.accounts a
  where a.workspace_id=v_person.workspace_id and a.user_id=v_member.user_id;
 if v_status='invited' then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 select r.* into v_entry from public.roster_entries r
  join public.workspaces w on w.id=r.workspace_id and w.current_season=r.season
  where r.workspace_id=v_person.workspace_id and r.person_id=v_person.id;
 select d.name into v_coordinator from public.workspaces w
  join public.people d on d.workspace_id=w.id and d.id=w.default_followup_person_id
  where w.id=v_person.workspace_id;
 return jsonb_build_object(
  'personId',v_person.id,
  'name',v_person.name,
  'email',v_profile.email,
  'phone',v_profile.phone,
  'works',v_profile.works,
  'languages',to_jsonb(v_profile.languages),
  'otherLanguage',v_profile.other_language,
  'usualDays',to_jsonb(v_profile.usual_days),
  'revision',v_profile.revision,
  'accountStatus',v_status,
  'roles',to_jsonb(coalesce(v_entry.roles,'{}'::text[])),
  'certificates',to_jsonb(case when v_entry.person_id is not null
   then vitally_private.confirmed_certificates(v_entry.workspace_id,v_entry.person_id,v_entry.season) else '{}'::text[] end),
  'form13615',case when v_entry.person_id is not null then jsonb_build_object('sentAt',v_entry.form_13615_sent_at,
   'reviewedAt',v_entry.form_13615_reviewed_at,'reviewReason',v_entry.form_13615_review_reason) end,
  'uploadUrl',case when v_entry.person_id is not null
   then (select s.certificate_upload_url from public.season_settings s where s.workspace_id=v_person.workspace_id) end,
  'siteCoordinatorName',to_jsonb(v_coordinator));
end;
$$;
revoke all on function public.vitally_my_profile() from public,anon,authenticated,service_role;
grant execute on function public.vitally_my_profile() to authenticated;

-- 057 §7
-- The signed-in staff member saves their own details (design D2): name, phone,
-- works, languages, other language and usual days, under the field rules of
-- vitally_save_volunteer. It writes only the caller's own people and profile
-- rows, and shares the profile revision with the admin's save. It is refused
-- FORBIDDEN, before any receipt, while the caller's account is invited.
create or replace function public.vitally_save_my_profile(p_action_id uuid, p_expected_revision bigint, p_profile jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_person public.people;
 v_receipt public.action_receipts;
 v_profile public.volunteer_profiles;
 v_digest text;
 v_name text;
 v_phone text;
 v_works text;
 v_other text;
 v_languages text[];
 v_days text[];
 v_revision bigint;
 v_result jsonb;
begin
 v_member=vitally_private.require_membership();
 if v_member.access<>'staff' then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 select * into v_person from public.people
  where workspace_id=v_member.workspace_id and user_id=v_member.user_id;
 if v_person.id is null or not exists(select 1 from public.volunteer_profiles
  where workspace_id=v_person.workspace_id and person_id=v_person.id) then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 if exists(select 1 from public.accounts a
  where a.workspace_id=v_person.workspace_id and a.user_id=v_member.user_id and a.status='invited') then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 if p_action_id is null or p_expected_revision is null or p_profile is null or jsonb_typeof(p_profile)<>'object' then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 -- The payload: exactly these keys, each of its type.
 if array(select k from jsonb_object_keys(p_profile) k order by k collate "C")
   <> array['languages','name','otherLanguage','phone','usualDays','works']::text[]
  or jsonb_typeof(p_profile->'name')<>'string'
  or jsonb_typeof(p_profile->'works')<>'string'
  or jsonb_typeof(p_profile->'phone') not in ('string','null')
  or jsonb_typeof(p_profile->'otherLanguage') not in ('string','null')
  or jsonb_typeof(p_profile->'languages')<>'array'
  or jsonb_typeof(p_profile->'usualDays')<>'array' then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 if exists(select 1 from jsonb_array_elements(p_profile->'languages') e where jsonb_typeof(e)<>'string')
  or exists(select 1 from jsonb_array_elements(p_profile->'usualDays') e where jsonb_typeof(e)<>'string') then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 v_name=btrim(p_profile->>'name',E' \t\n\r');
 v_phone=nullif(btrim(p_profile->>'phone'),'');
 v_works=p_profile->>'works';
 v_other=nullif(btrim(p_profile->>'otherLanguage'),'');
 v_languages=array(select jsonb_array_elements_text(p_profile->'languages'));
 v_days=array(select jsonb_array_elements_text(p_profile->'usualDays'));
 if length(v_name) not between 1 and 80
  or length(v_phone)>30
  or v_works not in ('on_site','remote','on_site_and_remote')
  or not (v_languages <@ array['english','mandarin','cantonese','other']::text[])
  or cardinality(v_languages)<>(select count(distinct c) from unnest(v_languages) c)
  or length(v_other)>40
  or (v_other is not null)<>('other'=any(v_languages))
  or not (v_days <@ array['mon','tue','wed','thu','fri','sat','sun']::text[])
  or cardinality(v_days)<>(select count(distinct d) from unnest(v_days) d) then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 v_days=array(select d from unnest(v_days) d order by array_position(array['mon','tue','wed','thu','fri','sat','sun'], d));
 v_digest=encode(extensions.digest(jsonb_build_object('operation','SAVE_MY_PROFILE','expectedRevision',p_expected_revision,
  'personId',v_person.id,'profile',p_profile)::text,'sha256'),'hex');
 v_receipt=vitally_private.reserve_receipt(v_member,p_action_id,'SAVE_MY_PROFILE',v_digest,v_person.id);
 if v_receipt.receipt is not null then
  return v_receipt.receipt;
 end if;
 select * into v_profile from public.volunteer_profiles
  where workspace_id=v_person.workspace_id and person_id=v_person.id for update;
 if not found then
  raise sqlstate 'VT002' using message='NOT_FOUND';
 end if;
 if v_profile.revision<>p_expected_revision then
  raise sqlstate 'VT003' using message='CONFLICT';
 end if;
 v_revision=v_profile.revision+1;
 update public.people set name=v_name where id=v_person.id;
 update public.volunteer_profiles set phone=v_phone,works=v_works,languages=v_languages,other_language=v_other,
   usual_days=v_days,revision=v_revision,updated_at=now()
  where workspace_id=v_person.workspace_id and person_id=v_person.id;
 v_result=jsonb_build_object('actionId',p_action_id,'personId',v_person.id,'revision',v_revision);
 update public.action_receipts set target_id=v_person.id,receipt=v_result where id=v_receipt.id;
 return v_result;
end;
$$;
revoke all on function public.vitally_save_my_profile(uuid,bigint,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.vitally_save_my_profile(uuid,bigint,jsonb) to authenticated;
