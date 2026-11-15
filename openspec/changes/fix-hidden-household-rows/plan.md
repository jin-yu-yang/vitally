# Hidden Household Rows (bug #175) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The shaded section's household cells follow the household the client actually shows (the Yes/No answer plus the members, at most 4 rows), the same way in the browser and the database. Cells already stored on rows that become hidden are kept but never printed, prefilled or counted.

**Architecture:** One browser rule in `src/shaded-fields.mjs` (`householdRows`, `visibleShaded`, built on the catalogue's `visibleAnswers`). One SQL rule in migration 050 (`vitally_private.household_rows`, built on `intake_visible`). A parity test runs the same table through both. Every reader of stored shaded values goes through `visibleShaded`. The save checks only the payload and carries hidden stored cells forward.

**Tech Stack:** Node test runner (`node --test`), plain ES modules, PostgreSQL/Supabase plpgsql, pg test fixture (`tests/support/database-fixture.mjs`).

**Spec:** `openspec/changes/fix-hidden-household-rows/` (`design.md`, `specs/shaded-section/spec.md`, `specs/draft-13614c/spec.md`, `brainstorm.md`).

## Global Constraints

- Fictional data only in tests: names like Lin, Kai, Ana.
- Migration file: `supabase/migrations/050_hidden_household_rows.sql`. Never edit 039 or any applied migration. Use `create or replace function`.
- Catalogue version: SQL uses `p_case.intake_version`. The browser uses the case record's `intakeVersion`, falling back to `2`. Never pass a bare literal 2 where the case is at hand.
- Rows cap: `4`. Visible rows are 0 unless the catalogue shows `hh` (its `showIf`: `has_household_members` eq `yes`).
- No client or staff text changes. The refusal sentence stays "Row n has no household member, so <label> must be blank."
- Local runs: `npm test` only, plus `npm run build:hant -- --check` and `npx openspec validate --all`. **Do not run `npm run db:migrate:test`, `npm run test:database`, `npm run test:auth-browser` or `npm run test:browser` locally.** The stack is shared with other sessions. Database tests are written now and run in CI (Task 6).
- No-hang rules for every implementer:
  - give every command a timeout;
  - never run a server in the foreground;
  - CI waits are bounded (`gh run watch` with `--exit-status`, under 40 minutes; or poll `gh run view` with a timeout);
  - if a command needs approval or the stack, report BLOCKED instead of waiting.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A save while hidden cells are stored, pressing Save with no change.** It must be accepted, not stuck on "Row 1 has no household member". Pinned in Task 2 (round trip through `readShaded`) and Task 5 (database).
2. **Members kept but the answer is No, then Yes again with the same members.** Cells come back. Pinned in Task 5.
3. **More than 4 members.** Rows 1–4 take cells, and no row 5 key exists. Pinned in Tasks 1 and 4 (parity table includes 6).
4. **No household answer at all (an old or partial case).** 0 rows on both sides. Pinned in Tasks 1 and 4.
5. **Only hidden cells stored.** The stamp reads "prepared from online answers", and the case page reads "0 fields filled". Pinned in Tasks 2 and 3.

---

### Task 1: The browser rule (`householdRows`, `visibleShaded`, `shadedCaseRules`)

**Files:**
- Modify: `src/shaded-fields.mjs` (add after `rowOf`, ~line 228; import `visibleAnswers` from `./intake-catalogue.mjs`)
- Modify: `src/app.mjs:1531-1541` (delete the local `shadedRules`; call sites at ~1603 and ~1662 use `shadedCaseRules`)
- Test: `tests/shaded-fields.test.mjs`

**Interfaces:**
- Produces:
  - `export const HOUSEHOLD_ROWS = 4`
  - `export function householdRows(answers, { version = 2 } = {}) -> number` (0–4)
  - `export function visibleShaded(values, answers, { version = 2 } = {}) -> object`: a new object without `household<n>…` keys where `n > householdRows(...)`. `null`/`undefined` values give `{}`.
  - `export function shadedCaseRules(record, workspace) -> { form: "en", householdSize, season }`: today's `shadedRules`, but `householdSize = householdRows(record?.answers, { version: record?.intakeVersion ?? 2 })`. The season logic is unchanged.

- [ ] **Step 1: Write the failing tests** in `tests/shaded-fields.test.mjs`:

```js
const KEPT = [{ first_name: "Lin" }, { first_name: "Kai" }];
const members = (n) => Array.from({ length: n }, (_, i) => ({ first_name: `M${i}` }));
test("householdRows follows the household answer and caps at 4", () => {
  assert.equal(householdRows({}), 0);
  assert.equal(householdRows({ has_household_members: "no", hh: KEPT }), 0);
  assert.equal(householdRows({ has_household_members: "yes", hh: [] }), 0);
  assert.equal(householdRows({ has_household_members: "yes", hh: members(1) }), 1);
  assert.equal(householdRows({ has_household_members: "yes", hh: members(3) }), 3);
  assert.equal(householdRows({ has_household_members: "yes", hh: members(4) }), 4);
  assert.equal(householdRows({ has_household_members: "yes", hh: members(6) }), 4);
  assert.equal(householdRows({ has_household_members: "yes", hh: "x" }), 0);
  assert.equal(householdRows({ has_household_members: "yes", hh: KEPT }, { version: 2 }), 2);
});
test("visibleShaded drops cells on hidden rows only", () => {
  const stored = { household1QualifyingChild: "yes", household2OwnSupport: "no", household3LowIncome: "na", incomeW2s: true };
  assert.deepEqual(visibleShaded(stored, { has_household_members: "no", hh: KEPT }), { incomeW2s: true });
  assert.deepEqual(visibleShaded(stored, { has_household_members: "yes", hh: KEPT }),
    { household1QualifyingChild: "yes", household2OwnSupport: "no", incomeW2s: true });
  assert.deepEqual(visibleShaded(null, {}), {});
});
test("the case's rules refuse row 1 once the answer is No", () => {
  const record = { answers: { has_household_members: "no", hh: KEPT }, intakeVersion: 2, season: 2026 };
  const { errors } = readShaded({ [shadedName("household1QualifyingChild")]: "yes" }, shadedCaseRules(record, null));
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /^Row 1 has no household member/);
});
test("hidden stored cells never block a Save with no change", () => {
  const stored = { household1QualifyingChild: "yes", incomeW2s: true };
  const record = { answers: { has_household_members: "no", hh: KEPT }, intakeVersion: 2, season: 2026 };
  const shown = visibleShaded(stored, record.answers, { version: record.intakeVersion });
  const raw = Object.fromEntries(Object.entries(shown).map(([k, v]) => [shadedName(k), v === true ? "On" : v]));
  assert.deepEqual(readShaded(raw, shadedCaseRules(record, null)), { values: { incomeW2s: true }, errors: [] });
});
```

- [ ] **Step 2: Run it to see it fail.** `node --test tests/shaded-fields.test.mjs` (timeout 120 s). Expected: FAIL, `householdRows is not a function` (or an import error).
- [ ] **Step 3: Implement** the three functions and `HOUSEHOLD_ROWS` in `src/shaded-fields.mjs`. `householdRows` uses `visibleAnswers(version, answers ?? {}).hh`: an array gives `Math.min(length, HOUSEHOLD_ROWS)`, otherwise 0. `visibleShaded` filters with the existing `rowOf`. Move `shadedRules` out of `src/app.mjs` as `shadedCaseRules`, import it there and replace both call sites.
- [ ] **Step 4: Run the tests.** `node --test tests/shaded-fields.test.mjs`, then `npm test` (timeout 600 s). Expected: PASS. If `intake-catalogue.mjs` importing into `shaded-fields.mjs` creates an import cycle, report it instead of restructuring.
- [ ] **Step 5: Commit.** `git add src/shaded-fields.mjs src/app.mjs tests/shaded-fields.test.mjs`, message "Shaded section: one rule for visible household rows (#175)".

### Task 2: The draft prints and stamps only visible cells; the editing copy holds only them

**Files:**
- Modify: `src/draft-form.mjs:389` (`draftFields` gets a `version` option) and the shaded loop (~line 460)
- Modify: `src/app.mjs:~1518` (editing copy's `draftFields` call) and `~1526` (`shaded:`), and `~1723` (the draft call)
- Test: `tests/draft-form.test.mjs`

**Interfaces:**
- Consumes: `visibleShaded(values, answers, { version })` from Task 1.
- Produces: `draftFields(answers, { form, reference, today, shaded, version = 2 })`. The shaded loop reads `visibleShaded(shaded, answers, { version })`, so `preparerEntries` is true only when a visible value prints.

- [ ] **Step 1: Write the failing tests** in `tests/draft-form.test.mjs`, next to "shaded values fill every form" (~line 572):

```js
const ROWS_1_2 = { household1QualifyingChild: "yes", household2QualifyingChild: "yes" };
const twoKept = (answer) => ({ ...MARRIED, has_household_members: answer, hh: MARRIED.hh.slice(0, 2) });
test("cells for members the client no longer shows don't print", () => {
  for (const form of ["en", "zh-s", "zh-t"]) {
    const { text, checks } = draft(twoKept("no"), { ...OPTIONS, form, shaded: { ...ROWS_1_2, incomeW2s: true } });
    assert.equal(text[shadedName("household1QualifyingChild", form)], undefined, form);
    assert.equal(text[shadedName("household2QualifyingChild", form)], undefined, form);
    assert.ok(checks.includes(shadedName("incomeW2s", form)), form);
  }
});
test("only hidden cells: the stamp says online answers only", () => {
  assert.equal(draft(twoKept("no"), { ...OPTIONS, shaded: ROWS_1_2 }).preparerEntries, false);
});
test("three visible members print rows 1 to 3", () => {
  const three = { ...MARRIED, has_household_members: "yes", hh: [0, 1, 2].map((i) => MARRIED.hh[i] ?? { first_name: `Ana${i}` }) };
  const shaded = { household1QualifyingChild: "yes", household2OwnSupport: "no", household3LowIncome: "na" };
  const { text } = draft(three, { ...OPTIONS, shaded });
  assert.equal(text[shadedName("household1QualifyingChild")], "Yes");
  assert.equal(text[shadedName("household2OwnSupport")], "No");
  assert.equal(text[shadedName("household3LowIncome")], "N/A");
});
```

  First check how many `hh` members `MARRIED` has. If it has fewer than 2, build the members inline with fictional names instead of slicing.
- [ ] **Step 2: Run it to see it fail.** `node --test tests/draft-form.test.mjs` (timeout 300 s). Expected: the first two tests FAIL, because the cells print and `preparerEntries` is true. The third passes, as a guard.
- [ ] **Step 3: Implement.** In `draftFields`, add `version = 2` to the options and compute `const values = visibleShaded(shaded && typeof shaded === "object" ? shaded : {}, answers ?? {}, { version })` in place of today's `values`. In `src/app.mjs`:
  - pass `version: state.savedCase?.intakeVersion ?? 2` to both `draftFields` calls;
  - for the editing copy, pass `shaded: visibleShaded(row?.fields ?? {}, state.draftAnswers ?? {}, { version: state.savedCase?.intakeVersion ?? 2 })` to `buildEditingCopy`.
- [ ] **Step 4: Run the tests.** `node --test tests/draft-form.test.mjs tests/draft-pdf.test.mjs`, then `npm test` (timeout 600 s). Expected: PASS.
- [ ] **Step 5: Commit.** Add `src/draft-form.mjs src/app.mjs tests/draft-form.test.mjs`, message "Draft 13614-C: print and stamp only visible household cells (#175)".

### Task 3: The case page counts only visible cells

**Files:**
- Modify: `src/staff-views.mjs:1193-1195`
- Test: `tests/staff-views.test.mjs` (near "the review box", ~line 3185)

**Interfaces:**
- Consumes: `visibleShaded` from Task 1. The record supplies `answers` and `intakeVersion`.

- [ ] **Step 1: Write the failing test:**

```js
test("the case page counts only the cells it can show", () => {
  const record = staffCase({
    stage: "preparing",
    answers: { has_household_members: "no", hh: [{ first_name: "Lin" }, { first_name: "Kai" }] },
    preparerShadedFields: [{ caseId: staffCase().id, version: 1,
      fields: { incomeW2s: true, household1QualifyingChild: "yes", household1OwnSupport: "no" } }],
  });
  assert.match(shadedFor({}, record), /1 field filled/);
});
test("only hidden cells: 0 fields filled", () => {
  const record = staffCase({
    stage: "preparing",
    answers: { has_household_members: "no", hh: [{ first_name: "Lin" }] },
    preparerShadedFields: [{ caseId: staffCase().id, version: 1, fields: { household1QualifyingChild: "yes" } }],
  });
  assert.match(shadedFor({}, record), /0 fields filled/);
});
```

  If `staffCase(overrides)` does not merge `answers`, read how `staffCase` is built and pass the answers the way it expects.
- [ ] **Step 2: Run it to see it fail.** `node --test tests/staff-views.test.mjs` (timeout 300 s). Expected: FAIL with "3 fields filled" and "1 field filled".
- [ ] **Step 3: Implement.** `const filled = Object.keys(visibleShaded(row?.fields ?? {}, record?.answers ?? {}, { version: record?.intakeVersion ?? 2 })).length;`
- [ ] **Step 4: Run the tests.** `npm test` (timeout 600 s). Expected: PASS.
- [ ] **Step 5: Commit.** Add `src/staff-views.mjs tests/staff-views.test.mjs`, message "Case page: count only visible shaded cells (#175)".

### Task 4: Migration 050, `household_rows`, plus the JS/SQL parity test

**Files:**
- Create: `supabase/migrations/050_hidden_household_rows.sql`
- Test: `tests/database-shaded.mjs`

**Interfaces:**
- Consumes: `householdRows` from Task 1 (in the parity test).
- Produces: `vitally_private.household_rows(p_version smallint, p_answers jsonb) returns int`. It is stable, `security definer`, `set search_path=''`, with `revoke all … from public, anon, authenticated, service_role`.

- [ ] **Step 1: Write the failing tests** in `tests/database-shaded.mjs`, after "the season bound and the household rows are the case's":

```js
const PARITY = [
  {}, { has_household_members: "no", hh: [{ first_name: "Lin" }, { first_name: "Kai" }] },
  { has_household_members: "yes", hh: [] },
  ...[1, 3, 4, 6].map((n) => ({ has_household_members: "yes", hh: Array.from({ length: n }, (_, i) => ({ first_name: `Ana${i}` })) })),
];
test("the browser and the database count the same household rows", async () => {
  const f = await createDatabaseFixture();
  try {
    for (const answers of PARITY) {
      const { rows } = await f.sql("select vitally_private.household_rows(2::smallint,$1::jsonb) as n", [JSON.stringify(answers)]);
      assert.equal(Number(rows[0].n), householdRows(answers, { version: 2 }), JSON.stringify(answers));
    }
  } finally { await f.close(); }
});
test("Yes, two members, then No: row 1 is refused", async () => {
  const f = await createDatabaseFixture();
  try {
    const caseId = await preparingCase(f);
    await f.sql(`update public.cases set answers=answers||'{"has_household_members":"no","hh":[{"first_name":"Lin"},{"first_name":"Kai"}]}'::jsonb where id=$1`, [caseId]);
    await assert.rejects(() => save(f, caseId, { household1QualifyingChild: "yes" }, 0), rejected("VALIDATION"));
    assert.equal(await stored(f, caseId), undefined);
  } finally { await f.close(); }
});
```

  Import `householdRows` next to `SHADED_FIELDS`. The second test is task 1.1's reproduction, which fails on `main`.
- [ ] **Step 2: Can't run locally** (see Global Constraints). Confirm the file parses: `node --check tests/database-shaded.mjs`. Expected: no output.
- [ ] **Step 3: Write `050_hidden_household_rows.sql`:**
  1. A header comment: bug #175, the rule, which function it redefines (039's), that it will be renamed at merge time if the 047–049 order changes, and that `p_contact` is `'{}'` because `hh` reads no contact field.
  2. `household_rows`: `select case when vitally_private.intake_visible(p_version,'hh',p_answers,'{}'::jsonb) and pg_catalog.jsonb_typeof(p_answers->'hh')='array' then least(pg_catalog.jsonb_array_length(p_answers->'hh'),4) else 0 end`.
  3. `create or replace function vitally_private.act_save_preparer_fields(...)`, copied from 039 (lines 127–170) with exactly two changes:
     - `v_hh:=vitally_private.household_rows(p_case.intake_version,p_case.answers);` replaces the `jsonb_typeof`/`least` block;
     - after the payload check, `v_fields:=v_fields||coalesce((select jsonb_object_agg(o.key,o.value) from jsonb_each(coalesce(v_old,'{}'::jsonb)) o where o.key~'^household[1-4]' and substring(o.key from 10 for 1)::int>v_hh),'{}'::jsonb);`. It must run after the `VALIDATION` checks and before the insert, so the stored row and the changed list both use the merged set.
  4. 039 sets no grant or revoke on `act_save_preparer_fields`, and `create or replace` keeps its privileges, so add none. Before writing, check that 043–046 don't redefine it (only their dispatch mentions it).
- [ ] **Step 4: Check statically.** `npm test` (timeout 600 s) still passes, and `tests/targets.test.mjs` accepts the file name (`isMigrationFile`). Expected: PASS.
- [ ] **Step 5: Commit.** Add `supabase/migrations/050_hidden_household_rows.sql tests/database-shaded.mjs`, message "Migration 050: household_rows and the save keeps hidden cells (#175)".

### Task 5: The database tests for the save rules

**Files:**
- Test: `tests/database-shaded.mjs`

**Interfaces:**
- Consumes: migration 050 (Task 4). Fixture helpers `preparingCase`, `save`, `stored`, plus the history query used by "history names the changed keys for staff only" (~line 322). Read it and reuse its query.

- [ ] **Step 1: Write the tests** (each in its own fixture workspace; never assert on other workspaces' rows):
  - `"Yes with three members: rows 1 to 3, not 4"`: set `has_household_members:"yes"` and three `hh` members. `save(..., { household1QualifyingChild:"yes", household2OwnSupport:"no", household3LowIncome:"na" }, 0)` is accepted. Then `save(..., { household4CostOfHome:"na" }, 1)` is rejected with `VALIDATION`, and version stays 1.
  - `"hidden cells are kept, unnamed, and come back"`:
    1. With Yes and 2 members, save `{ household1QualifyingChild:"yes", household2QualifyingChild:"yes" }` at 0.
    2. Set `has_household_members:"no"`. `save(..., { incomeW2s:true }, 1)` is accepted.
    3. `stored(...).fields` deep-equals `{ household1QualifyingChild:"yes", household2QualifyingChild:"yes", incomeW2s:true }`.
    4. The newest staff history detail `changed` deep-equals `["incomeW2s"]`.
    5. Set `has_household_members:"yes"` again. `save(..., { household1QualifyingChild:"no", incomeW2s:true }, 2)` is accepted, and `fields.household1QualifyingChild === "no"` (visible again, so the payload replaces it).
  - `"only hidden cells stored: an empty save is accepted"`: with hidden stored cells (as above, after No), `save(..., {}, v)` is accepted and the hidden cells stay.
- [ ] **Step 2: Check the syntax.** `node --check tests/database-shaded.mjs`. Expected: no output.
- [ ] **Step 3: Commit.** Message "Database tests: hidden household cells (#175)".

### Task 6: Docs, specs check, and CI

**Files:**
- Modify: `docs/developer/database.md` (the `SAVE_PREPARER_FIELDS` / `act_save_preparer_fields` passage, and the migrations list if it has one)

- [ ] **Step 1: Update the docs.** Describe:
  - the visible-rows rule and `vitally_private.household_rows(version, answers)`;
  - that the save replaces the visible section and carries stored household cells on hidden rows;
  - migration 050, "renamed at merge time if the order changes";
  - a link to issue #202 for the row-position limit.
- [ ] **Step 2: Run the local checks** (timeout 600 s each): `npm test`, `npm run build:hant -- --check`, `npx openspec validate --all`. Expected: all pass, and build:hant reports nothing to change.
- [ ] **Step 3: Commit.** Message "Docs: hidden household rows and migration 050 (#175)".
- [ ] **Step 4: Push and run CI.**
  1. `git fetch origin && git merge origin/main` (stop and report on conflicts).
  2. `git push -u origin fix-hidden-household-rows`, then `gh workflow run ci.yml --ref fix-hidden-household-rows`.
  3. Wait on the run bounded (`gh run watch <id> --exit-status`, under 40 minutes).
  4. Expected: `checks`, `database`, `sign-in`, and both `story` legs pass.
  5. On a failure, read the job log and the recorded error first. Don't rerun blindly. Report the failing job and its error.
