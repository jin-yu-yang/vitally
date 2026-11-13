# Volunteer Clearance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A staff member reads case data and calls the six case RPCs only when cleared for the current season, and their roles, backed by confirmed certificates, decide what they can do.

**Architecture:**
- **Database:** one hand-written migration, `045_volunteer_clearance.sql`, adds:
  - a deferred constraint trigger tying roles to certificates;
  - SQL helpers for role needs, effective capabilities and clearance;
  - a no-argument InitPlan helper in the staff branch of the 21 case-data policies;
  - a VT009 refusal at the top of the six case RPCs;
  - the open-work rule in `vitally_save_volunteer`;
  - `vitally_my_clearance()`.
- **App:** the browser reads `vitally_my_clearance()` at sign-in. It shows a setup screen when the person isn't cleared, and uses the effective capabilities for the signed-in person's own buttons.
- **Fixtures and seed:** they give the role accounts roles and certificates, so existing suites and the demo keep working.

**Tech Stack:** Supabase Postgres (plpgsql, RLS, Realtime), plain ES modules in `src/`, `node:test`, Playwright (`tests/browser.mjs`, `tests/auth-browser.mjs`).

**Spec:** `openspec/changes/add-volunteer-clearance/`: `design.md` and `specs/{volunteer-clearance,volunteer-roster,sign-in,staff-case-work,local-seed-data}/spec.md`. `brainstorm.md` holds the user's rulings.

## Global Constraints

- **Fictional data only** in code, tests, fixtures and docs.
- **Migrations:** never edit an applied migration (001–044). Everything goes in `supabase/migrations/045_volunteer_clearance.sql`.
- **Local stack:** never run `supabase start` from the repo root. The test stack runs from `$VITALLY_STACK`.
- **Error codes:** VT009 = `NOT_CLEARED`. VT008 is used only as the 045 refusal, as in 043. VT001–VT007 keep their meanings.
- **Role needs:**
  - Greeter: `vsc`;
  - Intaker: `vsc`, `itqr`;
  - Admin: `vsc`, `itqr`;
  - Preparer: `vsc`, `itqr`, and `basic` or `advanced`;
  - Reviewer: `vsc`, `itqr`, and `basic` or `advanced`.
  - Only `status='confirmed'` certificates of the same season count.
- **Role capabilities:**
  - greeter: `{}`;
  - intaker: `{receive_documents,assist}`;
  - preparer: `{prepare}`;
  - reviewer: `{prepare,review}`;
  - admin: `{admin,followup,assist,receive_documents}`.
- **Effective capabilities** = the union of the role capabilities of the current-season entry ∩ `people.capabilities`.
- **Cleared** = the current-season entry has ≥1 role, and (`not is_new` or `photo_id_checked_at is not null`).
- **Staff screens stay English.** No client text changes, so `build:hant` is not needed.
- **Exact copy:**
  - "Finish your setup for this season"
  - "Upload your signed Form 13615."
  - "Have your photo ID checked."
  - "Ask <name>, your site coordinator."
  - "Check again"
  - "New volunteer"
  - "Photo ID checked"
  - "<name> still has open work: <list>. Finish it or hand it over first."
  - "<Role> needs <certificates>." (for example "Preparer needs IT&QR and Basic or Advanced.")
  - Roster sentence: "Volunteers work on cases only once they are cleared."
- **Certificate labels:** `vsc` VSC, `itqr` IT&QR, `sc` SC, `basic` Basic, `advanced` Advanced (as in `src/volunteer-roster.mjs`).

## Review Focus

1. **A cleared caller acting on a case they hold, after an admin narrows their role without open work.** Effective capabilities must apply on the very next call, with no caching. Test in Task 4: change roles between two calls in one test.
2. **An admin unticks a certificate but leaves the dependent role ticked in the form.** The save removes that role, and doesn't refuse, when the role was already held. A newly added role without certificates is refused. Test in Task 6.
3. **The `visible_*` policies' client branch.** A client must still read their own draft and documents exactly as before. Test in Task 3: a client snapshot before and after.
4. **The signed-in person appears in both `people` (ceiling) and the clearance (effective).** Every own-button check must use effective, and the Volunteers link the ceiling. Test in Task 9: ceiling `[admin]` with role Intaker shows Volunteers, and doesn't offer office-admin-only actions that need `admin`.
5. **The setup screen's focus re-check firing while a check is in flight.** At most one `vitally_my_clearance()` request at a time. Test in Task 10.

---

### Task 1: Migration 045 part 1: guard, strip, columns, role helpers, trigger

**Files:**
- Create: `supabase/migrations/045_volunteer_clearance.sql`
- Create: `tests/database-clearance.mjs`

**Interfaces:**
- **Produces (SQL, all `search_path=''`):**
  - `vitally_private.confirmed_certificates(p_workspace_id uuid, p_person_id uuid, p_season smallint) returns text[]`, stable;
  - `vitally_private.missing_certificates(p_role text, p_certificates text[]) returns text[]`, immutable. It returns labels in the order `VSC`, `IT&QR`, `Basic or Advanced`, empty when met;
  - `vitally_private.role_capabilities(p_roles text[]) returns text[]`, immutable, sorted and distinct;
  - `vitally_private.effective_capabilities(p_workspace_id uuid, p_person_id uuid) returns text[]`, stable. It reads the workspace's `current_season` entry; with no entry it returns `{}`;
  - `vitally_private.cleared(p_workspace_id uuid, p_person_id uuid) returns boolean`, stable, for the current season;
  - columns `roster_entries.is_new boolean not null default false` and `roster_entries.photo_id_checked_at timestamptz`;
  - constraint triggers `roster_entries_role_certificates` (after insert or update on `roster_entries`) and `certificates_role_certificates` (after insert, update or delete on `certificates`). Both are `deferrable initially deferred for each row` and run `vitally_private.role_certificates_check()`, which raises `VT007` with message `ROLE_NEEDS` and detail `<role>: <missing labels joined ", ">`.
- **Section markers:** `-- 045 §1 begin` and `-- 045 §1 end` around the guard and the strip, so a test can run that section again.

- [ ] **Step 1: Write the failing tests** in `tests/database-clearance.mjs`. Use `createDatabaseFixture()` and the `rejected` helper.
  - `test("role helpers")`:
    - `missing_certificates('preparer', '{vsc}')` = `{IT&QR,Basic or Advanced}`;
    - `missing_certificates('reviewer', '{vsc,itqr,advanced}')` = `{}`;
    - `role_capabilities('{reviewer,intaker}')` = `{assist,prepare,receive_documents,review}`.
  - `test("the role trigger")`, each subtest in `begin … rollback` via `f.sql`, on a fresh `f.staff({ key, name, capabilities: ["prepare"] })`:
    - set `roles='{preparer}'` with only `vsc` confirmed, then `set constraints all immediate` → rejects with code `VT007`;
    - roles first, then insert `vsc`, `itqr` and `basic` confirmed, then commit → succeeds;
    - delete `itqr` from an Intaker → rejects at commit;
    - a `status='uploaded'` VSC with Greeter → rejects;
    - VSC confirmed for `current_season - 1` only, Greeter now → rejects.
  - `test("045 §1 strips unsupported roles from people with no sign-in")`: inside a transaction:
    - `alter table public.roster_entries disable trigger roster_entries_role_certificates` and the same for `certificates`;
    - give a no-sign-in volunteer `roles='{preparer}'` with only `vsc`, and another `{intaker,greeter}` with none;
    - run the §1 section text (read from the file as `tests/database-filing.mjs:680` does);
    - assert roles `{}` and `{}`, certificates unchanged;
    - a Reviewer with `vsc`, `itqr`, `advanced` keeps `{reviewer}`;
    - rollback.
  - `test("045 §1 refuses when a signed-in person would lose a role")`: same setup on a signed-in staff person; assert the section rejects with code `VT008` and a message starting `045 refused`; rollback.
  - `test("existing entries are not new")`: every row has `is_new=false` and `photo_id_checked_at is null`, except rows this test file wrote.

- [ ] **Step 2: Run them and confirm they fail.**
  Run: `npm run test:database -- --test-name-pattern="role helpers|role trigger|045"`, or `node --env-file=.env.test --test tests/database-clearance.mjs`.
  Expected: FAIL, functions not found.

- [ ] **Step 3: Write part 1 of the migration.**
  - **§1:** in a temp table, list the current-season entries whose roles fail `missing_certificates`. Use an inline needs check, since the helpers are created after §1. A signed-in person is `people.user_id is not null`. If any is signed in, raise `errcode 'VT008'` with message `045 refused: people with a sign-in hold roles their certificates don't support (<n>)`. Otherwise update `roles` to the subset that is met.
  - **Then:** the columns, the helpers, and the trigger function with both triggers.
  - `cleared(p_workspace_id, p_person_id)` and `effective_capabilities(...)` must not call each other recursively.

- [ ] **Step 4: Apply and run.**
  Run: `npm run db:migrate:test`, then the test file.
  Expected: "Approved … applied." and PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add supabase/migrations/045_volunteer_clearance.sql tests/database-clearance.mjs
  git commit -m "Clearance: roles need confirmed certificates (045 part 1)"
  ```

> Task 1 adds no gate, so every suite stays green. Its tests call `f.staff` as it is today; `cleared: false` arrives in Task 2, before the gates in Tasks 3 and 4.

### Task 2: The fixture clears staff by default

This task comes before the gates, so suites stay meaningful while the gates land.

**Files:**
- Modify: `tests/support/database-fixture.mjs` (`f.staff` at :653, the initializer's role accounts at :692–704, `f.enrich` at :437)
- Test: `tests/database-clearance.mjs`

**Interfaces:**
- **Produces:**
  - exported `rolesFor(capabilities: string[]) → string[]`:
    - `admin` or `followup` → `admin`;
    - `review` → `reviewer`;
    - `prepare` without `review` → `preparer`;
    - `assist` or `receive_documents` without `admin` → `intaker`;
    - empty → `greeter`.
    - Returns the distinct union, sorted.
  - exported `CERTIFICATES_FOR = { greeter:["vsc"], intaker:["vsc","itqr"], admin:["vsc","itqr"], preparer:["vsc","itqr","basic"], reviewer:["vsc","itqr","advanced"] }`;
  - `f.clearStaff(personId, capabilities, workspaceId = f.workspaceId)`: one transaction that upserts confirmed certificates for the current season (`confirmed_at=now()`, `confirmed_by_person_id=personId`), sets the entry's roles to `rolesFor(capabilities)`, `is_new=false`, then commits;
  - `f.staff({ …, cleared = true })` calls it unless `cleared === false`;
  - the initializer clears every `ROLE_ACCOUNTS` person after `initializeOwned`, inside `initializeVerified`;
  - `f.enrich` re-clears each person in `addCapabilities` with their new capabilities.

- [ ] **Step 0: Write the failing test.** `test("fixture staff are cleared with matching effective capabilities")`:
  - for each role account, `effective_capabilities` (as a sorted array) equals its `people.capabilities` (sorted), and `cleared` is true;
  - `f.staff({ …, capabilities:["prepare"], cleared:false })` gives `cleared` false.
- [ ] **Step 1: Run it.** Expected: FAIL.
- [ ] **Step 2: Implement** the helpers above. The trigger is deferred, so the transaction may write roles before certificates.
- [ ] **Step 3: Run** `npm run test:database`. Expected: the whole suite is green (no gate exists yet), and the clearance tests pass.
- [ ] **Step 4: Commit** `git commit -m "Test fixture: staff accounts get roles and certificates"`.

### Task 3: The read gate

**Files:**
- Modify: `supabase/migrations/045_volunteer_clearance.sql`
- Modify: `tests/database-catalog.mjs` (the `vitally_policy` catalog), `tests/database-volunteer-roster.mjs` (its catalog scenario)
- Test: `tests/database-clearance.mjs`, `tests/database-realtime.mjs`

**Interfaces:**
- **Produces:** `vitally_policy.cleared_workspace_id() returns uuid`.
  - Language sql, `stable security definer`, `search_path=''`.
  - It returns `m.workspace_id` of the caller's active `staff` membership when `vitally_private.cleared(m.workspace_id, p.id)` holds for the person linked to `auth.uid()`; otherwise null.
  - Grants: `revoke all … from public, anon, service_role`, `grant execute … to authenticated`.

- [ ] **Step 1: Write the failing tests.**
  - `test("an uncleared staff member reads no case data")`: a `cleared:false` staff client reads each of the 21 tables (list them in a `CASE_TABLES` const) → each 0 rows. `people` returns their own row and the default follow-up person's row.
  - `test("a cleared staff member reads as before")`: for each table, the row count as the fixture preparer equals a service-role count, minus private drafts. Reuse the existing staff-visibility helper from the `staff-case-work` tests if there is one.
  - `test("clients are unchanged")`: `applicantA` reads their own case, documents and requests: the same ids before and after a staff member is uncleared.
  - `test("every case-data policy is gated")`: from `pg_policies` where `qual like '%access = ''staff''%'` and `tablename<>'people'`, every `qual` contains `cleared_workspace_id`, and the count is 21.
  - `test("the helper runs once per statement")`: in a transaction, `set local role authenticated`, set the claims for the preparer, then `explain (format json) select * from public.cases`. The plan JSON has a node with `"Subplan Name"` starting `InitPlan`, and no Filter text contains `cleared_workspace_id(` outside that InitPlan.
  - In `tests/database-realtime.mjs`: `test("an uncleared subscriber gets no case change")`, following that file's existing subscribe pattern.
  - Update the `vitally_policy` catalog expectation to exactly `cleared_workspace_id()` and `is_workspace_admin(uuid)`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Add the function.
  - Re-state each of the 21 policies with `alter policy <name> on public.<table> using(...)`. Copy the definitions from 043 lines 116–137 (with the renamed names that 043 §7 and 044 produced), adding `and <table>.workspace_id=(select vitally_policy.cleared_workspace_id())` to the `m.access='staff'` branch only. Read the current names from `pg_policies`.
  - Leave `people.staff_people` alone.
- [ ] **Step 4: Run** `npm run db:migrate:test` and `npm run test:database`. Expected: all green.
- [ ] **Step 5: Commit** `git commit -m "Clearance: case-data policies require a cleared staff member"`.

### Task 4: The action gate and effective capabilities

**Files:**
- Modify: `supabase/migrations/045_volunteer_clearance.sql`
- Test: `tests/database-clearance.mjs`, `tests/database-staff-identity.mjs` (the catalog of public RPCs), `tests/support/rpc-signatures.mjs`

**Interfaces:**
- **Consumes:** `effective_capabilities` and `cleared` from Task 1.
- **Produces:**
  - `vitally_private.require_cleared(p_member public.memberships) returns void`: raises `sqlstate 'VT009' using message='NOT_CLEARED'` when `p_member.access='staff'` and the linked person isn't cleared; no-op for `applicant`;
  - `acting_person` returns, for staff, the `people` row with `capabilities := effective_capabilities(...)`;
  - `check_operation_authority` builds its person the same way instead of re-reading `people.capabilities`;
  - `vitally_create_case` uses `v_person.capabilities` from `acting_person` instead of its direct select (043:418).
  - Each public function is re-created with `create or replace`, keeping its body except these lines. `require_cleared(v_member)` goes immediately after the `acting_person` call, before any lookup, digest or receipt.

- [ ] **Step 1: Write the failing tests.**
  - `test("each case RPC refuses an uncleared staff member")`: for a `cleared:false` staff client with `capabilities:["prepare","review","admin","followup","assist","receive_documents"]`, each of the six RPCs, called with `applyArgs`/`assistanceArgs`/`contactArgs`/`editContactArgs` and valid-looking ids, rejects with `VT009`, and `f.receiptsFor(actionId)` is 0.
  - `test("unknown id gets NOT_CLEARED")`: `vitally_apply_action` with a random case id → `VT009`.
  - `test("a replay after losing clearance")`: the preparer claims; then `update roster_entries set roles='{}'` for them; the same `applyArgs` → `VT009`. Re-clear in `finally`.
  - `test("clients are not checked")`: `applicantA` creates and submits a case. It succeeds.
  - `test("effective capabilities")`:
    - ceiling `[prepare, review]` with role preparer → claiming a review is rejected `VT006`;
    - ceiling `[review]` with role reviewer → claiming preparation is rejected `VT006`;
    - ceiling `[admin]` with role intaker → an assisted `vitally_create_case` is rejected `VT001`;
    - Review Focus 1: a preparer claims, an admin then sets their roles to `{greeter}` (they hold the case, so set it directly in SQL), and a second preparation action is refused.
  - `test("self-review still holds for a Reviewer")`: a reviewer-role person with ceiling `[prepare, review]` prepares, then claims review → `VT005`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** as in Interfaces. Don't touch the assignee and default-follow-up capability checks (033/036 and `set_default_followup`).
- [ ] **Step 4: Run** `npm run db:migrate:test` and `npm run test:database`. Expected: green.
- [ ] **Step 5: Commit** `git commit -m "Clearance: case RPCs use effective capabilities and refuse uncleared staff (VT009)"`.

### Task 5: `vitally_my_clearance()`

**Files:**
- Modify: `supabase/migrations/045_volunteer_clearance.sql`, `tests/support/rpc-signatures.mjs`
- Test: `tests/database-clearance.mjs`, `tests/database-staff-identity.mjs`

**Interfaces:**
- **Produces:** `public.vitally_my_clearance() returns jsonb`, `stable security definer`, execute for `authenticated` only. The shape:
  ```json
  { "cleared": false,
    "missing": [ {"kind":"form13615"} | {"kind":"photoId"} | {"kind":"role","role":"preparer","certificates":["IT&QR"]} ],
    "capabilities": ["prepare"],
    "isAdmin": true,
    "siteCoordinatorName": "Avery Lin" }
  ```
  - `form13615` appears when the entry has no roles. `photoId` appears when `is_new` and unchecked.
  - `siteCoordinatorName` is the default follow-up person's `people.name`, or null.
  - An applicant or no membership → `VT001`.
- [ ] **Step 1: Write the tests.**
  - An uncleared staff member → `cleared:false`, missing `[{kind:"form13615"}]`, capabilities `[]`, the name equal to the site coordinator's.
  - The fixture preparer → `cleared:true`, `missing:[]`, `capabilities:["prepare"]`, `isAdmin:false`.
  - `applicantA` → `VT001`.
  - `Object.keys(result)` is exactly those five keys.
  - Add the RPC to `rpc-signatures.mjs`, so the catalog test expects eight public RPCs.
- [ ] **Step 2: Run them, implement, run again, commit.**
  Run: `npm run db:migrate:test`, then `npm run test:database`.
  Commit: `git commit -m "Clearance: vitally_my_clearance"`.

### Task 5b: Assigning work only to a cleared person

**Files:**
- Modify: `supabase/migrations/045_volunteer_clearance.sql`
- Test: `tests/database-clearance.mjs`

**Interfaces:**
- **Produces:** `vitally_private.require_cleared_assignee(p_workspace_id uuid, p_person_id uuid) returns void`, `stable`, `search_path=''`. It raises `sqlstate 'VT006' using message='INELIGIBLE'` unless `vitally_private.cleared(p_workspace_id, p_person_id)`. No grant to any client role. It has no caller in this change; #139's Reassign will call it.

- [ ] **Step 1: Write the failing tests.**
  - `test("require_cleared_assignee")`: an uncleared person rejects with `VT006`; a cleared one returns.
  - `test("today's assigning functions")`:
    - query `pg_proc` in `vitally_private` and `public` (`prokind='f'`) whose `prosrc` matches `/(set|,)\s*(assignee_person_id|preparer_id|reviewer_id|default_followup_person_id)\s*=|insert into public\.(admin_followups|assistance_items|reviews|preparation_participants)/i`;
    - assert the sorted names equal `["act_approve_review","act_assistance_claim","act_claim_preparation","act_claim_review","act_close_case","act_escalate_contact","act_request_corrections","act_withdraw","hand_to_review","set_default_followup"]`;
    - the assertion message says a new assigning function must call `require_cleared_assignee` or be classified as system-assigned.
  - `test("an uncleared default follow-up person still receives work")`:
    - make the site coordinator uncleared by setting roles `{}` in SQL; re-clear them in `finally`;
    - a cleared staff member escalates a document request → an open follow-up assigned to the site coordinator;
    - `applicantA` withdraws their application → it succeeds, and the notice is assigned to the site coordinator.
- [ ] **Step 2: Run them.** Expected: the first test fails (function missing); the catalog and default-follow-up tests already pass.
- [ ] **Step 3: Implement** the function.
- [ ] **Step 4: Run** `npm run db:migrate:test`, then `npm run test:database`. Expected: green.
- [ ] **Step 5: Commit** `git commit -m "Clearance: assignees must be cleared; pin today's assigning functions"`.

### Task 6: Roster save rules and the open-work rule

**Files:**
- Modify: `supabase/migrations/045_volunteer_clearance.sql` (`create or replace function public.vitally_save_volunteer` from 044:99)
- Modify: `tests/database-volunteer-roster.mjs`

**Interfaces:**
- **Consumes:** `missing_certificates`, `effective_capabilities` and `cleared` (Task 1).
- **Produces:**
  - The payload gains the required booleans `isNew` and `photoIdChecked`; anything else is `VT007`.
  - `roles` may be empty.
  - Roles held before this save that lose a needed certificate in this save are dropped from the saved roles. Any other requested role that `missing_certificates` reports is refused: `VT007`, message `ROLE_NEEDS`, detail `<role>: <labels>`.
  - `photo_id_checked_at` keeps its old value while `photoIdChecked` stays true, is set to `now()` when it is first ticked, and becomes null when unticked.
  - `vitally_private.open_work(p_workspace_id uuid, p_person_id uuid) returns table(needs text, label text)`. Rows:
    - `('prepare', 'preparing client <client_number>')` for cases with `preparer_id = person` and `stage<>'closed'`;
    - `('review', 'reviewing client <n>')` for `reviewer_id`;
    - `('followup', 'follow-up for client <n>')` for `admin_followups` with `status='open'` assigned to them;
    - `('followup', 'default follow-up person')`;
    - `('assist', 'a help request')` for each `assistance_items` row with `status='assigned'` assigned to them.
  - The rule: compute the new effective capabilities and clearance from the would-be roles and certificates. Refuse with `sqlstate 'VT004'`, message `OPEN_WORK`, detail = a JSON array of the labels, when any `open_work` row's `needs` is not in the new effective set, or when the person would be uncleared while `open_work` is non-empty. Check this after validation and before any write.
- [ ] **Step 1: Write the failing tests.** Update the file's `volunteer()` helper to send `isNew:false, photoIdChecked:false`, and its `roles:["greeter"]` with `certificates:["vsc"]`.
  - `test("a save may have no roles")`.
  - `test("a role without its certificates is refused")`: Preparer with `["vsc"]` rejects `VT007`, and `error.details` contains `IT&QR`.
  - `test("unticking a certificate drops the roles that need it")`: Preparer with vsc, itqr, basic; save with basic unticked and Preparer still sent → the saved roles exclude preparer.
  - `test("photo ID check is kept while ticked")`.
  - `test("an uncleared admin saves their own Admin role")`: the admin becomes cleared, and `vitally_my_clearance().cleared` is true.
  - Open-work tests, each building the work with `f.readyCase`/`f.act` (all spec scenarios):
    - removing Preparer while preparing → `VT004` with details listing `preparing client`;
    - unticking IT&QR for the default follow-up person → `VT004` with `default follow-up person`;
    - removing Greeter while preparing → ok;
    - unticking Advanced while Basic covers → ok;
    - no open work and all roles removed → ok and uncleared.
  - Replace the `Roles and certificates grant nothing` tests: delete them and check their coverage now lives in Task 4's effective-capability tests. Name both in the commit message.
- [ ] **Step 2: Run them, implement, run** `npm run db:migrate:test` and `npm run test:database` (expect green), then commit:
  `git commit -m "Roster save: roles need certificates, photo ID, open-work rule"`.

### Task 6b: The save leaves uploaded certificates alone

**Files:**
- Modify: `supabase/migrations/045_volunteer_clearance.sql` (the last `vitally_save_volunteer`, Part 6)
- Test: `tests/database-volunteer-roster.mjs`

**Interfaces:**
- **Produces:** the save's certificate write.
  - It deletes only current-season `status='confirmed'` rows not in the payload.
  - For each sent certificate, it inserts a confirmed row, or updates an existing `uploaded` row to `confirmed` with `confirmed_by_person_id` the caller and `confirmed_at` now. An existing `confirmed` row keeps its `confirmed_at` and `confirmed_by_person_id`.
  - The ROLE_NEEDS pre-check counts a sent certificate as confirmed.

- [ ] **Step 1: Write the failing tests.**
  - `test("an uploaded certificate survives a save that doesn't send it")`: insert an `uploaded` VSC row for a volunteer, save the volunteer without VSC, and find the row still there, still `uploaded`, unchanged.
  - `test("ticking an uploaded certificate confirms it")`: with an `uploaded` VSC row, save with VSC and Greeter. The row is `confirmed` by the admin, and the volunteer has Greeter.
  - Keep "A certificate stays ticked" and "A certificate is unticked" passing.
- [ ] **Step 2: Run, implement, run again.** Expected: FAIL, then green. While 045 is still changing, verify the database through CI.
- [ ] **Step 3: Commit** `git commit -m "Roster save: leave uploaded certificates alone, and confirm one when ticked"`.

### Task 7: The app error code and clearance in the store

**Files:**
- Modify: `src/contracts.mjs` (add `"NOT_CLEARED"` to `ERROR_CODES`, `VT009: "NOT_CLEARED"`), `src/errors.mjs` (`NOT_CLEARED: "Finish your setup for this season first."`)
- Modify: `src/supabase-store.mjs` (the principal loader at ~:409)
- Create: `src/clearance.mjs`
- Test: `tests/errors.test.mjs`, `tests/clearance.test.mjs` (new), `tests/controller.test.mjs`

**Interfaces:**
- **Produces:**
  - For staff, the principal gains `clearance: { cleared, missing, capabilities, isAdmin, siteCoordinatorName }`, from `store.getClearance()`, which calls `vitally_my_clearance`. Applicants have no `clearance`.
  - `src/clearance.mjs` exports:
    - `withOwnCapabilities(people, principal) → people`: a copy in which the signed-in person's `capabilities` are `principal.clearance.capabilities`;
    - `ceilingAdmin(principal) → boolean`: `principal.clearance.isAdmin`;
    - `missingLines(clearance) → string[]`: the exact copy from Global Constraints, in the order form13615, photoId, role lines. A role line reads "<Role> needs <certificates joined ' and '>.".
  - The controller stores people through `withOwnCapabilities` wherever it sets `state.people`.
- [ ] **Step 1: Write the failing tests.**
  - `errors.test.mjs`: `createAppError({code:"VT009"}).code === "NOT_CLEARED"`, with its safe message.
  - `clearance.test.mjs`: the three functions, including that other people are untouched.
  - `controller.test.mjs`: with a fake store whose principal clearance has `capabilities:["prepare"]` while `people` shows `["prepare","review"]`, `state.people`'s own entry has `["prepare"]`.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL. Implement. Run again: PASS.
- [ ] **Step 3: Commit** `git commit -m "App: NOT_CLEARED and the signed-in person's effective capabilities"`.

### Task 8: The setup screen

**Files:**
- Modify: `src/views.mjs` (`staffScreen`, the sidebar's Volunteers link and `isAdmin` at :188), `src/app.mjs` (`screenFor` at :219, a `focus` listener), `src/controller.mjs` (`checkClearance()`, and the `NOT_CLEARED` handling in `noteFailure`)
- Create: `src/setup-views.mjs`
- Modify: `src/styles.css` (only what the screen needs, using existing tokens)
- Test: `tests/setup-views.test.mjs` (new), `tests/controller.test.mjs`

**Interfaces:**
- **Consumes:** `missingLines` and `ceilingAdmin` (Task 7).
- **Produces:**
  - `setupScreen(state) → html`: heading "Finish your setup for this season", `missingLines` as a list, "Ask <name>, your site coordinator." (left out when the name is null), and a button "Check again" with `data-action="check-clearance"`;
  - `staffScreen` renders it when `!state.principal.clearance.cleared`. When `ceilingAdmin` is true, the sidebar shows only Volunteers, and the Roster opens normally;
  - `controller.checkClearance()` re-reads `getClearance()`. At most one request is in flight; a second call while one is pending returns the same promise. When the result turns cleared, it runs the normal staff load;
  - `app.mjs` calls `checkClearance()` on Check again and on `window` `focus` while the setup screen shows;
  - any action failing with `NOT_CLEARED` sets `clearance.cleared=false`, re-reads the clearance, and shows the setup screen, with no inline error;
  - the sidebar's Volunteers link uses `ceilingAdmin(principal)`.
- [ ] **Step 1: Write the failing tests.**
  - `setup-views.test.mjs`: the exact copy for `form13615`, for `photoId`, and with no site coordinator name.
  - `controller.test.mjs`:
    - an uncleared principal → the setup screen state;
    - `checkClearance` twice concurrently → one store call (Review Focus 5);
    - a cleared result → the normal load runs;
    - an action rejecting `NOT_CLEARED` → the setup screen;
    - ceiling admin with role Intaker → the Volunteers link is shown and the office-admin views are not (Review Focus 4).
- [ ] **Step 2: Run** `npm test`. Expected: FAIL. Implement. Run again: PASS.
- [ ] **Step 3: Commit** `git commit -m "App: Finish your setup screen"`.

### Task 9: Roster screen changes

**Files:**
- Modify: `src/volunteer-roster.mjs` (`combineVolunteers`, `volunteerFromForm`, `volunteerProblem`), `src/volunteer-views.mjs`, `src/controller.mjs` (`saveVolunteer` at :2712)
- Test: `tests/volunteer-roster.test.mjs`, `tests/volunteer-views.test.mjs`, `tests/controller.test.mjs` (find the existing names with `ls tests | grep -i volunteer`)

**Interfaces:**
- **Produces:**
  - `ROLE_NEEDS`, mirroring the SQL table, and `missingFor(role, certificates) → string[]`;
  - each combined volunteer gains `isNew`, `photoIdChecked`, `cleared` (by the Global Constraints rule) and `missing` (`["form13615"]`, `["photoId"]` or `[]`);
  - `volunteerFromForm` reads the `isNew` and `photoIdChecked` checkboxes;
  - `volunteerProblem`:
    - drops "Choose at least one role.";
    - returns "<Role> needs <labels>." for the first newly added role whose certificates are missing;
    - removes, from the payload's roles, previously held roles that lost a certificate, matching the server;
  - the drawer:
    - "New volunteer", checked by default on Add, and "Photo ID checked";
    - unticking a certificate unticks the roles that need it, in the form;
  - Roster rows show "Cleared" or the missing item. The page sentence is "Volunteers work on cases only once they are cleared.";
  - a save refused with `INVALID_TRANSITION` and `cause.message === "OPEN_WORK"` sets the form error to "<name> still has open work: <labels joined ', '>. Finish it or hand it over first.", with the labels parsed from `cause.details`.
- [ ] **Step 1: Write the failing tests.** Cover each item above, using the spec's scenarios ("A role without its certificates", "New is the default", "Waiting for Form 13615", "Recording the photo ID check", the open-work alert). Add a parity test: `ROLE_NEEDS` against a fixture copy of the SQL needs table from Global Constraints.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL. Implement. Run again: PASS.
- [ ] **Step 3: Commit** `git commit -m "Roster: clearance column, photo ID fields, certificate and open-work messages"`.

### Task 10: Seed and docs

**Files:**
- Modify: `tools/admin/seed-values.mjs` (`SEED_VOLUNTEERS`), `tools/admin/seed-cases.mjs` (`seedVolunteers` at :395, `seedWorkspace`)
- Modify: `tests/database-seed.mjs`, `tests/database-volunteer-roster.mjs` (the seed tests)
- Modify: `docs/demo-script.md` (the Roster section and table), `docs/setup.md` (the "Before a review or demo" Roster step)

**Interfaces:**
- **Produces:**
  - `ROLE_ACCOUNT_CLEARANCE` in `seed-values.mjs`:
    - `site_coordinator`: admin with vsc, itqr;
    - `preparer`: preparer with vsc, itqr, basic;
    - `reviewer`: reviewer with vsc, itqr, advanced;
    - `intaker`: intaker with vsc, itqr;
    - all `isNew:false`.
  - `clearRoleAccounts(client, { workspaceId, actorUserId })`:
    - for each key present, reads the profile, entry and certificates by SQL;
    - skips an account that already matches;
    - otherwise saves through `vitally_save_volunteer` as an edit with the profile's revision, keeping the profile fields.
    - `seedWorkspace` calls it before `seedVolunteers`.
  - `SEED_VOLUNTEERS`:
    - Hana Moretti gets `["vsc","itqr","basic"]`;
    - Lucy Fong gets `roles:[]`, `certificates:[]`;
    - every entry gets `isNew` and `photoIdChecked`, with at least one `isNew:true, photoIdChecked:true` and one `isNew:true, photoIdChecked:false`. Keep the coverage of every role, certificate, language and way of working.
- [ ] **Step 1: Write the failing tests.**
  - In `database-seed.mjs`: after `seedWorkspace`, each of the four role accounts has `cleared` true and effective capabilities equal to its ceiling.
  - A second run changes no role account's `revision`.
  - Exactly one seeded volunteer has no roles.
  - The coverage assertions still hold.
- [ ] **Step 2: Run** `npm run test:database`. Expected: FAIL. Implement. Run again: PASS.
- [ ] **Step 3: Check on a populated stack.**
  - On a stack with `main`'s migrations and an earlier `seed:local` run (Hana and Lucy have unsupported roles), run `npm run db:migrate:test` and then `npm run seed:local`.
  - Expected: the migration applies, and the seed reports success.
  - Sign in as the Preparer: the work board loads. As Sky Chen, the Roster shows the four role accounts as cleared and Lucy Fong as "No roles recorded" and not cleared.
- [ ] **Step 4: Update the docs.**
  - The demo-script Roster table:
    - Hana gets VSC, IT&QR and Basic;
    - Lucy gets no roles, "None recorded", and is waiting for her Form 13615;
    - add the Cleared column and the role accounts;
    - replace "They don't change what anyone can do in ViTally yet." with how clearance works.
  - In the setup.md checklist step, the staff rows now show their roles and Cleared after `seed:local`.
- [ ] **Step 5: Commit** `git commit -m "Seed and docs: role accounts cleared, volunteers backed by certificates"`.

### Task 11: Browser checks

**Files:**
- Modify: `tests/auth-browser.mjs`, `tests/browser.mjs`

**Interfaces:**
- **Consumes:**
  - `f.staff({ cleared:false })` and `f.clearStaff` (Task 2);
  - the setup screen copy (Task 8);
  - the drawer labels (Task 9).

- [ ] **Step 1: Update `auth-browser.mjs`.**
  - An uncleared staff account signs in and sees "Finish your setup for this season", with no work board.
  - A cleared one sees the work board.
- [ ] **Step 2: Add a short phase to `browser.mjs`.** Put it beside the existing Roster test (around :8760).
  - An uncleared admin signs in: the setup screen and Volunteers are shown.
  - They open their own row, tick VSC and IT&QR, add Admin, and save.
  - Check again opens the work board.
  - Then the drawer shows "New volunteer" checked on Add.
  - Reuse the press and wait helpers from #185 and #188.
- [ ] **Step 3: Run both suites.**
  Run: `npm run test:auth-browser`, then `npm run test:browser`.
  Expected: both pass. Record the per-phase timings; the whole story must stay under the 900 s limit. If it doesn't, stop and show the timings (project rule).
- [ ] **Step 4: Commit** `git commit -m "Browser: setup screen and clearance on the Roster"`.

### Task 12: Full verification

- [ ] **Step 1: Run every check.**
  - `npm test`;
  - `npm run db:migrate:test`, then `npm run test:database`;
  - `npm run test:auth-browser`;
  - `npm run test:browser`;
  - `npx openspec validate --all`.
  Expected: all pass. Record the test counts against `main`'s, and name every removed test along with the code it covered.
- [ ] **Step 2: Tick `tasks.md`.** Tick each item as its task lands. No commit beyond the ticks.
