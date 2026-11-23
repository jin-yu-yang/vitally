## 1. The side rule and the remembered side

- [ ] 1.1 Add `OFFICE_CAPABILITIES`, `CASES_CAPABILITIES`, `hasOfficeSide`, `hasCasesSide`, `hasWorkspaceSwitch` and `workspaceSide` to `src/contracts.mjs` (design D1), with unit tests for every role combination: Admin, Intaker, Preparer, Reviewer, Greeter, Admin+Reviewer, Intaker+Preparer, no own entry, and a non-staff principal
- [ ] 1.2 Add `src/workspace-side.mjs` with `readWorkspaceSide` / `writeWorkspaceSide` per user id in localStorage (design D3), with unit tests: round trip, per-user keys, unknown values read as nothing, and throwing storage on read and on write

## 2. The views

- [ ] 2.1 `staffScreen` / `staffSidebar` in `src/views.mjs` use `workspaceSide(principal, person, state.workspaceSide)` instead of `isAdmin` for the frame, the home screen, the case page and the office-screen redirect. The Workload flag and All cases stay effective `admin` (design D5). Add view tests for each role combination and each side
- [ ] 2.2 Draw the "Workspace" group (Office / Cases, `aria-pressed`, action `set-workspace-side`, `data-side`) at the top of the cleared sidebar only when `hasWorkspaceSwitch` (design D4), with its CSS in `src/styles.css`. Add view tests: shown only with both sides, pressed state, never on the setup screen
- [ ] 2.3 Add the hint on `renderAdminCase` (design D7): `ui.canSwitch`, the four lines in order, at most one, and the Switch to Cases button. Add `admin-views` tests for each line, for no line, and for no switch
- [ ] 2.4 Add the Intaker's Follow-ups (design D8): the help and documents filter for a person without `admin`, the kind chips limited to visible kinds, no Add a case, and the new empty-state line. Add `office-views` tests, including that the admin queue is unchanged
- [ ] 2.5 Add a unit test that one `getCase`-shaped record draws both case pages, and that the volunteer page never says "Staff sections are not loaded" (design D6 precondition)

## 3. The controller and the app

- [ ] 3.1 Add `state.workspaceSide`, set from `readWorkspaceSide` at sign-in and restore, defaulting to `"office"`. `forgetUser` does not clear the stored value (design D2, D3). Add controller tests
- [ ] 3.2 Add `setWorkspaceSide(side)` (design D6): write the stored value, reset `caseTab`, apply the landing table, persist, redraw, focus the heading, then run `startScreeningIfDue`. Wire `set-workspace-side` in `src/app.mjs` through `leaveAddCaseFirst`. Add controller tests for each landing, the pressed-side no-op, and the tab reset
- [ ] 3.3 Have `actingAdmin()` require effective `admin` and the office side, and have `canSeeWorkload()` check `admin` alone (design D9). Add controller tests: an admin in Cases starts nothing, switching to Office starts screening, an Intaker never starts it, and the Workload is shown on both sides
- [ ] 3.4 In `recheckClearance`, normalise `state.workspaceSide` on a change of standing, and keep the All cases move (design D10). Add controller tests: gaining a side moves nothing and leaves storage unchanged; losing the current side lands on the other side; losing the other side removes the switch; a reload after gaining Admin with nothing stored opens Office

## 4. Browser test

- [ ] 4.1 If PR #278 has merged, merge `main` first, then check that the new test's selectors match no check-in strip button (for example a name containing "Check"), and that the switch sits clear of the fixed sidebar toggle
- [ ] 4.2 Add a standalone `test(...)` block in `tests/browser.mjs` with its own `createBrowserFixture()` workspace, not in the story. One Admin+Reviewer opens a Pending review case in Office, sees "You can review this case — switch to Cases", presses Switch to Cases, claims the review, presses Office and sees Follow-ups and All cases. A reload keeps the side, and an Intaker in the same test lands on Follow-ups with no switch

## 5. Docs and checks

- [ ] 5.1 Update the R55 wording in `docs/developer/frontend.md` and `docs/developer/architecture.md` (and the staff guide, if it describes the workspace choice) to describe the two sides and the switch
- [ ] 5.2 Run `npm test` and `npx openspec validate --all` locally. Run `npm run test:browser` and `npm run test:auth-browser` via the PR's full CI run, with no local Docker or stack; there is no database suite, as nothing in the database changes. Record the run link in `verify.md`
