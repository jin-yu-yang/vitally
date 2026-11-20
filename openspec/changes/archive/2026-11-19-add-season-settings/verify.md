# Verification Report

> The `openspec-verify-change` skill is not installed in this repository, so the controller ran its PRECHECK and checks directly (CLAUDE.md, lifecycle step 6).

**Change**: `add-season-settings`
**Verified at**: `2026-11-19 22:10` (America/New_York)
**Verifier**: Claude Opus 5.5 (subagent-driven-development controller)

PRECHECK:
- commits on the branch since `origin/main` (e3b709e): 35;
- ticked tasks in `tasks.md`: 32.

Both are positive.

---

## 1. Structural Validation (`openspec validate --all --json`)

- [x] Every item is `"valid": true`.

**Result**:

```text
{"totals":{"items":19,"passed":19,"failed":0},"byType":{"change":{"items":1,"passed":1,"failed":0},"spec":{"items":18,"passed":18,"failed":0}}}
```

Strict mode gives only "Requirement text is very long (>500 characters)" warnings. The canonical specs already carry the same warning.

| Item | Type | Issues |
|---|---|---|
| — | — | none |

---

## 2. Task Completion (`tasks.md`)

- [x] Every `- [ ]` is now `- [x]` (32/32).

How 10.2's checks were met (ruling R10, CLAUDE.md "a passing CI run can stand in"):
- **Local:**
  - `npm test` (2130/2130 at 6f1b7f2);
  - `build:hant -- --check`;
  - `openspec validate --all`;
  - `db:migrate:test` + `test:database` (767/767, twice: on a fresh stack, and in the rehearsal on a stack that already had main's migrations and seed data).
- **CI** (run 44659034710 on cc2fada, all jobs success): `test:auth-browser` (sign-in job) and both story legs.

| Task | Why not done | Blocks archive? |
|---|---|---|
| — | — | — |

---

## 3. Delta Spec Sync State

Archive merges the deltas (lifecycle step 8). Nothing is synced before then, by design (CLAUDE.md: `/opsx:sync` is not used).

| Capability | Sync state | Note |
|---|---|---|
| season-settings | ✗ needs sync | new capability; archive creates `openspec/specs/season-settings/` |
| site-coordinators | ✗ needs sync | new capability |
| volunteer-clearance | ✗ needs sync | ADDED, MODIFIED and RENAMED ("…within the roster ceiling" → "The caller's capabilities come from their roles") |
| volunteer-roster | ✗ needs sync | ADDED, MODIFIED and REMOVED ("A volunteer with no sign-in is visible only to admins", re-added with "…, whatever their roles") |
| sign-in | ✗ needs sync | ADDED, MODIFIED and REMOVED ("A staff member with follow-up access also has admin" → "Follow-up access always comes with admin") |
| sign-in-accounts | ✗ needs sync | MODIFIED |
| office-follow-up | ✗ needs sync | MODIFIED |
| posted-updates | ✗ needs sync | MODIFIED |
| volunteer-workload | ✗ needs sync | MODIFIED |
| local-seed-data | ✗ needs sync | MODIFIED |

---

## 4. Design / Specs Coherence Spot Check

| Sample | design | specs | Gap |
|---|---|---|---|
| D1 mirror, sign-in only | `people.capabilities` = role capabilities with a sign-in, `{}` without | volunteer-clearance ADDED "A person's capabilities mirror this season's roles while they have a sign-in"; volunteer-roster ADDED visibility requirement | none |
| D2 workspace admin | site coordinator or Admin role, no clearance | volunteer-roster MODIFIED "The admin check answers only for the caller"; posted-updates MODIFIED | none |
| D4 at least one site coordinator | last site coordinator / default follow-up refusals; deactivation clears the flag | site-coordinators "Only a site coordinator grants or removes…", "Deactivating a site coordinator"; sign-in-accounts MODIFIED deactivate | none |
| D5 storage | one row per workspace; SIDN in `vitally_private.site_numbers` (user ruling at plan review) | season-settings "The page shows the current season and its upload links" (stored once per workspace), "The SIDN is set … never read back" | none |
| D7 default follow-up | site coordinator or `followup`, in seven places | sign-in MODIFIED "The roster can choose the default follow-up person"; office-follow-up MODIFIED; volunteer-roster open-work row | none |
| R8 (during apply) | candidates carry `accountRevision` | site-coordinators "Adding from the picker" needs Add to work; `plan.md` corrected | none (plan text fixed) |

**Drift warnings** (non-blocking):
- During apply, the sign-in ADDED requirement "Follow-up access always comes with admin" was restated (ruling R4): under the mirror, a follow-up-only write is replaced, not refused. The spec and the code now agree.
- The volunteer-roster wording was changed from "FORBIDDEN (detail ADMIN_ROLE)" to "FORBIDDEN (ADMIN_ROLE)" to match the raised shape (`message='ADMIN_ROLE'`).

---

## 5. Implementation Signal

- [x] The worktree has no unstaged files (`git status --short` is empty).
- [ ] Every relevant commit is pushed. 6 commits after cc2fada are local: docs (2b8e4c5, 2dfedac), final-review fixes (4dbe1ba, 6f1b7f2) and task ticks. They are pushed with the archive at lifecycle step 9.

**Commit range**: `e3b709e..4bd4a42`. Migration: `supabase/migrations/052_season_settings.sql`.

**CI evidence**: run [44659034710](https://github.com/jin-yu-yang/vitally/actions/runs/44659034710) on `cc2fada`.
- **Jobs:** `checks`, `database`, `sign-in`, `story (chrome-client)` and `story (firefox-client)` all succeeded, first attempt.
- **Story legs vs main run 44606983534:**
  - chrome-client: 638 s → 596 s;
  - firefox-client: 569 s → 564 s;
  - browser tests per leg: 49 → 50 (one new test, "A site coordinator changes Season settings"; none removed).
- **Screenshots:** the Season settings shots (720 and 390 px, both legs) were reviewed from the run's artifacts:
  - the copy matches the spec;
  - no SIDN number is shown;
  - there is no horizontal scroll;
  - the data is fictional;
  - at 390 px the picker's text is clipped (cosmetic).
- **Commits after cc2fada:**
  - Front end: `4dbe1ba` (Add disabled until a person is picked; comments) and `6f1b7f2` (Add follows a restored pick). Both pass unit tests locally (2130/2130). Neither is reached by the story.
  - The rest are docs and tasks.
  - The pull request's CI run on the final head must pass before merge, and it is linked in the PR body.

**Rehearsal** (CLAUDE.md: 052 changes existing rows). This was done on the throwaway stack, not the user's persistent one (ruling R12):
1. Reset.
2. Apply main e3b709e's migrations.
3. Run main's roster command with a fictional roster from `roster.example.json`.
4. Run main's `seed:local` (11 cases, 8 volunteers).
5. Count the guard's offenders, read-only: 0.
6. Apply `npm run db:migrate:test` with 052: applied cleanly.
7. Run `test:database`: 767/767.

The user's own stack may still hold rows the guard would refuse. The PR body says so.

---

## 6. Front-Door Routing Leak Detector (warning, non-blocking)

```bash
ls docs/superpowers/specs/*.md 2>/dev/null   # 8 files
```

- [x] Every file there predates the schema install (historical design documents, parts 1–4d). This branch adds no file under `docs/superpowers/` (checked with `git log --diff-filter=A` over the branch).

| File | Content captured in the change? | Suggested action |
|---|---|---|
| — | — | none |

---

## 7. Deferred Manual Dogfood vs Automated Test Equivalence

`plan.md` has no `[~]` rows, so this section is not needed. Two checks the plan asked for were done differently, and both are covered:

| Plan check | Equivalent | Coverage | Real gap? |
|---|---|---|---|
| Task 11 Step 1/3: local `npm run test:browser`, story timings before and after | CI run 44659034710, both story legs, compared with main run 44606983534; local targeted run of the Roster and Season settings tests (3/3) | the whole story in both engine orders, the new test, screenshots | ❌ covered |
| Task 12 Step 3: rehearsal on the user's persistent stack | rehearsal on the throwaway stack brought to main's state with seeded data (above) | guard, migration on existing rows, full database suite | ⚠️ partial: the user's own stack's rows are not exercised; recorded for the retrospective and the PR body |

---

## Overall Decision

- [ ] ✅ PASS
- [x] ⚠️ PASS WITH WARNINGS. Before merge:
  1. The PR's CI run on the final head (which includes `4dbe1ba` and `6f1b7f2` after cc2fada) must pass.
  2. The user's persistent local stack was not rehearsed. 052's guard may refuse there if it holds an admin set through the roster command without the Admin role; the fix is deploy step 1.
- [ ] ❌ FAIL

**Next**: lifecycle step 7, the retrospective (including the ledger summary). Then merge `main` and archive (step 8), and push and open the PR (step 9).
