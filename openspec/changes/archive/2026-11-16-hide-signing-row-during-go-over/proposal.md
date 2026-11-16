## Why

When a reviewer approves without going over the return with the client, Follow-ups lists the case twice for one piece of work: a "Call the client" row for the go-over task, and a Signing row reading "Waiting for the office to go over the return with the client." with nothing to press. An office volunteer reads these as two things to do (#177). If the case shows only as the go-over task until that task is done, every Follow-ups row is something the office can act on.

## What Changes

**Follow-ups Signing row during an open go-over**
- From: a case at Ready to exit always has a Signing row. While its `go_over_return` follow-up is open, the row reads "Waiting for the office to go over the return with the client." and shows "The office still needs to go over the return with the client." in place of Mark ready to e-file….
- To: while the case has an open `go_over_return` follow-up, Follow-ups lists no Signing row for it. The case still appears as its "Call the client" row. Once the follow-up is resolved (either outcome) or cancelled, the Signing row appears as before, for example "Waiting for the client to sign." with Mark ready to e-file….
- Reason: the Signing row only waited on the Call the client row of the same case.
- Impact: non-breaking. Only office staff using Follow-ups are affected, and the Signing count in Follow-ups' filter drops while a go-over is open.

Unchanged:
- The case page's locked Signing step still reads "The office still needs to go over the return with the client."
- The database still refuses Mark ready to e-file while the go-over is open.
- The case pool's Waiting on client tab still lists every Ready to exit case.

## Capabilities

### New Capabilities

None.

### Modified Capabilities
- `case-lifecycle`: "Admins record signing and e-filing, with a confirmation" no longer gives Follow-ups a go-over Signing row. "The lists and the case page show every stage" leaves out the Signing row while a go-over is open.
- `office-follow-up`: "The office works a go-over follow-up like any other task" says the Call the client row is the case's only Follow-ups row for the go-over. The Signing row follows once the task is done.

## Impact

- Code:
  - `src/office-views.mjs`: in `followupQueue`, skip the Signing row while `goOverOpen` is true. In `needed()`, remove the go-over text, which can no longer be reached.
  - No database, RPC, realtime or client-text change. The list entry already carries `goOverOpen`.
- Tests:
  - `tests/office-views.test.mjs`
  - the browser story (`tests/browser.mjs`), which asserts the old Signing row text.
- Overlap: open PR #200 edits the neighbouring Withdrawn bullet in the same case-lifecycle requirement. The delta must be rebuilt on the latest `main` before archive.
