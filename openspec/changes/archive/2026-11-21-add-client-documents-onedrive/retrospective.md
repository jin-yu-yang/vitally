# Retrospective: add-client-documents-onedrive

> Written: 2026-11-21, after archive, at Zeye's request on PR #245
> Commit range: `4977ad9`…HEAD of PR #245
> Worktree: none (built on the branch `issue-157-onedrive-documents`)

---

## 0. Evidence

- **Commits**: ManQi `4977ad9` (the workflow) and `042e587` (migration and test conflicts). Then Claude Code, at Hailey's request: `2e9c49e` (renumbered to 056, counts, archive), `7fc062f` (task ticks), `9e6489b` (Zeye's second review), `7f1bf72` and `2eaa02a` (7.1 review, card styling), plus the commit with this file (Zeye's non-blocking points). Merges of `main` in between.
- **Diff size** against `601b650` before this commit: 46 files, +1483 / −240.
- **Tasks done**: 41/41.
- **New external dependencies**: none. No Microsoft API; ViTally stores no files.
- **Migration**: `056_onedrive_client_documents.sql`. It started as 053, then became 055, then 056 as #243, #244 and #255 merged first.
- **OpenSpec validate at archive**: pass (22/22).
- **Tests added**:
  - database: the link check on both client paths, card undo, `reported_at`;
  - unit: buttons, file-name hint, link reads in client and staff windows;
  - browser: the story's "the client reports a OneDrive upload" phase.
- **Bugs after merge**: none yet (not merged).

## 1. Wins

- [evidence: `act_set_document_card`, `receive_document`] The split between a client's *report* (`sent`, `awaiting_verification`) and staff's *confirmation* (`received`, `verified`, `VERIFY_DOCUMENT`) is enforced in the database. Zeye checked it on a scratch database in each review.
- [evidence: Zeye's comment of Nov 21, 21:33] `check_payload` was copied from 054's version rather than 046's, so Return to signing with remarks kept working.
- [evidence: `tests/database-documents.mjs`] Each review point got a database test that drives the real RPCs.

## 2. Misses

- 🟡 [painful | evidence: PR #245 history] The migration number changed three times. Each rename touched docs, counts and `rpc-signatures.mjs`.
- 🟡 [painful | evidence: no `brainstorm.md` / `plan.md`] The change was built before its OpenSpec artifacts. So the design questions (staff folder link, undo, file naming, link reads) came up in review, after the code was written.
- 🟡 [painful | evidence: Nov 21 evening] The cloud session read only GitHub's review API, which was empty, and said the PR could be merged safely. Zeye's points were in ordinary PR comments.
- 📌 [nit | evidence: `7f1bf72` → `2eaa02a`] A commit was pushed before its unit run finished. The comment "#157" in the 4b2 CSS block was read as a colour by `tests/shell.test.mjs`.
- 📌 [nit | evidence: `7f1bf72`] The new card statuses shipped without pill styles. Nothing caught it until the cards were rendered and looked at.

## 3. Plan deviations

No `plan.md`. Changes made after the first implementation:

| Area | What changed | Why |
|---|---|---|
| Request path | Client `RESPOND_DOCUMENT` needs the link | Matches the card path (Zeye) |
| Staff screens | "Open upload folder" removed; staff windows don't read the link | The link is an upload-only file request (Hailey) |
| Undo | Staff: Undo received / Undo verified. Client: can take back `sent` until staff confirm. Staff `sent` needs no link | Mis-clicks (Zeye, Hailey) |
| File name | `VT-…` reference only | Client numbers change at submit and restart each season (Hailey) |
| Report date | New `reported_at` column | `changed_at` moves on every mark, so an undo showed the undo's time (Zeye) |
| Link reads | Load and wake only | One extra RPC per realtime refresh (Zeye) |

## 4. Skill / workflow compliance

| Skill | Used |
|---|---|
| superpowers:brainstorming | ✗ |
| superpowers:writing-plans | ✗ |
| superpowers:using-git-worktrees | ✗ |
| superpowers:subagent-driven-development | ✗ |
| (transitive) superpowers:test-driven-development | partly (review-round tests were checked to fail without their fix) |
| (transitive) superpowers:requesting-code-review | ✓ (Zeye, three rounds) |
| superpowers:finishing-a-development-branch | ✗ (PR opened by hand) |

### Deliberately Skipped Skills

- **brainstorming, writing-plans, using-git-worktrees, subagent-driven-development, finishing-a-development-branch**
  - **What was skipped**: the whole propose / apply cycle. The code came first; proposal, design, specs and tasks were written afterwards.
  - **Why this cycle**: the branch started on Nov 20 outside the workflow, in parallel with #243 and #244. The cloud session that finished it worked on someone else's open PR, where re-running propose and apply would have meant rebuilding finished work.
  - **How to prevent recurrence**: `CLAUDE.md trigger`. Section 1 already calls a database schema change an OpenSpec change. Add a line that a feature PR is opened only after `/opsx:propose`, and that a reviewer asks for the change folder when a PR arrives without one.

## 5. Surprises

- An upload-only OneDrive file request can't show staff anything, so a staff "folder" link built from it was useless.
- The client number is a poor file-name key: it doesn't exist before submit and restarts each season (after #255).
- GitHub's review API was empty although the PR had two rounds of review in ordinary comments.

## 6. Promote candidates → long-term learning

- [ ] 🔴 **Before saying a PR is safe to merge, read its issue comments as well as its reviews** → **Promote to memory** (type: feedback)
  > **Why**: on #245 the reviews endpoint was empty, but Zeye's two rounds of points were in ordinary comments.
  > **How to apply**: any "can this merge?" question. Read `issues/<n>/comments`, `pulls/<n>/reviews` and `pulls/<n>/comments`.
- [ ] 🟡 **New UI states need a look by eye even when CI is green** → **Promote to project CLAUDE.md** (Verification)
  > **Why**: sent / received / verified had no style, and no test checks that.
  > **How to apply**: when the story's screenshots can't be reviewed, render the changed views (Chrome is available in the cloud sandbox) and look at them.
- [ ] 📌 **Don't write "#<number>" in the 4b2 CSS block** → **One-off**
  > **Why**: its test reads any `#` followed by three to eight hex digits as a colour.
