## Context

"Your next step" at Ready to exit (`review_approved`) in `src/staff-views.mjs` shows two lines:

1. **The stage sentence.** After a Return to signing (`returnedToSigning(record)`: the stage is `review_approved` and the case has a federal method), it is `RETURNED_TO_SIGNING_WORK`: "The client signs again. The office then marks it ready to e-file."
2. **The review-contact line** from `contactStepLine(attempt, questionnaire)`. It is built from the latest approval's reviewer questionnaire. It returns null for an approval without one, and the panel then falls back to the contact-status branch.

The Independent review panel (`reviewAttempts`) calls the same `contactStepLine` for each attempt's "Client conversation" history row.

**Constraints:**
- **No re-raised go-over.** `case-lifecycle` ("A rejected case returns to signing") says the second signing doesn't wait again for the reviewer's conversation or the office's go-over. The database's Mark ready to e-file check follows it.
- **No migration.** The user's no-migration rule holds for this change.
- **Staff screens stay English.**

## Goals / Non-Goals

**Goals:**
- After a Return to signing, the review-contact line places the first approval's conversation at the first signing and says it isn't repeated.
- The line says only what ViTally knows for certain.

**Non-Goals:**
- Raising the go-over follow-up again, or changing Mark ready to e-file's checks.
- Changing the Independent review panel's history row.
- Changing the first signing's lines. That includes the stale "The office will go over the return with the client." after the go-over has closed, which becomes a separate issue.
- Database, client-text or catalogue changes.

## Decisions

### D1: Where the second-signing line is chosen
- **Choice:** `contactStepLine` takes an optional third argument, `{ returned }`. Only "Your next step" passes `returned: returnedToSigning(record)`. `reviewAttempts` keeps its two-argument call.
- **Reason:** the questionnaire branching stays in one function. The history row can't change by accident, because it never passes the flag.
- **Alternatives considered:**
  - A separate function for the second signing. It would duplicate the yes/no/no-questionnaire branching.
  - Deciding inside `contactStepLine` from the record. It would also change the history row, and the function would need the whole record.

### D2: Wording for an approval answered "yes"
- **Choice:** "At the first signing, the reviewer went over the return with the client on <date>. It isn't gone over again." It uses the same `staffDate(questionnaire.wentOverOn)` as today.
- **Reason:** staff still see when the conversation happened, and the line no longer reads as current.
- **Alternatives considered:**
  - No line. That loses the date.
  - One generic sentence. That also loses the date and the reviewer/office split.

### D3: Wording for an approval answered "no"
- **Choice:** "At the first signing, going over the return with the client was passed to the office. It isn't gone over again."
- **Reason:** an office go-over is closed by `RESOLVE_FOLLOWUP` with either outcome, or cancelled when the case closes. So "the office went over it" isn't always true, and the hand-over is.
- **Alternative considered:** wording from the go-over task's outcome. It needs the follow-up's outcome on the case record, and the same logic would be expected on the first signing too, which is out of scope.

### D4: An approval without a questionnaire
- **Choice:** `contactStepLine` still returns null when there is no questionnaire, whatever the flag. The panel's existing fallback stays.
- **Reason:** that older data predates the questionnaires. The fallback, "The client conversation for this review is recorded. Nothing further is needed here.", is already true at a second signing.

## Risks / Trade-offs

- [Trade-off] The history row still says "The office will go over the return with the client." for a "no" approval, after a Return to signing too. → Accepted: it is a per-attempt record and is covered by the planned follow-up issue for the stale first-signing wording.
- [Risk] The story's Return to signing case may have a "yes" or a "no" approval, so its assertion only covers one variant. → Mitigation: unit tests cover both variants. The story checks whichever text its seed produces.
- [Risk] Text-only tests may still match the old sentence as a substring of the new one. → Mitigation: assert the full new sentence, and assert that the old "The office will go over…" is absent after a Return to signing.

## Migration Plan

N/A. This change involves no deployment change: no database, migration or endpoint. Rollback is a revert of the commit.

## Open Questions

None. The follow-up issue for the stale first-signing line is drafted during apply. The user files it.
