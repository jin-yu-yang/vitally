# Retrospective: add-clearance-uploads

> Written: 2026-11-20 (after verify passed with warnings)
> Commit range: `fdd64a2..48412f4`, plus the verify, retrospective and archive commits
> Worktree: `D:/dev/vitally-clearance-uploads` (branch `add-clearance-uploads`)

---

## 0. Evidence

- **Commit range**: `fdd64a2..48412f4` (26 commits: 1 planning, 9 migration/front-end/test task commits, 9 task fix commits, 3 docs, 6 final-review fixes, 2 task ticks, minus overlap). Verify and the archive follow.
- **Diff size**: +4198 / −50 lines across 35 files. `supabase/migrations/053_clearance_uploads.sql` and `tests/database-clearance-uploads.mjs` are the largest new files.
- **Tasks done**: 26/26 (`grep -cE '^\s*- \[x\]' tasks.md` → 26).
- **Active hours**: about 9 hours wall clock on 2026-11-20, planning, apply and CI in one session. Apply itself was about 4 hours. About 1.5 hours went on test runs that low memory slowed or cut short.
- **Subagent dispatches** (counted from the ledger): about 30 fresh dispatches, plus 8 resumed fix rounds.
  - Fresh: 9 implementers, 9 task reviews (opus for Tasks 3 and 8, sonnet for the rest), about 7 scoped re-reviews, 1 final whole-branch review (opus), 1 final fix wave (opus) and 1 re-review of that wave.
  - Resumed fix rounds: Tasks 3, 5 (×2), 6, 7, 8 and 9 (×2).
- **New external dependencies**: none.
- **Bugs encountered post-merge**: none yet. This is not merged.
- **OpenSpec validate state at archive**: pass (21/21 before archive; re-run after archive at step 8).
- **Test coverage signal**:
  - unit 2132 → 2192 (+60);
  - database 768 → 814 (+46; CI run 44748648528; the local full run was cut short by memory);
  - browser 50 → 51 per story leg. CI 44748648528 against main run 44700072367: the chrome-client story went 643 → 591 s and firefox-client 589 → 556 s, so the story is still well under 900 s.

Commit chain (in order):

```
09d3da3 OpenSpec change add-clearance-uploads: planning artifacts (#138, migration 053)
80392a8 053: sent dates on roster entries; clearance answer gains sentAt and uploadUrl, no capabilities when uncleared (#193 item 7)
49ebed1 053: vitally_mark_upload_sent, a volunteer marks their own 13615 or photo ID sent
097eb68 053: Save clears sent dates it acts on; vitally_mark_upload_reviewed
809c793 053: reserve the upload-sent receipt before the entry checks; marker and reorder test
51fe001 Store: mark upload sent/reviewed, count uploads to review; Roster rows carry sent dates
2f9e4a9 Setup screen: Upload, I've uploaded it, and waiting for review
8f9ea4a Setup uploads: nest controls in the item, name the document, guard the date, space the row
e68fc99 Test: a refused upload send drops a store action's Try again
2c0d4ab Roster: Show filter (Uploads to review), to-review row text, Mark reviewed in the drawer
29a4fec Mark reviewed: disable while busy, cover the no-op paths, fix a test comment
54c8459 Sidebar: Volunteers shows the uploads to review count for workspace admins
648febb Sidebar count: reset on sign-out and on losing admin; the Roster read no longer waits for it
5d1943d Browser: a volunteer's uploads are sent, filtered and reviewed (outside the story)
00df526 Browser: scope the heading waits and drop dead conflict checks in the uploads test
17396e5 Docs: migration 053, clearance uploads RPCs
4937a1d Docs: correct the RPC count, the sent-date formatter and the 13615 clearing rule
9aa5bc6 Docs: the 13615 clearing rule, and where the account functions are listed
be2a70a Setup uploads: say the refusal from its detail and ask the clearance after the send
3385869 053 §3: the send locks the volunteer's profile before the roster entry
87a737b 053 header: say the migration is applied once
8d29112 Roster: style the uploads to review note and the drawer's sent line
ec7a761 Docs: siteCheck is one of the clearance keys
427bf79 Tests: an uncleared workspace admin may mark reviewed
(task-tick commits omitted: 7a3cb31 48412f4)
```

---

## 1. Wins

- **Checking the brief against the code before planning found a missing piece while it was cheap.** The Roster had no "Show" filter for "Uploads to review" to hang on. The user chose a "Show" dropdown built to take more views later (`SHOW_VIEWS` in `src/volunteer-roster.mjs`, 2c0d4ab), instead of the gap turning up mid-apply.
- **The final whole-branch review caught three real defects that the task reviews could not see**, because each sat between tasks:
  - F1: the refusal sentence read `cause.message`, but the server puts the reason in `details`, so volunteers would only ever have seen "Something went wrong." The mocks in the tests copied the wrong shape (be2a70a).
  - F2: the send could join an in-flight focus check and show a stale answer without the sent date (be2a70a).
  - F3: the send locked entry → profile, while Save locks profile → entry, so the two could deadlock (3385869). A discriminating DB test now proves the order.
- **The per-task reviews caught a cross-user leak before it shipped.** Task 7's first version kept the uploads count across sign-out, so the next person at the same browser saw the last admin's count (fixed in 648febb).
- **The story stayed well under its limit.** The new browser test was kept separate from the story, as the brief asked. CI shows both story legs faster than main's run (section 0).
- **#193 item 7 was folded in without widening scope.** Empty `capabilities` when uncleared came out of one `case` in `vitally_my_clearance()` (80392a8). The existing test was converted, not deleted.

## 2. Misses

- 🟡 [painful | evidence: final-fix report; verify.md §5] **No clean local full database run.** The full suite hit its 3000 s timeout with 100–450 MB free. Nine tests failed under that pressure and passed when their files were re-run alone. One test process hung after finishing and had to be killed. CI's `database` job (814/814) is the clean evidence. Locally, only per-file runs were trustworthy.
- 🟡 [painful | evidence: 5d1943d → 00df526] **The browser test was written blind, and its first version would have failed.** Memory ruled out a local run (R9). The Task 8 review found a Playwright strict-mode violation: the "Work board" heading matches both an h1 and an h2. CI was the first run after the fix, and it passed.
- 🟡 [painful | evidence: be2a70a] **Mocks copied the implementer's belief about the error shape, not the server's.** Three controller tests passed while the real path could never show its sentences. Only the whole-branch review, reading the SQL and the controller together, saw it.
- 📌 [nit | evidence: Claude Code background-task notice] The CI watcher (`gh run watch`) was killed by Claude Code's low-memory reaper while idle. CI was unaffected.
- 📌 [nit | evidence: verify.md §5] The new test takes no screenshots, so the setup-screen upload controls, the Show filter, the drawer's sent lines and the sidebar count are checked by assertions only, not by eye. The `.volunteer-to-review` / `.volunteer-sent` CSS (8d29112) has not been looked at.

## 3. Plan deviations

| Plan task | What changed | Why |
|-----------|--------------|-----|
| 2 (send RPC) | The receipt is reserved before the entry checks, not after (809c793) | Ruling R5: the spec says a repeated request returns the stored result; a refusal still stores nothing because the transaction rolls back |
| 2 (send RPC) | The send locks the profile before the entry, and a caller with no profile row gets `NOT_FOUND` (3385869) | Final review F3: the same lock order as Save, so no deadlock. design.md D2 was updated at verify |
| 4 (store) | The store methods went into `src/supabase-store.mjs` only, not `src/contracts.mjs` | Ruling R6: `contracts.mjs` holds domain constants, not a store interface |
| 6 (Roster) | The draft-survival check moved from a unit test into Task 8's browser test | Rulings R7/R8: drafts live in `app.mjs` render/restore, which only a browser run reaches |
| 8 (browser) | Written but not run locally; CI was its first run | Ruling R9: 0.3 GB free |
| Final review | 7 fixes in one wave (be2a70a..427bf79) | F1–F3 plus four minors (header wording, CSS, docs `siteCheck`, uncleared-admin test) |

## 4. Skill / workflow compliance

| Skill                                            | Used |
|--------------------------------------------------|------|
| superpowers:brainstorming                        | ✓ (brainstorm.md, from the user's decisions) |
| superpowers:writing-plans                        | ✓ (plan.md) |
| superpowers:using-git-worktrees                  | ✓ (`D:/dev/vitally-clearance-uploads`) |
| superpowers:subagent-driven-development          | ✓ (ledger, 9 tasks, final review) |
| (transitive) superpowers:test-driven-development | ✓ (implementers report RED then GREEN; Task 6 showed RED after the fact by stashing `src/`) |
| (transitive) superpowers:requesting-code-review  | ✓ (task reviews, final review, scoped re-reviews) |
| superpowers:finishing-a-development-branch       | ✓ (lifecycle step 9: push and PR) |

### Deliberately Skipped Skills

None.

## 5. Surprises

- **The error shape.** Every layer assumed the refusal reason was in `message`. In this codebase a VT007 refusal carries `message='VALIDATION'` and the reason in `detail`, which PostgREST hands back as `details` on the wrapped `cause`. Other controller paths already read `cause.details` (controller.mjs ~1601, 4173, 4417). The implementer wrote a new path without copying them.
- **The RPC count in the docs was four behind.** It said 26; the real count is 30 (052's four were never counted). Found in the Task 9 review.
- **Memory, not code, set the pace.** About 1 GB free at the start, and down to 0.3 GB mid-apply. That decided where every slow check ran: per-file database runs locally, the full suite and the browser on CI.
- **`.env.test` copied from the main checkout pointed at the user's persistent stack.** It was replaced with the throwaway stack's file before any test ran. The persistent stack was never touched.

## 6. Promote candidates → long-term learning

- [ ] 🟡 **Mocks of server errors must copy a real refusal's shape, and a new refusal path should copy an existing one.** → **Promote to memory** (type: feedback)
  > **Why**: be2a70a. Three controller tests mocked `{message: "PHOTO_ID_NOT_NEEDED"}` while the server sends `{message: "VALIDATION", details: "PHOTO_ID_NOT_NEEDED"}`. The sentences could never show.
  > **How to apply**: in implementer briefs for any new RPC refusal, point at an existing `cause.details` read in `src/controller.mjs`, and have the test mock use that shape.

- [ ] 🟡 **A new RPC that locks two tables must take them in the order the existing writers use.** → **Promote to memory** (type: feedback)
  > **Why**: F3. `vitally_mark_upload_sent` locked entry → profile; `vitally_save_volunteer` locks profile → entry. That is a deadlock pair that only the whole-branch review saw.
  > **How to apply**: when a plan adds a SECURITY DEFINER function that locks rows another function also locks, write the lock order into the plan's Global Constraints and ask for a lock-order test.

- [ ] 📌 **On this machine, the full database suite and browser runs belong on CI.** → **Already in memory** (`machine-memory-limits.md`); this cycle confirms it.
  > **Why**: the local full run timed out under memory pressure, with false failures (final-fix report).
  > **How to apply**: locally, run the change's own database file and per-file re-runs; trigger CI on the pushed branch for the rest.

---

## Ledger summary (rulings, parked and deferred findings)

The subagent-driven-development ledger (`.superpowers/sdd/plan/progress.md`) is deleted after this retrospective. It recorded the following.

**Rulings** (all accepted by the user at verify):
- **R1:** "a cleared caller may send" uses a fresh cleared staff member, not the shared `f.preparer`. That keeps shared fixture state clean.
- **R2:** a refusal on the setup screen uses the existing notice path (the shell banner). No new component.
- **R3:** the sidebar count tests go in `tests/shell.test.mjs`, next to the existing sidebar tests.
- **R4:** while unmerged, 053 may be re-applied on the throwaway stack only (delete its `schema_migrations` row, re-run the migrator). Hosted applies it once.
- **R5:** the send reserves its receipt before the entry checks, so a repeated request returns the stored result (un-parked Task 2 minor m4).
- **R6:** the store methods live in `src/supabase-store.mjs` only.
- **R7:** draft survival after Mark reviewed is checked in the browser test.
- **R8:** the comment in `tests/controller.test.mjs` pointing at that browser check stays. The browser test now has the check, so the comment holds.
- **R9:** no local browser run; CI runs the new test (it passed in both legs).
- **R10 (deferred finding):** `markUploadReviewed` keeps no pending action id. If an answer is lost and the admin presses Mark reviewed again, the retry goes out under a new action id and can show a misleading conflict banner instead of the stored result. It heals itself (the re-read removes the line). Carried to #238, which covers the same receipt/action-id family.

**Parked findings**:
- Task 2 m4 (entry checks before the replay lookup): un-parked and fixed as R5.
- Task 9: README, backend, frontend and architecture docs still carry stale "twenty-two" counts from before 053. These are pre-existing, not this change's. Candidate for a docs follow-up.

**Deferred minor findings**:
- Task 1: the no-entry test deletes its own fixture member's entry instead of rolling back. Accepted, because the RPC runs on a separate connection.
- Task 3: the uploaded-certificate clause that clears the 13615 is redundant with the confirmed-set check. Kept as a second guard. There is no test that FORBIDDEN comes before a malformed-input refusal.
- Task 4: the test fake counts all rows without applying `.or(...)`; the season is read twice; `markUploadSent` has no `requireStaffAccess` check in the controller (the RPC enforces it).
- Task 5: a test edit at `tests/setup-views.test.mjs:~419` keeps its intent; `button()`'s extra attribute is unescaped (it only receives literals); the order test feeds items already in order.
- Task 6: the catch path shows "busy" until the re-read finishes.
- Task 7: a failed clearance check does not re-read the count. The last count stays, which is acceptable.
- Task 9: `NOT_FOUND` for a caller with no profile row is not in `docs/developer/database.md`, though design.md D2 now records it. "Only confirmed is written" in the certificates docs is pre-existing and stale.
- Final fix wave: the lock-order DB test finds the waiting send by function name in `pg_stat_activity`, so it is not scoped to its own workspace. It is safe at `--test-concurrency=1`. The new CSS has not been checked by eye.
