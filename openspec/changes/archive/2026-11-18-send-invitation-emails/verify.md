# Verification Report

**Change**: `send-invitation-emails`
**Verified at**: `2026-11-18`
**Verifier**: Claude (controller of the subagent-driven apply), checks run directly because `openspec-verify-change` is not installed (CLAUDE.md, lifecycle step 6)

---

## 1. Structural Validation (`openspec validate --all --json`)

- [x] All items `"valid": true`

**Result**:

```text
totals: items 19, passed 19, failed 0
byType: change 1/1, spec 18/18
```

Warnings only (not failures): three of this change's ADDED requirements in `specs/sign-in-accounts/spec.md` are over 500 characters. The canonical spec already carries the same warning.

| Item | Type | Issues |
|---|---|---|
| — | — | none |

---

## 2. Task Completion (`tasks.md`)

- [x] Every `- [ ]` is now `- [x]` (20 of 20)

**Open tasks**: none.

| Task | Why open | Blocks archive |
|---|---|---|
| — | — | — |

---

## 3. Delta Spec Sync State

| Capability | Sync state | Notes |
|---|---|---|
| `sign-in-accounts` | ✗ Needs sync | Expected before archive. The branch does not touch `openspec/specs/`. Archive (step 8) merges the delta: 4 ADDED, 3 MODIFIED, 1 RENAMED. `/opsx:sync` was deliberately not run (CLAUDE.md §4). |

---

## 4. Design / Specs Coherence Spot Check

| Sample | design | specs | Gap |
|---|---|---|---|
| Sender choice | D1/D2: Resend HTTP API hosted, Mailpit HTTP API locally; exactly one of `RESEND_API_KEY` / `VITALLY_MAIL_CATCHER_URL`, plus `VITALLY_SITE_URL` | "The accounts function sends through exactly one configured sender" | None. The implementation goes further: it also refuses values that are not http(s) URLs, which the final review asked for (Ruling R9). This is stricter than the spec's "set", and consistent with "SERVER_ERROR before anything is created". |
| Send result | D6: 2xx and `409 invalid_idempotent_request` mean sent; `409 concurrent_idempotent_requests`, other errors and a timeout mean not sent | "The answer says whether the invitation email was sent" | None. |
| Email content | D3/D4/D5: no code, no six-digit run, no address, link from `VITALLY_SITE_URL`, expiry in New York time; client email English + 简体, volunteer email English | "The invitation email has no code…", "A client's invitation is in English and 简体…" | None. D3's signature was corrected to `invitationEmail({ kind, siteUrl, expiresAt })` in the fix wave. |
| Staff wording | D7 | MODIFIED Create account / Resend / Invite requirements | None. The cancel-dialog wording is in D7 but not in the spec. That is intentional: it is staff text the spec never pinned. |

**Drift warnings** (non-blocking):

- **Canonical scenarios not touched by this change.** `openspec/specs/sign-in-accounts/spec.md` lines 77, 81 and 318 still say "signs in with their emailed code". They remain literally true, since the code is emailed when the person asks for it on the sign-in screen, but they now read ambiguously. Per CLAUDE.md this was surfaced, not silently edited (Ruling R10). Rewording them is for Hailey to decide.

---

## 5. Implementation Signal

- [x] The worktree has no unstaged or untracked files (`git status --short` is empty; `.env.test`, `.vitally-targets.json` and `.superpowers/` are git-ignored).
- [x] Code commits are pushed. `origin/send-invitation-emails` is at `4ea6af8`, the commit CI verified. The bookkeeping commit `29f90cd` (tasks.md ticks) and this report are pushed with the archive.

**Commit range**: `9267b3e..29f90cd` (merge base with main to head; 21 commits, including the merge of `origin/main` `4a48862`, a docs-only change).

**Checks run** (CLAUDE.md "Verification"):

| Check | Why | Result |
|---|---|---|
| `npm test` | always | 2018 pass, 1 fail. The failure is `tests/write-test-env.test.mjs` "both files are written with mode 600…" (`TEST_ENV_INVALID`, Windows path in `VITALLY_TARGET_MANIFEST`). It fails identically on `main` in the main checkout, so it is pre-existing and unrelated. CI `checks` (Linux) passed. |
| Edge Function unit tests | function change | Included in `npm test`: `tests/accounts-function.test.mjs`, `tests/accounts-sender.test.mjs`, `tests/invitation-email.test.mjs`. All pass. |
| `npm run test:database` | the accounts function's database integration test | Local isolated stack `vitally-invite219.RpzaJ2zM`, after the fix wave: 709/709. CI `database`: success. |
| `npm run test:auth-browser` | sign-in / invitation flows | Local, after the fix wave: 28/28. CI `sign-in`: success. |
| `npm run test:browser` | `src/controller.mjs` and `src/volunteer-views.mjs` changed (staff wording) | CI run [44453890339](https://github.com/jin-yu-yang/vitally/actions/runs/44453890339) on `4ea6af8`: `story (chrome-client)` and `story (firefox-client)` both passed, with no re-runs. Screenshots reviewed from the run's artifacts: staff board, 简体 client progress, office pool. See the note below on the earlier local run. |
| `npx openspec validate --all` | always in CI | 19/19. CI `checks`: success. |
| `npm run build:hant -- --check` | not needed: no 简体 text in `src/` changed (the email's 简体 lives in the function). CI `checks` ran it anyway and passed. | — |
| `npm run db:migrate:test` | not needed: no migration, RPC, RLS or realtime change | — |

CI run [44453890339](https://github.com/jin-yu-yang/vitally/actions/runs/44453890339) (workflow_dispatch on `send-invitation-emails`, head `4ea6af8`): `checks`, `database`, `sign-in`, `story (chrome-client)` and `story (firefox-client)` all succeeded on the first attempt. The local and CI runs cover the database, sign-in and story checks, as CLAUDE.md allows.

**Earlier local story run (recorded, not relied on).** The local `npm run test:browser` on `ec27d8b` (before the fix wave) reached these results:
- The Firefox client / Chrome staff order passed every phase it reached.
- The Chrome client / Firefox staff order failed in "the seed builds its eleven cases in the story's workspace" (55.7 s), with no console or page errors recorded.
- Claude Code then stopped the run for low system memory, before the test runner printed the failure text, so the assertion that failed is unknown.

CI's passing run shows the same board state in its screenshot ("Showing 1 of 11 cases"), so the screenshot does not show the failure. This branch does not touch the seed or the board: in `src/controller.mjs` it changes only invitation notice strings. The same order then passed on CI. The failure was not re-run locally.

**Local mail path and time zone (Task 1)**:
- The edge runtime reaches Mailpit at `http://supabase_inbucket_<project_id>:8025`, through `[edge_runtime.secrets]` with `env(VITALLY_MAIL_CATCHER_URL)`. This is proven locally, and on Linux by CI's `database` and `sign-in` jobs.
- The database session time zone is `UTC` for both `postgres` and `authenticator` on the local stack.
- The hosted time zone is a post-merge deploy step (design, Migration Plan step 1).

---

## 6. Front-Door Routing Leak Detector (warning, non-blocking)

```bash
ls docs/superpowers/specs/*.md   # 8 files
```

- [x] The 8 existing files are historical design documents from parts 1–4d, which predate this schema. This branch adds or changes nothing under `docs/superpowers/` (`git diff --name-only 9267b3e..HEAD -- docs/superpowers/` is empty).

| File | Captured in change | Action |
|---|---|---|
| — | — | none (historical; CLAUDE.md says leave them) |

---

## 7. Deferred Manual Dogfood vs Automated Test Equivalence

`plan.md` has no `[~]` rows. The section is empty, which counts as a pass.

The one manual check the change asks for is outside `plan.md`: the post-merge end-to-end check on the hosted test environment. It is done together with Hailey and has these steps:
- check the time zone;
- set the secrets, then redeploy;
- send one client and one volunteer invitation to Hailey's address.

Its automated equivalent locally is `tests/database-accounts-function.mjs` with `tests/auth-browser.mjs`, which cover a real email to the catcher, the expiry against `expires_at`, no code, the link, and sign-in with a requested code. What only the hosted check can prove is Resend delivery, the govitally.org link, and the hosted secrets and time zone. That is a real environment gap and is recorded as a follow-up in the retrospective.

---

## Overall Decision

- [ ] ✅ PASS
- [x] ⚠️ PASS WITH WARNINGS. Archive and finishing can go ahead. Warnings:
  - canonical scenarios still say "emailed code" (§4; Hailey to decide);
  - the local story failure went unexplained because the run was stopped (§5; CI passed both orders);
  - one test fails on Windows and also on `main` (`write-test-env`);
  - the hosted end-to-end check is still to do after merge (§7).
- [ ] ❌ FAIL

**Next**: retrospective (step 7), then merge `main`, archive (step 8), and open the PR (step 9).
