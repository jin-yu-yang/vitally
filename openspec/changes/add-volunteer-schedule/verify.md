# Verification Report

**Change**: `add-volunteer-schedule`
**Verified at**: `2026-11-22 07:16` (America/New_York)
**Verifier**: Claude (controller session), after subagent-driven apply and a clean final whole-branch review

---

## 1. Structural Validation (`openspec validate --all --json`)

- [x] Every item is `"valid": true`

**Result**:

```text
23 items, 0 invalid (npx openspec validate --all --json, OpenSpec 1.17.0)
```

Non-strict validation passes. `--strict` turns OpenSpec 1.17's "Requirement text is very long (>500 characters)" warnings into failures. The canonical specs on `main` raise the same warning, and CI runs the non-strict form (ruling R4). This is non-blocking.

| Item | Type | Issues |
|---|---|---|
| — | — | — |

---

## 2. Task Completion (`tasks.md`)

- [x] Every `- [ ]` is now `- [x]` (30 of 30)

**Unfinished tasks**: none.

| Task | Why unfinished | Blocks archive? |
|---|---|---|
| — | — | — |

---

## 3. Delta Spec Sync State

Each delta was compared with `openspec/specs/<capability>/spec.md` at HEAD. Archive merges them in step 8.

| Capability | Sync state | Notes |
|---|---|---|
| `volunteer-schedule` | ✗ Needs sync | A new capability with 12 ADDED requirements. No canonical file yet. |
| `season-settings` | ✗ Needs sync | 2 ADDED requirements, absent from the canonical spec. |
| `volunteer-roster` | ✗ Needs sync | 1 ADDED requirement, absent. |
| `volunteer-workload` | ✗ Needs sync | 1 ADDED requirement, absent. 1 MODIFIED requirement ("The Workload can be sorted and searched"); its canonical text is unchanged since the change was proposed, so archive overwrites nothing new. |
| `volunteer-clearance` | ✗ Needs sync | 2 MODIFIED requirements ("A staff member can read their own clearance", "An uncleared staff member sees the setup screen"); their canonical text is unchanged since 7e06662, despite main merging #255 and #245. |
| `local-seed-data` | ✗ Needs sync | 1 ADDED requirement, absent. |

---

## 4. Design / Specs Coherence Spot Check

| Sample | Design says | Specs say | Gap |
|---|---|---|---|
| D3: no-sign-in visibility | Non-admins never receive a no-sign-in volunteer's shift, by any read or realtime message | "Non-admins see names, roles and hours only" | None. The `viewer_shifts` policy and the day read both filter it; tested in `tests/database-schedule.mjs`. |
| D6: coverage counting | Cleared only; Greeter or Intaker count on site only when Works includes on site; flagged and Admin shifts count toward nothing; the SQL decides `counts` | "Coverage counts cleared volunteers by role for each open hour" | None |
| D7: drag | Create across empty cells takes the role of the volunteer's earliest shift; resize by an edge; saves at once; every drag has a button alternative | "Admins edit by drag or by buttons" | None. The final review added that a drag is tied to the day it started on. |
| D9: Workload hours | Every role and flagged shifts count, removed shifts don't; NY Monday–Sunday | "The Workload shows the hours scheduled this week" | None. Hours also re-read on wake and focus (T10 fix). |
| D11: sidebar | Schedule after Volunteers (admins) or Work board (others); My profile after Schedule; on the setup screen too | "Rostered staff open the Schedule and My profile" | None |
| D2: soft delete | "Nothing deletes a shift row" | local-seed-data: "A re-run SHALL first remove exactly those shifts through the shift removal RPC, and SHALL leave every other shift alone." | **Drift (warning 1)** |

**Drift warnings** (non-blocking):

1. **A seed re-run hard-deletes the shifts of the fictional no-sign-in volunteers.** `seedWorkspace` runs `seedVolunteers` before `seedSchedule` (`tools/admin/seed-cases.mjs:709-713`). `seedVolunteers` deletes the no-sign-in seed volunteers and adds them again (existing behaviour). `shifts.person_id` cascades on delete (`057_volunteer_schedule.sql:80`), so those volunteers' shifts are hard-deleted before the RPC removal runs. This includes any shift an admin added for one of them. It contradicts design D2 and the spec's "leave every other shift alone". The deletion is also not announced through realtime. **Scope:** the local seed tool and fictional volunteers only, with no effect on the app. Suggested follow-up: run the schedule removal before `seedVolunteers`, and exclude people who hold an admin-added shift from deletion; or narrow the spec to say a re-run replaces the fictional volunteers together with their shifts. Owner: the user decides.
2. **Live Season settings for an uncleared admin.** Design D10 says Season settings re-reads on a `schedule_settings` change. An uncleared admin has no live channel there and re-reads on focus (ruling R11). The spec's live-update requirement does not name Season settings.
3. **Base revisions (ruling R13) are not in design.md.** Drafts of the site-hours card and of My profile's usual days keep the revision they started from, so a concurrent change gets CONFLICT. This meets the spec's CONFLICT scenarios; design D8 and D10 do not describe the mechanism.

---

## 5. Implementation Signal

- [x] No unstaged files in the worktree (`git status --short` is empty).
- [ ] Not all commits are pushed. The branch has no remote yet; it is pushed in step 9.

**Commit range**: `4ab301e..72751db` (34 commits; merge base with origin/main is 4ab301e). It includes two merges of main: `d56e8b3` (055 Start next season) and `74350e8` (056 OneDrive). The schedule migration is `supabase/migrations/057_volunteer_schedule.sql`.

**Checks run** (project rules: Verification):

| Check | Why it applies | Result |
|---|---|---|
| `npm test` | Always | 2390 / 2390 pass (07:16, at 72751db) |
| `npm run db:migrate:test` then `npm run test:database` | Migration 057, RPCs, RLS, realtime | Migrations applied 056 then 057. 880 / 881 pass. The single failure is `tests/database-accounts-function.mjs`: "VITALLY_TEST_MAIL_URL is required". The worktree's `.env.test` was copied from the main checkout and predates that variable, so this is env-only and unrelated (accounts Edge Function). Run during integration at ffd1cc8; no SQL changed after. |
| `npm run test:browser` | Schedule, My profile, Season settings card, Roster drawer, Workload column, CSS | 55 / 57 pass (1232 s, at 72751db). "A site coordinator schedules a volunteer, and the volunteer sees it" passes (39.4 s) and "A site coordinator changes Season settings" passes (22.0 s). **2 failures, warning 4.** |
| `npm run build:hant -- --check` | Shared text files touched by the merge | Clean, exit 0 |
| `npx openspec validate --all` | Change artifacts | 23 / 23 |
| `npm run test:auth-browser` | Not run: sign-in is untouched | — |

4. **Browser story failures (warning).** "Chrome client and Firefox staff run the whole demonstration story", and its subtest "the seed builds its eleven cases in the story's workspace", time out in `waitForQuiet` on the Work board with about 43 `/rest/v1/reviews` requests in flight.
   - During Task 12 this reproduced on a detached worktree of untouched main against the same local stack, before 057 existed on the branch. So it looks pre-existing or environmental, not caused by this change.
   - It is not confirmed on a fresh stack. **Before the PR merges, a CI run on the branch must pass both story legs.** CI starts a fresh stack per job. The run must be linked in the PR body, and its story screenshots reviewed.

---

## 6. Front-Door Routing Leak Detector (warning, non-blocking)

```bash
ls docs/superpowers/specs/*.md   # 8 files
```

- [x] The files there predate the schema install and are legitimate. They were last touched in #47 (Part 4d), and CLAUDE.md names them as historical documents not to be moved. This change wrote nothing there.

| File | Content captured in the change? | Suggested action |
|---|---|---|
| — | — | — |

---

## 7. Deferred Manual Dogfood vs Automated Test Equivalence

plan.md has no `[~]` deferred rows, so this section is empty. That counts as PASS.

**Items from reviews accepted as documented behaviour** (not deferred tasks), recorded for the retrospective:

- Dragging the start edge of a shift already tagged "Outside site hours" does nothing and shows no message, because the local gesture result is out of range. The "refused drag" scenario is covered by a controller test with a forced refusal (final review Minor 2; ruling R15).
- A site that closes at midnight reads "… – 12 am" (`hourLabel(24)`), as the plan's Review Focus 4 requires.
- **Copy the spec did not fix, chosen during implementation; the user should review it:** "Choose a volunteer.", "Shifts" (the grid's region label), "The shift must end after it starts.", "No shifts on this day.", "Keep shift" (remove confirmation), "Coverage" (row label), "VOLUNTEERS · SCHEDULE" (drawer overline), "On site needed (greeters or intakers)", "Every week · New York time", plus the loading and failed lines on the Schedule and My profile.

---

## Overall Decision

- [ ] ✅ PASS
- [x] ⚠️ PASS WITH WARNINGS. Four warnings:
  1. A seed re-run hard-deletes the shifts of the fictional no-sign-in volunteers (seed tool only; it contradicts D2 and a seed-spec clause).
  2. Uncleared admins get Season settings on focus, not live.
  3. Base revisions are not described in design.md.
  4. The browser story's Chrome-client/Firefox-staff leg fails locally, as it does on main. It needs a passing CI run before merge.
- [ ] ❌ FAIL

**Next step**: write the retrospective (lifecycle step 7), recording warnings 1 and 4 as follow-ups. Then merge main and archive (step 8), and push and open the PR (step 9), with the CI run linked.
