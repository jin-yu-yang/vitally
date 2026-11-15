## Why

After a rejected return is fixed and sent back to signing (Return to signing), the Exit Form still prints the
original review's refund amounts, payment methods and filing methods (issue #173). Return to signing writes no
new review or questionnaire, so the form is filled from answers about the return *before* the fix. The client
then signs the corrected return and is handed old figures. A hand-out that states a wrong refund or filing
method is worse than a blank one.

## What Changes

**The Exit Form after a Return to signing**
- From: filled from the approved review's questionnaire, whatever happened after the approval.
- To: if a Return to signing came after the review's approval, the form prints only what ViTally holds:
  - the header;
  - the e-file/paper box of each return whose filing method is settled: set in the case, and its result is
    not `rejected`.

  It leaves blank the rejected return's method until it's refiled, every result, amount, payment method and
  debit date, the Other Tax entries (the rows still print for hand filling) and the Remarks. The office's
  panel and the volunteer's button carry a note naming exactly what to fill in by hand. The same rule applies
  in the PDF builder, so no path prints the old values.
- Reason: the Exit Form must reflect the latest approval and never an older one's refund or filing methods.
- Impact: non-breaking. Staff screens only; the client never sees the Exit Form in ViTally.

**Which review the office's Exit Form panel uses**
- From: the latest approved review that has a reviewer questionnaire, falling back to an earlier one.
- To: the latest approved review, with no fallback. If it has no questionnaire, there is no panel.
- Reason: a fallback is how an older approval's values reach the form.
- Impact: non-breaking. With real data a case has one approved review, and it has a questionnaire.

No RPC, database or migration changes.

Follow-ups, not in this change:
- #203: collect the corrected Exit Form values at Return to signing.
- #204: the review-contact line after a Return to signing.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `review-and-corrections`:
  - the office's Exit Form panel uses the latest approval with no fallback;
  - a new requirement for what the Exit Form prints after a Return to signing.

## Impact

- `src/staff-views.mjs`: `exitFormPanel` and `exitFormTool`.
- `src/app.mjs`: `viewExitForm`.
- A new pure module for the rule: `src/exit-form-source.mjs`.
- `src/exit-form.mjs` is unchanged: it draws whatever questionnaire it is given.
- Tests: `tests/admin-views.test.mjs`, `tests/staff-views*.test.mjs` (volunteer page), and a new
  `tests/exit-form-source.test.mjs`.
- Docs that describe the Exit Form: `docs/developer/frontend.md`, `docs/developer/backend.md`,
  `docs/demo-script.md` and `README.md`, where they state which values are printed.
