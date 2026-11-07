## 1. A presenter is not a staff window, and gets the plain screen

- [x] 1.1 Record the unit test count on the branch's base (`npm test`, `ℹ tests`), for the PR's before/after.
- [x] 1.2 `isStaffWindow` (`src/contracts.mjs`) and the controller's `staffWindow()` are true for `staff` only. Unit tests for presenter, staff and applicant principals.
- [x] 1.3 The controller loads nothing for a presenter: no cases, people, help requests or workspace row, and no realtime. `app.mjs` renders the plain English screen: "This account is no longer used", "Presenter mode has been removed. Ask your site coordinator for a staff account.", and Sign out, using the existing sign-out action. Unit tests for the screen's text, its single action, and that nothing loads.

## 2. The presenter screens and the persona go

- [x] 2.1 Remove `src/presenter-views.mjs`, and its uses in `src/views.mjs`: the panel placement, the sidebar's "Acting as" / "Choose one in the presenter controls", and the presenter branch of the staff frame.
- [x] 2.2 Remove from `src/app.mjs` the `select-person`, `open-reset-fixtures`, `confirm-reset-fixtures`, `open-checkpoint` and `confirm-checkpoint` handlers, and the panel's `fill-assisted-intake` placement. The office's Add a case fill stays.
- [x] 2.3 Remove `selectedPersonId` from the controller: state, selection, the linked-persona drop, restore on reload, and the persona sent with actions, which is now always `p_person_id: null`. Remove `presenter()`, `requirePresenter`, and the reset and checkpoint requests.
- [x] 2.4 `src/window-state.mjs` no longer saves `selectedPersonId`, and ignores a stored one for every access. Unit test.
- [x] 2.5 `src/ui.mjs` `confirmBody` loses the `note.inForm` option. `src/styles.css` loses `.presenter-panel` and `.persona-*`.
- [x] 2.6 `src/client-text.mjs`: remove the 简体 entries whose controller sentence no longer exists in `src/`, as listed in design D3. Run `npm run build:hant` and commit `src/zh-hant.mjs`.
- [x] 2.7 Unit tests:
  - remove the tests of removed code;
  - convert the tests that used a presenter principal for shared staff behaviour to a staff principal;
  - keep a list of every removed test and the code it tested, for the PR.

## 3. The browser story

- [x] 3.1 Replace each presenter step one for one, as in design D6. The story stays at 83 tests:
  - sign-in: the presenter gets the plain screen;
  - "the board starts with no cases";
  - "a staff reload leaves the client window where it was";
  - the contact log's sign-out and sign-in in one window;
  - "two windows of one staff account in one browser keep their own place";
  - "a second seed run replaces its set and leaves the class's own work alone";
  - the plain screen in "two staff accounts…".
- [x] 3.2 The seed step's "board counts 10 first" becomes 0. The toast-outside-inert check uses the "Ask the preparer for corrections" toast. The version-2 check and the "eight cases" screenshot move to the seed step. "A claim unlocks the phone…" uses the second seed run's `preparation_ready` case.
- [x] 3.3 Remove the story helpers only presenter steps used (`choosePersona`, `readPersona`, `resetSampleCases`, `readFixtureIndicator`) from `tests/support/story-pages.mjs`, if nothing else uses them.

## 4. Docs

- [x] 4.1 `docs/setup.md`:
  - "Use them" signs in as the Site Coordinator;
  - the presenter account is described as showing the plain screen;
  - "Reset sample cases" is described as gone from the screens;
  - the browser-story row and the run note.
- [x] 4.2 `docs/demo-script.md`: an out-of-date note at the top, pointing to #137 for the rewrite.
- [x] 4.3 `docs/developer/frontend.md` and `docs/developer/backend.md`: the presenter panel, persona and `selectedPersonId` rows.

## 5. Verification

- [x] 5.1 `npm test` passes. Record the count after and the list of removed tests for the PR.
- [x] 5.2 `npm run build:hant -- --check` passes.
- [x] 5.3 `npm run test:auth-browser` passes.
- [x] 5.4 `npm run test:browser` passes at 83 tests, alone on the local stack, with nothing else using `127.0.0.1:54321`. If an order goes over the time limit while it is still 900 s, stop and show the user the per-step timings. Trim nothing.
- [x] 5.5 `npx openspec validate --all` passes.
