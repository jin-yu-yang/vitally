# Remove the sample-case tools: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migration 040 removes the database's sample-case machinery, and its demo rows, with no CASCADE and without deleting a single row of a real case. The app, tools, tests and docs stop using it. The checks that still matter are re-tested through the seed.

**Architecture:**
- **One hand-written migration**, in five ordered steps (design D1), with every dependency handled by name.
- **The four live functions** that read the dropped columns are rewritten from their latest definitions.
- **New catalog tests** prove that nothing in the database mentions `fixture` and that RLS is unchanged.
- **The browser** loses the store wrappers and the reset notice.
- **Test changes** follow brainstorm Q8: a test is removed only if its code is removed.

**Tech Stack:** PostgreSQL / Supabase SQL migrations, ES-module browser app, `node:test` unit and database suites, the Playwright browser story, Node tooling in `tools/admin/`.

**Spec:**
- `openspec/changes/remove-sample-case-tools/specs/`: sign-in, client-intake, review-and-corrections, shaded-section, case-lifecycle, local-seed-data;
- design: `openspec/changes/remove-sample-case-tools/design.md`, D1–D9 (the dependency table is in D1);
- decision log: `openspec/changes/remove-sample-case-tools/brainstorm.md`. Q8 is the test table, Q8a the catalog test, and the "Builder check" section answers six planning questions.

## Global Constraints

- **The migration file** is `supabase/migrations/040_remove_sample_case_tools.sql`. Never edit an applied migration (001–039).
- **No `CASCADE`** on any `DROP` in 040. Drop every dependent object by name first (design D1 table). `tools/admin/migrate.mjs` runs the migration in one transaction, so a missed dependency fails the whole migration.
- **Order in 040:**
  1. delete the demo rows;
  2. rewrite the 4 functions;
  3. drop the index and 4 constraints;
  4. drop the 14 functions, the table and the 5 columns;
  5. recreate `cases_origin_check` (`origin in ('client','assisted')`) and `cases_origin_owner` (today's client and assisted branches, without the fixture branch).
- **The 14 dropped functions,** each by full signature:
  - `public.vitally_reset_fixtures(uuid)` and `public.vitally_load_checkpoint(uuid,uuid,bigint,text)`;
  - in `vitally_private`: `seed_fixtures(uuid,bigint)`, `apply_fixture_scenario(public.cases,text,uuid)`, `checkpoint_scenario(text)`, `fixture_keys()`, `fixture_answers_v2(text)`, `fixture_contact_v2(text)`, `fixture_history(text)`, `new_reference()`, `backfill_client_numbers(uuid)`, `version_one_blockers()`, `version_one_blocks(smallint,boolean,boolean)` and `version_one_disposable(smallint,boolean,boolean)`.
- **The 5 dropped columns:** `cases.fixture`, `cases.fixture_key`, `assistance_items.fixture`, `workspaces.fixture_generation`, `action_receipts.generation`.
- **The dropped table** is `vitally_private.fixture_client_bindings`.
- **The 4 rewritten functions,** copied from their latest definitions:
  - `vitally_private.filing_notes_append_only()` (035, about line 152): allow a `DELETE` only when `not exists (select 1 from public.cases where id = old.case_id)`. Every other update or delete raises `VT007`/VALIDATION. No `clearing_case`, no fixture.
  - `vitally_private.reserve_receipt(...)` (003, line 22): no `generation`.
  - `public.vitally_create_case(...)` (038, about line 457): no `generation`, and no `fixture` in the insert.
  - `vitally_private.initialize_workspace(uuid,uuid[],uuid[],jsonb)` (038, about line 993): dropped and replaced by `initialize_workspace(uuid,uuid[],uuid[])`, the same body without the bindings loop and the `p_bindings` validation.
- **The roster note**, printed when an old roster has `sampleCaseOwners`, verbatim: `sampleCaseOwners is no longer used and was ignored.`
- **The RLS policies after 040** are exactly the 24 at 039, by table and name (brainstorm Q8a).
- **Test rule:** a test is removed only if the code it tested is removed in this change, and its report entry names that code with a grep that shows it gone. Every other check is converted or replaced, as brainstorm Q8 lists.
- **Text:** after any 简体 change, run `npm run build:hant`, then `npm run build:hant -- --check`, and commit `src/zh-hant.mjs`. Staff screens stay English.
- **The local stack:**
  - Never run `supabase start` from the repo root.
  - The database, browser and auth-browser suites run one at a time, with no other test process on the stack.
  - **Applying 040 to the local stack can't be undone.** From then on, other branches' database and browser suites fail on this stack until #135 merges. The controller tells the user before `db:migrate:test` runs.
- **Data and output:** fictional data only, no email address in output, LF only.
- **Commits:** each ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A workspace teardown** that deletes a workspace holding real cases with filing notes must still succeed. The test fixture's own cleanup does this. Test in Task 1: deleting a test workspace whose case has a filing note succeeds.
2. **A local roster written before this change**, with `sampleCaseOwners`, must apply cleanly and print the note. Test in Task 3.
3. **A window open on a case that a seed re-run deletes** must forget it quietly: no notice, no error banner, the lists refreshed. Test in Task 4, in the controller.
4. **Actions after 040** must still reserve receipts, now without `generation`, and replay. Task 2 runs the kept replay tests: contacts, assistance, intake, season-close.
5. **An applicant's realtime stream across a seed re-run** carries no deletion. Test in Task 2, the replacement realtime test.

---

### Task 1: Migration 040, its catalog tests, and the setup tool

**Files:**
- Create: `supabase/migrations/040_remove_sample_case_tools.sql`
- Create: `tests/database-catalog.mjs`
- Modify: `tests/database-filing.mjs` (or the suite that already holds the filing-note tests; add to it)
- Modify: `tools/admin/workspace-setup.mjs` (the `initializeWorkspace` call)
- Modify: `tests/support/database-fixture.mjs` (the setup that passes `fixtureClientBindings`)
- Scratch, not committed: the row-count script, in the session scratchpad

**Interfaces:**
- Produces:
  - `initializeWorkspace({ workspaceId, presenterUserIds, applicantUserIds, staff, defaultFollowup, target })`, with no `fixtureClientBindings`. It calls `vitally_private.initialize_workspace($1,$2::uuid[],$3::uuid[])`.
  - The migrated schema that Tasks 2–5 build on.

- [ ] **Step 0: Baselines.** Check the stack is idle: no other `node` test process, and the `supabase_*_vitally-hailey.xm6xUYYX` containers are up. Then:
  - run `npm test` and record `ℹ tests` (expected 1498);
  - run `npm run test:database` alone and record `ℹ tests`.

  Both go in the report as the "before" counts.
- [ ] **Step 1: The row-count script, run before.** It's read-only and uses `openDatabase()` from `tools/admin/database.mjs`. It counts:
  - `public.cases where not fixture`;
  - for each table in `preparation_participants, document_requests, documents, admin_followups, contact_attempts, case_events, client_events, reviews, case_contacts, case_materials, case_document_cards, contact_log, preparer_questionnaires, reviewer_questionnaires, filing_attempts, filing_returns, filing_notes, preparer_shaded_fields`: the rows whose `case_id` is a non-sample case;
  - `contact_log_versions`, joined through `contact_log`;
  - `assistance_items where not fixture`.

  Save the output to the scratchpad.
- [ ] **Step 2: Write the failing tests.**
  - `tests/database-catalog.mjs`, "no function, constraint or view mentions the sample machinery":
    - `select n.nspname, p.proname from pg_proc p join pg_namespace n ... where n.nspname in ('public','vitally_private') and (p.prosrc ~* 'fixture' or p.proname ~* 'fixture')` returns no rows;
    - `select conname from pg_constraint where pg_get_constraintdef(oid) ~* 'fixture'` returns no rows;
    - `select viewname from pg_views where definition ~* 'fixture'` returns no rows.
  - `tests/database-catalog.mjs`, "every table keeps exactly its RLS policies": `select polrelid::regclass::text, polname from pg_policy order by 1,2` deep-equals the 24 pairs listed in brainstorm Q8a.
  - `tests/database-catalog.mjs`, "a case's origin is client or assisted": an insert of a case with `origin='fixture'` is refused by the check constraint.
  - **Filing-note tests.** Read the existing filing suite first and keep any equivalent:
    - "deleting a case with filing notes succeeds": build a case with a fix note through the actions (as the filing suite does), delete the case with privileged SQL, and expect no error and its notes gone;
    - "a filing note can't be deleted on its own": a direct `delete from public.filing_notes where ...` raises VALIDATION;
    - "a filing attempt can't be deleted on its own": deleting the attempt (which would cascade to the notes) raises VALIDATION;
    - (Review Focus 1) "a workspace teardown with filing notes succeeds": deleting a test workspace (via `f.initializeOwned` and the fixture's own cleanup path) whose case has a note succeeds.
- [ ] **Step 3: Run them to see them fail** on 039: `node --env-file=.env.test --test tests/database-catalog.mjs`. Expected: FAIL. The function, constraint and origin checks fail, and the policy test may already pass. Record the output.
- [ ] **Step 4: Write 040** in the Global Constraints order, copying each rewritten function from its latest definition and changing only what's stated.
- [ ] **Step 5: Tell the controller, then apply.** Report NEEDS_CONTEXT with "ready to apply 040 to the local stack" and wait. The controller confirms with the user, because the step can't be undone. Then run `npm run db:migrate:test`. Expected: it applies with no error. If it fails on a dependency, fix 040 by name. Never add CASCADE.
- [ ] **Step 6: The row-count script, run after.** Run the same counts. With the columns gone, every row is non-sample, so count all rows. **Every count must equal its before count.** On any difference, stop and report BLOCKED with both tables. Change nothing else.
- [ ] **Step 7: The setup tool and the fixture.** `workspace-setup.mjs` calls the three-argument function. `database-fixture.mjs` stops passing `fixtureClientBindings`. Its sample helpers stay for now; Task 2 removes them.
- [ ] **Step 8: Run to see them pass:** `node --env-file=.env.test --test tests/database-catalog.mjs` and the filing suite. Expected: PASS. The rest of the database suite may now fail where it uses samples; Task 2 handles that. List those failures in the report.
- [ ] **Step 9: Commit** "Database: migration 040 removes the sample-case tools (#135)". Put the before/after row-count table in the report.

### Task 2: The database tests

**Files:**
- Delete: `tests/database-fixtures.mjs`
- Modify:
  - `tests/database-client-numbers.mjs`, `database-contacts.mjs`, `database-intake-default.mjs`, `database-intake-v1-removed.mjs`, `database-realtime.mjs`, `database-seed.mjs`, `database-shaded.mjs`, `database-staff-identity.mjs`, `database-store.mjs`, `database-actions.mjs`;
  - `tests/support/database-fixture.mjs`, `tests/support/rpc-signatures.mjs`.

**Interfaces:**
- Consumes:
  - Task 1's migrated schema and `initializeWorkspace`;
  - the seed module (`resolveSeedTargets`, `seedCases` from `tools/admin/seed-cases.mjs`) for the replacements.

- [ ] **Step 1: Apply brainstorm Q8 to each row.** Remove, convert or replace exactly as it says. **The replacements:**
  - **`database-client-numbers`, "a seed re-run never reuses a number":** seed twice on a fixture workspace; every client number in the second set is higher than every number in the first.
  - **`database-realtime`, "a seed re-run publishes no deletion an applicant could read":** use the same publication and stream check the removed reset test used, with a seed re-run in place of the reset. (Review Focus 5)
  - **`database-seed`, "receipts outlive the cases a re-run deletes":** after a re-run, the first run's receipts still exist, with `target_id` set to the deleted case ids.
  - **`database-intake-default`, "the seed's case answers pass the field checks":** run the same field-check function the removed sample test used on every seeded case's answers.
  - **`database-intake-v1-removed`, the seed's submitted client case:** its submit history has no screening detail. Drop the `version_one_*` existence asserts, since those helpers are gone.
- [ ] **Step 2: Convert:**
  - `database-contacts`' "RECORD_CONTACT refuses new requests": build the case with `f.readyCase()` or the actions;
  - the direct `action_receipts` insert near `database-contacts.mjs:653`: no `generation`;
  - `database-realtime`'s "the production adapter draws the same line": no reset in its setup;
  - `database-actions`' two entry-point tests: the dropped RPCs leave their lists;
  - `database-intake-default`'s "the new private functions are not executable by clients": the dropped names leave its list;
  - `database-seed`'s "a second run replaces the first…": no `f.seedFixtures()`.
- [ ] **Step 3: Remove** the sample helpers from `tests/support/database-fixture.mjs`: `seedFixtures`, `readFixtureCases`, `readFixtureAssistance`, `readFixtureState`, `readStableSetup`'s binding part, `fixtureKeys`, `boundFixtureKey`, and the `fixtureClientBindings` in `f.setup`. Remove each only after a grep shows nothing calls it. Remove `vitally_reset_fixtures` and `vitally_load_checkpoint` from `tests/support/rpc-signatures.mjs`.
- [ ] **Step 4:** Run `npm run test:database` alone. Expected: all pass, including the kept replay tests (Review Focus 4). Record the "after" count.
- [ ] **Step 5: Report three lists:**
  - every removed test, with the code it tested and the grep;
  - every converted test, with what changed;
  - every replacement.
- [ ] **Step 6: Commit** "Database tests: the sample-case tests go with their code, the rest move to the seed (#135)".

### Task 3: The roster

**Files:**
- Modify: `tools/admin/roster.mjs`, `tools/admin/roster.example.json`
- Test: `tests/roster.test.mjs`

**Interfaces:**
- Consumes: Task 1's `initializeWorkspace` (no bindings).
- Produces: `parseRoster(raw)` returns no `sampleCaseOwners`. The roster command prints the note once when the input has the key.

- [ ] **Step 1: Write the failing test.** In `tests/roster.test.mjs`, "an old roster's sampleCaseOwners is ignored with a note" (Review Focus 2):
  - `parseRoster({ ...valid(), sampleCaseOwners: { preparation_ready: "client-a@example.org" } })` succeeds, and the result has no `sampleCaseOwners` key;
  - the command's printed output contains exactly `sampleCaseOwners is no longer used and was ignored.`. Use the module's existing output seam, or add a minimal `log` parameter.
- [ ] **Step 2: Run it to see it fail.** Run `node --test tests/roster.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `parseRoster` stops validating and returning `sampleCaseOwners`, and notes that it saw the key.
  - The command prints the note once.
  - The build of `initializeWorkspace` arguments drops the bindings.
  - The example roster loses the key.
- [ ] **Step 4: Remove the `sampleCaseOwners` tests whose code is gone**: the validation of keys and owner addresses. Each removal gets its grep. Run `npm test`. Expected: all pass.
- [ ] **Step 5: Commit** "Roster: sampleCaseOwners is ignored with a note (#135)".

### Task 4: The browser

**Files:**
- Modify: `src/supabase-store.mjs`, `src/contracts.mjs`, `src/controller.mjs`, `src/views.mjs`, `src/styles.css`, `src/client-text.mjs`, `src/zh-hant.mjs` (regenerated)
- Test: `tests/store.test.mjs`, `tests/controller.test.mjs`, `tests/shell.test.mjs`

**Interfaces:**
- Produces:
  - store case and help-item records with no `fixture`, and a workspace record with no `fixtureGeneration`;
  - no `resetFixtures` / `loadCheckpoint` on the store;
  - a controller state with no `notice`.

- [ ] **Step 1: Write the failing test.** In `tests/controller.test.mjs`, "a case deleted elsewhere is forgotten quietly" (Review Focus 3):
  - set up a staff window with a case open;
  - deliver a `cases` change, then a `workspaces` change, from the fake realtime, with `getCase` now rejecting NOT_FOUND;
  - assert that `selectedCaseId` is null, `state.notice` is absent, the error is null, and `listCases` ran again.
- [ ] **Step 2: Run it to see it fail.** Run `node --test tests/controller.test.mjs`. Expected: FAIL, because the notice is still set.
- [ ] **Step 3: Implement design D6:**
  - remove the store wrappers, `fixture` and `fixtureGeneration`;
  - remove `CHECKPOINTS` and `fixture` from the Case comment in contracts;
  - remove `FIXTURES_GONE_NOTICE`, `state.notice`, its dismiss action and `noticeBanner`, and the notice-banner rule in `styles.css`;
  - fix the stale "Presenter-only" comment near `controller.mjs:298`;
  - remove the two "Sample cases were reset." entries from `client-text.mjs`. Then run `npm run build:hant` and `npm run build:hant -- --check`.
- [ ] **Step 4: Unit tests.**
  - **Remove:** "a reset somebody else ran is said plainly, and dismissed" (shell); "a staff member cannot reset fixtures or load a checkpoint" and "the workspace read carries the fixture generation" (store). Each removal gets its grep.
  - **Convert and rename** the three controller tests:
    - "a staff start reads the workspace the fixture generation lives on" becomes "…the workspace its settings live on";
    - "the shared generation signal refetches everything it could have replaced" becomes "a workspace update refetches the lists, the workspace and the open case";
    - "a generation signal with the open case still there keeps the selection" becomes "a workspace update with the open case still there keeps the selection".
- [ ] **Step 5: Run `npm test`.** Expected: all pass. Record the unit count after, and the removed and converted lists.
- [ ] **Step 6: Commit** "Browser: the reset notice and the sample fields go (#135)".

### Task 5: The browser story and the docs

**Files:**
- Modify: `tests/browser.mjs`, `docs/setup.md`, `docs/developer/backend.md`, `docs/developer/frontend.md`, `docs/developer/README.md`, `docs/developer/production-roadmap.md`

- [ ] **Step 1: The story.** Remove the asserts on the dropped column: "none is marked as a sample" in the seed step, and the "0 fixture cases" count in "the board starts with no cases". "0 cases" and the 11 seeded cases keep their meaning. Run `node --check tests/browser.mjs`.
- [ ] **Step 2: The docs.** Remove the sample cases, the reset, the checkpoints, `sampleCaseOwners` and the notice banner from each file in the list. In the roadmap, mark the sample-case parts done in #135. `docs/developer/README.md:162`'s "the counter a reset moves" goes. Don't touch `docs/superpowers/`. Leave the browser-story run note in `docs/setup.md` for the controller.
- [ ] **Step 3: Run the story.** Check the stack is idle, then run `npm run test:browser` plain and alone. Expected: `ℹ tests 83`, `ℹ pass 83`. Then run `npm run test:auth-browser` alone. Expected: all pass. If an order times out, stop and report the per-step timings. Trim nothing.
- [ ] **Step 4: Commit** "Browser story and docs: no sample cases (#135)".

### Task 6: Verification

- [ ] **Step 1:** `npm test`. Expected: all pass. Record the before and after counts.
- [ ] **Step 2:** `npm run test:database`, alone. Expected: all pass. Record the before and after counts.
- [ ] **Step 3:** Use Task 5's `test:browser` and `test:auth-browser` results, if they ran on the final code commit. Otherwise run them again, plain and alone.
- [ ] **Step 4:** `npm run build:hant -- --check`. Expected: exit 0.
- [ ] **Step 5:** `npx openspec validate --all`. Expected: all valid.
- [ ] **Step 6:** Tick every box in `openspec/changes/remove-sample-case-tools/tasks.md` that this run completed, and commit "Sample-case tools: tasks done".
