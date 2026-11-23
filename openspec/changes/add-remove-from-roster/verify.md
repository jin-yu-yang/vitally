# Verification Report

**Change**: `add-remove-from-roster`
**Verified at**: `2026-11-23 04:56` (America/New_York), at `bfc91a4`
**Verifier**: Claude (controller session), after apply (tasks 1–6, subagent-driven, clean final whole-branch review) and the Schedule follow-up (tasks 7.1–7.5, done in the controller session after main merged #271)

---

## 1. Structural Validation (`openspec validate --all --json`)

- [x] Every item is `"valid": true`

**Result**:

```text
25 items, 0 invalid (npx openspec validate --all --json)
```

Non-strict validation passes, and CI's `checks` job runs the same. `--strict` on this change reports only "Requirement text is very long" warnings, seven of them, on requirements written before the Schedule follow-up; the new shifts requirement is under the limit.

| Item | Type | Issues |
|---|---|---|
| — | — | — |

---

## 2. Task Completion (`tasks.md`)

- [x] Every `- [ ]` is now `- [x]` (20 of 20)

**Unfinished tasks**: none.

| Task | Why unfinished | Blocks archive |
|---|---|---|
| — | — | — |

---

## 3. Delta Spec Sync State

| Capability | Sync state | Notes |
|---|---|---|
| `volunteer-roster` | ✗ Needs sync | Merged by archive (step 8), after main is merged in |
| `sign-in-accounts` | ✗ Needs sync | Merged by archive |
| `site-coordinators` | ✗ Needs sync | Merged by archive |
| `volunteer-clearance` | ✗ Needs sync | Merged by archive |

All four deltas are `ADDED` only, so they add to the canonical specs and change no existing requirement. `volunteer-schedule` (from #271) is named by the new roster requirement but has no delta of its own: the Schedule's screens and RPCs don't change.

---

## 4. Design / Specs Coherence Spot Check

| Sample | design | specs | Gap |
|---|---|---|---|
| Order of checks, SELF before ADMIN_ROLE | D4 steps 2 and 4 (changed by ruling R5) | volunteer-roster "Removing a volunteer is refused when it does not apply" | None |
| Own drawer | D8 "Your own row" (ruling R7) | "The Edit drawer offers removal…", scenario "Your own drawer" | None |
| Accepted cases are open work | Trade-off line under Risks | Scenario "An Accepted case this season is open work" | None |
| Shifts from today on | D12, D4 step 12, D7 `shifts_removed` | "Removing a volunteer removes their shifts from today on", five scenarios; the confirmation's shifts line and scenario | None |
| Re-add points to Reactivate (#269) | D10 | "After re-adding someone whose account is deactivated…" | None |

**Drift warnings** (non-blocking): none.

---

## 5. Implementation Signal

- [x] No unstaged files in the worktree (apart from this report, committed with it)
- [x] Every commit is pushed to `add-remove-from-roster`

**Commit range**: `93ea623..bfc91a4`, with main merged in at `3baf47d` (main's 058 is the Schedule, so ours became `059_remove_from_roster.sql`).

### Checks run

- **Unit** (`npm test`): 2482 of 2482 pass, at `361a501`. `bfc91a4` changes only a database-test inventory.
- **Full CI on `bfc91a4`**: [run 45111772982](https://github.com/jin-yu-yang/vitally/actions/runs/45111772982), every job green: `checks`, `database`, `sign-in`, `story (chrome-client)` and `story (firefox-client)`. It stands in for the local database, sign-in and story runs (CLAUDE.md, Verification).
- **Earlier full run on `361a501`**: [run 45110230200](https://github.com/jin-yu-yang/vitally/actions/runs/45110230200) failed the `database` job, 959 of 961: `tests/database-actions.mjs` checks each RPC's receipt keys against `tests/support/rpc-signatures.mjs`, which did not yet list `shiftsRemoved`. Fixed in `bfc91a4`. `checks`, `sign-in` and both story legs passed on that run.
- **Quick database runs**: [45109798348](https://github.com/jin-yu-yang/vitally/actions/runs/45109798348) (`database-remove-from-roster.mjs`, `database-catalog.mjs`, `database-schedule.mjs`, 58 of 58, including the three new shift tests) and [45111743255](https://github.com/jin-yu-yang/vitally/actions/runs/45111743255) (`database-actions.mjs`, after the fix). Iteration only; the full run is the evidence.
- **Before the Schedule follow-up**: full CI [45088122274](https://github.com/jin-yu-yang/vitally/actions/runs/45088122274) on `7816d0c` was all green.
- **Screenshots**: reviewed from run 45111772982's `story-screenshots-chrome-client` artifact. The Roster's returning-volunteer picker and the admin's Schedule day render as before. The remove-from-roster browser test runs in its own `test(...)` block and takes no story screenshots.
- **Not run**: `npm run build:hant -- --check` locally (no client text changed; CI's `checks` runs it). No local stack on this machine; CI starts from an empty database, and 059 changes no existing rows on deploy, so no run on a stack holding main's migrations is needed.

### Known gaps (ruling R8, parked)

- An invitation that has expired but hasn't been swept yet gets the "deactivated" account line in the confirmation instead of a line for an expired invitation.
- No browser test opens a removed site coordinator's window. The database test checks that they are no longer cleared but still a workspace admin, and the existing clearance tests cover the setup screen.
- The confirmation's shifts line is only as fresh as the Roster's last read (D12). Shifts added later in another window are still removed; only the line may miss them.

---

## 6. Front-Door Routing Leak Detector (warning, non-blocking)

```bash
ls docs/superpowers/specs/*.md 2>/dev/null
```

- [x] Files exist, but all are historical design documents from before the schema was installed (CLAUDE.md, Historical documents). This change wrote nothing there.

| File | Captured in the change? | Action |
|---|---|---|
| — | — | — |

---

## 7. Deferred Manual Dogfood vs Automated Test Equivalence

`plan.md` has no `[~]` rows, so this section is empty.

---

## Overall Decision

- [x] ✅ PASS — ready for the retrospective, archive and the PR
- [ ] ⚠️ PASS WITH WARNINGS
- [ ] ❌ FAIL

**Next**: `retrospective.md`, then merge main, `/opsx:archive add-remove-from-roster`, and the PR. Deploy order: once Zeye approves the final 059, apply it to the hosted database from this worktree, then merge. If 059 changes after his approval, he looks again before it is applied.
