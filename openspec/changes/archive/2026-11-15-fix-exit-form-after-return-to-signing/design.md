## Context

The Exit Form is PCDC's one-page hand-out for the client, printed at signing. It is built in the staff browser:
- `exitFormMarks` in `src/exit-form.mjs` draws the form from a reviewer questionnaire;
- `viewExitForm` in `src/app.mjs` finds the questionnaire by review id;
- the button appears in the volunteer's Independent review panel (`exitFormTool`) and in the office's Exit
  Form panel (`exitFormPanel`, `src/staff-views.mjs`).

Return to signing (`act_return_to_signing`, migration 035) moves a `rejected` case back to `review_approved`
once the office has ticked "The fix is done". It writes no review attempt and no questionnaire, and changes
none of the `cases` filing columns. A case has at most one approved review: approval works only from
`reviewing`, and nothing moves a case back to preparation afterwards. So after a Return to signing, the one
questionnaire there is describes the return before the fix. That is issue #173.

The browser's staff record already holds everything the fix needs:
- `internalHistory`, the `case_events` rows that every cleared staff member reads, including
  `RETURN_TO_SIGNING` with `createdAt`;
- `reviews[].decidedAt`;
- `federalMethod`, `stateMethod`, `federalResult` and `stateResult`.

The brief assumed a second approval that might lack a questionnaire. There is no second approval. The
brainstorm records the finding and the decisions the user approved.

## Goals / Non-Goals

**Goals:**
- After a Return to signing, no Exit Form path prints the earlier questionnaire's results, amounts, payment
  methods, Local entries or Remarks. The paths are the office panel, the volunteer's button and the PDF
  builder.
- Print what ViTally holds and has settled: the header, and the methods of returns that aren't awaiting a
  refile.
- Tell staff exactly what to fill in by hand.
- The office panel uses the latest approval, with no fallback.

**Non-Goals:**
- Collecting the corrected values at Return to signing (#203).
- The review-contact line after a Return to signing (#204).
- Any RPC, database or migration change.
- Changing how the reviewer's recorded answers are shown on the case page. They are a record, not the
  hand-out.

## Decisions

### D1: "The latest approval" is the review's approval, or a later Return to signing
- **Choice:** for an approved review R, a Return to signing supersedes R's questionnaire when
  `internalHistory` has a `RETURN_TO_SIGNING` entry whose `createdAt` is later than R's `decidedAt`.
- **Why:** Return to signing is the office approving the corrected return for signing. It is recorded as a
  case event that every staff page already loads, so no new data is needed.
- **Alternative considered:** inferring it from `filingAttempts`/`filingReturns` (a rejected return on a case
  that isn't at `rejected`). Rejected: closing and withdrawing also move a case off `rejected`, so the
  inference is indirect and fragile.

### D2: After a Return to signing, fill in what's known and leave the rest blank
- **Choice:** the form is still offered. It prints the header and the settled methods (D3) and leaves
  everything else blank, with a note (D5).
- **Alternatives considered:**
  - No Exit Form until there's a questionnaire. Rejected: no flow ever supplies one, so the client would get
    no hand-out at the second signing.
  - Collect the corrected values at Return to signing. Rejected for this fix: it changes the RPC payload,
    needs migration 051 and a dialog. Opened as #203.

### D3: A method is printed only when it is settled
- **Choice:** after a Return to signing, a return's e-file/paper box is ticked from the case's `<kind>Method`
  only when the method is set and `<kind>Result` is not `rejected`.
- **Why it ticks only filed returns:** Return to signing runs only from `rejected`, and
  `act_return_to_signing` refuses a case where a return has a method but no result. So at that moment every
  return with a method has a result:
  - accepted or given to the client: settled;
  - rejected: its new method is chosen only at the refile, so it is left blank.

  An empty result with a method set only appears after the refile, for an e-filed return awaiting
  acknowledgement. Its method is settled. This answers the user's check that "result empty" can't mean
  "not filed yet".
- **Alternative considered:** printing the questionnaire's method wherever it matches the columns. Rejected:
  it still reads the old questionnaire, and a match doesn't mean the method is settled.

### D4: One pure rule, used by every path
- **Choice:** a new module, `src/exit-form-source.mjs`, with no PDF or DOM dependencies, exports
  `exitFormSource(record, review)`. It returns:
  - `null` when the review offers no Exit Form: it isn't approved, has no questionnaire, or the record has no
    `internalHistory`, in which case it can't tell and refuses rather than risk old values;
  - otherwise `{ questionnaire, corrected, fillByHand }`.
    - With no later Return to signing: the stored questionnaire, `corrected: false`, `fillByHand: []`.
    - After one: a questionnaire built only from D3,
      `{ exitForm: { federal: {method}|null, state: {method}|null, local: [] }, remarks: "" }`,
      with `corrected: true` and `fillByHand` listing what's blank.

  `exitFormTool`, `exitFormPanel` and `viewExitForm` all go through it. `exitFormMarks` stays unchanged: a
  group with only `method` ticks the method and draws nothing else.
- **Why:** one rule can't drift between the button, the panel and the PDF. A module without dependencies can
  be unit-tested directly, and `staff-views.mjs` doesn't pick up the PDF imports.
- **Alternative considered:** a flag passed into `exitFormMarks`. Rejected: it spreads case knowledge
  (history, columns) into the drawing code.

### D5: The fill-by-hand note
- **Choice:** when `corrected`, the panel and the volunteer's button show:
  > "The return was corrected after this review (Return to signing). This form prints only what ViTally
  > holds. Fill in by hand: <list>."

  The list is built from `fillByHand`, in form order:
  - "the federal filing method", if not ticked;
  - "the Pennsylvania filing method", if not ticked;
  - "the federal and Pennsylvania refund or amount owed and how it is paid";
  - "Other Tax";
  - "Remarks".

  The office panel's "filled from the reviewer's answers for version N" line is replaced by this note.
  Staff screens stay English, so no 简体 or 繁體 text is involved.

### D6: The office panel uses the latest approved review, with no fallback
- **Choice:** `exitFormPanel` takes the last review with `status === "approved"`. If `exitFormSource` returns
  `null` for it, there is no panel.
- **Effect on tests:** the unit test that asserted the fallback is changed to assert no panel. The code it
  covered, the `&& reviewerQuestionnaireOf` filter in the panel's `find`, is removed.
- **Why:** the fallback is the mechanism the bug report names. Real data never reaches it, but it encodes
  the wrong rule.

### D7: Other readers checked, not changed
- **Filing methods on the case page:** current, read from the `cases` columns.
- **#200's closed lines:** current, built on the server from the same columns.
- **`contactStepLine`:** reads the old questionnaire's go-over after a Return to signing. Out of scope (it is
  not refund or method data), filed as #204.

## Risks / Trade-offs

- [Risk] The history arrives without a `RETURN_TO_SIGNING` entry (for example a list-shaped record).
  → Mitigation: with no `internalHistory` array, `exitFormSource` returns `null` (D4), so no form is offered
  rather than an old one. Staff case pages load the full record.
- [Risk] Clock skew between `decidedAt` and the event's `createdAt`. → Mitigation: both are written by the
  database's `now()` in different transactions, and Return to signing always comes after a filing that
  follows the approval, so the order is never close.
- [Trade-off] Staff fill in the amounts by hand after a Return to signing. → Accepted until #203. A blank is
  safer than a wrong figure.
- [Trade-off] A volunteer's button for the approved review also prints the reduced form after a Return to
  signing, although it sits on that review. → Accepted: the rule is "never print an older approval's
  values", and the reviewer's answers are still readable just above the button.

## Migration Plan

N/A: browser-only change, no database, RPC or deployment change. Rollback is reverting the commit.

## Open Questions

- #203 (owner: the team): whether to collect the corrected Exit Form values at Return to signing. It would
  replace D2's blanks with values.
- #204 (owner: the team): the review-contact line after a Return to signing. It affects "Your next step"
  only.
