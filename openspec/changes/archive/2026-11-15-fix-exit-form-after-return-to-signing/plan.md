# Exit Form after Return to signing: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a Return to signing, no Exit Form path prints the earlier questionnaire's values. The form
prints the header and the settled filing methods, and staff are told what to fill in by hand (issue #173).

**Architecture:**
- A new pure module, `src/exit-form-source.mjs`, decides what the Exit Form for a review is filled from:
  the stored questionnaire, or after a later `RETURN_TO_SIGNING` a reduced questionnaire built from the
  case's filing columns.
- `exitFormTool`/`exitFormPanel` (`src/staff-views.mjs`) and `viewExitForm` (`src/app.mjs`) all go through it.
- `exitFormMarks` (`src/exit-form.mjs`) is unchanged.

**Tech Stack:** plain ES modules, `node:test`, no database change.

**Spec:** `openspec/changes/fix-exit-form-after-return-to-signing/specs/review-and-corrections/spec.md`, with
`design.md` (D1–D7) and `brainstorm.md` in the same folder.

## Global Constraints

- Fictional data only in tests.
- Staff screens stay English. No `src/client-text.mjs` change, so no `build:hant`.
- No migration, no SQL, no RPC change.
- Local checks are `npm test` only (the shared stack is not touched). Database, sign-in and story suites
  run in CI.
- The note text, exactly: `The return was corrected after this review (Return to signing). This form prints only what ViTally holds. Fill in by hand: ` + the items joined with `"; "` + `.`
- The note items, in this order:
  - `the federal filing method` (only when the federal box is not ticked);
  - `the Pennsylvania filing method` (only when the state box is not ticked);
  - `the federal and Pennsylvania refund or amount owed and how it is paid`;
  - `Other Tax`;
  - `Remarks`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **An approved review with no `decidedAt`** (old or fixture data) and a `RETURN_TO_SIGNING` in the history:
   treat the Return to signing as later, never as earlier, so no old values print. Pinned in Task 1.
2. **A `RETURN_TO_SIGNING` dated before the approval** (impossible in real data, possible in fixtures): it is
   ignored, and the full form prints. Pinned in Task 1.
3. **Two Returns to signing** (rejected again after a refile): the same rule applies, and only the current
   columns matter. Pinned in Task 1.
4. **A record without `internalHistory`** (list-shaped): no button and no panel, never the old form. Pinned
   in Tasks 1 and 2.
5. **`viewExitForm` called with the id of a review whose source is `null`** (stale button after a live
   update): it returns without opening a tab. Pinned in Task 2 by a `tests/shell.test.mjs` source assertion.

---

### Task 1: The rule (`src/exit-form-source.mjs`)

**Files:**
- Create: `src/exit-form-source.mjs`
- Create: `tests/exit-form-source.test.mjs`
- Modify: `tests/exit-form.test.mjs` (one test)

**Interfaces:**
- Produces:
  - `exitFormSource(record, review) -> null | { questionnaire, corrected: boolean, fillByHand: string[] }`
  - `exitFormNote(source) -> string`: `""` unless `source?.corrected`
  - `RETURN_TO_SIGNING_NOTE_START`: the constant prefix of the note, for tests
- Reads, from the record:
  - `reviews`, `reviewerQuestionnaires` (matched by `reviewId`);
  - `internalHistory` (`{ action, createdAt }`);
  - `federalMethod`, `stateMethod`, `federalResult`, `stateResult`.
- Reads, from the review: `id`, `status`, `decidedAt`.

- [ ] **Step 1: Write the failing tests** in `tests/exit-form-source.test.mjs`. Use a fictional record helper
  `caseWith(over)` with:
  - one approved review `{ id: "review-1", status: "approved", decidedAt: "2026-10-17T15:00:00.000Z" }`;
  - questionnaire `Q`, with federal `{method:"efile",result:"refund",amount:"120.00",refundBy:"direct_deposit"}`,
    state `{method:"efile",result:"owe",amount:"45.50",oweBy:"direct_debit",debitOn:"2027-04-15"}`,
    local `[{type:"NPT",method:"paper",result:"owe",amount:"10.00",oweBy:"check"}]` and remarks `"Looks right."`;
  - `internalHistory: []`.

  `RTS = { action: "RETURN_TO_SIGNING", createdAt: "2026-11-02T15:00:00.000Z" }`. Tests:
  - `no Return to signing: the stored questionnaire, no note`:
    `deepEqual(source, { questionnaire: Q, corrected: false, fillByHand: [] })`, and `exitFormNote(source) === ""`.
  - `returned to signing, federal rejected: state method only`: with
    `{federalMethod:"efile",stateMethod:"efile",federalResult:"rejected",stateResult:"accepted",internalHistory:[RTS]}`.
    - `questionnaire` deep-equals `{ exitForm: { federal: null, state: { method: "efile" }, local: [] }, remarks: "" }`;
    - `corrected === true`;
    - `fillByHand` deep-equals `["the federal filing method", "the federal and Pennsylvania refund or amount owed and how it is paid", "Other Tax", "Remarks"]`;
    - `exitFormNote(source)` equals the Global Constraints text with those items.
  - `refiled e-file awaiting an answer is ticked`: `federalResult: null`, the rest as above, gives federal
    `{ method: "efile" }`, and `fillByHand[0]` is the refund item.
  - `refiled on paper is ticked`: `federalMethod:"paper", federalResult:"given_to_client"` gives federal
    `{ method: "paper" }`.
  - `a return with no method gets nothing`: `federalMethod:null, stateMethod:null`, with `RTS`, gives both
    groups `null`, and both method items are in `fillByHand`.
  - `two Returns to signing use the current columns`: two `RTS` entries (Nov 2 and Nov 20) and state now
    `rejected` give state `null`.
  - `a Return to signing before the approval is ignored`: `RTS` dated `2026-10-01…` gives `corrected === false`.
  - `fail-safe: an approval with no decidedAt counts any Return to signing as later (#173, keep: guards against old values)`: `decidedAt: null` with `RTS` gives
    `corrected === true`.
  - `fail-safe: a record without staff history offers no Exit Form (#173, keep: guards against old values)`: `exitFormSource(caseWith({internalHistory: undefined}), review)` is `null`.
  - `null cases`: a review with
    no questionnaire is `null`; a review with `status: "corrections_requested"` is `null`; a `null` review is
    `null`.

- [ ] **Step 2: Run to verify it fails.** Run: `node --test tests/exit-form-source.test.mjs`.
  Expected: FAIL, cannot find module `../src/exit-form-source.mjs`.

- [ ] **Step 3: Implement** `exitFormSource`, `exitFormNote` and `RETURN_TO_SIGNING_NOTE_START` in
  `src/exit-form-source.mjs`:
  - no imports, and a header comment citing #173 and design D1–D5;
  - the timestamp comparison uses `Date.parse`;
  - a missing or unparsable `decidedAt` counts every `RETURN_TO_SIGNING` as later;
  - a settled method is `record[`${kind}Method`]` when it is truthy and `record[`${kind}Result`] !== "rejected"`.

- [ ] **Step 4: Run to verify it passes.** Run: `node --test tests/exit-form-source.test.mjs`. Expected: all PASS.

- [ ] **Step 5: Add the drawing test** in `tests/exit-form.test.mjs`:
  `the reduced questionnaire draws the header and method ticks only`.
  - Call `exitFormMarks({ exitForm: { federal: null, state: { method: "efile" }, local: [] }, remarks: "" }, CASE, "2026-11-03")`.
  - `ticked(marks, L.groups.state.boxes.efile)` is true and `marks.checks.length === 1`.
  - No text at `L.groups.state.amount`, `L.groups.state.debitOn`, `L.groups.federal.amount` or `L.remarks`
    (`valueAt` undefined).
  - The header values are present.

  Run: `node --test tests/exit-form.test.mjs`. Expected: PASS. `exitFormMarks` is unchanged, so this pins its
  contract with the reduced shape.

- [ ] **Step 6: Commit.**
  ```bash
  git add src/exit-form-source.mjs tests/exit-form-source.test.mjs tests/exit-form.test.mjs
  git commit -m "Exit Form source: after Return to signing, only settled methods (#173)"
  ```

### Task 2: Every Exit Form path uses the rule

**Files:**
- Modify: `src/staff-views.mjs` (`exitFormTool` and `exitFormPanel`, around lines 1824–1841)
- Modify: `src/app.mjs` (`viewExitForm`, around lines 1766–1771)
- Test: `tests/staff-views.test.mjs`, `tests/admin-views.test.mjs`, `tests/shell.test.mjs`

**Interfaces:**
- Consumes: `exitFormSource` and `exitFormNote` from Task 1.
- Produces (markup tests rely on):
  - the note renders as `<p class="field-note" data-role="exit-form-corrected">…note…</p>`, directly before
    the button's `summary-tools` div, in both places;
  - the button markup is unchanged: `data-action="view-exit-form" data-review="<id>"`.

- [ ] **Step 1: Write the failing reproduction** in `tests/staff-views.test.mjs`:
  `the Exit Form after Return to signing carries the fill-by-hand note, never the old values' source (#173)`.
  - Use `staffCase({ stage: "review_approved", preparationVersion: 1, reviews: [reviewRow({ status: "approved", decidedAt: "2026-10-17T15:00:00.000Z" })], reviewerQuestionnaires: [revQ()], federalMethod: "efile", stateMethod: "efile", federalResult: "rejected", stateResult: "accepted", internalHistory: [{ id: "e1", action: "RETURN_TO_SIGNING", actorPersonId: "sam", createdAt: "2026-11-02T15:00:00.000Z", detail: {} }] })`.
  - Render it with `renderStaffCase(record, MORGAN)`.
  - Assert the button is still present.
  - Assert `data-role="exit-form-corrected"` contains
    `Fill in by hand: the federal filing method; the federal and Pennsylvania refund or amount owed and how it is paid; Other Tax; Remarks.`
  - Assert the reviewer's recorded answers still show (`Exit Form, Federal</span><strong>E-file, refund 120.00`).

  Add a second test, `no Return to signing, no note`: the existing approved fixture has no
  `data-role="exit-form-corrected"`.

  Add a third, `fail-safe: no staff history, no Exit Form button (#173, keep)`: the same approved case with `internalHistory: undefined`
  (override after `staffCase`, or pass `undefined`) has no `view-exit-form`.

- [ ] **Step 2: Run to verify it fails.** Run: `node --test tests/staff-views.test.mjs`. Expected: the note
  test and the no-history test FAIL; the others pass.

- [ ] **Step 3: Change `exitFormTool(record, attempt)`** to:
  - call `exitFormSource(record, attempt)`;
  - return `""` when it is `null`;
  - otherwise return the note paragraph (only when `corrected`, escaped with `esc`), then the existing
    button div.

  Import from `./exit-form-source.mjs`.

- [ ] **Step 4: Change `exitFormPanel(record)`:**
  - `approved = (record?.reviews ?? []).findLast((r) => r?.status === "approved")`;
  - return `""` when `exitFormSource(record, approved)` is `null`. This removes the
    `&& reviewerQuestionnaireOf` fallback (design D6);
  - when corrected, replace the `filled from the reviewer's answers for version N` sentence with the note,
    which comes from `exitFormTool`. The panel then keeps only `PCDC's hand-out for the client. Print it for the client when they sign.`;
  - otherwise keep today's sentence.

  Update the comment above the panel.

- [ ] **Step 5: Change `viewExitForm(reviewId, by)`:**
  - find `review = (record?.reviews ?? []).find((r) => r?.id === reviewId)`;
  - set `source = exitFormSource(record, review)`;
  - `if (!record || !source) return;` before any tab opens;
  - pass `source.questionnaire` to `exitFormMarks`.

  Update the section comment to name the rule. Add a `tests/shell.test.mjs` assertion:
  `app.mjs` matches `/exitFormSource\(record, review\)/` and no longer matches
  `/reviewerQuestionnaires \?\? \[\]\)\.find\(\(q\) => q\?\.reviewId === reviewId\)/`.

- [ ] **Step 6: Change the fallback test** in `tests/admin-views.test.mjs`. Rename it to
  `the office's Exit Form panel needs a reviewer questionnaire on the latest approval, with no fallback (#173)`.
  - Keep the `none` part.
  - Change the `later` part to assert `doesNotMatch(html, /exit-form-title|view-exit-form/)`.

  The code it covered, the filter in the panel's `find`, is removed in Step 4.

  Add `the office's Exit Form panel after Return to signing carries the note`: an `officeCase` with the same
  columns and `RETURN_TO_SIGNING` history as Step 1, plus a questionnaire. Assert:
  - the panel and the button are present;
  - `data-role="exit-form-corrected"` with the list text;
  - `doesNotMatch(html, /filled from the reviewer's answers/)`.

- [ ] **Step 7: Run the unit suite.** Run: `npm test`. Expected: all PASS. Note the test count before and
  after, for the PR.

- [ ] **Step 8: Commit.**
  ```bash
  git add src/staff-views.mjs src/app.mjs tests/staff-views.test.mjs tests/admin-views.test.mjs tests/shell.test.mjs
  git commit -m "Exit Form: panel, button and PDF follow the latest approval, no fallback (#173)"
  ```

### Task 3: Docs and spec check

**Files:**
- Modify: `docs/developer/frontend.md` ("The Exit Form", lines ~477–520)
- Modify: `README.md` (the Exit Form row, line ~33)
- Check: `docs/demo-script.md:121` and `docs/developer/backend.md:224`. They name the Exit Form but don't
  state what it prints; change them only if they do.

- [ ] **Step 1: `frontend.md`.**
  - "Where it is offered": the office panel is for the latest approved review, with no fallback.
  - A new bullet, "After a Return to signing": `exitFormSource` in `src/exit-form-source.mjs`; the settled
    methods only (result not `rejected`); everything else blank; the fill-by-hand note; follow-ups #203 and
    #204.
  - "What goes on it": `exitFormMarks` gets the questionnaire from `exitFormSource`.
  - "Tests": add `tests/exit-form-source.test.mjs`.
- [ ] **Step 2: README row.** Append "; after a Return to signing it prints only the methods ViTally holds and
  says what to fill in by hand (#173)".
- [ ] **Step 3: Validate.** Run: `npx openspec validate --all`. Expected: every item valid. Check that the
  delta spec's note text matches the built text character for character.
- [ ] **Step 4: Commit.**
  ```bash
  git add docs/developer/frontend.md README.md
  git commit -m "Docs: the Exit Form after Return to signing (#173)"
  ```

### Task 4: CI

- [ ] **Step 1: Sync with `main`.** Run `git fetch` and `git merge origin/main`, then `npm test`. Expected: PASS.
- [ ] **Step 2: Push the branch and run CI.** Run `git push -u origin fix-exit-form-after-return-to-signing`,
  then `gh workflow run ci.yml --ref fix-exit-form-after-return-to-signing`.
- [ ] **Step 3: Wait for CI.** Use bounded waits (`gh run watch <id> --exit-status` with a timeout). Expected:
  `checks`, `database`, `sign-in` and both `story` legs green. Download the story artifacts and look at the
  Exit Form screenshots. Record the run link for `verify.md` and the PR.
