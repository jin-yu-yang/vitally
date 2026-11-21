# Brainstorm: collect the corrected Exit Form values at Return to signing (#203)

Brainstormed in conversation on 2026-11-20 and approved by the user. This file records that conversation.

## Background

Return to signing (`act_return_to_signing`, migration 035) moves a Rejected case back to Ready to exit
(`review_approved`) once an admin ticks "The fix is done.". It writes no review and no questionnaire, and changes
none of the `cases` filing columns. The payload is `{confirmed: true}` (`check_payload`, shared with
`MARK_READY_TO_EFILE`; latest copy in migration 046).

Since #173 (change `fix-exit-form-after-return-to-signing`, PR #205), the Exit Form after a Return to signing
prints only what ViTally holds:
- the header;
- the e-file or paper box of each settled return (method set, result not `rejected`).

It leaves everything else blank. The office panel and the volunteer's button carry the note "The return was
corrected after this review (Return to signing). This form prints only what ViTally holds. Fill in by hand:
<list>." The rule lives in `src/exit-form-source.mjs` (`exitFormSource`, `exitFormNote`). `exitFormMarks` in
`src/exit-form.mjs` draws whatever questionnaire-shaped object it is given.

That fix left the amounts blank on purpose. #173's design D2 rejected collecting the values then because it
"changes the RPC payload, needs a migration and a dialog". This change does that.

What exists to reuse:
- the reviewer questionnaire's Exit Form groups:
  - UI: `exitGroup` in `src/staff-views.mjs`, with "Clear this section" and collapsible `<details>`;
  - payload builder: `exitFormFrom` in `src/questionnaires.mjs`;
  - database check: `vitally_private.check_exit_form`, migration 033, which already refuses banking details.
- `reviewer_questionnaires` (migration 033), one row per review. Its read rule has since been narrowed to cleared
  staff (migrations 043, 045).
- The Return to signing dialog: `returnToSigningDialogBody` in `src/admin-views.mjs`; its payload builder is in
  `src/case-actions.mjs`.
- Mark e-filed's choices: `efiledChoices` in `src/admin-views.mjs`. After a Return to signing it offers only the
  rejected returns.

Main is at migration 052. Open PR #243 claims 053, so this change uses **054**.

## Decisions

**Q1. Must the admin enter the values?** No, they're **optional**. The groups are optional, as on the reviewer
questionnaire. A Return to signing with none of them keeps #173's behaviour exactly: the header, the settled
methods and the fill-by-hand note. Reason: nothing gets worse than today, and an admin who doesn't have the
figures yet isn't blocked.

**Q2. What do the groups start with?** They start **empty and closed**, with nothing carried over from the first
approval. Reason: this fits #173's rule that an older approval's values are never printed without someone
deciding they still hold. Retyping an unchanged return's figures is the accepted cost.

**Q3. How does the filing method work?** It's **locked if settled, chosen otherwise**.
- **A settled return** (method set, result not `rejected`): the group shows the case's method, fixed and not
  editable. The database refuses a group whose method differs from it.
- **The rejected return:** the admin picks the planned refile method.
- **The next Mark e-filed** starts with that planned method selected, and the admin can still change it.
- **On the Exit Form,** the case's method wins once the return is settled. Until then it shows the method
  entered at Return to signing.

Reason: the case's filing record stays the truth, and the hand-out printed at the second signing (before the
refile) still has a method.

**Q4. Which parts are collected?** **Federal, State, Other Tax (the Local entries) and Remarks**, the same parts
as the reviewer questionnaire. Reason: with every part entered, the form prints in full and nothing is left to
fill in by hand.

**Q5. What if only some groups are entered?** **The note lists only what's missing.**
- The form prints what was entered.
- The fill-by-hand note lists only the gaps:
  - a return with a filing method on the case but no group;
  - the rejected return's filing method, if it has no group;
  - Remarks, if empty.
- Other Tax left empty means none, as on the reviewer questionnaire.

Reason: a forgotten State group must not print silently as "no state result".

**Q6. Where are the values stored?** In a **new staff-only table**, approved by the user. See Approaches.

## Approaches considered (storage)

1. **A new table, `return_to_signing_exit_forms` (chosen).**
   - One row per Return to signing that carried values.
   - Columns: workspace, case, who entered it (person), when, `exit_form` jsonb under the same
     `check_exit_form` constraint, and `remarks`.
   - Read rule: the same as `reviewer_questionnaires`, so cleared staff can read it and a client can't.
   - Trade-off: a new table to add to the record loader, the realtime table list and the demo reset. It mirrors
     `reviewer_questionnaires` closely, so each step has a pattern to copy.
2. **The values in the `RETURN_TO_SIGNING` case event's `detail`.** Rejected:
   - `case_events` is a log;
   - `check_exit_form` can't constrain one action's detail without a special case;
   - amounts in history rows are harder to keep out of displays that render event detail.
3. **Reuse `reviewer_questionnaires` with a nullable `review_id`.** Rejected:
   - that table means "the reviewer's answers to one review", and its other columns (go-over, signing method,
     completed date) are required there and don't apply here;
   - every reader that maps a review to its questionnaire would have to learn the exception.

## The design as agreed

**Dialog.** Return to signing… stays admin-only and keeps "The fix is done.". Below it, it adds:
- optional collapsible Federal, State and Local groups, each with "Clear this section";
- a Remarks box.

A settled return's group shows its method fixed. A return with no method on the case has no group (my call, see
below).

**Payload.** `RETURN_TO_SIGNING` adds optional `exitForm` (`{federal, state, local}`, the reviewer's shape) and
`remarks`. With neither, the payload stays `{confirmed: true}` and nothing is stored. The database validates:
- `exitForm` with `check_exit_form`, which already refuses banking details;
- a settled return's group method must equal the case's method;
- Remarks may be up to 2000 characters, as on the reviewer questionnaire.

If any of these fails, the action is refused with `VALIDATION` and nothing changes.

**Exit Form.** `exitFormSource` looks at the latest `RETURN_TO_SIGNING` after the review's approval.
- **If that event stored values:**
  - the form prints them;
  - each method comes from the case when that return is settled, and from the stored values otherwise;
  - the note says the form was filled from the corrected values recorded at Return to signing on <date>, and
    lists only the gaps (Q5).
- **If it stored none:** #173's behaviour, unchanged.
- **If the case was returned to signing twice:** the latest Return to signing decides.

The PDF builder, the office panel and the volunteer's button all keep going through this one rule.

**Mark e-filed.** After a Return to signing whose values set a method for the rejected return, Mark e-filed's
choice starts with that method selected.

## Out of scope

- #204, the review-contact line in "Your next step" after a Return to signing.
- How the reviewer's own recorded answers are shown on the case page.
- Prefilling from the first approval (decided against, Q2).
- Any client-facing change: the client never sees the Exit Form or its values. Staff screens stay English, so no
  简体 or 繁體 text is added.

## Left to the builder (my calls, open to correction)

- **Linking a stored row to its event.** `act_return_to_signing` runs before `commit_action` inserts the case
  event, so it doesn't know the event's id. Proposed: the act inserts the row and returns `detail:
  {exitFormId: <row id>}`, so the `RETURN_TO_SIGNING` event points at its row. That `detail` holds only an id,
  never a value. The builder may choose another explicit link, but not a timestamp match.
- **No group for a return the case doesn't have.** The database refuses a Federal or State group for a return
  with no method on the case. After a Return to signing, Mark e-filed offers only the rejected returns, so no new
  return can appear.
- **The note's wording.** It will read like: "The return was corrected after this review (Return to signing).
  This form was filled from the corrected values recorded on <date>. Fill in by hand: <list>." The "Fill in by
  hand" sentence is dropped when nothing is missing. Final wording is settled in the delta spec.
- **Every per-case reset must also clear the new table:** the demo scenario reset and any later copies of it,
  where 033 deletes `reviewer_questionnaires`.
- **Demo fill:** the dialog's demo-fill button may fill one sensible group.
