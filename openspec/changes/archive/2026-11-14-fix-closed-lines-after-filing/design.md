## Context

Issue #170. When a case is closed, the client gets two texts:

- **A history line**, written once by the database into `client_events.message`. It is
  `vitally_private.closed_line(p_reason)` (036), called by `act_close_case` (latest definition in
  043) and by the season-end `vitally_close_unsigned` (latest definition in 045).
- **A status panel message**, computed in the browser by `describeStage` → `holdClosedKey`
  (`src/domain.mjs`) from `record.closingReason`, as the TEXT key `stage.closed.client.<reason>`.

Both choose from the reason alone. Three moves can reach a closable stage after a return was
filed:
- a filing result that leaves the case at Rejected while the other return is accepted, waiting, or
  given to the client on paper;
- Return to signing, which keeps each return's method and answer and moves the case back to Ready
  to exit;
- from there, Mark ready to e-file, Put on hold and the season-end close.

The reproduction lists 8 paths, 16 cases in all (brainstorm.md).

The case row holds what each return is: `federal_method` / `state_method` (`efile`, `paper`, or
both null) and `federal_result` / `state_result` (null, `accepted`, `rejected`, `given_to_client`).
A client session can read these columns ("Filing details stay with staff"), and
`src/supabase-store.mjs` maps them to `federalMethod`, `federalResult`, `stateMethod` and
`stateResult`.

History lines are translated in the browser: `historyLine` → `sentence(text, lang)` looks the whole
English line up in `SENTENCES` (`src/client-text.mjs`). 繁體 is `toHant` over the 简体 value, from
the generated map `src/zh-hant.mjs`. `tools/hant-sources.mjs` collects every `TEXT` and `SENTENCES`
value.

Constraints:
- New migration only (never edit 036/037).
- The migration number is chosen when this PR's turn comes.
- Only `npm test` runs locally, because another session shares the stack. Database and story
  checks run in CI.
- Don't touch files #196 or #197 change: `src/office-views.mjs`, `tests/database-actions.mjs`,
  `tests/store.test.mjs` and others.

## Goals / Non-Goals

**Goals:**
- A client never reads that a filed return was not filed, on any close path.
- A return given to the client on paper is described as still to be mailed.
- When nothing was filed, every closed message and history line is exactly today's.
- The history line and the status panel give the same text, from one rule, in en, 简体 and 繁體.
- The staff notice no longer says "closed before filing" after a return was filed.

**Non-Goals:**
- Rewriting history lines already stored.
- Changing the `duplicate`, `other` or no-reason messages.
- Changing the client's own Withdraw line, which can't reach a filed case.
- Changing the withdrawn staff notice ("The client withdrew; make sure the return is not
  transmitted in TaxSlayer.").
- Recording "no Pennsylvania return needed" (see Risks).

## Decisions

### D1: Per-return outcome
- **Choice:** each return maps to one of four outcomes:

  | Columns | Outcome |
  |---|---|
  | method set, result `accepted` | accepted |
  | method `efile`, result null | waiting |
  | result `given_to_client`, or method `paper` with result null | paper |
  | result `rejected`, or method null | not filed |

  A case **has a filed return** when either outcome is accepted, waiting or paper.
- **Why:** these are the only states the schema allows. Method `paper` with a null result can't
  happen today, because Mark e-filed always sets `given_to_client`. Mapping it to paper keeps the
  rule total and on the safe side: it never claims "not filed".
- **Alternative considered:** treating paper as not filed. Rejected by the user (brainstorm Q1).

### D2: Composition
- **Choice:**
  - Reasons `dismissed`, `withdrawn`, `out_of_scope` and `no_need_to_file` with a filed return give
    the reason half, a space, the federal sentence, a space, the Pennsylvania sentence. Every other
    case gives today's message for its reason.
  - In 简体 the pieces are joined with no space.
  - The reason halves and per-return sentences are in brainstorm.md (Q5, Q7) and the delta spec.
- **Why:** this is the user's direction. One return can be filed and the other not.

### D3: One JS rule, used by the status panel and by the translation table
- **Choice:**
  - `src/client-text.mjs` gains the pieces as TEXT entries (`closed.reason.<reason>`,
    `closed.return.<federal|state>.<outcome>`) and an exported `closedLine(reason, federal, state,
    lang)` that composes them. Its inputs are outcomes; it returns null when the message isn't
    composed.
  - `src/client-text.mjs` adds the 60 composed lines (4 reasons × 15 outcome pairs with a filed
    return) to `SENTENCES` at module load, by calling `closedLine` for "en" and "zh-Hans".
  - `src/domain.mjs` gains `returnOutcome(method, result)` (D1). `holdClosedKey` / `describeStage`
    use `closedLine` for a closed case with a filed return. Otherwise they fall back to today's key.
- **Why:**
  - The pieces live where the client text lives, so `npm run build:hant` sees them.
  - Generating `SENTENCES` from the same function keeps the panel and the history translation from
    drifting.
  - `client-text.mjs` can't import `domain.mjs` (domain already imports client-text), so the
    composer takes outcomes, not a record.
- **Alternatives considered:**
  - Splitting stored lines into sentences when translating. Rejected: it adds a parser, and a
    partial match would leak English.
  - Listing the 60 lines by hand. Rejected: they'd drift from the rule.

### D4: SQL `closed_line` takes the filing columns
- **Choice:**
  - The new migration creates `vitally_private.closed_line(p_reason text, p_federal_method text,
    p_federal_result text, p_state_method text, p_state_result text)`. It maps outcomes as D1 does
    and composes the English as D2 does.
  - It redefines `act_close_case` (from 043) and `vitally_close_unsigned` (from 045) verbatim except
    the marked lines, which pass `p_case` / `v_case` columns. Both read the case row before
    `close_case_steps`, which doesn't touch the filing columns.
  - It then drops the one-argument `closed_line(text)`, so no caller can fall back to the
    reason-only rule. Every caller is in this migration, which a grep confirms.
- **Why:** explicit arguments let the exhaustive test call the function on every combination
  without building cases.
- **Alternative considered:** `closed_line(p_reason, p_case public.cases)`. Rejected: the test would
  need real rows for 119 combinations.

### D5: The staff notice after a filing
- **Choice:**
  - In `act_close_case`, a close before filing (`v_before_filing`) with a reason other than
    `withdrawn`, on a case with a filed return (D1), stores "The case was closed after a return was
    filed; make sure the rejected return is not transmitted again in TaxSlayer." Otherwise the text
    is today's.
  - `src/domain.mjs` adds the constant `CLOSED_AFTER_FILING_NOTICE_REASON` to
    `BEFORE_FILING_NOTICE_REASONS`, which `src/office-views.mjs` already uses to tell admin notices
    from the client's stop-work notice. No edit to `office-views.mjs`.
- **Why:** this is the only staff text that becomes false. The list keeps Follow-ups showing the
  notice as an admin's, with its Resolve.
- **Alternative considered:** also changing the withdrawn notice. Not chosen, because it isn't false
  (brainstorm Q4).

### D6: Tests
- **Choice:**
  - Keep the two reproduction files.
  - Add the both-rejected pin (today's line, exactly) and the staff-notice test to
    `tests/database-closed-after-filing.mjs`.
  - Add the exhaustive test to the same file. For 7 reasons × 17 filing states, call SQL
    `closed_line` and check that:
    - the line equals `describeStage("closed", "en", row).clientMessage`;
    - `sentence(line, "zh-Hans")` has an entry in the table and equals `describeStage`'s 简体;
    - for nothing-filed, duplicate, other and null, the line equals today's line.
  - Extend `tests/closed-after-filing.test.mjs` with exact expected texts for a few mixed cases in
    en, 简体 and 繁體.
- **Why:**
  - It covers every input, not only reachable paths.
  - New files avoid #196 and #197.
  - No test names the migration file, so renumbering is a rename.

### D7: Migration file name
- **Choice:** work under `047_closed_lines_after_filing.sql`, the next free number on main today,
  marked provisional in its header. Before the PR is merge-ready, rename it to the next free number
  on main.
- **Why:** `tools/admin/migrate.mjs` needs `\d{3}_…`. Nothing else refers to the number.

## Risks / Trade-offs

- [Risk] **"No Pennsylvania return needed" can't be told from "not filed".** The schema requires
  both methods or neither (`(federal_method is null) = (state_method is null)`, 037), and a first
  Mark e-filed must name both. → Known limit, accepted: the system assumes every case has both
  returns. "Your Pennsylvania return was not filed." appears only when that return was rejected.
- [Risk] The SQL English and the JS English drift. → The exhaustive parity test fails on any
  difference, in CI's database job.
- [Risk] A composed line misses `SENTENCES`, so the history shows English in Chinese. → The parity
  test asserts every composed line has an entry. `npm run build:hant -- --check` keeps 繁體 current.
- [Risk] The migration-sentence sweep (`tests/client-language.test.mjs`) extracts literals written
  in a `message` position. → `closed_line`'s pieces are inside a function body, not in a `message`
  position, so they aren't collected. If the sweep does pick one up, give it an entry or adjust
  where it's written. Don't relax the sweep.
- [Risk] Migration number collision with #196 or #197. → D7, renumber at merge time.
- [Trade-off] 60 generated lines, of which 24 can be reached today. → Accepted: the rule stays
  total, and a future path can't fall back to English.

## Migration Plan

- **Deploy:** apply the new migration. It only replaces functions. No table, constraint, RLS, RPC
  signature or realtime change, and no existing row changes, so CI's fresh-stack database job
  covers it. A populated-stack run isn't required by the project rules.
- **Rollback:** a later migration restoring the one-argument `closed_line` and the 043 / 045
  definitions.
- **Verification:**
  - Locally: `npm test` and `npm run build:hant -- --check`.
  - In CI on the PR commit: the database job (all 16 reproduction cases pass, plus the new tests),
    the story job, and the checks job.

## Open Questions

- **The migration's final number.** Owner: the user, when it's this PR's turn. It affects only the
  file name.
