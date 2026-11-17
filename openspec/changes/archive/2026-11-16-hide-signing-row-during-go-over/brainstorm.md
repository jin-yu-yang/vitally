# Brainstorm: hide-signing-row-during-go-over (#177)

Agreed with the user in conversation on 2026-11-15, before propose.

## Background

When a reviewer approves with "Did you go over the return with the client?" answered no, the approval opens an office follow-up with purpose `go_over_return` (capability `office-follow-up`). Follow-ups then lists the case twice for the same piece of work:

- **Call the client** · "1 open task · …", with **Log contact**. This is the go-over task. The office logs contact and resolves it here.
- **Signing** · "Waiting for the office to go over the return with the client.", with the explanation "The office still needs to go over the return with the client." in place of Mark ready to e-file…. There is nothing to do on this row until the go-over task is resolved.

An office volunteer reads these as two things to do. Both rows follow the canonical specs (`office-follow-up` "The office works a go-over follow-up like any other task"; `case-lifecycle` "Admins record signing and e-filing, with a confirmation" and the Follow-ups bullets in "The lists and the case page show every stage"), so the fix is a spec change.

How it works today: `followupQueue` in `src/office-views.mjs` builds the rows in the browser. It pushes a `signing` row for every case at `review_approved`, and a `call` row whenever `callTasks(record)` is above zero. `callTasks` counts the open follow-ups less the withdrawal notices, so an open `go_over_return` always gives the case a Call the client row. `needed()` gives the Signing row its text. A list entry already carries `goOverOpen` (`src/supabase-store.mjs`), so no database change is needed.

## Decisions

**Q1. How should Follow-ups handle the go-over?**
Options:
- **(A) Hide the Signing row while the go-over is open.** The case shows only as Call the client until the go-over is resolved or cancelled. Then the Signing row appears as "Waiting for the client to sign." with Mark ready to e-file….
- (B) Merge the two into one row ("Call the client · then signing").
- (C) Keep both rows, and have the Signing row point at the Call row.

**Decision: A** (the user picked it, and it was the issue's preferred option). Every Follow-ups row is then something the office can act on. B is the Call row with a hint, at the cost of a new row kind. C still shows two rows for one piece of work.

**Q2. Does any other Follow-ups row only wait on another row of the same case?**
I checked (my call, shown to the user):
- Withdrawal notices are already subtracted from the Call the client count.
- "Waiting for the reviewer's call with the client." waits on the reviewer, not on another Follow-ups row.
- Hold, Rejected and Filing result rows each have their own action.

**Decision: #177 is the only one.** The reviewer-call row stays unchanged.

**Q3. Does PCDC's office want the Signing row anyway, to see which cases are close to signing?**
**Decision:** not now. The case pool's Waiting on client tab still lists every Ready to exit case. Bringing the row back later would be its own change, and it affects only this row. Owner: the user / the team, when PCDC gives feedback.

## Scope

In: while a case at Ready to exit has an open `go_over_return` follow-up, Follow-ups lists no Signing row for it. Its Follow-ups text "Waiting for the office to go over the return with the client." goes away.

Out:
- the case page's locked Signing step ("The office still needs to go over the return with the client." stays);
- the database's refusal of Mark ready to e-file while the go-over is open;
- the reviewer-call wording;
- #204 (review-contact line after Return to signing);
- any migration, RPC or realtime change.

## Behaviour

- The rule depends only on `goOverOpen`. It holds whatever the reviewer-call status, and for a case returned to signing. In practice, a go-over from the first approval is resolved before Mark ready to e-file, so it is closed by the time of a rejection.
- While the go-over is open, the case always has a Call the client row, so it never drops out of Follow-ups.
- Resolving the go-over (either outcome, by anyone with `followup`) or cancelling it brings back the Signing row: "Waiting for the client to sign." with Mark ready to e-file….
- The Signing filter/tab count in Follow-ups drops by one for each case whose go-over is open. That follows from the rule.

## Approaches (how it gets built)

There is one sensible way: skip the `signing` push in `followupQueue` when `record.goOverOpen` is true, and drop the now-unreachable go-over branch from `needed()`. Other places are worse:
- Filtering in the renderer would leave the row count and the tabs inconsistent with the rows.
- A database-side flag would need a migration for data the list already carries.

## Dependencies

- None outside the repo.
- PR #200 (`fix-closed-lines-after-filing`) edits the Withdrawn bullet, which sits right above the Signing bullet in the same case-lifecycle requirement. That overlap is known: merge `main` before archive, and resolve the overlap then if #200 has landed.

## Acceptance

- Unit tests (`tests/office-views.test.mjs`):
  - no Signing row while `goOverOpen`;
  - a Call the client row is still present;
  - the Signing row returns with "Waiting for the client to sign." once the go-over is closed.
- Update the existing go-over assertions in `tests/office-views.test.mjs` and the browser story (`tests/browser.mjs`, about line 3485).
- Checks: `npm test`, `npm run test:browser`, `npx openspec validate --all`.
- Not needed: the database checks (no SQL), the sign-in check (sign-in is untouched) and the 繁體 check (staff screens are English).
