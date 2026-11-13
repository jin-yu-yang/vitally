# Verification Report

**Change**: `add-volunteer-clearance`
**Verified at**: `2026-11-13 03:10` (UTC)
**Verifier**: Claude Opus 5.5, controller of the subagent-driven apply, in the change worktree
**Commit verified**: `abb5b7d` (branch `add-volunteer-clearance`; merge-base with `main` `321fba0`)

---

## Checks run, and why

| Check | Where | Result | Before (main `321fba0`, CI 42913394361) |
|---|---|---|---|
| `npm test` (unit) | CI `checks`, run [43354542913](https://github.com/jin-yu-yang/vitally/actions/runs/43354542913) | 1627 / 1627 | 1575 / 1575 |
| `npm test` (unit) | local, Windows | 1626 / 1627: the one failure is the known Windows-only `tests/write-test-env.test.mjs`, which also fails on `main` | — |
| `npm run build:hant -- --check` | CI `checks` and local | pass (no client text changed) | — |
| `npm run build:intake` leaves nothing to commit | CI `checks` | pass | — |
| `npx openspec validate --all` | CI `checks` and local | pass (§1) | — |
| `npm run test:database` | CI `database`, run 43354542913 | 550 / 550 | 479 / 479 |
| `npm run db:migrate:test`, then `npm run test:database` on a stack that already had `main`'s migrations and seeded data (CLAUDE.md's rule for a migration that changes existing rows) | the user's local stack, after a `pg_dump` backup | 045 applied ("Approved test migrations applied."), then 546 / 546. After `seed:local` and the final tests, 550 / 550 on `abb5b7d` | — |
| `npm run test:auth-browser` | CI `sign-in`, run 43354542913 | 24 / 24 | 20 / 20 |
| `npm run test:browser` (the story) | CI `story (chrome-client)` and `story (firefox-client)`, run 43354542913 | 47 / 47 each; 622 s and 642 s (limit 900 s) | 46 / 46 each |
| `seed:local` on the populated stack (task 7.2) | the user's local stack | "Seeded 11 cases (removed 11 from the previous run) and 8 volunteers"; the second run leaves the role accounts' `revision` unchanged | — |

- **Every CI job passed on its first attempt in run 43354542913, with no re-run.** No 40001 serialization error appears in its log. The only "40001" string is a unit test's duration.
- **CI stands in for the local sign-in and story runs** (CLAUDE.md). The run is on the commit being verified, and every covering job passed. I reviewed the story screenshots from the run's artifacts:
  - `chrome-client-firefox-staff--staff-board-eight-cases-720`: a cleared Preparer's work board loads with cases.
  - `firefox-client-chrome-staff--office-case-pool-720`: the Site Coordinator has Follow-ups, All cases and Volunteers, and the full pool.
  - `chrome-client-firefox-staff--staff-signed-in-as`: a two-account sign-in reaches the board.
  - The story takes no screenshot of the setup screen or the Roster. Those are covered by assertions in the new phase and in `tests/auth-browser.mjs`.
- **Later commit.** The commit that adds this file and ticks `tasks.md` changes only `openspec/` text, so the run above still covers the code.

**Task 7.2, populated-stack details.** I checked these by SQL on workspace `160fc95a…`:
- The four role accounts are cleared, and their effective capabilities equal their ceiling as sets.
- Lucy Fong has no roles and is not cleared. Jordan Reyes is new, has no photo ID check, and is not cleared. Priya Venkat is new, has had the check, and is cleared. Hana Moretti holds VSC, IT&QR and Basic.
- The Roster has 12 people.
- Before the seed, the role accounts had no roles and no certificates, so clearing removed nothing.
- I did not repeat the screen checks (sign in as the Preparer, open Sky Chen's Roster) on that stack, because they need an emailed code. CI's story and sign-in jobs cover them.

---

## 1. Structural Validation (`openspec validate --all --json`)

- [x] Every item is `"valid": true`

**Result**: 14 items, all valid.
- The change: `add-volunteer-clearance`.
- The specs: `case-lifecycle`, `client-intake`, `demo-tools`, `draft-13614c`, `draft-14446`, `local-seed-data`, `office-follow-up`, `review-and-corrections`, `screen-states`, `shaded-section`, `sign-in`, `staff-case-work` and `volunteer-roster`.

| Item | Type | Issues |
|---|---|---|
| — | — | — |

---

## 2. Task Completion (`tasks.md`)

- [x] Every `- [ ]` is now `- [x]` (24 of 24, including the task 5.4 added by `/opsx:update` on 2026-11-12)

**Unfinished tasks**: none. Tasks 7.2 and 8.3 are ticked with this report, on the evidence above.

| Task | Why unfinished | Blocks archive |
|---|---|---|
| — | — | — |

---

## 3. Delta Spec Sync State

| Capability | Sync state | Note |
|---|---|---|
| `volunteer-clearance` | ✗ Needs sync | New capability (ADDED only). Archive creates `openspec/specs/volunteer-clearance/spec.md` |
| `volunteer-roster` | ✗ Needs sync | MODIFIED, ADDED and REMOVED. Every MODIFIED and REMOVED header matches a canonical header exactly (checked in the final review) |
| `sign-in` | ✗ Needs sync | Delta against the canonical spec |
| `staff-case-work` | ✗ Needs sync | Delta against the canonical spec |
| `local-seed-data` | ✗ Needs sync | Delta against the canonical spec |

These deltas were not synced on purpose. Archive (CLAUDE.md §2 step 8) merges them after `main` is merged into the branch.

---

## 4. Design / Specs Coherence Spot Check

| Sample | Design says | Specs counterpart | Gap |
|---|---|---|---|
| D1: role needs its certificates, deferred trigger | Deferred constraint trigger, any writer, VT007 | volunteer-clearance "A role exists only once its certificates are confirmed" | None |
| D4/D5: effective capabilities, VT009 first | `require_cleared` before any lookup in the six case RPCs | volunteer-clearance, the caller's capabilities and NOT_CLEARED requirements | None |
| D7: open-work rule | "compares old and new … removes" | volunteer-roster "A save cannot take away what a person's open work needs" | None (the implementation follows this, per the recorded ruling) |
| D10: `vitally_my_clearance()` and setup screen | Setup screen, Check again, focus re-check, ceiling admin keeps the Roster | volunteer-clearance, the setup-screen requirement | None |
| D12: seed | Clears the role accounts first, backs every volunteer | local-seed-data, the role-account and volunteer requirements | None |
| D14: save manages only confirmed certificates | Unsent uploaded rows kept; a ticked uploaded row is confirmed | volunteer-roster, edit requirement and two scenarios | None |

**Drift warnings** (non-blocking):
- `plan.md` Task 6's rule text (line 20 of its brief) still describes a state-based open-work check. The spec and design win, and the implementation follows them (ruling recorded in the retrospective). `plan.md` is a historical planning artifact, so I left it unchanged.
- `plan.md` Task 5 says `vitally_my_clearance` is `stable`. It is `volatile`, because `require_membership` takes a row lock that read-only transactions refuse (error 25006, CI 43094341618). This is commented in 045.
- `design.md` Open Questions left the open-work code to the plan. The implementation uses VT004 `OPEN_WORK` with a JSON-array detail.

---

## 5. Implementation Signal

- [x] No unstaged files in the worktree. Only ignored local files are present: `.env.test`, `.vitally-runs/` and `.vitally-roster.local.json`, copied from the main checkout for the populated-stack run.
- [x] Every relevant commit is pushed (`origin/add-volunteer-clearance` = `abb5b7d` before this report)

**Commit range**: `321fba0..abb5b7d` (55 commits)

---

## 6. Front-Door Routing Leak Detector (warning, non-blocking)

```bash
ls docs/superpowers/specs/*.md 2>/dev/null
```

- [x] There are 8 files, and all predate this change: `git log --diff-filter=A 321fba0..HEAD -- docs/superpowers/` lists none. CLAUDE.md keeps them as historical design documents. Nothing was written under `docs/superpowers/` in this change.

| File | Captured in the change? | Action |
|---|---|---|
| — | — | — |

---

## 7. Deferred Manual Dogfood vs Automated Test Equivalence

`plan.md` has no `[~]` rows, so this section is empty and passes.

| Deferred dogfood (plan §) | Equivalent automated test | Coverage assessment | Real gap? |
|---|---|---|---|
| — | — | — | — |

---

## Overall Decision

- [ ] ✅ PASS
- [x] ⚠️ PASS WITH WARNINGS: the §4 drift lines in `plan.md`, which are historical and non-blocking. The populated-stack screen checks were covered by CI, not repeated on the local stack.
- [ ] ❌ FAIL

**Next step**: write the retrospective (CLAUDE.md §2 step 7), then merge `main` and archive (step 8), then finish with the PR and the #138 follow-up issues (step 9).
