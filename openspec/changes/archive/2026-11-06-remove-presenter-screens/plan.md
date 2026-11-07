# Remove the presenter screens: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A presenter who signs in sees one plain "This account is no longer used" screen. The presenter panel, the persona picker, `selectedPersonId` and the "Class workspace" wording are gone from the app. Every browser-story step that used them is replaced one for one.

**Architecture:**
- **One switch.** `isStaffWindow` and the controller's `staffWindow()` become staff-only, which takes a presenter out of every staff screen. The controller's `load()` stops after the principal for a presenter, and `app.mjs` renders `views.presenterScreen`.
- **Removal.** With no staff window for a presenter, the presenter panel, persona state and handlers become unreachable, and they are removed with their unit tests.
- **The story** replaces each presenter step.

There's no database change.

**Tech Stack:** plain ES-module browser app (`src/*.mjs`), `node:test` unit tests, Playwright browser story (`tests/browser.mjs`), local Supabase test stack.

**Spec:**
- `openspec/changes/remove-presenter-screens/specs/` (sign-in, staff-case-work, case-lifecycle, screen-states, demo-tools);
- design: `openspec/changes/remove-presenter-screens/design.md` (D1–D8);
- decision log: `openspec/changes/remove-presenter-screens/brainstorm.md`.

## Global Constraints

- **The presenter screen copy, verbatim:**
  - heading: "This account is no longer used";
  - text: "Presenter mode has been removed. Ask your site coordinator for a staff account.";
  - button: "Sign out", using the existing `sign-out` action.

  English only, with no `client-text` entry.
- **No change** under `supabase/`, `tools/` or `server.mjs`. `src/supabase-store.mjs` keeps its `presenter` read-table entry until #136.
- **The database's** reset, checkpoint and sample-case functions stay. Nothing in the app calls them.
- **Client-facing text kept for #135:** the "Sample cases were reset." notices stay.
- **Staff actions** always send `p_person_id: null`.
- **The browser story** stays at **83** tests, with every presenter step replaced as in design D6. If a run is under the 900 s limit and an order goes over, stop and show the user the per-step timings. Trim nothing. Never change `PERMUTATION_TIMEOUT_MS`.
- **Unit tests:**
  - tests of removed code are removed;
  - tests that used a presenter principal for shared staff behaviour are converted to `access: "staff"`;
  - every removed test is listed, with the code it tested, in the task's report;
  - the unit count before (1509 on main `341cdda`) and after is recorded.
- **Text and data:** fictional data only, no email address in output, LF line endings.
- **Commits:** each ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A presenter tab reloaded on a case page**, with `selectedCaseId` and `screen: "case"` restored from session storage. It must show the plain screen and load nothing, not the case. Test in Task 1.
2. **A realtime change in the workspace while a presenter's plain screen is open.** It must not redraw into data, because nothing is subscribed. Test in Task 1.
3. **A `selectedPersonId` left in session storage** by an earlier presenter tab, then the same tab signing in as staff or as a client. It is ignored for both. Test in Task 3.
4. **A staff action's payload after the persona code goes.** It still carries the staff account's own person and `p_person_id: null`. Test in Task 3.
5. **The office's Add a case fill pill for a staff admin with the demo-tools switch on.** It is still there after the panel's copy of the fill goes. Test in Task 2.

---

### Task 1: A presenter is not a staff window, and gets the plain screen

**Files:**
- Modify: `src/contracts.mjs` (`isStaffWindow`, about line 134)
- Modify: `src/controller.mjs` (`staffWindow`, about line 752; `load()`, about lines 1004–1071)
- Modify: `src/views.mjs` (add `presenterScreen`)
- Modify: `src/app.mjs` (the render switch, about line 220)
- Test: `tests/shell.test.mjs`, `tests/controller.test.mjs`

**Interfaces:**
- Produces:
  - `isStaffWindow(principal) → boolean`, true only for `access === "staff"`;
  - `views.presenterScreen(state) → string`;
  - the controller's `load()` for a presenter: it sets `state.principal`, sets `state.screen = "presenter"`, loads nothing, doesn't subscribe and doesn't persist the window's place, then calls `show()`.

- [ ] **Step 0:** Run `npm test` and note `ℹ tests` (expected 1509) as the before count in the report.
- [ ] **Step 1: Write the failing tests:**
  - `tests/shell.test.mjs`, "a presenter is not a staff window": `isStaffWindow({ access: "presenter" }) === false`, `isStaffWindow({ access: "staff" }) === true`, `isStaffWindow({ access: "applicant" }) === false`.
  - `tests/shell.test.mjs`, "the presenter screen says the account is no longer used":
    - `presenterScreen({ principal: { access: "presenter" } })` contains "This account is no longer used" and "Presenter mode has been removed. Ask your site coordinator for a staff account.";
    - it has exactly one `data-action`, `"sign-out"`;
    - it contains none of `select-person`, `open-reset-fixtures`, `open-checkpoint`, `Class workspace`, `board-row`.
  - `tests/controller.test.mjs`, "a presenter's window loads nothing" (Review Focus 1, 2). With the existing fake store and fake realtime and a presenter principal, start the controller with session storage restored to `{ screen: "case", selectedCaseId: <id> }`, and assert:
    - `state.screen === "presenter"`;
    - `listCases`, `listPeople`, `getCase`, the assistance read and the workspace read were never called;
    - no realtime subscription was opened;
    - a realtime event delivered afterwards changes nothing in the state.
- [ ] **Step 2: Run them to see them fail.** Run `node --test tests/shell.test.mjs tests/controller.test.mjs`. Expected: FAIL. `presenterScreen` is not exported, and `isStaffWindow` is true for a presenter.
- [ ] **Step 3: Implement.**
  - `isStaffWindow` and `staffWindow()` become staff-only.
  - In `load()`, right after `state.principal = principal`, a presenter branch: `state.screen = "presenter"`, `state.error = null`, `show()`, return.
  - `presenterScreen` uses the narrow centred layout of `noAccessScreen`, with the Global Constraints copy and `button(..., "sign-out", "text")`.
  - In `app.mjs`'s render, before the `isStaffWindow` line: `if (state.principal?.access === "presenter") return views.presenterScreen(state);`.
- [ ] **Step 4: Run them to see them pass.** Run the same command. Then run `npm test`. Some presenter-principal tests will now fail; they are Tasks 2 and 3's to remove or convert. List them in the report, and leave them unchanged in this task.
- [ ] **Step 5: Commit** "Presenter: a presenter gets the plain screen and is no longer a staff window".

### Task 2: The presenter panel and its handlers go

**Files:**
- Delete: `src/presenter-views.mjs`, `tests/presenter.test.mjs`
- Modify:
  - `src/views.mjs`: the panel placement (about lines 227–255), the sidebar's "Acting as" block (about lines 185–205), the presenter branch of the staff frame (about line 143), and the panel's import (about line 33);
  - `src/app.mjs`: the `select-person`, `open-reset-fixtures`, `confirm-reset-fixtures`, `open-checkpoint` and `confirm-checkpoint` handlers (about line 1971 on), and the panel's `fill-assisted-intake` placement;
  - `src/ui.mjs`: `confirmBody` loses `note.inForm`;
  - `src/styles.css`: remove `.presenter-panel` and `.persona-*` (about line 2350);
  - `tests/shell.test.mjs`, `tests/office-views.test.mjs`, `tests/confirm-dialogs.test.mjs`, `tests/ui.test.mjs`, `tests/demo-fill.test.mjs`, wherever they test the removed pieces.

**Interfaces:**
- Consumes: Task 1's `isStaffWindow`.
- Produces: a staff frame with no presenter branch, and `confirmBody({ before, lead, note, form, confirm, keep })` with no `inForm`.

- [ ] **Step 1: Write the failing tests:**
  - `tests/shell.test.mjs`, "no staff screen offers a persona, a reset or a checkpoint": `staffScreen` for a staff principal on the board and on a case page contains none of `select-person`, `open-reset-fixtures`, `open-checkpoint`, `presenter-panel` or `Class workspace`.
  - `tests/ui.test.mjs`, "a confirmation note always comes before the form": `confirmBody({ lead, note: { icon: "info", html: "n" }, form: { fields: "<input>" }, confirm: "<button>", keep: "Keep" })` puts the note's `info-note` before `<form`.
  - `tests/office-views.test.mjs`, "Add a case keeps its fill pill for a staff admin with the switch" (Review Focus 5): the Add a case body for a staff admin with `demoTools: true` contains `data-action="fill-assisted-intake"`.
- [ ] **Step 2: Run them to see them fail.** Expected: the first test fails while `views.mjs` still renders the panel or the sidebar persona block for any path. If it already passes, because Task 1 made those paths unreachable, record that in the report and go on.
- [ ] **Step 3: Remove the code listed in Files.** Grep `src/` for `presenter-views`, `select-person`, `reset-fixtures`, `checkpoint`, `persona-` and `inForm`. Only `src/supabase-store.mjs` and `src/client-text.mjs` (Task 3) may still mention them.
- [ ] **Step 4: Unit tests of removed code.**
  - Remove `tests/presenter.test.mjs`, and every test elsewhere that tests the panel, the picker, the reset and checkpoint dialog bodies or `inForm`.
  - Convert to `access: "staff"` the tests that use a presenter principal only for shared staff behaviour.
  - Record each removed test by file and name, with the removed code it tested.
- [ ] **Step 5:** Run `npm test`. Expected: all pass, except the controller and window-state persona tests Task 3 handles. List those.
- [ ] **Step 6: Commit** "Presenter: remove the presenter panel, its handlers and the inside-the-form note".

### Task 3: `selectedPersonId` goes from the controller and the window state

**Files:**
- Modify:
  - `src/controller.mjs`: `selectedPersonId` state (about line 343), persistence and restore (about lines 479–509), the linked-persona drop (about line 966), `selectPerson` (about line 1311), the persona sent with actions (about line 2169), `presenter()`, `requirePresenter`, the reset and checkpoint requests (about lines 2749–2830), the presenter-only workspace-row load (`loadWorkspace`, about line 773), and the `selectedPersonId` exposed in the view state (about line 2900);
  - `src/window-state.mjs`: about lines 67 and 131;
  - `src/client-text.mjs`: the 简体 entries listed in design D3, each only if its sentence no longer appears in `src/`;
  - `src/zh-hant.mjs`, regenerated.
- Test: `tests/controller.test.mjs`, `tests/window-state.test.mjs`, `tests/client-language.test.mjs`, `tests/hant.test.mjs` (wherever they pin removed text).

**Interfaces:**
- Consumes: Task 1's presenter branch in `load()`.
- Produces: no `selectedPersonId` anywhere in `src/`, and `windowState` restore that never returns `selectedPersonId`.

- [ ] **Step 1: Write the failing tests:**
  - `tests/window-state.test.mjs`, "a stored persona is ignored for every access" (Review Focus 3): with storage holding `{ selectedPersonId: "p1", screen: "board" }`, restore for `"staff"` and for `"applicant"` returns no `selectedPersonId`, and save never writes one.
  - `tests/controller.test.mjs`, "a staff action sends no persona" (Review Focus 4): a staff principal's `CLAIM_PREPARATION` reaches the fake store with `personId === null`, and the view state has no `selectedPersonId` key.
  - `tests/controller.test.mjs`, "screening starts for an admin staff member only" (case-lifecycle):
    - a staff principal whose person has `admin` opens a case at Request sent, and the fake store receives one `START_SCREENING`;
    - a staff principal whose person has only `prepare` opens the same case, and none is sent.
- [ ] **Step 2: Run them to see them fail.** Run `node --test tests/window-state.test.mjs tests/controller.test.mjs`. Expected: FAIL. Restore still returns the key for an applicant, and the view state still has the key.
- [ ] **Step 3: Remove the code listed in Files.** Then remove the client-text entries whose sentence is gone. Check each with `grep -rn "<sentence>" src/ --include=*.mjs`, excluding `client-text.mjs` and `zh-hant.mjs`. Run `npm run build:hant` and commit `src/zh-hant.mjs` with it.
- [ ] **Step 4: Unit tests.** Remove the persona tests of removed code, and convert shared-behaviour presenter tests to staff. Record both lists as in Task 2.
- [ ] **Step 5:** Run `npm test` and `npm run build:hant -- --check`. Expected: all pass, and the check is clean. Record the unit count.
- [ ] **Step 6: Commit** "Presenter: remove the chosen persona from the controller and the window state".

### Task 4: The browser story replaces each presenter step

**Files:**
- Modify: `tests/browser.mjs`, `tests/support/story-pages.mjs`

**Interfaces:**
- Consumes: the seed (`resolveSeedTargets`, `seedCases` from `tools/admin/seed-cases.mjs`), the role windows and `use(role, reference?)` already in the story, and Task 1's plain screen.

- [ ] **Step 1: Replace the steps.** Make each replacement in design D6 one for one, keeping every phase's other checks. Don't add or remove a phase. The count stays 83.
- [ ] **Step 2: The moved checks:**
  - The seed step expects the Preparer's board to count **0** first.
  - The toast-outside-inert check runs right after the Reviewer's "Ask the preparer for corrections" dialog closes, on the toast "The preparer was asked for corrections.".
  - The version-2 assertion and the `staff-board-eight-cases` screenshot move into the seed step.
  - "A claim unlocks the phone…" uses the second seed run's `preparation_ready` case.
  - The help-request step expects one help row.
- [ ] **Step 3: Remove from `story-pages.mjs`** the helpers no remaining step uses: `choosePersona`, `readPersona`, `resetSampleCases` and `readFixtureIndicator`, each after a grep shows no caller.
- [ ] **Step 4: Run the story.** Run `node --check tests/browser.mjs` and `npm test`. Then run `npm run test:browser` once.
  - Run it alone: first check that no other `node` test process is running and that the stack's containers are up.
  - Expected: `ℹ tests 83`, `ℹ pass 83`.
  - If an order times out while the limit is 900 s, stop and report both orders' `evidence.timings`. Trim nothing.
  - If a failure looks unrelated, run once more to tell a flake from a defect.
- [ ] **Step 5: Commit** "Browser story: replace the presenter steps (#134)".

### Task 5: Docs

**Files:**
- Modify: `docs/setup.md`, `docs/demo-script.md`, `docs/developer/frontend.md`, `docs/developer/backend.md`

- [ ] **Step 1: `docs/setup.md`:**
  - "Use them" signs in as `site-coordinator@example.org`;
  - the presenter account is described as showing "This account is no longer used";
  - "Reset sample cases" is described as gone from the screens, with `npm run seed:local` for rehearsal cases;
  - the browser-story row and run note get Task 4's run.
- [ ] **Step 2: `docs/demo-script.md`:** one note at the top. It says the script still describes presenter mode, which has been removed, and that the rewrite for the role accounts is #137.
- [ ] **Step 3: `docs/developer/frontend.md` and `backend.md`:** remove or reword the presenter panel, persona picker and `selectedPersonId` rows. `backend.md` keeps the database's reset and checkpoint functions, marked as having no app caller until #135.
- [ ] **Step 4: Commit** "Docs: the presenter screens are gone (#134)".

### Task 6: Verification

- [ ] **Step 1:** `npm test`. Expected: all pass. Record the before count (Task 1 step 0), the after count, and the list of removed tests with the code each tested.
- [ ] **Step 2:** `npm run build:hant -- --check`. Expected: exit 0.
- [ ] **Step 3:** `npm run test:auth-browser`, alone on the stack. Expected: all pass.
- [ ] **Step 4:** If Task 4's browser run passed on the final code commit, use it. Otherwise run `npm run test:browser` again, alone, under the same rules. Expected: 83/83.
- [ ] **Step 5:** `npx openspec validate --all`. Expected: all valid.
- [ ] **Step 6:** Tick every box in `openspec/changes/remove-presenter-screens/tasks.md` that this run completed, and commit "Presenter screens: tasks done".
