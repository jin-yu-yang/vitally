# Retrospective: add-season-settings

> Written: 2026-11-19 (after verify passed with warnings)
> Commit range: `e3b709e..f59b466` (archive commit to follow)
> Worktree: `D:/dev/vitally-season-settings` (branch `add-season-settings`)

---

## 0. Evidence

- **Commit range**: `e3b709e..f59b466` (36 commits: 1 planning, 20 implementation/fix, 2 docs, 2 final-review fixes, 1 plan correction, 9 task ticks, 1 verify).
- **Diff size**: +8171 / −501 lines across 71 files. Migration `052_season_settings.sql` is the largest file.
- **Tasks done**: 32/32 (`grep -cE '^\s*- \[x\]' tasks.md` → 32).
- **Active hours**: about 10 hours wall clock on 2026-11-19, planning and apply in one session. About 1.5 hours of that was waiting on full test runs that low memory slowed down.
- **Subagent dispatches**: 37 fresh dispatches, plus 9 resumed fix rounds.
  - Fresh: 12 implementers, 13 task reviews (opus for SQL and front end, sonnet for browser and docs), 7 scoped re-reviews, 1 final whole-branch review (opus), 1 final fix wave, and 1 re-review of that wave.
  - Resumed fix rounds: Tasks 1, 3, 6, 9, 10 (R8), 11 (R9) and 12, and the final fix wave (R13).
- **New external dependencies**: none.
- **Bugs encountered post-merge**: none yet. This is not merged.
- **OpenSpec validate state at archive**: pass (19/19 before archive; re-run after archive at step 8).
- **Test coverage signal**:
  - unit 2076 → 2130 (+54);
  - database 709 → 767 (+58; 767/767 on a fresh stack and again in the main-state rehearsal);
  - browser 49 → 50 per story leg (CI 44659034710: chrome-client 638→596 s, firefox-client 569→564 s against main run 44606983534).

Commit chain (in order):

```
d1d5a71 Plan OpenSpec change add-season-settings (#138, migration 052)
d4a16a7 052: guard, snapshot and the role capabilities mirror
59ac1ce 052: guard tests compare with a baseline; mirror reuses effective_capabilities
ae1e162 052: site coordinator flag, workspace admin and SC in clearance
04e03c4 052: staff setup takes no capabilities; tests move from the ceiling to roles
17b3f93 spec: a follow-up-only write is replaced by the mirror, not refused
f52d9c0 Tests: the unqualified default follow-up person is neither a site coordinator nor holds followup
4827add 052: grant and remove site coordinators; deactivation keeps one
4fa06ad 052: a site coordinator can be the default follow-up person
34ba056 052: only site coordinators change the Admin role (#193 item 3)
e846b1e 052: the open-work rule counts a site coordinator's SC in the would-be clearance
2384ff7 052: Season settings storage and RPCs
dcda19c Roster command: siteCoordinator; capabilities and siteNumber ignored
dc4dd20 Roster: SC rule, Admin tick for site coordinators, store calls
6de8e44 Roster: a disabled Admin tick keeps its saved state on a certificate untick
a14b9cc Season settings screen
f2780e1 Season settings: candidates carry their account revision for the grant
430fe80 plan: candidates carry accountRevision (ruling R8)
cc2fada Browser: Season settings walk
2b8e4c5 Docs: Season settings, site coordinators and the capabilities mirror
2dfedac Docs: replace stale ceiling wording after 052
4dbe1ba Final review fixes: database guide, comments, Add disabled until picked
6f1b7f2 Season settings: Add follows a restored pick
f59b466 verify: add-season-settings
(task-tick commits omitted: 5ce5f05 46d7ffa e3fabef bcc672c 757d02a 4adb598 cec271c 9a46070 8889b0d d51be85 beae576 4bd4a42)
```

---

## 1. Wins

- **Checking every decision against the code before writing the brainstorm caught two design conflicts while they were still cheap** (brainstorm.md "Checked against the code"):
  - the default follow-up person's `followup` requirement, which needed ruling A;
  - no-sign-in visibility, which needed the sign-in-only mirror.

  Both became user rulings before any artifact was written. Either would otherwise have broken every fixture at Task 1.
- **The mirror kept the readers unchanged, as design D1 intended.** The final review traced every reader (RLS, realtime `people`, workload, labels, posted updates) and found none that needed rewriting beyond the planned functions. The reviewer's "Strengths" covers this for 052 as a whole.
- **Per-task reviews caught spec-level defects that tests alone would have let through.** Four of them:
  - **Guard tests depended on other workspaces' rows** (Task 1, fixed in 59ac1ce).
  - **A converted test asserted a refusal the spec forbids** (Task 3, f52d9c0).
  - **The open-work rule ignored D6's SC rule** (Task 6, e846b1e). A save could leave a site coordinator uncleared while holding work.
  - **A locked Admin tick could be unticked on screen** (Task 9, 6de8e44).
- **The hosted deploy order was traced end to end by the final reviewer, and the 052 guard was rehearsed on a populated main-state stack.** That stack had main's migrations, roster and seed data; the guard counted 0 offenders, and the suite passed 767/767. None of this touched the user's persistent stack (ruling R12).
- **The story stayed well inside its budget.** The new walk is a separate test (cc2fada) and adds 9–11 s outside both legs, and the legs did not grow (CI 44659034710).
- **The SIDN stays write-only end to end.**
  - It is never returned to a browser.
  - It is kept out of the receipt digest (R7).
  - A leak test JSON-stringifies every relevant answer and row (`tests/database-season-settings.mjs`).

## 2. Misses

- 🟡 [painful | evidence: Tasks 7, 8, 11 reports; R9] **The machine ran out of memory for the full test runs.** About 1–1.7 GB was free with Docker running.
  - Three full runs were killed (database twice, browser once). One orphaned test runner kept running against the stack until the controller stopped it.
  - Full database runs had to drop to `--test-concurrency=1` (about 30 minutes each).
  - The browser legs could only run in CI, which needed a mid-apply push that the user approved.
- 🟡 [painful | evidence: R8, f2780e1] **The plan's interface for `vitally_season_settings().candidates` left out `accountRevision`.** `vitally_set_site_coordinator` requires it, so every real Add would have been refused. Task 7's database tests didn't catch it because they granted with the account's revision read directly. Only the Task 10 implementer, wiring the UI, noticed.
- 🟡 [painful | evidence: 4dbe1ba → 6f1b7f2, R13] **The final-review fix wave introduced a regression.** "Add disabled until picked" ignored draft restore, so Add could stay disabled with a person picked. That needed a breaker ruling and a second small change, which the process's "one fix wave" rule doesn't normally allow. Neither change has a unit test (DOM-only code in `app.mjs`), and the story doesn't reach Add.
- 🟡 [painful | evidence: 17b3f93, R4] **A delta-spec scenario contradicted the mirror.** "No follow-up-only person can be stored … the write is refused" can't happen when a BEFORE trigger replaces the value. The scenario was written at propose time without thinking through trigger order.
- 📌 [nit | evidence: Tasks 2, 3, 10 reports] **TDD evidence was sometimes summarised counts, or missing.** Task 3's Step 1 baseline was spoiled by concurrent edits; Task 10 kept no RED run. Reviewers judged the tests real anyway.
- 📌 [nit | evidence: 2b8e4c5] **One commit carries a `Claude Sonnet 5.5` trailer** instead of the project's required Opus trailer. It was pushed before this was noticed, so history was not rewritten (R11).
- 📌 [nit | evidence: CI screenshots] **At 390 px the "Make someone a site coordinator…" picker text is clipped.**
- 📌 [nit | evidence: verify.md §7] **The user's own persistent local stack was not rehearsed.** 052's guard could still refuse there if it holds an admin set through the roster command without the Admin role. Deploy step 1 is the fix.

## 3. Plan deviations

| Plan task | What changed | Why |
|-----------|--------------|-----|
| Task 1 | Added a `beforeDefaultFollowup` hook to `initializeWorkspace`, used by the fixture (R1) | Under the mirror, the default person has `{}` until roles are written, so `set_default_followup` refused and no fixture could build |
| Task 3 | The whole-suite pass excluded database-seed failures owned by Task 8 (R2) | The seed's role-account clearance lacked `sc`; fixed in dcda19c |
| Task 3 | A spec scenario was restated (R4) | Trigger replaces rather than refuses |
| Task 5 | Review evidence was a textual diff of the copied blocks, not live `pg_get_functiondef` before/after (R3) | Same evidence without a second stack |
| Task 6 | A second ADMIN_ROLE check, for Admin dropped indirectly by unticking a certificate (R6); the would-be clearance gained the SC rule (e846b1e) | The spec's "removes it" and the open-work requirement under D6 |
| Task 7 | The SIDN was kept out of the receipt digest (R7); the read's `candidates` gained `accountRevision` (R8, in Task 10) | Reversible hash; Add must work |
| Task 7 (plan text) | One row per workspace, not per season | User ruling at plan review, before apply |
| Task 11 | Local run limited to the Roster and Season settings tests; story legs and counts from CI 44659034710 (R9) | Memory: local legs were killed |
| Task 12 | Step 2 limited to unit, hant and validate; Step 3 rehearsal done by the controller on a main-state throwaway stack, not the user's persistent stack (R10, R12) | Memory and consent; CLAUDE.md's CI stand-in |
| Final review | One fix wave (R11) plus one breaker-ruled follow-up (R13) | The fix wave's own regression |

## 4. Skill / workflow compliance

| Skill                                            | Used |
|--------------------------------------------------|------|
| superpowers:brainstorming                        | ✓ (invoked during propose; the design was agreed in an earlier session, and two open questions plus two conflicts were resolved here) |
| superpowers:writing-plans                        | ✓ (plan.md in the change folder) |
| superpowers:using-git-worktrees                  | ✓ (`D:/dev/vitally-season-settings`, the repo's `D:/dev/vitally-<name>` convention) |
| superpowers:subagent-driven-development          | ✓ (ledger, pre-flight scan, 12 tasks, per-task reviews, final review) |
| (transitive) superpowers:test-driven-development | ✓ (RED/GREEN in implementer reports; evidence gaps noted in §2) |
| (transitive) superpowers:requesting-code-review  | ✓ (per-task reviews plus the whole-branch review on opus) |
| superpowers:finishing-a-development-branch       | pending (lifecycle step 9, after archive) |

### Deliberately Skipped Skills

(none)

## 5. Surprises

- **The default follow-up person's `followup` is checked in seven places, not the three the decision listed.** The other four are four case actions and `open_work` (found during propose, D7).
- **Under the mirror, the fixture Reviewer gains `prepare`.** The Reviewer role gives both `prepare` and `review`, and the old ceiling had hidden that. Tests that assumed a review-only reviewer were audited in Task 3.
- **`open_work` already refused deactivating the default follow-up person**, so ruling A's "deactivating is refused too" needed no new code.
- **A disabled checkbox isn't sent with a form**, so a locked Admin tick needed a hidden input to keep its saved role. Separately, an older handler (`syncVolunteerRoles`) unticked locked boxes.
- **Draft restore sets `value` without a `change` event.** So any control whose state follows another control's value needs syncing after restore (R13).
- **On this Windows machine, Docker plus the test suites leave only about 1 GB free.** Parallel database or browser runs get killed, and a killed shell can leave its node test runner alive.

## 6. Promote candidates → long-term learning

- [ ] 🟡 **Run heavy suites with low concurrency on this machine, and check for orphaned runners after a kill** → **Promote to memory** (type: project)
  > **Why**: in add-season-settings, three full runs were killed for memory (about 1 GB free with Docker), and an orphaned `node --test` runner kept running against the stack.
  > **How to apply**: before `test:database` here, use `--test-concurrency=1` (about 30 minutes). For story legs, prefer CI. After any killed run, list `node.exe` processes and stop the test runner tree for this worktree.

- [ ] 🟡 **An RPC's read shape must carry every field its write RPCs require (revisions, ids)** → **Promote to memory** (type: feedback)
  > **Why**: R8. `candidates` lacked `accountRevision`, so every Add would have been refused. The database tests granted with directly read revisions and missed it.
  > **How to apply**: when planning a read RPC that feeds a write RPC's arguments, list the write's required parameters next to the read's shape, and write one end-to-end test that feeds the read's output into the write.

- [ ] 🟡 **When a column becomes trigger-maintained, rewrite every "the write is refused" scenario about it** → **Promote to memory** (type: feedback)
  > **Why**: R4. A BEFORE trigger replaces the value before any check constraint runs, so "refused" scenarios become "replaced".
  > **How to apply**: during propose, when a design adds a BEFORE trigger that sets a column, grep the canonical specs for scenarios that write that column directly, and restate them in the deltas.

- [ ] 📌 **UI state derived from another control must be re-synced after draft restore** → **One-off** (recorded here and in `app.mjs`'s `syncSiteCoordinatorAdd`)
  > **Why**: R13. `restoreDraft` sets `value` with no `change` event.
  > **How to apply**: any new enable/disable that follows a form control in `src/app.mjs` should also run after `restoreFormDrafts`.

- [ ] 📌 **Follow-up issue: the ADMIN_ROLE check comes before the receipt and revision check, and `ceilingAdmin` should be renamed to workspace admin** → **One-off** (open an issue under #138)
  > **Why**: the final review's Minor 1 and 2 (R11). This is rare but wrong: replaying a landed save by a non-site-coordinator gets ADMIN_ROLE instead of its receipt.
  > **How to apply**: next change touching `vitally_save_volunteer` or `clearance.mjs`.

---

## Ledger summary (subagent-driven development, before deleting the workspace)

**Rulings** (every `Ruling:` line in the ledger, in order):
- **R1** — a `beforeDefaultFollowup` hook in `initializeWorkspace` so fixtures build under the mirror.
- **R2** — database-seed failures owned by Task 8 may stay red through Tasks 3–7.
- **R3** — Task 5's evidence is a textual diff of the copied blocks.
- **R4** — restated the follow-up-only scenario: replaced, not refused.
- **R5** — the ADMIN_ROLE guard lives in the RPC, not a trigger.
- **R6** — keep the second ADMIN_ROLE check for Admin dropped by a certificate untick.
- **R7** — SIDN kept out of the receipt digest.
- **R8** — `candidates` carry `accountRevision`, fixed inside Task 10, and plan.md corrected.
- **R9** — local browser run limited to two tests; story legs via CI.
- **R10** — Task 12's checks limited, with CI standing in; the rehearsal is the controller's.
- **R11** — the final fix wave's scope. The ADMIN_ROLE ordering and the `ceilingAdmin` rename go to a follow-up. The Sonnet trailer on 2b8e4c5 is left in history.
- **R12** — rehearsal on a throwaway stack brought to main's state.
- **R13** — a breaker ruling allowed one targeted fix for the fix wave's Add regression.

**Parked findings**: none. Every Critical and Important finding was fixed within the fix loop, with at most one round per task.

**Deferred minor findings** (the final review triaged all of them as "leave", except the Task 8 docs carry, which was fixed in 2dfedac/4dbe1ba):
- **052 comments and markers:**
  - an unmarked removed join in the copied `effective_capabilities`;
  - `create` → `create or replace` and one comment edit not marked in `vitally_record_account`;
  - §7's header omits the null-VALIDATION and receipt steps;
  - §8's header could note the sign-in requirement;
  - `season_link` is `security definer` though it reads no tables.
- **052 robustness:**
  - `deactivate_account`'s last-site-coordinator check relies on the caller holding the workspace lock. Start next season must take it.
  - `vitally_set_site_coordinator` checks FORBIDDEN before the lock.
  - ADMIN_ROLE comes before the receipt (a follow-up issue).
  - A non-site-coordinator editing another workspace's volunteer gets ADMIN_ROLE, not NOT_FOUND (no leak).
  - The default-row exemption matches `open_work`'s label string.
- **Test assertions:**
  - missing-list order and `photoId` not asserted in two site-coordinator subtests;
  - no history-row or receipt assertion on a refused last-site-coordinator deactivation;
  - no test that a site coordinator default with other open work is still refused for that work;
  - no test of an uncleared site coordinator reading Season settings;
  - the "Not set" branch untested;
  - a weak SIDN `updated_at` check;
  - the SIDN leak test covers a subset of RPCs and tables;
  - the browser test doesn't check the stored SIDN;
  - 720 px overflow not asserted separately;
  - the Preparer check asserts only that the link is absent;
  - the Preparer home screen and the non-site-coordinator `canEdit:false` wiring are asserted only in other layers;
  - `app.mjs` wiring is pinned by source regex.
- **Test hygiene:**
  - the fixture hook skips silently;
  - `removeChannel` not awaited;
  - the realtime probes are slower now;
  - rpc-signatures leaves a test site coordinator and hard-codes a revision;
  - a direct flag flip writes no history;
  - the seed SIDN test leaves volunteers;
  - test-promoted admins stay in the shared fixture workspace;
  - the `addCapabilities` override is now always replaced (commented).
- **Process:** TDD evidence summarised in places; no clean pre-change baseline in Task 3.
- **Front end and copy:**
  - the History disclosure is hidden when empty;
  - "Loading Season settings…" and "Season settings couldn't load." are not in the plan's copy list;
  - `canChangeAdmin` defaults to true (the server enforces);
  - the picker text is clipped at 390 px;
  - stale "ceiling" naming (`views.mjs` ~556, the `CEILING_*` constants);
  - `syncSiteCoordinatorAdd` inserted between `restoreFormDrafts`' comment and the function.
- **Docs:** vague SIDN mention in `roadmap.md:123`; `setup.md` step 4 goes beyond the design text (accurate).
- **Out of scope by design:** the mirror goes stale when `current_season` changes. Start next season owns that, along with dropping `vitally_private.capabilities_before_052` and keeping site coordinators' accounts active.

## Review fixes after archive (PR #237, 2026-11-20)

The reviewer found two gaps after the change was archived. Both were fixed on the branch, and the archived design, the delta specs and the canonical specs were updated to match.

- **052 made new admins silently.** The guard refused only people who would lose admin. Someone with the Admin role ticked under the old ceiling, but no `admin` capability, would have become an admin. The guard now refuses both directions, with a count for each. The new database test is the reviewer's case: an ordinary volunteer with Admin ticked before 052. The hosted deploy order runs the reviewer's query before 052. 052 had not been applied to any shared database, so the migration itself was edited.
  - *What it teaches:* a guard for a recompute must check both directions of the change, not only the loss the design worried about.
- **An admin who wasn't a site coordinator could remove the mark by deactivating the account.** `vitally_deactivate_account` now refuses them with `FORBIDDEN`. The drawer hides Deactivate on a site coordinator's account for them and says "Only site coordinators deactivate a site coordinator's account." As a result, `LAST_SITE_COORDINATOR` on deactivation is reached only below the app; its database test now calls the internal function.
  - *What it teaches:* every path that changes a protected flag needs the same authority as the direct path. Deactivation was a side door to "remove site coordinator".
- **Tests:** unit 2130 → 2132. The database suite gained the gain-direction guard test and Cal's refused deactivation of Bea. The "last site coordinator" database test now expects `FORBIDDEN` from the app and `LAST_SITE_COORDINATOR` from the internal function.
