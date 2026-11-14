# Brainstorm: closed lines after a filing (issue #170)

Decision log of the design agreed in conversation on 2026-11-14, before propose.

## Background

Issue #170: a client reads "Your return was not filed" on a case that was closed after a return
was filed. The client could then file again somewhere else.

Root cause, found during reproduction:

- `vitally_private.closed_line(p_reason)` (migration 036, line 391) chooses the client's history
  line from the close reason alone. Its callers are `act_close_case` (latest definition in 043) and
  `vitally_close_unsigned` (latest definition in 045). Neither passes the case's filing columns.
- The client's status panel has the same flaw on the client side: `holdClosedKey` / `describeStage`
  in `src/domain.mjs` picks `stage.closed.client.<reason>` from the reason alone.

Reproduction: branch `fix-closed-lines-after-filing`, commit 16e2b06, CI run 43567350441.
`tests/database-closed-after-filing.mjs` fails all 16 subtests. `tests/closed-after-filing.test.mjs`
fails for the status panel. Nothing else failed.

Every close path that can reach a case with a filed return:

| # | Path | Reasons with a "not filed" line |
|---|---|---|
| 1 | Close at Rejected, other return accepted | dismissed, withdrawn, out_of_scope |
| 2 | Close at Rejected, other return still waiting | dismissed, withdrawn, out_of_scope |
| 3 | Close at Rejected, other return given to the client on paper | dismissed, withdrawn, out_of_scope |
| 4 | Return to signing, then close at Ready to exit | withdrawn |
| 5 | Return to signing, Ready to e-file, then close | withdrawn |
| 6 | Return to signing, Hold, then close the Hold | dismissed, withdrawn, out_of_scope |
| 7 | Return to signing, then the season-end close | dismissed |
| 8 | Return to signing, Hold, then the season-end close | dismissed |

The client's own Withdraw can't reach a filed case: it isn't offered at Ready to exit, Rejected or later.

## Decisions

**Q1. Is a return given to the client on paper "filed"?**
It's in scope. The client still has to mail it, so the line must say so.

**Q2. Both returns rejected?**
"Not filed" stays, because nothing was filed. A test pins today's line for this case.

**Q3. Which reasons change?**
- dismissed, withdrawn and out_of_scope change when a return was filed.
- no_need_to_file changes too, because its sentence ("you don't need to file a return this year")
  contradicts a filed return.
- duplicate stays as is.
- other, and no reason (cases closed before reasons existed), keep today's generic line. That line
  makes no claim about filing.

**Q4. The staff follow-up line.**
It's in this change. "The case was closed before filing; make sure the return is not transmitted in
TaxSlayer." is false after Return to signing when a return was filed. When a return was already
filed, the follow-up reads instead: "The case was closed after a return was filed; make sure the
rejected return is not transmitted again in TaxSlayer."
The withdrawn variant ("The client withdrew; make sure the return is not transmitted in TaxSlayer.")
stays: it is not false.

**Q5. How the line is built (user's direction).**
The line is the reason sentence, then one sentence per return, federal first, because one return
can be filed and the other not.
- The reason sentences keep their first half and drop the fixed "Your return was not filed."
- When nothing was filed, the result reads exactly as today.

Per-return sentences:

| Outcome | English | 简体 |
|---|---|---|
| accepted | Your federal return was filed and accepted. Do not file it again. | 您的联邦报税表已递交并被接受。请勿再次递交。 |
| e-filed, waiting | Your federal return was e-filed and is waiting for an answer. Do not file it again. | 您的联邦报税表已电子递交，正在等待回复。请勿再次递交。 |
| paper, given to the client | PCDC gave you your Pennsylvania return on paper. It is filed only after you mail it. | PCDC 已将纸质的宾州报税表交给您。您寄出后才算递交。 |
| rejected / not filed | Your Pennsylvania return was not filed. | 您的宾州报税表未递交。 |

For the other return, swap federal / 联邦 and Pennsylvania / 宾州.

**Q6. "Pennsylvania", not "state".**
Every existing client filing line says Pennsylvania / 宾州, so these lines do too. (Agreed.)

**Q7. Reason first halves.**

| Reason | English | 简体 |
|---|---|---|
| dismissed | PCDC could not reach you, so this application was closed. | PCDC 无法联系到您，因此此申请已关闭。 |
| withdrawn | You withdrew this application. | 您已撤回此申请。 |
| out_of_scope | This application was closed because the return is outside what VITA volunteers can prepare. | 此申请已关闭，因为该报税表超出了 VITA 志愿者可以准备的范围。 |
| no_need_to_file (filed) | A PCDC volunteer confirmed with you that nothing more needs to be prepared this year, so this application was closed. | PCDC 志愿者已与您确认，今年没有其他需要准备的报税表，因此此申请已关闭。 |

The user's first draft for no_need_to_file was "anything more to file". It was rejected because it
contradicts the paper sentence (the client still mails that return).
The paper sentence uses 纸质, not 纸本 (user's correction).

**Q8. "No Pennsylvania return needed" versus "not filed".**
The schema can't tell them apart:
- the `cases` constraint (037) is `(federal_method is null) = (state_method is null)`;
- `act_mark_efiled` refuses a first filing that doesn't name both returns.

So per-return sentences appear only when both methods are set. "Was not filed" for one return
always means it was rejected. Kept as "was not filed", and recorded in design.md as a known limit:
the system assumes every case has both returns.

**Q9. One rule, two places.**
The SQL `closed_line` reads the case's methods and results. `src/domain.mjs` holds the same rule in
JS for the status panel. A database test checks that the two give the same text. (Agreed.)

**Q10. Translating history lines.**
`historyLine` → `sentence()` translates a stored English line by looking up the whole line. Two
options:
- generate every combination's (English, 简体) pair from the same JS rule into `SENTENCES` (chosen);
- split stored lines into sentences when translating (rejected: adds a parser, and partial
  translations could leak).

The generated set is exactly 60 lines:
- 4 reasons (dismissed, withdrawn, out_of_scope, no_need_to_file);
- × 15 outcome pairs: 4 × 4 per-return outcomes, minus not-filed / not-filed.

Only 6 pairs can happen today: a rejected return plus the other accepted, waiting or on paper.
Generating all 15 means no row can fall back to English. The four nothing-filed lines, and the
duplicate, other and no-reason lines, are today's lines, already in the table.

`tools/hant-sources.mjs` collects every `SENTENCES` value, so `npm run build:hant` writes 繁體 for the
generated lines too.

**Q11. The exhaustive test (user's request).**
The test covers every combination, not only the 8 paths:
- 7 reasons (the 6 plus null) × 17 filing states (both methods null, plus 4 × 4 per-return states
  with methods set).
- It calls SQL `closed_line` directly for each.
- It asserts the English line equals `describeStage`'s English for the same row.
- It asserts `sentence(line, "zh-Hans")` has an entry and equals `describeStage`'s 简体.

**Q12. Lines already stored.**
They aren't rewritten. The spec already says earlier history lines keep their words.

## Approaches considered

1. **Chosen: one rule in SQL and JS, with generated translations.** The history line is computed
   once, at close time, from the case row. The status panel computes the same text from the same
   columns. A parity test keeps the two in step. It fits how the rest of the client text works:
   SQL writes English sentences, and the client translates them through `SENTENCES`.
2. **The status panel reads the stored history line.** That gives one source, but it breaks
   language switching: the stored line is English, and translation needs the table anyway. It also
   changes how the panel works for every closed case.
3. **Store per-return parts separately**, as a JSON detail on the client event. That changes the
   client event contract (realtime messages). It's heavier than the bug warrants.

## Constraints carried in

- New migration only. Never edit 036 or 037.
- The migration number is not picked yet: main is at 046, and #197 and #196 will take 047 and 048
  unless this merges first. Renumber when it's this PR's turn.
- Another session (#197) shares the local stack. Only `npm test` runs locally; database and story
  checks run through CI. Avoid files #196 and #197 change (`tests/database-actions.mjs` is the
  likely overlap).
- Don't merge the PR.
