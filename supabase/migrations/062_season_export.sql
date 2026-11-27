-- OpenSpec change add-season-export (design D1-D4), issue #256: the Season
-- export. A site coordinator downloads one ZIP of the workspace's current
-- season; the browser builds the files, this migration gives it the rows.
--   §1 the season_exports table (D3): one record per export;
--   §2 vitally_export_season (D1): FORBIDDEN unless an active site
--      coordinator; builds one jsonb answer of the current season in a single
--      select (one snapshot), records the export and returns the answer. It
--      takes no season argument, and no action id: there is no receipt (D2),
--      so every successful call records one export;
--   §3 vitally_season_settings (D4): 058's read plus lastExport.
-- Replaced functions are copied from their latest migration, with changed
-- lines marked `-- 062`.

-- ---------------------------------------------------------------------------
-- §1. The export record. Private: RLS on, no grant to a signed-in user.

create table public.season_exports (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 season smallint not null,
 exported_by_person_id uuid not null,
 exported_at timestamptz not null default now(),
 row_counts jsonb not null check (jsonb_typeof(row_counts)='object'),
 foreign key (workspace_id,exported_by_person_id) references public.people(workspace_id,id)
);
alter table public.season_exports enable row level security;
revoke all on public.season_exports from public,anon,authenticated,service_role;
create index season_exports_latest on public.season_exports(workspace_id,season,exported_at desc);

-- ---------------------------------------------------------------------------
-- §2. The export. Named fields only: no row is passed through whole, and
-- people are given by name, never by id.

create function public.vitally_export_season()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_person public.people;
 v_workspace uuid;
 v_season smallint;
 v_answer jsonb;
 v_now timestamptz=now();
begin
 v_member=vitally_private.require_membership();
 v_person=vitally_private.acting_person(v_member);
 if v_member.access<>'staff' or v_person.id is null
  or not vitally_private.is_site_coordinator(v_member.workspace_id,v_person.id) then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 v_workspace=v_member.workspace_id;
 select w.current_season into v_season from public.workspaces w where w.id=v_workspace;
 with c as (
  select * from public.cases k
  where k.workspace_id=v_workspace and k.season=v_season and k.client_number is not null
 )
 select jsonb_build_object(
  'season',v_season,
  'exportedAt',v_now,
  'exportedByName',v_person.name,
  'cases',coalesce((select jsonb_agg(jsonb_build_object(
    'id',c.id,'clientNumber',c.client_number,'reference',c.reference,'origin',c.origin,
    'stage',c.stage,'closingReason',c.closing_reason,
    'submittedAt',(select min(e.created_at) from public.case_events e
      where e.workspace_id=c.workspace_id and e.case_id=c.id and e.action='SUBMIT'),
    'preparerName',pp.name,'reviewerName',rp.name,
    'intakeVersion',c.intake_version,'answers',c.answers) order by c.client_number,c.id)
   from c
   left join public.people pp on pp.workspace_id=c.workspace_id and pp.id=c.preparer_id
   left join public.people rp on rp.workspace_id=c.workspace_id and rp.id=c.reviewer_id),'[]'::jsonb),
  'events',coalesce((select jsonb_agg(jsonb_build_object(
    'caseId',e.case_id,'createdAt',e.created_at,'action',e.action,'actorName',p.name,'detail',e.detail)
    order by e.created_at,e.id)
   from public.case_events e join c on c.id=e.case_id
   left join public.people p on p.workspace_id=e.workspace_id and p.id=e.actor_person_id
   where e.workspace_id=v_workspace),'[]'::jsonb),
  'clientEvents',coalesce((select jsonb_agg(jsonb_build_object(
    'caseId',e.case_id,'createdAt',e.created_at,'message',e.message) order by e.created_at,e.id)
   from public.client_events e join c on c.id=e.case_id
   where e.workspace_id=v_workspace),'[]'::jsonb),
  'documentRequests',coalesce((select jsonb_agg(jsonb_build_object(
    'caseId',d.case_id,'createdAt',d.created_at,'title',d.title,'message',d.message,
    'status',d.status,'requestedByName',p.name) order by d.created_at,d.id)
   from public.document_requests d join c on c.id=d.case_id
   left join public.people p on p.workspace_id=d.workspace_id and p.id=d.requested_by_person_id
   where d.workspace_id=v_workspace),'[]'::jsonb),
  'followups',coalesce((select jsonb_agg(jsonb_build_object(
    'caseId',a.case_id,'reason',a.reason,'assigneeName',p.name,'status',a.status,
    'resolutionOutcome',a.resolution_outcome,'resolutionNote',a.resolution_note,
    'createdAt',a.created_at,'resolvedAt',a.resolved_at) order by a.created_at,a.id)
   from public.admin_followups a join c on c.id=a.case_id
   left join public.people p on p.workspace_id=a.workspace_id and p.id=a.assignee_person_id
   where a.workspace_id=v_workspace),'[]'::jsonb),
  'contactLog',coalesce((select jsonb_agg(jsonb_build_object(
    'caseId',l.case_id,'contactedAt',l.contacted_at,'direction',l.direction,'withWhom',l.with_whom,
    'otherName',l.other_name,'method',l.method,'purpose',l.purpose,'outcome',l.outcome,
    'note',l.note,'loggedByName',p.name) order by l.contacted_at,l.id)
   from public.contact_log l join c on c.id=l.case_id
   left join public.people p on p.workspace_id=l.workspace_id and p.id=l.logged_by_person_id
   where l.workspace_id=v_workspace),'[]'::jsonb),
  'contactAttempts',coalesce((select jsonb_agg(jsonb_build_object(
    'caseId',t.case_id,'createdAt',t.created_at,'outcome',t.outcome,'note',t.note,'actorName',p.name)
    order by t.created_at,t.id)
   from public.contact_attempts t join c on c.id=t.case_id
   left join public.people p on p.workspace_id=t.workspace_id and p.id=t.actor_person_id
   where t.workspace_id=v_workspace),'[]'::jsonb),
  'helpRequests',coalesce((select jsonb_agg(jsonb_build_object(
    'caseId',h.case_id,'title',h.title,'status',h.status,'assigneeName',p.name,
    'language',h.language,'contactPreference',h.contact_preference,
    'resolutionNote',h.resolution_note,'createdAt',h.created_at) order by h.created_at,h.id)
   from public.assistance_items h
   left join public.people p on p.workspace_id=h.workspace_id and p.id=h.assignee_person_id
   where h.workspace_id=v_workspace
    and (h.case_id is null or exists(select 1 from c where c.id=h.case_id))),'[]'::jsonb)
 ) into v_answer;
 insert into public.season_exports(workspace_id,season,exported_by_person_id,exported_at,row_counts)
 values(v_workspace,v_season,v_person.id,v_now,jsonb_build_object(
  'cases.csv',jsonb_array_length(v_answer->'cases'),
  'status-history.csv',jsonb_array_length(v_answer->'events'),
  'messages.csv',jsonb_array_length(v_answer->'documentRequests')+jsonb_array_length(v_answer->'clientEvents'),
  'follow-ups.csv',jsonb_array_length(v_answer->'followups'),
  'call-log.csv',jsonb_array_length(v_answer->'contactLog')+jsonb_array_length(v_answer->'contactAttempts'),
  'help-requests.csv',jsonb_array_length(v_answer->'helpRequests')));
 return v_answer;
end;
$$;
revoke all on function public.vitally_export_season() from public,anon,authenticated,service_role;
grant execute on function public.vitally_export_season() to authenticated;

-- ---------------------------------------------------------------------------
-- §3. The Season settings read, replaced from 058 to add `lastExport` (design
-- D4): the latest export of the current season, or null. Everything else is
-- 058's body, unchanged.

create or replace function public.vitally_season_settings()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_person public.people;
 v_workspace uuid;
begin
 v_member=vitally_private.require_membership();
 v_person=vitally_private.acting_person(v_member);
 if v_member.access<>'staff' or v_person.id is null
  or not vitally_policy.is_workspace_admin(v_member.workspace_id) then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 v_workspace=v_member.workspace_id;
 return vitally_private.season_settings_answer(v_workspace)
  || jsonb_build_object(
   'siteNumber',(select jsonb_build_object('set',n.workspace_id is not null,'updatedAt',n.updated_at)
    from (select 1) one left join vitally_private.site_numbers n on n.workspace_id=v_workspace),
   'canEdit',vitally_private.is_site_coordinator(v_workspace,v_person.id),
   'schedule',vitally_private.schedule_settings_answer(v_workspace), -- 058
   'lastExport',(select jsonb_build_object('name',p.name,'exportedAt',e.exported_at) -- 062
    from public.season_exports e
    join public.people p on p.workspace_id=e.workspace_id and p.id=e.exported_by_person_id
    join public.workspaces w on w.id=e.workspace_id
    where e.workspace_id=v_workspace and e.season=w.current_season
    order by e.exported_at desc,e.id desc limit 1),
   'siteCoordinators',coalesce((select jsonb_agg(jsonb_build_object(
     'volunteerId',p.id,'name',p.name,'email',v.email,
     'since',(select max(c.changed_at) from public.site_coordinator_changes c
      where c.workspace_id=v_workspace and c.person_id=p.id and c.granted),
     'onRoster',exists(select 1 from public.roster_entries r join public.workspaces w on w.id=r.workspace_id
      where r.workspace_id=v_workspace and r.person_id=p.id and r.season=w.current_season),
     'accountRevision',a.revision) order by p.name,p.id)
    from public.accounts a
    join public.people p on p.workspace_id=a.workspace_id and p.id=a.person_id
    left join public.volunteer_profiles v on v.workspace_id=p.workspace_id and v.person_id=p.id
    where a.workspace_id=v_workspace and a.status='active' and a.is_site_coordinator),'[]'::jsonb),
   'candidates',coalesce((select jsonb_agg(jsonb_build_object('volunteerId',p.id,'name',p.name,
     'accountRevision',a.revision) order by p.name,p.id)
    from public.accounts a
    join public.memberships m on m.workspace_id=a.workspace_id and m.user_id=a.user_id
    join public.people p on p.workspace_id=a.workspace_id and p.id=a.person_id
    where a.workspace_id=v_workspace and a.status='active' and not a.is_site_coordinator
     and m.active and m.access='staff'),'[]'::jsonb),
   'history',coalesce((select jsonb_agg(jsonb_build_object('personName',h.person_name,'granted',h.granted,
     'changedByName',h.changed_by_name,'changedAt',h.changed_at) order by h.changed_at desc,h.id desc)
    from (select c.id,c.granted,c.changed_at,p.name as person_name,b.name as changed_by_name
     from public.site_coordinator_changes c
     join public.people p on p.workspace_id=c.workspace_id and p.id=c.person_id
     left join public.people b on b.workspace_id=c.workspace_id and b.id=c.changed_by_person_id
     where c.workspace_id=v_workspace
     order by c.changed_at desc,c.id desc limit 50) h),'[]'::jsonb));
end;
$$;
revoke all on function public.vitally_season_settings() from public,anon,authenticated,service_role;
grant execute on function public.vitally_season_settings() to authenticated;
