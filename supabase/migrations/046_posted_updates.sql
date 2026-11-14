-- 046: posted updates (OpenSpec change add-posted-updates, design D1-D4).
--
-- Ceiling admins post IRS policy updates and office notices; every staff
-- member, cleared or not, reads the ones addressed to them. Announcements
-- only: no replies. In order:
--   (a) posted_updates and update_reads, written only through the RPCs below;
--   (b) the live audience: vitally_private.audience_member and the policy
--       helper vitally_policy.in_update_audience;
--   (c) the two SELECT policies on posted_updates (none on update_reads);
--   (d) the RPCs: vitally_save_update and vitally_update_action (ceiling admin,
--       with receipts), vitally_mark_updates, vitally_my_updates (staff) and
--       vitally_posted_updates (ceiling admin);
--   (e) posted_updates joins the realtime publication; update_reads does not.
-- Nothing existing changes except the publication. No clearance check anywhere:
-- an update holds no case data.

-- ---------------------------------------------------------------------------
-- (a) The tables (design D1). The person keys are deferred, as 044's roster
-- keys are: deleting a workspace cascades to both people and updates.

create table public.posted_updates (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 kind text not null check (kind in ('irs_policy','office_notice')),
 title text not null check (title=btrim(title) and length(title) between 1 and 120),
 message text not null check (message=btrim(message) and length(message) between 1 and 2000),
 irs_link text check (length(irs_link)<=500 and irs_link ~* '^https://([a-z0-9-]+\.)*irs\.gov(/[^[:space:]]*)?$'),
 audience text not null check (audience in ('everyone','roles')),
 audience_roles text[] not null default '{}'
  check (audience_roles <@ array['greeter','intaker','preparer','reviewer','admin']::text[]),
 keep_top_until date,
 ask_confirm boolean not null default false,
 status text not null check (status in ('draft','posted','unpublished')),
 created_by_person_id uuid not null,
 posted_by_person_id uuid,
 created_at timestamptz not null default now(),
 posted_at timestamptz,
 edited_at timestamptz,
 unpublished_at timestamptz,
 revision bigint not null default 1,
 constraint posted_updates_link_kind check (irs_link is null or kind='irs_policy'),
 constraint posted_updates_audience_roles check ((audience='roles')=(cardinality(audience_roles)>0)),
 constraint posted_updates_posted_at check ((status='draft')=(posted_at is null)),
 constraint posted_updates_unpublished_at check ((status='unpublished')=(unpublished_at is not null)),
 unique (workspace_id,id),
 foreign key (workspace_id,created_by_person_id) references public.people(workspace_id,id) deferrable initially deferred,
 foreign key (workspace_id,posted_by_person_id) references public.people(workspace_id,id) deferrable initially deferred
);
create index posted_updates_workspace_status on public.posted_updates(workspace_id,status);

create table public.update_reads (
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 update_id uuid not null,
 person_id uuid not null,
 read_at timestamptz not null default now(),
 confirmed_at timestamptz,
 primary key (update_id,person_id),
 foreign key (workspace_id,update_id) references public.posted_updates(workspace_id,id) on delete cascade,
 foreign key (workspace_id,person_id) references public.people(workspace_id,id) on delete cascade
);
create index update_reads_workspace_person on public.update_reads(workspace_id,person_id);

alter table public.posted_updates enable row level security;
alter table public.update_reads enable row level security;
revoke all on public.posted_updates from public,anon,authenticated,service_role;
revoke all on public.update_reads from public,anon,authenticated,service_role;
-- Read for realtime only; the browser reads updates through the RPCs.
grant select on public.posted_updates to authenticated;

-- ---------------------------------------------------------------------------
-- (b) The live audience (design D2). Evaluated whenever it is read, never
-- stored per person. A person is in an update's audience when their sign-in
-- has an active staff membership in the workspace, they have a roster entry
-- for the workspace's current season, and the audience is everyone or that
-- entry holds one of the update's roles. Clearance does not matter.
-- When add-account-invitations lands, "active staff membership" switches to
-- "active account" here, and only here.

create function vitally_private.audience_member(p_workspace_id uuid,p_person_id uuid,p_audience text,p_roles text[])
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.people p
  join public.memberships m on m.workspace_id=p.workspace_id and m.user_id=p.user_id
   and m.active and m.access='staff'
  join public.workspaces w on w.id=p.workspace_id
  join public.roster_entries r on r.workspace_id=p.workspace_id and r.person_id=p.id and r.season=w.current_season
  where p.workspace_id=p_workspace_id and p.id=p_person_id
   and (p_audience='everyone' or (p_audience='roles' and r.roles && p_roles)));
$$;
revoke all on function vitally_private.audience_member(uuid,uuid,text,text[]) from public,anon,authenticated,service_role;

-- The same check for the caller's own person. It takes no user id: it answers
-- only for the caller.
create function vitally_policy.in_update_audience(p_workspace_id uuid,p_audience text,p_roles text[])
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.people p
  where p.workspace_id=p_workspace_id and p.user_id=(select auth.uid())
   and vitally_private.audience_member(p_workspace_id,p.id,p_audience,p_roles));
$$;
revoke all on function vitally_policy.in_update_audience(uuid,text,text[]) from public,anon,authenticated,service_role;
grant execute on function vitally_policy.in_update_audience(uuid,text,text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- (c) The policies (design D1). An admin reads every row of their workspace;
-- the audience reads the rows that are not drafts. Unpublished rows stay
-- readable, so realtime can tell an open window an update was unpublished.

create policy admin_posted_updates on public.posted_updates for select to authenticated
 using (vitally_policy.is_workspace_admin(workspace_id));
create policy audience_posted_updates on public.posted_updates for select to authenticated
 using (status<>'draft' and vitally_policy.in_update_audience(workspace_id,audience,audience_roles));

-- ---------------------------------------------------------------------------
-- (d) The RPCs (design D3). Each resolves the caller's own person, refuses a
-- caller who is not staff or has no person with FORBIDDEN, and skips the
-- clearance check. None takes a person parameter. Not `stable`:
-- require_membership takes a row lock.

-- Creates a draft (no id, no revision) or edits a draft or a posted update.
-- The payload has exactly the keys kind, title, message, irsLink, audience,
-- roles, keepTopUntil, askConfirm, post and askAgain. A field that fails its
-- check is refused with VALIDATION, the field name as the detail. `post` posts
-- a new update or a draft; on a posted update it changes nothing. Editing a
-- posted update records the edit, and `askAgain` removes that update's reads
-- and confirmations. An unpublished update is not edited. With audience
-- everyone the roles are stored empty.
create function public.vitally_save_update(p_action_id uuid,p_update_id uuid,p_expected_revision bigint,p_update jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_person public.people;
 v_receipt public.action_receipts;
 v_row public.posted_updates;
 v_digest text;
 v_kind text;
 v_title text;
 v_message text;
 v_link text;
 v_audience text;
 v_roles text[];
 v_keep date;
 v_ask boolean;
 v_post boolean;
 v_again boolean;
 v_id uuid;
 v_revision bigint=1;
 v_status text;
 v_result jsonb;
begin
 v_member=vitally_private.require_membership();
 v_person=vitally_private.acting_person(v_member);
 if v_member.access<>'staff' or v_person.id is null or not vitally_policy.is_workspace_admin(v_member.workspace_id) then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 if p_action_id is null or p_update is null or jsonb_typeof(p_update)<>'object'
  or (p_update_id is null)<>(p_expected_revision is null)
  or array(select k from jsonb_object_keys(p_update) k order by k collate "C")
   <>array['askAgain','askConfirm','audience','irsLink','keepTopUntil','kind','message','post','roles','title']::text[] then
  raise sqlstate 'VT007' using message='VALIDATION',detail='update';
 end if;

 -- Each field, in the order of the form.
 v_kind=case when jsonb_typeof(p_update->'kind')='string' then p_update->>'kind' end;
 if v_kind is null or v_kind not in ('irs_policy','office_notice') then
  raise sqlstate 'VT007' using message='VALIDATION',detail='kind';
 end if;
 v_title=case when jsonb_typeof(p_update->'title')='string' then btrim(p_update->>'title') end;
 if v_title is null or length(v_title) not between 1 and 120 then
  raise sqlstate 'VT007' using message='VALIDATION',detail='title';
 end if;
 v_message=case when jsonb_typeof(p_update->'message')='string' then btrim(p_update->>'message') end;
 if v_message is null or length(v_message) not between 1 and 2000 then
  raise sqlstate 'VT007' using message='VALIDATION',detail='message';
 end if;
 if jsonb_typeof(p_update->'irsLink') not in ('string','null') then
  raise sqlstate 'VT007' using message='VALIDATION',detail='irsLink';
 end if;
 v_link=nullif(btrim(p_update->>'irsLink'),'');
 if v_link is not null and (v_kind<>'irs_policy' or length(v_link)>500
   or v_link !~* '^https://([a-z0-9-]+\.)*irs\.gov(/[^[:space:]]*)?$') then
  raise sqlstate 'VT007' using message='VALIDATION',detail='irsLink';
 end if;
 v_audience=case when jsonb_typeof(p_update->'audience')='string' then p_update->>'audience' end;
 if v_audience is null or v_audience not in ('everyone','roles') then
  raise sqlstate 'VT007' using message='VALIDATION',detail='audience';
 end if;
 if jsonb_typeof(p_update->'roles')<>'array'
  or exists(select 1 from jsonb_array_elements(p_update->'roles') e where jsonb_typeof(e)<>'string') then
  raise sqlstate 'VT007' using message='VALIDATION',detail='roles';
 end if;
 v_roles=array(select jsonb_array_elements_text(p_update->'roles'));
 if not (v_roles <@ array['greeter','intaker','preparer','reviewer','admin']::text[])
  or cardinality(v_roles)<>(select count(distinct c) from unnest(v_roles) c)
  or (v_audience='roles' and cardinality(v_roles)=0) then
  raise sqlstate 'VT007' using message='VALIDATION',detail='roles';
 end if;
 if v_audience='everyone' then
  v_roles='{}';
 end if;
 if jsonb_typeof(p_update->'keepTopUntil')='null' then
  v_keep=null;
 elsif jsonb_typeof(p_update->'keepTopUntil')='string' and p_update->>'keepTopUntil' ~ '^\d{4}-\d{2}-\d{2}$' then
  begin
   v_keep=(p_update->>'keepTopUntil')::date;
  exception when others then
   raise sqlstate 'VT007' using message='VALIDATION',detail='keepTopUntil';
  end;
 else
  raise sqlstate 'VT007' using message='VALIDATION',detail='keepTopUntil';
 end if;
 foreach v_status in array array['askConfirm','post','askAgain'] loop
  if jsonb_typeof(p_update->v_status)<>'boolean' then
   raise sqlstate 'VT007' using message='VALIDATION',detail=v_status;
  end if;
 end loop;
 v_ask=(p_update->'askConfirm')::boolean;
 v_post=(p_update->'post')::boolean;
 v_again=(p_update->'askAgain')::boolean;

 v_digest=encode(extensions.digest(jsonb_build_object('operation','SAVE_UPDATE','updateId',p_update_id,
  'expectedRevision',p_expected_revision,'personId',v_person.id,'update',p_update)::text,'sha256'),'hex');
 v_receipt=vitally_private.reserve_receipt(v_member,p_action_id,'SAVE_UPDATE',v_digest,v_person.id);
 if v_receipt.receipt is not null then
  return v_receipt.receipt;
 end if;

 if p_update_id is null then
  v_status=case when v_post then 'posted' else 'draft' end;
  insert into public.posted_updates(workspace_id,kind,title,message,irs_link,audience,audience_roles,keep_top_until,
    ask_confirm,status,created_by_person_id,posted_by_person_id,posted_at)
   values(v_member.workspace_id,v_kind,v_title,v_message,v_link,v_audience,v_roles,v_keep,
    v_ask,v_status,v_person.id,case when v_post then v_person.id end,case when v_post then now() end)
   returning id into v_id;
 else
  select * into v_row from public.posted_updates
   where workspace_id=v_member.workspace_id and id=p_update_id for update;
  if not found then
   raise sqlstate 'VT002' using message='NOT_FOUND';
  end if;
  if v_row.revision<>p_expected_revision then
   raise sqlstate 'VT003' using message='CONFLICT';
  end if;
  if v_row.status='unpublished' then
   raise sqlstate 'VT004' using message='INVALID_TRANSITION';
  end if;
  v_id=v_row.id;
  v_revision=v_row.revision+1;
  if v_row.status='draft' then
   v_status=case when v_post then 'posted' else 'draft' end;
   update public.posted_updates set kind=v_kind,title=v_title,message=v_message,irs_link=v_link,audience=v_audience,
     audience_roles=v_roles,keep_top_until=v_keep,ask_confirm=v_ask,status=v_status,
     posted_by_person_id=case when v_post then v_person.id end,posted_at=case when v_post then now() end,
     revision=v_revision
    where id=v_id;
  else
   v_status='posted';
   update public.posted_updates set kind=v_kind,title=v_title,message=v_message,irs_link=v_link,audience=v_audience,
     audience_roles=v_roles,keep_top_until=v_keep,ask_confirm=v_ask,edited_at=now(),revision=v_revision
    where id=v_id;
   -- The one write that removes reads: "Ask everyone to read it again".
   if v_again then
    delete from public.update_reads where workspace_id=v_member.workspace_id and update_id=v_id;
   end if;
  end if;
 end if;
 v_result=jsonb_build_object('actionId',p_action_id,'updateId',v_id,'revision',v_revision,'status',v_status);
 update public.action_receipts set target_id=v_id,receipt=v_result where id=v_receipt.id;
 return v_result;
end;
$$;
revoke all on function public.vitally_save_update(uuid,uuid,bigint,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.vitally_save_update(uuid,uuid,bigint,jsonb) to authenticated;

-- POST: a draft is posted. UNPUBLISH: a posted update leaves every feed and
-- keeps its reads. DELETE: a draft is deleted, and the receipt answers
-- `deleted`, so a replay after the delete is not NOT_FOUND. Any other state
-- is INVALID_TRANSITION; an unknown type is VALIDATION.
create function public.vitally_update_action(p_action_id uuid,p_update_id uuid,p_expected_revision bigint,p_type text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_person public.people;
 v_receipt public.action_receipts;
 v_row public.posted_updates;
 v_digest text;
 v_revision bigint;
 v_status text;
 v_result jsonb;
begin
 v_member=vitally_private.require_membership();
 v_person=vitally_private.acting_person(v_member);
 if v_member.access<>'staff' or v_person.id is null or not vitally_policy.is_workspace_admin(v_member.workspace_id) then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 if p_action_id is null or p_update_id is null or p_expected_revision is null then
  raise sqlstate 'VT007' using message='VALIDATION',detail='update';
 end if;
 if p_type is null or p_type not in ('POST','UNPUBLISH','DELETE') then
  raise sqlstate 'VT007' using message='VALIDATION',detail='type';
 end if;
 v_digest=encode(extensions.digest(jsonb_build_object('operation','UPDATE_ACTION','updateId',p_update_id,
  'expectedRevision',p_expected_revision,'personId',v_person.id,'type',p_type)::text,'sha256'),'hex');
 v_receipt=vitally_private.reserve_receipt(v_member,p_action_id,'UPDATE_ACTION',v_digest,v_person.id);
 if v_receipt.receipt is not null then
  return v_receipt.receipt;
 end if;
 select * into v_row from public.posted_updates
  where workspace_id=v_member.workspace_id and id=p_update_id for update;
 if not found then
  raise sqlstate 'VT002' using message='NOT_FOUND';
 end if;
 if v_row.revision<>p_expected_revision then
  raise sqlstate 'VT003' using message='CONFLICT';
 end if;
 v_revision=v_row.revision+1;
 if p_type='POST' and v_row.status='draft' then
  v_status='posted';
  update public.posted_updates set status=v_status,posted_at=now(),posted_by_person_id=v_person.id,revision=v_revision
   where id=v_row.id;
 elsif p_type='UNPUBLISH' and v_row.status='posted' then
  v_status='unpublished';
  update public.posted_updates set status=v_status,unpublished_at=now(),revision=v_revision
   where id=v_row.id;
 elsif p_type='DELETE' and v_row.status='draft' then
  v_status='deleted';
  delete from public.posted_updates where id=v_row.id;
 else
  raise sqlstate 'VT004' using message='INVALID_TRANSITION';
 end if;
 v_result=jsonb_build_object('actionId',p_action_id,'updateId',v_row.id,'revision',v_revision,'status',v_status);
 update public.action_receipts set target_id=v_row.id,receipt=v_result where id=v_receipt.id;
 return v_result;
end;
$$;
revoke all on function public.vitally_update_action(uuid,uuid,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.vitally_update_action(uuid,uuid,bigint,text) to authenticated;

-- Records that the caller read each given update in their feed (posted, the
-- caller in its audience), keeping the first read time. With p_confirm, an
-- update that asks for confirmation also gets its first confirmation time.
-- Other ids are ignored without saying why. At most 200 ids. No receipt: a
-- repeat changes nothing.
create function public.vitally_mark_updates(p_update_ids uuid[],p_confirm boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_person public.people;
 v_marked integer;
begin
 v_member=vitally_private.require_membership();
 v_person=vitally_private.acting_person(v_member);
 if v_member.access<>'staff' or v_person.id is null then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 if p_update_ids is null or cardinality(p_update_ids)>200 then
  raise sqlstate 'VT007' using message='VALIDATION',detail='updateIds';
 end if;
 if p_confirm is null then
  raise sqlstate 'VT007' using message='VALIDATION',detail='confirm';
 end if;
 insert into public.update_reads(workspace_id,update_id,person_id,read_at,confirmed_at)
  select u.workspace_id,u.id,v_person.id,now(),case when p_confirm and u.ask_confirm then now() end
   from public.posted_updates u
   where u.workspace_id=v_member.workspace_id and u.id in (select distinct i from unnest(p_update_ids) i)
    and u.status='posted'
    and vitally_private.audience_member(u.workspace_id,v_person.id,u.audience,u.audience_roles)
  on conflict (update_id,person_id) do update
   set confirmed_at=coalesce(public.update_reads.confirmed_at,excluded.confirmed_at);
 get diagnostics v_marked=row_count;
 return jsonb_build_object('marked',v_marked);
end;
$$;
revoke all on function public.vitally_mark_updates(uuid[],boolean) from public,anon,authenticated,service_role;
grant execute on function public.vitally_mark_updates(uuid[],boolean) to authenticated;

-- The caller's feed: the posted updates whose audience includes them, pinned
-- first (kept at the top until today or later, in New York), then the rest,
-- newest first within each group. One item shape, so later notices can join
-- with their own `source`. `unread` counts the items not read, or asking for
-- confirmation and not confirmed.
create function public.vitally_my_updates()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_person public.people;
 v_today date=(now() at time zone 'America/New_York')::date;
 v_items jsonb;
 v_unread integer;
begin
 v_member=vitally_private.require_membership();
 v_person=vitally_private.acting_person(v_member);
 if v_member.access<>'staff' or v_person.id is null then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 with feed as (
  select u.*,coalesce(u.keep_top_until>=v_today,false) as pinned,poster.name as poster_name,
    r.read_at,r.confirmed_at
   from public.posted_updates u
   left join public.people poster on poster.workspace_id=u.workspace_id and poster.id=u.posted_by_person_id
   left join public.update_reads r on r.update_id=u.id and r.person_id=v_person.id
   where u.workspace_id=v_member.workspace_id and u.status='posted'
    and vitally_private.audience_member(u.workspace_id,v_person.id,u.audience,u.audience_roles)
 )
 select coalesce(jsonb_agg(jsonb_build_object(
    'source','posted_update','id',id,'kind',kind,'title',title,'message',message,'irsLink',irs_link,
    'postedAt',posted_at,'postedByName',poster_name,'edited',edited_at is not null,'pinned',pinned,
    'askConfirm',ask_confirm,'readAt',read_at,'confirmedAt',confirmed_at)
   order by pinned desc,posted_at desc,id),'[]'::jsonb),
  count(*) filter (where read_at is null or (ask_confirm and confirmed_at is null))
  into v_items,v_unread
  from feed;
 return jsonb_build_object('items',v_items,'unread',v_unread);
end;
$$;
revoke all on function public.vitally_my_updates() from public,anon,authenticated,service_role;
grant execute on function public.vitally_my_updates() to authenticated;

-- Every update in the workspace for a ceiling admin, newest first, each with
-- its live audience: its size, how many of it have read and confirmed, and
-- each member's name and times. Reads by people no longer in the audience do
-- not count.
create function public.vitally_posted_updates()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member public.memberships;
 v_person public.people;
 v_updates jsonb;
begin
 v_member=vitally_private.require_membership();
 v_person=vitally_private.acting_person(v_member);
 if v_member.access<>'staff' or v_person.id is null or not vitally_policy.is_workspace_admin(v_member.workspace_id) then
  raise sqlstate 'VT001' using message='FORBIDDEN';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object(
    'id',u.id,'kind',u.kind,'title',u.title,'message',u.message,'irsLink',u.irs_link,
    'audience',u.audience,'roles',to_jsonb(u.audience_roles),'keepTopUntil',u.keep_top_until,
    'askConfirm',u.ask_confirm,'status',u.status,'createdAt',u.created_at,'postedAt',u.posted_at,
    'postedByName',poster.name,'editedAt',u.edited_at,'unpublishedAt',u.unpublished_at,'revision',u.revision,
    'audienceSize',a.size,'readCount',a.read_count,'confirmedCount',a.confirmed_count,'people',a.people)
   order by coalesce(u.posted_at,u.created_at) desc,u.id),'[]'::jsonb)
  into v_updates
  from public.posted_updates u
  left join public.people poster on poster.workspace_id=u.workspace_id and poster.id=u.posted_by_person_id
  cross join lateral (
   select count(*)::integer as size,
     count(r.read_at)::integer as read_count,
     count(r.confirmed_at)::integer as confirmed_count,
     coalesce(jsonb_agg(jsonb_build_object('personId',p.id,'name',p.name,'readAt',r.read_at,'confirmedAt',r.confirmed_at)
      order by p.name,p.id) filter (where p.id is not null),'[]'::jsonb) as people
    from public.people p
    left join public.update_reads r on r.update_id=u.id and r.person_id=p.id
    where p.workspace_id=u.workspace_id
     and vitally_private.audience_member(u.workspace_id,p.id,u.audience,u.audience_roles)
  ) a
  where u.workspace_id=v_member.workspace_id;
 return jsonb_build_object('updates',v_updates);
end;
$$;
revoke all on function public.vitally_posted_updates() from public,anon,authenticated,service_role;
grant execute on function public.vitally_posted_updates() to authenticated;

-- ---------------------------------------------------------------------------
-- (e) Realtime, with 033's pattern: INSERT and UPDATE only, under the same RLS.
-- update_reads is not published: reads are frequent, and would wake every
-- admin window.
do $$
declare v_table text;
begin
 if not exists(select 1 from pg_publication where pubname='supabase_realtime') then
  raise exception 'The supabase_realtime publication is missing; enable Realtime on this project before migrating.';
 end if;
 foreach v_table in array array['posted_updates'] loop
  if not exists(
   select 1 from pg_publication_tables
   where pubname='supabase_realtime' and schemaname='public' and tablename=v_table
  ) then
   execute format('alter publication supabase_realtime add table public.%I',v_table);
  end if;
 end loop;
end $$;
