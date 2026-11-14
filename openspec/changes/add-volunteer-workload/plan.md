# Volunteer Workload and Reassignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Workload tab under Volunteers for a cleared admin. It shows each preparer's and
reviewer's load, and assigns or reassigns a case's preparer or reviewer through one audited
case action, `ASSIGN_CASE`.

**Architecture:**
- **Database:** one new migration adds `vitally_private.act_assign_case` and wires
  `ASSIGN_CASE` into the existing `vitally_apply_action` pipeline (receipt, lock, effective
  capability authority, revision, payload, handler, `commit_action`).
- **Browser:** the counts, the Stalled rule and the drawer's candidates and ordering are
  computed in a new pure module from data the staff screens already load, plus one grouped
  read of the latest contact time. New views render the tab, the table and the drawer.

**Tech Stack:** plain ES modules (no framework), `node --test`, Supabase Postgres
(plpgsql, SECURITY DEFINER, row-level security), Playwright story (regression only).

**Spec:** `openspec/changes/add-volunteer-workload/specs/volunteer-workload/spec.md` and
`specs/volunteer-clearance/spec.md`. The design is `design.md` (D1–D9) and the decision log
is `brainstorm.md`. Read them before each task.

## Global Constraints

- Fictional data only, in code, tests and fixtures. Staff screens are English only; there is
  no client text in this change.
- **Never edit an applied migration.** The new file is
  `supabase/migrations/046_volunteer_workload.sql`. If 046 is taken on `main` at PR time,
  renumber the file and every comment or test that names it.
- **Re-create, don't patch.** Every function the migration changes is re-created in full
  from its **latest** definition (`grep -n "function <name>" supabase/migrations/*.sql |
  tail -1`), with only the `ASSIGN_CASE` lines added. Re-apply the same `revoke`/`grant`
  lines that definition's migration ends with. Use how 039 added `SAVE_PREPARER_FIELDS` as
  the template for every place an action type is listed.
- **A save changes only what it is sent.** `act_assign_case` writes only `cases.stage`
  (Assign only), `cases.preparer_id` or `cases.reviewer_id`, one `preparation_participants`
  row (`on conflict do nothing`), and an insert into `reviews` (Assign reviewer) or an
  update of the active review's `reviewer_person_id` (Reassign reviewer). Nothing else.
- **Database tests stay in their own workspace.** They assert only on rows in the fixture's
  `f.workspaceId`; never an unscoped scan or `workspace_id <> $1`.
- **Command rules for every implementer and reviewer:**
  - put a timeout on every command (`timeout <s> …` and the Bash tool's `timeout`);
  - never leave a server, `--watch` or dev mode in the foreground;
  - if a command hangs or times out, find out why before retrying it unchanged;
  - wait on CI in bounded steps under 10 minutes, never by ending the turn;
  - if anything needs the user's approval, stop and report BLOCKED naming it.
- **Do not run** `npm run db:migrate:test`, `npm run test:database`,
  `npm run test:auth-browser` or `npm run test:browser` locally without the user's say-so.
  The local stack is shared with other sessions, and a local 046 could collide with theirs.
  Database and story checks run in CI (`gh workflow run ci.yml --ref <branch>` on the
  pushed branch) unless the user says otherwise. Local checks: `npm test`,
  `npm run build:hant -- --check`, `npx openspec validate --all`.
- The browser story is not extended (decision Q9.3). If a story run fails on its time limit,
  do not trim anything; stop and report the per-phase timings.

## Review Focus

1. **A reviewer reassignment while the previous reviewer has the case open.** Their next
   press (Approve, Request corrections) must be refused, never recorded under the old
   reviewer. This is pinned in Task 2's "old reviewer refused" test.
2. **Assigning someone whose ceiling is wider than their roles.** For example, Preparer role
   with `people.capabilities` `{prepare, review}` as reviewer. They must be refused
   (`INELIGIBLE`) and absent from the drawer. This is pinned in Task 1 and Task 4.
3. **A case that moves between opening the drawer and pressing Choose** (another admin's
   assignment, or the volunteer's own claim). The press must be a `CONFLICT` with the
   existing conflict message, never a silent second assignment. This is pinned in Task 1
   (database) and Task 6 (the controller sends the listed revision).
4. **Missing names or languages in the answers.** No first or last name shows "—". No
   languages means the candidate falls in group 3 and nothing throws. This is pinned in
   Task 4.
5. **The Unassigned row under sort and search.** It stays first, and search never hides it.
   This is pinned in Task 4 (`sortRows` and `searchRows` take volunteer rows only) and
   Task 5 (the view always renders it first).

---

### Task 1: `ASSIGN_CASE` wiring, refusals and the guard list

**Files:**
- Create: `supabase/migrations/046_volunteer_workload.sql`
- Create: `tests/database-workload.mjs`
- Modify: `tests/database-clearance.mjs` (the "today's assigning functions" list, around line 1061)

**Interfaces:**
- Consumes (045):
  - `vitally_private.effective_capabilities(ws uuid, person uuid) -> text[]`
  - `vitally_private.require_cleared_assignee(ws uuid, person uuid)` (raises VT006 `INELIGIBLE`)
  - `vitally_private.require_review_eligibility(public.cases, public.people)`
  - fixture helpers `createDatabaseFixture`, `f.act`, `f.staff`, `f.readyCase`,
    `f.preparedCase`, `f.siteCoordinator`/`f.siteCoordinatorId`, `f.preparer`/`f.preparerId`,
    `f.reviewer`/`f.reviewerId`, `f.receiptsFor`
- Produces:
  - `ASSIGN_CASE` payload `{slot: "preparer"|"reviewer", personId: uuid}`;
  - `vitally_private.act_assign_case(p_member public.memberships, p_case public.cases,
    p_person public.people, p_payload jsonb) returns jsonb`, returning the same outcome shape
    as `act_claim_review` (`{detail, message?}`).

- [ ] **Step 1: Write the failing refusal tests.** In `tests/database-workload.mjs`, use
  `test("ASSIGN_CASE refusals against real Supabase", ...)` with one `createDatabaseFixture()`
  and `t.test` cases. Each asserts the error code with `rejected(code)` from
  `tests/support/database-fixture.mjs`. Each also asserts that the case row (stage,
  preparer_id, reviewer_id, revision) and `preparation_participants`/`reviews` for the case
  are unchanged, and that no receipt is stored for the action id. The cases:
  - `non-admin caller → FORBIDDEN`: `f.reviewer` assigns the preparer on `f.readyCase()`.
  - `unknown person → FORBIDDEN`: personId `randomUUID()`.
  - `bad payload → VALIDATION`: `{slot:"helper", personId}`, `{slot:"preparer"}`, and an
    extra key `{slot,personId,note:"x"}`.
  - `not allowed at this stage → INVALID_TRANSITION`: preparer on a submitted case still at
    `received`, and at `review_approved` (use `f.approvedCase()`); reviewer at `preparing`
    and at `corrections_required`.
  - `same holder again → INVALID_TRANSITION`: reassign the preparer to `f.preparerId`.
  - `uncleared assignee → INELIGIBLE`: `f.staff({key:"una_prep", name:"Una Prell",
    capabilities:["prepare"], cleared:false})`.
  - `ceiling wider than roles → INELIGIBLE`: a staff member with capabilities
    `["prepare","review"]`, then set their current roles to `["preparer"]` (copy
    `setCurrentRoles` from `tests/database-clearance.mjs`), assigned as reviewer on
    `f.preparedCase()`.
  - `participant as reviewer → SELF_REVIEW`: a cleared staff member "Dana Holt" with
    `["prepare","review"]` (roles Reviewer) claims preparation on `f.readyCase()` and sends
    `SUBMIT_REVIEW` with `PREPARER`. The admin then assigns Dana Holt as reviewer.
  - `current reviewer as preparer → SELF_REVIEW`: a second staff member "Casey Marsh" with
    `["prepare","review"]` claims the review of `f.preparedCase()`. The admin then reassigns
    the preparer to Casey Marsh. (The role account `f.reviewer` has only `review`, so it
    would be `INELIGIBLE` first.)
  - `uncleared caller → NOT_CLEARED`: the site coordinator with current roles set to `[]`,
    restored in `finally`.
  - `stale revision → CONFLICT`: call `rpc("vitally_apply_action", applyArgs({...,
    revision: current-1}))`.
- [ ] **Step 2: Run** `npm test` (unit only, stays green). The database file cannot run
  locally (Global Constraints). It runs in CI in Task 7. Expected now: the database tests
  would fail with an unknown action type.
- [ ] **Step 3: Write the migration's wiring.**
  - `check_operation_authority`: add `'ASSIGN_CASE'` to the admin-only `when` list.
  - `check_payload`: an `ASSIGN_CASE` branch. Keys exactly `slot` and `personId`; `slot` in
    (`preparer`,`reviewer`); `personId` a UUID string. Otherwise `VT007 VALIDATION`.
  - `vitally_apply_action`: `when 'ASSIGN_CASE' then v_outcome =
    vitally_private.act_assign_case(v_member,v_case,v_person,p_payload);`
  - Any other list of action types the 039 template shows (e.g. `check_related`, a receipt
    operation check). Find each with `grep -n "SAVE_PREPARER_FIELDS" supabase/migrations/*.sql`.
  - `act_assign_case`, refusals in design D5's order:
    1. stage/slot (`VT004 INVALID_TRANSITION`, including the same holder);
    2. the person exists in `p_case.workspace_id` (`VT001 FORBIDDEN`);
    3. `require_cleared_assignee`;
    4. effective capability (`VT006 INELIGIBLE`);
    5. independence (`VT005 SELF_REVIEW`).

    Read the assignee as a `public.people` row with `capabilities` replaced by
    `effective_capabilities(...)`, as `contact_person` does, and pass it to
    `require_review_eligibility` for the reviewer slot. The effects come in Task 2; for now
    the function may raise `VT004` after the checks.
- [ ] **Step 4: Add `act_assign_case`** to the expected list in `tests/database-clearance.mjs`
  (alphabetical, after `act_approve_review`). Add the clearance delta's scenario "Assigning a
  reviewer whose role is narrower than the ceiling" there or in `tests/database-workload.mjs`
  (Step 1 covers it; reference it, don't duplicate).
- [ ] **Step 5: Run** `npm test` and `npx openspec validate --all`. Expected: PASS.
- [ ] **Step 6: Commit** `git add supabase/migrations/046_volunteer_workload.sql
  tests/database-workload.mjs tests/database-clearance.mjs && git commit -m "Workload:
  ASSIGN_CASE wiring and refusals (#139)"`

### Task 2: `ASSIGN_CASE` effects and handovers

**Files:**
- Modify: `supabase/migrations/046_volunteer_workload.sql` (`act_assign_case` body)
- Modify: `tests/database-workload.mjs`

**Interfaces:**
- Consumes: Task 1's function and payload. Fixture: `f.clientMessages(caseId)`,
  `f.act(..., "SUBMIT_REVIEW", {questionnaire: PREPARER})`,
  `"RESUBMIT_REVIEW"`, `"REQUEST_CORRECTIONS"`, `"APPROVE_REVIEW"` with `REVIEWER`.
- Produces: the case event `case_events.action='ASSIGN_CASE'`, `detail = {slot, personId,
  previousPersonId}` (previousPersonId JSON null for an Assign).

- [ ] **Step 1: Write the failing effect tests** in `test("ASSIGN_CASE effects against real
  Supabase", ...)`:
  - `assign preparer`: on `f.readyCase()`, the admin assigns `f.preparerId`. The stage is
    `preparing`, `preparer_id` is the preparer, there is a participant row, the newest client
    message is `"A volunteer has started preparing your return."`, and the case event has
    actor = the admin's person and detail `{slot:"preparer", personId, previousPersonId:null}`.
  - `assign reviewer`: on `f.preparedCase()`, assign `f.reviewerId`. The stage is
    `reviewing`, there is one `reviews` row with status `active`, `reviewer_person_id` the
    reviewer and `preparation_version` = the case's, and the client message is `"An
    independent reviewer is checking your return."`
  - `reassign preparer during corrections`: preparer claims, submits; reviewer claims,
    requests corrections; the admin reassigns the preparer to a new cleared Preparer
    ("Jordan Park"). Both are participants, the stage is still `corrections_required`, no new
    client message, and Jordan Park's `RESUBMIT_REVIEW` with `PREPARER` succeeds.
  - `reassign reviewer mid-review`: the reviewer claims; the admin reassigns to a second
    cleared Reviewer ("Riley Quinn"). The active review's id, created_at and
    preparation_version are unchanged, its `reviewer_person_id` is Riley Quinn, the count of
    `reviews` rows is unchanged, and Riley Quinn's `APPROVE_REVIEW` with `REVIEWER` succeeds.
  - `old reviewer refused`: after the mid-review reassignment, `f.reviewer`'s
    `APPROVE_REVIEW` is rejected (FORBIDDEN), and no reviewer questionnaire exists.
  - `former preparer never reviewer`: after `reassign preparer`, assigning the former
    preparer (given `["prepare","review"]`) as reviewer is `SELF_REVIEW`.
- [ ] **Step 2: Implement the effects** in `act_assign_case` per design D5 (Assign moves the
  stage like the claim; Reassign leaves it). Return `{detail:{slot, personId,
  previousPersonId}}` plus `message` only for an Assign. Reuse the claim functions' exact
  client strings.
- [ ] **Step 3: Run** `npm test`. Expected: PASS (database tests run in CI, Task 7).
- [ ] **Step 4: Commit** `"Workload: ASSIGN_CASE assigns like a claim and hands over work in
  progress (#139)"`

### Task 3: Browser data and the action contract

**Files:**
- Modify: `src/supabase-store.mjs` (`listCases`, around line 465)
- Modify: `src/contracts.mjs` (the case action list), `src/case-actions.mjs` (payload builders, around line 244)
- Test: `tests/store.test.mjs`, `tests/case-actions.test.mjs`

**Interfaces:**
- Produces: each staff `listCases()` record gains `lastContactAt: string|null` (the newest
  `contact_log.created_at` for the case). `CASE_ACTIONS` includes `"ASSIGN_CASE"`. The
  payload builder `ASSIGN_CASE: ({slot, personId}) => ({slot, personId})`.

- [ ] **Step 1: Write failing tests.**
  - `listCases maps the newest contact time`: a fake reader returns two contact_log rows for
    one case and none for another. Expect `lastContactAt` to be the later ISO string, and
    `null` for the other.
  - `ASSIGN_CASE is a case action with slot and personId`.
- [ ] **Step 2: Implement.** One grouped read: `client.from("contact_log").select("case_id,
  created_at").in("case_id", ids).order("created_at")`, with the last row per case. Staff
  only, as the other grouped reads are.
- [ ] **Step 3: Run** `timeout 600 npm test`. Expected: PASS.
- [ ] **Step 4: Commit** `"Workload: latest contact time per case and the ASSIGN_CASE
  contract (#139)"`

### Task 4: `src/volunteer-workload.mjs` (pure logic)

**Files:**
- Create: `src/volunteer-workload.mjs`
- Test: `tests/volunteer-workload.test.mjs`

**Interfaces:**
- Consumes:
  - volunteers from `combineVolunteers` (`{id, name, languages, otherLanguage, roles,
    cleared, ...}`);
  - people (`{id, name, capabilities}`);
  - cases from `listCases` (`{id, reference, revision, stage, preparerId, reviewerId,
    participants, openRequests, updatedAt, lastContactAt, answers}`);
  - `clientLanguages(answers)` from `src/intake-catalogue.mjs` (entries `{code, text,
    label}`, preferred first);
  - `waitingDays(value, now)` from `src/office-views.mjs`.
- Produces (all exported):
  - `ROLE_CAPABILITIES`: frozen `{greeter:[], intaker:["receive_documents","assist"],
    preparer:["prepare"], reviewer:["prepare","review"],
    admin:["admin","followup","assist","receive_documents"]}`
  - `effectiveCapabilities(volunteer, person) -> string[]`
  - `STALLED_DAYS = 5`
  - `lastActivity(record) -> string|null` (the later of `updatedAt` and `lastContactAt`)
  - `isStalled(record, now) -> boolean` (`waitingDays(lastActivity(record), now) >= 5`)
  - `taxpayerName(answers) -> string` (`tp_first_name tp_last_name` trimmed and joined, or `"—"`)
  - `workloadRows({volunteers, people, cases, now}) -> Row[]`, where `Row = {id, name,
    cleared, preparing, review, open, waiting, stalled, cases: [{record, slot:
    "preparer"|"reviewer", stalled: boolean}]}`
  - `unassignedCases(cases) -> {preparer: record[], reviewer: record[]}`
  - `sortRows(rows, {key = "open", dir = "desc"} = {}) -> Row[]` (ties by name, `localeCompare`
    with `"en"` and base sensitivity, as the Roster does)
  - `searchRows(rows, text) -> Row[]`
  - `languageGroup(volunteer, clientEntries) -> 0|1|2`
  - `candidates({record, slot, volunteers, people, rows}) -> {list: [{id, name, languages,
    otherLanguage, roles, open, current: boolean}], hiddenForIndependence: number}`

- [ ] **Step 1: Write failing tests**, one per spec scenario:
  - "Who has a row", "An admin who also reviews", "A ceiling wider than the roles";
  - "Counting a volunteer's cases" (expects 3/1/4/1);
  - "Approved cases leave the count";
  - "A stalled case", "A logged contact keeps a case moving", "An edited contact does not"
    (`lastContactAt` is the logged time, so an edit changes nothing);
  - "The default order", "Searching";
  - "Cases waiting" (`unassignedCases`);
  - "A former preparer is not offered as reviewer" (`hiddenForIndependence === 1`);
  - "Uncleared people are not offered", "The current holder";
  - "Preferred, then another, then none", "Fewest open cases within a group",
    "Other languages" (`"vietnamese "` matches `"Vietnamese"`; `"Tagalog"` does not);
  - "The picker follows effective capabilities".

  Plus Review Focus 2 and 4: no names gives `"—"`, no languages gives group 2, and
  `candidates` never throws on `answers: {}`. Use fixed `now` values, e.g.
  `Date.parse("2026-11-13T15:00:00-05:00")`.
- [ ] **Step 2: Run** `timeout 600 node --test tests/volunteer-workload.test.mjs`. Expected:
  FAIL (module missing).
- [ ] **Step 3: Implement the exports.**
  - `languageGroup`: 0 if the volunteer speaks the client's first entry, 1 if any other
    entry, else 2.
  - A match is equal `code`, except for `other`, which needs both texts trimmed and
    lower-cased equal and non-empty.
  - `candidates` filters to:
    - cleared volunteers;
    - with the slot's capability in `effectiveCapabilities`;
    - for the reviewer slot, not in `record.participants`;
    - for the preparer slot, not `record.reviewerId`.

    It counts the people dropped only by those last two rules as `hiddenForIndependence`. It
    keeps the current holder with `current: true`, sorts by group, then `open`, then name,
    and puts `open` from `rows`.
- [ ] **Step 4: Run** the file, then `timeout 600 npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `"Workload: counts, Stalled and drawer ordering (#139)"`

### Task 5: Workload views

**Files:**
- Create: `src/workload-views.mjs`
- Modify: `src/views.mjs` (`rosterPage` becomes the Volunteers page with tabs; `DRAWERS`
  gains `"assign"`; the drawer branch for `"assign"`)
- Modify: `src/staff-views.mjs` (`EVENT_SENTENCES`/`historySentence` for `ASSIGN_CASE`)
- Test: `tests/workload-views.test.mjs`, `tests/staff-views.test.mjs`, `tests/volunteer-views.test.mjs`

**Interfaces:**
- Consumes: Task 4's exports; `esc`, `button`, `icon` from `src/ui.mjs`; `stageBadge` or the
  staff stage name helper used by the pool.
- Produces:
  - `volunteerTabs(current: "roster"|"workload", {workload: boolean}) -> string` (the
    Workload tab only when `workload`). Buttons have `data-action="volunteer-tab"
    data-tab="roster|workload"` and `aria-current="page"` on the current tab.
  - `renderWorkload({rows, unassigned, sort, search, expanded: string[], now}) -> string`.
    Rows have `data-action="toggle-workload-row" data-row-id`; headers
    `data-action="sort-workload" data-key`; search input `#workload-search`; per-case
    `data-action="open-case" data-case-id` (reuse the pool's open action name if it differs),
    and `data-action="open-assign" data-case-id data-slot`.
  - `assignDrawerBody({record, slot, result, search, ui}) -> string`, where `result` is
    `candidates(...)`. Each Choose button has `data-action="assign-case" data-person-id`.
  - The history sentence for `ASSIGN_CASE`: `historySentence(entry, peopleById?)` or names
    pre-resolved on the entry (`entry.detail.personName`, `entry.detail.previousName`, set
    where `actorName` is set). Pick whichever matches how `actorName` is filled today, and
    say which in the report.

- [ ] **Step 1: Write failing view tests.**
  - The Workload tab only when `workload` is true.
  - The Unassigned row is first, even when sorted by name ascending and when search matches
    nothing.
  - An expanded row shows `VT-ABCD-EFGH`, `Lena Ortiz`, `Filing in progress (preparing)`,
    `Preparer`, Open, Reassign.
  - The breakdown bar has text such as `"3 preparing, 1 in review"` for screen readers.
  - The Not cleared tag.
  - No hours column, and no "Hours" text anywhere.
  - The drawer: the case # and name in the heading, the "Current" mark with no Choose, the
    note `"1 person who prepared this case isn't shown."` (and the plural `"2 people who
    prepared this case aren't shown."`), and search filtering.
  - The history sentences: `"Sam Lee assigned Jordan Park as preparer (was Alex Chen)."` and
    `"Sam Lee assigned Riley Quinn as reviewer."`
  - The Workload footnote: `"Taxpayer names show here because only admins can open the
    Workload."`
- [ ] **Step 2: Run** them and see them fail.
- [ ] **Step 3: Implement.** Follow `renderRoster`'s table markup (`board-table
  people-table`) and the existing drawer frame (`office-drawer`). Column headers are
  `<button>`s inside `<th aria-sort>`.
- [ ] **Step 4: Run** `timeout 600 npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `"Workload: tab, table, drawer and history sentence (#139)"`

### Task 6: Controller, app wiring and styles

**Files:**
- Modify: `src/controller.mjs`, `src/app.mjs`, `src/styles.css`
- Test: `tests/controller.test.mjs` (and `tests/shell.test.mjs` if the sidebar's tests live there)

**Interfaces:**
- Consumes: Task 5's data-actions; Task 4's `candidates`; `store.listVolunteers()`;
  `state.cases`, `state.people`; `ceilingAdmin`, `awaitingClearance` and `isAdmin` (effective).
- Produces:
  - state `volunteerTab: "roster"|"workload"`, `workload: {sort, search, expanded}`;
  - `controller.setVolunteerTab(tab)`, `controller.setWorkloadView(patch)`;
  - `controller.openAssign(caseId, slot)`, which sets `dialog = "assign"` and
    `dialogContext = {caseId, slot, search}`;
  - `controller.assignCase(personId)`, which dispatches `{type:"ASSIGN_CASE", caseId,
    expectedRevision: <the listed case's revision>, payload:{slot, personId}}` through the
    same `dispatch` path as other actions, without needing the case open.

- [ ] **Step 1: Write failing controller tests.**
  - `setVolunteerTab("workload")` is refused (it stays on the roster) for an uncleared
    ceiling admin, and is allowed for a cleared effective admin.
  - `assignCase` sends the listed case's revision and payload.
  - On success: the dialog closes, cases and volunteers are re-read, and a success toast
    `"Assigned <name> as preparer."`.
  - On `CONFLICT`, `INELIGIBLE` or `SELF_REVIEW`: the drawer stays open with the existing
    error rendering.
  - A Realtime case change refreshes the Workload counts (the existing case refresh already
    re-reads `listCases`; assert that the Workload is redrawn from the new `state.cases`).
- [ ] **Step 2: Run** them and see them fail.
- [ ] **Step 3: Implement.** Opening Volunteers on the Workload tab loads volunteers (as the
  Roster does) and uses `state.cases`. `app.mjs` maps the data-actions to the controller and
  the search input to `setWorkloadView({search})`. Styles: tabs, the table, the bar
  (Preparing and Review segments, with text contrast in light and dark), and the drawer list.
- [ ] **Step 4: Run** `timeout 600 npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `"Workload: controller, wiring and styles (#139)"`

### Task 7: Docs and checks

**Files:**
- Modify: `docs/developer/` pages that describe the Volunteers page, the case actions and
  the production roadmap's "Release and reassignment" line. Find them with
  `grep -rln "Roster\|SAVE_PREPARER_FIELDS\|reassign" docs/developer`.

- [ ] **Step 1: Update those docs** to describe the Workload, `ASSIGN_CASE` and the
  roadmap's reassignment (now built). Do not touch `docs/superpowers/`.
- [ ] **Step 2: Run the local checks:** `timeout 600 npm test`,
  `timeout 300 npm run build:hant -- --check`, `timeout 300 npx openspec validate --all`.
  Expected: all pass.
- [ ] **Step 3: Push the branch and run CI:** `git push -u origin add-volunteer-workload`
  then `gh workflow run ci.yml --ref add-volunteer-workload`. Wait in bounded steps
  (`gh run watch` under `timeout 540`, repeated). Expected: `checks`, `database`, `sign-in`
  and both `story` legs pass. On a failure, read the failing job's log first and fix the
  cause. A database failure in `tests/database-workload.mjs` is a real failure, not flake.
- [ ] **Step 4: Commit** the docs `"Workload: developer docs (#139)"` (before Step 3's push,
  if they changed).
