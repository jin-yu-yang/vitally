# Brainstorm: fix-contact-line-after-return-to-signing (#204)

The decisions were made in conversation on 2026-11-20 and 2026-11-21. This file records them; it does not reopen them.

## Background

Issue #204 is a follow-up from #173. `contactStepLine` (`src/staff-views.mjs`) writes the review-contact line in "Your next step" at `review_approved`. It reads the approval's reviewer questionnaire:

- "yes" gives "The reviewer went over the return with the client on <date>."
- "no" gives "The office will go over the return with the client."

After a Return to signing, the case is back at `review_approved` for a second signing, with methods on file (`returnedToSigning(record)` in `src/domain.mjs`). The panel's first line already reads "The client signs again. The office then marks it ready to e-file." (`RETURNED_TO_SIGNING_WORK`). The review-contact line under it still describes the first approval as if it were current:

- The "yes" variant reports a go-over of the return from before the fix, with nothing to say that it belongs to the first signing.
- The "no" variant promises an office go-over that will never happen.

The issue asks two things:

1. What should the line say after a Return to signing?
2. Should the go-over follow-up be raised again?

## Findings

- **Question 2 is already answered.** The canonical spec answers it in `case-lifecycle`, requirement "A rejected case returns to signing": back at Ready to exit, Mark ready to e-file is offered without waiting again for the reviewer's conversation or the office's go-over, "which were done the first time". `src/admin-views.mjs` (`markReadyToEfile`) and the database follow it. Raising the go-over again would change that requirement and the database's Mark ready to e-file check, and so would need a new migration. The user's no-migration rule still holds for #204, so this is out of scope.
- **Where the line is specified.** The current wording is pinned by `review-and-corrections`, requirement "An approval with a questionnaire settles the review-contact step", in its scenarios "Yes completes the step" and "No hands the step to the office". Neither scenario covers a Return to signing. PR #244 (#203, now merged) modified other requirements in that capability, not this one.
- **A resolved go-over does not prove the client was reached.** An office go-over task is closed by `RESOLVE_FOLLOWUP` with either outcome (reached or not reached), or it is cancelled when the case is closed. So "the office went over the return with the client" is not always true.
- **The same function feeds the review history.** The Independent review panel's "Client conversation" row (`reviewAttempts`) also calls `contactStepLine`. That row describes one review attempt, and the conversation it names did happen for that attempt.
- **The story already performs a Return to signing.** It's in `tests/browser.mjs`, after "Return to signing?", so the new line can be checked there.

## Decision chain

**Q1. After a Return to signing, what should the line under "The client signs again…" say?**
Options:
- past tense, placed at the first signing (recommended);
- nothing;
- one generic dated-less sentence.

**Decision: past tense, at the first signing.** Staff still see when the client was gone over with, and the line says it isn't repeated:

- Reviewer went over it: "At the first signing, the reviewer went over the return with the client on <date>. It isn't gone over again."

**Q2. The office variant: the go-over can close without reaching the client.**
Options:
- say only what is certain (recommended);
- use the task's outcome ("the office went over…" or "closed without reaching the client"), which needs the follow-up's outcome on the record.

**Decision: say only what is certain.**

- Passed to the office: "At the first signing, going over the return with the client was passed to the office. It isn't gone over again."

**Q3. Should the Independent review panel's "Client conversation" history row change?**
I first offered "leave it, but make the office variant past tense". I withdrew that after the finding about outcomes: it would need the task's outcome, and it would also change the first signing's display.

**Decision: leave the history row exactly as it is.** The stale first-signing "The office will go over the return with the client." (shown on the history row, and on the first signing's next step once the go-over has closed) goes into a separate follow-up issue. I draft it; the user files it.

## Resulting design

| Case at Ready to exit | Line under "The client signs again. The office then marks it ready to e-file." |
|---|---|
| Returned to signing, reviewer answered "yes" | "At the first signing, the reviewer went over the return with the client on <date>. It isn't gone over again." |
| Returned to signing, reviewer answered "no" | "At the first signing, going over the return with the client was passed to the office. It isn't gone over again." |
| Returned to signing, approval with no questionnaire (older data) | Unchanged: today's fallback, "The client conversation for this review is recorded. Nothing further is needed here." |
| First signing | Unchanged |

- **Where:** "Your next step" only. `contactStepLine` gains a returned-to-signing variant, chosen with the existing `returnedToSigning(record)`.
- **History row:** it keeps the current call and wording.
- **No other changes:** no database, migration, RPC, client-text or catalogue change. Staff screens stay English.

## Scope

- **In:** the review-contact line in "Your next step" at Ready to exit after a Return to signing.
- **Out:**
  - raising the go-over again;
  - the Independent review history row;
  - the first signing's lines, including the stale "office will go over" after the go-over has closed, which becomes the follow-up issue;
  - the database.

## Dependencies

- **Main, ready:**
  - `returnedToSigning` and `RETURNED_TO_SIGNING_WORK`;
  - the second-signing rule in `case-lifecycle`;
  - #205, #207 and #244 (#203), all merged.
- **No outside systems.**

## Acceptance

- **Unit tests** (`tests/staff-views.test.mjs`):
  - both returned-to-signing variants, including the date for "yes";
  - the older-data fallback after a Return to signing;
  - the first signing's two lines, unchanged;
  - the history row, unchanged after a Return to signing.
- **Story:** one assertion on the new line after the existing Return to signing step.
- **Checks:**
  - `npm test`;
  - `npx openspec validate --all`;
  - the browser story, run locally or by CI's `story` jobs standing in.
  - Not needed: database (no database work), sign-in (untouched) and `build:hant` (staff text only).
- **Follow-up:** a drafted issue for the stale first-signing line.

## Approaches considered

1. **A flag on `contactStepLine`, used only by "Your next step" (chosen).** This is the smallest change. The history row's call stays as it is, so it can't change by accident.
2. **A separate function for the second signing.** It would duplicate the questionnaire branching for no gain.
3. **Change the line through the record or store.** There's nothing to store: `returnedToSigning` already derives the state from the case.
