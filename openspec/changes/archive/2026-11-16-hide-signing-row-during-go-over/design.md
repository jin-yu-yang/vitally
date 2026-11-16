## Context

A reviewer's approval answered "no" to going over the return opens an office follow-up with purpose `go_over_return`. Follow-ups (`renderFollowups`, built from `followupQueue` in `src/office-views.mjs`) then shows two rows for the case:
- a `call` row, from `callTasks(record)`: the open follow-ups less the withdrawal notices;
- a `signing` row, which `followupQueue` pushes for every case at `review_approved`. `needed()` gives it "Waiting for the office to go over the return with the client." while `record.goOverOpen`, and `rowAction()` shows the refusal from `adminEligibility().markReadyToEfile` in place of the button.

`goOverOpen` comes from the list query in `src/supabase-store.mjs` (an open follow-up with purpose `go_over_return`). The database gate (D13 in the lifecycle chain) refuses Mark ready to e-file while that follow-up is open. The canonical specs require both rows today, so this is a spec change (#177). Stakeholders are the office volunteers who work Follow-ups.

## Goals / Non-Goals

**Goals:**
- While a go-over is open, the case shows in Follow-ups only as its Call the client row.
- Once the go-over is resolved or cancelled, the Signing row returns exactly as it is today.

**Non-Goals:**
- the case page's locked Signing step and its text;
- the database gate on Mark ready to e-file;
- the "Waiting for the reviewer's call with the client." row;
- the review-contact line after Return to signing (#204);
- any database, RPC, realtime or client-text change.

## Decisions

### D1: Hide the Signing row while the go-over is open
- **Choice:** no Signing row for a case whose `goOverOpen` is true. The Call the client row stands for the case until the go-over is done.
- **Reason:** the user picked it in brainstorm (Q1). Every row is then actionable, and there is no new row kind.
- **Alternatives considered:**
  - A merged "Call the client · then signing" row needs a new row kind for little gain.
  - Keeping both rows with a pointer still lists one job twice.

### D2: Filter where the rows are built, not where they are drawn
- **Choice:** `followupQueue` doesn't push the `signing` row when `record.goOverOpen` is true. `needed()` loses its go-over branch.
- **Reason:** the filter, its counts and the rows all come from `followupQueue`. Filtering there keeps them consistent.
- **Alternatives considered:**
  - Hiding in `renderFollowups` would leave the counts out of step with the rows.
  - A database-side flag needs a migration for data the list already carries.

### D3: The rule depends only on `goOverOpen`
- **Choice:** whatever the reviewer-call status or the Return-to-signing state, an open go-over hides the Signing row.
- **Reason:** one rule is easy to state and to test. An open go-over always gives the case a Call the client row (`callTasks` counts it), so the case never leaves Follow-ups.
- **Alternatives considered:** keeping the Signing row when the reviewer's call is also pending. Rejected: the case is then waiting on two things, and the Call row is the office's to do.

### D4: No other row changes
- **Choice:** leave every other Follow-ups row as it is.
- **Reason:** brainstorm Q2 found no other row that only waits on another row of the same case.

## Risks / Trade-offs

- [Risk] PR #200 edits the Withdrawn bullet next to the Signing bullet in the same case-lifecycle requirement. A MODIFIED delta copied from today's `main` would drop #200's edit at archive. → Mitigation: merge `main` before archive (CLAUDE.md step 8), and re-copy the requirement into the delta from the latest canonical text if #200 has landed.
- [Trade-off] The office no longer sees, in Follow-ups, which cases are near signing while a go-over is open. → Accepted: the case pool's Waiting on client tab lists them. PCDC can ask for the row back as a later change (brainstorm Q3).
- [Risk] A list entry without `goOverOpen`, for example from an older realtime payload, would show the Signing row. → Mitigation: `followupQueue` tests the field as truthy, so a missing field means "no go-over", which is today's behaviour for cases without one.

## Migration Plan

N/A. This change involves no deployment change: no migration, no RPC and no stored data. Rollback is a revert of the view change.

## Open Questions

- Does PCDC's office want the Signing row back during a go-over, to see cases near signing? Owner: the user / the team, when PCDC gives feedback. It can only affect this one row.
