# Verification Report

**Change**: `remove-presenter-screens`
**Verified at**: `2026-11-06 21:55`
**Verifier**: Claude Code, the controller of the subagent-driven apply. The `openspec-verify-change` skill isn't installed, so I ran the checks directly.

PRECHECK: 17 commits on the branch since `main`, and 21 ticked tasks in `tasks.md`. Both are positive.

---

## 1. Structural Validation (`openspec validate --all --json`)

- [x] Every item is `"valid": true`

**Result:**

```text
Totals: 13 passed, 0 failed (13 items)
```

| Item | Type | Issues |
|---|---|---|
| — | — | — |

---

## 2. Task Completion (`tasks.md`)

- [x] Every `- [ ]` is now `- [x]` (21 of 21)

How the verification tasks were met:
- **5.1 `npm test`:** 1498 tests, all pass. It was 1509 on the base (`main` `341cdda`).
  - Removed tests each tested code this change removes, and each comes with grep evidence.
  - Tests that used a presenter only for shared staff behaviour were converted to a staff principal.
  - Three tests first removed in Task 2 were restored or converted under the user's rule, because their code still runs.
- **5.2 `npm run build:hant -- --check`:** clean, after the 简体 removals in Task 3 and the final fix wave.
- **5.3 `npm run test:auth-browser`:** 20/20, run alone on the local stack.
- **5.4 `npm run test:browser`:** the plain command, on `efba8db` (`main` with #168 merged in), alone on the stack:
  - 83/83, exit 0, 40 steps per order, 0 retries;
  - Chrome client with Firefox staff: 785.1 s;
  - Firefox client with Chrome staff: 693.8 s.

  An earlier run on 3ac5cae passed every step in both orders, but one order timed out at the old 900 s limit. Nothing was trimmed. The user raised the limit to 1200 s in #168, and this run is the one that counts.
- **5.5 `npx openspec validate --all`:** 13/13.

| Task | Not done because | Blocks archive |
|---|---|---|
| — | — | — |

---

## 3. Delta Spec Sync State

| Capability | Sync state | Notes |
|---|---|---|
| `sign-in` | ✗ Needs sync | 1 ADDED: a presenter account gets a plain screen and no staff screens. |
| `staff-case-work` | ✗ Needs sync | 1 REMOVED and 1 ADDED: "Staff screens have no persona picker or presenter controls" replaces "A staff account's screens have no persona picker or presenter controls". |
| `case-lifecycle` | ✗ Needs sync | 1 MODIFIED: "Screening starts when an admin first opens a case". |
| `screen-states` | ✗ Needs sync | 3 MODIFIED, plus 1 REMOVED and 1 ADDED: "Every confirmation dialog has the same shape" replaces "Every confirmation has the same shape". |
| `demo-tools` | ✗ Needs sync | 1 MODIFIED: "Fictional-fill controls appear only with the demo-tools switch". |

All of these are expected before archive (CLAUDE.md lifecycle step 8).

---

## 4. Design / Specs Coherence Spot Check

| Item | Design | Spec | Gap |
|---|---|---|---|
| D1 plain screen | A presenter gets one English screen and nothing loads | sign-in ADDED requirement | None. The final code renders it in a bare frame, so there's no client header or footer, and `viewLang` is English. |
| D2 not a staff window | `isStaffWindow` / `staffWindow()` are staff-only | staff-case-work "A presenter gets no staff screens" | None |
| D4 persona gone | `selectedPersonId` is removed, and a stored one is ignored | staff-case-work "A leftover persona in browser storage" | None |
| D6 browser story | Every presenter step is replaced one for one | (tests) | None. The count is 83 before and after, with 40 steps per order. |
| D7 corrections toast | "The toast is never inert" uses "The preparer was asked for corrections." | screen-states MODIFIED | None |

**Drift warnings** (non-blocking):

- **The inert guard.** The design says the controller "loads nothing" for a presenter. The implementation is one `inert()` check.
  - It is the first line of every data load, of `persistSession` and of `subscribe`. The user asked for this, and it was tracked as T3-GUARD.
  - The `loadWorkspace` guard can't be pinned by a test, because the staff-only check after it also returns for a presenter. The user kept it (option 1), with a comment in the test.
- **Wording beyond the design.** The sentence for a staff account with no linked person was "Choose a volunteer persona to act as.". It is now "This account isn't linked to a volunteer yet. Ask your site coordinator.", by the user's decision. No spec quotes either sentence.
- **The browser story's in-window check.** It now uses a fourth account, Quinn Harper, made in the contact-log step. The design names the Site Coordinator. The change is there so that no sign-out ends a session another window uses (Supabase signs out every session of an account). The user chose this as option C.

---

## 5. Implementation Signal

- [x] Nothing is left unstaged in the worktree. This report and the retrospective are committed next.
- [ ] Every commit pushed: the branch is pushed up to the tasks commit. This report is pushed at the finish step.

**Commit range:** `4ae1862..7ef3305`, with `main` merged at `efba8db`.

---

## 6. Front-Door Routing Leak Detector (warning, non-blocking)

```bash
ls docs/superpowers/specs/*.md   # 8 files
```

- [x] All 8 are the historical design documents from parts 1–4d, which CLAUDE.md says to keep. This change wrote nothing under `docs/superpowers/`.

| File | Captured in the change | Action |
|---|---|---|
| — | — | None |

---

## 7. Deferred Manual Dogfood vs Automated Test Equivalence

`plan.md` has no `[~]` rows. The browser story and the sign-in suite cover the presenter's plain screen in real browsers: the sign-in step, the plain screen and "two staff accounts…". There's no manual check.

---

## Overall Decision

- [ ] ✅ PASS
- [x] ⚠️ PASS WITH WARNINGS: the drift notes in §4. Each was decided by the user.
- [ ] ❌ FAIL

**Next step:** write the retrospective, merge `main` again if it moved, archive, then push and open the PR with "Closes #134".
