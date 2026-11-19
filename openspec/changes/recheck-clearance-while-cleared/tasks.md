## 1. Wake events re-read the clearance

- [x] 1.1 Add `documentEvents` to the controller (default `globalThis.document`), listen for `visibilitychange` and treat it as a wake only when visible, remove it in `unlisten()`, and pass `document` from `src/app.mjs`
- [x] 1.2 Give `refresh` a wake flag, set by focus, visibility, `online` and reconnect but not by the refresh after an action. In a cleared window's wake refresh, `await checkClearance()` before any list read, and stop if the window is no longer cleared
- [x] 1.3 Controller tests: an added role on focus, a tab becoming visible, every role removed on focus (setup screen, no `listCases`), no `getClearance` after a successful action

## 2. Refusals and saving one's own row

- [ ] 2.1 In `noteFailure`, start `void checkClearance()` on `FORBIDDEN` or `INELIGIBLE` in a cleared staff window, keeping the refusal on screen
- [ ] 2.2 Make `recheckAfterOwnSave` always re-check: wait for any check already out, then check once more, cleared or not
- [ ] 2.3 Controller tests: a narrowed role noticed on an `INELIGIBLE` claim (refusal kept, button gone), assigning someone uncleared (one re-read, buttons unchanged), saving one's own row while cleared, saving one's own row removing every role (setup screen, stays on the Roster)

## 3. Single-flight and the cleared → cleared answer

- [ ] 3.1 In `recheckClearance`, when the window was cleared and still is: compare the effective capabilities (as sets) and `isAdmin`. With no change, store the answer and return without `readFeed` or `show`. With a change, update the own entry, apply the screen fallback (4.1), persist and `show`
- [ ] 3.2 Controller tests: focus plus visibility plus a `FORBIDDEN` refusal while one check is out send one `getClearance`; an unchanged answer does not redraw

## 4. Screens when effective Admin changes

- [ ] 4.1 In the controller, when the person is no longer effective admin and `state.screen` is `office-cases`, set it to the work board and `show(true)`. Follow-ups, the office case page, the Roster and Post an update keep their screen
- [ ] 4.2 In `src/views.mjs`, keep Add a case on screen without effective `admin` (no fallback to the work board for `office-add-case`), with its draft
- [ ] 4.3 Controller and view tests: losing Admin on Follow-ups, All cases (and no jump back on regaining Admin), an office case page, Add a case

## 5. Dialogs drop their submit when the capability is gone

- [ ] 5.1 Add the dialog → capability table (effective `admin`, `followup`, `assist`, `review`; roster-ceiling dialogs listed as never replaced), and a helper that returns the submit or the line "Your roles changed, so you can't send this any more."
- [ ] 5.2 Use the helper for the submit or confirm button of every capability-gated dialog and for Add a case's Save draft and Send to the office, keeping typed text and errors
- [ ] 5.3 View tests: Log call and Resolve help swap their submit and keep typed text; the volunteer drawer keeps Save; Add a case keeps its answers and swaps Save draft and Send to the office; every dialog key is in exactly one category (capability, roster ceiling, or no capability)
- [ ] 5.4 Controller test: an added Preparer role plus an assignment shows the preparation form after focus

## 6. Checks

- [ ] 6.1 `npm test`
- [ ] 6.2 The browser story, because the views change: the PR's CI `story` jobs (both legs), not the local stack; link the run and review its screenshots
- [ ] 6.3 `npx openspec validate --all`
