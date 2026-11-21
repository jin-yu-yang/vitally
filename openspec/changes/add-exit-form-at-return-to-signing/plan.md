# Corrected Exit Form values at Return to signing: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At Return to signing, an admin can record the corrected Exit Form values. The Exit Form then prints them, and Mark e-filed preselects the planned method (#203).

**Architecture:**
- Migration 054 adds the staff-only table `return_to_signing_exit_forms`. `act_return_to_signing` writes it, and the `RETURN_TO_SIGNING` event's `detail.exitFormId` points at the row.
- In the browser, one pure rule, `src/exit-form-source.mjs`, decides what the Exit Form prints and which method Mark e-filed preselects.
- The dialog reuses the reviewer questionnaire's group fields (`exitGroup`), parser (`exitFormFrom`) and database check (`check_exit_form`).

**Tech Stack:** Supabase Postgres (PL/pgSQL, row-level security, realtime), plain ES modules in the browser, `node:test`, Playwright.

**Spec:** `openspec/changes/add-exit-form-at-return-to-signing/`:
- `design.md` (D1–D7);
- `specs/case-lifecycle/spec.md`;
- `specs/review-and-corrections/spec.md`;
- `brainstorm.md` (decisions Q1–Q6).

## Global Constraints

- Fictional data only in tests and fixtures.
- Migrations are hand-written, and applied ones are never edited. This change adds only `supabase/migrations/054_return_to_signing_exit_forms.sql`. Redefined functions are copied from their **latest** copy, with `-- 054` on changed lines (the repo's convention):
  - `check_payload`: latest is migration 046;
  - `act_return_to_signing`: 035.
  - (Not `apply_fixture_scenario`: migration 040 dropped it, found during Task 1. Rows go with their case through
    `on delete cascade`; see design D7.)
- Staff screens stay English. No client text, 简体 or 繁體 changes.
- No account number, routing number or other banking detail is ever stored. `check_exit_form` already refuses unknown keys, so reuse it and don't loosen it.
- Remarks: at most 2000 characters, as on the reviewer questionnaire.
- The old payload `{confirmed: true}` must stay valid and behave exactly as before.
- Run the local stack from `$VITALLY_STACK`, never `supabase start` from the repo root.
- Exact copy (the specs):
  - Note without stored values (unchanged): `"The return was corrected after this review (Return to signing). This form prints only what ViTally holds. Fill in by hand: <list>."`
  - Note with stored values: `"The return was corrected after this review (Return to signing). This form was filled from the corrected values recorded on <date>."`, plus `" Fill in by hand: <list>."` only when the list isn't empty.
  - Gap items: `"the federal filing method"`, `"the Pennsylvania filing method"`, `"the federal refund or amount owed and how it is paid"`, `"the Pennsylvania refund or amount owed and how it is paid"`, `"Remarks"`.
  - `<date>`: the New York date of the Return to signing event, as `toLocaleDateString("en-US", {timeZone: "America/New_York", month: "long", day: "numeric", year: "numeric"})`, for example "November 2, 2026".

## Review Focus

1. **An admin opens a settled return's group and types nothing.** Its hidden fixed method alone must not send a group, or the parser would say "choose Refund, Owe or None". Test in Task 5.
2. **Returned to signing twice: first with values, then without.** The second form must print none of the first one's values. Test in Task 4.
3. **History must show nothing new** for a `RETURN_TO_SIGNING` event whose `detail` carries `exitFormId`. Test in Task 4.
4. **A refused submit**, for example an amount of `12.345`, must keep the typed group open with its values, and the case must stay Rejected. Test in Task 5 (unit) and Task 7 (story).
5. **A case with only a federal return** (state method null): the dialog has no State group, and the note never lists a Pennsylvania item. Tests in Tasks 4 and 5.

---

### Task 1: Migration 054, the table, its access and realtime

**Files:**
- Create: `supabase/migrations/054_return_to_signing_exit_forms.sql`
- Create: `tests/database-return-to-signing-exit-form.mjs` (picked up by `npm run test:database`'s `tests/database*.mjs`)
- Modify: `tests/database-realtime.mjs` (the table list near line 472)

**Interfaces:**
- Produces: table `public.return_to_signing_exit_forms(id uuid pk default gen_random_uuid(), workspace_id uuid not null, case_id uuid not null, entered_by_person_id uuid not null, created_at timestamptz not null default now(), exit_form jsonb not null, remarks text)`.
  - FK `(workspace_id, case_id)` → `cases(workspace_id, id)` on delete cascade.
  - FK `(workspace_id, entered_by_person_id)` → `people(workspace_id, id)`.
  - `check(vitally_private.check_exit_form(exit_form))`.
  - `check(remarks is null or char_length(remarks) between 1 and 2000)`.
  - Policy `staff_return_to_signing_exit_forms`: select only, the same `using(...)` as `staff_reviewer_questionnaires` in migration 045 line 222, with the table name swapped.
  - Grants copied from `reviewer_questionnaires`: revoke all from public, anon, authenticated; grant select to authenticated; full grants to service_role.
  - Added to the `supabase_realtime` publication the way migration 033 adds `reviewer_questionnaires` (lines ~105–115).

- [ ] **Step 1: Write the failing access tests** in `tests/database-return-to-signing-exit-form.mjs`, using `createDatabaseFixture` and `rejected` from `./support/database-fixture.mjs`. Insert a row as superuser through `f.sql` for a Rejected case. Then:
  - `"an applicant reads no corrected values"`: the case's applicant client selects 0 rows.
  - `"a cleared staff member reads them"`: 1 row.
  - `"an uncleared staff member reads none"`: 0 rows, following the clearance pattern in `tests/database-clearance.mjs`.
  - `"staff can't insert directly"`: an insert as the site coordinator's client rejects.
  - `"exit_form must pass check_exit_form"`: a superuser insert with `{federal: {method: "efile", result: "refund", amount: "1.00", refundBy: "direct_deposit", accountNumber: "1"}, state: null, local: []}` rejects.
  - `"remarks over 2000 characters are refused"`.
  - ~~`"the scenario reset clears the table"`~~: not done. Migration 040 dropped `apply_fixture_scenario`.
- [ ] **Step 2: Add the table to `tests/database-realtime.mjs`**, as `reviewer_questionnaires` is at line 472: staff receive a change, and the applicant receives none.
- [ ] **Step 3: Run the tests to see them fail.** Run `npm run db:migrate:test`, then `node --env-file=.env.test --test tests/database-return-to-signing-exit-form.mjs tests/database-realtime.mjs`. Expected: FAIL, the relation doesn't exist.
- [ ] **Step 4: Write migration 054's table part:**
  - the table, constraints, policy, grants and publication above;
  - ~~`apply_fixture_scenario` copy~~: not done. Migration 040 dropped it; the table's `on delete cascade` foreign keys cover deleted cases and workspaces (design D7).
- [ ] **Step 5: Run the tests to see them pass.** Run `npm run db:migrate:test` and the Step 3 command. Expected: PASS.
- [ ] **Step 6: Commit.** Message: `Migration 054: return_to_signing_exit_forms table, staff-only access, realtime (#203)`.

### Task 2: Migration 054, the payload and `act_return_to_signing`

**Files:**
- Modify: `supabase/migrations/054_return_to_signing_exit_forms.sql`
- Modify: `tests/database-filing.mjs:384-385` (the "extra key" refusal stays, alongside the new valid keys)
- Test: `tests/database-return-to-signing-exit-form.mjs`

**Interfaces:**
- Consumes: the Task 1 table.
- Produces: `RETURN_TO_SIGNING` payload `{confirmed: true, exitForm?: {federal: Group|null, state: Group|null, local: LocalGroup[]}, remarks?: string}`. `Group` is the reviewer questionnaire's shape (`method`, `result`, `amount?`, `refundBy?`, `oweBy?`, `debitOn?`).
  - The event's `detail` is `{exitFormId: "<uuid>"}` when a row is stored, and `{}` otherwise.
  - "Values given" means `exitForm` has a non-null federal or state group or a non-empty local list, or `remarks` is present.

- [ ] **Step 1: Write the failing tests.** Make a helper `rejectedCase({federal, state}, results)` like `answeredCase` in `tests/database-filing.mjs:340-360`. Tests:
  - `"no values: nothing stored, detail empty"`: `{confirmed: true}` gives stage `review_approved`, 0 rows, and the last `RETURN_TO_SIGNING` event `detail` is `{}`.
  - `"empty values store nothing"`: `{confirmed: true, exitForm: {federal: null, state: null, local: []}}` gives 0 rows.
  - `"values are stored once and linked"`: federal rejected, state accepted (both e-file). Payload: `exitForm: {federal: {method: "paper", result: "refund", amount: "1250.00", refundBy: "direct_deposit"}, state: {method: "efile", result: "refund", amount: "85.00", refundBy: "check"}, local: [{type: "NPT", method: "paper", result: "none"}]}`, `remarks: "Corrected dependent SSN"`. Then 1 row whose `exit_form` equals the payload's and whose `remarks` matches, `entered_by_person_id` is the site coordinator's person, and the event's `detail.exitFormId` equals the row id.
  - `"a settled method can't change"`: the same case, with a state group of `method: "paper"`. Rejects with `VALIDATION`; stage stays `rejected`; 0 rows.
  - `"no group for a missing return"`: a case with `state_method` null and a state group. Rejects with `VALIDATION`.
  - `"banking details, bad amounts and unknown keys are refused"`: each of `accountNumber` in a group, `amount: "12.345"`, a top-level `extra: 1`, and `remarks` of 2001 characters rejects with `VALIDATION`, changing nothing.
  - `"a volunteer can't return to signing"`: unchanged rule. A cleared volunteer sending values is refused as today, and 0 rows.
- [ ] **Step 2: Run them to see them fail.** Run `node --env-file=.env.test --test tests/database-return-to-signing-exit-form.mjs`. Expected: the new tests FAIL with `VALIDATION`, because the payload keys are refused today.
- [ ] **Step 3: Redefine `check_payload`** in 054 from migration 046, splitting the shared branch:
  - `MARK_READY_TO_EFILE` keeps `payload_keys = array['confirmed']`.
  - `RETURN_TO_SIGNING` requires `confirmed = true` and `payload_keys <@ array['confirmed','exitForm','remarks']`.
  - If `exitForm` is present, it must pass `vitally_private.check_exit_form`.
  - If `remarks` is present, it must pass `vitally_private.payload_text(p_payload,'remarks',2000)`.
- [ ] **Step 4: Redefine `act_return_to_signing`** in 054 from migration 035.
  - Keep the stage and answer checks.
  - Then, for `kind` in federal and state, when `exitForm->kind` is not JSON null, raise `VT007 VALIDATION` if:
    - the case's `<kind>_method` is null; or
    - `<kind>_result <> 'rejected'` and the group's `method <> <kind>_method`.
  - When values are given, insert the row (`entered_by_person_id = p_person.id`, `remarks = btrim(p_payload->>'remarks')`, trimmed as `act_approve_review` does; changed from `nullif(...)` at the final review) and return `detail` with `exitFormId`.
  - Keep the client message exactly.
- [ ] **Step 5: Run the tests to see them pass.** Run `npm run db:migrate:test`, then `npm run test:database`. Expected: all PASS, including the existing `tests/database-filing.mjs` Return to signing tests.
- [ ] **Step 6: Commit.** Message: `Migration 054: RETURN_TO_SIGNING carries and stores corrected Exit Form values (#203)`.

### Task 3: Load the values into the staff record

**Files:**
- Modify: `src/supabase-store.mjs:40-52` (`STAFF_TABLES`), `:318-332` (record shaping) and `:722` (the loader)
- Modify: `src/contracts.mjs` (the `RETURN_TO_SIGNING` comment, and `returnToSigningExitForms` in the record shape near line 155)
- Test: the existing store unit test that covers `reviewerQuestionnaires`. Find it with `grep -l reviewerQuestionnaires tests/*.test.mjs`.

**Interfaces:**
- Produces: `record.returnToSigningExitForms: Array<{id, caseId, enteredByPersonId, createdAt, exitForm, remarks}>`, camel-cased by `camelRow`, oldest first. It's `[]` when there are none, and absent from client records.

- [ ] **Step 1: Write the failing test.** The staff record built from rows including one `return_to_signing_exit_forms` row has `returnToSigningExitForms[0].exitForm` and `.remarks`. `STAFF_TABLES` includes `"return_to_signing_exit_forms"`, and `CLIENT_TABLES` doesn't.
- [ ] **Step 2: Run `npm test` to see it fail.** Expected: FAIL.
- [ ] **Step 3: Implement.** Mirror each `reviewer_questionnaires` / `reviewerQuestionnaires` line.
- [ ] **Step 4: Run `npm test` to see it pass.** Expected: PASS.
- [ ] **Step 5: Commit.** Message: `Staff record loads the corrected Exit Form values (#203)`.

### Task 4: The Exit Form rule

**Files:**
- Modify: `src/exit-form-source.mjs`
- Modify: `src/staff-views.mjs`, only if `exitFormPanel` / `exitFormTool` need to pass anything new. They already call `exitFormNote(source)`.
- Test: `tests/exit-form-source.test.mjs`, `tests/admin-views.test.mjs`, and the staff views test that covers `exitFormTool`.

**Interfaces:**
- Consumes: `record.returnToSigningExitForms` (Task 3), and `internalHistory[].detail.exitFormId` (Task 2).
- Produces:
  - `latestReturnToSigning(record) -> {event, values} | null`: the last `RETURN_TO_SIGNING` in `internalHistory`. `values` is the row whose `id === event.detail?.exitFormId`, or `null`.
  - `exitFormSource(record, review) -> null | {questionnaire, corrected, fillByHand, recordedAt}`. `recordedAt` is the event's `createdAt` when values are used, and `null` otherwise. The other fields mean what they mean today.
  - `exitFormNote(source) -> string`, using the copy in Global Constraints.
  - `plannedMethod(record, kind) -> "efile" | "paper" | null`: the latest Return to signing's stored method for `kind`, only when that return's result is `rejected`.

- [ ] **Step 1: Write the failing tests** in `tests/exit-form-source.test.mjs`, reusing `caseWith`, `refiled` and `RTS`:
  - `"stored values are printed"`: `refiled({internalHistory: [{...RTS, detail: {exitFormId: "x1"}}], returnToSigningExitForms: [{id: "x1", exitForm: F, remarks: "Corrected dependent SSN"}]})`, where `F` has federal paper refund 1250.00 direct deposit, state efile refund 85.00 check, and local NPT paper none. Expect:
    - `questionnaire.exitForm.federal` deep-equals F's federal;
    - `state.method` is `"efile"`;
    - `local` equals F's local;
    - `remarks` is "Corrected dependent SSN";
    - `corrected` is true, `fillByHand` is `[]`, and `recordedAt` is `RTS.createdAt`.
  - `"the case's method wins once settled"`: the same, with `federalMethod: "efile", federalResult: null`. Then `questionnaire.exitForm.federal.method === "efile"` and the amount is still "1250.00".
  - `"the latest Return to signing decides"`: two RTS events, the first linked to x1 and the second with `detail: {}`. The result equals #173's reduced questionnaire, and `fillByHand` equals `["the federal filing method", ...REST]`.
  - `"only the gaps are listed"`: a federal group only, no remarks, state accepted. `fillByHand` deep-equals `["the Pennsylvania refund or amount owed and how it is paid", "Remarks"]`. The note equals the stored-values sentence with `"November 2, 2026"` plus `" Fill in by hand: the Pennsylvania refund or amount owed and how it is paid; Remarks."`
  - `"nothing missing: no fill-by-hand sentence"`.
  - `"rejected return without a group lists its method and amount"`: federal rejected, only a state group stored. `fillByHand` starts `["the federal filing method", "the federal refund or amount owed and how it is paid"]`.
  - `"a federal-only case never lists Pennsylvania"`: `stateMethod: null`, values with a federal group. No item mentions Pennsylvania.
  - `"missing returnToSigningExitForms counts as none"`.
  - `plannedMethod` tests: it returns the stored method for a rejected return, `null` for an accepted one, and `null` without a row.
  - Keep every existing test unchanged. They pin #173's behaviour.
- [ ] **Step 2: Add the history test** to the staff views tests: `historySentence({action: "RETURN_TO_SIGNING", detail: {exitFormId: "x1"}})` equals the sentence for `detail: {}`.
- [ ] **Step 3: Add the panel tests** to `tests/admin-views.test.mjs`, next to line 1637's case: with a linked row, the office Exit Form panel shows the stored-values note, and its "filled from the reviewer's answers" line is absent.
- [ ] **Step 4: Run `npm test` to see them fail.** Expected: the new tests FAIL.
- [ ] **Step 5: Implement in `src/exit-form-source.mjs`.** Keep the module import-free. The gap rules for the stored-values case are in design D5 and the Global Constraints copy. Order: the federal method, the Pennsylvania method, the federal amount, the Pennsylvania amount, Remarks.
- [ ] **Step 6: Run `npm test` to see them pass.** Expected: PASS.
- [ ] **Step 7: Commit.** Message: `Exit Form prints the corrected values stored at Return to signing (#203)`.

### Task 5: The Return to signing dialog and payload

**Files:**
- Modify: `src/staff-views.mjs:1704` (`exitGroup`, made exportable)
- Modify: `src/admin-views.mjs:1017-1040` (`returnToSigningDialogBody`)
- Modify: `src/case-actions.mjs:302-304` (`RETURN_TO_SIGNING` builder)
- Modify: `src/questionnaires.mjs`: export `GROUP_FIELDS` if it isn't exported already
- Modify: `src/app.mjs:575` area: reopen typed-in groups for this dialog's form too, and wire "Clear this section" (`data-action="clear-exit-group"`) for it
- Modify: the demo-fill source for this dialog (find it with `grep -n "return-to-signing" src/demo-*.mjs`)
- Test: `tests/case-actions.test.mjs:629-636`, `tests/admin-views.test.mjs`, `tests/confirm-dialogs.test.mjs`, `tests/demo-fill.test.mjs`

**Interfaces:**
- Produces:
  - `export function exitGroup(title, prefix, {scope = "rev", fixedMethod = null} = {}) -> string`. With `fixedMethod`, the method radios are replaced by the text "How it was filed: E-file" (or "Paper") and `<input type="hidden" name="<prefix>.method" value="<method>">`. The default output must be byte-identical to today's.
  - Dialog field scope: `"return-to-signing"`.
  - Field names: `federal.*`, `state.*`, `local.<TYPE>.*`, and `remarks`. These are the names `exitFormFrom` reads.
  - The `RETURN_TO_SIGNING` builder returns `{confirmed: true}`, plus `exitForm` only when some group is filled, plus `remarks` (trimmed) only when not blank. Before calling `exitFormFrom`, it drops `<prefix>.method` for any group whose other `GROUP_FIELDS` are all blank. Over 2000 characters of remarks throws `validation("Keep the remarks to 2000 characters or fewer.")`.

- [ ] **Step 1: Write the failing payload-builder tests** in `tests/case-actions.test.mjs`:
  - `"RETURN_TO_SIGNING without values stays {confirmed: true}"`: the existing test at line 629 still passes.
  - `"a fixed method alone sends no group"`: `{confirmed: "on", "state.method": "efile"}` gives `{confirmed: true}`.
  - `"filled groups are sent"`: federal paper refund 1250.00 direct_deposit, plus state with the fixed efile, refund 85.00 and check, plus remarks `"  Corrected dependent SSN "`. The payload has an `exitForm` that equals `exitFormFrom`'s output, and `remarks: "Corrected dependent SSN"`.
  - `"a bad amount is refused before sending"`: `"federal.amount": "12.345"` throws the parser's message.
  - Update the table row at line 174 if its shape check needs it.
- [ ] **Step 2: Write the failing view tests** in `tests/admin-views.test.mjs`:
  - `"Return to signing dialog: groups for the case's returns, settled method fixed"`: federal rejected, state accepted (efile). The HTML has a `data-exit-group="federal"` with method radios, and a `data-exit-group="state"` with `name="state.method" value="efile"` hidden and no `state.method` radio. It has the five local groups, a `remarks` textarea, every `<details>` without `open`, and "The fix is done.".
  - `"no State group without a state method"`: `stateMethod: null` gives no `data-exit-group="state"`.
  - `"the reviewer form is unchanged"`: the existing reviewer form tests pass untouched.
- [ ] **Step 3: Add a refused-submit test** in `tests/confirm-dialogs.test.mjs`, following its existing redraw pattern. After a refused submit with `federal.amount` typed, the federal group is rendered open and keeps the typed value.
- [ ] **Step 4: Run `npm test` to see them fail.** Expected: the new tests FAIL.
- [ ] **Step 5: Implement**, in this order:
  - `exitGroup`'s options;
  - the dialog body. Lead text: "Optional: the corrected Exit Form values. Leave a part empty to fill it in by hand." A settled return (method set, result not `rejected`) gets `fixedMethod`;
  - the builder;
  - the `app.mjs` wiring;
  - demo fill: one Federal refund group for the rejected return.
- [ ] **Step 6: Run `npm test` to see them pass.** Expected: PASS.
- [ ] **Step 7: Commit.** Message: `Return to signing dialog collects the corrected Exit Form values (#203)`.

### Task 6: Mark e-filed preselects the planned method

**Files:**
- Modify: `src/admin-views.mjs:859` (`efiledChoices`) and its `choice(...)` helper, if it can't mark a choice checked yet
- Test: `tests/admin-views.test.mjs`

**Interfaces:**
- Consumes: `plannedMethod(record, kind)` from `src/exit-form-source.mjs` (Task 4).

- [ ] **Step 1: Write the failing tests** for a case at `review_approved` after a Return to signing, rendered through `markEfiledDialogBody`:
  - `"the planned paper method is preselected"`: state rejected, planned `paper`. The state-on-paper choice is `checked` and the e-file choice isn't.
  - `"nothing is preselected without a row"`: no choice is `checked`.
  - `"two rejected returns each preselect their planned method"`: federal planned `efile` and state planned `paper` give the federal e-file radio and the state paper radio `checked`. After a rejection the dialog uses per-return radios, not the four combinations.
  - `"one planned, one not"`: only one of two rejected returns has a stored group, so that return's planned radio is `checked` and the other return's radios aren't. Changed at the final review from "nothing is preselected", to match the spec's per-return rule (design D6).
- [ ] **Step 2: Run `npm test` to see them fail.** Expected: FAIL.
- [ ] **Step 3: Implement.** Preselect each rejected return's planned method on its own (per-return radios). The first version preselected only when every rejected return had a plan; the final review changed that to match the spec (design D6).
- [ ] **Step 4: Run `npm test` to see them pass.** Expected: PASS.
- [ ] **Step 5: Commit.** Message: `Mark e-filed preselects the method planned at Return to signing (#203)`.

### Task 7: Browser story, docs and final checks

**Files:**
- Modify: `tests/browser.mjs:7780-7790` (the Return to signing step on the rejected sample)
- Modify: `docs/developer/backend.md`, `docs/developer/frontend.md`, `docs/demo-script.md`, `README.md`, wherever they describe Return to signing or the Exit Form after it (find them with `grep -n -i "return to signing" docs README.md`)

- [ ] **Step 1: Extend the story.**
  - Before confirming Return to signing, open the rejected return's group and type an invalid amount `12.345`. Confirm, and assert the case is still `rejected` and the group is open with the value (Review Focus 4).
  - Correct it to `120.00` with a refund by check, then confirm. Assert `review_approved`.
  - Open the office Exit Form panel and assert its note contains "This form was filled from the corrected values recorded on".
  - Open Mark e-filed… after Mark ready to e-file, and assert the planned method is checked. If the sample's later story steps depend on a later state, assert it without submitting.
- [ ] **Step 2: Run `npm run test:browser`.** It takes about 20–25 minutes. Expected: PASS. Review the screenshots for the dialog.
- [ ] **Step 3: Update the docs.** Describe:
  - the optional values;
  - the `RETURN_TO_SIGNING` payload and `detail.exitFormId`;
  - the new table and who can read it;
  - what the Exit Form prints;
  - the preselection.
- [ ] **Step 4: Run every check.**
  - `npm test`
  - `npm run db:migrate:test` and `npm run test:database`
  - `npx openspec validate --all`
  - `npm run build:intake`, then `git status` shows nothing to commit.
  - Expected: all PASS.
- [ ] **Step 5: Check the migration number.** Run `git fetch origin && git ls-tree --name-only origin/main supabase/migrations/ | tail -3`. If 054 is taken on main, renumber this migration to the next free number and update every reference (`grep -rn "054" openspec/changes/add-exit-form-at-return-to-signing src tests docs`). If `check_payload` was redefined after migration 046 on main (for example by PR #243), re-copy from that latest version.
- [ ] **Step 6: Commit.** Message: `Story and docs: corrected Exit Form values at Return to signing (#203)`.
