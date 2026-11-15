-- 051: case labels (OpenSpec change add-case-labels, design D1, D2, D6, D7).
-- Staff tag a case with short coloured labels (City Tax, MFS, Multi-state, or
-- their own) so the team can see at a glance which cases need special handling.
--
-- This file is written in sections, in this order:
--   1. the tables case_labels and case_label_links;
--   2. row-level security: cleared staff read, nothing for clients;
--   3. the starter labels: a trigger on workspaces plus a one-time backfill;
--   4. Realtime: both tables join the publication.
-- The RPCs that write labels are appended as later sections, before the
-- closing revoke at the end of the file.
--
-- Merge points (D7, Risks): this migration redefines no existing function
-- (initialize_workspace, vitally_apply_action, check_payload and
-- check_operation_authority are untouched), so it does not conflict with a
-- parallel change that re-creates them. The new trigger function is
-- vitally_private.add_starter_labels, attached to public.workspaces, which no
-- other change owns. Browser roles get SELECT only; labels never reach anon
-- or an applicant.

-- ---------------------------------------------------------------------------
-- 1. The tables (D1). A name is stored trimmed, 1 to 24 characters, and is
-- unique within its workspace ignoring case. A link is never deleted: it is
-- switched off (active = false) so the change keeps its who and when.

create table if not exists public.case_labels (
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 id uuid not null default gen_random_uuid(),
 name text not null,
 color text not null,
 revision bigint not null default 1 check (revision >= 1),
 created_by_person_id uuid,
 created_at timestamptz not null default now(),
 updated_by_person_id uuid,
 updated_at timestamptz not null default now(),
 primary key (id),
 unique (workspace_id, id),
 constraint case_labels_name check (name = btrim(name) and char_length(name) between 1 and 24),
 constraint case_labels_color check (color in ('sky','amber','pink','green','violet','slate')),
 foreign key (workspace_id, created_by_person_id) references public.people(workspace_id, id),
 foreign key (workspace_id, updated_by_person_id) references public.people(workspace_id, id)
);
create unique index if not exists case_labels_name_key on public.case_labels(workspace_id, lower(name));

create table if not exists public.case_label_links (
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 case_id uuid not null,
 label_id uuid not null,
 active boolean not null,
 changed_by_person_id uuid not null,
 changed_at timestamptz not null default now(),
 primary key (case_id, label_id),
 foreign key (workspace_id, case_id) references public.cases(workspace_id, id) on delete cascade,
 foreign key (workspace_id, label_id) references public.case_labels(workspace_id, id),
 foreign key (workspace_id, changed_by_person_id) references public.people(workspace_id, id)
);
create index if not exists case_label_links_label on public.case_label_links(label_id);

-- ---------------------------------------------------------------------------
-- 2. Staff-only reads (D2). Both policies carry the clearance gate (045): an
-- uncleared staff member reads nothing. The links policy repeats the inline
-- case-visibility rule, staff branch only; there is no applicant branch.

alter table public.case_labels enable row level security;
alter table public.case_label_links enable row level security;

drop policy if exists staff_read_case_labels on public.case_labels;
create policy staff_read_case_labels on public.case_labels for select to authenticated using(exists(select 1 from public.memberships m where m.workspace_id=case_labels.workspace_id and m.user_id=(select auth.uid()) and m.active and m.access='staff' and case_labels.workspace_id=(select vitally_policy.cleared_workspace_id())));

drop policy if exists staff_read_case_label_links on public.case_label_links;
create policy staff_read_case_label_links on public.case_label_links for select to authenticated using(exists(select 1 from public.memberships m join public.cases c on c.workspace_id=m.workspace_id and c.id=case_label_links.case_id where m.workspace_id=case_label_links.workspace_id and m.user_id=(select auth.uid()) and m.active and m.access='staff' and (c.origin<>'client' or c.stage<>'draft') and case_label_links.workspace_id=(select vitally_policy.cleared_workspace_id())));

revoke all on public.case_labels from public, anon, authenticated;
revoke all on public.case_label_links from public, anon, authenticated;
grant select on public.case_labels to authenticated;
grant select on public.case_label_links to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Starter labels (D6). Every new workspace gets City Tax, MFS and
-- Multi-state; the one-time insert below gives them to existing workspaces,
-- skipping a label whose name (in any letter case) the workspace already has.

create or replace function vitally_private.add_starter_labels()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.case_labels(workspace_id,name,color)
 values (new.id,'City Tax','sky'),(new.id,'MFS','pink'),(new.id,'Multi-state','amber')
 on conflict do nothing;
 return new;
end;
$$;

drop trigger if exists add_starter_labels on public.workspaces;
create trigger add_starter_labels after insert on public.workspaces
 for each row execute function vitally_private.add_starter_labels();

insert into public.case_labels(workspace_id,name,color)
select w.id, s.name, s.color
from public.workspaces w
cross join (values ('City Tax','sky'),('MFS','pink'),('Multi-state','amber')) as s(name,color)
where not exists (select 1 from public.case_labels l where l.workspace_id=w.id and lower(l.name)=lower(s.name));

-- ---------------------------------------------------------------------------
-- 4. Realtime, with 007's pattern: INSERT and UPDATE only, under the same RLS.
-- The browser adapter's staff table list gains both tables in the same change.

do $$
declare v_table text;
begin
 if not exists(select 1 from pg_publication where pubname='supabase_realtime') then
  raise exception 'The supabase_realtime publication is missing; enable Realtime on this project before migrating.';
 end if;
 foreach v_table in array array['case_labels','case_label_links'] loop
  if not exists(
   select 1 from pg_publication_tables
   where pubname='supabase_realtime' and schemaname='public' and tablename=v_table
  ) then
   execute format('alter publication supabase_realtime add table public.%I', v_table);
  end if;
 end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Closing line, kept last as sections are appended: no browser or service
-- role may call a private function directly.

revoke all on all functions in schema vitally_private from public, anon, authenticated, service_role;
