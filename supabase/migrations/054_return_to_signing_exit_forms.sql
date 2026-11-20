-- 054: the corrected values entered at Return to signing (OpenSpec change
-- add-exit-form-at-return-to-signing, design D1, D7).
--
-- One row per Return to signing event that carried corrected values. Staff
-- read it under the same gate as the reviewer questionnaire (cleared staff,
-- no private client draft); nobody writes it directly, only the action's
-- handler, which runs as a definer. `check_exit_form` (033) is reused as it
-- is, so no account number or routing number can ever be stored.
--
-- apply_fixture_scenario is not copied here: migration 040 dropped it with the
-- sample cases, and the rows go with their case through the cascade.

create table public.return_to_signing_exit_forms (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 case_id uuid not null,
 entered_by_person_id uuid not null,
 created_at timestamptz not null default now(),
 exit_form jsonb not null,
 remarks text,
 foreign key (workspace_id,case_id) references public.cases(workspace_id,id) on delete cascade,
 foreign key (workspace_id,entered_by_person_id) references public.people(workspace_id,id),
 check(vitally_private.check_exit_form(exit_form)),
 check(remarks is null or char_length(remarks) between 1 and 2000)
);
create index return_to_signing_exit_forms_case_idx on public.return_to_signing_exit_forms(workspace_id,case_id,created_at);

alter table public.return_to_signing_exit_forms enable row level security;
create policy staff_return_to_signing_exit_forms on public.return_to_signing_exit_forms for select to authenticated using(exists(select 1 from public.memberships m join public.cases c on c.workspace_id=m.workspace_id and c.id=return_to_signing_exit_forms.case_id where m.workspace_id=return_to_signing_exit_forms.workspace_id and m.user_id=(select auth.uid()) and m.active and m.access='staff' and (c.origin<>'client' or c.stage<>'draft') and return_to_signing_exit_forms.workspace_id=(select vitally_policy.cleared_workspace_id())));
revoke all on public.return_to_signing_exit_forms from public, anon, authenticated;
grant select on public.return_to_signing_exit_forms to authenticated;
grant select, insert, update, delete on public.return_to_signing_exit_forms to service_role;

-- Realtime, with 033's pattern.
do $$
begin
 if not exists(select 1 from pg_publication where pubname='supabase_realtime') then
  raise exception 'The supabase_realtime publication is missing; enable Realtime on this project before migrating.';
 end if;
 if not exists(
  select 1 from pg_publication_tables
  where pubname='supabase_realtime' and schemaname='public' and tablename='return_to_signing_exit_forms'
 ) then
  alter publication supabase_realtime add table public.return_to_signing_exit_forms;
 end if;
end $$;
