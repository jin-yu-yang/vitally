## Context

`staffScreen` in `src/views.mjs` computes `office = isAdmin(person)` once (Ruling R55). That one boolean decides five things:
- the sidebar (`staffSidebar`: Follow-ups and All cases, or the Work board);
- the home screen (both are the screen key `staff`);
- the case page (`renderAdminCase` or `renderStaffCase`);
- whether the office screens (`office-cases`, `office-add-case`) are allowed;
- the Workload tab (`rosterPage(state, { workload: office })`).

The controller has its own copy, `actingAdmin()`. `canSeeWorkload()` and `startScreeningIfDue()` use it.

The effective capabilities come from the roles (`ROLE_CAPABILITIES` in `src/volunteer-workload.mjs`), within the roster ceiling:
- Intaker: `receive_documents`, `assist`
- Preparer: `prepare`
- Reviewer: `prepare`, `review`
- Admin: `admin`, `followup`, `assist`, `receive_documents`

Since #178, `followup` requires `admin`.

The window learns of a change of capabilities in one place, `recheckClearance` in `src/controller.mjs`. It rewrites the person's own entry (`withOwnCapabilities`), compares the standing (`sameStanding`) and redraws. Today's landing rule ("Losing or gaining effective Admin keeps the person in place", volunteer-clearance) moves All cases to the Work board, and otherwise relies on the view redrawing the same screen in the other frame. `src/role-gates.mjs` holds the form-level gates (`dialogLocked`, `addCaseLocked`, `ownCapabilities`).

The database is not touched. Since 045, `visible_cases` and `staff_assistance_items` let every cleared staff member read this season's cases and help requests, and every action RPC checks its own capability.

`brainstorm.md` holds the decisions (Q1–Q5) and the earlier plan's D1–D7 (branch `add-workspace-switch-for-dual-staff`, not revived). This document is the design built from them.

## Goals / Non-Goals

**Goals:**
- An Admin + Preparer / Admin + Reviewer can switch to Cases, see the work board and pool, claim a review, and switch back to Office.
- An Intaker lands in the office, sees only the Follow-ups rows they can act on, and sees no switch.
- The choice survives a reload and a sign-out in the same browser.
- A capability change mid-session shows or hides the switch, and falls back without a reload. Gaining a side never moves the window.
- Admin-only, Preparer-only, Reviewer-only and Greeter accounts see exactly what they see today.

**Non-Goals:**
- Any database change: schema, RPCs, policies, realtime.
- A case page that shows office and volunteer actions together.
- Changing which panels either case page shows.
- Searching this season's clients by name for an Intaker (#162).
- Mobile layout beyond the sidebar it already has (#147).
- Syncing the choice across browsers or devices.

## Decisions

### D1: Two sides, one rule in `contracts.mjs`
- **Choice:** pure exports beside `isStaffWindow`:
  - `OFFICE_CAPABILITIES = ["admin", "followup", "assist", "receive_documents"]` and `CASES_CAPABILITIES = ["prepare", "review"]`.
  - `hasOfficeSide(person)` and `hasCasesSide(person)`: whether the person's `capabilities` include any of the set.
  - `hasWorkspaceSwitch(principal, person)`: staff access, and both sides.
  - `workspaceSide(principal, person, preferred)`: `"office"` or `"cases"`.
    - With the switch: `preferred === "cases" ? "cases" : "office"`.
    - With one side: that side.
    - With neither: `"cases"`, today's work board.
    - With no own entry yet (people not loaded): `"cases"`, which is what `isAdmin(null)` gives today.

  `staffScreen`, `staffSidebar` and the controller all call `workspaceSide`.
- **Reason:** the view and the controller (screening, landings) must agree on the side. `contracts.mjs` is already imported by both. This is the old D2 with "office" widened from `admin` to the office set.
- **Alternative considered:** `isAdmin` stays, plus a separate check for the mode in each place. Rejected: the old plan found that two copies drift.

### D2: The side is drawn from `state.workspaceSide`, kept equal to what is on screen
- **Choice:** controller state `workspaceSide` (`"office"` or `"cases"`).
  - It is set at sign-in and on a reload from the remembered value (D3), or `"office"` when nothing is stored.
  - After every capability change, `recheckClearance` normalises it: `state.workspaceSide = workspaceSide(principal, newPerson, workspaceSide(principal, oldPerson, state.workspaceSide))`. So:
    - **Gaining a side** keeps the side that was on screen (Q2a). The switch appears, pressed there.
    - **Losing a side** sets it to the side that remains, so regaining it later moves nothing either.
  - Only pressing the switch writes the remembered value.
- **Reason:** "Gaining a side never moves the window" needs the current side in memory, separate from the stored choice. A reload then brings back the stored choice, as agreed: a Preparer who never pressed the switch reloads into Office after gaining Admin.
- **Alternative considered:** compute the side from the stored value alone. Rejected: it moves a Preparer mid-case the moment they gain Admin.

### D3: The remembered side lives in localStorage, per user id, like the language
- **Choice:** a small module, `src/workspace-side.mjs`, with `readWorkspaceSide(userId, { storage })` and `writeWorkspaceSide(userId, side, { storage })`. The key is `vitally.workspace-side:<userId>`. The value is `"office"` or `"cases"`, and anything else reads as nothing. Reads and writes are wrapped in try/catch, as in `readLanguage` / `writeLanguage`: blocked storage reads as nothing and writes silently do nothing. The controller is given the same `localStorage` it already gets for the language (`app.mjs` `readLocalStorage()`).
  - `forgetUser()` does **not** clear it, so sign-in returns to the side used last.
  - It holds no name, no case and no capability.
- **Reason:** Q1. `window-state.mjs` is sessionStorage and is cleared at sign-out (R44), so it cannot meet "sign-in returns to the side used last".
- **Alternative considered:**
  - A `window-state.mjs` field like `sidebarOpen` (old D3): forgotten at sign-out.
  - A server-side preference: needs a migration.

### D4: The switch is a "Workspace" group at the top of the sidebar
- **Choice:** in `staffSidebar`, between the brand and the navigation: a `<div role="group" aria-label="Workspace" class="workspace-switch">`. It holds two buttons, **Office** and **Cases**, on the action `set-workspace-side` with `data-side`, each with `aria-pressed`.
  - It is drawn only on the cleared path, and only when `hasWorkspaceSwitch` is true. The setup branch never draws it.
  - Pressing the pressed side does nothing.
  - The navigation below follows the side: Follow-ups and All cases in Office, the Work board in Cases.
  - Volunteers, Schedule, Post an update, Season settings and Notifications follow their own rules in both sides.
  - The switch is a normal part of the sidebar, so a collapsed sidebar reaches it when opened or peeked.
- **Reason:** decided Nov 21 (top of the sidebar). The control is the old D4: two named, pressed-state buttons, keyboard-reachable, matching the sidebar's other buttons.
- **Alternative considered:** a single toggle or a select. Rejected: it hides the other state.

### D5: Screens per side, and the capability-bound parts
- **Choice:**
  - **Office only:** Follow-ups (`staff` in Office), All cases (`office-cases`), Add a case (`office-add-case`, from Follow-ups and All cases).
  - **Cases only:** the Work board (`staff` in Cases). The pool tabs live on the board.
  - **Both:** the case page (each side draws its own), Volunteers, Schedule, Post an update, Season settings, My profile, Notifications, the check-in strip (#278).
  - **Capability, not side:**
    - All cases stays effective-`admin` only, as today. An Intaker in Office has no All cases.
    - The Workload tab follows effective `admin` in either side, so `rosterPage(state, { workload: isAdmin(person) })`.
    - `canSeeWorkload()` keeps its own `admin` check.
    - Add a case's button shows only for effective `admin`. `addCaseLocked` is unchanged.
  - **The `allowed` redirect in `staffScreen`** sends an office screen to `staff` when the side is Cases, and keeps today's `office-volunteers` / ceiling rules.
- **Reason:** brainstorm (Hailey's answers 3 and 5). The Workload and All cases must not depend on the side, or an admin in Cases would lose the Workload on Volunteers.

### D6: Where a press of the switch lands
- **Choice:** `setWorkspaceSide(side)` in the controller sets `state.workspaceSide`, writes the remembered value, resets `caseTab` to Overview, persists the session, redraws, and then runs `startScreeningIfDue()`.
  - `staff` stays on `staff`.
  - `staff-case` stays on the same case. The other side's case page is drawn from the same `savedCase`, since both sides load through `selectCase` → `store.getCase`.
  - `office-cases` → `staff` when switching to Cases.
  - `office-add-case` goes through `leaveAddCaseFirst("set-workspace-side", target)` in `app.mjs`, like every other sidebar exit, and then → `staff`.
  - Every other screen stays.
  - The keyboard goes to the main heading, as other sidebar navigation does. The button keeps `aria-pressed` for a screen reader.
- **Reason:** Q5. The old plan's precondition still holds: the volunteer case page needs a staff-shaped record (`participants`, `reviews` arrays), and `getCase` gives both. A unit test pins that both pages draw from one record.

### D7: The office case page's hint toward Cases
- **Choice:** `renderAdminCase` receives `canSwitch` (from `hasWorkspaceSwitch`) in `ui`. With `canSwitch`, the Overview panel opens with one `role="note"` line: the first allowed of
  1. `staffRights.claimPreparation` → "You can claim this case — switch to Cases"
  2. `staffRights.claimReview` → "You can review this case — switch to Cases"
  3. `staffRights.preparationWork` → "You're preparing this case — switch to Cases"
  4. `staffRights.reviewDecision` → "You're reviewing this case — switch to Cases"

  Each is followed by a **Switch to Cases** button on `set-workspace-side` with `data-side="cases"`. No line shows when none is allowed. `staffRights` is already computed by `renderAdminCase` (`staffEligibility(record, person)`).
- **Reason:** Q3. `staffEligibility` is the one place these rules live. Lines 3 and 4 cover an Intaker who is given Preparer and assigned a case (volunteer-clearance, "Gaining a role with a form in view").
- **Alternative considered:**
  - Claim-only (old D6): says nothing to the person who already holds the case.
  - Every action on one page: rejected in the brainstorm.

### D8: The Intaker's Follow-ups
- **Choice:** `renderFollowups` and `followupQueue` keep the admin's queue unchanged for effective `admin`. For a person without `admin`, the rows are filtered to:
  - `help`: `item.status === "open"`, or `"assigned"` with `item.assigneeId === person.id`, and only with `assist`;
  - `documents`: `record.ownerUserId === null` and `record.openRequests > 0` (the list record's count of open `document_requests`, already read by `listCases`, `src/supabase-store.mjs:644`), and only with `receive_documents`.

  The kind filter (`officeFilters`, the chips) offers only the kinds the person can see. A stored `officeKind` outside them reads as all. The season-end close and the invitation panel stay admin-only, as they are. There is no Add a case button.

  The empty state uses the shared `emptyState` (check icon): "Nothing waiting for you. Help requests and documents to receive show here." when no filter is set. The narrowed-list line is unchanged.

  Rows open the office case page.
- **Reason:** Q4. Every row shown has an action the person can take on the office case page. That page already gates each action on its capability (`recordDocumentResponse`, `claimAssistance`, `resolveAssistance`).
- **No new read:** `openRequests` and `ownerUserId` are already on every staff list record, and `listAssistance` already returns `status` and `assigneeId`. A new query or RPC is out of scope: if one seems needed, stop and ask.

### D9: Screening on open needs admin and the office side
- **Choice:** `actingAdmin()` becomes "effective `admin`, and `workspaceSide(...) === "office"`". `canSeeWorkload()` stops using `actingAdmin()` and checks `admin` alone (D5).
  - An admin in Cases opening a Received case starts nothing.
  - Switching to Office while that case is open starts it (D6 runs `startScreeningIfDue`).
  - An Intaker never starts it.
- **Reason:** old D7, confirmed again (Q5). The volunteer case page shows no office work, so moving the case from there would be a hidden effect.

### D10: Capability changes go through `recheckClearance`, not a second path
- **Choice:** in the `now && was` branch of `recheckClearance`:
  - normalise `state.workspaceSide` (D2) before the `sameStanding` early return can skip a redraw. A change in sides is a change of capabilities, so `sameStanding` already reports it;
  - keep today's `office-cases` → home move, now when the side is no longer Office or `admin` is gone;
  - leave every other screen in place, for the view to redraw in the side that remains.

  `role-gates.mjs` gains nothing new for the switch: its gates are per capability, and they stay that way. The first load (`loadWork` after `restoreSession`) sets `state.workspaceSide` from the remembered value before the first cleared draw.
- **Reason:** #190's rule has one entry point. A second listener for sides would duplicate it.

## Risks / Trade-offs

- **[Risk] A person forgets which side they are on and looks for a control in the wrong place.** → Mitigation:
  - the pressed switch;
  - the page overline ("OFFICE WORKSPACE" / "VOLUNTEER WORKSPACE") and the navigation, which already name the side;
  - the hint on the office case page.
- **[Risk] A stored side outlives a capability.** → Mitigation: the stored value is only a preference, and `workspaceSide` applies it only while both sides exist.
- **[Risk] PR #278 changes `staffSidebar` too.** → Mitigation: whichever merges second resolves the conflict. If #278 merges first, merge `main` before the browser test, and check that:
  - the test's selectors match none of the check-in strip's buttons (for example a name containing "Check");
  - the switch at the top of the sidebar sits clear of the fixed sidebar toggle.
- **[Trade-off] The choice is per browser, not per person.** A second browser opens in Office. → Accepted: Office is the main job, and a server preference needs a migration.
- **[Trade-off] An Intaker's office is narrow until #162.** They find a case only through a row. → Accepted, and revisited with #162.

## Migration Plan

N/A: no database, deployment or data change. The localStorage key is new and optional, and a browser without it opens in Office. Rolling back leaves an unused key, which nothing reads.

## Open Questions

None.
