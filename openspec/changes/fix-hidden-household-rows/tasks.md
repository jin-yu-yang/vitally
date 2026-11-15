## 1. Reproduce with failing tests

- [x] 1.1 Database test (`tests/database-shaded.mjs`): on a preparing case with two `hh` members and `has_household_members` changed to `no`, a save with `household1QualifyingChild` is refused with `VALIDATION` (fails today: it is accepted)
- [x] 1.2 Unit test (`tests/draft-form.test.mjs`): `draftFields` for answers with `has_household_members: "no"`, two kept `hh` members and stored row 1–2 cells prints no row 1–2 cell (fails today: they print)

## 2. One rule in the browser

- [x] 2.1 `src/shaded-fields.mjs`: `householdRows(answers, { version })` (catalogue visibility of `hh` via `visibleAnswers`, capped at 4, version falls back to 2) and `visibleShaded(values, answers, { version })`, with a unit table: no answer, No with kept members, Yes with 0/1/3/4/6 members, a non-array `hh`
- [x] 2.2 `src/app.mjs` `shadedRules`: `householdSize` from `householdRows(record.answers, { version: record.intakeVersion })`; unit test that `readShaded` refuses row 1 when the answer is No and names it
- [x] 2.3 `src/draft-form.mjs` `draftFields`: print and stamp from `visibleShaded` (new `version` option, default 2); `src/app.mjs` passes the case's `intakeVersion`; unit tests: Yes → 2 → No prints none, Yes with 3 prints rows 1–3, only hidden cells → "prepared from online answers"
- [x] 2.4 `src/app.mjs` editing copy: `shaded` is `visibleShaded(stored, answers, { version })`; unit test that `buildEditingCopy` (or the helper feeding it) holds no hidden cell while visible values stay
- [x] 2.5 `src/staff-views.mjs`: "N fields filled" counts `visibleShaded`; unit test "1 field filled" for W-2s plus two hidden row 1 cells

## 3. One rule in the database (migration 050)

- [x] 3.1 `supabase/migrations/050_hidden_household_rows.sql`: `vitally_private.household_rows(p_version smallint, p_answers jsonb)` on `intake_visible`, private revokes; `create or replace` of `act_save_preparer_fields` from 039's body, using `household_rows(p_case.intake_version, p_case.answers)` for the payload check and storing the sent fields plus stored household cells on hidden rows
- [x] 3.2 Database tests: Yes with 3 members accepts rows 1–3 and refuses row 4; Yes → 2 → No refuses row 1; stale cells kept across a save of other fields, not named in the history, and back on Yes; a save with only hidden stored cells and an empty payload is accepted
- [x] 3.3 Parity test: one table of answer sets through `householdRows` (JS) and `vitally_private.household_rows` (SQL), equal counts

## 4. Docs, specs and checks

- [x] 4.1 `docs/database.md`: the save keeps hidden household cells; `household_rows` and the rule; migration 050
- [x] 4.2 `npm test`, `npm run build:hant -- --check` (no text change expected), `npx openspec validate --all`
- [ ] 4.3 CI on the pushed branch: `checks`, `database`, `sign-in`, `story` (both legs) green on the head commit; story screenshots reviewed
