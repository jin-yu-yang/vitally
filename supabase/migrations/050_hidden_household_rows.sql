-- 050: hidden household rows (bug #175). A household row counts only while the
-- catalogue shows the hh group. After Yes, two members, then No, the stored hh
-- stays but no row counts.
-- household_rows gives that count (0 to 4) and act_save_preparer_fields, defined
-- only in 039, is redefined with exactly two changes: it uses household_rows, and
-- it keeps the stored cells of rows that are now hidden, so a save never drops
-- what it could not show. If the 047-049 order changes, this file is renamed at
-- merge time. p_contact is '{}' because hh reads no contact field.

create or replace function vitally_private.household_rows(p_version smallint,p_answers jsonb)
returns int language sql stable security definer set search_path='' as $$
 select case when vitally_private.intake_visible(p_version,'hh',p_answers,'{}'::jsonb)
   and pg_catalog.jsonb_typeof(p_answers->'hh')='array'
  then least(pg_catalog.jsonb_array_length(p_answers->'hh'),4) else 0 end;
$$;
revoke all on function vitally_private.household_rows(smallint,jsonb) from public, anon, authenticated, service_role;

create or replace function vitally_private.act_save_preparer_fields(p_member public.memberships,p_case public.cases,p_person public.people,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_fields jsonb:=p_payload->'fields';
 v_based bigint:=(p_payload->>'basedOnVersion')::bigint;
 v_old jsonb;
 v_stored bigint;
 v_version bigint;
 v_season int;
 v_hh int:=0;
 v_changed jsonb;
begin
 if p_case.stage not in ('preparing','corrections_required') then
  raise sqlstate 'VT004' using message='INVALID_TRANSITION';
 end if;
 perform vitally_private.require_case_preparer(p_case,p_person);
 select s.fields,s.version into v_old,v_stored from public.preparer_shaded_fields s where s.case_id=p_case.id for update;
 if coalesce(v_stored,0)<>v_based then
  raise sqlstate 'VT003' using message='CONFLICT';
 end if;
 select coalesce(p_case.season,w.current_season) into v_season from public.workspaces w where w.id=p_case.workspace_id;
 if v_fields ? 'infoDisallowedYear' and (v_season is null or (v_fields->>'infoDisallowedYear')::int>=v_season) then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 -- 050: the rows the household list shows now, at most the four the form has.
 v_hh:=vitally_private.household_rows(p_case.intake_version,p_case.answers);
 if exists(select 1 from jsonb_object_keys(v_fields) k
   where k~'^household[1-4]' and substring(k from 10 for 1)::int>v_hh) then
  raise sqlstate 'VT007' using message='VALIDATION';
 end if;
 -- 050: cells of hidden rows are kept as stored.
 v_fields:=v_fields||coalesce((select jsonb_object_agg(o.key,o.value) from jsonb_each(coalesce(v_old,'{}'::jsonb)) o
   where o.key~'^household[1-4]' and substring(o.key from 10 for 1)::int>v_hh),'{}'::jsonb);
 insert into public.preparer_shaded_fields as s(workspace_id,case_id,fields,version,updated_by_person_id)
 values(p_case.workspace_id,p_case.id,v_fields,1,p_person.id)
 on conflict (case_id) do update set fields=excluded.fields,version=s.version+1,
  updated_by_person_id=excluded.updated_by_person_id,updated_at=now()
 returning s.version into v_version;
 select coalesce(jsonb_agg(d.k order by d.k collate "C"),'[]'::jsonb) into v_changed from (
  select coalesce(o.key,n.key) as k
  from jsonb_each(coalesce(v_old,'{}'::jsonb)) o full join jsonb_each(v_fields) n on n.key=o.key
  where o.value is distinct from n.value) d;
 return jsonb_build_object('detail',jsonb_build_object('changed',v_changed,'version',v_version));
end;
$$;
