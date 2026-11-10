# Volunteer Roster Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins a Volunteers > Roster screen to list, search, filter, add and edit volunteers, with admin-only records that grant no capability.

**Architecture:** One migration adds three admin-only tables, a policy helper, one write RPC, a tightened `people` read policy, a roster-command link by email, and a backfill. A pure module combines and filters rows; the store reads and writes them; the controller holds list state; a new views module draws the page and its office drawer.

**Tech Stack:** Postgres via hand-written Supabase migrations, plain ES modules, `node:test`, Playwright.

**Spec:** `openspec/changes/add-volunteer-roster-records/design.md` and `specs/{volunteer-roster,sign-in,local-seed-data}/spec.md` in the same folder. Read both before starting a task.

## Global Constraints

- Fictional data only, in code, tests, fixtures and screenshots.
- Staff screens are English only. No `src/client-text.mjs` or Chinese text changes.
- Roles and certificates grant nothing. Never read or write `people.capabilities` from the Roster.
- No function body, constraint, policy or view in `public` or `vitally_private` may contain the words `presenter` or `fixture` (`tests/database-catalog.mjs`).
- Every `vitally_private` function is `security definer`, `search_path=''`, with no execute for `anon`, `authenticated` or `service_role`.
- Never run `supabase start` from the repo root. Copy the gitignored `.env.test` and `.vitally-roster.local.json` from the main checkout into the worktree.
- Don't add steps to, or remove steps from, the browser story. If a story order exceeds its limit, stop and show the per-phase timings.
- If Task 6 (seed) is cut for time, say so to the user immediately, so they can add volunteers by hand before the 2026-11-11 review.

Fixed values, used everywhere:

| Field | Stored values (label) |
| --- | --- |
| roles | `greeter` (Greeter), `intaker` (Intaker), `preparer` (Preparer), `reviewer` (Reviewer), `admin` (Admin) |
| certificates | `vsc` (VSC, Volunteer Standards of Conduct), `itqr` (IT&QR, Intake/Interview & Quality Review), `sc` (SC, Site Coordinator), `basic` (Basic), `advanced` (Advanced) |
| works | `on_site` (On site), `remote` (Remote), `on_site_and_remote` (On site and remote) |
| languages | `english`, `mandarin`, `cantonese`, `other` (English, Mandarin, Cantonese, Other) |

The RPC payload has exactly these keys: `name, email, phone, works, languages, otherLanguage, roles, certificates`.

## Review Focus

1. A redraw from a live update while the drawer is open must keep what the admin has typed and ticked. (Task 5, browser test in Task 7.)
2. An email with capitals or surrounding spaces is stored trimmed and lower-case, and counts as a duplicate of the same address. (Tasks 1 and 3.)
3. A name or phone containing `<`, `&` or quotes is shown as text in the table and in the drawer. (Task 4.)
4. A failed first load says it failed and offers Try again, and doesn't look like an empty Roster. (Task 4.)
5. An Edit drawer whose volunteer is no longer in the list says so and offers Close, without drawing a blank form. (Task 4.)

---

### Task 1: Migration 044 and its database tests

**Files:**
- Create: `supabase/migrations/044_volunteer_roster_records.sql`
- Create: `tests/database-volunteer-roster.mjs`
- Modify: `tests/support/rpc-signatures.mjs`
- Modify: `tests/database-catalog.mjs`, `tests/database-realtime.mjs`, `tests/roster.test.mjs`
- Modify: `tools/admin/workspace-setup.mjs`, `tools/admin/roster.mjs`
- Modify: `tests/database-actions.mjs` only if `context` needs a value for the new entry

**Interfaces:**
- Produces: tables `volunteer_profiles`, `roster_entries`, `certificates`; `vitally_policy.is_workspace_admin(uuid) returns boolean`; `public.vitally_save_volunteer(p_action_id uuid, p_volunteer_id uuid, p_expected_revision bigint, p_volunteer jsonb) returns jsonb` with result `{actionId, personId, revision}`; a replaced `vitally_private.add_staff_member`, same signature.

- [ ] **Step 1: Bring the worktree's stack to `main`'s migrations, with rehearsal data**

Run: `npm run db:migrate:test`, then `node --env-file=.env.test tools/admin/roster.mjs --target test --roster .vitally-roster.local.json`
Expected: the stack is at 043, and the roster applies. Record the counts of `staff` memberships for Step 8.

- [ ] **Step 2: Write the failing tests in `tests/database-volunteer-roster.mjs`**

Use the shape of `tests/database-staff-identity.mjs`: one `test`, one `createDatabaseFixture`, `t.test` subtests, and its `refuse` helper (VT001 and no receipt). Build actors with `f.siteCoordinator` (admin), `f.staff({key, name, capabilities})` and `f.applicantA`. Each spec scenario for the database gets one subtest. At minimum, these names and assertions:

| Subtest | Assertion |
| --- | --- |
| `an admin reads the three tables; a non-admin and a client read none` | row counts >0 for the admin after one Add; `[]` for `f.staff` with `["prepare"]` and for the client |
| `another workspace's admin reads none` | use `f.initializeOwned` and a second admin |
| `direct writes are refused` | insert, update and delete on each table as admin return an error |
| `the helper answers only for the caller` | run with `set local role authenticated` and the caller's JWT claims: true for the admin in their workspace; false for a non-admin, for a client, and for an admin asking about another workspace |
| `table privileges are select-only` | `has_table_privilege` (pattern at `tests/database.mjs:664`): `authenticated` has `select` and none of insert, update, delete on all three tables; `anon` and `service_role` have none of the four |
| `a malformed call from a non-admin is forbidden` | null action id from a `prepare` person and from a client is `VT001`, not `VT007` |
| `people: a non-admin cannot read a volunteer with no sign-in` | non-admin's `people` excludes them and includes every person with `user_id`; admin's includes them |
| `people: an unlinked person with capabilities stays visible` | insert one with `f.sql`; non-admin reads it |
| `add creates a person with no account or capabilities` | `user_id` null, `capabilities` `{}`, one profile, one entry with `added_by_person_id`, one row per tick, no new membership |
| `a replay returns the stored result` | same action id twice: one person, deep-equal results |
| `email is stored trimmed and lower-case, unique ignoring case` | `"  Ana@Example.ORG "` is stored as `ana@example.org`; adding `ANA@example.org` is `VT007` |
| `edit replaces values and bumps the revision` | revision goes 1 to 2 |
| `a ticked certificate keeps its date; an unticked one is deleted` | `confirmed_at` unchanged after a second save; the row is gone after untick |
| `a stale revision is a conflict` | `VT003`, values unchanged |
| `a locked email is refused` | changing the email of `f.staff` person is `VT007`; re-sending the same email in another case is accepted |
| `validation refuses bad payloads` | each is `VT007`: an extra key, no roles, unknown role, unknown certificate, unknown works, `other` with no name, a named language without `other`, 81-character name, 31-character phone |
| `a non-admin and a client are refused with no receipt` | `VT001` |
| `an unknown id or another workspace's id is not found` | `VT002` |
| `roles grant nothing` | record `reviewer` and every certificate on a `prepare` person: `capabilities` unchanged, `CLAIM_REVIEW` refused with `VT001` |
| `the roster links a matching volunteer` | Add `Riley@example.org`, provision an account with that address through `f.provision`-style setup, call `add_staff_member` with key `riley_link`: one person, `user_id` set, key and capabilities from the call, Roster name kept, roles and certificates kept, profile revision bumped |
| `a new staff member gets records` | `f.staff`: a profile with the account's email and an entry with `roles` `{}` |
| `a re-run ignores a changed name` | call `add_staff_member` again with another name: succeeds, stored name unchanged |
| `a re-run with changed capabilities is still refused` | `VT007` |
| `findRosterLink finds only a no-sign-in match` | with `f.sql` as the query function: returns `{name}` for the match before linking, and null afterwards and for an address with no profile |

Add to `tests/database-realtime.mjs`, using the file's channel helper at line 76: `a volunteer with no sign-in reaches admins only`. Subscribe an admin and a `prepare` staff member to `people`, add a volunteer through the RPC, wait for the admin's event (the positive control), then assert the other staff member got none.

Add to `tests/roster.test.mjs`: `applyRoster` returns `linked` from `initialize`'s result, and `[]` when `initialize` returns undefined. `rosterLinkNotes({linked:[{personKey:"riley",nameDiffers:true}]})` has one line containing `riley` and saying the name on the Roster was kept and differs from the file; with `nameDiffers:false` it doesn't mention a difference; no line ever contains `@`.

Add a subtest to `tests/database-catalog.mjs`, named `vitally_policy holds exactly the admin check, with exactly its grants`. Read `pg_proc` joined to `pg_namespace` for `nspname='vitally_policy'` and assert:

- the functions are exactly `['is_workspace_admin(uuid)']` (via `oid::regprocedure`, schema stripped);
- `prosecdef` is true, `provolatile` is `'s'`, `proconfig` is `['search_path=""']`, and `proargnames` is `['p_workspace_id']`;
- no entry of `proargnames` in the schema matches `/user|account|member|person/i`, and `pronargs` is 1;
- `aclexplode(proacl)`, leaving out the function owner's own entry, is exactly one row: grantee `authenticated`, privilege `EXECUTE`;
- `has_function_privilege` is false for `anon` and `service_role`, and no ACL row has grantee `0` (`public`);
- the schema's ACL, leaving out its owner, is exactly `authenticated` with `USAGE`.

Add to `tests/support/rpc-signatures.mjs`:

```js
Object.freeze({
  name: "vitally_save_volunteer",
  signature: "vitally_save_volunteer(uuid,uuid,bigint,jsonb)",
  authorized: (f) => f.siteCoordinator,
  receiptKeys: Object.freeze(["actionId", "personId", "revision"]),
  args: () => ({
    p_action_id: crypto.randomUUID(),
    p_volunteer_id: null,
    p_expected_revision: null,
    p_volunteer: {
      name: "Sample Volunteer", email: `v-${crypto.randomUUID()}@example.org`, phone: null,
      works: "on_site", languages: ["english"], otherLanguage: null, roles: ["greeter"], certificates: [],
    },
  }),
}),
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --env-file=.env.test --test tests/database-volunteer-roster.mjs`
Expected: FAIL, because the tables and the RPC don't exist.

- [ ] **Step 4: Write the migration**

The whole migration goes in one file, applied once. If it needs a fix after being applied to the local stack, reset the local stack as in `docs/setup.md` and re-apply. It reaches no shared stack before merge.

In this order:

(a) Schema and helper. `create schema vitally_policy; grant usage on schema vitally_policy to authenticated;`. The helper is `vitally_policy.is_workspace_admin(p_workspace_id uuid) returns boolean`, `stable security definer set search_path=''`. It takes no user id. It is true when the caller (`auth.uid()`) has an active `staff` membership in that workspace and the person with that `user_id` in that workspace has `admin`. `revoke all ... from public, anon, authenticated, service_role`, then `grant execute ... to authenticated`.

(b) Tables. Enable RLS on each; `revoke all ... from public, anon, authenticated, service_role`; `grant select ... to authenticated`; `create policy admin_<table> on public.<table> for select to authenticated using (vitally_policy.is_workspace_admin(workspace_id))`. Do not publish them.

```sql
create table public.volunteer_profiles (
 workspace_id uuid not null, person_id uuid not null,
 email text not null check (email=lower(email) and length(email) between 3 and 254),
 phone text check (length(phone) between 1 and 30),
 works text not null default 'on_site' check (works in ('on_site','remote','on_site_and_remote')),
 languages text[] not null default '{}' check (languages <@ array['english','mandarin','cantonese','other']::text[]),
 other_language text check (length(other_language) between 1 and 40),
 revision bigint not null default 1,
 updated_at timestamptz not null default now(),
 primary key (workspace_id,person_id), unique (workspace_id,email),
 foreign key (workspace_id,person_id) references public.people(workspace_id,id) on delete cascade,
 check ((other_language is not null) = ('other'=any(languages)))
);
create table public.roster_entries (
 workspace_id uuid not null, person_id uuid not null, season smallint not null,
 roles text[] not null default '{}' check (roles <@ array['greeter','intaker','preparer','reviewer','admin']::text[]),
 added_by_person_id uuid,
 created_at timestamptz not null default now(),
 primary key (workspace_id,person_id,season),
 foreign key (workspace_id,person_id) references public.people(workspace_id,id) on delete cascade,
 foreign key (workspace_id,added_by_person_id) references public.people(workspace_id,id)
);
create table public.certificates (
 workspace_id uuid not null, person_id uuid not null, season smallint not null,
 certificate text not null check (certificate in ('vsc','itqr','sc','basic','advanced')),
 status text not null default 'confirmed' check (status in ('uploaded','confirmed')),
 confirmed_at timestamptz, confirmed_by_person_id uuid,
 primary key (workspace_id,person_id,season,certificate),
 foreign key (workspace_id,person_id,season) references public.roster_entries(workspace_id,person_id,season) on delete cascade,
 foreign key (workspace_id,confirmed_by_person_id) references public.people(workspace_id,id)
);
```

(c) The policy: `alter policy staff_people on public.people using(exists(select 1 from public.memberships m where m.workspace_id=people.workspace_id and m.user_id=(select auth.uid()) and m.active and m.access='staff') and (people.user_id is not null or cardinality(people.capabilities)>0 or vitally_policy.is_workspace_admin(people.workspace_id)));`

(d) `vitally_save_volunteer`, in the order given by design D4, modelled on `vitally_edit_contact` in 043. Operation name for digest and receipt: `SAVE_VOLUNTEER`. Digest keys: `operation, volunteerId, expectedRevision, personId, volunteer`. Right after `acting_person`, before any other check, use exactly this admin check, because a client's acting person is an empty row and a plain `not ('admin'=any(...))` is null, which doesn't raise:

```sql
if v_member.access<>'staff' or v_person.id is null or not coalesce('admin'=any(v_person.capabilities),false) then
 raise sqlstate 'VT001' using message='FORBIDDEN';
end if;
```

After the envelope check, take `perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_member.workspace_id::text,0));`, the lock `add_staff_member` takes, before the digest. Add when both ids are null; edit when both are present; one without the other is `VT007`. The generated key is `'v_'||substr(replace(gen_random_uuid()::text,'-',''),1,12)`. Season comes from `workspaces.current_season`. Trim the name and phone; `lower(btrim())` the email; a blank phone is null. A duplicate email is `VT007` (check before insert, and let the unique constraint stop a race, mapped to `VT007`). Certificates: delete those not sent, and `insert ... on conflict do nothing` the rest with `status='confirmed', confirmed_at=now(), confirmed_by_person_id=<actor>`. Update `people.name` in the same call. Result: `{actionId, personId, revision}`, stored as the receipt with `target_id` the person. Revoke from `public, anon, authenticated, service_role`; grant execute to `authenticated`.

(e) `add_staff_member`, copied from 043, with two changes. Remove `and p.name=p_name` from the comparison. Replace the final insert with:

```sql
select lower(u.email) into v_email from auth.users u where u.id=p_user_id;
select p.id into v_link from public.people p
 join public.volunteer_profiles v on v.workspace_id=p.workspace_id and v.person_id=p.id
 where p.workspace_id=p_workspace_id and p.user_id is null and v.email=v_email for update of p;
insert into public.memberships(workspace_id,user_id,access) values(p_workspace_id,p_user_id,'staff');
if v_link is not null then
 update public.people set person_key=p_person_key,capabilities=p_capabilities,user_id=p_user_id where id=v_link;
 update public.volunteer_profiles set revision=revision+1,updated_at=now() where workspace_id=p_workspace_id and person_id=v_link;
 return v_link;
end if;
-- as before: insert the person, returning v_person_id
-- then insert its volunteer_profiles row (v_email) and its roster_entries row for current_season, roles {}
```

(f) The backfill, last: for each person joined to a `staff` membership and to `auth.users`, insert a profile (`lower(email)`) and a roster entry for `workspaces.current_season`.

- [ ] **Step 5: Report links from the roster command**

In `tools/admin/workspace-setup.mjs`, export `findRosterLink(query, workspaceId, userId) -> Promise<{name} | null>`, where `query(text, values)` returns `{rows}`. It finds a person with `user_id` null whose profile email equals the account's lower-cased email. In `initializeWorkspace`, inside the `serializable` callback so a retry starts afresh, call it before each `add_staff_member`, collect `{personKey, nameDiffers}`, and return `{...result, linked}`. In `tools/admin/roster.mjs`, `applyRoster` returns `linked: setup?.linked ?? []`, a new exported `rosterLinkNotes(result) -> string[]` builds the lines, and `main` prints them. Lines name the key only, never an address.

- [ ] **Step 6: Apply and run the new tests**

Run: `npm run db:migrate:test`, then `node --env-file=.env.test --test tests/database-volunteer-roster.mjs tests/database-catalog.mjs tests/database-realtime.mjs`, then `node --test tests/roster.test.mjs`
Expected: PASS.

- [ ] **Step 7: Run the full database suite**

Run: `npm run test:database`
Expected: PASS. If an exact-roster assertion fails (`tests/database-actions.mjs:950`, `tests/database-staff-identity.mjs:530,803,812`, `tests/database.mjs:397,452`), stop and report: this change shouldn't alter who is in `people` for those tests.

- [ ] **Step 8: Check the backfill**

Using a scratch script under `.superpowers/` with `openDatabase({kind:"test"})` from `tools/admin/database.mjs`, confirm the rehearsal workspace from Step 1 has one profile and one roster entry per `staff` membership, and none for a client. Note the counts for `verify.md`.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/044_volunteer_roster_records.sql tests/database-volunteer-roster.mjs tests/database-catalog.mjs tests/database-realtime.mjs tests/roster.test.mjs tests/support/rpc-signatures.mjs tools/admin/workspace-setup.mjs tools/admin/roster.mjs
git commit -m "Roster records: tables, admin-only access, save RPC, roster linking"
```

### Task 2: Pure roster logic

**Files:**
- Create: `src/volunteer-roster.mjs`
- Test: `tests/volunteer-roster.test.mjs`

**Interfaces:**
- Produces, all pure: `ROLES`, `CERTIFICATES`, `WORKS`, `LANGUAGES` (arrays of `{value, label}`; `CERTIFICATES` also has `full`); `combineVolunteers({profiles, entries, certificates, people}) -> Volunteer[]`, sorted by name; `filterVolunteers(list, {search, role}) -> Volunteer[]`; `volunteerFromForm(formData) -> payload`; `volunteerProblem(payload, list, volunteerId) -> string | null`.
- `Volunteer` is `{id, name, email, phone, works, languages, otherLanguage, roles, certificates, revision, hasSignIn}`.

- [ ] **Step 1: Write the failing tests**

```js
test("combine keeps only people with a roster entry", ...)   // a profile with no entry is dropped; hasSignIn follows people.user_id
test("search matches name, email or phone ignoring case", ...)
test("role and search apply together", ...)
test("form reading trims, lower-cases and collects ticks", ...)
// FormData with name " Ana ", email " A@B.ORG ", phone "", role x2, certificate x1
// -> { name:"Ana", email:"a@b.org", phone:null, works:"on_site", languages:[], otherLanguage:null, roles:[..2], certificates:[..1] }
test("otherLanguage is null unless Other is ticked", ...)
test("problems", ...)
// "Enter a name." / "Enter a valid email." (uses EMAIL_PATTERN from auth.mjs)
// "That email is already on the Roster." (ANA@x.org against ana@x.org, skipping volunteerId itself)
// "Choose at least one role." / "Name the other language."
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/volunteer-roster.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/volunteer-roster.mjs`**

No imports except `EMAIL_PATTERN` from `./auth.mjs`.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/volunteer-roster.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/volunteer-roster.mjs tests/volunteer-roster.test.mjs
git commit -m "Roster: combine, filter and validate volunteers"
```

### Task 3: Store

**Files:**
- Modify: `src/supabase-store.mjs` (after `listPeople`, near line 445; after `logContact`, near line 679)
- Test: `tests/store.test.mjs`

**Interfaces:**
- Consumes: `combineVolunteers`.
- Produces: `store.listVolunteers() -> Promise<Volunteer[]>`; `store.saveVolunteer({actionId, volunteerId, expectedRevision, volunteer}) -> Promise<{actionId, personId, revision}>`.

- [ ] **Step 1: Write the failing tests using `fakeClient`**

`listVolunteers` reads `workspaces` for `current_season`, then filters `roster_entries` and `certificates` by that season, and returns combined rows. `saveVolunteer` calls `vitally_save_volunteer` with `p_action_id, p_volunteer_id, p_expected_revision, p_volunteer`, sending nulls for an Add. A failed read rejects with the mapped app error. Also pin that the tables are not in `SUBSCRIBED_TABLES.staff`.

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/store.test.mjs`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement both methods**

Guard with `requireStaffAccess()`, as `listPeople` does. Read `people` with `select("id,name,user_id")`.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/store.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/supabase-store.mjs tests/store.test.mjs
git commit -m "Store: read and save volunteers"
```

### Task 4: Controller and views

**Files:**
- Modify: `src/controller.mjs` (`STAFF_SCREENS` line 67, initial state near 285, reset near 1189, `loadData` near 925, new functions near `logContact`)
- Create: `src/volunteer-views.mjs`
- Modify: `src/views.mjs` (`DRAWERS` line 94, `OFFICE_SCREENS` line 219, `staffSidebar` line 191, screen branch near 296, drawer branch near 482, overline near 507)
- Modify: `src/office-views.mjs` (export `drawerError`, with a heading parameter)
- Modify: `src/pool-views.mjs` (`personOptions`, line 120)
- Test: `tests/controller.test.mjs`, `tests/volunteer-views.test.mjs`, `tests/pool-views.test.mjs`

**Interfaces:**
- Consumes: Task 2 and Task 3 exports.
- Produces: screen `"office-volunteers"`; dialog `"volunteer"` with context `{volunteerId}` or `null`; state `volunteers: []`, `lists.volunteers`, `volunteerFilters: {search:"", role:"all"}`, `volunteerFormError: null`; controller `loadVolunteers()`, `setVolunteerFilter(key, value)`, `saveVolunteer(values) -> Promise<boolean>`, `clearVolunteerFormError()`; action names `open-volunteers`, `open-add-volunteer`, `open-edit-volunteer` (with `data-volunteer-id`); form `id="volunteer-form"`, `class="staff-form"`; fields `volunteer-name`, `volunteer-email`, `volunteer-phone`, and named checkbox groups `role`, `certificate`, `language`, radio `works`, text `otherLanguage`.
- `drawerError(ui, conflictHeading = "This case changed while you were working")`.

- [ ] **Step 1: Write the failing tests**

Controller:
- `navigate("office-volunteers")` is allowed and restored from a saved session; `loadData` loads volunteers only when the screen is `office-volunteers`.
- A failed `loadVolunteers` sets `lists.volunteers` to `"failed"`.
- `saveVolunteer` with a problem sets `volunteerFormError`, makes no store call and returns false.
- A successful save calls the store with a fresh action id and the volunteer's `revision`, reloads the list and returns true.
- A `CONFLICT` shows `"Someone else changed this volunteer. Close this and open it again to see their changes."`, reloads the list and rethrows.

Views (`tests/volunteer-views.test.mjs`):
- `staffScreen` for an admin has `data-action="open-volunteers"` after All cases; a person with only `prepare` has none.
- A non-admin on `office-volunteers` gets the work board.
- The page has the sentence from the spec, verbatim, and no season text.
- A row shows the Remote badge for `remote` and for `on_site_and_remote`, `No roles recorded`, and `None recorded`.
- A name of `<b>O'Hara & Co</b>` appears escaped in the table and in the drawer.
- `lists.volunteers:"failed"` draws the unloaded line, not the empty one; `"loading"` draws the loading line; a filter with no matches says `Nobody matches.`
- The drawer for Add has an enabled email field; for a volunteer with `hasSignIn`, the email is `readonly`, with the note `This is their sign-in email.`
- The drawer for an unknown id says `This volunteer could not be opened. Close this and try again.` and has `close-dialog`.
- `CONFLICT` in the drawer has the heading `This volunteer changed while you were working`.

Pool: a person with `capabilities: []` isn't offered; a person with no `capabilities` field still is.

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/controller.test.mjs tests/volunteer-views.test.mjs tests/pool-views.test.mjs`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement the controller**

`noteUnloaded` stays as it is. Conflict handling follows `runContactWrite`, using `noteFailure(error, {message})`. Export the conflict sentence as `VOLUNTEER_CONFLICT_MESSAGE`.

- [ ] **Step 4: Implement the views**

`renderRoster(volunteers, {list, filters})` and `volunteerDrawerBody({volunteer, isNew, ui})`, importing `esc`, `button`, `icon`, `loadingLine`, `unloadedLine`, `emptyLine` from where `office-views.mjs` gets them.

- Frame: overline `OFFICE · VOLUNTEERS`, title `Volunteers`, intro `Roles and certificates are recorded here. They don't change what anyone can do in ViTally yet.`, action button `Add a volunteer` (primary, `open-add-volunteer`).
- Toolbar: `select[data-volunteer-filter="role"]` (All roles and each role) and a search input with `id="volunteer-search"`, `name="volunteerSearch"`, `type="search"`, `aria-label="Search volunteers"`.
- Table: class `board-table people-table`, columns from the spec; foot `N of M volunteers`.
- Drawer order: name, email, phone, works, languages, other language (always in the DOM; hidden unless Other is ticked), roles, certificates (each showing its `full` text), `volunteerFormError` with `role="alert" id="volunteer-form-error"`, `drawerError`, then the submit button (`Add a volunteer` or `Save`, disabled when busy) and a `close-dialog` Cancel.
- In `views.mjs`, put the `volunteer` branch before the `log-call` branch: the final `else` assumes resolve-help. Title: `Add a volunteer`, or the volunteer's name.

In `personOptions`, keep a person when `!Array.isArray(p?.capabilities) || p.capabilities.length>0`.

- [ ] **Step 5: Run to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/controller.mjs src/volunteer-views.mjs src/views.mjs src/office-views.mjs src/pool-views.mjs tests/controller.test.mjs tests/volunteer-views.test.mjs tests/pool-views.test.mjs
git commit -m "Roster screen: list state, page and drawer"
```

### Task 5: Wiring and styles

**Files:**
- Modify: `src/app.mjs` (`EXITS` near 1774; `runNavigation` near 1826; `closeDialog` near 983; input listener near 2310; change listener near 2333; submit dispatch near 2394)
- Modify: `src/styles.css` (near `.board-table` at 2771 and `.office-drawer` at 3335)
- Modify the focus-description helper so `data-volunteer-id` identifies a row, as `data-case-id` and `data-item-id` do
- Test: `tests/shell.test.mjs`, if it pins the actions it needs extending

**Interfaces:**
- Consumes: Task 4's actions, controller calls and form ids.

- [ ] **Step 1: Wire navigation**

`EXITS["open-volunteers"]`: `formDrafts.clear(); controller.navigate("office-volunteers"); void controller.loadVolunteers();`. The `runNavigation` case uses `leaveAddCaseFirst("open-volunteers", target)`, like `open-cases`. `open-add-volunteer` and `open-edit-volunteer` call `controller.dismissError()`, `controller.clearVolunteerFormError()`, clear the form's drafts (Step 3), then `openDialog("volunteer", id ? {volunteerId:id} : null, describeFocus(target))`.

- [ ] **Step 2: Wire search, filter and the Other language field**

- `name="volunteerSearch"` on input: `controller.setVolunteerFilter("search", value)`, then refocus `#volunteer-search` and restore the caret.
- `select[data-volunteer-filter]` on change: set the filter and refocus by id.
- Ticking `language` with value `other` toggles `hidden` on the other-language field directly.

- [ ] **Step 3: Wire submit and close**

Dispatch `form.id === "volunteer-form"` to `submitVolunteer(form, by)`, which calls `volunteerFromForm(new FormData(form))`, then `await controller.saveVolunteer(...)`, and calls `closeDialog("#main")` on true. In `closeDialog`, use `"#main"` as the fallback when the dialog is `volunteer`, and delete the drafts of **every** field in `#volunteer-form`, text as well as ticks. `clearFormTicks` only removes ticks, and a leftover draft would appear in the next volunteer's drawer.

- [ ] **Step 4: Add the styles**

Reuse `.board-table` and `.office-drawer`. Add only what's missing: toolbar spacing, neutral chips for certificates and roles, the Remote badge, and fieldset spacing. Use existing tokens, no fixed widths, and no vertical lines in the table.

- [ ] **Step 5: Check it in a browser**

Run the app against the local stack, signed in as the site coordinator. Confirm: the link opens the Roster; search keeps focus while typing; Add saves and the row appears; Edit returns focus to its button on close.

- [ ] **Step 6: Run the unit tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app.mjs src/styles.css tests/shell.test.mjs
git commit -m "Roster screen: navigation, search, drawer wiring and styles"
```

### Task 6: Rehearsal volunteers in the local seed

First to cut. If cut, tell the user at once.

**Files:**
- Modify: `tools/admin/seed-values.mjs`, `tools/admin/seed-cases.mjs` (`seedWorkspace` near 389, `formatSeedResult` near 83)
- Test: `tests/seed.test.mjs`, `tests/database-volunteer-roster.mjs`

**Interfaces:**
- Consumes: `vitally_save_volunteer`, `callRpc(client, userId, name, args)`.
- Produces: `SEED_VOLUNTEERS`; `seedVolunteers(client, {workspaceId, actorUserId}) -> Promise<number>`; `seedWorkspace` returns `{casesRemoved, casesCreated, volunteersCreated}`.

Values for `SEED_VOLUNTEERS`, with emails `volunteer-01@example.org` to `-08` and phones `(215) 555-0141` to `-0148` (the fourth and seventh have none):

| Name | Works | Languages | Roles | Certificates |
| --- | --- | --- | --- | --- |
| Maya Lindgren | on_site | english | preparer | vsc, itqr, basic |
| Tomas Abara | remote | english, other (Spanish) | reviewer | vsc, itqr, advanced |
| Wen Tao Liu | on_site | mandarin, english | preparer, reviewer | vsc, itqr, basic, advanced |
| Priya Venkat | on_site_and_remote | english | intaker | vsc, itqr |
| Jordan Reyes | on_site | english | greeter | vsc |
| Hana Moretti | remote | cantonese, mandarin | preparer | vsc |
| Samir Haddad | on_site | english, other (Arabic) | admin | vsc, itqr, sc |
| Lucy Fong | on_site_and_remote | cantonese, english | intaker, greeter | none |

- [ ] **Step 1: Write the failing tests**

- In `tests/seed.test.mjs`: `formatSeedResult({casesRemoved:11,casesCreated:11,volunteersCreated:8})` includes `8 volunteers`; `formatSeedResult` without the field is unchanged; `SEED_VOLUNTEERS` has 8 entries covering every value in the fixed-values table, and every email ends in `@example.org`.
- In `tests/database-volunteer-roster.mjs`: `seedVolunteers` run twice on the fixture's workspace leaves exactly 8 people with those emails and no staff member changed.

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/seed.test.mjs`
Expected: the new test FAILS.

- [ ] **Step 3: Implement**

First delete `people` in the workspace where `user_id is null` and the profile's email is on the list (the foreign keys remove the rest). Then call the RPC for each volunteer, with `actorUserId` being the site coordinator found by `resolveSeedTargets`. Call it from `seedWorkspace` only, never from `seedCases`, because the story calls `seedCases` directly.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/seed.test.mjs`, then `node --env-file=.env.test --test tests/database-volunteer-roster.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/admin/seed-values.mjs tools/admin/seed-cases.mjs tests/seed.test.mjs tests/database-volunteer-roster.mjs
git commit -m "Local seed: add fictional volunteers for the Roster"
```

### Task 7: Separate browser test

**Files:**
- Modify: `tests/browser.mjs` (a new top-level `test`, placed before the two story tests near line 8334)

**Interfaces:**
- Consumes: `createBrowserFixture` and the file's sign-in helpers, as `runPermutation` uses them; Task 4's ids and actions.

- [ ] **Step 1: Write the test**

Name: `"An admin adds, finds and edits a volunteer on the Roster"`, with `{ timeout: 300_000 }`, in Chrome only, on its own `createBrowserFixture()`. It adds no phases to the story. Fixture data: fictional, `@example.org`. Steps and assertions:

1. Sign in as the site coordinator. `open-volunteers` shows the Roster, with the existing staff showing `No roles recorded`.
2. Press Add a volunteer. Type a name, then update a `people` row with `fixture`'s SQL to cause a live redraw, and assert the typed name is still in the field.
3. Finish the form with a role and one certificate, and save. The drawer closes and the row appears.
4. Type part of the phone in search: only that row, and `#volunteer-search` still has focus. Clear it. Choose another role in the filter: the row is gone.
5. Edit: change the name and save. The table shows the new name, and focus is back on that row's Edit button.
6. In a new context, sign in as the preparer: no `open-volunteers` link.

- [ ] **Step 2: Run only this test**

Run: `node --env-file=.env.test --test --test-name-pattern="adds, finds and edits a volunteer" tests/browser.mjs`
Expected: PASS, well inside the 5-minute timeout. Note the test count before and after for the PR.

- [ ] **Step 3: Commit**

```bash
git add tests/browser.mjs
git commit -m "Browser test: an admin works the Roster"
```

### Task 8: Docs and the full checks

**Files:**
- Modify: `docs/setup.md` (count at line 396, table near 447), `docs/developer/database.md` (count at 27, tables near 186, realtime note near 681)

- [ ] **Step 1: Update the docs**

Migration counts become forty-four (001 to 044); add a row for `044_volunteer_roster_records.sql`; add rows for the three tables; note on `people` that a volunteer with no sign-in is readable only by admins; note that the three tables aren't published.

- [ ] **Step 2: Run every check**

Run: `npm test`, `npm run db:migrate:test`, `npm run test:database`, `npm run test:auth-browser`, `npm run test:browser` (about 20–25 minutes), `npx openspec validate --all`.
Expected: all pass. `npm run build:hant -- --check` isn't needed, because no Chinese text changed. If a suite fails intermittently, read the recorded error and diff that path against `main` before re-running.

- [ ] **Step 3: Commit**

```bash
git add docs/setup.md docs/developer/database.md
git commit -m "Docs: migration 044 and the Roster tables"
```
