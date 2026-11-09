# Verification Report

**Change**: `remove-presenter-access`
**Verified at**: `2026-11-09`
**Verifier**: Claude Code, the controller of the subagent-driven apply. The `openspec-verify-change` skill isn't installed, so I ran the checks directly.

PRECHECK: 19 non-merge commits on the branch beyond `main`, and 34 ticked tasks in `tasks.md`. Both are positive.

---

## 1. Structural Validation (`openspec validate --all --json`)

- [x] Every item is `"valid": true`

**Result:**

```text
13 items, 13 passed, 0 failed (1 change, 12 specs)
```

| Item | Type | Issues |
|---|---|---|
| — | — | — |

---

## 2. Task Completion (`tasks.md`)

- [ ] Every `- [ ]` is now `- [x]`: 34 of 36. The two open tasks are after-archive tasks.

**Open tasks:**

| Task | Why it's open | Blocks archive? |
|---|---|---|
| 9.1 Fix sign-in's `## Purpose` line and grep the specs | Can only be done after archive merges the deltas. | No. It happens straight after archive. |
| 9.2 Note the out-of-date local roster in the retrospective and PR | The retrospective and PR are written after this report. | No. |

### Test counts

| Suite | `main` | This branch | Difference |
|---|---|---|---|
| Unit (CI `checks`) | 1509 at `bdcc323` | 1515 at `f04495e` | +6 |
| Database (CI, fresh stack) | 448 at `bdcc323` | 450 at `f04495e` | +2 |
| Sign-in (CI) | 20 | 20 | 0 |
| Story, each engine order (CI) | 42 and 42 | 42 and 42 | 0 |

Every number is the runner's `ℹ tests` line. The story's 83 local tests are 41 per order plus one shared test, so each CI leg reports 42.

**Unit, +6:** 3 roster tests and 3 no-access tests were added, and one store test was removed while one late-change controller test was added.

**Database, +2:** 2 removed, 4 fewer from replacing five tests with one, 2 reserved-key tests added, and 6 catalog tests added (the catalog went from 6 to 12 `t.test` calls).

**The tests removed**, each with its code gone and shown by grep:
- database: "a presenter chooses a demo persona" and "a presenter tries a staff member's person" (the presenter branch of `acting_person`);
- unit: "a presenter's call still names the person" (`actingPerson`);
- one assertion in the roster test, "at least one presenter" (the `presenters.length === 0` checks).

Every other presenter test was converted or replaced.

### Local checks on the final code (`e812970`)

| Check | Result |
|---|---|
| `npm test` | 1507 of 1507 |
| `npm run test:database`, alone | 450 of 450 |
| `npm run test:auth-browser`, alone | 20 of 20 |
| `npm run test:browser`, plain, alone | order 1 **failed** at the Reviewer step; order 2 passed (707 s) |
| `npm run build:hant -- --check` | passes |
| `npm run build:intake` | leaves nothing to commit |
| `npx openspec validate --all` | 13 of 13 |

`f04495e` adds only the merge of #180 to these, and CI ran on it.

### The browser story's failures (cause unproven)

The story was intermittent on this branch. **The user ruled on 2026-11-09 that CI decides, and to continue with these failures disclosed.**

| Where | Commit | Order | Result | Failing step |
|---|---|---|---|---|
| Baseline, local | `3a668b1` | both | 83/83 | none |
| Task 6, local | `8aa7e32` | both | 83/83 (749 s, 689 s) | none |
| Task 6 fix round, run 4, local | before `064035c` | 1 | failed | "the Reviewer reviews…": "Corrections requested" not seen within 10 s after the press |
| Task 6 fix round, final, local | `064035c` | both | 83/83 (750 s, 700 s) | none |
| Final check, local | `e812970` | 1 | failed | "the Reviewer reviews…": the Request corrections form not visible within 10 s of pressing the button |
| Diagnostic run 1, local, order 1 only | `e812970` + diagnostics | 1 | failed | "the Site Coordinator logs a contact…": "Office queue" not shown |
| Diagnostic run 2 and 3, local, order 1 only | `e812970` + diagnostics | 1 | passed the Reviewer step (stopped there on purpose) | none |
| Diagnostic run 4, local, order 1 only | `e812970` + diagnostics | 1 | failed | "the Preparer verifies…": the client window's badge not updated within 20 s |
| CI `42675920745`, attempt 1 | `f04495e` | 1 | passed, 42 of 42 | none |
| CI `42675920745`, attempt 2 | `f04495e` | 1 | **failed**, 39 of 41 | "two staff accounts work one case…": the intake tab not shown within 10 s |

A fifth diagnostic run was cut off when its parent script was stopped, and it counts as no evidence.

**The paired CI sample.** `story (chrome-client)` (Chrome client, Firefox staff), each pair started together. CI's concurrency group is per ref, so the sample is four concurrent pairs in sequence; pair 1 was a full dispatch and pairs 2 to 4 re-ran only that job.

| Pair | `main` `bdcc323` (run `42680237920`) | Reviewer step | This branch `f04495e` (run `42680247725`) | Reviewer step |
|---|---|---|---|---|
| 1 | passed, 42 of 42 | 11.7 s | passed, 42 of 42 | 13.4 s |
| 2 | passed, 42 of 42 | 13.6 s | passed, 42 of 42 | 11.6 s |
| 3 | passed, 42 of 42 | 11.1 s | passed, 42 of 42 | 11.9 s |
| 4 | passed, 42 of 42 | 13.3 s | passed, 42 of 42 | 11.8 s |

**What's established:**
- The branch matched `main` 4 of 4, at the same Reviewer timings.
- The branch's CI total for this job is 5 passes and 1 failure. That's too small a sample to tell apart from `main`'s 4 of 4.
- Nothing on the Request corrections path changed for a staff window: `staff-views.mjs` and `case-actions.mjs` are unchanged, `openDialog`, `closeDialog`, `dismissError` and `dispatch` are unchanged, the `navigate` guard applies only to a no-access window, and the store only loses `p_person_id` and its lookup.
- No leftover reference to `inert()`, `testing` or `actingPerson` remains in `src`.

**What isn't:** the cause. Console and page errors weren't recorded for the failed runs, because the story fills that record only at the end of an order. A slow local stack alone doesn't explain it, since CI failed once on a fresh runner.

**Pattern (a lead, not a finding):** in most of the failures a press on a Firefox staff page had no visible effect within 10 s. One was a client window's missed live update instead.

### The data migration

Migration 043 was applied to the local stack on 2026-11-08 through the counted procedure:
- **Pre-check:** all nine refusal counts 0.
- **Backup:** `before-043-20261108-1933.dump`, sha256 `8ed045af…c890`, outside the repo; restored into a throwaway database with identical counts.
- **Refusal:** verified on the throwaway copy: `VT008`, per-kind counts, nothing changed. 043 succeeded once the reference was removed.
- **Rehearsal:** a clean restored copy matched every expected difference.

| Table | Before | After | Expected |
|---|---|---|---|
| `action_receipts` | 421 | 339 | −82 presenter receipts |
| `memberships` | 17 | 15 | −2 |
| `people` | 19 | 11 | −8 unreferenced personas |
| `auth.users` | 23 | 21 | −2 |
| `identities` | 23 | 21 | −2 |
| `sessions` | 19 | 17 | −2 |
| `refresh_tokens` | 42 | 22 | −20 |
| `mfa_amr_claims` | 19 | 17 | −2 |
| Every other table counted | unchanged | unchanged | 0 |

The after-counts equal the rehearsal's exactly. One persona stays: Sam in `d3c53ee2`, its default follow-up person. CI's `database` job also ran 001 to 043 from scratch.

### Task 6.6's allowed hits

`grep -i presenter` over `src tools tests`:
- tests that assert absence or refusal: `database-catalog.mjs`, `database-staff-identity.mjs`, `demo-fill.test.mjs`, `store.test.mjs`;
- the roster's `presenters` note: `tools/admin/roster.mjs` and `roster.test.mjs`.

`p_person_id` appears only in tests that assert it is absent or refused: `database-catalog.mjs`, `database-staff-identity.mjs` and `store.test.mjs`. `personId` remains only as the staff member's own property, and in names like `actorPersonId`.

---

## 3. Delta Spec Sync State

| Capability | Sync state | Note |
|---|---|---|
| `sign-in` | ✗ Needs sync | Archive merges it. Every REMOVED or MODIFIED header exists in the canonical spec, and no ADDED header collides. |
| `staff-case-work` | ✗ Needs sync | As above. |
| `demo-tools` | ✗ Needs sync | As above. |

---

## 4. Design / Specs Coherence Spot Check

| Sample | Design | Specs | Gap |
|---|---|---|---|
| D1 access check | Only `applicant` and `staff` | sign-in "A signed-in account acts as a client or a staff member" | None |
| D3 six RPCs | No person parameter; `authenticated` only | sign-in "A staff account acts as its own person with no person parameter" | None |
| D4 refusal | `VT008` with per-kind counts before any delete | sign-in "Presenter accounts are removed with their test-run history" | None |
| D5 personas | Delete unreferenced, keep referenced | Same requirement, two scenarios | None |
| D7 roster | Staff and `defaultFollowup` required | sign-in "A roster needs staff and a default follow-up person" | None |
| D8 no-access screen | Replaces the plain screen | Same requirement; made sticky after the Task 6 review | None |

**Drift warnings (non-blocking):** the design doesn't mention the sticky no-access behaviour, which the Task 6 review added to meet the spec's "with Sign out". The spec is the authority and the code meets it.

---

## 5. Implementation Signal

- [x] No unstaged files in the worktree other than this report and `tasks.md`, committed with it.
- [x] All implementation commits are pushed, through `f04495e`. The artifacts committed after it are pushed with the archive.

**Commit range:** `bdcc323..HEAD`, 19 non-merge commits.

---

## 6. Front-Door Routing Leak Detector (warning, non-blocking)

```bash
ls docs/superpowers/specs/*.md
```

- [x] The 8 files are legitimate: they predate the schema, and this change wrote none.

| File | Captured in the change? | Action |
|---|---|---|
| — | — | — |

---

## 7. Deferred Manual Dogfood vs Automated Test Equivalence

`plan.md` has no `[~]` rows, so this section is empty.

---

## Overall Decision

- [ ] ✅ PASS
- [x] ⚠️ PASS WITH WARNINGS — continue, with this noted: the browser story failed intermittently on this branch, locally and once in CI, and its cause is unproven. The user ruled to continue with the failures disclosed.
- [ ] ❌ FAIL

**Next step:** write the retrospective, delete the subagent workspace, merge `main` if it moved, archive, fix sign-in's Purpose line, then push and open the PR with "Closes #136".
