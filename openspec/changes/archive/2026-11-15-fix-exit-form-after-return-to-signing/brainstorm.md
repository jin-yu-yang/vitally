# Brainstorm: fix-exit-form-after-return-to-signing

Issue #173: "The Exit Form after Return to signing still prints the first approval's refund and filing methods."

## Background (what the code does today)

- The brief assumed a case is approved, returned to signing, changed and **approved again**, and that the
  panel falls back to the first approval when the second has no questionnaire.
- The code shows otherwise. **A case has at most one approved review.** `APPROVE_REVIEW` runs only from
  `reviewing`, and nothing moves a case from `review_approved` or later back to preparation.
- **Return to signing writes no review and no questionnaire.** `act_return_to_signing` (migration 035,
  section 8b) only moves `rejected → review_approved`, after the office ticks "The fix is done."
  The fix itself is recorded only as free-text fix notes (`filing_notes`).
- So after a Return to signing the Exit Form (`exitFormPanel` and `exitFormTool` in `src/staff-views.mjs`;
  `viewExitForm` in `src/app.mjs`; `exitFormMarks` in `src/exit-form.mjs`) is filled from the one
  questionnaire there is: the approval of the return *before* the fix. The client signs the corrected
  return and is handed the old refund amounts, payment methods and filing methods.
- A rejected return's new method (e-file again, or paper given to the client) is chosen only at the refile
  (Mark e-filed, 037 `act_mark_efiled`), which comes after the second signing.
- `exitFormPanel` picks "the latest approved review that has a questionnaire". The fallback can't be
  reached with real data (every approval since 033 must carry a questionnaire), but an existing unit test
  (`tests/admin-views.test.mjs`, "…uses the latest approval that has one") asserts it as intended.

## Decision chain

**Q1. What is "the latest approval"?**
The review's approval, or a Return to signing if one came after it. Return to signing is the office's
approval of the corrected return ("PCDC corrected your return. You need to sign it again."). Staff pages
can see it: every cleared staff member reads `case_events`, which the case page loads as
`internalHistory`, and it includes `RETURN_TO_SIGNING` entries.

**Q2. The latest approval has no questionnaire (a Return to signing). Options:**
1. Fill in what's known, leave the rest blank. *(chosen)*
2. No Exit Form until there is a questionnaire. Rejected: no flow ever gives one, so the client would
   leave the second signing with no hand-out.
3. Ask the office for the corrected Exit Form values at Return to signing. This would fill the form
   properly, but it changes the RETURN_TO_SIGNING payload, needs migration 051 and a dialog: a feature,
   not a bug fix. Opened as **#203**.

The user chose option 1.

**Q3. Can the `cases` filing columns supply anything "known"?** (the user's question)
Partly:
- Return to signing changes none of the columns. At that point both returns have been filed. The function
  refuses a case where a return has a method but no result, so every return has a result: accepted,
  rejected, or given to the client.
- A return that wasn't rejected keeps its method and answer, so its method is settled and correct.
- The rejected return still holds the method that was rejected, and its new method is chosen only at the
  refile. Leave it blank.
- After the refile, the refiled return's method is in the columns. Its result is empty while an e-file
  awaits acknowledgement, or `given_to_client` for paper. That method is settled.

**Rule (user-approved):** after a Return to signing, tick a return's e-file/paper box from the columns
only when the method is set and the result is not `rejected`. Leave everything else blank:
- a rejected, not-yet-refiled return's method;
- the result (refund, owe, none), amounts, how it's paid and the debit date (not stored);
- the Local (Other Tax) entries, though the rows still print for hand filling;
- the Remarks.

**Q4. The user's check: can a return have an empty result before it's filed, and so be ticked?**
No. Return to signing runs only from `rejected`, which needs a filing and a recorded result, and
`act_return_to_signing` refuses a return that has a method but no result. An empty result with a method
set only appears after the refile: an e-filed return awaiting acknowledgement, a settled method. The rule
"method set and result not rejected" therefore ticks only filed returns. The unit tests cover the
refiled-awaiting case, and a return with no method (nothing ticked).

**Q5. Where does the rule apply?**
Everywhere an Exit Form is made: the office's Exit Form panel, the review's "Download Exit Form" on a
volunteer's case page, and the PDF builder (`viewExitForm`), so that no path prints the old values. The
reviewer's recorded answers on the case page stay as they are: they are a record, not the client's
hand-out.

**Q6. The panel note.** After a Return to signing, the panel says the return was corrected after the
review and names exactly what to fill in by hand for this case. Example: "Fill in by hand: the federal
filing method; the federal and state refund or amount owed and how it is paid; Other Tax; Remarks."
The volunteer's button carries the same note.

**Q7. The panel's fallback.** The panel uses the latest approved review, with no fallback to an earlier
one. If that review has no questionnaire, there is no panel. The fallback test is changed to assert this.
The code it covered (the `&& reviewerQuestionnaireOf` filter in the panel's `find`) is what changes.

**Q8. Other readers of the approval's answers (checked, not changed):**
- the case page's filing methods: read from the `cases` columns, current;
- #200's closed lines: built on the server from the same columns;
- `contactStepLine` (`review_approved` "Your next step"): still reports the first approval's go-over
  after a Return to signing. It's about the go-over, not refunds or methods, so it's out of scope.
  Opened as **#204**.

## Scope

**In:** the Exit Form after a Return to signing (panel, volunteer button, PDF builder) never prints the
old questionnaire's values; it prints the header, the settled methods from the columns and a
fill-by-hand note; the panel uses the latest approval with no fallback.

**Out:** RPCs, database and migrations (none needed); the review-contact line (#204); collecting
corrected values (#203).

## Dependencies

All ready, and all in the browser's staff record: `internalHistory` (`RETURN_TO_SIGNING`, `createdAt`),
`reviews[].decidedAt`, `federalMethod`/`stateMethod`/`federalResult`/`stateResult`.

## Acceptance

- **Unit (`npm test`):**
  - approved → rejected → Return to signing: no old values; the not-rejected return's method ticked; the
    rejected return's method blank; the note names what's blank;
  - after the refile: the refiled method ticked (e-file awaiting acknowledgement, and paper);
  - a return with no method: nothing ticked;
  - no Return to signing: the full questionnaire, from both the panel and the volunteer's button;
  - the latest approval without a questionnaire: no panel, no fallback.
- The canonical spec delta in `review-and-corrections`, and the docs that describe the Exit Form.
- Locally only `npm test` (and `build:hant --check` if any client text is touched; staff text is English).
  The database, sign-in and story suites run in CI, all green.
