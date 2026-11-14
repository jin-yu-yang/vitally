## Why

Issue #170: a client whose case is closed after a return was filed reads "Your return was not filed". This happens on a close at Rejected, on a close after Return to signing, and on the season-end close. The client could then file the same return again somewhere else. Both the stored history line (`closed_line` in SQL) and the status panel (`describeStage`) pick the text from the close reason alone. Neither looks at what was filed. Reproduction found 16 failing database cases across 8 close paths. The staff follow-up "The case was closed before filing…" has the same flaw.

## What Changes

**A closed client message after a filing**
- From: one fixed message per reason, ending "Your return was not filed." (or "…not filed by PCDC.") for dismissed, withdrawn and out_of_scope. no_need_to_file says "you don't need to file a return this year".
- To: when at least one return was filed (accepted, e-filed and waiting, or given to the client on paper), the message is the reason's first half, then one sentence for the federal return and one for the Pennsylvania return, saying what happened to each. When nothing was filed, the message is exactly today's. duplicate, other and no reason are unchanged.
- Reason: the client must not be told a filed return was not filed. A paper return must still be mailed.
- Impact: non-breaking. New closes only; stored history lines keep their words.

**The same text in the history and the status panel**
- From: SQL and the client each choose from the reason alone.
- To: SQL `closed_line` and `src/domain.mjs` apply the same rule to the case's filing methods and results. A test over every combination checks that they agree and that each line has its 简体 translation.

**The staff follow-up after a filing**
- From: "The case was closed before filing; make sure the return is not transmitted in TaxSlayer." even when a return was already filed.
- To: "The case was closed after a return was filed; make sure the rejected return is not transmitted again in TaxSlayer." when a return was already filed. Follow-ups treats it like the other admin notices.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `case-lifecycle`: the closed messages and close history lines depend on what was filed (new requirement "A close after a filing says what was filed"). "Clients are told at each new step" points to it. The admin's close-before-filing notice gains its after-filing variant, in "A client may withdraw their own application" and in the Follow-ups row of "The lists and the case page show every stage".

## Impact

- **Database:** a new migration (number chosen at merge time; main is at 046, and #196 and #197 may take 047 and 048). It redefines `vitally_private.closed_line` to take the case's filing columns, and redefines `act_close_case` (latest in 043) and `vitally_close_unsigned` (latest in 045) to pass them. `act_close_case` also chooses the new staff notice text. No schema, RLS, RPC signature or realtime change.
- **Client:** `src/domain.mjs` (closed message rule, notice constants), `src/client-text.mjs` (reason halves, per-return sentences, 60 generated `SENTENCES` entries), `src/zh-hant.mjs` (regenerated), `src/office-views.mjs` only if the notice list needs it.
- **Tests:**
  - New: `tests/database-closed-after-filing.mjs` (already on the branch, failing), `tests/closed-after-filing.test.mjs` (already on the branch, failing), plus the both-rejected pin, the staff-line test and the exhaustive parity test.
  - Existing tests that pin today's lines keep passing, since nothing-filed cases are unchanged.
  - No edits to files that #196 or #197 change.
