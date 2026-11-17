## Context

The shaded section of Form 13614-C has five preparer cells for each household row 1–4 (`household<n><Column>`). Whether a row may hold cells is decided in five places. None of them reads the household Yes/No answer (`has_household_members`):

1. `act_save_preparer_fields` (migration 039, the only definition; 043–046 only dispatch to it): `least(jsonb_array_length(answers->'hh'),4)`.
2. `src/app.mjs` `shadedRules` → `readShaded` (the editor's Save and the upload): `Math.min(hh.length, 4)`.
3. `src/draft-form.mjs` `draftFields`: prints every stored shaded key and sets the "preparer entries" stamp from any of them.
4. `src/app.mjs` editing copy → `buildEditingCopy({ shaded })`: prefills every stored key.
5. `src/staff-views.mjs` case page: "N fields filled" counts every stored key.

The intake keeps answers that a later answer hides, so `answers.hh` survives a change to No. The draft's own household rows, the document cards and the 14446 consent use `visibleAnswers(2, answers)`, so they already hide such members.

Other readers were checked and need no change:
- the upload review list (`reviewRows`) only sees values `readShaded` accepted;
- the upload parser feeds `readShaded`;
- the history's changed list is computed in SQL;
- `server.mjs`, `tools/` and the controller don't read the values.

SQL already evaluates catalogue visibility: `vitally_private.intake_visible(version, field_id, answers, contact)` (migrations 011/027), called by submit as `intake_missing(p_case.intake_version, …)`.

## Goals / Non-Goals

**Goals:**
- One rule for "visible household rows", the same in the browser and the database, with a parity test.
- No household cell on a hidden row is accepted, printed, prefilled or counted.
- Cells already stored on rows that become hidden survive, never block a save, and return when the rows are visible again.

**Non-Goals:**
- Keying cells by household member rather than row number (issue #202).
- Removing the other hard-coded `visibleAnswers(2, …)` calls in `src/`.
- Any editor UI or wording change.

## Decisions

### D1: The rule follows the catalogue's visibility of `hh`
- **Choice:** visible rows = `min(number of hh members, 4)` when the catalogue shows the `hh` group, else 0.
- **Why:** it is exactly what the draft's own household table shows (`visibleAnswers(...).hh` sliced to 4), so the cells and the names next to them can't disagree. If the `showIf` ever changes, both sides follow it.
- **Alternative:** hard-code `has_household_members = 'yes'`. Rejected because it duplicates the catalogue and drifts silently if the condition changes.

### D2: One function per language, with a parity test
- **Choice:**
  - `src/shaded-fields.mjs` gets `householdRows(answers, { version })` and `visibleShaded(values, answers, { version })`. The second returns `values` without household keys on rows past `householdRows`.
  - SQL gets `vitally_private.household_rows(p_version smallint, p_answers jsonb) returns int`: `case when intake_visible(p_version,'hh',p_answers,'{}') and jsonb_typeof(p_answers->'hh')='array' then least(jsonb_array_length(p_answers->'hh'),4) else 0 end`. It is `stable`, `security definer`, `search_path=''`, with execute revoked from public/anon/authenticated/service_role like the other private helpers.
  - A database test runs one table of answer sets through both and asserts equal counts.
- **Why:** the user asked for one rule and a parity test.
- **Contact:** passed as `'{}'` because the `hh` condition reads no contact field, and the browser's `visibleAnswers` also sees answers only.
- **Counting:** both sides count array elements. Intake validation (`checkGroup`, and SQL on save) already refuses a member that isn't an object, so this matches the draft's count.

### D3: The case's own catalogue version, not a literal 2
- **Choice:**
  - SQL passes `p_case.intake_version`, as the submit path does.
  - The browser passes the case record's `intakeVersion` (mapped in `supabase-store.mjs`) and falls back to 2 when it is absent. 2 is the only version today (migration 023).
- **Why:** user addition 1. The rule keeps working when the catalogue moves to a version 3.
- **Nullability:** `cases.intake_version` is `smallint not null` (migration 011) and checked `intake_version = 2` (023), so SQL needs no fallback. Every case record the browser loads goes through `supabase-store.mjs`, which always maps `intakeVersion` from that column. The browser's fallback to 2 is therefore unreachable for real cases. It is kept only so that hand-built records without the field (unit-test fixtures) behave like today's version. The parity test needs no null case because neither side can meet one from the database.
- **Alternative:** the workspace's `default_intake_version`. Rejected because a case keeps the version it was made with.

### D4: Stored cells on hidden rows are kept, hidden and carried by each save
- **Choice:** in 050 the save first checks the payload, refusing any household key on a row past `household_rows` as before. It then stores `v_fields || (stored household entries on rows past household_rows)`. The changed-keys list compares old with the new stored value, so carried cells never appear in it. The browser never shows them: `visibleShaded` is applied to the editing copy, the draft and the case-page count.
- **Why:**
  - The intake keeps hidden answers, so the cells return with the members on Yes.
  - Dropping data the preparer can't see is the silent-loss pattern the team rejected in add-volunteer-clearance.
  - A save can't get stuck: hidden cells are never prefilled, so `readShaded` never sees them, and the database checks only the payload.
- **Alternative:** the next save drops them, which is today's whole-row replace. It is simpler, but it loses data whenever an unrelated field is saved while the answer is No.

### D5: Payload rule unchanged in shape
- **Choice:** a filled cell on a hidden row is refused with `VALIDATION`. The browser names it with the existing sentence "Row n has no household member, so <label> must be blank."
- **Why:** it is the same rule as today, with a correct row count. There is no new text, so nothing changes for Chinese.

### D6: Migration 050, gap tolerated
- **Choice:** `050_hidden_household_rows.sql` with `create or replace function` for both functions. `act_save_preparer_fields` starts from 039's body.
- **Why:** this is the agreed order (047 #197, 048 #200, 049 #196).
  - `tools/admin/migrate.mjs` applies files in sorted order and records each by name, with no contiguity check.
  - `nextCatalogueMigration` only runs when the catalogue changes, and this change leaves the catalogue alone.
  - The file will be renamed at merge time if the order changes.

## Risks / Trade-offs

- **[Risk]** Cells follow row numbers, not members. A kept cell on row 3 returns next to whoever is in row 3 later (remove Cal, add Dee). This already happens to visible rows when a member is removed. → Mitigation: out of scope, tracked in issue #202.
- **[Risk]** The JS and SQL rules drift. → Mitigation: the parity test runs the same table through both.
- **[Trade-off]** The spec's "A save replaces the section" becomes "replaces the visible section". The save is no longer a pure replace of the stored row. → Accepted for D4's reasons. Covered by a database test that a save of other fields keeps hidden cells.
- **[Risk]** 047–049 merge after 050 is applied on someone's stack. → They apply after it in name order, and none of them touches this function. Renaming at merge time is the agreed handling.

## Migration Plan

1. Migration 050 is additive (`create or replace`). No row changes, so CI's fresh stack is enough. No existing-row migration is needed.
2. Rollback: a later migration re-creates 039's `act_save_preparer_fields` body. `household_rows` can stay unused.
3. Acceptance: `npm test` locally. CI jobs `checks`, `database`, `sign-in`, and `story` in both browser orders, all green on the PR's head commit.

## Open Questions

- Migration number: 050 if the order holds. Owner: the user, at merge time. It affects only the file name.
