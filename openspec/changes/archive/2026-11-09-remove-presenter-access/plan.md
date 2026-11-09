# Remove presenter access: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migration 043 removes presenter access from the database, along with presenter accounts, their test-run receipts and every demonstration persona that nothing references. The app, tools, tests and docs stop using `presenter`, `p_person_id` and `personId`. Every check that guarded presenter behaviour is converted, or replaced by a check on an account with no membership.

**Architecture:**
- **One migration, in one transaction.** 043 is hand-written. It refuses first (`VT008`), then:
  1. deletes the data (receipts, memberships, accounts, unreferenced personas);
  2. re-adds the access check;
  3. rewrites the policies in place;
  4. replaces `acting_person`, the six RPCs and `initialize_workspace` with signatures that have no person parameter and no presenter list;
  5. rewrites four helpers and `add_staff_member` with `CREATE OR REPLACE`.
- **The local stack gets 043 only through a counted, backed-up procedure,** with the refusal verified on a restored throwaway copy.
- **The browser** loses the presenter screen, `inert()` and `personId`. An account with no membership keeps the existing `noAccessScreen`.

**Tech Stack:** PostgreSQL / Supabase SQL migrations, ES-module browser app, `node:test` unit and database suites, the Playwright browser story, Node tooling in `tools/admin/`.

**Spec:**
- `openspec/changes/remove-presenter-access/specs/`: sign-in, staff-case-work, demo-tools;
- design: `openspec/changes/remove-presenter-access/design.md`, D1–D9;
- decision log: `openspec/changes/remove-presenter-access/brainstorm.md`.
  - Q8 and Q9 are the per-test tables.
  - Q11 lists the person-reference columns.
  - Q13 is the count plan.
  - The "Builder check" section answers three planning questions.

## Global Constraints

**The migration**
- The file is `supabase/migrations/043_remove_presenter_access.sql`. Never edit an applied migration (001–042). 041 is main's `041_resolve_go_over_during_hold.sql` (#176). 042 is #172's migration (let-follow-up-holders-work-any-follow-up), which merges to main before this change.
- **No `CASCADE`** in our SQL. Drop each old signature by its full identity:
  - `public.vitally_apply_action(uuid,uuid,bigint,uuid,text,jsonb)`;
  - `public.vitally_assistance_action(uuid,uuid,bigint,uuid,text,text)`;
  - `public.vitally_close_unsigned(uuid,uuid,jsonb,boolean)`;
  - `public.vitally_create_case(uuid,text,uuid,jsonb)`;
  - `public.vitally_log_contact(uuid,uuid,uuid,uuid,jsonb)`;
  - `public.vitally_edit_contact(uuid,uuid,bigint,uuid,jsonb)`;
  - `vitally_private.acting_person(public.memberships,uuid)`;
  - `vitally_private.initialize_workspace(uuid,uuid[],uuid[])`.

  Supabase's own `auth` foreign keys cascade when `auth.users` rows are deleted. That is allowed (user ruling).
- **The source for every rewritten function** is its live definition on the stack at 040. None of the 14 replaced functions is redefined in 041; #176 redefines only `act_resolve_followup`, which 043 doesn't touch (checked at propose against every migration file). **Exception: `add_staff_member` is copied from #172's 042**, once it is on main, keeping only this change's edit (the reserved `alex`/`morgan`/`sam` keys removed). After #172 merges, every other replaced function is re-checked against main's newest definitions: `select pg_get_functiondef('<schema>.<name>(<args>)'::regprocedure)`. Change only what this plan states.

**Order in 043**
1. **Refusal.** Count presenter user ids (`select user_id from public.memberships where access='presenter'`) in each of:
   - `cases.owner_user_id`, `case_events.actor_user_id`, `documents.submitted_by_user_id`, `contact_attempts.actor_user_id`, `contact_log.logged_by_user_id`, `contact_log_versions.edited_by_user_id` and `people.user_id`, each matched on `(workspace_id, user_id)`;
   - `cases.created_by_user_id`;
   - any other `memberships` row of the same `user_id`.

   If any count is above zero: `raise exception using errcode = 'VT008', message = '043 refused: presenter accounts are referenced (' || <kind=count, …> || ')', detail = <same>`.
2. `delete from public.action_receipts where actor_user_id in (<presenter user ids>)`.
3. Delete the presenter memberships.
4. `delete from auth.users where id in (<those ids>)`. Capture the ids into a temp table before step 3.
5. **Persona clean-up.** Delete from `public.people` where `person_key in ('alex','morgan','sam') and user_id is null` and no row references the person's id. A reference is:
   - any column found by `pg_constraint` (`contype='f'`, `confrelid='public.people'::regclass`), excluding `workspace_id` and `id` key parts;
   - `action_receipts.actor_person_id`.

   Use a `DO` block with `format()`.
6. `alter table public.memberships drop constraint memberships_access_check, add constraint memberships_access_check check (access in ('applicant','staff'))`.
7. **The 22 policies.** For each policy whose `qual` contains `access = ANY (ARRAY['presenter'::text, 'staff'::text])`, run `ALTER POLICY … USING (<the same expression with that test replaced by access = 'staff'>)`. Then `ALTER POLICY presenter_<t> ON public.<t> RENAME TO staff_<t>` for the 16 tables in brainstorm Q1. Write the 22 statements out literally, not with a `DO` loop, so the file is reviewable.
8. **New functions.**
   - `vitally_private.acting_person(p_member public.memberships) returns public.people`, `STABLE SECURITY DEFINER SET search_path TO ''`:
     - `staff`: the person with `workspace_id=p_member.workspace_id and user_id=p_member.user_id`, or `raise sqlstate 'VT001' using message='FORBIDDEN'`;
     - `applicant`: return an empty `people` value;
     - anything else: FORBIDDEN.
   - **The six RPCs.** Remove `p_person_id` from the old body. Call `vitally_private.acting_person(v_member)` where it was called with two arguments. Keep `'personId', v_person.id` in the digest.
   - `vitally_private.initialize_workspace(p_workspace_id uuid, p_applicants uuid[])`: the old body without the presenter loop, the persona inserts, the "three unlinked people" check and the Sam default. It keeps the existing-workspace `followup` check on the current default.
9. **Rewrites with `CREATE OR REPLACE`, same signature:**
   - `check_operation_authority`, `contact_person`, `lock_case`, `lock_assistance_item`: `in ('presenter','staff')` / `not in ('presenter','staff')` become `= 'staff'` / `<> 'staff'`, and comments drop "presenter".
   - `act_close_case`: comment only.
   - `add_staff_member`: drop `or p_person_key in ('alex','morgan','sam')`.
   - `public.vitally_log_contact` is new anyway, so drop its "persona" comment there.

**Grants**
- Every new function gets `revoke all on function <sig> from public, anon, authenticated, service_role;`.
- The six RPCs then get `grant execute on function <sig> to authenticated;`.
- `acting_person` and `initialize_workspace` get no grant.

**Exact texts**
- The roster note, verbatim: `presenters is no longer used and was ignored; those addresses get no access.`
- The refusal SQLSTATE is `VT008`.

**Rules**
- **Test rule:** a test is removed only if the code it tested is removed in this change, and its report entry names that code with a grep that shows it gone. Every other check is converted or replaced, as brainstorm Q8 and Q9 list.
- **No test disables a trigger** or sets `session_replication_role`.
- **Counts** come from the runner's `ℹ tests` line, never from the source.
- **Text:** no 简体 text changes are expected. If one happens, run `npm run build:hant` and commit `src/zh-hant.mjs`. Staff screens stay English.

**The local stack**
- Never run `supabase start` from the repo root.
- The database, browser and auth-browser suites run one at a time, with no other test process on the stack.
- **Applying 043 to the local stack can't be undone,** and it breaks other branches' database and browser suites, and the local app, until this branch's later tasks land. Task 1 stops for the controller, who confirms with the user, before the stack procedure.

**Data and output**
- Fictional data only.
- No email address in output; this includes `.vitally-roster.local.json`, which is read for its `workspaceId` at most and never edited.
- LF line endings only.

**Commits** each end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A replay of a receipt stored before 043** (whose digest was computed with the then-resolved person) must return the stored receipt, not a conflict. An old-path receipt can't be created after 043, so two tests stand in. Task 1's catalog test asserts that each RPC's digest still contains `'personId', v_person.id`. Task 2's "an identical replay keeps its actor" asserts that a replay returns the stored receipt.
2. **A window signed in before 043 as a presenter** must, after refresh, show the no-access screen and read nothing, not an error page. Test in Task 4: the controller's no-membership window tests, including focus, online and Try again.
3. **An old local roster with `presenters` and `sampleCaseOwners`** must apply, print both notes, and create no account for the presenter addresses. Test in Task 3.
4. **A staff-only workspace whose default follow-up person was never set** (a new workspace before `set_default_followup`) must not break escalation. The roster always sets it. Test in Task 2: `initialize_workspace` on a new workspace leaves the default null, and a roster run sets it in the same transaction.
5. **The seed on a stack that kept Sam as default** must still refuse, with its existing message. Test in Task 3: the seed's role-resolution test with a kept Sam default still refuses.

---

### Task 1: Migration 043, its catalog tests, and the stack procedure

**Files:**
- Create: `supabase/migrations/043_remove_presenter_access.sql`
- Modify: `tests/database-catalog.mjs`
- Scratch, not committed, in the session scratchpad: `refusal-precheck.sql`, `counts.sql`, the backup file, and the before/after/throwaway outputs

**Interfaces:**
- Produces:
  - the migrated schema;
  - `public.vitally_apply_action(p_action_id uuid, p_case_id uuid, p_expected_revision bigint, p_type text, p_payload jsonb)`;
  - `public.vitally_assistance_action(p_action_id uuid, p_item_id uuid, p_expected_revision bigint, p_type text, p_note text)`;
  - `public.vitally_close_unsigned(p_action_id uuid, p_cases jsonb, p_confirmed boolean)`;
  - `public.vitally_create_case(p_action_id uuid, p_mode text, p_answers jsonb)`;
  - `public.vitally_log_contact(p_action_id uuid, p_case_id uuid, p_followup_id uuid, p_entry jsonb)`;
  - `public.vitally_edit_contact(p_action_id uuid, p_contact_id uuid, p_expected_revision bigint, p_entry jsonb)`;
  - `vitally_private.initialize_workspace(p_workspace_id uuid, p_applicants uuid[])`.

- [ ] **Step 0: Baselines.** Check the stack is idle: no other `node` test process, and the `supabase_*_vitally-hailey.*` containers are up. Then record `ℹ tests` from each of:
  - `npm test` (expected 1496);
  - `npm run test:database`, alone;
  - `npm run test:auth-browser`, alone (expected 20);
  - `npm run test:browser`, plain, alone (expected 83).

  These are the "before" counts.
- [ ] **Step 1: Write the failing catalog tests** in `tests/database-catalog.mjs`. Convert the existing ones and add new ones:
  - **"no function, constraint, policy or view mentions presenter":** each of these returns no rows:
    - `pg_proc` in `public`/`vitally_private` with `prosrc ~* 'presenter'`;
    - `pg_constraint` with `pg_get_constraintdef(oid) ~* 'presenter'`;
    - `pg_policy` with `polname ~* 'presenter'` or `pg_get_expr(polqual, polrelid) ~* 'presenter'`;
    - `pg_views` with `definition ~* 'presenter'`.
  - **"every table keeps exactly its RLS policies":** the 24 `(table, name)` pairs, with the 16 `presenter_<t>` names as `staff_<t>`.
  - **"the public API is exactly six RPCs":** `select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' from pg_proc p where pronamespace='public'::regnamespace` deep-equals the six signatures above. For each, `has_function_privilege` is true for `authenticated` and false for `anon` and `service_role`. No argument is named `p_person_id`.
  - **"the old signatures are gone":** `to_regprocedure(...)` is null for each of the eight identities in Global Constraints.
  - **"private entry points are not callable by clients":** `has_function_privilege(role, 'vitally_private.acting_person(public.memberships)', 'execute')` and the same for `initialize_workspace(uuid,uuid[])` are false for `anon`, `authenticated` and `service_role`.
  - **"the digest still records the resolved person"** (Review Focus 1): each of the six RPC sources matches `'personId', v_person.id`.
  - **"the access check allows two values":** inserting a membership with `access='presenter'` is refused by `memberships_access_check`.
- [ ] **Step 2: Run them to see them fail** on the stack before 043: `node --env-file=.env.test --test tests/database-catalog.mjs`. Expected: FAIL on presenter mentions, policy names, signatures and access. Record the output.
- [ ] **Step 3: Write 043** in the Global Constraints order. Copy each function from `pg_get_functiondef` on the stack, and check that no migration after 040 redefines it.
- [ ] **Step 4: Write the scratch scripts.** Both are read-only, run with `psql` through `docker exec` on the stack's database.
  - **`refusal-precheck.sql`:** the nine counts of 043's refusal.
  - **`counts.sql`:**
    - `count(*)` of every table in `public`;
    - `people` grouped by `person_key in ('alex','morgan','sam')` and `user_id is null`;
    - `memberships` by `access`;
    - `action_receipts` in total, and those whose actor is a presenter;
    - `workspaces.id` with `default_followup_person_id` and that person's key;
    - `count(*)` of `auth.users`, `identities`, `sessions`, `refresh_tokens`, `mfa_factors`, `mfa_challenges`, `mfa_amr_claims`, `one_time_tokens`, `oauth_authorizations`, `oauth_consents`, `webauthn_credentials` and `webauthn_challenges`, plus each one's rows belonging to presenter accounts.
- [ ] **Step 5: Stop for the controller.** Report NEEDS_CONTEXT with "ready to start the stack procedure for 043" and wait. The controller tells the user that the before-counts are starting, so they stay off the local app, and waits for the user's go-ahead.
- [ ] **Step 6: Pre-check.** Run `refusal-precheck.sql`. If any count is above zero, report BLOCKED with the counts and change nothing.
- [ ] **Step 7: Before-counts and backup.**
  1. Run `counts.sql` and save the output as `before.txt`.
  2. Run `pg_dump -Fc` of the stack's database inside the container and copy it to the scratchpad.
- [ ] **Step 8: Restore check and throwaway refusal test.**
  1. `createdb vitally_throwaway` in the same container, and `pg_restore` the backup into it. Run `counts.sql` there; it must equal `before.txt`.
  2. In `vitally_throwaway`, insert a fictional `auth.users` row (`…@vitally.invalid`), a `presenter` membership in workspace `160fc95a-…`, and a `case_events` row on one of its cases with that `actor_user_id`.
  3. Apply main's 041 and 042 to the copy, in order (`psql -v ON_ERROR_STOP=1 -1 -f <file>` for each). Then run `psql -v ON_ERROR_STOP=1 -1 -f 043_remove_presenter_access.sql`. Expected: `ERROR: 043 refused: presenter accounts are referenced (case_events.actor_user_id=1, …)` with SQLSTATE `VT008`.
  4. Run `counts.sql` again; it must be unchanged from step 2's state.
  5. Delete the seeded `case_events` row and run 043 again. Expected: success.
  6. Save every command and output.
  7. `dropdb vitally_throwaway`.
- [ ] **Step 9: Apply.** Run `npm run db:migrate:test`. It applies main's 041 and 042, then 043. Before the before-counts, read #172's 042 and note any rows it changes; the expected differences are 043's plus exactly those. Expected: "Approved test migrations applied." If it fails, report BLOCKED with the code, and never edit a migration that is already applied anywhere.
- [ ] **Step 10: After-counts.** Run `counts.sql` and save it as `after.txt`. Compute the expected differences from `before.txt`, as in brainstorm Q13:
  - receipts: minus the presenter receipts;
  - memberships: minus the presenter memberships;
  - each `auth` table: minus its presenter rows;
  - people: minus the unreferenced personas, counted from `before.txt`'s persona rows less those still referenced;
  - every other table: 0.

  **Any difference that doesn't match stops the work:** report BLOCKED with both tables. Otherwise, the controller tells the user that the after-counts are done.
- [ ] **Step 11: Run the catalog tests to see them pass:** `node --env-file=.env.test --test tests/database-catalog.mjs`. Expected: PASS. List the other database suites' failures for Task 2.
- [ ] **Step 12: Commit** "Database: migration 043 removes presenter access (#136)". The report carries the before/after table, the expected differences, and the throwaway refusal transcript.

### Task 2: The database fixture and suites

**Files:**
- Modify:
  - `tests/support/database-fixture.mjs`, `tests/support/rpc-signatures.mjs`, `tools/admin/workspace-setup.mjs`;
  - `tests/database.mjs`, `database-staff-identity.mjs`, `database-store.mjs`, `database-actions.mjs`, `database-assistance.mjs`, `database-contacts.mjs`, `database-documents.mjs`, `database-intake*.mjs`, `database-review*.mjs`, `database-stages*.mjs`, plus every other suite that greps positive for `presenter`, `p_person_id`, `personId`, `f.alex`, `f.morgan`, `f.sam` or `AsPersona`.

**Interfaces:**
- Consumes: Task 1's signatures.
- Produces:
  - `initializeWorkspace({ workspaceId, applicantUserIds, staff, defaultFollowup, target }, { afterInitialize })`, which calls `vitally_private.initialize_workspace($1,$2::uuid[])`.
  - The fixture's arg builders (`applyArgs`, `assistanceArgs`, `contactArgs`, `editContactArgs`) and helpers (`createCase`, `act`, `logContact`, `closeUnsigned`), with no `personId` option.
  - The fixture: role staff (`f.siteCoordinator`, `f.preparer`, `f.reviewer`, `f.intaker`), workspace default `site_coordinator`, and a foreign workspace with one staff person `f.foreignStaff`.

- [ ] **Step 1: `workspace-setup.mjs`.** Drop `presenterUserIds` and call the two-argument initializer.
- [ ] **Step 2: The fixture** (tasks.md 4.1):
  - remove the presenter account, `presenterUserIds`, `initializeVerified`'s persona asserts, `f.alex`/`f.morgan`/`f.sam`, the three `…AsPersona` helpers, the `staffReader` presenter fallback, and `personId` in the builders;
  - grep `roleAccounts` and `siteCoordinatorFollowsUp`; remove them only with no caller;
  - `insertShaded` defaults to `f.reviewer`'s person;
  - `seedWorkflow` acts through role accounts;
  - `initializeVerified` now asserts: people are exactly the staff, and the default is `site_coordinator`.
- [ ] **Step 3: `rpc-signatures.mjs`.** The six signatures without the person argument; drop `assistPersonId`.
- [ ] **Step 4: Remove the 2 tests whose code is gone.** In `database-staff-identity.mjs`: "a presenter chooses a demo persona" and "a presenter tries a staff member's person". Record `grep -n "presenter" supabase/migrations/043_remove_presenter_access.sql` and the new `acting_person` body as the evidence that the presenter branch is gone.
- [ ] **Step 5: The replacements**, each named in the report with the test it replaces:
  - **"a call carrying p_person_id matches no function and writes nothing"** replaces staff-identity "naming its own person is the same as null", "naming someone else is FORBIDDEN", "a client names a person" and "a tampered request", and database-store "a client who forges a staff person". For one staff session and one applicant session, call `vitally_apply_action` through the API with an extra `p_person_id`. Expect PostgREST error `PGRST202` and unchanged receipt and event counts.
  - **"two access types; presenter is refused"** replaces "the three access types".
  - **"every entry point records the staff member"** replaces "every entry point resolves the person": keep its null half for all six RPCs.
  - **"an identical replay keeps its actor"** replaces "a replay keeps its actor" (Review Focus 1).
  - **"two staff accounts share one action id"** replaces "a staff member reusing a presenter's action id": receipts are per account.
  - **"staff rows equal a privileged read minus private drafts"** replaces "staff read the same rows as a presenter": compare each staff table's rows with a `postgres` read of the same workspace, excluding draft cases.
  - **"a re-run of the initializer is idempotent and staff-only"** replaces database.mjs "the initializer preserves people…". It adds Review Focus 4: a new workspace's default is null after `initialize_workspace` alone, and `site_coordinator` after `initializeWorkspace` with `defaultFollowup`.
- [ ] **Step 6: Reserved-key tests** (`database-staff-identity.mjs` or the roster database suite):
  - **"a freed persona key can be added as staff":** `add_staff_member` with key `sam` in a fixture workspace with no `sam` succeeds.
  - **"a kept persona's key is refused":** insert an unlinked `sam` person with privileged SQL, call `add_staff_member` with key `sam`, and expect VALIDATION, with the `sam` row's `user_id` still null.
- [ ] **Step 7: Convert the rest.** The presenter becomes `f.siteCoordinator` or the matching role, persona ids become role person ids, `personId`/`p_person_id` is dropped, and titles saying "presenter" are reworded. database.mjs's policy-expression test (~1125) expects `access = 'staff'`.
- [ ] **Step 8: Grep.** `grep -rn -i "presenter\|p_person_id\|personId\|AsPersona\|f\.alex\|f\.morgan\|f\.sam" tests/database*.mjs tests/support` prints nothing.
- [ ] **Step 9: Run** `npm run test:database`, alone. Expected: all pass. Record `ℹ tests` and the remove/replace/convert lists, with counts.
- [ ] **Step 10: Commit** "Database tests: staff and clients only (#136)".

### Task 3: Tools and the roster

**Files:**
- Modify:
  - `tools/admin/roster.mjs`, `tools/admin/roster.example.json`, `tools/admin/seed-cases.mjs`;
  - `tests/roster.test.mjs`, and the seed's unit tests (`tests/seed-*.test.mjs`, if they assert envelopes).

**Interfaces:**
- Consumes: Task 2's `initializeWorkspace`.
- Produces:
  - `parseRoster(raw) -> { workspaceId, applicants, staff, defaultFollowup }`, with no `presenters`;
  - `rosterNotes(raw) -> string[]`;
  - `applyRoster(...) -> { workspaceId, applicants, staff, created, confirmed }`.

- [ ] **Step 1: Write the failing tests** in `tests/roster.test.mjs`:
  - **"an old roster's presenters are ignored with a note":** `rosterNotes({ ..., presenters: ["p@vitally.invalid"] })` includes `presenters is no longer used and was ignored; those addresses get no access.`, and `parseRoster` returns no `presenters`. **Review Focus 3:** with both `presenters` and `sampleCaseOwners`, both notes print, and `applyRoster`'s fake admin creates no account for the presenter address.
  - **"a roster with no defaultFollowup is refused":** `ROSTER_INVALID`.
  - **"a roster with no staff is refused":** `ROSTER_INVALID`.
  - **"any valid key is accepted by the parser":** `sam` passes `parseRoster`. This converts the reserved-key test.
- [ ] **Step 2: Run** `node --test tests/roster.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Change `roster.mjs`** as tasks.md 5.2 describes. The summary line reads `${staff} staff, ${applicants} applicant(s)`. `HINTS.VALIDATION` adds: "or a staff key may already belong to a kept persona."
- [ ] **Step 4: Change `roster.example.json`** (drop `presenters`) and `seed-cases.mjs` (drop `p_person_id`).
- [ ] **Step 5: Convert the remaining roster tests** that build presenter rosters. Remove only the "at least one presenter" assertion, whose code is gone.
- [ ] **Step 6: Review Focus 5.** In the seed's test suite, the existing "default follow-up is still a persona" refusal test still passes unchanged; if it's a database test, run it.
- [ ] **Step 7: Run** `npm test`. Expected: the roster and seed tests pass; other failures belong to Tasks 4–5.
- [ ] **Step 8: Commit** "Roster: staff and a default follow-up person; presenters ignored (#136)".

### Task 4: The store, the contracts and the controller

**Files:**
- Modify:
  - `src/supabase-store.mjs`, `src/contracts.mjs`, `src/controller.mjs`, `src/window-state.mjs`;
  - `tests/store.test.mjs`, `tests/controller.test.mjs`.

**Interfaces:**
- Consumes: Task 1's RPC signatures.
- Produces:
  - an Action/request with no `personId` key;
  - a store with no `actingPerson` and no `SUBSCRIBED_TABLES.presenter`;
  - a controller with no `inert()` and no `testing` export. For access other than `staff`/`applicant`, or no membership, `screen` is `no-access`.

- [ ] **Step 1: Write the failing tests:**
  - `store.test`: each of the six store calls sends an envelope with no `p_person_id` key, for the default `fakeClient`, which is now `access: "staff"`.
  - `controller.test`: every built request has no `personId` key. This converts the 19 `personId === null` asserts.
  - **No-membership window tests,** which replace the six presenter-window tests: with `getPrincipal` resolving no membership, the window shows `no-access`, and on load, focus, online and Try again it makes no store call other than `getPrincipal` (Review Focus 2).
- [ ] **Step 2: Run** `node --test tests/store.test.mjs tests/controller.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** tasks.md 6.1 and 6.2. Grep for readers of `mapPerson`'s `linked` before removing it.
- [ ] **Step 4: Remove `store.test` "a presenter's call still names the person"** (its code, `actingPerson`, is gone; show the grep). Convert the 36 `fakeClient` tests to `staff`.
- [ ] **Step 5: Run** `npm test`. Expected: store and controller pass.
- [ ] **Step 6: Commit** "Browser: requests carry no person; no presenter state (#136)".

### Task 5: The screens

**Files:**
- Modify:
  - `src/views.mjs`, `src/app.mjs`, `src/language.mjs`;
  - `tests/shell.test.mjs`, `tests/language.test.mjs`, `tests/shaded-editor.test.mjs`, `tests/staff-views.test.mjs`, `tests/admin-views.test.mjs`, `tests/office-views.test.mjs`.

**Interfaces:**
- Consumes: Task 4's `no-access` screen state.

- [ ] **Step 1: Write the failing tests** in `shell.test`, replacing the two presenter tests:
  - **"the no-access screen offers only Sign out":** the rendered page holds "This account has no access" and exactly one action, `sign-out`.
  - **"the no-access screen uses the client frame and follows the language":** with `lang: "zh"`, it shows "此账户无权使用", inside the client frame's whole-page markup. Assert the frame element, not only the inner screen (#169's lesson).
- [ ] **Step 2: Run** `node --test tests/shell.test.mjs`. Expected: the new tests may already pass. Record the result; if they pass, say they pin existing behaviour.
- [ ] **Step 3: Implement** tasks.md 6.3.
- [ ] **Step 4: Convert** language ~44 (drop the presenter assertion ~46), shaded-editor ~397, staff-views ~583/~1507/~2589, admin-views ~771/~783, office-views ~903 and shell ~1291.
- [ ] **Step 5: Grep.** `grep -rn -i presenter src tests/*.test.mjs` and `grep -rn "p_person_id\|personId" src` print nothing.
- [ ] **Step 6: Run** `npm test`. Expected: all pass. Record `ℹ tests` and the remove/replace/convert lists.
- [ ] **Step 7: Commit** "Browser: the presenter screen and inert() go (#136)".

### Task 6: The browser story

**Files:**
- Modify: `tests/browser.mjs`, and `tests/support/` if the `unapproved` actor needs a helper.

**Interfaces:**
- Consumes: the fixture's `unapproved` actor (no membership), and Task 5's screens.

- [ ] **Step 1: Replace the presenter sections** (`signInPresenter`/`assertPresenterScreen` ~294–338, ~935–963, ~1035–1059, ~7827–7830, ~8117–8146) with the `unapproved` actor:
  - it signs in;
  - it sees "This account has no access" with Sign out;
  - it makes the same zero reads and subscriptions the presenter checks asserted;
  - Sign out returns it to the sign-in form.

  Keep `windowState:false`.
- [ ] **Step 2: Drop `personId`** from R62's forged request and the others (~3994–4001, ~4019–4027, ~7995–8002). R62 still expects the applicant's call to be refused and nothing written.
- [ ] **Step 3: Run** `npm run test:browser`, plain, alone on the stack. Expected: 83/83, 40 phases. No check trimmed; if it runs over the time limit, stop and show the per-phase timings.
- [ ] **Step 4: Run** `npm run test:auth-browser`, alone. Expected: all pass (20).
- [ ] **Step 5: Commit** "Browser story: the no-access account replaces the presenter (#136)".

### Task 7: Docs

**Files:**
- Modify:
  - `README.md`, `docs/setup.md`, `docs/design/DESIGN.md`;
  - `docs/developer/README.md`, `architecture.md`, `backend.md`, `database.md`, `frontend.md`, `production-roadmap.md`.

- [ ] **Step 1: Update** each file: no presenter, no personas in new workspaces, staff and `defaultFollowup` required, no `p_person_id`.
  - `docs/setup.md` gains a short "Migration failed (VT008)" entry: what it means, and the read-only query that shows the counts.
  - The roadmap marks presenter access done in #136.
- [ ] **Step 2: Grep.** `grep -rn -i "presenter\|persona\|p_person_id" README.md docs --include=*.md`, excluding `docs/superpowers/`, `docs/demo-script.md`, `docs/m4-tradeoffs.md` and `docs/design/redesign-review.md`. Each hit is either fixed or left with a reason in the report.
- [ ] **Step 3: Commit** "Docs: presenter access removed (#136)".

### Task 8: Whole-branch verification

- [ ] **Step 1:** `npm test`: all pass; record `ℹ tests`.
- [ ] **Step 2:** `npm run test:database`, alone: all pass; record `ℹ tests`.
- [ ] **Step 3:** `npm run test:auth-browser`, alone: all pass.
- [ ] **Step 4:** `npm run test:browser`, plain, alone: 83/83.
- [ ] **Step 5:** `npm run build:hant -- --check`: passes.
- [ ] **Step 6:** `npm run build:intake`, then `git status --short`: nothing to commit.
- [ ] **Step 7:** `npx openspec validate --all`: passes.
- [ ] **Step 8: Report** the before/after counts table for every suite, the remove/replace/convert lists with each removal's code and grep, the stack row-count table, and the throwaway refusal transcript.

After archive, tasks.md group 9 still applies: the sign-in Purpose line, and the note in `retrospective.md` and the PR about the out-of-date local roster.
