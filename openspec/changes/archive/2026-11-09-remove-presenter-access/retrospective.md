# Retrospective: remove-presenter-access

> Written: 2026-11-09 (after verify passed with warnings)
> Commit range: `3a668b1..HEAD` on the branch, with `bdcc323` (main) merged in
> Worktree: `.claude/worktrees/remove-presenter-access`

---

## 0. Evidence

- **Commit range**: 19 non-merge commits beyond `main` (`bdcc323`), plus merges of #176, #178/#179/#181 and #180.
- **Diff size**: 65 files, +3973 / −1409 against `main`. Of that, `src`, `tools`, `tests` and `supabase` are 47 files, +2193 / −1241.
- **Tasks done**: 35 of 36 once this file exists (9.2 is met here). 9.1 follows archive.
- **Active hours**: not measured. The work spanned 2026-11-07 to 2026-11-09, with long waits on #172 and on CI.
- **Subagent dispatches**: about 25: 10 implementers (including the integration and the final fix wave), 13 reviews and re-reviews, a builder check and one investigator.
- **New external dependencies**: none.
- **Bugs encountered post-merge**: not applicable yet.
- **OpenSpec validate state at archive**: passes, 13 of 13.
- **Test coverage signal** (from each runner's `ℹ tests`, CI):
  - unit 1509 on `main` → 1515;
  - database 448 → 450;
  - sign-in 20 → 20;
  - story, per engine order, 42 → 42.

Commit chain:

```
3a668b1 Plan the OpenSpec change remove-presenter-access (#136)
0e1cb82 Renumber this change's migration to 043
edbe30d Database: migration 043 and its catalog tests, not yet applied
23cb321 Roster: staff and a default follow-up person; presenters ignored
86d8dac Database: 043 runs the deferred people-membership check before altering memberships
08cae10 Browser: requests carry no person; no presenter state
28d2d53 Test: a late change on a released channel reads nothing for a no-access window
4fff97e Browser: the presenter screen and inert() go
915fe86 Docs: presenter access removed
8700bed Test: wording no longer says presenter
24f72fd Merge main (#176, #178, #179, #181)
f33a7af Database: 043 copies add_staff_member from 042
36a8106 Database tests: staff and clients only
9cf0ee4 Database tests: a client cannot record a document response
8aa7e32 Browser story: the no-access account replaces the presenter
064035c No-access screen stays up after Dismiss and the logo
8475848 Final-review tidying: wording and indentation
f04495e Merge main (#180)
```

---

## 1. Wins

- **A static review caught a migration that couldn't run.** The review of `edbe30d` found that `ALTER TABLE memberships` would fail with 55006 "pending trigger events", because the deferred `people_membership_fkey` had queued checks from the membership delete. It would have aborted on every stack with a presenter. Fixed in `86d8dac` before 043 ran anywhere.
- **The counted procedure held exactly.** After the apply, the local stack's differences matched the expected table line by line, and equalled a clean rehearsal on a restored copy (`verify.md`). The refusal was proven on a throwaway copy, as the user required, because a database test can't reach it.
- **Reviews caught what tests couldn't.**
  - A dropped late-change check that covered the `handleChange` guard (`28d2d53`, with mutation proof).
  - A no-access window that lost its Sign out after Dismiss or the logo, which a narrowed story check had hidden (`064035c`).
- **The final review found no Critical or Important issue.** Function bodies were diffed against their previous definitions by script, and every removed test title was mapped to a replacement or to removed code.
- **The paired CI sample gave a fair comparison.** `main` and the branch ran under the same conditions, and matched 4 of 4 at the same timings.

## 2. Misses

- 🟡 [painful | evidence: `verify.md`, "The browser story's failures"] **The story failed intermittently on this branch and the cause is unproven.** Local failures at "the Reviewer reviews…" (twice), "the Site Coordinator logs a contact…" and "the Preparer verifies…", and one CI failure at "two staff accounts work one case…". Most were a press on a Firefox staff page with no visible effect within 10 s. One was a client window's missed live update. The story's record of console and page errors is filled only at the end of an order, so the failed runs kept none.
- 🟡 [painful | evidence: 4 diagnostic runs before the user's steps] **Reruns were spent before the cheap checks.** The investigator started instrumented runs before the console record and the path diff had been read. The user had to direct that order. Reading first would have saved runs.
- 🟡 [painful | evidence: `tasks.md` 6.6, 9.1, Rulings 11 and 12] **Two "grep prints nothing" tasks couldn't pass as written**, because deliberate hits exist (tests asserting absence, the roster's note, binding spec text). One could have led to trimming spec text.
- 🟡 [painful | evidence: conflicts in `24f72fd`] **Six conflicted files on the merge of #178.** Docs changed on both sides and one migration number collided. The number collision was found and settled early, in the issue comments.
- 📌 [nit | evidence: Task 7 report] An interim migration count ("001 to 041 and 043") went into docs and was then corrected.
- 📌 [nit | evidence: PowerShell start] PowerShell split the comma-separated `--exclude` list, so `studio` and `pg_meta` started and had to be stopped.
- 📌 [nit | evidence: run 5] Stopping a loop's parent also ended its running test, so that run was lost.
- 📌 [nit | evidence: Task 2 fix round] The added `RECORD_DOCUMENT_RESPONSE` assertion can't tell apart that condition's `p_person_id is null` half from `check_authority`.

## 3. Plan deviations

| Plan task | What changed | Why |
|---|---|---|
| Migration number | 041 → 042 → 043 | #176 took 041 and #172 took 042 (user's rulings). |
| Error code | `VT041` → `VT008` | The user asked for a code not tied to a migration number. |
| Order of tasks | T3, T4, T5, T7 ran before T1's stack steps, T2 and T6 | The stack was held until #172 merged (Ruling 6). |
| T1 Step 8 | Added a clean rehearsal on a second restored copy | So the expected differences were checked before the real apply. |
| T1 | Step 9 was refused once: stale `VITALLY_TARGET_MANIFEST` after a folder rename | The user fixed the path in two `.env.test` files. |
| T5 / T6 | The no-access screen is sticky: `showsNoAccess` and a `navigate` guard | Review found the screen could be left without Sign out. Not in the plan; required by the spec. |
| 6.6, 9.1 | Reworded to state the allowed hits | Rulings 11 and 12. |
| 8.4 | Local story run replaced by CI per the user's ruling | Local runs were intermittent; #180 put the story in CI. |
| 3.3 | Refusal test used a backup restored into a sibling database | That copy was at 040 with the `auth` schema; the plan's "throwaway database" was otherwise unspecified. |

## 4. Skill / workflow compliance

| Skill | Used |
|---|---|
| superpowers:brainstorming | ✓ (verbal, then invoked at propose) |
| superpowers:writing-plans | ✓ |
| superpowers:using-git-worktrees | ✓ |
| superpowers:subagent-driven-development | ✓ |
| (transitive) superpowers:test-driven-development | ✓ |
| (transitive) superpowers:requesting-code-review | ✓ |
| superpowers:finishing-a-development-branch | ✓ (after archive) |

### Deliberately Skipped Skills

None. `openspec-verify-change` isn't installed, so its checks were run directly, as CLAUDE.md says.

## 5. Surprises

- `people_membership_fkey` being deferred made `ALTER TABLE` on the referenced table fail after a delete.
- `supabase stop` along with `npm start` removed the containers but kept the volume; the stack came back intact.
- A folder rename broke the target guard's manifest path silently until the first apply.
- CI's `concurrency` is per ref, so runs dispatched concurrently on one branch would cancel each other.
- `gh run view --job <id> --log` returns the latest attempt's log after a re-run, even for an earlier attempt's job id.

## 6. Promote candidates → long-term learning

- [ ] 🟡 **Read recorded evidence and diff the failing path before spending reruns on an intermittent failure.** → **Promote to memory** (type: feedback)
  > **Why**: Four diagnostic runs were spent on the browser story before its console record and the path diff had been read; the user had to set that order.
  > **How to apply**: Whenever a test fails intermittently, before any rerun or instrumented run.

- [ ] 🟡 **The story should keep console and page errors from an aborted order.** → **One-off** (proposed on #126 as a small tests-only PR)
  > **Why**: The failed runs left no console record, so a thrown error couldn't be ruled in or out.
  > **How to apply**: Next change that touches the story's failure handling.

- [ ] 🟡 **A task's "grep prints nothing" must state the allowed hits.** → **Promote to memory** (type: feedback)
  > **Why**: Tasks 6.6 and 9.1 couldn't pass as written, and one risked trimming binding spec text.
  > **How to apply**: When writing tasks that end in a grep.

- [ ] 📌 **A pre-apply refusal can't be database-tested once the migration's check forbids its state.** → **One-off**
  > **Why**: Verified on a restored throwaway copy instead, with evidence in the PR.

---

## Ledger summary

The subagent ledger (`progress.md`) isn't kept. Everything it recorded:

### Rulings

1. The controller ran all four baselines itself. They were already running.
2. Catalog tests needing the fixture could wait for Task 2. None needed it in the end.
3. The restore used `pg_restore --no-owner` into a sibling database. Role, extension and ownership errors were tolerated only if counts matched exactly. There were 31 such errors, none on a counted table.
4. Task 1's Step 5 was a hard gate before the first before-count (user instruction).
5. The two baseline database failures were main's #176 test and its parent suite, because the stack lacked 041. They passed once 041 was applied.
6. Tasks that don't touch the stack ran while the gate was closed.
7. Task 1's static diff was reviewed before the irreversible apply.
8. Test-wording leftovers went into Task 7's batch.
9. A dropped assertion on surviving code was promoted to a fix (`RECORD_DOCUMENT_RESPONSE`).
10. The leftover-persona check uses a real person's id, not a random UUID.
11. Task 6.6 states its allowed hits.
12. Task 9.1 states its allowed hits.

### Parked

- **`RECORD_DOCUMENT_RESPONSE`, `p_person_id is null` half (043:683):** no separate mutation-level test. Defence in depth: it is the sole guard only on an accepted replay of a receipt that can't exist for an applicant. The behaviour is pinned by the new assertion.

### Deferred minors

Fixed in the final wave (`8475848`): controller and seed indentation, the "Identity first" comment, "plain screen" and `staffWin` wording, the "forged client" title.

Left as they are:
- **Task 1:** `on commit drop` temp tables need one transaction (stated in 043's header); an overlong header line (043 can't be edited); the catalog "two values" test doesn't assert `presenter` is absent (covered elsewhere).
- **Task 3:** the presenters note isn't exercised through the CLI's `main`; helpers declared lower in the roster test file.
- **Task 4:** the two no-access paths set different error text; earlier state isn't cleared on a restart into no-access (pre-existing, hidden by the screen); small coverage wishes.
- **Task 5:** no unit test binds `screenFor` to `noAccessScreen` (the story covers it).
- **Task 6:** if `getSession` throws on a no-access window and the user presses Dismiss, the no-access screen replaces the unreachable one (benign; focus and online retry).
- **Task 7:** optional "(until 043)" on historical rows; a past-tense line in `architecture.md`; `setup.md` folds "entry or version" into one item.
- **Integration:** 042's header still says #136 numbers its migration 042 (applied, must stay); `backend.md`'s `defaultFollowup` row could say "also holds admin"; a missing blank line after `database.md`'s migration table (pre-existing); the first merge commit's trailer order.

---

## Disclosure: the browser story

`verify.md` has the full table. In short:
- **Local failures, order 1:** "the Reviewer reviews…" twice; "the Site Coordinator logs a contact…" and "the Preparer verifies…" in instrumented runs.
- **One CI failure, order 1:** run `42675920745` attempt 2, at "two staff accounts work one case…", the intake tab not shown within 10 s.
- **The 8-run paired sample:** `main` 4 of 4, this branch 4 of 4, at the same Reviewer timings (`main` 11.1–13.6 s, branch 11.6–13.4 s).
- **The cause is unproven.** The user ruled to continue.

## Note: the local roster is out of date

`.vitally-roster.local.json` lists only riley and jordan as staff, has no `defaultFollowup`, and still has `presenters` and `sampleCaseOwners`. As it stands, the roster command now refuses it. A replacement based on `tools/admin/roster.example.json`: keep `workspaceId` `160fc95a-…`, list the staff wanted (the rehearsal workspace has six), set `defaultFollowup` to a staff entry holding `admin` and `followup`, and drop `presenters` and `sampleCaseOwners`. The file was not edited.
