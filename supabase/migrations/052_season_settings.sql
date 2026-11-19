-- 052: season settings (OpenSpec change add-season-settings, design D1-D8).
--
-- people.capabilities becomes a mirror of the person's current-season role
-- capabilities while they have a sign-in, and empty otherwise (design D1).
-- In order (design D8):
--   §1 the guard: refuse with VT008, changing nothing, if any person with an
--      active staff membership holds `admin` in people.capabilities without
--      the Admin role on their current-season roster entry;
--   §2 the snapshot of every person's capabilities, for a rollback migration;
--   §3 the schema: the mirror helper and its two triggers;
--   §4 the recompute of every person's capabilities;
--   §5 onwards, the functions.
-- The migration runs in one transaction.

-- ---------------------------------------------------------------------------
-- §1. The guard. Only active staff memberships are counted: a person with no
-- sign-in, or an inactive one, already has no admin to lose.

-- 052 §1 begin
do $$
declare v_count bigint;
begin
 select count(*) into v_count
  from public.memberships m
  join public.people p on p.workspace_id=m.workspace_id and p.user_id=m.user_id
  where m.active and m.access='staff' and 'admin'=any(p.capabilities)
   and not exists(select 1 from public.workspaces w
    join public.roster_entries r on r.workspace_id=w.id and r.season=w.current_season
    where w.id=p.workspace_id and r.person_id=p.id and 'admin'=any(r.roles));
 if v_count>0 then
  raise exception using errcode='VT008',
   message='052 refused: people with a sign-in hold admin without the Admin role ('||v_count||')',
   detail=v_count::text;
 end if;
end;
$$;
-- 052 §1 end

-- ---------------------------------------------------------------------------
-- §2. The snapshot. The old ceiling can't be rebuilt from roles, so a
-- follow-up migration can restore it from here. No client reaches it; Start
-- next season (a later change) drops it.

create table vitally_private.capabilities_before_052 (
 workspace_id uuid not null,
 person_id uuid not null,
 capabilities text[] not null,
 primary key (workspace_id,person_id)
);
insert into vitally_private.capabilities_before_052(workspace_id,person_id,capabilities)
 select p.workspace_id,p.id,p.capabilities from public.people p;
revoke all on table vitally_private.capabilities_before_052 from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- §3. The mirror (design D1). 042's check (`followup` needs `admin`) stays:
-- the Admin role gives both.

-- The capabilities of the person's current-season roles when they have a
-- sign-in; empty with no sign-in or no current-season entry.
create function vitally_private.mirror_capabilities(p_workspace_id uuid,p_person_id uuid,p_user_id uuid)
returns text[] language sql stable security definer set search_path='' as $$
 select case when p_user_id is null then '{}'::text[] else coalesce((
  select vitally_private.role_capabilities(r.roles)
   from public.workspaces w
   join public.roster_entries r on r.workspace_id=w.id and r.season=w.current_season
   where w.id=p_workspace_id and r.person_id=p_person_id),'{}'::text[]) end;
$$;
revoke all on function vitally_private.mirror_capabilities(uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- Every write of a people row stores the mirror, whatever it wrote: a direct
-- write of a different value is replaced, and linking or unlinking a sign-in
-- recomputes it.
create function vitally_private.people_mirror_capabilities()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 new.capabilities=vitally_private.mirror_capabilities(new.workspace_id,new.id,new.user_id);
 return new;
end;
$$;
revoke all on function vitally_private.people_mirror_capabilities() from public,anon,authenticated,service_role;

create trigger people_mirror_capabilities
 before insert or update on public.people
 for each row execute function vitally_private.people_mirror_capabilities();

-- A change to a current-season roster entry touches its person's people row
-- (OLD and NEW, for a move or a delete), so the trigger above recomputes it
-- and the change reaches staff windows through people realtime.
create function vitally_private.roster_entries_mirror_capabilities()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.people p set capabilities=p.capabilities
  from (
   select new.workspace_id,new.person_id,new.season where tg_op<>'DELETE'
   union
   select old.workspace_id,old.person_id,old.season where tg_op<>'INSERT'
  ) k(workspace_id,person_id,season)
  join public.workspaces w on w.id=k.workspace_id and w.current_season=k.season
  where p.workspace_id=k.workspace_id and p.id=k.person_id;
 return null;
end;
$$;
revoke all on function vitally_private.roster_entries_mirror_capabilities() from public,anon,authenticated,service_role;

create trigger roster_entries_mirror_capabilities
 after insert or update of roles,season,person_id or delete on public.roster_entries
 for each row execute function vitally_private.roster_entries_mirror_capabilities();

-- ---------------------------------------------------------------------------
-- §4. The recompute: every person's capabilities become the mirror.

update public.people set capabilities=capabilities;

-- ---------------------------------------------------------------------------
-- §5. The effective capabilities: from 045, now the current season's role
-- capabilities alone. people.capabilities is the mirror of the same roles, so
-- there is no ceiling to intersect with.

create or replace function vitally_private.effective_capabilities(p_workspace_id uuid,p_person_id uuid)
returns text[] language sql stable security definer set search_path='' as $$
 select coalesce((
  select vitally_private.role_capabilities(r.roles) -- 052
   from public.workspaces w
   join public.roster_entries r on r.workspace_id=w.id and r.season=w.current_season
   where w.id=p_workspace_id and r.person_id=p_person_id),'{}'::text[]);
$$;
revoke all on function vitally_private.effective_capabilities(uuid,uuid) from public,anon,authenticated,service_role;
