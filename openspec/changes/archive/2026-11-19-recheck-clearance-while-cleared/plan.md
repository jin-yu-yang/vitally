# Recheck Clearance While Cleared Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A cleared staff window re-reads `vitally_my_clearance()` on wake events, after a `FORBIDDEN`/`INELIGIBLE` refusal and after saving one's own Roster row, and its buttons, screens and dialogs follow the new effective capabilities without a reload.

**Architecture:** All re-reads go through the existing single-flight `checkClearance()` in `src/controller.mjs`. `recheckClearance()` gains a quiet cleared → cleared path that redraws only when capabilities change, and applies one screen fallback (All cases → work board). A new pure module `src/role-gates.mjs` holds the dialog → capability table and the "Your roles changed" line. The views use it to swap a submit for that line.

**Tech Stack:** Plain ES modules, `node:test` with `assert/strict` (`npm test`), Playwright story (run by the PR's CI `story` jobs).

**Spec:** `openspec/changes/recheck-clearance-while-cleared/specs/volunteer-clearance/spec.md`, with `design.md` (D1–D7) and `brainstorm.md` in the same folder.

## Global Constraints

- **No migration, RPC, policy, realtime publication or catalogue change.** If one seems needed, stop and report BLOCKED.
- **Copy, exact:** `Your roles changed, so you can't send this any more.` It is staff text, English only. Nothing goes into `src/client-text.mjs` or `src/zh-hant.mjs`.
- **Wake events:** window `focus`, `online`, realtime reconnect (`onConnection` back to `"online"`), and document `visibilitychange` when `visibilityState === "visible"`. The refresh after a successful action is not a wake.
- **Refusals that re-read:** `FORBIDDEN` and `INELIGIBLE`, only in a staff window that is cleared.
- **Effective-capability dialogs:**
  - `admin`: `assign`, `close-unsigned`, `close-case`, `put-on-hold`, `resume-from-hold`, `mark-ready-to-efile`, `mark-efiled`, `record-filing-result`, `return-to-signing`, `request-documents`;
  - `followup`: `log-call`;
  - `assist`: `resolve-help`;
  - `review`: `request-corrections`.
- **Ceiling dialogs, never swapped:** `volunteer`, `send-invitation`, `cancel-invitation`, `deactivate-account`, `update-people`, `unpublish-update`, `delete-update`, `notifications`.
- **Dialogs that need no capability, never swapped:** the client dialogs `help`, `regenerate`, `print`, `withdraw`, and `leave-add-case`, which calls no RPC. They are listed, not excluded, so every dialog must pick a category.
- **Add a case:** Save draft and Send to the office are swapped when the person lacks effective `admin` (what `vitally_create_case` checks). Cancel and the typed answers stay.
- **Data:** fictional data only, in tests and fixtures.
- **Commands:** every command runs with a timeout. Never start a foreground server.

## Review Focus

1. **A wake check that fails** (`OFFLINE`) in a cleared window must not drop the work or show the setup screen. The refresh goes on with its normal re-read, and the failure shows as any refresh failure does. Test in Task 1.
2. **Signing out while a wake check is out** must apply nothing to the next user. The existing `same()` guard covers it. Test in Task 1.
3. **A tab becoming hidden** (`visibilitychange` with `visibilityState === "hidden"`) must not refresh. `stop()` must remove the listener. Test in Task 1.
4. **A `FORBIDDEN` in an uncleared window or a client window** (for example an uncleared admin's Roster save) must not start an extra clearance check. Test in Task 2.
5. **An unsaved case-page draft** must survive losing the capability and show again when it returns. Test in Task 3.

---

### Task 1: Wake events re-read the clearance in a cleared window

**Files:**
- Modify: `src/controller.mjs`: the `createController` options (~281); `refresh` (~877); `onWake`, `listen` and `unlisten` (~982–996); `subscribe`'s `onConnection` (~1008)
- Modify: `src/app.mjs:138`: pass `documentEvents: document`
- Test: `tests/controller.test.mjs`: add `documentEvents` to `build()` (~382), and new tests after the setup-screen block (~8140)

**Interfaces:**
- Produces:
  - `createController({ ..., documentEvents = globalThis.document })`;
  - `refresh({ wake = false } = {})`. All existing callers keep `refresh()`, meaning not a wake.
  - In tests, `build({ documentEvents })` returns `{ controller, events, documents, sessionStorage, renders }`. `documents` is a `fakeEvents()` with a writable `visibilityState` (default `"visible"`).

- [ ] **Step 1: Write the failing tests** in `tests/controller.test.mjs`. Use `staffStore`, `RILEY_CLEARED` and `clearanceCalls` from the setup-screen block, and `SETUP_CASE`.

```js
test("a cleared window re-reads its clearance on focus, and shows an added role", async () => {
  const store = staffStore({ clearance: { ...RILEY_CLEARED, capabilities: ["prepare"], isAdmin: true } });
  const { controller, events } = build({ store });
  await controller.start();
  const before = clearanceCalls(store);
  store.nextClearance = { ...RILEY_CLEARED, capabilities: ["prepare", "review"] };
  await events.emit("focus");
  assert.equal(clearanceCalls(store) - before, 1);
  const own = controller.getState().people.find((p) => p.id === "person-riley");
  assert.deepEqual(own.capabilities, ["prepare", "review"]);
  controller.stop();
});

test("a tab that becomes visible re-reads the clearance; one that is hidden does not", async () => {
  const store = staffStore();
  const { controller, documents } = build({ store });
  await controller.start();
  const before = clearanceCalls(store);
  documents.visibilityState = "hidden";
  await documents.emit("visibilitychange");
  assert.equal(clearanceCalls(store) - before, 0);
  documents.visibilityState = "visible";
  await documents.emit("visibilitychange");
  assert.equal(clearanceCalls(store) - before, 1);
  controller.stop();
  assert.equal(documents.count("visibilitychange"), 0);
});

test("every role removed: focus shows the setup screen and reads no case list", async () => {
  const store = staffStore({ cases: [{ ...SETUP_CASE }] });
  const { controller, events } = build({ store });
  await controller.start();
  const lists = store.calls.filter((c) => c === "listCases").length;
  store.nextClearance = { ...UNCLEARED };
  await events.emit("focus");
  assert.equal(controller.getState().principal.clearance.cleared, false);
  assert.match(staffScreen(controller.getState()), /Finish your setup for this season/);
  assert.equal(store.calls.filter((c) => c === "listCases").length, lists);
  controller.stop();
});

test("the refresh after a successful action reads no clearance", async () => {
  const store = staffStore({
    assistance: [{ id: "item-1", title: "Help with the forms", status: "open", revision: 1, assigneeId: null }],
  });
  const { controller } = build({ store });
  await controller.start();
  const before = clearanceCalls(store);
  await controller.runAssistanceAction("CLAIM", "item-1");
  assert.equal(clearanceCalls(store) - before, 0);
  controller.stop();
});

test("a wake check that fails keeps the work and still re-reads the lists", async () => {
  const store = staffStore({ cases: [{ ...SETUP_CASE }] });
  const { controller, events } = build({ store });
  await controller.start();
  const lists = store.calls.filter((c) => c === "listCases").length;
  store.nextClearance = Object.assign(new Error("offline"), { code: "OFFLINE" });
  await events.emit("focus");
  const state = controller.getState();
  assert.equal(state.principal.clearance.cleared, true);
  assert.equal(state.cases.length, 1);
  assert.ok(store.calls.filter((c) => c === "listCases").length > lists);
  controller.stop();
});

test("signing out while a wake check is out applies nothing to the next window state", async () => {
  // Gate the focus check, sign out, release: the user is gone, so principal stays null.
  // (Mirror "signing out forgets a pending clearance check…" with events.emit("focus").)
});
```

Write the last test's body by mirroring the existing test "signing out forgets a pending clearance check, so the next user's Check again asks afresh", with the check started by `events.emit("focus")` without awaiting it. Assert `controller.getState().principal === null` after the release.

- [ ] **Step 2: Run the tests and see them fail**

Run: `timeout 300 node --test --test-name-pattern="re-reads its clearance on focus|becomes visible|every role removed: focus|after a successful action reads no clearance|wake check that fails|while a wake check is out" tests/controller.test.mjs`
Expected: FAIL. There is no focus re-read when cleared, and no `visibilitychange` listener.

- [ ] **Step 3: Implement the wake path** (design D1, D7)
  - **Wake handlers:** `onWake = () => refresh({ wake: true })`. Add `onVisible = () => documentEvents?.visibilityState === "visible" ? refresh({ wake: true }) : undefined`. Add and remove `"visibilitychange"` on `documentEvents` in `listen`/`unlisten`. The reconnect call in `onConnection` becomes `refresh({ wake: true })`.
  - **`refresh`, cleared branch:** when `wake` is true, start with `await checkClearance()`. If `awaitingClearance(state)` afterwards, `return`, because `recheckClearance` already dropped the work and redrew. A failed check leaves the window cleared, so the refresh goes on.
  - **App wiring:** in `src/app.mjs`, pass `documentEvents: document`.
  - **Test helper:** in `build()`, pass `options.documentEvents ?? Object.assign(fakeEvents(), { visibilityState: "visible" })` and return it as `documents`.

- [ ] **Step 4: Run the tests and see them pass, then the whole controller file**

Run: `timeout 600 node --test tests/controller.test.mjs`
Expected: PASS, with no other test broken. Existing uncleared focus tests still ask once per focus.

- [ ] **Step 5: Commit**

```bash
git add src/controller.mjs src/app.mjs tests/controller.test.mjs
git commit -m "Clearance: a cleared window re-reads it on focus, visibility, online and reconnect (#190)"
```

### Task 2: Refusals and saving one's own row re-read the clearance

**Files:**
- Modify: `src/controller.mjs`: `noteFailure` (~643), `recheckAfterOwnSave` (~3798) and its caller condition (~3790)
- Test: `tests/controller.test.mjs`: new tests, and **change** the existing test "saving someone else's row, or one's own while cleared, asks for no clearance" (~9220)

**Interfaces:**
- Consumes: `checkClearance()` and `awaitingClearance(state)`, both unchanged.
- Produces: no new names.

- [ ] **Step 1: Write the failing tests**
  - **"a narrowed role is noticed on an INELIGIBLE claim, and the refusal stays"**
    - Setup: a cleared staff window, `clearance.capabilities: ["prepare","review"]`, a case at `stage: "review_ready"` with no reviewer, opened with `selectCase`.
    - Set `store.nextClearance` to capabilities `["prepare"]`, and `store.failNext = Object.assign(new Error("Needs review eligibility."), { code: "INELIGIBLE" })`.
    - Press the claim with `controller.runAction("CLAIM_REVIEW", {})`. Expect a rejection.
    - Then `await controller.checkClearance()`, which is the pending check.
    - Assert:
      - `clearanceCalls` went up by 1;
      - `state.error.code === "INELIGIBLE"`;
      - the own entry's capabilities are `["prepare"]`;
      - `staffEligibility(state.savedCase, own).claimReview().allowed === false`.
  - **"assigning someone uncleared re-reads once and changes nothing"**
    - Setup: `adminStaffStore`. Assign through `controller.openAssign(...)` then `controller.assignCase(...)` (see ~1215–1240) with `store.failNext` code `INELIGIBLE` and an unchanged `nextClearance`.
    - Assert: one `getClearance`, the error is still `INELIGIBLE`, the own capabilities are unchanged, and there is no extra render after the check (`renders.count` is the same before and after `await controller.checkClearance()`).
  - **"a FORBIDDEN in an uncleared window starts no extra check"**
    - Setup: `selfRosterStore(UNCLEARED_ADMIN)`, a Roster save refused with `store.failNext` code `FORBIDDEN`.
    - Assert: `getClearance` count unchanged.
  - **Change the existing test.** Its cleared half becomes its own test, "saving one's own row while cleared asks for the clearance once": assert `checks + 1`, not `checks`. Keep the "another person's row" half as it is, and rename that test "saving someone else's row asks for no clearance". This contract changed (spec: "Saving one's own Roster row re-reads the clearance").
  - **"saving one's own row while cleared drops a removed role's buttons"**
    - Setup: `selfRosterStore` cleared with capabilities `["admin","prepare"]`. Save with `nextClearance` capabilities `["admin"]`.
    - Assert: the own entry has no `prepare`.
  - **"saving one's own row with no roles shows the setup screen and stays on the Roster"**
    - Setup: cleared. Save with `nextClearance` set to `{ ...UNCLEARED_ADMIN }`.
    - Assert: `cleared === false`, and `state.screen === "office-volunteers"`.

- [ ] **Step 2: Run the tests and see them fail**

Run: `timeout 300 node --test --test-name-pattern="narrowed role is noticed|assigning someone uncleared|FORBIDDEN in an uncleared|own row while cleared|own row with no roles|someone else's row" tests/controller.test.mjs`
Expected: FAIL. No re-read on refusal, and no own-row re-read while cleared.

- [ ] **Step 3: Implement** (design D2, D3)
  - **`noteFailure`:** after the error is recorded (after `state.error = …`), add: if `staffWindow() && !awaitingClearance(state)` and the code is `"FORBIDDEN"` or `"INELIGIBLE"`, then `void checkClearance()`.
  - **Own-row save:** the caller condition becomes `volunteerId && volunteerId === state.principal?.personId`. `recheckAfterOwnSave` becomes: `if (clearanceCheck) await clearanceCheck; await checkClearance();`.

- [ ] **Step 4: Run the tests and see them pass, then the whole controller file**

Run: `timeout 600 node --test tests/controller.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/controller.mjs tests/controller.test.mjs
git commit -m "Clearance: FORBIDDEN/INELIGIBLE and one's own Roster save re-read it while cleared (#190)"
```

### Task 3: Quiet cleared → cleared answers, single-flight, and the screen fallback

**Files:**
- Modify: `src/controller.mjs`: `recheckClearance` (~1816–1856)
- Test: `tests/controller.test.mjs`

**Interfaces:**
- Consumes: Task 1's `refresh({ wake })` and `build().documents`.
- Produces: no new exported names. `recheckClearance` keeps its signature.

- [ ] **Step 1: Write the failing tests**
  - **"focus, visibility and a refusal while a check is out send one request"**
    - Gate `store.nextClearance` with a promise.
    - Call `events.emit("focus")` and `documents.emit("visibilitychange")` without awaiting them, and have an action refused with `FORBIDDEN`.
    - Release the gate, and await everything.
    - Assert `clearanceCalls - before === 1`.
  - **"an unchanged answer does not redraw"**
    - Setup: cleared, with `nextClearance` equal to the first answer.
    - Call `await controller.checkClearance()` directly, so no refresh is involved.
    - Assert `renders.count` is unchanged and no new `"getUpdates"` call (the feed read) is in `store.calls`.
  - **Screens on losing Admin.** Use a Riley store with `clearance.capabilities: ["prepare","admin","followup"]`, then `nextClearance` capabilities `["prepare"]`, `isAdmin: true` (the ceiling stays), then `await controller.checkClearance()`:
    - **"losing Admin on Follow-ups keeps the screen, now the Work board":** `state.screen === "staff"`, and `staffScreen(state)` matches `/Work board/` and doesn't match `/All cases/`.
    - **"losing Admin on All cases moves to the Work board, and regaining Admin does not move back":** start with `navigate("office-cases")`. After the narrowing, `state.screen === "staff"` and `renders.focus` ends with `true`. After a second check that restores `admin`, `state.screen === "staff"`.
    - **"losing Admin on an office case page keeps the case":** `selectCase("case-a")` first. Then `state.screen === "staff-case"`, `state.selectedCaseId === "case-a"`, and `staffScreen(state)` matches `/Back to the work board/`.
    - **"losing Admin on Add a case keeps the page and its answers":** start with `navigate("office-add-case")` and type one answer with `controller.editAnswers({ tp_first_name: "Avery" })`. Then `state.screen === "office-add-case"`, and `state.draftAnswers` still holds the answer.
  - **"a case-page draft survives losing Preparer and shows again when it returns"**
    - Setup: a cleared Preparer on a `preparing` case they hold, with a dirty draft.
    - Narrow to `[]`, but still cleared through another role, for example `capabilities: ["receive_documents","assist"]`. Then restore `["prepare"]`.
    - Assert `state.draftAnswers` and `state.dirty` are kept throughout, and `staffEligibility(...).preparationWork().allowed` is false and then true.

- [ ] **Step 2: Run the tests and see them fail**

Run: `timeout 300 node --test --test-name-pattern="while a check is out send one|unchanged answer does not redraw|losing Admin on|draft survives losing Preparer" tests/controller.test.mjs`
Expected: FAIL. All cases stays `office-cases`, and the unchanged answer redraws and reads the feed.

- [ ] **Step 3: Implement** (design D4, D5)
  - **The quiet path.** In `recheckClearance`, after `now`/`was` are known, when `now && was`:
    - compare the old and new effective capabilities as sets, and `isAdmin`;
    - if they're the same, `return`, after storing the answer (already done above);
    - otherwise, if the new capabilities lack `"admin"` and `state.screen === "office-cases"`, set `state.screen = homeScreen()` and remember to focus;
    - then `persistSession()` and `show(focus)`, and `return`.
  - **Keep the feed read where it was.** The existing `await readFeed()` stays only on the still-uncleared path.
  - **Order matters.** Take the old capabilities from `state.principal.clearance` before it is overwritten.

- [ ] **Step 4: Run the tests and see them pass, then the whole controller file**

Run: `timeout 600 node --test tests/controller.test.mjs`
Expected: PASS. The existing "a refreshed clearance with narrower capabilities narrows the person's own entry" still passes.

- [ ] **Step 5: Commit**

```bash
git add src/controller.mjs tests/controller.test.mjs
git commit -m "Clearance: a cleared re-check redraws only on a change, and All cases falls back to the work board (#190)"
```

### Task 4: Dialogs and Add a case drop their submit when the capability is gone

**Files:**
- Create: `src/role-gates.mjs`
- Modify:
  - `src/views.mjs`: the staff-screen office fallback (~382), so `office-add-case` is not sent to `staff`; `addCasePage` (~509), passing `locked`; and `dialog()`, passing `locked` into `ui` for `assign`, `log-call` and `resolve-help`
  - `src/admin-views.mjs`: the confirm in `closeCaseDialogBody`, `markReadyToEfileDialogBody`, `markEfiledDialogBody`, `recordFilingResultDialogBody`, `returnToSigningDialogBody`, `requestDocumentsDialogBody`, `putOnHoldDialogBody`, `resumeFromHoldDialogBody`; and the two `caseSubmit`s in `followupForms` (~552), when `ui.locked`
  - `src/office-views.mjs`: `closeUnsignedDialogBody` (~561); the RESOLVE submit in `resolveHelpDrawerBody` (~647); `logCallDrawerBody`, passing `ui` to `followupForms`; and the Save draft and Send to the office buttons in `renderAddCaseV2` (~895) when `ui.locked`
  - `src/staff-views.mjs`: the confirm in `correctionsDialogBody` (~1967)
  - `src/workload-views.mjs`: in `assignDrawerBody`, when `ui.locked`, the candidates' Choose buttons are replaced by the line, and the search field stays
- Test:
  - Create `tests/role-gates.test.mjs`;
  - add view tests to `tests/office-views.test.mjs`, `tests/admin-views.test.mjs` and `tests/workload-views.test.mjs`;
  - add a controller test to `tests/controller.test.mjs`

**Interfaces:**
- Produces, from `src/role-gates.mjs`:
  - `ROLES_CHANGED_TEXT: string`, exactly `Your roles changed, so you can't send this any more.`;
  - `rolesChangedLine(): string`: `<p class="field-note roles-changed" role="note">…</p>` with the escaped text;
  - `DIALOG_CAPABILITY: Readonly<Record<string, "admin"|"followup"|"assist"|"review">>`, the effective table from Global Constraints;
  - `CEILING_DIALOGS` and `NO_CAPABILITY_DIALOGS` (`help`, `regenerate`, `print`, `withdraw`, `leave-add-case`): `ReadonlyArray<string>`;
  - `ownCapabilities(state): string[]`: the signed-in person's entry in `state.people`, or `[]`;
  - `dialogLocked(state): boolean`: true only when `DIALOG_CAPABILITY[state.dialog]` exists and `ownCapabilities(state)` lacks it;
  - `addCaseLocked(state): boolean`: a staff principal whose own capabilities lack `"admin"`.

- [ ] **Step 1: Write the failing tests**
  - **`tests/role-gates.test.mjs`:**
    - `dialogLocked` is true for `log-call` without `followup`, false with it, and false for `volunteer` with no capabilities at all;
    - `addCaseLocked` follows `admin`;
    - `rolesChangedLine()` contains `ROLES_CHANGED_TEXT` escaped (`can&#39;t` or the project's escape of `'`; check `esc` in `src/ui.mjs`);
    - **"every staff dialog is classified":** read `src/views.mjs` with `fs.readFileSync`, collect every `state.dialog === "<key>"` and `"<key>"` in the `DRAWERS` array, and assert each key is in exactly one of `DIALOG_CAPABILITY`, `CEILING_DIALOGS` or `NO_CAPABILITY_DIALOGS`. No key is excluded from the check; also assert the three categories share no key.
  - **View tests:**
    - `logCallDrawerBody` with `ui.locked: true` has no `data-case-action="RECORD_CONTACT"` or `RESOLVE_FOLLOWUP` submit, and contains the text. Check `caseSubmit` in `src/ui.mjs` for the attribute name.
    - `resolveHelpDrawerBody` with `ui.locked: true` has no `data-assistance-action="RESOLVE"`, and contains the text.
    - `closeCaseDialogBody` with a state whose own person lacks `admin` and `dialog: "close-case"` has no `CLOSE_CASE` submit, contains the text, and keeps the reason fieldset and "Keep it open".
    - `assignDrawerBody` with `ui.locked: true` has no `data-action="assign-case"`, and contains the text.
    - `renderAddCaseV2` with `locked: true` and a filled `draftAnswers` has no `save-office-draft` or `send-office-draft` buttons, keeps `add-case-cancel` and the answer's value, and contains the text.
    - `dialog(state)` for `volunteer` with no capabilities still renders the drawer's Save.
  - **Controller test, "an added Preparer role and an assignment show the preparation form after focus":**
    - Setup: an Intaker-only cleared window on a `preparing` case with another preparer.
    - Then: the store's case gets `preparerId: "person-riley"`, `nextClearance` capabilities gain `prepare`, and `events.emit("focus")`.
    - Assert: `staffScreen(state)` contains the preparation form's submit text "Record that preparation is complete in TaxSlayer".

- [ ] **Step 2: Run the tests and see them fail**

Run: `timeout 300 node --test tests/role-gates.test.mjs tests/office-views.test.mjs tests/admin-views.test.mjs tests/workload-views.test.mjs`
Expected: FAIL. `src/role-gates.mjs` doesn't exist.

- [ ] **Step 3: Create `src/role-gates.mjs`**, with the Interfaces above. Pure, and importing only `esc` from `./ui.mjs`.

- [ ] **Step 4: Swap the submits**
  - **Bodies that take `state`:** replace their confirm with `dialogLocked(state) ? rolesChangedLine() : <existing confirm>`.
  - **Bodies that take `ui`:** `dialog()` sets `ui.locked = dialogLocked(state)` for `assign`, `log-call` and `resolve-help`. `logCallDrawerBody` passes `ui` through to `followupForms`, which swaps both `caseSubmit`s.
  - **Add a case:**
    - `addCasePage` passes `locked: addCaseLocked(state)` to `renderAddCaseV2`, which swaps Save draft and Send to the office.
    - In `staffScreen`, `allowed(name)` returns true for `office-add-case` when the person is staff, whatever their capabilities, so the page stays.
    - Check `screenAllowed` in the controller: it already allows `office-add-case`.

- [ ] **Step 5: Run the tests and see them pass, then all unit tests**

Run: `timeout 900 npm test`
Expected: PASS, with the count of tests up by the new ones. Record the count before and after for the PR.

- [ ] **Step 6: Commit**

```bash
git add src/role-gates.mjs src/views.mjs src/admin-views.mjs src/office-views.mjs src/staff-views.mjs src/workload-views.mjs tests/
git commit -m "Clearance: dialogs and Add a case swap their submit when a role is gone (#190)"
```

### Task 5: Checks

**Files:**
- Modify: `tests/browser.mjs` only if the story breaks on a changed button. Do not trim tests for time.

- [ ] **Step 1:** Run `timeout 900 npm test`. Expected: all pass. Note the test count compared with `main`.
- [ ] **Step 2:** Run `timeout 120 npx openspec validate --all`. Expected: all valid.
- [ ] **Step 3: The browser story runs in the PR's CI, not on the local stack** (the user's call at plan review).
  - Do not run `npm run test:browser` locally.
  - After the branch is pushed, the PR's `story` jobs (both legs) run it. If a PR isn't open yet, run `gh workflow run ci.yml --ref <branch>` on the pushed branch, and wait for it with a bounded timeout.
  - Every covering job must pass on the commit being verified. A skipped or cancelled job doesn't count. If a job passes only on a re-run, say it failed first.
  - Link the run in `verify.md` and the PR body, and review the story screenshots from the run's artifacts.
  - If the story goes over 900 s, stop and show the per-phase timings. Don't trim tests.
- [ ] **Step 4:** Tick the matching boxes in `openspec/changes/recheck-clearance-while-cleared/tasks.md`, and commit:

```bash
git add openspec/changes/recheck-clearance-while-cleared/tasks.md
git commit -m "recheck-clearance-while-cleared: tasks done"
```

**Not needed, and why:**
- `npm run test:database` and `db:migrate:test`: no SQL changes.
- `npm run test:auth-browser`: sign-in is unchanged.
- `build:hant --check`: no client text changes.
