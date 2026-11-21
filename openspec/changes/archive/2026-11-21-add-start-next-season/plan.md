# Start Next Season Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A site coordinator moves the workspace's season forward by one. The move is refused, with counts, while work is unfinished. Otherwise it resets the roster and staff sign-ins. Afterwards staff see only the current season, and past-season cases are read-only.

**Architecture:** Migration 055 has these parts:
- one security-definer RPC, `vitally_start_next_season`, running in one transaction under the workspace advisory lock;
- a past-season check in the shared `vitally_private.lock_case`, plus the one case-touching write that bypasses it;
- `open_work` scoped to the current season.

In the browser, the store filters staff case reads to the current season. Season settings gains a "Next season" card and dialog. The Exit Form's tax year becomes season − 1.

**Tech Stack:** PostgreSQL / Supabase (hand-written SQL migrations, `node:test` database suites, run in CI against a fresh Supabase stack), vanilla ES modules in `src/`, `node:test` unit tests, the Playwright browser story `tests/browser.mjs`.

**Spec:** `openspec/changes/add-start-next-season/`:
- `design.md`: decisions D1–D10;
- `specs/season-rollover/spec.md`;
- `specs/staff-case-work/spec.md`;
- `specs/volunteer-clearance/spec.md`;
- `specs/volunteer-roster/spec.md`;
- `specs/sign-in-accounts/spec.md`;
- `specs/review-and-corrections/spec.md`.

`brainstorm.md` has who decided what.

## Global Constraints

- **Fictional data only** in tests, fixtures and screenshots.
- **Migration file:** `supabase/migrations/055_start_next_season.sql`.
  - Never edit 001–053.
  - Each replaced function is copied from its latest migration, with changed lines marked `-- 055`, as 052 did.
- **The latest definitions to copy from:**
  - `vitally_private.lock_case`: `043_remove_presenter_access.sql`;
  - `vitally_private.open_work` and `public.vitally_assistance_action`: `045_volunteer_clearance.sql`;
  - `vitally_private.deactivate_account(uuid,uuid,uuid)`: `052_season_settings.sql`. Called, not changed.
- **Error codes** (SQLSTATE and message):
  - `VT001` `FORBIDDEN`;
  - `VT003` `CONFLICT`;
  - `VT007` `VALIDATION`;
  - `VT004` `INVALID_TRANSITION` with detail `PAST_SEASON`;
  - `VT004` `SEASON_NOT_FINISHED` with a JSON detail `{"openCases":n,"openFollowups":n,"claimedHelp":n,"unclaimedHelpOnCases":n}`.
- **The workspace lock:** `pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(<workspace_id>::text,0))`.
- **The RPC:** `public.vitally_start_next_season(p_action_id uuid, p_expected_season smallint, p_typed_year smallint) returns jsonb`.
  - Receipt operation: `START_NEXT_SEASON`.
  - Result: `{"actionId","season","deactivated","defaultFollowupMoved"}`.
  - Grant: execute to `authenticated` only.
- **Check order:** FORBIDDEN → lock → receipt replay → CONFLICT → VALIDATION → `SEASON_NOT_FINISHED`.
- **Effects order:** move the default follow-up person → set `current_season` → the starter's roster entry → deactivate → recompute the mirror → `season_starts` row → receipt.
- **Open cases:** `stage not in ('draft','accepted','closed')`, any season.
- **Current-season case:** `c.season = ws.current_season or c.season is null`.
- **The refusal lists counts only, with no links to the lists.** This is a deliberate choice for this change (design D3).
- **Staff text stays English.** Exact copy:
  - "Start next season…"
  - "Start the <N> season"
  - "Export this season's roster and cases first if you need them."
  - "Type <N> to confirm"
  - "Finish these first:"
  - "<n> open case(s)"
  - "<n> open follow-up(s)"
  - "<n> claimed help request(s)"
  - "<n> unclaimed help request(s) on cases"
  - "The season has already moved."
- **Database tests:**
  - assert only on rows of their own fixture workspace (`createDatabaseFixture()` makes a fresh one);
  - a rollover is one-way, so each rollover scenario uses its own fixture.
- **No local Docker or local stack, anywhere.** Never start Docker or `supabase start`, and never run `npm run db:migrate:test`, `npm run test:database` or `npm run test:browser` locally. Every subagent brief SHALL repeat this rule.
- **While iterating on database tests:**
  - commit, push the branch, and run only the changed files: `gh workflow run database-quick.yml --ref add-start-next-season -f files="<the changed tests/database-*.mjs>"`;
  - read the result with `gh run watch` and `gh run view --log-failed`, with a bounded wait;
  - a quick run never stands in for the final checks.
- **Final checks:** the PR's full CI run (checks, database, sign-in, story), linked in `verify.md`, with the story's screenshots reviewed from its artifacts. 055 changes functions and adds and drops tables but rewrites no existing rows, so CLAUDE.md's "local stack with main's migrations" rule does not apply.
- **Migration number:** `main` already has `054_return_to_signing_exit_forms.sql`, so this change's migration is 055. If `main` takes 055 before merge, renumber.
- **Unit checks:** `npm test`.
- **No Edge Function, no email, no client-text change.** So `build:hant` is untouched.

## Review Focus

1. **A retried start after a lost reply** must return the stored receipt, not `CONFLICT`. The season must have moved once. Test in Task 3.
2. **A leftover client draft** (`season is null`) submitted after the start must be accepted into the new season with client number 1. It must be neither refused as `PAST_SEASON` nor numbered in the old season. Test in Task 1 (draft writable) and Task 3 (number 1).
3. **A help request with no case** stays claimable after the start, while one on a past-season case is refused. Test in Task 1.
4. **A staff window restored to a past-season case** after the season moved must land on its home screen, with no error toast and no stale case data. Test in Task 4.
5. **The starter's own window** after success must show "Finish your setup" with the Roster and Season settings links, not "This account has no access". Test in Task 5 (unit) and Task 7 (story).

---

### Task 1: Past seasons are read-only (migration 055, part 1)

**Files:**
- Create: `supabase/migrations/055_start_next_season.sql` (§1 past-season check)
- Create: `tests/database-past-season.mjs`

**Interfaces:**
- Produces: `vitally_private.lock_case(p_member public.memberships, p_case_id uuid) returns public.cases`. Its signature is unchanged. It now raises `VT004 INVALID_TRANSITION` with detail `PAST_SEASON` when `v_case.season is not null and v_case.season <> (select current_season from public.workspaces where id = v_case.workspace_id)`. The check runs after the `NOT_FOUND` check.
- Produces: `public.vitally_assistance_action(...)`. Its signature is unchanged. It raises the same refusal when the item's `case_id` names a past-season case.

- [ ] **Step 1: Inventory write paths.** List every grant of `insert`/`update`/`delete` to `authenticated` on case tables and every `storage.objects` policy that writes case documents (`grep -n "grant .*insert\|grant .*update\|on storage.objects" supabase/migrations/*.sql`). For each, record in the task report whether it goes through `lock_case`. Every one that doesn't gets a step like Step 4 and a test like Step 2.
- [ ] **Step 2: Write the failing tests** in `tests/database-past-season.mjs`, one fixture. Use the fixture helpers to make an Accepted case and a draft. Then set the workspace's season one ahead with `f.sql("update public.workspaces set current_season=current_season+1 where id=$1", [f.workspaceId])`. Tests:
  - `every case-writing RPC refuses a past-season case`: `vitally_apply_action` (one representative type per actor: a staff `SAVE_NOTE` or similar the fixture supports, and a client action), `vitally_log_contact`, `vitally_edit_contact`, `vitally_set_case_label` and `vitally_close_unsigned` each return code `VT004`, message `INVALID_TRANSITION`, details `PAST_SEASON`, and the case's `revision` is unchanged;
  - `a help request on a past-season case is refused`: `vitally_assistance_action` on an `open` item naming the Accepted case gives `PAST_SEASON`;
  - `a help request with no case is still claimable`;
  - `a draft stays writable and submits into the current season`: `SAVE_ANSWERS` and then submit on the draft succeed, and the case's `season` equals the new `current_season`;
  - `clients still read their past-season application`: the owning client's `from("cases").select()` returns it.
- [ ] **Step 3: Run the tests to see them fail.** Commit and push the test, then `gh workflow run database-quick.yml --ref add-start-next-season -f files="tests/database-past-season.mjs"`. Expected: FAIL. The refusals don't happen yet.
- [ ] **Step 4: Write 055 §1:** `lock_case` and `vitally_assistance_action` as in Interfaces, plus any path from Step 1.
- [ ] **Step 5: Run the tests.** Commit, push, and run the same quick run. Expected: PASS.
- [ ] **Step 6: Check the neighbouring files.** Quick-run the database files that exercise the five lock_case RPCs and help requests: `tests/database-actions.mjs tests/database-assistance.mjs tests/database-contacts.mjs tests/database-labels.mjs tests/database-season-close.mjs`. Expected: PASS. No existing test writes a past-season case. If one does, it's a fixture that sets `season` by hand: report it, and don't weaken the check.
- [ ] **Step 7: Commit** anything changed since Step 5: `git commit -m "055: past-season cases are read-only (add-start-next-season)"`

### Task 2: Open work counts only current-season cases; drop capabilities_before_052

**Files:**
- Modify: `supabase/migrations/055_start_next_season.sql` (§2 `open_work`, §3 drop)
- Create: `tests/database-open-work-season.mjs`

**Interfaces:**
- Produces: `vitally_private.open_work(p_workspace_id uuid, p_person_id uuid) returns table(needs text, label text)`. The signature is unchanged. Branches 1 and 2 join `public.workspaces ws on ws.id = c.workspace_id` and add `and (c.season = ws.current_season or c.season is null)`. Branches 3–5 are unchanged.

- [ ] **Step 1: Write the failing tests**, one fixture:
  - `a returning volunteer's past-season case is not open work`. A Preparer prepares a case to Accepted. The season goes +1. Give them a roster entry for the new season with Preparer, then save it without Preparer through `vitally_save_volunteer`. Expected: success, and `cases.preparer_id` still names them.
  - `Deactivate ignores past-season cases`. For the same volunteer, with Preparer gone, `vitally_deactivate_account` gives `deactivated`.
  - `a current-season Accepted case still counts`. In a second fixture with no season change, removing Preparer from the preparer of an Accepted case gives `VT004 OPEN_WORK`, with details listing `preparing client <n>`.
  - `capabilities_before_052 is gone`: `select to_regclass('vitally_private.capabilities_before_052')` is null.
- [ ] **Step 2: Run the tests to see them fail.** Commit, push, then `gh workflow run database-quick.yml --ref add-start-next-season -f files="tests/database-open-work-season.mjs"`. Expected: the first two FAIL with `OPEN_WORK`, and the last FAILS.
- [ ] **Step 3: Write 055 §2 and §3.** §2 is `open_work` as in Interfaces. §3 is `drop table vitally_private.capabilities_before_052;`.
- [ ] **Step 4: Quick-run** this file together with `tests/database-accounts.mjs tests/database-clearance.mjs` (they call open work). Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "055: open work counts only current-season cases; drop capabilities_before_052"`

### Task 3: vitally_start_next_season and season_starts

**Files:**
- Modify: `supabase/migrations/055_start_next_season.sql` (§4 table, §5 RPC)
- Create: `tests/database-start-next-season.mjs`

**Interfaces:**
- Consumes: Task 2's `open_work`; `vitally_private.deactivate_account(p_workspace_id uuid, p_user_id uuid, p_changed_by uuid) returns void` (052); `vitally_private.is_site_coordinator(p_workspace_id uuid, p_person_id uuid)` (052); `vitally_private.reserve_receipt(member, action_id, operation, digest, person_id)` as `vitally_save_volunteer` uses it.
- Produces:
  - Table `public.season_starts`:
    - `id uuid pk default gen_random_uuid()`;
    - `workspace_id uuid not null`;
    - `from_season smallint not null`;
    - `to_season smallint not null check (to_season = from_season + 1)`;
    - `started_by_person_id uuid not null`;
    - `started_at timestamptz not null default now()`;
    - `default_followup_from uuid` and `default_followup_to uuid` (both null when unchanged);
    - `deactivated_count integer not null check (deactivated_count >= 0)`.

    RLS is enabled, with no policies, and `revoke all ... from public, anon, authenticated`.
  - The RPC as in Global Constraints. The mirror recompute is `update public.people set capabilities = capabilities where workspace_id = <ws>;`. Deactivation selects `accounts a join memberships m on m.workspace_id = a.workspace_id and m.user_id = a.user_id` where `m.access = 'staff' and a.status in ('invited','active') and not a.is_site_coordinator`, ordered by `a.person_id`.

- [ ] **Step 1: Write the failing refusal tests** (fixture A, no successful start):
  - `an admin who isn't a site coordinator is FORBIDDEN, with no receipt` (count `action_receipts` for the action id = 0);
  - `the wrong typed year is VALIDATION`;
  - `a stale expected season is CONFLICT`;
  - `SEASON_NOT_FINISHED counts each kind`. Set up a case at `ready_to_efile`, one at `efiled`, one at `rejected` with `season = current − 1` (set by SQL; this is the older-season case), one open follow-up, one claimed help request, one open help request on an Accepted case, one open help request with no case, and a draft. The parsed details equal `{"openCases":3,"openFollowups":1,"claimedHelp":1,"unclaimedHelpOnCases":1}`, and `current_season` is unchanged.
- [ ] **Step 2: Write the failing success tests** (fixture B: site coordinator `sc` as starter, a second site coordinator `sc2`, a non-SC Admin as the default follow-up person, a Preparer with an active account, an invited volunteer, a deactivated volunteer, a client account; every case Accepted or Closed):
  - `a start moves the season and resets staff`:
    - the result's `season` is `old + 1`, `deactivated` is 3 (Admin, Preparer, invited);
    - the starter has exactly one `roster_entries` row for the new season, with `roles = '{}'`, `is_new = false`, `photo_id_checked_at is null`;
    - the old season's entries and certificates are unchanged;
    - the accounts of `sc` and `sc2`, the client and the already-deactivated volunteer are unchanged;
    - every `people.capabilities` equals `vitally_private.mirror_capabilities(...)`;
    - `workspaces.default_followup_person_id = sc`;
    - one `season_starts` row with `default_followup_from = <Admin>`, `default_followup_to = sc`, `deactivated_count = 3`.
  - `a retry returns the receipt, not CONFLICT`: the same call again equals the first result, and there is still one `season_starts` row.
  - `the new season's first client number is 1`: a client submits a new application after the start, and `client_number = 1`, `season = new`.
  - `signed-in users can't reach season_starts`: `sc.from("season_starts").select()` returns no rows or an error, and an insert is refused.
- [ ] **Step 3: Write the failing default-kept test** (fixture C, where the default follow-up person is `sc2`): after a start by `sc`, the default is still `sc2`, `defaultFollowupMoved` is false, and both follow-up columns of the row are null.
- [ ] **Step 4: Run the tests to see them fail.** Commit, push, then `gh workflow run database-quick.yml --ref add-start-next-season -f files="tests/database-start-next-season.mjs"`. Expected: FAIL, because the function doesn't exist.
- [ ] **Step 5: Write 055 §4 and §5** per Interfaces and design D1–D4.
- [ ] **Step 6: Quick-run** `tests/database-past-season.mjs tests/database-open-work-season.mjs tests/database-start-next-season.mjs tests/database-season-settings.mjs tests/database-catalog.mjs`. Expected: PASS.
- [ ] **Step 7: Commit.** `git commit -m "055: vitally_start_next_season (add-start-next-season)"`

### Task 4: Staff read only the current season

**Files:**
- Modify: `src/supabase-store.mjs` (`listCases` ~536, `getCase` ~634)
- Modify: `src/controller.mjs` (opening and restoring a case)
- Modify: `src/errors.mjs`, only if `PAST_SEASON` needs its own text (see Step 5)
- Test: `tests/store.test.mjs`, `tests/controller.test.mjs`

**Interfaces:**
- Consumes: the workspace row the store already maps (`currentSeason`, `src/supabase-store.mjs:515`).
- Produces: `listCases()` adds `.or(\`season.eq.${currentSeason},season.is.null\`)` to the staff cases query when `isStaffAccess(await access())`. The client query is unchanged. `getCase(id)`, for staff, throws `createAppError({ code: "VT002" })` when the row's `season` is set and isn't `currentSeason`. That is the same answer as an absent case.

- [ ] **Step 1: Write the failing store tests:**
  - `staff listCases asks only for the current season and drafts`: a fake client records the query chain and contains `or("season.eq.2027,season.is.null")` for a staff membership in season 2027;
  - `client listCases is unchanged`: no `or(...)` for an applicant;
  - `staff getCase of a past-season case is not found`: code `VT002`.
- [ ] **Step 2: Run** `node --test tests/store.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the store changes in Interfaces.
- [ ] **Step 4: Write the failing controller test** `a restored staff window on a past-season case goes home`: a saved window state naming a case whose `getCase` answers `VT002`. After restore, the screen is the staff home screen and no error toast is shown. Use the existing "screen no longer allowed" path. If restore already handles `VT002` this way, the test passes at once: say so in the report and keep it.
- [ ] **Step 5: `PAST_SEASON` text.** Check how `errors.mjs` maps `VT004 INVALID_TRANSITION`: today it says "This step is not available right now." Keep that mapping for `PAST_SEASON`, and add a unit test that a `PAST_SEASON` refusal shows it.
- [ ] **Step 6: Run** `npm test`. Expected: PASS.
- [ ] **Step 7: Commit.** `git commit -m "Staff windows load only the current season's cases (add-start-next-season)"`

### Task 5: Start next season on Season settings

**Files:**
- Modify: `src/season-settings-views.mjs` (a new `nextSeasonCard`, `startSeasonDialogBody`)
- Modify: `src/controller.mjs` (the action, refusal handling, re-read)
- Modify: `src/supabase-store.mjs` (`startNextSeason`)
- Modify: `src/app.mjs` (the dialog wiring and the typed-year gate, following `change-sidn`)
- Test: `tests/season-settings-views.test.mjs`, `tests/controller.test.mjs`, `tests/store.test.mjs`

**Interfaces:**
- Consumes: Task 3's RPC and its error shapes.
- Produces:
  - `store.startNextSeason({ actionId, expectedSeason, typedYear }) => Promise<{ actionId, season, deactivated, defaultFollowupMoved }>`, calling `vitally_start_next_season` with `p_action_id`, `p_expected_season`, `p_typed_year`;
  - `renderSeasonSettings(view, { canEdit, selfId, list, ui })` now also renders a "Next season" card. The button `data-action="open-start-season"` appears only when `canEdit`;
  - `startSeasonDialogBody({ season, typed = "", refusal = null, busy = false }) => string`. The confirm button is disabled unless `typed.trim() === String(season + 1)`. `refusal` is the parsed counts object.
  - `seasonRefusalLines(counts) => string[]` (exported, for tests).

- [ ] **Step 1: Write the failing view tests:**
  - `a site coordinator sees Start next season…`; `another admin sees the card without the button`;
  - `the dialog for season 2026`: the title is "Start the 2027 season", it contains "Export this season's roster and cases first if you need them." and "Type 2027 to confirm", and the confirm is disabled for `typed: "2026"` and enabled for `typed: "2027"`;
  - `seasonRefusalLines` for `{openCases:2,openFollowups:1,claimedHelp:0,unclaimedHelpOnCases:1}` equals `["2 open cases","1 open follow-up","1 unclaimed help request on cases"]`. For `claimedHelp:3`, it includes "3 claimed help requests".
- [ ] **Step 2: Run** `node --test tests/season-settings-views.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the views.
- [ ] **Step 4: Write the failing controller tests:**
  - `SEASON_NOT_FINISHED keeps the dialog open with the lines`;
  - `CONFLICT re-reads settings, closes the dialog and says "The season has already moved."`;
  - `success re-reads the workspace, clearance and lists`. After a fake success, the controller has called the workspace and clearance reads again. A starter who is uncleared with no roles gets the setup screen; that comes from the existing clearance routing, asserted on the resulting screen.
- [ ] **Step 5: Implement** the store call, the controller action `startNextSeason(typedYear)` (busy-guarded, a fresh action id per press, the same id on a retry after a network error, as the other site coordinator saves do) and the app wiring.
- [ ] **Step 6: Run** `npm test`. Expected: PASS.
- [ ] **Step 7: Commit.** `git commit -m "Season settings: Start next season (add-start-next-season)"`

### Task 6: Exit Form tax year is season − 1

**Files:**
- Modify: `src/app.mjs:1920-1928`
- Test: `tests/exit-form.test.mjs`, or the test that covers the Exit Form's marks input. If the season → tax year mapping isn't reachable from a unit test, extract `exitFormTaxYear(record, workspace) => number` into `src/exit-form.mjs` and test that.

**Interfaces:**
- Produces: `exitFormTaxYear(record, workspace)`, which returns `record.season - 1` when `record.season` is an integer, else `workspace.currentSeason - 1`. There is no hard-coded year.

- [ ] **Step 1: Write the failing tests:** `a season-2026 case's Exit Form shows 2025`; `a case with no season falls back to the current season − 1`.
- [ ] **Step 2: Run** `node --test tests/exit-form.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** it, and use it at `src/app.mjs:1920`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Exit Form tax year is the season − 1 (add-start-next-season)"`

### Task 7: Story assertion, a separate Chrome test, docs and final checks

**Files:**
- Modify: `tests/browser.mjs`. Two edits:
  - In the story, change **only** the Exit Form assertion. Near the `String(expected.season)` comparison (~line 3280), use `String(expected.season - 1)`. Add nothing else to the story: it is at ~590 s of 900 s, and new admin-screen walks get their own test.
  - Add a new top-level test, "A site coordinator starts the next season" (`{ timeout: 300_000 }`), modelled on "A site coordinator changes Season settings":
    - its own `createBrowserFixture()`, and so its own workspace;
    - Chrome only;
    - it touches no other test's workspace.
- Modify: the developer docs that describe seasons, open work or `capabilities_before_052`. Find them with `grep -rn "capabilities_before_052\|current_season\|open work" docs/developer`.

**Interfaces:**
- Consumes: Tasks 3–6.

- [ ] **Step 1: Fix the Exit Form assertion** in the story to season − 1.
- [ ] **Step 2: Write the separate Chrome test.** Its steps:
  1. The fixture's site coordinator signs in, opens Season settings and "Start next season…", and sees the confirm disabled until they type the next year.
  2. With one open case in the fixture workspace, they confirm. The dialog lists "1 open case" under "Finish these first:".
  3. The case is finished with an existing fixture helper (closed with a reason). They confirm again.
  4. The starter's window shows "Finish your setup for this season".
  5. A volunteer's window opened before the start shows "This account has no access".
  6. A second site coordinator's case pool shows "No cases yet this season."

  Take a screenshot at each step, under `artifacts/browser/`.
- [ ] **Step 3: Update the docs** found in Files.
- [ ] **Step 4: Run the local checks.** `npm test` and `npx openspec validate --all`. Expected: PASS. Record the before and after test counts for the PR.
- [ ] **Step 5: Commit and push.** `git commit -m "Story assertion, Start next season browser test, docs (add-start-next-season)"`
- [ ] **Step 6: Final checks.** Use the PR's full CI run on the final commit, or `gh workflow run ci.yml --ref add-start-next-season` with no input.
  - Every job must pass: checks, database, sign-in, and both story legs.
  - If the story exceeds 900 s, stop and report the per-phase timings rather than trimming tests.
  - Review the screenshots from the run's artifacts, and link the run in `verify.md`.
