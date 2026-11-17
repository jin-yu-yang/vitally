<!--
Raw capture of superpowers:brainstorming output.
-->

# Brainstorm: fix-hidden-household-rows (bug #175)

Agreed with the user in conversation on 2026-11-15 (CLAUDE.md lifecycle step 2), plus three additions the user gave when approving.

## Background

A client answers Yes to "Did anyone live with you or receive financial support from you in 2025?" (`has_household_members`), adds 2 members, then changes the answer to No. The members stay in `answers.hh`, because the intake keeps hidden answers. So:

- the preparer can still fill household rows 1–2 in the shaded section (the save check accepts them), and
- those cells print on the draft 13614-C.

The draft's own household rows (names, dates of birth), the document cards and the 14446 consent already hide the members, because they read `visibleAnswers(2, answers).hh`. Only the shaded-section path ignores the Yes/No answer.

## Findings: every place that decides "how many household rows"

| # | Where | Today |
|---|---|---|
| 1 | `supabase/migrations/039_preparer_shaded_fields.sql` `act_save_preparer_fields` (~line 150) | `least(jsonb_array_length(answers->'hh'),4)` |
| 2 | `src/app.mjs` `shadedRules` (~line 1533) → `readShaded` for the editor's Save and the upload | `Math.min(answers.hh.length, 4)` |
| 3 | `src/draft-form.mjs` `draftFields` (shaded loop + "preparer entries" stamp) | prints every stored key |
| 4 | `src/app.mjs` editing copy (~line 1526) → `buildEditingCopy({ shaded })` | prefills every stored key |
| 5 | `src/staff-views.mjs` (~line 1193) case-page summary "N fields filled" | counts every stored key |

Found while confirming the list (user addition 2). Every other reader was checked and is fine:
- the upload review list (`reviewRows`) shows only values that already passed `readShaded`;
- the upload parser (`draft-pdf.mjs` `readEditingCopy`) feeds `readShaded`;
- the staff history's changed-key list comes from the database (see Q3);
- `server.mjs`, `tools/` and the controller have no readers and no exports.

`act_save_preparer_fields` is defined only in 039. 043–046 only dispatch to it.

## Decisions

**Q1. What is the rule?**
Visible household rows = `min(number of hh members, 4)` while the catalogue shows the `hh` group (its `showIf`: `has_household_members = yes`), else 0. The rule comes from the catalogue's condition, not from a hard-coded `has_household_members` check, so it agrees with `visibleAnswers` and the draft's own household rows.

**Q2. One rule, two languages.**
- Browser: `householdRows(answers, version)` and `visibleShaded(values, answers, version)` in `src/shaded-fields.mjs`, built on `visibleAnswers`. All five places above use them.
- Database: `vitally_private.household_rows(p_version smallint, p_answers jsonb)`, built on the existing `vitally_private.intake_visible(version,'hh',answers,contact)`.
- A parity test runs one table of answer sets through both and expects the same counts.

**Q2a (user addition 1). Catalogue version.**
Don't hard-code 2. SQL passes `p_case.intake_version`, as the existing `intake_missing(p_case.intake_version, …)` callers do. The browser passes the case record's `intakeVersion` (from `supabase-store.mjs`), falling back to 2, the only version today (migration 023). The other hard-coded `visibleAnswers(2, …)` calls in `src/` are not touched; that is out of scope.

**Q3. Stored cells on rows that are now hidden.**
Options:
- (A) keep them stored but hidden: they don't print, aren't shown or counted, and come back if the client answers Yes again;
- (B) the next save drops them.

Chosen: **A**.
- The intake works the same way: on No, `hh` itself is kept and returns on Yes, so the cells about those people return with it.
- Dropping data the preparer cannot see is silent data loss. The team ruled against it in add-volunteer-clearance, where a save deleted certificates the drawer never showed.

What A costs:
- The save stores the sent fields plus the stored household cells on hidden rows.
- The spec's "A save replaces the section" becomes "replaces the visible section".
- Carried-over cells are unchanged, so they never appear in the staff history's changed list.

Either way, a save must not fail just because stale hidden cells are stored. The editing copy is not prefilled with them (so `readShaded` never sees them), and the database checks only the payload.

**Q4. The payload check stays strict.**
A filled cell on a hidden row in the payload is still refused with `VALIDATION`, and the browser names it ("Row n has no household member…", existing text). The editor UI and wording don't change, so there is no client text and no Chinese change.

**Q5. Stamp.**
"DRAFT – online answers and preparer entries" counts only visible values. A case whose only stored values are hidden cells reads "prepared from online answers".

**Q6. Migration number.**
050, by the agreed order (#197 = 047, #200 = 048, #196 = 049). It will be renamed at merge time if the order changes.
- `tools/admin/migrate.mjs` applies files in sorted name order and records each by name, with no contiguity check, so a 047–049 gap doesn't break `db:migrate:test`.
- `nextCatalogueMigration` uses the highest number plus one, and only when the catalogue changes. This change doesn't touch the catalogue.

050 redefines `act_save_preparer_fields` with `create or replace`, starting from 039's body, and adds `household_rows`.

**Q7 (user addition 3). Row-position limit.**
Cells follow row numbers, not members: remove a member, add someone else, and the old row's cells print next to the new person. This already happens to visible rows. It is out of scope, tracked in issue #202, and linked from design.md and the PR body.

## Scope

- **In:** one household-row rule across the database save, the editor and upload checks, the editing copy, the draft (cells and stamp) and the case-page count; keeping stale hidden cells; migration 050; `docs/database.md`; delta specs for `shaded-section` and `draft-13614c`.
- **Out:** keying cells by member (#202); other hard-coded catalogue versions; editor UI changes.

## Dependencies

All ready:
- the catalogue tables (`intake_fields`) and `intake_visible` (migrations 011/027);
- `cases.intake_version`;
- the browser record's `intakeVersion`;
- CI's fresh Supabase stack.

## Acceptance

- **Failing first:**
  - a database test: a save with `household1…` while the answer is No is accepted today and must be refused;
  - a unit test: `draftFields` with No and stored row-1 cells prints them today and must print none.
- **Then:**
  - Yes → 2 members → No allows no rows and prints none;
  - Yes with 3 members accepts rows 1–3 and refuses row 4;
  - with stale cells stored, a save of other fields succeeds and keeps them, and they return on Yes;
  - hidden cells don't print, don't set the stamp, aren't prefilled and aren't counted;
  - the JS and SQL rules agree.
- **Checks:**
  - locally only `npm test` (the stack is shared with other sessions);
  - CI must pass on all jobs: `checks`, `database`, `sign-in`, and `story` in both browser orders.
