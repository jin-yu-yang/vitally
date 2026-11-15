## 1. Reproduce the bug

- [ ] 1.1 Add a failing unit test in `tests/staff-views.test.mjs`. The case is approved with a questionnaire
  (federal refund by direct deposit, state owes by direct debit, a Local entry, Remarks), then e-filed,
  federal rejected, then a `RETURN_TO_SIGNING` entry in `internalHistory` after the review's `decidedAt`. Assert
  that the volunteer's Exit Form button carries the fill-by-hand note. It fails today.
- [ ] 1.2 Add a failing unit test in `tests/exit-form-source.test.mjs` for the same case: the questionnaire
  handed to `exitFormMarks` has none of the old values. It fails today because the module doesn't exist.

## 2. The rule (`src/exit-form-source.mjs`)

- [ ] 2.1 Create `exitFormSource(record, review)` as in design D4:
  - return `null` when the review isn't approved, has no questionnaire, or the record has no
    `internalHistory` array;
  - detect a later `RETURN_TO_SIGNING` (D1);
  - build the reduced questionnaire from the settled methods (D3);
  - return `fillByHand` in form order (D5).
- [ ] 2.2 Export `exitFormNote(source)`: the note text for a corrected source, or `""`.
- [ ] 2.3 Unit tests in `tests/exit-form-source.test.mjs`:
  - no Return to signing: the stored questionnaire, unchanged;
  - returned to signing, federal rejected and state accepted: state e-file only, federal blank;
  - after the refile: federal e-file awaiting an answer (result empty) is ticked;
  - after the refile: federal paper (`given_to_client`) is ticked;
  - a return with no method: nothing;
  - a Return to signing dated before the approval: ignored;
  - fail-safe, kept on purpose: no `internalHistory` gives `null`; an approval without `decidedAt` counts any Return to signing as later;
  - a review without a questionnaire: `null`;
  - the note's exact text for these cases.
- [ ] 2.4 One unit test in `tests/exit-form.test.mjs`: `exitFormMarks` given the reduced questionnaire draws
  the header and the method ticks only, with no amount, payment box, debit date, Local tick or Remarks.

## 3. Use the rule everywhere

- [ ] 3.1 `src/staff-views.mjs`, `exitFormTool`: offer the button only when `exitFormSource` is not `null`;
  when corrected, show the note next to the button.
- [ ] 3.2 `src/staff-views.mjs`, `exitFormPanel`: use the last approved review with no fallback (D6). When
  corrected, replace the "filled from the reviewer's answers for version N" line with the note.
- [ ] 3.3 `src/app.mjs`, `viewExitForm`: find the review by id and pass
  `exitFormSource(record, review).questionnaire` to `exitFormMarks`. Return early when the source is `null`.
- [ ] 3.4 Change the fallback test in `tests/admin-views.test.mjs` ("…uses the latest approval that has one")
  to assert no panel when the latest approval has no questionnaire. Name the removed code (the `find`
  filter) in the PR.
- [ ] 3.5 Unit tests:
  - the office panel after a Return to signing carries the note;
  - the panel and the volunteer's button without one carry no note;
  - the volunteer's button after a Return to signing carries the note;
  - a record without `internalHistory` offers no button.
- [ ] 3.6 Check `tests/shell.test.mjs` still matches `app.mjs` (the `view-exit-form` case), and that
  `staff-views.mjs` doesn't import the PDF modules.

## 4. Spec and docs

- [ ] 4.1 Check that the delta spec in `specs/review-and-corrections/spec.md` matches what was built, and run
  `npx openspec validate --all`.
- [ ] 4.2 `docs/developer/frontend.md`, "The Exit Form": the latest approval, no fallback;
  `exitFormSource`; what prints after a Return to signing; the note; the tests.
- [ ] 4.3 `README.md`, the Exit Form row: say that after a Return to signing it prints only what ViTally
  holds. Check `docs/demo-script.md` and `docs/developer/backend.md` and change them only if they state
  what is printed.

## 5. Checks

- [ ] 5.1 Run `npm test` locally. Database, sign-in and story suites run in CI only: the local stack is
  shared, and no SQL changed.
- [ ] 5.2 Push the branch and confirm every CI job is green (`checks`, `database`, `sign-in`, both `story`
  legs). Review the story's screenshots for the Exit Form.
