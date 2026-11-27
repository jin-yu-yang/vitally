-- 061: vitally_save_volunteer checks ADMIN_ROLE after the receipt lookup (#238).
--
-- A save lands, then the volunteer's Admin role changes (a site coordinator
-- gives or takes it). When the admin who sent the first save is not a site
-- coordinator and repeats it with the same action id, for example after a
-- lost reply, 057 compared the payload with the new stored roles before it
-- looked up the receipt, and answered ADMIN_ROLE. A repeated action id
-- returns the stored result (spec volunteer-roster), so the check now runs
-- after the lookup. A refusal still stores no receipt: it raises in the same
-- transaction that reserved it.
--
-- Nothing else changes. vitally_remove_from_roster (059) keeps its order.

-- 061 §1
-- From 057 §4, with the Admin role check moved below the receipt lookup and
-- its comment marked `-- 061`.
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
 v_digest=encode(extensions.digest(jsonb_build_object('operation','SAVE_VOLUNTEER','volunteerId',p_volunteer_id,
  'expectedRevision',p_expected_revision,'personId',v_person.id,'volunteer',p_volunteer)::text,'sha256'),'hex');
 v_receipt=vitally_private.reserve_receipt(v_member,p_action_id,'SAVE_VOLUNTEER',v_digest,v_person.id);
 if v_receipt.receipt is not null then
  return v_receipt.receipt;
 end if;
 -- Only a site coordinator adds or removes the Admin role (design D3), -- 052
 -- refused after the receipt lookup, so a replay of a landed save returns its -- 061
 -- stored result although the stored roles have changed since. The refusal -- 061
 -- rolls the reserved receipt back with the rest, so none is stored. -- 061
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
