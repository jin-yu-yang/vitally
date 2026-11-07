# Verification Report

**Change**: `remove-sample-case-tools`
**Verified at**: `2026-11-07 12:30`
**Verifier**: Claude Code, the controller of the subagent-driven apply. The `openspec-verify-change` skill isn't installed, so I ran the checks directly.

PRECHECK: 13 commits on the branch since `main` (`a724def`), and 23 ticked tasks in `tasks.md`. Both are positive.

---

## 1. Structural Validation (`openspec validate --all --json`)

- [x] Every item is `"valid": true`

**Result:**

```text
13 items, 0 invalid
```

| Item | Type | Issues |
|---|---|---|
| — | — | — |

---

## 2. Task Completion (`tasks.md`)

- [x] Every `- [ ]` is now `- [x]` (23 of 23)

How the verification tasks were met:
- **Before 040 was applied:**
  - The controller took a full local backup: `before-040-20261106-234850.dump` plus the globals file, outside the repo. A restore into a throwaway database proved it.
  - The read-only "before" counts were taken.
  - The user approved the apply.
- **After 040 was applied:** all 24 count lines are identical. That's 21 tables of non-sample data, plus `action_receipts` 402, `auth.users` 23 and `memberships` 17.
- **7.1 `npm test`:** 1496 tests, all pass, on `7efb166`. It was 1498 on the base.
  - 4 tests were removed. Each tested code this change removes.
  - 2 roster tests were added.
- **7.2 `npm run test:database`:** 440 tests, all pass, run alone on `7efb166`. It was 480 on the base.
  - 52 tests were removed. Each tested code 040 drops.
  - 9 were added in Task 1, 1 came from a one-into-two conversion, and 2 were added in the final fix wave.
- **7.3 `npm run test:browser`:** the plain command, alone on the stack, on `963e732`: 83/83.
  - The Chrome-client order with Firefox staff took 804.8 s.
  - The Firefox-client order with Chrome staff took 681.0 s.
  - Both are within the 1200 s limit.
  - Since `963e732`, the only changes are to docs, specs, database and unit tests, and one comment in `src/admin-views.mjs`. No browser-reached code changed, so the run still stands.
- **7.4 `npm run test:auth-browser`:** 20/20, run alone, on `963e732`.
- **7.5 `npm run build:hant -- --check`:** clean on `7efb166`.
- **7.6 `npx openspec validate --all`:** 13/13.

| Task | Not done because | Blocks archive |
|---|---|---|
| — | — | — |

---

## 3. Delta Spec Sync State

| Capability | Sync state | Notes |
|---|---|---|
| `sign-in` | ✗ Needs sync | 1 REMOVED: "Sample cases and checkpoints stay presenter-only". 1 MODIFIED: "A workspace can have staff and no presenter", without its presenter-only sentence. |
| `client-intake` | ✗ Needs sync | 2 REMOVED: "Sample cases are version 2" and "The sample cases include their Form 14446 answers". 1 ADDED: "Fictional details leave the client's 14446 answers alone". |
| `review-and-corrections` | ✗ Needs sync | 1 REMOVED: "Sample cases carry fictional answers". |
| `shaded-section` | ✗ Needs sync | 1 REMOVED: "Sample cases carry a fictional shaded section". |
| `case-lifecycle` | ✗ Needs sync | 2 MODIFIED: "The office records the screening checks" ("The online sample" now describes the seed) and "Admins record each return's filing result" (a note goes with its deleted case). |
| `local-seed-data` | ✗ Needs sync | 1 ADDED: "A seed re-run publishes no deletion and keeps receipts", with 3 scenarios. |

All of these are expected before archive (CLAUDE.md lifecycle step 8).

---

## 4. Design / Specs Coherence Spot Check

| Item | Design | Spec | Gap |
|---|---|---|---|
| D1 no CASCADE | Every dependent policy, constraint, index and function is dropped or rewritten by name, in order | (migration) | None. CASCADE appears only in comments (040:13, 19, 37). The catalog test pins the 24 policies and the origin check. |
| D2–D4 rewritten functions | `filing_notes_append_only`, `reserve_receipt` and `vitally_create_case` lose their sample branches. `initialize_workspace` loses its bindings argument. | case-lifecycle filing-result MODIFIED | None. The Task 1 review diffed each one against 003, 035 and 038. |
| Receipts outlive deletions | Receipts' `target_id` has no foreign key | local-seed-data ADDED "Receipts outlive the deleted cases" | None. `database-seed` "receipts outlive the cases a re-run deletes". |
| No deletion published | Realtime publishes insert and update only | local-seed-data ADDED "An applicant sees no deletion" | None. `database-realtime` "a seed re-run publishes no deletion an applicant could read". |
| Screening checks by service | The seed records identity only for an online case | case-lifecycle MODIFIED "The online sample" | None. The `database-seed` subtest reads the service from the stored answers. `database-actions` "an online case records the identity check with the other three" pins the identity branch, because no seeded case is online. |

**Drift warnings** (non-blocking):

- **Two canonical requirements left out of the brainstorm (Q10).** The final review found them: "The online sample" and the presenter-only sentence in sign-in. After archive they would have been false. The user had them revised as MODIFIED deltas, and they're in the table above.
- **The 040 comment from 038 is gone.** 040 drops 038's comment above `initialize_workspace`. 040 was already applied locally, and applied migrations are final, so the file stays as it is. The rationale still reads in 038.

---

## 5. Implementation Signal

- [x] Nothing is left unstaged in the worktree. This report and the retrospective are committed next.
- [ ] Every commit pushed: the branch is pushed up to the plan commit `dc9d5e0`. The rest is pushed at the finish step.

**Commit range:** `dc9d5e0..7efb166`.

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

`plan.md` has no `[~]` rows. The before and after row counts and the backup check were run, not deferred. Their output is summarised in §2.

---

## Overall Decision

- [ ] ✅ PASS
- [x] ⚠️ PASS WITH WARNINGS: the drift notes in §4. The user decided the first; the second follows CLAUDE.md's rule on applied migrations.
- [ ] ❌ FAIL

**Next step:** write the retrospective, merge `main` if it moved (it is still at `a724def`), archive, fix the stale Purpose lines, then push and open the PR with "Closes #135".
