# Closed lines after a filing (issue #170) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a client whose case is closed after a return was filed reads what happened to each return, never "Your return was not filed", in the history and on the status panel alike.

**Architecture:**
- One rule, written twice and kept in step by a test.
- **JS:** `closedLine` in `src/client-text.mjs` composes the text from per-return outcomes. `src/domain.mjs` maps a case record to outcomes and uses it for the status panel. The same function fills `SENTENCES`, so the stored English history lines translate.
- **SQL:** a new migration gives `vitally_private.closed_line` the case's filing columns, and redefines its two callers to pass them.

**Tech Stack:** Node ESM, `node:test`, Supabase Postgres (plpgsql), opencc-js (via `npm run build:hant`).

**Spec:** `openspec/changes/fix-closed-lines-after-filing/specs/case-lifecycle/spec.md`. Read it with `design.md` (decisions D1–D7) and `brainstorm.md` in the same folder.

## Global Constraints

- New migration only. Never edit an applied migration (036, 037, 043, 045, …).
- The migration file is `supabase/migrations/047_closed_lines_after_filing.sql`. The number is provisional; its header says so. No test or doc may name the file.
- Local checks are only `npm test` and `npm run build:hant -- --check`. Another session shares the local Supabase stack: never run `db:migrate:test`, `test:database`, `test:browser` or `supabase start` locally. Database and story checks run in CI: `gh workflow run ci.yml --ref fix-closed-lines-after-filing`.
- Don't edit files that PR #196 or #197 change. That includes `src/office-views.mjs`, `src/views.mjs`, `src/controller.mjs`, `src/supabase-store.mjs`, `tests/database-actions.mjs`, `tests/store.test.mjs`, `tests/controller.test.mjs` and `tests/support/*`.
- Client text lives in `src/client-text.mjs` (English and 简体). After any 简体 change, run `npm run build:hant` and commit `src/zh-hant.mjs`. Staff text stays English.
- Use fictional data only.
- Every command an implementer runs has a timeout. No foreground server. CI waits are bounded (for example `timeout 1500 gh run watch <id>`). If a step needs an approval you can't get, report BLOCKED.
- The exact English and 简体 strings are the delta spec's tables. Copy them verbatim:
  - the reason halves for `dismissed`, `withdrawn`, `out_of_scope` and `no_need_to_file`;
  - the per-return sentences for federal/Pennsylvania × accepted/waiting/paper/not filed;
  - the staff line: "The case was closed after a return was filed; make sure the rejected return is not transmitted again in TaxSlayer."

## Review Focus

1. **Both returns rejected** (and both methods null) must give today's line exactly, not a composed "…was not filed. …was not filed." Pinned in Task 1 (unit) and Task 2 (database).
2. **繁體:** the status panel and the history must both show converted text, not 简体 and not English. Pinned in Task 1 Step 1 (`zh-Hant` assertions).
3. **`duplicate`, `other` and a null reason with a filed return** must stay exactly today's. Pinned in Task 1 and in Task 2's exhaustive test.
4. **The withdrawn staff notice after a filing** must stay "The client withdrew; make sure the return is not transmitted in TaxSlayer.". Only the non-withdrawn notice changes. Pinned in Task 2 Step 1.
5. **The season-end close from a Hold** after Return to signing must get the composed line. Already pinned by reproduction subtest 8.

---

### Task 1: The shared rule and the status panel

**Files:**
- Modify: `src/client-text.mjs`. Add TEXT entries near the `stage.closed.client.*` entries (about line 205), `closedLine` near `sentence()` (about line 604), and the generated SENTENCES after SENTENCES is defined.
- Modify: `src/domain.mjs`. Add `returnOutcome`; change `holdClosedKey` / `describeStage` (about lines 343–380); add the notice constant near line 334.
- Modify: `src/zh-hant.mjs` (generated).
- Test: `tests/closed-after-filing.test.mjs` (exists, failing).

**Interfaces:**
- Produces, in `src/client-text.mjs`:
  - `closedLine(reason: string|null, federal: Outcome, state: Outcome, lang = "en"): string|null`, where `Outcome` is `"accepted"|"waiting"|"paper"|"not_filed"`.
    - It returns null unless `reason` is one of `dismissed`, `withdrawn`, `out_of_scope`, `no_need_to_file` and at least one outcome is not `"not_filed"`.
    - In English it joins the reason half, the federal sentence and the state sentence with `" "`. In `zh-Hans` it joins them with `""`. In `zh-Hant` it returns `toHant(<the zh-Hans line>)`, the whole line, as `sentence()` does.
  - `CLOSED_OUTCOMES = Object.freeze(["accepted","waiting","paper","not_filed"])`.
  - TEXT keys: `closed.reason.<reason>` and `closed.return.federal.<outcome>` / `closed.return.state.<outcome>`.
- Produces, in `src/domain.mjs`:
  - `returnOutcome(method: string|null, result: string|null): Outcome`. It returns `accepted` for a result of `accepted`; `paper` for a result of `given_to_client`, or for method `paper` with a null result; `waiting` for method `efile` with a null result; and `not_filed` otherwise (design D1).
  - `CLOSED_AFTER_FILING_NOTICE_REASON`, which is also appended to `BEFORE_FILING_NOTICE_REASONS`.

- [ ] **Step 1: Write the failing unit tests**

  Add these to `tests/closed-after-filing.test.mjs` (keep the existing test):

```js
import { closedLine, CLOSED_OUTCOMES, sentence, t } from "../src/client-text.mjs";
import { describeStage, returnOutcome, BEFORE_FILING_NOTICE_REASONS, CLOSED_AFTER_FILING_NOTICE_REASON } from "../src/domain.mjs";
const panel = (lang, record) => describeStage("closed", lang, record).clientMessage;

test("composed closed messages, exact", () => {
  const acceptedState = { closingReason: "withdrawn", federalMethod: "efile", stateMethod: "efile", federalResult: "rejected", stateResult: "accepted" };
  assert.equal(panel("en", acceptedState), "You withdrew this application. Your federal return was not filed. Your Pennsylvania return was filed and accepted. Do not file it again.");
  assert.equal(panel("zh-Hans", acceptedState), "您已撤回此申请。您的联邦报税表未递交。您的宾州报税表已递交并被接受。请勿再次递交。");
  assert.equal(panel("zh-Hant", acceptedState), sentence(panel("en", acceptedState), "zh-Hant"));
  assert.notEqual(panel("zh-Hant", acceptedState), panel("zh-Hans", acceptedState));
  // plus the delta spec's other scenarios, verbatim: Dismissed + state waiting;
  // Out of scope + state given_to_client; No need to file + federal accepted, state rejected.
});

test("nothing filed, duplicate, other and no reason read as today", () => {
  const bothRejected = { federalMethod: "efile", stateMethod: "efile", federalResult: "rejected", stateResult: "rejected" };
  const none = { federalMethod: null, stateMethod: null, federalResult: null, stateResult: null };
  const filed = { federalMethod: "efile", stateMethod: "efile", federalResult: "rejected", stateResult: "accepted" };
  for (const lang of ["en", "zh-Hans", "zh-Hant"]) {
    for (const reason of ["dismissed", "withdrawn", "out_of_scope", "no_need_to_file"])
      for (const filing of [bothRejected, none])
        assert.equal(panel(lang, { closingReason: reason, ...filing }), t(`stage.closed.client.${reason}`, {}, lang));
    assert.equal(panel(lang, { closingReason: "duplicate", ...filed }), t("stage.closed.client.duplicate", {}, lang));
    for (const closingReason of ["other", null])
      assert.equal(panel(lang, { closingReason, ...filed }), t("stage.closed.client", {}, lang));
  }
});

test("every composed line has its 简体 sentence", () => {
  // 4 reasons × 15 pairs = 60; each English line translates to its zh-Hans composition.
  let n = 0;
  for (const reason of ["dismissed", "withdrawn", "out_of_scope", "no_need_to_file"])
    for (const f of CLOSED_OUTCOMES) for (const s of CLOSED_OUTCOMES) {
      const en = closedLine(reason, f, s, "en");
      if (f === "not_filed" && s === "not_filed") { assert.equal(en, null); continue; }
      assert.equal(sentence(en, "zh-Hans"), closedLine(reason, f, s, "zh-Hans")); n++;
    }
  assert.equal(n, 60);
});

test("returnOutcome and the after-filing notice", () => {
  assert.equal(returnOutcome("efile", "accepted"), "accepted");
  assert.equal(returnOutcome("efile", null), "waiting");
  assert.equal(returnOutcome("paper", "given_to_client"), "paper");
  assert.equal(returnOutcome("paper", null), "paper");
  assert.equal(returnOutcome("efile", "rejected"), "not_filed");
  assert.equal(returnOutcome(null, null), "not_filed");
  assert.equal(CLOSED_AFTER_FILING_NOTICE_REASON, "The case was closed after a return was filed; make sure the rejected return is not transmitted again in TaxSlayer.");
  assert.ok(BEFORE_FILING_NOTICE_REASONS.includes(CLOSED_AFTER_FILING_NOTICE_REASON));
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

  Run: `timeout 300 node --test tests/closed-after-filing.test.mjs`
  Expected: FAIL. `closedLine` and `returnOutcome` are not exported.

- [ ] **Step 3: Implement the TEXT entries, `closedLine`, `CLOSED_OUTCOMES` and the 60 generated `SENTENCES` entries in `src/client-text.mjs`**

  Generate the entries by looping over the four reasons and the 15 filed pairs, adding `closedLine(…,"en") → closedLine(…,"zh-Hans")`. Keep every existing entry.

- [ ] **Step 4: Implement `returnOutcome`, the closed branch and the notice constant in `src/domain.mjs`**

  `describeStage` uses this variant when the stage is `closed`:

  `closedLine(closingReasonOf(record), returnOutcome(record?.federalMethod, record?.federalResult), returnOutcome(record?.stateMethod, record?.stateResult), lang)`

  When that returns null, keep today's `holdClosedKey` path.

- [ ] **Step 5: Run the tests and confirm they pass**

  Run: `timeout 300 node --test tests/closed-after-filing.test.mjs`
  Expected: PASS. Note that `zh-Hant` passes only after Step 6.

- [ ] **Step 6: Regenerate 繁體 and check it**

  Run: `timeout 300 npm run build:hant`, then `timeout 300 npm run build:hant -- --check`.
  Expected: `src/zh-hant.mjs` gains the new strings, and the check reports no difference.

- [ ] **Step 7: Run the whole unit suite**

  Run: `timeout 900 npm test`
  Expected: every test passes, including `tests/client-language.test.mjs` (no Latin leaks; the migration sweep is unchanged so far) and `tests/hant.test.mjs`.

- [ ] **Step 8: Commit**

```bash
git add src/client-text.mjs src/domain.mjs src/zh-hant.mjs tests/closed-after-filing.test.mjs
git commit -m "Closed messages say what was filed (#170): shared rule and status panel"
```

### Task 2: The database

**Files:**
- Create: `supabase/migrations/047_closed_lines_after_filing.sql`
- Test: `tests/database-closed-after-filing.mjs` (exists, failing)

**Interfaces:**
- Consumes (Task 1): `describeStage`, `returnOutcome`, `CLOSED_AFTER_FILING_NOTICE_REASON` from `src/domain.mjs`; `sentence`, `t` from `src/client-text.mjs`.
- Produces: `vitally_private.closed_line(p_reason text, p_federal_method text, p_federal_result text, p_state_method text, p_state_result text) returns text`, an immutable SQL function with `security definer` and `search_path=''`, like 036's. The one-argument `closed_line(text)` no longer exists.

- [ ] **Step 1: Write the failing database tests**

  Append these subtests inside the existing `test(...)` in `tests/database-closed-after-filing.mjs`. Reuse its `answeredCase`, `returnedToSigning`, `act` and `lastMessage` helpers.
  - `"9. Both returns rejected keep today's line"`: `answeredCase({federal:"efile",state:"efile"},{federal:"rejected",state:"rejected"})`, then `CLOSE_CASE` with `dismissed`. Assert that `lastMessage` equals `"PCDC could not reach you, so this application was closed. Your return was not filed."`.
  - `"10. The staff notice after a filing"`: `returnedToSigning()`, `PUT_ON_HOLD`, `CLOSE_CASE` with `dismissed`. Assert that the open `withdrawal_notice` row's `reason` equals `CLOSED_AFTER_FILING_NOTICE_REASON`.
  - `"11. The staff notice with nothing filed"`: `f.approvedCase()`, `PUT_ON_HOLD`, `CLOSE_CASE` with `dismissed`. Assert the reason is `"The case was closed before filing; make sure the return is not transmitted in TaxSlayer."`.
  - `"12. The withdrawn notice after a filing is unchanged"`: `returnedToSigning()`, then `CLOSE_CASE` with `withdrawn`. Assert the reason is `"The client withdrew; make sure the return is not transmitted in TaxSlayer."`.
  - `"13. Every combination matches the status panel"`:
    - The reasons are `["out_of_scope","no_need_to_file","duplicate","dismissed","withdrawn","other",null]`.
    - The filing states are `{both methods null}` plus each of 4 × 4 per-return states. A per-return state is a `[method, result]` from `[["efile","accepted"],["efile",null],["paper","given_to_client"],["efile","rejected"]]`.
    - For each pair, run `select vitally_private.closed_line($1,$2,$3,$4,$5) as line`.
    - Assert `line === describeStage("closed","en",record).clientMessage`.
    - Assert `Object.hasOwn`-style translation: `sentence(line,"zh-Hans") !== line` and `sentence(line,"zh-Hans") === describeStage("closed","zh-Hans",record).clientMessage`.
    - Count 119 calls.

- [ ] **Step 2: Confirm the new tests fail (CI)**

  The local stack is off-limits. Commit the tests, push, and run `gh workflow run ci.yml --ref fix-closed-lines-after-filing`. Then run `timeout 1500 gh run watch <id>`.
  Expected: the database job fails on subtests 1–8 and 10, and 13 fails because the function takes one argument. 9, 11 and 12 pass, since they're today's behaviour. Read the recorded errors; don't re-run blindly.

- [ ] **Step 3: Write the migration**

  `supabase/migrations/047_closed_lines_after_filing.sql`:

  1. **Header.** Say what changes and why (#170), that the number is provisional, and list each redefined function with the migration it is copied from, as 036's header does.
  2. **`closed_line`.** Create the five-argument `closed_line`. It maps outcomes per design D1. It returns today's line from 036 when the reason isn't one of the four, or when both outcomes are not filed. Otherwise it returns the reason half, the federal sentence and the state sentence, separated by single spaces, with the English from the spec.
  3. **`act_close_case`.** Redefine it verbatim from `043_remove_presenter_access.sql:773`, except lines marked `-- 047`:
     - the message passes `p_case.federal_method, p_case.federal_result, p_case.state_method, p_case.state_result`;
     - the notice's non-withdrawn text becomes the after-filing line when either return's outcome is accepted, waiting or paper.
  4. **`vitally_close_unsigned`.** Redefine `public.vitally_close_unsigned(uuid,jsonb,boolean)` verbatim from `045_volunteer_clearance.sql:504`, except the `closed_line` call, which passes `v_case`'s four columns (`-- 047`). Then repeat 045's revoke and grant for it.
  5. **Drop the old function.** Run `drop function vitally_private.closed_line(text);`. First, `grep -rn "closed_line(" supabase/migrations` must show no other caller in a latest definition.
  6. **Revoke** the new function from `public, anon, authenticated`, matching how 036 left the old one. Check 036/043 for the exact grants.

- [ ] **Step 4: Run the unit suite**

  Run: `timeout 900 npm test`
  Expected: PASS. The `client-language` migration sweep still finds an entry for every `message` literal. If the sweep flags a new literal, give it a `SENTENCES` entry; don't relax the sweep.

- [ ] **Step 5: Commit, push and run CI**

```bash
git add supabase/migrations/047_closed_lines_after_filing.sql tests/database-closed-after-filing.mjs
git commit -m "closed_line reads what was filed; notice after a filing (#170)"
git push
gh workflow run ci.yml --ref fix-closed-lines-after-filing
```

  Expected: checks, database, sign-in and both story legs pass. In the database job, all subtests 1–13 of `database-closed-after-filing.mjs` pass and no other test fails.

### Task 3: Final checks

**Files:**
- Modify: only docs that state `closed_line`'s signature. Run `grep -rn "closed_line" docs/developer`; if there are no hits, change nothing.

- [ ] **Step 1:** Run `grep -rn "Your return was not filed" tests src`. Every hit must be a nothing-filed case, the Withdraw line, or `src/client-text.mjs` / `src/zh-hant.mjs` text. Report any other hit.
- [ ] **Step 2:** Run `timeout 300 npx openspec validate --all`. Expected: all valid.
- [ ] **Step 3:** If a doc changed, commit it: `git commit -m "Docs: closed_line takes the filing columns (#170)"`.
