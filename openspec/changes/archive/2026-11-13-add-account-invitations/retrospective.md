# Retrospective: add-account-invitations

> Written: 2026-11-14 (after verify passed with warnings)
> Commit range: `06ebee6..89438dc` (apply head; the archive commit follows)
> Worktree: `D:\dev\vitally-accounts`

---

## 0. Evidence

- **Commit range**: `06ebee6..89438dc` (21 commits)
- **Diff size**: +4843 / -70 lines across 47 files; outside `openspec/`, +3696 / -70 across 36 files
- **Tasks done**: 27/27 (tasks.md)
- **Active hours**: about 3.5 h of wall clock from the planning commit (20:15 -05:00) to the apply head (23:41), plus the brainstorm before that
- **Subagent dispatches**: 7 implementers (one per task), 7 task reviews, 5 scoped re-reviews, 1 whole-branch review, 1 fix-wave agent; plus 1 explore agent during propose. Fix rounds: Task 1 ×1, Task 3 ×2, Task 4 ×1, Task 5 ×1 (CI), Task 6 ×1, Task 7 ×1, final wave ×1 plus 1 CI fix.
- **New external dependencies**: none in package.json. The Edge Function imports `npm:@supabase/supabase-js@2.116.0`, the version the app already pins. CI now pulls the edge-runtime image (`public.ecr.aws/supabase/edge-runtime:v1.74.3`).
- **Bugs encountered post-merge**: none yet (not merged)
- **OpenSpec validate state at archive**: pass (15/15 before archive)
- **Test coverage signal**:
  - unit `npm test` went from 1627 tests (baseline) to 1687, with the one pre-existing Windows-only failure;
  - new database files: `tests/database-accounts.mjs` and `tests/database-accounts-function.mjs`;
  - one new `test:auth-browser` case;
  - the story is unchanged except for the column index.
- **CI**: the final run, [43557916685](https://github.com/jin-yu-yang/vitally/actions/runs/43557916685) on `89438dc`, passed every job (checks, database, sign-in, both story legs).

Commit chain:

```
a13f569 planning artifacts
caabddf test stack: edge runtime, functions copy, mail catcher
69f6570 accounts table, backfill, sign-in activation, cleared needs active
47902a6 stub accounts function so the stack starts
2ffea86 account RPCs
7e77054 prepare replay; client list leaves out deactivated
e6cd9b1 design/decision log follow apply rulings
b35d2b6 fix dollar quote on vitally_prepare_account
b39f6b7 accounts Edge Function
f31fcb3 function: verify caller first; email_exists retry
f056d99 Roster account column and drawer Account section
851683a office Invite a client panel
cfa89b6 re-read invitations on focus; form validity
68ad598 sign-in browser case; seed and docs
b10c53c story: Cleared column moved right of Account
29e7492 sign-in case cleanup order
ac8abb5 tasks checked
004efe9 final review fixes
5a0216b demo script: seeded volunteers not cleared
fd471a9 DB tests: close fixture first; seed link with membership
89438dc invite panel card padding
```

---

## 1. Wins

- **[caabddf, 47902a6, run 43541990022] An early CI probe before the migration found the stack problem when it was a one-file fix.** I pushed Task 1 alone and ran CI while Task 2 was being written. That surfaced "failed to read file: supabase/functions/accounts/index.ts" at `supabase start`, which the stub fixed.
- **[run 43541990022 on 47902a6] The riskiest database assumptions were proven on the first full run:** a trigger on `auth.users`, the backfill, and the stricter `cleared()` that every fixture and story role account depends on.
- **[2ffea86..b35d2b6] Idempotency lives in the database.** Receipts are keyed by the caller and the action. Prepare's replay answer means a retried Create or Invite through the function gets the stored result, not "already invited".
- **[run 43547298753] The function's stack test exercised the real edge runtime, Mailpit and GoTrue** (create → code email → verifyOtp → active; invite → resend). The test-only `email_sent` override and Mailpit paths were right the first time.
- **[final review]** The security model held up under a whole-branch review: admin-only RPCs, emails never exposed beyond admins, the service key only for `createUser`, and select-only RLS on `accounts`.
- **[89438dc] Reviewing the story screenshots caught a real layout defect** that no test checks: the invite panel had no card padding.

## 2. Misses

- 🟡 **[painful | 7e77054 → b35d2b6] A programmatic edit turned `$$` into `$` and broke the migration's parse.** The implementer used Node's `String.replace`, where `$$` in the replacement means a literal `$`. The scoped re-review caught it before CI. Later dispatches carried a warning about it.
- 🟡 **[painful | run 43549652400 on f056d99] Task 5 added a table column without searching the story for positional column reads.** `tests/browser.mjs` read the Cleared cell as `td` index 3, so both story legs failed. It's deterministic, but it cost a CI round.
- 🟡 **[painful | run 43553623422 on 004efe9] A cleanup "fix" made the database job hang for 30 minutes.**
  - The final-review M1 change deleted a staff membership while `people.user_id` still referenced it, which the deferred FK refused. The throw skipped `f.close()`, and the open connections kept `node --test` alive.
  - The scoped re-review was asked about the seed test's FK and caught a related bug, but it didn't review M1 itself.
  - Fixed in fd471a9.
- 🟡 **[painful] The GitHub API rate limit ran out** (5000 per hour) from `gh run watch`'s default 3-second polling across many runs. The rest of the session polled once a minute.
- 📌 **[nit | Task 4, Task 5, final-wave reports] Three implementers wrote code before tests**, so there was no clean RED run. The reviews compensated, but the TDD evidence is thin for the handler's first version, the Roster UI and the final wave.
- 📌 **[nit | verify.md §7] 046 has not run on a populated developer stack.** CI starts empty. The backfill is unit-tested against inserted rows, but it still needs a run on the user's 045 stack.

### Ledger summary (rulings, parked findings, deferred Minors)

**Rulings**, each with its cost if wrong:
1. The baseline Windows `write-test-env` "mode 600" failure is left alone; it predates the change and passes on CI. Cost: a later direct-PR fix.
2. Database and browser tasks were judged on `npm test`, `node --check` and review, with CI as the real gate, because the user ruled out local stack runs. Cost: defects surface late, as they did twice.
3. The Task 1 stub fix waited for Task 2 to commit, to avoid concurrent commits. Cost: one CI round.
4. Prepare takes `p_action_id` and returns `{replay}`. This changed the sign-in delta's RPC signature. Cost: one signature change.
5. Reactivate decides "signed in before" from `accounts.activated_at`. Cost: an auth user reused from elsewhere reactivates as Invited and must sign in once.
6. design.md D3 was updated to match the code (`accountRevision`, no actor on the check, returns `volunteerId`).
7. A replayed create shows "the email wasn't sent. Use Resend". Cost: a slightly misleading line after a lost answer.
8. "Account reactivated. Use Resend to send a sign-in code." kept for reactivate → invited (staff-only English).
9. The final fix wave covered I1, M1, M2 and M4.
10. M5 parked: prepare's replay looks up the receipt by action id alone, and the UI reuses an id only for the same op and target. Cost: a misleading notice for a hand-crafted request.
11. M3 parked: a backfilled, deactivated client's email gets "already invited" while the client is hidden from the panel. Cost: a confusing message in a rare case; goes with client deactivation.
12. M6 parked: the drawer can show "This client is already invited" when stale. Cost: an odd sentence; goes to a later wording pass.
13. The fd471a9 test fixes count as the CI verification loop, not a second review wave.

**Parked or deferred Minors:**
- **Task 1:** no unit test for mail-catcher; `after` timing; non-404 errors fail fast.
- **Task 2:**
  - the person⇔staff check runs only on `accounts` writes, and nothing changes `memberships.access` today;
  - the backfill test's scope;
  - Roster cleared drift until Task 5, which resolved it.
- **Task 3:** the open-work race: claims don't take the workspace advisory lock. The same holds for the 045 save. Follow-up issue.
- **Task 4:** the stack test doesn't compare the first and second codes; cleanup if fixture creation throws.
- **Task 5:**
  - OPEN_WORK through the function path is untested (the function never returns it);
  - no test for the re-read after a refusal sentence;
  - the Deactivate OFFLINE retry path;
  - `app.mjs` dispatch readability;
  - Escape and backdrop on the deactivate dialog (the final review traced `closeDialog`: it is fine).
- **Task 6:**
  - the controller reads the list on `ceilingAdmin` while the view gates on effective admin (harmless);
  - `runClientInvite` parallels `runAccountAction` (about 50 lines, different state slots);
  - the CONFLICT path and the non-admin controller are untested.
- **Task 7:** demo-script line wrapping.

## 3. Plan deviations

| Plan task | What changed | Why |
|-----------|--------------|-----|
| 1.1–1.2 | Added a stub `supabase/functions/accounts/index.ts` (47902a6) | The CLI refuses `[functions.accounts]` with no entry file |
| 2.6 | `vitally_prepare_account` gained `p_action_id` and a replay answer (7e77054) | Task 3 review: a retried function call was refused at prepare |
| 2.8 | The client list leaves out deactivated accounts | The panel shows only Invited/Active |
| 3.1 | The handler verifies the caller with `getUser`; `email_exists` triggers a re-check; malformed actionId gets 400 | Task 4 review and the final review |
| 4.4 | The client list is re-read on focus (cfa89b6) | Task 6 review: stale "Invited" |
| 4.5 / story | `tests/browser.mjs` Cleared column index 3 → 4 (b10c53c) | The new Account column; caught on CI |
| 5.1 | `seedVolunteers` skips seed emails that already have a sign-in (004efe9); the demo script's Roster table corrected (5a0216b) | Final review I1: following the demo once broke the seed re-run |
| — | Invite panel CSS (89438dc) | Story screenshot review |
| Capability name | `sign-in-accounts` instead of `accounts` | Spec naming uses compound names (brainstorm, "Decided without the user" 1) |

## 4. Skill / workflow compliance

| Skill                                            | Used |
|--------------------------------------------------|------|
| superpowers:brainstorming                        | ✓ (verbal brainstorm in the conversation; skill run at propose to record brainstorm.md) |
| superpowers:writing-plans                        | ✓ |
| superpowers:using-git-worktrees                  | ✓ (already in an isolated worktree; detected, not created) |
| superpowers:subagent-driven-development          | ✓ |
| (transitive) superpowers:test-driven-development | ✓ (partly: see §2, three tasks without a clean RED run) |
| (transitive) superpowers:requesting-code-review  | ✓ (per-task reviews, whole-branch review, scoped re-reviews) |
| superpowers:finishing-a-development-branch       | ✓ (step 9, after archive) |

### Deliberately Skipped Skills

None skipped. Two sub-steps were shortened:
- **Two scoped re-reviews were replaced by the controller reading the diff** (b35d2b6, a one-character change; b10c53c, four lines). Why: the diff was smaller than a re-review brief. Prevention: scope-judgment rule — a controller check is fine for a diff under about 5 lines, and every such check is ledgered.
- **The brainstorming skill's builder check was not dispatched.** Why: CLAUDE.md step 2 settles the design verbally, and brainstorm.md records an approved design. Prevention: one-off — schema boundary case. The bridge's propose step records rather than re-designs.

## 5. Surprises

- **The Supabase CLI refuses to start when a `[functions.<name>]` block has no entry file**, even with the edge runtime otherwise fine.
- **Volunteers added on the Roster have an empty capability ceiling**, so Create account alone would have produced cleared volunteers who could do nothing. This was raised during propose and decided by the user as option A.
- **Deleting a membership while `people.user_id` references it fails at commit** (deferred FK). A test that throws in `finally` before `f.close()` hangs `node --test` until the job's timeout, not failing fast.
- **The browser story reads table cells by position**, so any new column shifts it.

## 6. Promote candidates → long-term learning

- [ ] 🟡 **When adding a table column, grep the browser story for positional cell reads first** → **Promote to memory** (type: feedback)
  > **Why**: b10c53c. The new Account column shifted `td` index 3 and failed both story legs on CI.
  > **How to apply**: any change to a staff table's columns (volunteer-views, office-views, pool-views). Search tests/browser.mjs for `nth(` and `querySelectorAll("td")[` in the brief.

- [ ] 🟡 **Implementer briefs must forbid programmatic `String.replace` on files containing `$$`** (SQL dollar quotes) → **Promote to memory** (type: feedback, alongside the no-hang brief rules)
  > **Why**: 7e77054 broke 046's parse; `$$` in a replacement string becomes `$`.
  > **How to apply**: every implementer brief that touches `supabase/migrations/*.sql`: use the Edit tool or a replacer function.

- [ ] 🟡 **Poll CI with `gh run watch --interval 60`, never the default** → **Promote to memory** (type: feedback)
  > **Why**: about ten runs watched at the default 3 s exhausted the 5000-per-hour API limit mid-session.
  > **How to apply**: any CI loop in this repo; one-minute polling, or `gh run view` in a sleep-60 loop.

- [ ] 🟡 **Database test cleanup: close the fixture first, in a finally a cleanup error can't skip; delete memberships before auth users** → **Promote to memory** (type: feedback, beside "Tests stay in their own workspace")
  > **Why**: run 43553623422 hung 30 minutes after a cleanup throw skipped `f.close()`.
  > **How to apply**: any DB or browser test that creates auth users or memberships outside the fixture's tracking (Edge Function tests, invite flows).

- [ ] 📌 **Before merging 046, run `db:migrate:test` and `test:database` on the user's 045 stack** → **One-off** (PR checklist item)
  > **Why**: CI starts empty; CLAUDE.md requires a populated-stack run for migrations that change existing rows.
  > **How to apply**: the user runs it on their local stack (backup exists) before merging this PR.

- [ ] 📌 **Follow-ups to file:** the open-work race (claims vs the workspace lock); client deactivation, including M3's backfilled deactivated clients; a custom invitation email template; hosted SMTP and function deployment before December → **One-off** (issues)
  > **Why**: parked or out of scope in this change.
  > **How to apply**: file them when the PR opens, linked from the PR body.
