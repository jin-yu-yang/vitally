## 1. Client text and the shared rule

- [x] 1.1 Add the reason halves (`closed.reason.<reason>` for dismissed, withdrawn, out_of_scope, no_need_to_file) and the per-return sentences (`closed.return.<federal|state>.<accepted|waiting|paper|not_filed>`) to `TEXT` in `src/client-text.mjs`, in English and 简体, exactly as in the delta spec
- [x] 1.2 Export `closedLine(reason, federal, state, lang)` from `src/client-text.mjs`: it composes the reason half, the federal sentence and the Pennsylvania sentence (space-joined in English, unjoined in 简体, `toHant` in 繁體), and returns null for any other reason or when neither outcome is filed (design D2, D3)
- [x] 1.3 Add the 60 composed English→简体 lines to `SENTENCES` at module load from `closedLine` (4 reasons × 15 outcome pairs with a filed return)
- [x] 1.4 Add `returnOutcome(method, result)` to `src/domain.mjs` (design D1), and make `describeStage` give `closedLine` for a closed case with a filed return; every other closed case keeps today's key
- [x] 1.5 Add `CLOSED_AFTER_FILING_NOTICE_REASON` to `src/domain.mjs` and to `BEFORE_FILING_NOTICE_REASONS` (no edit to `src/office-views.mjs`)
- [x] 1.6 Extend `tests/closed-after-filing.test.mjs` with exact expected texts (en, 简体, 繁體) for the delta spec's scenarios, nothing-filed and duplicate cases unchanged, and the notice list; run `npm test` until the unit reproduction passes
- [x] 1.7 Run `npm run build:hant`, commit `src/zh-hant.mjs`, and check `npm run build:hant -- --check`

## 2. The database

- [ ] 2.1 Add the both-rejected pin (today's line, exactly) and the staff-notice tests (after-filing text on path 6 with Dismissed; today's text with no filed return) to `tests/database-closed-after-filing.mjs`
- [ ] 2.2 Add the exhaustive parity test to `tests/database-closed-after-filing.mjs`: 7 reasons × 17 filing states, SQL `closed_line` equals `describeStage` English, `sentence(line, "zh-Hans")` has an entry and equals `describeStage` 简体
- [ ] 2.3 Write the migration `supabase/migrations/047_closed_lines_after_filing.sql` (number provisional, design D7): the five-argument `closed_line`, `act_close_case` from 043 and `vitally_close_unsigned` from 045 verbatim except the marked lines, then drop `closed_line(text)` after a grep shows no other caller
- [ ] 2.4 Run `npm test` locally; push, and run CI (`gh workflow run ci.yml --ref fix-closed-lines-after-filing`) for the database, story and checks jobs; read failures before re-running

## 3. Spec and docs

- [ ] 3.1 Check that no existing test or doc states the old line for a filed case; update `docs/developer/` only if it describes `closed_line`'s signature
- [ ] 3.2 Run `npx openspec validate --all`
