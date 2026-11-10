# Verification Report

**Change**: `add-volunteer-roster-records`
**Verified at**: `2026-11-10`
**Verifier**: Claude Code, the controller of the subagent-driven apply. The `openspec-verify-change` skill isn't installed, so I ran the checks directly.

PRECHECK: 12 commits on the branch beyond `main` (`f2547a6..35a73fa`), and 16 ticked tasks in `tasks.md`. Both are positive.

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

- [ ] Every `- [ ]` is now `- [x]`: 16 of 17.

**Open tasks:**

| Task | Why it's open | Blocks archive? |
|---|---|---|
| 5.2 Run all checks | Every suite passed except the browser story's Chrome client / Firefox staff order, which fails intermittently on this branch and on `main` (#183, below). The user ruled on 2026-11-10 to fix #183 first. Then `main` is merged into this branch and its `story (chrome-client)` runs 4 times. 5.2 is ticked, and this report updated, after those runs. | No. It blocks the PR, which isn't opened until then. |

### Test counts

| Suite | `main` (`f2547a6`) | This branch (`35a73fa`) | Difference |
|---|---|---|---|
| Unit (CI `checks`) | 1515 | 1565 | +50 |
| Database (CI, fresh stack) | 450 | 479 | +29 |
| Sign-in (CI) | 20 | 20 | 0 |
| Browser, each CI leg | 42 | 43 | +1 |

- **Where the numbers come from:** each is the runner's `ℹ tests` line, from `main`'s run [42748020967](https://github.com/jin-yu-yang/vitally/actions/runs/42748020967) and the branch's run [42759889786](https://github.com/jin-yu-yang/vitally/actions/runs/42759889786).
- **Browser, +1:** the new top-level Roster test. `tests/browser.mjs` has 3 top-level tests on `main` and 4 here, and no phase was added to or removed from either story order.
- **No test was removed.** The only test name that left is a rename: "the public API is exactly six RPCs" became "…seven RPCs" for `vitally_save_volunteer`.
- **Adjusted for the new contract, not removed:** `tests/database-staff-identity.mjs:615`, plus `tests/database.mjs:392` and `:437`.

### Local checks (Task 8, at `524bfbd`, and the fix wave at `101b840`)

| Check | Result |
|---|---|
| `npm test` | 1564 of 1565. The one failure is the Windows-only "both files are written with mode 600…" (`tests/write-test-env.test.mjs`), already on `main`, passing on CI's Linux. |
| `npm run db:migrate:test` | Applied onto a stack already at `main`'s 043, after Task 1 rolled it back to 043 and re-applied 044. Nothing pending afterwards. |
| `npm run test:database` | 479 of 479 |
| `npm run test:auth-browser` | 20 of 20, twice |
| `npm run test:browser` | 45 of 47. The Roster test passed (23.5 s), and Firefox client / Chrome staff passed (810 s). Chrome client / Firefox staff **failed** at "the seed builds its eleven cases": `#field-board-search` was detached 8 times while the board redrew. |
| `npx openspec validate --all` | 13 of 13 |
| `npm run build:hant -- --check`, `npm run build:intake` | Not touched by this change, which has no client text and no catalogue change. CI's `checks` job ran both and passed. |

### The backfill, checked by hand

CI starts from an empty database, so it never runs the backfill on existing rows. I ran it on the local stack in a scratch workspace with three staff accounts and one applicant, all fictional. The result was 3 profiles and 3 roster entries, with no roles, and nothing for the applicant. That matches D6 and the spec's "Existing staff are on the Roster after the migration". The user's own `.vitally-roster.local.json` was left untouched.

### The browser story (Chrome client, Firefox staff): tracked in #183

A press on a Firefox staff page sometimes never reaches the app, so the screen doesn't change within 10 s. Opening a case tab, the cases list or a form has failed this way, and so have workflow presses, which the story re-sends before its last check fails.

| Code | Chrome-client story in CI |
|---|---|
| `main` (counting #184, which is `main` plus error capture) | 6 passes, 2 failures |
| This branch | 1 pass, 6 failures, plus 1 local failure |
| The branch with the Roster CSS removed (throwaway A) | 2 passes |
| The branch with the `people` policy change and helper removed (throwaway B) | 2 passes |
| The branch with `src/` as on `main` (throwaway D) | 1 failure |

- **The cause is the same everywhere:** #184's error capture showed no window threw or logged an error. The press simply never reached the app, so this isn't a branch defect.
- **The branch question is open:** whether the branch only makes it more frequent isn't settled. The run list and links are in #183.
- **The Roster test was moved after both story orders as a precaution** (`35a73fa`). It leaves nothing behind: its own fixture, workspace and accounts are closed and deleted in `finally`. The cause is unproven.
- **The Firefox client / Chrome staff order passed every time.**

### Deviations from the plan

- **Two foreign keys are deferrable initially deferred:** `added_by_person_id` and `confirmed_by_person_id`. With immediate checking, deleting a workspace failed with 23503, because its people and roster rows go in the same cascade.
- **The claim refusal is `VT006`:** the "roles grant nothing" test expects `VT006` (`INELIGIBLE`), not the plan's `VT001`. The spec only says "refused".
- **The browser test's live redraw** comes from an unchanged-value update to the `workspaces` row, not a `people` update. A staff window doesn't redraw for a `people` change.

### Known minor behaviour, recorded rather than fixed (final review)

- **Misleading message after a lost answer:** if a save's answer is lost, for example offline, pressing Save again says the volunteer changed, though the first save landed.
- **Save after a conflict:** after a conflict, the same drawer can Save again and succeed over the newer values. The drawer's message asks the admin to close and reopen it.
- **Try again can go away:** after a failed list load, dismissing the error removes Try again. Opening the Roster again reloads it.

---

## 3. Delta Spec Sync State

| Capability | Sync state | Note |
|---|---|---|
| `volunteer-roster` | ✗ Needs sync | A new capability. Archive creates `openspec/specs/volunteer-roster/spec.md`. |
| `sign-in` | ✗ Needs sync | The MODIFIED header "The roster creates staff members as new people, with no reserved keys" exists in the canonical spec. |
| `local-seed-data` | ✗ Needs sync | The ADDED header "The local seed command adds fictional volunteers" doesn't collide. |

---

## 4. Design / Specs Coherence Spot Check

| Sample | Design | Specs | Gap |
|---|---|---|---|
| D2 admin check | `vitally_policy.is_workspace_admin(p_workspace_id)`, no user id, `authenticated` only | "The admin check answers only for the caller" | None |
| D3 who may read a person | No sign-in and no capabilities: admins only | "A volunteer with no sign-in is visible only to admins" | None |
| D4 one RPC writes | Admin check first, before a receipt | "Only an admin can save a volunteer" | None |
| D5 roster linking | Link by email, keep the Roster's name, report by key | sign-in MODIFIED requirement | None |
| D6 backfill | Profiles and entries for staff, no roles | "Existing staff are on the Roster after the migration" | None |
| D10 seed | Volunteers in `seedWorkspace`, not `seedCases` | local-seed-data ADDED requirement | None |

**Drift warnings (non-blocking):**
- The design doesn't mention the deferrable foreign keys (see Deviations).
- D10 says the Roster test is a separate top-level test. That still holds, and since `35a73fa` it runs after both story orders.

---

## 5. Implementation Signal

- [x] No unstaged files in the worktree other than this report, committed with it.
- [x] All implementation commits are pushed, through `35a73fa`.

**Commit range:** `f2547a6..35a73fa`, 12 commits.

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
- [x] ⚠️ PASS WITH WARNINGS — continue to the retrospective and archive. Task 5.2 stays open until #183 is fixed, `main` is merged in, and the branch's `story (chrome-client)` has run 4 times. The PR waits for that.
- [ ] ❌ FAIL

**Next step:** write the retrospective, delete the subagent workspace, archive. After #183's fix merges: merge `main`, run the chrome-client story 4 times, tick 5.2 and update this report, then push and open the PR.
