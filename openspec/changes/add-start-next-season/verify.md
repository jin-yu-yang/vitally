# Verification Report

> The `openspec-verify-change` skill is not installed in this repository, so the controller ran its PRECHECK and checks directly (CLAUDE.md, lifecycle step 6).

**Change**: `add-start-next-season`
**Verified at**: `2026-11-21` (America/New_York)
**Verifier**: Claude Opus 5.5 (subagent-driven-development controller)

PRECHECK:
- commits on the branch since `origin/main` (7e06662): 27 at ee8fb5b;
- ticked tasks in `tasks.md`: 26.

Both are positive.

---

## 1. Structural Validation (`openspec validate --all --json`)

- [x] Every item is `"valid": true`.

**Result**:

```text
{"totals":{"items":21,"passed":21,"failed":0},"byType":{"change":{"items":1,"passed":1,"failed":0},"spec":{"items":20,"passed":20,"failed":0}}}
```

| Item | Type | Issues |
|---|---|---|
| — | — | none |

---

## 2. Task Completion (`tasks.md`)

- [x] Every `- [ ]` is now `- [x]` (26/26).

| Task | Why not done | Blocks archive? |
|---|---|---|
| — | — | — |

---

## 3. Delta Spec Sync State

Archive merges the deltas (lifecycle step 8). Nothing is synced before then, by design.

| Capability | Sync state | Note |
|---|---|---|
| season-rollover | ✗ needs sync | new capability, ADDED 6: who starts it (by one, typed year); refused while work is unfinished; roster and sign-in reset; past-season cases read-only; clients keep past applications read-only; 055 drops `capabilities_before_052` |
| staff-case-work | ✗ needs sync | ADDED 1: staff screens show only the current season's cases (a direct open of a past-season case goes home) |
| volunteer-clearance | ✗ needs sync | MODIFIED 1: the capabilities mirror follows this season's roles while a person has a sign-in |
| volunteer-roster | ✗ needs sync | MODIFIED 1: a save cannot take away what open work needs, where open work now counts only current-season cases |
| sign-in-accounts | ✗ needs sync | MODIFIED 1: deactivate and reactivate. A deactivated window shows "This account has no access" on its next wake |
| review-and-corrections | ✗ needs sync | MODIFIED: the Exit Form header's tax year is the case's season − 1 |

---

## 4. Design / Specs Coherence Spot Check

| Sample | design | specs | Gap |
|---|---|---|---|
| D3 refusal | `SEASON_NOT_FINISHED` with open cases, open follow-ups, claimed help, unclaimed help on cases; counts only, no links | season-rollover refusal requirement and dialog scenario | none |
| Check order | FORBIDDEN → lock → receipt replay → CONFLICT → VALIDATION → open work | season-rollover refusal-order scenarios | none |
| Q4/Q5 order | move the default follow-up person → set `current_season` → ordinary `deactivate_account` | season-rollover default follow-up and deactivation requirements; volunteer-clearance `open_work` | none |
| D5 past season | `lock_case` and `vitally_assistance_action` refuse with `INVALID_TRANSITION` / `PAST_SEASON` | staff-case-work read-only requirement | none |
| D8 wake | deactivated window switches on its next wake | sign-in-accounts and season-rollover deltas | fixed during apply (R9); risk line added at verify |
| D9 Exit Form | `taxYear: season − 1` | review-and-corrections header requirement | none |

**Drift warnings** (non-blocking):
- Fixed during apply: D8 and two deltas said other windows switch to no-access at once. Ruling R9 changed them to "on next wake", and the user approved it at verify. At the user's request, design.md's Risks now say that data access ends at once (RLS and the RPCs refuse). Only the screen switch waits, so an untouched window keeps showing what it had already loaded.
- Fixed in the final review: D10 now records the workspace row lock as `for no key update`, which avoids a deadlock with the action-receipt foreign key.

---

## 5. Implementation Signal

- [x] The worktree has no unstaged files after this report's commit.
- [ ] Every relevant commit is pushed. The code is pushed at ee8fb5b. The verify-time artifacts (the design.md risk line, this report, the retrospective) and the archive are pushed with the PR at lifecycle step 9.

**Commit range**: `7e06662..` the branch head. Migration: `supabase/migrations/055_start_next_season.sql`. It replaces functions, adds `season_starts` and drops `vitally_private.capabilities_before_052`, but rewrites no existing rows, so CI's empty-database run covers it.

**Checks run and why**:
- **`npm test`** (always): 2253/2253 locally (baseline 2220 on main), and CI `checks`.
- **`build:hant -- --check`**: CI `checks`. No client text changed.
- **`openspec validate --all`**: locally (section 1) and in CI `checks`.
- **Database** (055, new RPC, changed functions): no local stack, at the user's instruction. While iterating, quick runs went through `database-quick.yml`, for example 44894710921 (37/37). Final check: CI `database` passed **860/860** (main 7e06662, run 44878374227: 838).
- **Sign-in** (deactivation and wake paths in the controller): CI `sign-in` passed.
- **Browser** (views, controller, `app.mjs`, the story's Exit Form assertion, the new Chrome test): CI story legs, below.

**CI evidence**: run [44894866791](https://github.com/jin-yu-yang/vitally/actions/runs/44894866791) on `ee8fb5b`.
- **Jobs:** `checks`, `database`, `sign-in`, `story (chrome-client)` and `story (firefox-client)` all succeeded on the first attempt. One earlier run on this branch, 44889925760, had a failure in the uploads test ("Mark reviewed dropped the typed phone"). It is off this branch's path and filed as #254.
- **Story legs:**
  - chrome-client story: 590 s, and firefox-client story: 595 s. The limit is 900 s.
  - browser tests per leg went from 51 to 52. The one added test is "A site coordinator starts the next season", 9.7 s and 11.4 s. None was removed.
- **Screenshots** (from the run's artifacts, chrome-client), for the new test:
  - `start-next-season-1-dialog`: "Start the 2026 season", with the three statements, the export reminder and "Type 2026 to confirm".
  - `-2-refused`: "Finish these first:" lists "1 open case", with no link.
  - `-3-setup`: the starter is on "Finish your setup for this season".
  - `-5-case-pool`: a second site coordinator's pool shows "No cases yet this season."

  The data is fictional. The Season settings shots (720 and 390 px) show the Next season card. The footer's hard-coded "Tax year 2025" is one of the 2025s the user's Before-the-pilot issue covers; it is not this change's.

**Hosted step** (on the day it merges): `node --env-file=.env.admin tools/admin/migrate.mjs --target classroom` (with `NODE_EXTRA_CA_CERTS`) applies 055. Press Start next season on hosted only when the office decides.

---

## 6. Front-Door Routing Leak Detector (warning, non-blocking)

```bash
ls docs/superpowers/specs/*.md 2>/dev/null
```

- [x] The 8 files there are historical design documents, last changed 2026-10-05, before the schema. This change added none.

| File | Captured in the change? | Action |
|---|---|---|
| — | — | none |

---

## 7. Deferred Manual Dogfood vs Automated Test Equivalence

`plan.md` has no `[~]` rows, so this section is empty.

---

## Overall Decision

- [ ] ✅ PASS
- [x] ⚠️ PASS WITH WARNINGS:
  - the D8 wording drift was fixed during apply (R9, approved by the user);
  - there was no local database run, at the user's instruction, and CI's `database` run (860/860) stands in for it;
  - one intermittent uploads-test failure off this branch's path is filed as #254.
- [ ] ❌ FAIL

**Next step**: retrospective (lifecycle step 7), then merge main and archive.
