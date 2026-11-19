# Retrospective: send-invitation-emails

> Written: 2026-11-18 (after verify passed with warnings)
> Commit range: `9267b3e..7e1d26e` (before archive)
> Worktree: `D:/dev/vitally-219`, branch `send-invitation-emails`

---

## 0. Evidence

- **Commit range**: `9267b3e..7e1d26e` (22 branch commits plus the merge of `origin/main` `4a48862`)
- **Diff size**: +2102 / −111 lines across 28 files. Outside `openspec/changes/`: +897 / −111 across 20 files.
- **Tasks done**: 20/20 (`tasks.md`)
- **Active hours**: about 7 h wall clock on 2026-11-18, brainstorm to verify, including roughly 1 h waiting for Docker and about 50 min for CI
- **Subagent dispatches**: 19
  - 8 implementers: Tasks 1–7 and the final fix wave;
  - 1 resumed fix round (Task 3);
  - 10 reviewers: 7 task reviews, 1 scoped re-review (Task 3), the final whole-branch review (opus), and 1 scoped re-review of the fix wave.
- **New external dependencies**: none in `package.json`. New runtime service: Resend's HTTP API on the hosted project. Locally, the change uses Mailpit's send API (Mailpit v1.30.2, which ships with Supabase CLI 2.117.0).
- **Bugs encountered post-merge**: not merged yet
- **OpenSpec validate state at archive**: pass (19/19 before archive; re-checked after archive)
- **Test coverage signal**:
  - `npm test`: 1980 → 2019 tests (2018 pass; the 1 failure is pre-existing on `main`, see §2);
  - `test:database`: 709/709;
  - `test:auth-browser`: 28/28 (28 before, 28 after);
  - CI run [44453890339](https://github.com/jin-yu-yang/vitally/actions/runs/44453890339): checks, database, sign-in and both story legs green on the first attempt.

Commit chain (in order):

```
0513d29 OpenSpec change send-invitation-emails: planning artifacts (#219)
9d7f24b safety line speaks for ViTally only; replies risk
4db5e2c Accounts function: invitation email text with no code            (Task 2)
ae78d69 Resend and mail-catcher senders, exactly one configured          (Task 3)
fc2b5c5 a 2xx counts as sent; narrow the sender guard                    (Task 3 fix, R4/R5)
81dfabf send the invitation email instead of a sign-in code              (Task 4)
8505f62 Roster and office panel: say invitation, not sign-in code        (Task 5)
091c45b Docs: invitation email, hosted secrets and shared quota          (Task 7)
ae9b6ac Docs: the Resend action, not the service, sends no key           (Task 7 polish)
ebc00e7 Test stack: pass the mail catcher and site URL                   (Task 1)
91394bc Tests: read the invitation, then sign in with a requested code   (Task 6)
9d0df05 refuse non-http(s) URLs at startup, pin timeout, test/docs fixes (final-review fix wave)
4ea6af8 Merge origin/main
29f90cd tasks 8.1-8.4 done (CI run 44453890339)
7e1d26e verify.md (PASS WITH WARNINGS)
(+ tasks.md tick commits e558e41 8d291e5 f8c20c4 592105e 4ab4d3b f0bd96a ec27d8b)
```

---

## 1. Wins

- [evidence: `invitation-email.mjs`, `sender.mjs`, `handler.mjs`]
  - The split into email text, sender and handler, with only `index.ts` touching Deno, kept every piece testable under Node.
  - The final reviewer called "no code can be emailed, by construction" a strength: the template takes no address, name or code.
- [evidence: Task 1 report; CI `database`/`sign-in` success]
  - Making the "edge runtime reaches Mailpit" unknown a task of its own, with an SMTP fallback, paid off: option (a) worked the first time.
  - CI then proved it on Linux with no change, so the fallback was never needed.
- [evidence: `tests/support/mail-catcher.mjs`, `tests/database-accounts-function.mjs`]
  - The integration tests now follow the real path: invitation, then a requested code, then sign-in.
  - That removed the 61 s cooldown wait.
  - `latestCode` now filters on the subject, which ends an old race where it could read the wrong email.
- [evidence: brainstorm Q7–Q9, design D5]
  - Hailey's review of the planning artifacts caught three things before any code was written: the database time zone assumption, the deploy order, and the copy.
  - The time-zone check (Task 1 Step 6) confirmed UTC instead of leaving it assumed.
- [evidence: R1, ledger] When Docker was down, reordering the tasks (2, 3, 4, 5, 7 first) kept the plan moving without waiting.
- [evidence: final review → `9d0df05`]
  - The whole-branch review on the most capable model found the one real hole the task reviews missed: the guard accepted non-URL values, such as an unexpanded `env(...)` or a site URL without a scheme.
  - Fixed in one wave.

## 2. Misses

- 🟡 [painful | evidence: verify §5]
  - The local `test:browser` run was stopped by Claude Code for low system memory before it printed the failure text.
  - So the Chrome-client / Firefox-staff failure in the seed phase is unexplained.
  - CI passed both orders, and this branch does not touch the seed or the board, but the local evidence is lost.
  - Running the final review (opus) and a fix wave at the same time as a 25-minute Playwright run probably added to the memory pressure.
- 🟡 [painful | evidence: the session's start]
  - Docker Desktop was not running when apply began, and that blocked Task 1, the first task in plan order.
  - The plan's tool check (CLAUDE.md §0) doesn't include "the Docker daemon answers".
- 🟡 [painful | evidence: `tests/write-test-env.test.mjs`]
  - One unit test fails on Windows on `main` as well: `TEST_ENV_INVALID`, a character in `VITALLY_TARGET_MANIFEST`.
  - Every report had to explain it.
  - Parked: pre-existing and unrelated, but it should get its own issue.
- 📌 [nit | evidence: task reviews] Each review raised Minor findings that were deferred. The final review sorted them: 7 fixed in the wave, the rest stay deferred. The deferred ones are listed in the ledger summary below.
- 📌 [nit | evidence: `8505f62`] The Task 5 implementer (Haiku) signed its commit as `Claude Haiku 5.5`, not the session's attribution line. That is accurate for that commit, but it is inconsistent with the others.
- 📌 [nit | evidence: final-fix report] For I1, M3 and M7 the fixer wrote the tests together with the code, so no failing (RED) run was seen. The re-review confirmed by reading that each test would fail without its change.

## 3. Plan deviations

| Plan task | What changed | Why |
|-----------|--------------|-----|
| Order 1→8 | Ran 2, 3, 4, 5, 7, then 1, 6, 8 | Docker was down at the start (R1). Task 1 only gated Task 3's catcher branch and Task 6. |
| 1 Step 6 | `show timezone` through Node's `pg`, not `psql` | `psql` isn't installed (R3) |
| 1 Step 7 | Probe stack kept, not deleted | Tasks 6 and 8 needed a stack with the new config (R7). It is to be deleted at the end (see follow-ups). |
| 3 | A 2xx counts as sent whatever the body; Deno type narrowing in `index.ts` | Spec says "true when the sender accepts" (R4); the deploy may type-check (R5) |
| 5 | Also updated exact-text waits in `tests/auth-browser.mjs` | So Task 6 started from consistent wording (R6) |
| 8.3 | Story verified by CI run 44453890339, not locally | The local run was stopped for low memory; Hailey chose "push and use CI" |
| (extra) | Final-review fix wave `9d0df05`: URL validation in the guard, `$GITHUB_ENV` in CI, a pinned timeout, stricter test assertions, and a design.md D3 fix | Final review "With fixes" (R9) |

## 4. Skill / workflow compliance

| Skill                                            | Used |
|--------------------------------------------------|------|
| superpowers:brainstorming                        | ✓ (method in the conversation per CLAUDE.md; skill invoked at propose to record brainstorm.md) |
| superpowers:writing-plans                        | ✓ (plan.md, redirected into the change folder) |
| superpowers:using-git-worktrees                  | ✓ (`D:/dev/vitally-219`, following the existing sibling-worktree pattern) |
| superpowers:subagent-driven-development          | ✓ (ledger, a review per task, final review, one fix wave, scoped re-reviews) |
| (transitive) superpowers:test-driven-development | ✓ for Tasks 2–5. Partly for the fix wave (§2: tests written with the code for I1, M3, M7) |
| (transitive) superpowers:requesting-code-review  | ✓ (code-reviewer.md for the final whole-branch review) |
| superpowers:finishing-a-development-branch       | ✓ at step 9, after archive (CLAUDE.md) |

### Deliberately Skipped Skills

(none) `openspec-verify-change` is not installed. Its checks were run directly as CLAUDE.md step 6 says, so this is not a skip.

## 5. Surprises

- `main` had already moved to `9267b3e` when the branch was cut, so the session-start git snapshot (`cf595f3`) was stale. The merge base was right; only the snapshot was out of date.
- The board screenshot from the failed local story run ("Showing 1 of 11 cases") looked like the failure. CI's passing run shows the same state, so a phase screenshot is not evidence of what failed.
- The final reviewer believed, without checking, that the CLI leaves the literal `env(VAR)` when a variable is unset. Nobody tested this. The fix (URL validation) makes the function refuse either way, so the open question no longer matters.
- Point 3 of Hailey's review assumed that Cancel and Reactivate go through the accounts function. They are database RPCs. Checking the code before writing the risk kept design.md accurate.

## Ledger summary (rulings, parked and deferred findings)

**Rulings** (each with what it costs if wrong):

- **R1:** Docker was down, so Tasks 2, 3, 4, 5 and 7 ran first and the catcher was built over HTTP. Cost if wrong: redo the catcher branch for SMTP. (It wasn't needed.)
- **R2:** accepted the intermediate commit between Task 3 and Task 4 in which `index.ts` no longer passes `anonClient`. Cost if wrong: one broken intermediate commit for anyone bisecting.
- **R3:** the time zone was checked through Node's `pg` because `psql` isn't installed. Cost if wrong: none.
- **R4:** a 2xx with any body counts as sent. Cost if wrong: a proxied empty 2xx would be reported as sent when it wasn't.
- **R5:** the startup check in `index.ts` was narrowed so Deno's type checker accepts it. Cost if wrong: none.
- **R6:** Task 5 also updated the exact-text waits in the browser tests. Cost if wrong: none.
- **R7:** the probe stack lives at `C:/Users/hezal/vitally-stacks/vitally-invite219.RpzaJ2zM` on ports 57321–57326, Hailey's stack is untouched, and the probe stack was kept for Tasks 6 and 8. Cost if wrong: one extra stack's disk until it is deleted.
- **R8:** `.env.test` and `.vitally-targets.json` for the probe stack are written in the worktree only. Cost if wrong: none.
- **R9:** one fix wave covered the final review's Important and "should fix in branch" items. Cost if wrong: one extra review round.
- **R10:** the canonical spec scenarios at `openspec/specs/sign-in-accounts/spec.md:77,81,318` that say "emailed code" were not edited, and the drift is surfaced to Hailey. Cost if wrong: ambiguous wording stays in the canonical spec until a later change.
- **R11:** no two long suites ran at once on one stack. Cost if wrong: none.

**Parked:** the `tests/write-test-env.test.mjs` failure on Windows. It is pre-existing on `main` and unrelated.

**Deferred minor findings** (the final review judged these "stay deferred"):

- invitation-email:
  - the kind lookup happens before the kind is validated;
  - no test that the English time uses plain spaces;
  - no test for a single-digit Chinese hour;
  - an invalid `expiresAt` throws `RangeError`.
- sender:
  - a timeout during the body read is logged as "timeout, status 200";
  - the 2xx path doesn't cancel the unread response body.
- handler tests: the invite and resend tests don't assert the expiry text.
- volunteer-views test: a stray comma, and an unescaped `.` in the regex.
- docs:
  - the hosted check could say a volunteer needs a roster entry;
  - the demo script has a long line;
  - section 6 is still titled "(pending)" (predates this change).
- `$VITALLY_INSTANCE` wording in the docs.
- `SITE_URL` is hard-coded in two test files.
- The `parseNewYorkTime` fall-back hour is now commented, but not changed.

**Fixed in the wave** (no longer deferred):
- Six-digit test: fixed dates instead of random ones.
- Reactivate wording: now has a test.
- `auth-browser` expiry query: now filters on the workspace.
- `parseNewYorkTime`: the fall-back hour is commented.
- The comment that `vitally-ci` must match the CI `sed`.
- The setup.md note on a forgotten export.
- The HTML `href` check and the no-address check in `assertInvitation`.

**Follow-ups:**

- **Post-merge hosted end-to-end check**, with Hailey:
  - check the time zone is UTC;
  - create the send-only key;
  - set `RESEND_API_KEY` and `VITALLY_SITE_URL`, then redeploy;
  - send one client invitation and one volunteer invitation.
  - This is the only check of Resend delivery and the govitally.org link.
- **Delete the probe stack** `vitally-invite219.RpzaJ2zM` after the PR merges, once it isn't needed for review reruns.
- **Open an issue** for the Windows `write-test-env` failure.
- **Decide on the "emailed code" wording** in the canonical sign-in-accounts scenarios (R10).
- **Open questions** carried from the design:
  - 繁體 in the client email (Hailey, with PCDC);
  - whether the safety line may also speak for PCDC (Hailey, with PCDC).

## 6. Promote candidates → long-term learning

- [ ] 🟡 **Check that the Docker daemon answers before apply starts, not just that `docker` is on PATH.** → **Promote to** project CLAUDE.md (§0, "Check the tools first")
  > **Why**: In this cycle `docker` was installed but Docker Desktop was stopped, so Task 1 (plan order) was blocked and the plan had to be reordered.
  > **How to apply**: At apply pre-flight, run `docker info` with a timeout; if it fails, say so before creating the worktree.

- [ ] 🟡 **Don't run a long local Playwright story at the same time as other heavy agents.** → **Promote to** memory (type: feedback)
  > **Why**: Claude Code stopped the local `test:browser` run for low memory while an opus final review and a fix wave were running, and the failure text was lost.
  > **How to apply**: When `test:browser` runs locally, keep other subagent work light until it finishes, or use the PR's CI story run instead.

- [ ] 📌 **A phase screenshot is not evidence of what failed.** → **Promote to** memory (extend `read-evidence-before-reruns`)
  > **Why**: The local failure screenshot looked like a failed assertion, but CI's passing run shows the same board.
  > **How to apply**: For a story failure, read the test runner's failure text and `evidence.failedPhase`. Compare a screenshot only against a passing run's screenshot of the same phase.

- [ ] 📌 **A startup check should check shape (a valid http(s) URL), not just presence.** → **One-off** (recorded in design via the fix wave)
  > **Why**: The task reviews passed a guard that accepted an unexpanded `env(...)`. Only the whole-branch review caught it.
  > **How to apply**: When a plan specifies "exactly one of / required" environment checks, the brief should also say what value shape is acceptable.
