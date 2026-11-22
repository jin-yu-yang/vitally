# Retrospective: add-returning-volunteers-and-roster-csv

> Written: 2026-11-22 (after verify passed with warnings)
> Commit range: `fb04dbc..93d965c` (archive commit follows)
> Worktree: `D:/dev/vitally-returning-volunteers`

---

## 0. Evidence

- **Commit range:** `fb04dbc..93d965c`, 34 non-merge commits on the branch plus one merge of `main` (`edf3223`). That is 24 implementation and fix commits, 9 checkbox commits and the verify commit.
- **Diff size** (branch vs `main`): +2355 / −41 lines across 31 files. Outside `openspec/` it is +1420 / −41 across 22 files: 11 source, tooling and docs files, and 11 test files.
- **Tasks done:** 18 / 18.
- **Active hours:** about 1¾ h of apply, from the first implementation commit at 05:04 to the verify commit at 06:38. The full CI run took about 18 minutes of that.
- **Subagent dispatches:** 25.
  - 8 implementers and 8 task reviewers.
  - 3 fix rounds (Tasks 2, 4, 5), each resuming its implementer, and 3 scoped re-reviews.
  - The final review, its fix wave, and the fix wave's re-review.
- **New external dependencies:** none.
- **Bugs encountered post-merge:** none so far (not merged yet).
- **OpenSpec validate state at archive:** pass (24 items, 0 invalid, before archive).
- **Test coverage signal:**
  - Unit: `npm test` went from 2325 to 2352 (+27).
  - Database suite on CI: 911 / 911, with the new subtests "Edit adds a past-season volunteer to the current season" and "the previous season's roster is added, and replaced on a re-run".
  - Browser story: 54 / 54 per leg, including the new block "An admin re-adds a returning volunteer and exports the Roster".
  - Full CI run: https://github.com/jin-yu-yang/vitally/actions/runs/45016989378, green on its first run.

Commit chain (in time order, implementation commits only):

```
5ce4e0e Roster CSV: shared CSV encoder with BOM, quoting and formula guard
cdc2f7e Roster CSV: rows, certificate dates and New York filename
fb96ac2 Roster CSV: one account label table, empty Languages cell when none
98cbcbe Returning volunteers: earlier-volunteer read, pick and save through Edit
6bcd5f6 Returning volunteers: search and pick in Add; Roster: Export CSV
a932ae0 Returning volunteers: a pick whose person is gone says it could not be opened
b7d419d Database test: Edit adds a past-season volunteer to the current season
cce6199 Database test: make the past-season setup respect the role certificate check
fa2770a Database test: past entry added by another person, and a past volunteer with a sign-in
ffa3587 Local seed: a previous season's roster to pick returning volunteers from
0e3af8c..c61777f Local seed test fixes (4 commits)
9379623 Browser test: returning volunteer picker and Roster CSV
31cc43b Docs: returning volunteers, Roster CSV, seed's previous season
f69ffcc Earlier-volunteer sentence only on Add; BOM as an escape; seedPastSeason guards a null season
edf3223 Merge main into add-returning-volunteers-and-roster-csv
93d965c verify (full CI green) and tick task 8.2
```

---

## 1. Wins

- **Reading the save RPC first removed a migration.** In explore, we walked the Edit path of `vitally_save_volunteer` (053, then 057) and found that it already creates the current-season entry. As a result, 058 stays free, and the whole change is browser code, tests and a seed step. The database test (`fa2770a`) now pins that behaviour as a contract.
- **The full CI run passed first time on the verified commit** (run 45016989378). That includes a 226-line browser block (`9379623`) that had never run anywhere before. The task review of `9379623` had checked every selector against the markup and the single-statement SQL against the 044/045 triggers, and its reading held.
- **Task reviews caught real defects before they landed:**
  - a duplicated label table (`cdc2f7e` → `fb96ac2`);
  - a stale pick that would have refused every Save with no way out (`6bcd5f6` → `a932ae0`);
  - a database test whose `added_by` assertion couldn't fail, and a sign-in case skipped on a false premise (`cce6199` → `fa2770a`).
- **The checks in the plan's Global Constraints held throughout.** No local Docker; every database check ran through `database-quick.yml` and then the full run. There were no orphaned test runners.
- **`src/csv.mjs` came out small and shared, as planned.** It is ready for the season export (#256).

## 2. Misses

- 🟡 **[painful | evidence: runs 45013759962, 45013886311, 45014027252, 45014069337, 45014213017]** The Task 6 implementer used 5 quick CI runs against a stated cap of 3. One was cancelled; the rest failed on its own test setup and idempotency mistakes before 45014357752 passed. Each run is a fresh Supabase stack on CI (minutes each), and the cap wasn't enforced.
- 🟡 **[painful | evidence: run 45012784697]** Task 5's first quick run failed on test setup. The test moved a roster entry to last season, which tripped `role_certificates_check`. Two implementers met the same trigger (Tasks 5 and 6). A one-line hint in the dispatch would have saved runs.
- 🟡 **[painful | evidence: ledger, Task 5 review]** The implementer reported "no helper links a sign-in", and that was false: the pattern was at `tests/database-volunteer-roster.mjs` ~1090. It took a review round and another CI run to fix.
- 📌 **[nit | evidence: a932ae0]** A picked person who drops out of the earlier list gets the "could not be opened" drawer, whose title still reads "Add a volunteer". This is deferred.
- 📌 **[nit | evidence: final review triage]** The deferred minors were left as they are, by the final reviewer's triage:
  - The BOM, the Edit-path sentence and the seed's null-season guard were fixed in `f69ffcc`.
  - Untested CSV edge cases: a cell that is both guarded and quoted, empty rows, and a numeric cell.
  - Three near-identical label-lookup helpers.
  - The earlier read sharing the Roster's failure state, through `Promise.all`.
  - No guard in `pickReturningVolunteer` against an Edit context.
  - Extra copy not in the spec: the "Search name or email" placeholder and "Nobody matches.".
  - No note explaining the read-only email for a picked person without a sign-in.
  - A weak label test regex.
  - The search text survives "Not this person".
  - `app.mjs` wiring is covered only by the browser block.
  - The ADMIN_ROLE refusal is untested on the past-volunteer path.
  - The seed subtests depend on their order, its assertions are thin, and the real re-run path has no test.
  - The browser block: an unbounded `download.path()`, a CSV check of only the Name and Roles columns, and a weak refused-save assertion.

## 3. Plan deviations

| Plan task | What changed | Why |
|-----------|--------------|-----|
| D5 / task 2.2 (during planning) | `listEarlierVolunteers()` became a separate read beside `listVolunteers()`, not part of it | `state.volunteers` holds the list's array directly, and the views, controller and tests rely on that shape. Agreed with Hailey before apply. |
| Task 2 | `languagesText` and `accountLabel` moved into `volunteer-roster.mjs`, re-exported from the views | Avoids an import cycle; the brief allowed this fallback. |
| Task 2 (ruling) | No languages gives an empty Languages cell, not "—" | The spec gives empty cells for no roles and no certificates; "—" is a display placeholder, not a language name. |
| Task 4 (ruling) | A stale pick shows the existing "could not be opened" drawer | The review found that a dropped pick looked like a plain Add while every Save was refused. |
| Task 4 | Hidden search box when there are no earlier volunteers; extra copy "Search name or email" and "Nobody matches." | With nobody to find, the box could only come up empty. The copy mirrors the Roster's own empty line. Recorded in `verify.md` §4. |
| Task 5 (ruling) | Kept the usual-days assertion as the spec scenario words it | The reviewer wanted different days sent. The spec says the save sends Tue and Thu, and `returningFill` (unit-tested) plus the browser block's stored-days check cover keeping them. |
| Task 6 | The past-season re-run delete lives in `seedPastSeason`, not in `seedVolunteers`' query | It keeps the deletion with the code that writes those rows, under the same no-sign-in rule. |
| Task 7 | The picker screenshot is taken before the pick | After the save, the earlier list is empty and the picker isn't drawn. |
| Task 8 (ruling) | The push and full CI run moved after the final review's fix wave; `docs/roadmap.md` left unchanged | CLAUDE.md requires the run on the verified commit. The repo marks roadmap rows Done in a post-merge docs PR (`88e1dcf`). |
| Final review | Fix wave `f69ffcc` (Edit-path sentence, `\uFEFF` escape, null-season guard) | 0 Critical and 0 Important findings; these three were cheap minors worth fixing before merge. |
| Plan Review Focus 4 | Its wording was wrong: no full-email match without a current season | `listEarlierVolunteers()` returns `[]` then, as D5 says. Corrected in `verify.md`, not in code. |

## 4. Skill / workflow compliance

| Skill                                            | Used |
|--------------------------------------------------|------|
| superpowers:brainstorming                        | ✓ (`brainstorm.md`, recording the design agreed on Nov 21–22) |
| superpowers:writing-plans                        | ✓ (`plan.md`) |
| superpowers:using-git-worktrees                  | ✓ (`D:/dev/vitally-returning-volunteers`, baseline 2325 / 2325) |
| superpowers:subagent-driven-development          | ✓ (8 tasks, ledger, preflight scan, task reviews, final review and fix wave) |
| (transitive) superpowers:test-driven-development | ✓ (RED/GREEN evidence in every implementer report; Task 7 was syntax-only by design, since the browser suite runs only on CI) |
| (transitive) superpowers:requesting-code-review  | ✓ (per-task reviews, plus the final whole-branch review on the most capable model) |
| superpowers:finishing-a-development-branch       | ✓ (CLAUDE.md step 9, after archive) |

### Deliberately Skipped Skills

(none)

## 5. Surprises

- `vitally_save_volunteer`'s Edit path already handled a person with no current-season entry. We assumed a migration might be needed until the 053 and 057 bodies were read line by line.
- `role_certificates_check` (045) is a deferred constraint trigger. That makes the browser block's single-statement setup valid, but it tripped two implementers who moved roster rows between seasons in separate statements.
- #262 merged on the morning this was planned, so local `main` was behind `origin/main` at explore time. The first save-RPC walk was on 053; it had to be redone against 057 before propose.

## Ledger summary (rulings, parked and deferred findings)

The apply ledger is not kept. This is its complete record of decisions.

**Rulings,** in order, each with what it costs if wrong:
1. **tasks.md checkbox mapping.** Plan tasks don't align 1:1 with tasks.md groups: T1→1.1, 1.2; T2→2.1, 4.1; T3→2.2–2.4, 3.3; T4→3.1, 3.2, 4.2; T5→5.1; T6→6.x; T7→7.1; T8→8.x. A mis-tick would be visible and cheap to fix.
2. **Database checks during apply ran on the pushed feature branch through `database-quick.yml`.** A visible push of an unfinished branch; harmless.
3. **No languages gives an empty Languages cell.** If wrong, a one-line revert.
4. **A stale returning pick renders "could not be opened".** If wrong, the admin has to close and reopen the drawer.
5. **The usual-days database assertion was kept as the spec words it.** If wrong, one extra assertion later.
6. **The full CI run moved after the final fix wave.** No cost.
7. **`docs/roadmap.md` #138 row left unchanged until a post-merge docs PR.** One line later.
8. **The picker is hidden when nobody can be offered.** One render branch if wrong.
9. **Plan Review Focus 4 corrected in `verify.md`, not in code.** No usable Add flow exists without a season.

**Parked findings:** none. No fix loop reached its cap; Tasks 2, 4 and 5 each closed in one round.

**Deferred minor findings:** listed in §2, last bullet, as triaged by the final review. Three were fixed in `f69ffcc`; the rest stay deferred.

**Process notes:** the Task 6 implementer exceeded its CI-run cap (5 vs 3), as covered in §2 and §6.

## 6. Promote candidates → long-term learning

- [ ] 🟡 **Name the triggers a database test will meet in the implementer's dispatch.** When a test moves rows between seasons or rewrites roster rows with SQL, say up front that `role_certificates_check` (045) is a deferred constraint trigger, and what order it needs. → **Promote to memory** (type: feedback)
  > **Why**: two implementers (Tasks 5 and 6) each spent CI runs discovering it (45012784697, 45013759962).
  > **How to apply**: any SDD dispatch whose task writes `roster_entries` or `certificates` directly in SQL.

- [ ] 🟡 **The controller tracks CI-run caps itself.** When a brief caps CI runs, check `gh run list` after the report and treat an overrun as a reportable concern, not just a ledger note. → **Promote to memory** (type: feedback), alongside the existing implementer-brief no-hang rules
  > **Why**: the Task 6 implementer used 5 quick runs against a cap of 3 and didn't say so.
  > **How to apply**: every dispatch that lets an implementer start `database-quick.yml`.

- [ ] 📌 **Fetch `origin/main` before walking an RPC in explore.** → **One-off** (the session started on a stale local `main` the morning a migration merged)
  > **Why**: the first analysis was on 053 while `origin/main` already had 057. It was caught before propose.

- [ ] 📌 **Deferred minors from this change are candidates for a follow-up issue,** especially the read-only email note for a picked person, keeping the search text after "Not this person", and an ADMIN_ROLE test on the past-volunteer path. → **One-off** (file as an issue if the team wants them)
  > **Why**: the final review triaged them as safe to defer; none affects correctness.
