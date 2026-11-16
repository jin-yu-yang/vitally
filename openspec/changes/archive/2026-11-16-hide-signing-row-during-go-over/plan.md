# Hide the Signing row during a go-over: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** while a Ready to exit case has an open `go_over_return` follow-up, Follow-ups lists no Signing row for it, only its Call the client row (#177).

**Architecture:** Follow-ups rows are built in the browser by `followupQueue` in `src/office-views.mjs`. The filter counts (`queueCounts`) and the rendered rows (`renderFollowups`) both come from it. Skipping the `signing` row there while `record.goOverOpen` is true changes rows and counts together. `needed()` loses its unreachable go-over text. Nothing changes in the database, RPCs, realtime or client text.

**Tech Stack:** plain ES modules, `node:test` unit tests, the Playwright browser story (`tests/browser.mjs`).

**Spec:**
- `openspec/changes/hide-signing-row-during-go-over/specs/case-lifecycle/spec.md`
- `openspec/changes/hide-signing-row-during-go-over/specs/office-follow-up/spec.md`
- `design.md` (D1–D4) in the same folder.

## Global Constraints

- Staff screens stay English. There is no client-text change, so `src/client-text.mjs` and `src/zh-hant.mjs` are untouched.
- No migration, SQL, RPC or realtime change.
- Fictional data only in tests.
- Keep unchanged: the case page's "The office still needs to go over the return with the client." and `adminEligibility().markReadyToEfile` (`src/admin-views.mjs`).
- Rows kept as they are: "Waiting for the client to sign.", "Waiting for the reviewer's call with the client.", "Waiting for the client to sign again."
- The text to remove from Follow-ups: "Waiting for the office to go over the return with the client."

## Review Focus

1. **A go-over case with other open tasks.** With `openFollowups: 2` and `goOverOpen: true`, the Call the client row reads "2 open tasks" and there is no Signing row. Once the go-over is resolved (`openFollowups: 1`, `goOverOpen: false`), both a Call row and a Signing row show. Pinned in Task 1, Step 1.
2. **A list entry with no `goOverOpen` field** (an older payload) shows the Signing row as today. Pinned in Task 1, Step 1.
3. **A go-over open while the reviewer's call is also pending** shows no Signing row, and no "Waiting for the reviewer's call" text for that case. Pinned in Task 1, Step 1.
4. **Filter counts.** The `signing` count leaves the hidden row out, and `all` counts the Call row once. Pinned in Task 1, Step 1.
5. **The story's later wait for the Signing row after the go-over is resolved** must still find it. The existing `waitFor` near `tests/browser.mjs:3585` stays as it is. Checked in Task 2.

---

### Task 1: Follow-ups leaves out the Signing row while a go-over is open

**Files:**
- Modify: `src/office-views.mjs`:
  - `followupQueue`, the `review_approved` branch, about line 153;
  - `needed()`, the `signing` branch, about lines 261–271.
- Modify: `tests/office-views.test.mjs`:
  - the D13 block in "Follow-ups shows new applications, screening, signing and e-filing", about lines 182–190;
  - plus one new test.
- Modify: `docs/developer/frontend.md`, the paragraph ending "The Follow-ups signing and e-filing rows offer the same two marks, selecting the case in place." (about line 621).

**Interfaces:**
- Consumes: `followupQueue(cases, assistance, now)`, `renderFollowups(cases, assistance, ui)`, `queueCounts(rows, chosen)` and `officeFilters(filters)`, all from `src/office-views.mjs`. The list-entry fields `goOverOpen`, `openFollowups`, `reviewContactStatus` and `federalMethod`.
- Produces: no new names. `followupQueue` returns no `{ kind: "signing" }` row for a record with `goOverOpen === true`.

- [ ] **Step 1: Write the failing tests**

  In the existing test, replace the D13 block (the `over` / `overDone` assertions) with:
  ```js
  // #177: while the office's go-over is open, the case is its Call the client row alone.
  const over = renderFollowups([{ ...rec("G", "review_approved"), goOverOpen: true, openFollowups: 1 }], [], ui);
  assert.doesNotMatch(over, /data-kind="signing"/);
  assert.doesNotMatch(over, /Waiting for the office to go over the return with the client\./);
  assert.match(rowOf(over, "G"), /1 open task/);
  assert.match(rowOf(over, "G"), /data-action="open-log-call"/);
  const overDone = renderFollowups([{ ...rec("G", "review_approved"), goOverOpen: false }], [], ui);
  assert.match(overDone, /Waiting for the client to sign\./);
  assert.match(overDone, /open-mark-ready-to-efile/);
  ```
  Check how `rowOf` picks a row (it is defined about line 101). If it returns the first row for an id, the `over` html has only the call row, so the call-row assertions hold.

  Add a new test right after it, `test("an open go-over hides the Signing row, whatever else the case waits on (#177)", …)`, using the file's `kase` helper and `NOW`:
  - `followupQueue([kase({ id: "g", stage: "review_approved", reviewContactStatus: "completed", goOverOpen: true, openFollowups: 1 })], [], NOW)` gives kinds `["call"]`.
  - With `reviewContactStatus: "pending"` and the same go-over, the kinds are still `["call"]`.
  - With `federalMethod: "efile"` (returned to signing) and the same go-over, the kinds are still `["call"]`.
  - With `openFollowups: 2` and the go-over open: kinds `["call"]`, and the rendered row matches `/2 open tasks/`.
  - Resolved, with `openFollowups: 1` and `goOverOpen: false`: kinds sorted `["call", "signing"]`.
  - With no `goOverOpen` field and `openFollowups: 0`: kinds `["signing"]`.
  - `queueCounts(followupQueue([the go-over case], [], NOW), officeFilters({}))` has `signing: 0`, `call: 1` and `all: 1`.

- [ ] **Step 2: Run them and see them fail**

  Run: `node --test tests/office-views.test.mjs`
  Expected: FAIL. The go-over case still yields a `signing` row, and the html still contains "Waiting for the office to go over…".

- [ ] **Step 3: Implement**

  - In `followupQueue`, the `review_approved` branch pushes the `signing` row only when `!record.goOverOpen`. Add a one-line comment: the open go-over is the case's Call the client row until it is resolved or cancelled (#177).
  - In `needed()`, remove the `record.goOverOpen ? "Waiting for the office to go over the return with the client." :` branch. The signing text becomes: returned to signing → "Waiting for the client to sign again."; call not completed → "Waiting for the reviewer's call with the client."; otherwise "Waiting for the client to sign.".
  - Leave `rowAction()` alone. It still shows `adminEligibility`'s refusal if one ever applies.

- [ ] **Step 4: Run them and see them pass**

  Run: `node --test tests/office-views.test.mjs tests/admin-views.test.mjs`
  Expected: PASS. `tests/admin-views.test.mjs` passes without edits, which shows the case page's locked step and the eligibility rule are unchanged.

- [ ] **Step 5: Update the developer doc**

  In `docs/developer/frontend.md`, after "The Follow-ups signing and e-filing rows offer the same two marks, selecting the case in place.", add: "While a `go_over_return` follow-up is open, Follow-ups lists no signing row for the case: its Call the client row stands for it until the task is resolved or cancelled (#177)."

- [ ] **Step 6: Run the unit suite**

  Run: `npm test`
  Expected: all pass, 0 failures.

- [ ] **Step 7: Commit**

  ```bash
  git add src/office-views.mjs tests/office-views.test.mjs docs/developer/frontend.md
  git commit -m "Follow-ups: no Signing row while the go-over is open (#177)"
  ```

### Task 2: The browser story expects no Signing row during the go-over

**Files:**
- Modify: `tests/browser.mjs`:
  - the `heldRow` block, about lines 3480–3491;
  - the comment "Logging a contact never resolves the task: the signing row still waits." (about line 3546).

**Interfaces:**
- Consumes: the story's `queueRow(kind, reference)` (about line 3403), `staff`, `classReference`, `RENDER_MS`, and Task 1's behaviour.
- Produces: nothing new.

- [ ] **Step 1: Rewrite the held-row check**

  - Keep the section heading comment, reworded: "The class case waits for the office to go over the return: only its Call the client row shows."
  - Remove the `heldRow` wait and its two assertions.
  - After the existing `await goOverRow.waitFor(...)`, so the queue has rendered, add:
    ```js
    assert.equal(
      await queueRow("signing", classReference).count(),
      0,
      "Follow-ups listed a Signing row while the go-over was open",
    );
    ```
  - Change the line-3546 comment to: "Logging a contact never resolves the task: the case still has no Signing row." If the code right after that comment asserts something about the signing row, assert the `count()` of 0 again instead.
  - Leave unchanged the later `waitFor` for a `signing` row with `open-mark-ready-to-efile` after the go-over is resolved, and its "Waiting for the client to sign." assertion.

- [ ] **Step 2: Check it parses, and the unit tests**

  Run: `node --check tests/browser.mjs && npm test`
  Expected: no syntax error, and the unit tests pass.

- [ ] **Step 3: Commit**

  ```bash
  git add tests/browser.mjs
  git commit -m "Browser story: no Signing row while the go-over is open (#177)"
  ```

- [ ] **Step 4: Run the browser story (controller-owned, after the final review)**

  Run (local stack up, see `docs/setup.md`): `npm run test:browser`
  Expected: both browser orders pass. Or use passing CI `story (chrome-client)` and `story (firefox-client)` jobs on the pushed commit, with their screenshots reviewed.

---

Checks not needed: `npm run test:database` (no SQL), `npm run test:auth-browser` (sign-in untouched), `npm run build:hant -- --check` (no client text).
