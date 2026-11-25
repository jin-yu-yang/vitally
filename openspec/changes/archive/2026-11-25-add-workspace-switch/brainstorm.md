# Brainstorm: add-workspace-switch (#104)

The design agreed in the conversation of 2026-11-23, after `/opsx:explore`. Hailey answered the open points of #104 up front, and five questions checked those answers against the code. Where code and answers disagreed, the question and its answer are recorded below.

## Background

#104, updated Nov 17 and decided Nov 21. `staffScreen` in `src/views.mjs` picks the staff workspace from one boolean, `isAdmin(person)` (Ruling R55): effective `admin` gets the office (Follow-ups, All cases), everyone else gets the work board. So:

- An **Admin + Preparer / Admin + Reviewer** gets only the office. A case at Pending review shows no Claim review, and the work board and pool are out of reach. This is PCDC's site coordinator, who runs the office and also prepares or reviews.
- An **Intaker** (`receive_documents`, `assist`) lands on the work board, where they can do nothing. Decided Nov 6: Intakers belong in the office.

The database checks every capability on every action. This change is a view change and grants nothing.

### Already decided before the brainstorm (Nov 21 and the task brief)

- One switch at the top of the staff sidebar, shown only to someone with both sides: an office capability plus `prepare` or `review`. It defaults to Office.
- Remembered: sign-in returns to the side used last.
- An Intaker (no `prepare` / `review`) lands in the office and sees no switch.
- Admin only and Preparer/Reviewer only see no switch and behave as today.
- Front end only. No migration. If one turns out to be needed, stop and ask before choosing a number.

### The earlier plan (reference only)

Branch `add-workspace-switch-for-dual-staff` (Oct 31), D1–D7. That folder is not revived. What still holds, and what changed:

| Old decision | Now |
|---|---|
| D1 a mode switch between the two existing workspaces, each shown as it is | holds |
| D2 one rule in `contracts.mjs`, used by view and controller | holds. "Office" is now any office capability, not just `admin` |
| D3 mode in window state like `sidebarOpen` | **changed** (Q1): localStorage per user id, outside `window-state.mjs` |
| D4 `role="group"` "Workspace" with Office / Cases `aria-pressed` buttons, in the account area | holds as the control. **Moved** to the top of the sidebar (Nov 21) |
| D5 where a switch lands | holds, extended (Q5) |
| D6 "Switch to Cases" hint on the office case page, claim only | **extended** (Q3) to work already held |
| D7 screening on open follows the workspace | holds: admin **and** Office |
| Presenter rules | gone (#128) |

Since Oct 31, these landed: roles and effective capabilities (#194, #237), #190's role gates (`src/role-gates.mjs`, the "Losing or gaining effective Admin keeps the person in place" requirement), #178 (`followup` requires `admin`), and the Intaker decision.

## Findings from the code

- **No migration.** Since 045, the read rules on `cases` (`visible_cases`) and `assistance_items` (`staff_assistance_items`) let any cleared staff member read this season's cases and help requests, with no capability check. An Intaker's queue is built from what the window already loads (`listCases`, `listAssistance`).
- **The role sets** (`ROLE_CAPABILITIES`, `src/volunteer-workload.mjs`): Intaker is `receive_documents`, `assist`. Admin is `admin`, `followup`, `assist`, `receive_documents`. Preparer is `prepare`. Reviewer is `prepare`, `review`. Since #178 `followup` requires `admin`, so an Intaker never has follow-up tasks or Log contact.
- **The office case page already gates each action on its own capability** (`admin-views.mjs`: `recordDocumentResponse` on `receive_documents`, `claimAssistance` and `resolveAssistance` on `assist`). It works for an Intaker as it is.
- **One boolean does too much today.** `office` in `staffScreen` also decides the Workload tab (`rosterPage(state, { workload: office })`). `canSeeWorkload()` and screening on open (`startScreeningIfDue`) use `actingAdmin()`. These follow the capability, not the side.
- **Both workspaces open a case the same way** (`selectCase` → `store.getCase`), so the same `savedCase` draws either case page.
- **Links into a case** come only from the work board, the pool, Follow-ups and Workload's Open. Notifications and posted updates hold no case links.
- **Office overview** does not exist in the code. There is nothing to hide.
- **Mobile:** a collapsed sidebar has no icon rail. The toggle, or the peek (`sidebar-peek.mjs`), opens the whole sidebar, so a switch at its top is reachable the same way.
- **The uncleared admin:** the setup branch of `staffScreen` always passes `office = false`, `board: false`. A switch drawn only on the cleared path never shows there.
- **Capability changes** have one path: `recheckClearance` → `sameStanding` → redraw. The switch fits there, with no second path.

## Decisions

### Q1: Where the side is remembered

**The conflict:** the brief said "per browser, in window state like sidebarOpen" and "sign-in returns to the side used last". `window-state.mjs` uses sessionStorage, and `forgetUser()` clears it at sign-out, so the choice would die at sign-out and with the tab.

**Decided:** a localStorage record per user id, outside `window-state.mjs`, read and written like the language (`readLanguage` / `writeLanguage`: try/catch, and blocked storage falls back to Office). It holds only `"office"` or `"cases"`. It survives sign-out, it is per browser, and it is not synced across devices.

### Q2: Gaining a side mid-session

**The conflict:** the volunteer-clearance requirement says gaining effective Admin "SHALL work in reverse", that is, move to the office. Applying a stored "office" could flip a Preparer's case page in the middle of their work.

**Decided: (a), gaining a side never moves the window.** The switch appears, pressed on the side they are on, and they switch when they choose. The stored value is not changed until they press the switch, so a reload brings back whatever they last chose. A Preparer who never pressed it has nothing stored, so a reload after gaining Admin opens in Office (the default). Losing a side lands on the side that remains and leaves the stored value alone. The "work in reverse" line becomes: "Gaining a side SHALL show the switch and SHALL NOT change the screen or the workspace."

Rejected: (b) applying the stored choice at once, because it can jump; (c) always jumping to Office (today's rule).

### Q3: The office case page's hint

**Decided: four lines, checked in this order, at most one shown,** each with the same **Switch to Cases** button that keeps the same case open:

1. claim preparation allowed: "You can claim this case — switch to Cases"
2. claim review allowed: "You can review this case — switch to Cases"
3. preparation work allowed: "You're preparing this case — switch to Cases"
4. review decision allowed: "You're reviewing this case — switch to Cases"

Every condition comes from `staffEligibility` (`src/staff-views.mjs`). Reason: roles made "an Intaker given Preparer and assigned the case" a real path (the volunteer-clearance scenario "Gaining a role with a form in view"), and a claim-only hint would say nothing to that person.

Also decided (Hailey's answer 1): the case page shows only the current workspace's actions, never a merged page.

### Q4: The Intaker's Follow-ups

**Decided: the strict filter.** Only the rows the person can act on:

- `help`: a help request that is open, or assigned to them;
- `documents`: an office-owned case (`ownerUserId` null) with an open document request.

The kind filter offers only those two kinds, and there is no Add a case button. Someone with `admin` keeps today's full queue, unchanged.

**Empty state:** the Intaker's queue is often empty, so it gets its own line in the existing shared-panel pattern (check icon): "Nothing waiting for you. Help requests and documents to receive show here." A narrowed list keeps "Nothing here matches these filters." with its undo buttons.

Also decided (Hailey's answer 2): rows open the office case page. An Intaker has no All cases, no Volunteers and no Workload. Revisit with #162, when an Intaker will search this season's clients by name without seeing intake answers.

### Q5: Where pressing the switch lands

| On this screen | Press the switch | Lands on |
|---|---|---|
| Follow-ups / Work board (`staff`) | other side | `staff`, the other side's home |
| A case page | other side | the same case, the other side's case page |
| All cases (Office only) | Cases | Work board |
| Add a case | Cases | the leave-first check (`leaveAddCaseFirst`) if answers are unsaved, then the Work board. Nothing in Cases mode leads back to it, and the sidebar would highlight nothing |
| Volunteers, Schedule, Post an update, Season settings, My profile | other side | stays put. Only the navigation changes |

- After a switch, the case tab resets to Overview, because the two case pages have different tabs.
- Switching to Office on a Received case starts screening, as opening it there would (old D7).
- Switching to Cases starts nothing.

### Other answers confirmed against the code (Hailey's answers 3–8)

- **Links never switch the side.** A case opens on the current side's case page. The work board and pool exist only in Cases mode; Follow-ups and All cases only in Office mode.
- **Capability changes** go through role-gates and #190's landing rules: when one side goes away, the switch disappears and the window lands on the side that remains.
- **Shown in both modes:** Volunteers, Season settings, Post an update, Schedule, My profile, and the check-in strip (#278). They follow the ceiling or the schedule viewer, not the side.
- **Capability, not side:** the Workload tab (admin-only in either mode), Add a case (admin), and screening on open (admin in Office mode only, never an Intaker).
- **Uncleared admin:** no switch on the setup screen; otherwise as today.
- **Mobile:** the switch sits at the top of the sidebar, reached by opening the collapsed sidebar. Layout details stay with #147.

## Approaches considered

1. **A side switch between the two existing workspaces (chosen).** One rule picks which of the two existing frames to draw. It reuses both workspaces whole, which are already tested, and keeps the change to the view.
2. **One case page with every allowed action.** Rejected: it rewrites how the office and volunteer panels exclude each other, and it mixes two jobs on one page. Hailey chose current-side-only actions plus the hint.
3. **Storing the side on the server, per person.** Rejected: it needs a migration, and the choice is a view convenience. localStorage meets "sign-in returns to the side used last" per browser.

## Dependencies

- **Database: none.** Ready. Existing read rules cover every cleared staff member.
- **PR #278** (Cody, check-in, migration 060): open and mockable. Its check-in strip shows in both modes. If it merges first, merge `main` before the browser test, check that the test's selectors don't match the strip's buttons (a name containing "Check"), and check that the switch at the top of the sidebar sits clear of the fixed sidebar toggle.
- **#256** (likely 061): not touched.
- **#162**: later. It will reshape the Intaker's office.
- **#147**: later. Mobile layout details.

## Tests (agreed)

- **Unit:**
  - the rule in `contracts.mjs`;
  - the remembered-side store, including blocked storage;
  - role-gates;
  - the views: the sidebar switch, the four hint lines, the Intaker queue and its empty state.
- **Controller:** switching and its landings, the tab reset, screening, and gaining or losing a side.
- **Browser:** its own `test(...)` block with its own workspace, not the story, which is near its 900 s limit. One person switches, claims a review, and goes back to Office.
- **No local Docker or stack.** The PR's full CI is the final check.

## Spec check during propose

`volunteer-workload` and `case-labels` were read for "admin means office" wording. Neither needs a delta:
- The Workload requirement already says "a cleared staff member whose effective capabilities include `admin`", with no mention of a workspace.
- Workload's Open "opens the staff case page", which under this change is the current side's.
- `case-labels` names the work board and the pool only as places that show labels.
