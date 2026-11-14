# Verification Report

**Change**: `add-volunteer-workload`
**Verified at**: `2026-11-13`
**Verifier**: Claude Code (Opus 5.5), controller of the subagent-driven apply, in worktree `D:/dev/vitally-workload`

PRECHECK: 20 commits on the branch since `06ebee6` (the merge-base with `origin/main`), and 17 of 17
tasks are checked in `tasks.md`.

---

## 1. Structural Validation (`openspec validate --all --json`)

- [x] Every item is `"valid": true`

**Result**:

```text
openspec validate --all --json → 15 items, 0 invalid
(one non-blocking INFO: a long requirement text in an existing spec)
```

| Item | Type | Issues |
|---|---|---|
| — | — | — |

---

## 2. Task Completion (`tasks.md`)

- [x] Every `- [ ]` is now `- [x]` (17/17)

**Incomplete tasks**: none.

| Task | Why incomplete | Blocks archive |
|---|---|---|
| — | — | — |

---

## 3. Delta Spec Sync State

| Capability | Sync state | Notes |
|---|---|---|
| `volunteer-workload` | ✗ needs sync | New capability: `openspec/specs/volunteer-workload/` does not exist yet. Archive creates it. |
| `volunteer-clearance` | ✗ needs sync | 3 MODIFIED requirements: "The caller's capabilities come from their roles…", "A signed-in staff member's buttons follow…", "Staff assign work only to a cleared person". The canonical spec does not mention `act_assign_case` yet. Archive merges them (CLAUDE.md step 8). |

---

## 4. Design / Specs Coherence Spot Check

| Sample | Design | Spec | Gap |
|---|---|---|---|
| D1 visibility | Workload only for a cleared staff member with effective `admin` | "Only a cleared admin sees the Workload" | none |
| D3 Stalled | Later of `updated_at` and the newest `contact_log.logged_at`; edits don't count | "The Workload counts…": logged, an edit does not count | none (design corrected from `created_at` to `logged_at` in e6f66f0, Ruling 3) |
| D5 refusal order and allowed stages | stage → person → cleared → effective capability → independence | "An admin assigns or reassigns…" | none |
| D6 handover | Same active review moves; the unsent questionnaire doesn't carry over | "A reassignment hands over the work in progress" | none |
| D7 effective capabilities | Picker and database use the same rule; the clearance requirement is MODIFIED | volunteer-clearance delta (3 requirements) | none |
| D8 ordering | Preferred, then another language, then the rest; fewest Open; name; "Other" matches on equal text | "The drawer puts same-language volunteers first…" | none |

**Drift warnings** (non-blocking): none. The final review's fix 1 makes design D3's claim that
"Realtime keeps it live" true for logged contacts too: a `contact_log` change now re-reads the case list.

---

## 5. Implementation Signal

- [x] No unstaged files in the worktree (`git status --short` is empty; the `.superpowers/` scratch folder is ignored)
- [x] The code is pushed to `origin/add-volunteer-workload`

**Commit range**: `06ebee6..de1a4a0` holds the code and docs. Later commits are artifacts only (tasks and this file).

### Checks run, and why

| Check | Where | Result |
|---|---|---|
| `npm test` | local | 1694/1695. The one failure is `tests/write-test-env.test.mjs` ("mode 600…", `TEST_ENV_INVALID`). It also fails on `main` because of the user's local `.env`; the user said to leave it. |
| `npm run build:hant -- --check` | local + CI `checks` | pass (no Chinese text changed) |
| `npx openspec validate --all` | local + CI `checks` | 15/15 |
| `npm run test:database` on a fresh stack with 001–046 | CI `database` | **572/572**: both `ASSIGN_CASE` suites (refusals; effects, including replay and preparer reassign at `reviewing`/`review_ready`) and "today's assigning functions" with `act_assign_case` |
| `npm run test:auth-browser` | CI `sign-in` | pass (sign-in is unchanged; run as regression) |
| `npm run test:browser`, both browser orders | CI `story (chrome-client)`, `story (firefox-client)` | pass. The story is unchanged (decision Q9.3), so it is a regression run. |

**CI run (passing, on the verified commit `de1a4a0`)**:
https://github.com/jin-yu-yang/vitally/actions/runs/43547716921
- Every job passed on the first attempt: `checks`, `database`, `sign-in`, `story (chrome-client)`, `story (firefox-client)`.
- Earlier runs on this branch: 43541714846 (on `ab5bf45`, database 569/569) and 43545472618 (on `b3bd27e`, all green).
- Local database, sign-in and story runs were not used. The local Supabase stack is shared with two other sessions, so the user asked for CI only. 046 has never been applied to a persistent stack.

**Story screenshots reviewed** (artifacts `story-screenshots-chrome-client` and `story-screenshots-firefox-client`, 102 images):
- The case pool (`office-case-pool`) still shows no taxpayer names and keeps its "workflow only" footnote.
- A volunteer's work board (`staff-signed-in-as`) has no Volunteers link.
- The office case page's Contacts tab (`staff-case-contacts`) renders as before.

No regressions were seen. The story has no Workload screenshots because it was not extended.

---

## 6. Front-Door Routing Leak Detector (warning, non-blocking)

```bash
ls docs/superpowers/specs/*.md   # 8 files, last changed 2026-10-05
```

- [x] The files that exist are historical documents from before the schema was installed. This change added nothing under `docs/superpowers/` (`git diff --stat 06ebee6..HEAD -- docs/superpowers` is empty).

| File | Captured in the change | Action |
|---|---|---|
| — | — | — |

---

## 7. Deferred Manual Dogfood vs Automated Test Equivalence

`plan.md` has no `[~]` rows, so this section is empty.

The plan replaced every local database, sign-in and story run with CI. Those ran on `de1a4a0` (section 5),
so nothing was deferred.

---

## 8. Re-verification after the PR #195 review (2026-11-14)

The review found that an Assign drawer opened on an empty slot became a Reassign if a volunteer claimed the
case before Choose: `assignCase` read `expectedRevision` from the live case list at press time. An earlier
summary to the user said Assign sent the revision the Workload showed; that was not true until this fix.
Commit `f965184` fixes it both ways (the drawer captures the revision and holder when it opens; `ASSIGN_CASE`
carries `expectedHolderId`, refused with `CONFLICT` on a mismatch). It also gives a tagged row to anyone holding an
open case without the slot's role, and rewords the proposal's "Why". Spec `volunteer-workload` updated (canonical
and archived delta).

| Check | Where | Result |
|---|---|---|
| `npm test` | local | 1699/1700 (+5). The one failure is still `tests/write-test-env.test.mjs` (the local `.env`). |
| `npm run build:hant -- --check` | local + CI `checks` | pass |
| `npx openspec validate --all` | local + CI `checks` | 15/15 |
| `npm run test:database` on a fresh stack with 001–046 | CI `database` | **573/573**, including "claimed while the drawer is open → CONFLICT" |
| `npm run test:auth-browser` | CI `sign-in` | pass (regression) |
| `npm run test:browser`, both orders | CI `story (chrome-client)`, `story (firefox-client)` | pass (regression; the story is unchanged) |

**CI run (passing, on `f965184`)**: https://github.com/jin-yu-yang/vitally/actions/runs/43556886323
(the PR's own run, every job passed on the first attempt). Screenshots reviewed: the case pool still shows no
taxpayer names, and a volunteer's work board has no Volunteers link.

---

## Overall Decision

- [x] ⚠️ PASS WITH WARNINGS. The warnings are non-blocking:
  - One local unit test fails because of the user's environment (`write-test-env`), also on `main`.
  - The delta specs need sync, which archive does.
- [ ] ❌ FAIL

**Next step**: write `retrospective.md`, then merge `main` (currently no new commits; 046 is still free),
run `/opsx:archive`, push, and open the PR, whose own CI run must also pass.
