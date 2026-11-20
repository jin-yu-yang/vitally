## Context

The Exit Form is PCDC's one-page hand-out, printed at signing in the staff browser:
- `exitFormMarks` (`src/exit-form.mjs`) draws it from a questionnaire-shaped object
  `{exitForm: {federal, state, local}, remarks}`;
- `exitFormSource` (`src/exit-form-source.mjs`) decides which object to draw, for the office panel
  (`exitFormPanel`), the volunteer's button (`exitFormTool`) and `viewExitForm` in `src/app.mjs`.

Return to signing (`act_return_to_signing`, migration 035) is admin-only and runs from `rejected` once every
return has an answer. It moves the case to `review_approved` and stores nothing else. `check_payload` accepts
only `{confirmed: true}` for it (latest copy in migration 046). Since #173, `exitFormSource` treats a
`RETURN_TO_SIGNING` event after the review's `decidedAt` as superseding the questionnaire. It then prints only the
header and the settled methods, with a fill-by-hand note.

The reviewer questionnaire already has everything the dialog needs:
- the groups: `exitGroup` in `src/staff-views.mjs`, collapsible, with "Clear this section";
- the parser: `exitFormFrom` in `src/questionnaires.mjs`;
- the database check: `vitally_private.check_exit_form`, migration 033, which refuses unknown keys and therefore
  any banking detail;
- the read rule: `reviewer_questionnaires`, active cleared staff of the workspace, as narrowed by migrations 043
  and 045.

`commit_action` (migration 008) inserts the case event after the act function returns, from the outcome's
`detail`.

The user's decisions are in `brainstorm.md` (Q1–Q6). Main is at migration 052, and open PR #243 claims 053, so
this change is migration 054.

## Goals / Non-Goals

**Goals:**
- An admin can record the corrected Federal, State, Other Tax and Remarks at Return to signing, all optional.
- The Exit Form after a Return to signing prints those values, takes methods from the case once settled, and
  names only what's still missing.
- The rejected return's planned method carries into the next Mark e-filed as a preselection.
- The values are staff-only, and no banking detail can be stored.

**Non-Goals:**
- #204 (the review-contact line after a Return to signing).
- Prefilling from the first approval.
- Changing how the reviewer's recorded answers are shown.
- Any client screen or client text change.
- Editing the values after the Return to signing. A later correction needs another rejection and Return to
  signing, as today.

## Decisions

### D1: A new table, `return_to_signing_exit_forms`
- **Choice:** columns:
  - `id`, `workspace_id`, `case_id`;
  - `entered_by_person_id`;
  - `created_at default now()`;
  - `exit_form jsonb not null`, under `check(vitally_private.check_exit_form(exit_form))`;
  - `remarks text`, null or 1 to 2000 characters.

  The foreign key `(workspace_id, case_id)` references `cases` with `on delete cascade`. Row-level security:
  select for authenticated users with exactly `staff_reviewer_questionnaires`' rule. No client policy and no
  write grant: writes go only through `act_return_to_signing`.
- **Why:** a review's questionnaire belongs to that review. Copying the pattern of `reviewer_questionnaires` keeps
  the read rule, the constraint and the loader the same.
- **Alternatives considered:** values in the case event's `detail` (a log, and harder to constrain and to keep out
  of history displays); a nullable `review_id` in `reviewer_questionnaires` (its required go-over and signing
  columns don't apply here). See `brainstorm.md`, Approaches.

### D2: The event points at its row
- **Choice:** when values are stored, `act_return_to_signing` inserts the row and returns
  `detail: {exitFormId: <id>}`, so the `RETURN_TO_SIGNING` event carries the id. Without values, `detail` stays
  `{}`. `historySentence` renders no detail key for this action, so nothing new shows in History.
- **Why:** the act runs before `commit_action` writes the event, so the event can't be referenced from the row.
  An id in `detail` is an explicit link, and it isn't a value.
- **Alternative considered:** matching the row and the event on `created_at`. Both are `now()` in one
  transaction, but the match is implicit and breaks if either default changes.

### D3: The payload and its validation
- **Choice:** `check_payload`'s `RETURN_TO_SIGNING` branch is split from `MARK_READY_TO_EFILE` and accepts:
  - keys `⊆ {confirmed, exitForm, remarks}`, with `confirmed = true`;
  - `exitForm`, if present, passing `check_exit_form`;
  - `remarks`, if present, a 1–2000-character string.

  Present but empty (`federal` and `state` null, `local` empty, no `remarks`) is accepted and stores nothing.

  `act_return_to_signing` adds the case-dependent rules, refusing with `VALIDATION` before any change:
  - a Federal or State group for a return with no method on the case;
  - a group whose method differs from a settled return's method (settled = method set and result not
    `rejected`).

  A rejected return's group may carry either method.
- **Why:** the shape rules belong to `check_payload`, as for other actions. The rules that need the case row
  belong to the act, as Mark e-filed's do.
- **Alternative considered:** a new action type, `RECORD_CORRECTED_EXIT_FORM`. Rejected: the values describe this
  Return to signing, and two actions would let them be recorded apart from it or twice.

### D4: The dialog reuses the reviewer's groups
- **Choice:** `returnToSigningDialogBody` renders, after "The fix is done.":
  - a short lead ("Optional: the corrected Exit Form values. Leave a part empty to fill it in by hand.");
  - Federal and State groups only for returns the case has, through `exitGroup`, made shareable from
    `src/staff-views.mjs`, with its own field scope;
  - the five Local groups;
  - a Remarks textarea.

  A settled return's group shows its method as fixed text with a hidden input carrying the value, instead of the
  method radios. The groups start closed and empty. A group the admin typed in stays open after a refused submit,
  as `groupsToOpen` does for the reviewer.

  The payload builder in `src/case-actions.mjs` calls `exitFormFrom` and adds `exitForm` only when some group is
  filled, and `remarks` only when not blank. A group left with only its fixed method counts as not filled.
- **Why:** one set of group fields, one parser and one database check mean the two Exit Form inputs can't drift.

### D5: `exitFormSource` reads the latest Return to signing's row
- **Choice:**
  - Find the latest `RETURN_TO_SIGNING` in `internalHistory` after the review's `decidedAt`.
  - If its `detail.exitFormId` matches a row in `record.returnToSigningExitForms`, build the questionnaire from
    that row: each Federal or State group's `method` is replaced by the case's method when that return is
    settled.
  - `fillByHand` lists, in form order:
    - "the federal filing method" / "the Pennsylvania filing method", for a return with no group and no
      settled method;
    - "the federal refund or amount owed and how it is paid" / "the Pennsylvania …", for a return the case has
      a method for but that has no group;
    - "Remarks", when empty.

    There's no Other Tax item, because empty means none.
  - The note reads: "The return was corrected after this review (Return to signing). This form was filled from
    the corrected values recorded on <date>." When `fillByHand` is not empty, it adds " Fill in by hand: <list>."
  - Without a matching row, or without `detail.exitFormId`: #173's result, unchanged.
  - A missing `returnToSigningExitForms` array counts as no rows.

  The return value adds `recordedAt`.
- **Why:** the latest Return to signing decides, so a second rejection and Return to signing without values falls
  back to #173's blanks rather than an older Return to signing's figures.

### D6: Mark e-filed preselects the planned method
- **Choice:** `efiledChoices`, for a case with rejected returns, finds the planned method from the same latest
  Return to signing row. It selects the matching choice. If there are two rejected returns with different planned
  methods, it selects the matching combination. With no row, nothing is preselected, as today.
- **Why:** the decision from Q3. The case's filing record is still set only by Mark e-filed.

### D7: Every per-case reset clears the table
- **Choice:** migration 054 redefines the demo scenario reset, `vitally_private.apply_fixture_scenario`, from its
  latest copy (migration 039), adding
  `delete from public.return_to_signing_exit_forms` next to `reviewer_questionnaires`. `on delete cascade` covers
  deleted cases. The table joins `STAFF_TABLES` in `src/supabase-store.mjs` and the realtime publication, as
  `reviewer_questionnaires` does.

## Risks / Trade-offs

- [Risk] An admin enters stale figures copied from the first approval. → Mitigation: the groups start empty (Q2),
  so any figure is typed on purpose.
- [Risk] The planned refile method differs from the method actually used at Mark e-filed. → Mitigation: the
  case's method wins on the Exit Form once settled (D5). Before the refile, the form shows the plan, which is
  what the client is told at signing.
- [Risk] `check_payload` is redefined in a long function that other open branches may also redefine (PR #243). →
  Mitigation: migration 054 copies from main at the time of writing, and is rebased onto #243's 053 if that
  merges first. The plan's last task checks this before the PR.
- [Trade-off] The values can't be edited after the Return to signing. → Accepted: it matches the reviewer
  questionnaire, which is also write-once. A mistake is corrected by hand on the printed form.
- [Trade-off] A new table in the staff record and the realtime subscription. → Accepted: it's small, and
  mirrors an existing one.

## Migration Plan

- Migration 054 adds the table and its row-level security and grants, and replaces `check_payload`,
  `act_return_to_signing` and `apply_fixture_scenario` with `create or replace`.
- The old payload `{confirmed: true}` stays valid, so a browser not yet reloaded keeps working.
- Rollback: a forward migration that drops the table and restores the earlier function bodies. Applied migrations
  are never edited.
- Verification: `npm test`, `npm run db:migrate:test` with `npm run test:database`, and `npm run test:browser`.
  Sign-in and Chinese client text aren't touched.

## Open Questions

- None blocking. The note's final wording (D5) is fixed in the delta spec. Owner: this change.
