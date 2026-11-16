## 1. Follow-ups rows

- [x] 1.1 In `tests/office-views.test.mjs`, rewrite the D13 assertions (the `goOverOpen: true` case `G`):
  - `followupQueue` / `renderFollowups` list no `signing` row for a `review_approved` case with `goOverOpen: true`;
  - the case still has its `call` row (open-task count, **Log contact**) when its open-follow-up count includes the go-over;
  - "Waiting for the office to go over the return with the client." appears nowhere in Follow-ups;
  - the rule holds when the reviewer's call is pending and for a case returned to signing;
  - with `goOverOpen: false`, the Signing row reads "Waiting for the client to sign." with **Mark ready to e-file…**;
  - the Signing filter count leaves out the hidden row.

  Run them and see them fail.
- [x] 1.2 In `src/office-views.mjs`:
  - `followupQueue`: skip the `signing` row while `record.goOverOpen` is true, with a comment naming #177.
  - `needed()`: remove the go-over branch, which can no longer be reached.

  Run `npm test` and see it pass.
- [x] 1.3 Check that the case page's locked Signing step and `adminEligibility().markReadyToEfile` are unchanged: their tests in `tests/admin-views.test.mjs` still pass without edits.

## 2. Browser story

- [x] 2.1 In `tests/browser.mjs` (the class case's go-over, about line 3480), replace the `heldRow` assertions:
  - once the Call the client row is visible, Follow-ups shows no `signing` row for the class case;
  - update the "the signing row still waits" comment after the contact is logged: logging a contact still leaves the Signing row out.

  Keep the later wait for the Signing row with **Mark ready to e-file…** after the go-over is resolved.

## 3. Docs and checks

- [x] 3.1 Update `docs/developer/frontend.md` where it describes the Follow-ups signing rows: no Signing row while a go-over follow-up is open.
- [x] 3.2 `npm test` and `npx openspec validate --all`
- [x] 3.3 `npm run test:browser`, or passing CI `story` jobs on the commit with their screenshots reviewed. No database, sign-in or 繁體 check is needed: there is no SQL, sign-in or client-text change.
- [x] 3.4 Before archive: merge `main`. If PR #200 has landed, re-copy "The lists and the case page show every stage" into the case-lifecycle delta from the latest canonical text, keeping this change's edits.
