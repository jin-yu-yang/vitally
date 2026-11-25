# Workspace Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff with both an office capability and `prepare`/`review` switch between Office and Cases from the top of the sidebar, Intakers land in a filtered office, and nothing in the database changes.

**Architecture:**
- One pure rule in `src/contracts.mjs` (`workspaceSide`) replaces `isAdmin` as the R55 boolean in the view and in the controller.
- The controller keeps the side drawn on screen in `state.workspaceSide`. It remembers the last pressed side per user id in localStorage (`src/workspace-side.mjs`), and normalises the side inside `recheckClearance`.
- The two existing workspaces are drawn as they are. Only the hint on the office case page and the Intaker's Follow-ups filter are new rendering.

**Tech Stack:** plain ES modules, `node --test`, Playwright (`tests/browser.mjs`), and Supabase (untouched).

**Spec:** `openspec/changes/add-workspace-switch/`. Read `design.md` (D1–D10) and `specs/staff-workspaces`, `specs/staff-case-work`, `specs/case-lifecycle` and `specs/volunteer-clearance`. `brainstorm.md` holds the reasons.

## Global Constraints

- **Front end only.** No migration, RPC, read rule or realtime change. If any task seems to need one, stop and report BLOCKED. Do not choose a migration number.
- **Never start Docker, `supabase start` or the local stack.** The database, sign-in and story suites run only in the PR's CI.
- **Every command gets a timeout.** Use `timeout 600 npm test` or the narrower `timeout 300 node --test tests/<file>.test.mjs`. Never run a foreground server. If a command needs an approval you cannot get, report BLOCKED.
- **Fictional data only** in tests and fixtures.
- **Staff screens are English.** No `src/client-text.mjs` change, so no `build:hant`.
- **Capability sets, verbatim:**
  - office = `["admin", "followup", "assist", "receive_documents"]`
  - Cases = `["prepare", "review"]`
- **Storage:** the key is `vitally.workspace-side:<userId>`. The values are only `"office"` or `"cases"`. The default is `"office"`. It is never cleared at sign-out.
- **Exact copy:**
  - the group `aria-label="Workspace"`, with the buttons "Office" and "Cases";
  - the hints "You can claim this case — switch to Cases", "You can review this case — switch to Cases", "You're preparing this case — switch to Cases" and "You're reviewing this case — switch to Cases", with the button "Switch to Cases";
  - the Intaker's empty state: "Nothing waiting for you. Help requests and documents to receive show here."
- **Commit messages** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A staff window drawn before its own `people` entry loads** (person null) must draw what it drew before: the Work board, no switch, no flash of Office. This is pinned in Task 1 (`workspaceSide` with a null person) and Task 3 (`staffScreen` with an empty `people`).
2. **A stored `"cases"` for a person who now has only the office side** must draw Office and must keep the stored value. This is pinned in Task 4 (restore) and Task 6 (recheck).
3. **Blocked or throwing localStorage** at sign-in, at a press and on reload must never throw, and must draw Office. This is pinned in Task 2 and Task 4.
4. **A stale `officeKind` filter** (for example `"signing"`) saved by an admin session in the same window, then read by an Intaker, must read as all and not as an empty list. This is pinned in Task 5.
5. **A second user in the same browser** must not inherit the first user's side, because the key is per user id. This is pinned in Task 2 and Task 4.

---

### Task 1: The side rule in `contracts.mjs`

**Files:**
- Modify: `src/contracts.mjs` (beside `isStaffWindow`, line ~133)
- Test: `tests/workspace-switch.test.mjs` (new)

**Interfaces:**
- Produces:
  - `OFFICE_CAPABILITIES: readonly string[]`, `CASES_CAPABILITIES: readonly string[]`
  - `hasOfficeSide(person): boolean`, `hasCasesSide(person): boolean`, which read `person?.capabilities`, an array
  - `hasWorkspaceSwitch(principal, person): boolean`
  - `workspaceSide(principal, person, preferred): "office" | "cases"`

- [ ] **Step 1: Write the failing tests** `"workspaceSide follows the person's sides"`. Build each person from `ROLE_CAPABILITIES` (`src/volunteer-workload.mjs`), with `staff = { access: "staff" }`.
  - Admin → `"office"` for any `preferred`
  - Intaker → `"office"`
  - Preparer, Reviewer and Greeter (`[]`) → `"cases"`
  - Admin+Reviewer → `"office"` for `undefined` / `"office"` / `"junk"`, and `"cases"` for `"cases"`
  - Intaker+Preparer → as Admin+Reviewer
  - a `null` person → `"cases"`

  Also `"hasWorkspaceSwitch needs staff access and both sides"`: true only for Admin+Reviewer and Intaker+Preparer with `staff`; false for `{ access: "applicant" }` with Admin+Reviewer; false for a null person.
- [ ] **Step 2: Run** `timeout 300 node --test tests/workspace-switch.test.mjs`. Expected: FAIL (exports missing).
- [ ] **Step 3: Implement** the four functions and two frozen arrays (design D1).
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `git add src/contracts.mjs tests/workspace-switch.test.mjs && git commit -m "Workspace switch: the side rule in contracts.mjs (#104)"`

### Task 2: The remembered side

**Files:**
- Create: `src/workspace-side.mjs`
- Test: `tests/workspace-side.test.mjs` (new)

**Interfaces:**
- Produces:
  - `WORKSPACE_SIDE_PREFIX = "vitally.workspace-side:"`
  - `readWorkspaceSide(userId, { storage }): "office" | "cases" | null`
  - `writeWorkspaceSide(userId, side, { storage }): void`. It ignores a side that isn't one of the two, and a missing `userId`.

- [ ] **Step 1: Write the failing tests**, with a fake storage (a Map behind `getItem` / `setItem`):
  - `"a side round-trips per user"`: write `"cases"` for `u1`; `u1` reads `"cases"`; `u2` reads `null`.
  - `"anything else reads as nothing"`: a stored `"admin"` reads `null`.
  - `"throwing storage never throws"`: `getItem` and `setItem` throw; the read returns `null` and the write returns `undefined`.
  - `"no storage"`: `{ storage: null }` reads `null`.
- [ ] **Step 2: Run** `timeout 300 node --test tests/workspace-side.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** with try/catch around each storage call, as `readLanguage` / `writeLanguage` in `src/language.mjs` do.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `git add src/workspace-side.mjs tests/workspace-side.test.mjs && git commit -m "Workspace switch: remember the side per user in localStorage (#104)"`

### Task 3: The staff frame and the switch in `views.mjs`

**Files:**
- Modify: `src/views.mjs`:
  - `isAdmin` (line ~213) stays, for capability uses only;
  - `staffSidebar` (line ~222);
  - `staffScreen` (line ~433): `office` becomes `side === "office"`, then the `allowed` redirect, the case page frame, the home frame, and `rosterPage(state, { workload: isAdmin(person) })` at line ~540.
- Modify: `src/styles.css` (the `.workspace-switch` group, using the existing sidebar button tokens)
- Test: `tests/workspace-switch.test.mjs`

**Interfaces:**
- Consumes: `workspaceSide` and `hasWorkspaceSwitch` (Task 1).
- Produces: the views read `state.workspaceSide` (`"office" | "cases" | undefined`). The switch buttons carry `data-action="set-workspace-side" data-side="office|cases"`. `staffSidebar`'s options gain `{ side, canSwitch }`. The `office` positional argument still means "draw the office navigation".

- [ ] **Step 1: Write the failing tests** with `staffScreen(state)`. Build `state` with `principal: { access: "staff", personId: "p1", clearance: <cleared> }`, using the cleared-clearance shape from `tests/shell.test.mjs`, and `people: [{ id: "p1", capabilities }]`.
  - `"an admin-reviewer defaults to Office with the switch"`: the HTML has `role="group" aria-label="Workspace"`, an Office button with `aria-pressed="true"`, "Follow-ups" and "All cases".
  - `"workspaceSide cases draws the work board"`: with `workspaceSide: "cases"`, the HTML has "Work board" and Cases `aria-pressed="true"`, and has no "All cases" link.
  - `"an Intaker gets Follow-ups and no switch"`: has "Follow-ups", has no `aria-label="Workspace"` and has no `data-action="open-cases"`.
  - `"one side only has no switch"`: for Admin, Reviewer and Greeter, has no `aria-label="Workspace"`, and the frame is unchanged from today: Follow-ups for Admin, Work board otherwise.
  - `"a person not yet loaded draws the work board"`: with `people: []`, the HTML has "Work board" and no switch.
  - `"the setup screen has no switch"`: with an uncleared Admin+Reviewer clearance, there is no `aria-label="Workspace"`.
  - `"Workload follows admin on either side"`: an Admin+Reviewer on `screen: "office-volunteers"` with `workspaceSide: "cases"` gets the Workload tab.
  - `"a stored office screen on Cases falls back to the board"`: `screen: "office-cases"` with `workspaceSide: "cases"` draws the Work board.
  - `"one record draws both case pages"`: `screen: "staff-case"`, with `savedCase` taken from an existing staff-shaped fixture in `tests/staff-views.test.mjs`. The Office side has "OFFICE WORKSPACE". The Cases side has "VOLUNTEER WORKSPACE" and no "Staff sections are not loaded".
- [ ] **Step 2: Run** `timeout 300 node --test tests/workspace-switch.test.mjs`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** design D4 and D5. The group goes between `.sidebar-brand` and `<nav>`, only on the cleared path. The Follow-ups "Add a case" action shows only for `isAdmin(person)`.
- [ ] **Step 4: Run** `timeout 600 npm test`. Expected: PASS, and the existing shell, staff-views and admin-views tests are unchanged.
- [ ] **Step 5: Commit** `git commit -am "Workspace switch: the sidebar switch and the staff frame follow the side (#104)"` (add the test file if it's new).

### Task 4: The controller's side, sign-in, restore and pressing the switch

**Files:**
- Modify: `src/controller.mjs`:
  - initial state, beside `sidebarOpen`;
  - sign-in / `restoreSession` (line ~705);
  - `forgetUser` (line ~3165), which must not touch the stored side;
  - a new `setWorkspaceSide`, exported on the controller object beside `toggleSidebar` (line ~3426);
  - `actingAdmin` (line ~3500);
  - `canSeeWorkload` (line ~1490).
- Modify: `src/app.mjs`: in `runNavigation`, `case "set-workspace-side"` with `leaveAddCaseFirst("set-workspace-side", target)`. Add an `EXITS["set-workspace-side"]` that reads the side from `state.dialogContext.side`. `leaveAddCaseFirst` / `openDialog` pass `{ to: action, side: target.dataset.side }`.
- Test: `tests/controller.test.mjs`, using `build({ localStorage: fakeSession(...) })`.

**Interfaces:**
- Consumes: `readWorkspaceSide` / `writeWorkspaceSide` (Task 2) and `workspaceSide` (Task 1).
- Produces:
  - `controller.setWorkspaceSide(side: "office" | "cases"): Promise<void>`
  - `state.workspaceSide`, always `"office"` or `"cases"` once a staff principal is set.

- [ ] **Step 1: Write the failing tests:**
  - `"sign-in uses the remembered side"`: localStorage has `vitally.workspace-side:<userId>` = `"cases"`; after load, `getState().workspaceSide === "cases"`.
  - `"nothing remembered opens Office"`, and also with a localStorage whose `getItem` throws.
  - `"sign-out keeps the remembered side"`: after `signOut`, the key is still there.
  - `"a second user does not inherit the side"`.
  - `"pressing Cases on a case page keeps the case and resets the tab"`: `screen: "staff-case"` and `caseTab: "contacts"` give `screen: "staff-case"`, the same `selectedCaseId`, `caseTab: "overview"`, and storage `"cases"`.
  - `"pressing Cases on All cases lands on the board"`: `office-cases` → `staff`.
  - `"pressing Cases on Volunteers stays"`.
  - `"pressing the pressed side does nothing"`: no render and no write.
  - `"an admin in Cases opening a Received case starts nothing; switching to Office starts screening"`: the fake store records one `START_SCREENING` only after `setWorkspaceSide("office")`.
  - `"an Intaker never starts screening"`.
  - `"the Workload is readable on Cases for an admin"`: `canSeeWorkload` gates the Workload read, which fires.
- [ ] **Step 2: Run** `timeout 600 node --test tests/controller.test.mjs`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** design D2, D3, D6 and D9. `setWorkspaceSide` returns early when the side wouldn't change, or when `hasWorkspaceSwitch` is false. It writes storage, sets `caseTab = "overview"` on `staff-case`, maps `office-cases` / `office-add-case` → `staff`, calls `persistSession()` and `show(true)`, and then `await startScreeningIfDue()`.
- [ ] **Step 4: Run** `timeout 600 npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "Workspace switch: the controller remembers, switches and lands (#104)"`

### Task 5: The Intaker's Follow-ups

**Files:**
- Modify: `src/office-views.mjs`:
  - `followupQueue` (line ~138) or a filter applied in `renderFollowups` (line ~377);
  - `officeFilters` and the kind chips;
  - the empty state (line ~424).
- Test: `tests/office-views.test.mjs`; add the new empty state to `tests/empty-states.states.mjs` if it lists Follow-ups states.

**Interfaces:**
- Consumes: `person` (from `ui.person`, with `capabilities` and `id`).
- Produces: `intakerRows(rows, person)`, or an equivalent filter that is exported for testing. It returns the rows a person without `admin` may act on (design D8).

- [ ] **Step 1: Write the failing tests:**
  - `"an Intaker sees open help and their own"`: three help items (`open`, `assigned` to `p1`, `assigned` to `p2`) give two rows.
  - `"an Intaker sees office-owned document waits only"`: two `awaiting_documents` cases with `openRequests: 1`, one with `ownerUserId: null` and one with `"u9"`, give one row. A case with `openRequests: 0` gives none.
  - `"an Intaker without assist sees no help rows"`, and the same for `receive_documents` with documents.
  - `"an Intaker's kind chips are help and documents only"`.
  - `"a stale officeKind reads as all"`: `filters: { officeKind: "signing" }` shows every visible row, and no "Nothing here matches".
  - `"an Intaker's empty queue says what fills it"`: the exact copy, with the check icon, while a `received` and a `screening` case exist.
  - `"no Add a case or season-end close for an Intaker"`.
  - `"the admin queue is unchanged"`: the existing admin fixtures give the same rows as before.
- [ ] **Step 2: Run** `timeout 300 node --test tests/office-views.test.mjs tests/empty-states.test.mjs`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** design D8, using only `openRequests`, `ownerUserId`, `status` and `assigneeId` (no new read).
- [ ] **Step 4: Run** `timeout 600 npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "Workspace switch: an Intaker's Follow-ups lists only what they can act on (#104)"`

### Task 6: The hint on the office case page, and capability changes

**Files:**
- Modify: `src/admin-views.mjs`, `renderAdminCase` (line ~1175): the hint first in the Overview panel list.
- Modify: `src/views.mjs`: pass `canSwitch: hasWorkspaceSwitch(state.principal, person)` in the case page's `ui`.
- Modify: `src/controller.mjs`, `recheckClearance` (line ~2970, the `now && was` branch): normalise `state.workspaceSide` (design D10).
- Test: `tests/admin-views.test.mjs`, `tests/controller.test.mjs`

**Interfaces:**
- Consumes: `staffEligibility(record, person)` and its fields `claimPreparation`, `claimReview`, `preparationWork` and `reviewDecision` (each `{ allowed }`); `workspaceSide` (Task 1).
- Produces: the hint's button uses the same `data-action="set-workspace-side" data-side="cases"` as Task 3.

- [ ] **Step 1: Write the failing tests:**
  - admin-views:
    - `"the hint names the first allowed work"`: one test per line, built from a `review_ready` case with no reviewer (review), a `preparation_ready` case (claim), the person as `preparerId` in `preparing` (preparing), and the person as `reviewerId` in `reviewing` (reviewing).
    - `"no hint without canSwitch"`.
    - `"no hint when nothing is allowed"` (`screening`).
    - `"at most one line"`.
  - controller:
    - `"gaining Admin keeps the board and the storage"`: a Preparer on `staff` with `workspaceSide: "cases"` gains `admin` on the re-read. The result is still `staff` and `"cases"`, and no storage write.
    - `"losing the current side lands on the other"`: Admin+Reviewer on `"cases"` loses `review`, which gives `workspaceSide: "office"`, and storage still `"cases"`.
    - `"losing the other side keeps the screen"`.
    - `"a reload after gaining Admin with nothing stored opens Office"`.
    - `"losing Admin on All cases still goes home"` (the existing test stays green).
- [ ] **Step 2: Run** `timeout 600 node --test tests/admin-views.test.mjs tests/controller.test.mjs`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** design D7 and D10. The hint is a `<p class="field-note" role="note">` line plus the button, ahead of `origin`. The normalisation runs before the `sameStanding` early return.
- [ ] **Step 4: Run** `timeout 600 npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "Workspace switch: the hint toward Cases and capability changes (#104)"`

### Task 7: The browser walk, docs and checks

**Files:**
- Modify: `tests/browser.mjs`: a new top-level `test("one person switches between Office and Cases", { timeout: 300_000 }, ...)` at the end of the file, modelled on `"removing a volunteer from this season's roster"` (line ~11494). It uses its own `createBrowserFixture()`, which creates its own workspace. It is not in the story.
- Modify: `docs/developer/frontend.md` and `docs/developer/architecture.md`, at the R55 / office workspace wording.
- Modify: `openspec/changes/add-workspace-switch/tasks.md` (tick the tasks).

- [ ] **Step 1: If PR #278 has merged**, run `git fetch origin && git merge origin/main`, then check two things. First, `grep -n "Check" src/views.mjs src/*check-in*.mjs`: the test's selectors must match none of the check-in strip's buttons. Second, the switch's CSS must leave the fixed `.sidebar-toggle` clear.
- [ ] **Step 2: Write the test.**
  - Set up an Admin+Reviewer (`db.staff({ key: "workspace_switch", name: "Rowan Pike", capabilities: [admin set + "prepare", "review"] })`), an Intaker (`"Ines Ford"`, `["receive_documents", "assist"]`), and one `review_ready` case that Rowan didn't prepare (use the seed helper `seedCases`, as other blocks do).
  - Walk:
    1. Rowan sees Office pressed and Follow-ups.
    2. Rowan opens the case and sees "You can review this case — switch to Cases".
    3. Rowan presses Switch to Cases, and the case page shows Claim review.
    4. Rowan claims it, and `participantCount` / the stage shows `reviewing`.
    5. Rowan presses Office and sees Follow-ups and All cases.
    6. Rowan presses Cases and reloads, and the Work board shows with Cases pressed.
    7. Ines, in a second context, sees Follow-ups and no `[aria-label="Workspace"]`.
  - Record step marks as that test does.
- [ ] **Step 3: Run** `timeout 600 npm test` and `timeout 120 npx openspec validate --all`. Expected: PASS. Do **not** run `npm run test:browser` locally (Global Constraints).
- [ ] **Step 4: Update the docs:** the two pages describe the Office / Cases sides, the switch, the remembered side and the Intaker's office, in place of "admin → office, everyone else → work board".
- [ ] **Step 5: Commit** `git commit -am "Workspace switch: browser walk and docs (#104)"`
- [ ] **Step 6: CI:** push the branch, then run `gh workflow run ci.yml --ref add-workspace-switch`. Wait with a bounded `gh run watch <id> --exit-status`, under a timeout no longer than 40 minutes. The `checks`, `sign-in` and both `story` legs must pass. `database` passes, unchanged. Record the run link for `verify.md`. If a job fails, read its recorded error before any rerun.
