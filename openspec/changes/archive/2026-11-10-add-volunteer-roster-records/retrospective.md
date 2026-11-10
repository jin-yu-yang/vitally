# Retrospective: add-volunteer-roster-records

> Written: 2026-11-10 (after verify passed with warnings; task 5.2 still open, see §2)
> Commit range: `f2547a6..35a73fa` (`main` to the branch head)
> Worktree: `.claude/worktrees/add-volunteer-roster-records`
>
> **Update 2026-11-10**: §0's "16 of 17" and §2's first miss are superseded by `verify.md` §2. Task 5.2 was done after #184 and #185 merged and `main` was merged in (`b7a6f24`), with 4 of 4 `story (chrome-client)` passes. The app defect behind it is #186.

---

## 0. Evidence

- **Commit range**: 12 commits beyond `main` (`f2547a6`), from `33b5de2` (plan) to `35a73fa`.
- **Diff size**: 44 files, +4042 / −47 against `main`. Of that, `src`, `tools`, `tests` and `supabase` are 30 files, +2921 / −38.
- **Tasks done**: 16 of 17. 5.2 (all checks) waits on #183; see §2.
- **Active hours**: not measured. Brainstorm, propose and apply ran on 2026-11-09, and verification on 2026-11-10. The CI investigation of the browser story took most of 2026-11-10.
- **Subagent dispatches**: about 22:
  - 9 implementers (Task 1 twice);
  - 8 task reviews;
  - 1 final whole-branch review;
  - 1 fix-wave implementer and 1 re-review;
  - 1 focused security review of D2/D3 before apply;
  - 1 fix agent for #183, separate from this change.
- **New external dependencies**: none.
- **Bugs encountered post-merge**: not applicable yet.
- **OpenSpec validate state at archive**: passes, 13 of 13.
- **Test coverage signal** (each runner's `ℹ tests`, CI):
  - unit 1515 on `main` → 1565;
  - database 450 → 479;
  - sign-in 20 → 20;
  - browser, per CI leg, 42 → 43 (the new Roster test; no story phase added or removed).

Commit chain:

```
33b5de2 Plan the volunteer roster records change (OpenSpec change add-volunteer-roster-records)
fa740d3 Roster records: tables, admin-only access, save RPC, roster linking
a296410 Roster: combine, filter and validate volunteers
dd1cc1e Store: read and save volunteers
c91385a Roster screen: list state, page and drawer
2a4c366 Roster screen: navigation, search, drawer wiring and styles
b17e9df Local seed: add fictional volunteers for the Roster
93a7d09 Browser test: an admin works the Roster
524bfbd Docs: migration 044 and the Roster tables
e7a0b4d Tick the completed tasks of add-volunteer-roster-records
101b840 Docs and comments: the Roster screen, its modules and the seventh RPC
35a73fa Browser test: run the Roster test after both story orders
```

---

## 1. Wins

- **A deliberate departure from the agreed model, recorded before any code** (`design.md` D1). New fields went into an admin-only `volunteer_profiles` table rather than onto `people`. Row-level security can't hide columns, and `people` streams whole rows to every staff browser. The user agreed in the brainstorm and updates the decisions doc.
- **The D2 hardening the user asked for is pinned by tests.**
  - `vitally_policy.is_workspace_admin(p_workspace_id)` takes no user id, so it answers only for the caller.
  - It is `security definer`, `stable` and `search_path=''`, with execute granted only to `authenticated`.
  - Catalog checks in `tests/database-catalog.mjs` assert the schema holds exactly that one function with exactly those grants, and that no function in it takes a user id.
- **The independent attacker-style review of D2/D3 found nothing blocking.** Its four points were folded in before apply (`design.md` D4, D5 and the review note):
  - the null-safe admin check;
  - `service_role` revoked, with a privilege test;
  - the workspace advisory lock shared with `add_staff_member`;
  - roster links reported by key, never by address.

  It also listed Realtime row filtering as something it couldn't verify from the repo, so `tests/database-realtime.mjs` now checks that "a volunteer with no sign-in reaches admins only".
- **Every task review approved with no Critical or Important finding.** The final review's one Important (missing docs for `frontend.md` and the developer README) was fixed in `101b840`.
- **The seed was not cut** (`b17e9df`): `seed:local` adds 8 fictional volunteers, so the review has data without hand entry.
- **The browser-story investigation produced durable fixes outside this change:**
  - #183 records every occurrence;
  - #184 records each window's errors when an order stops, and its first real failure showed no window threw;
  - the fix for #183 is in progress.

## 2. Misses

- 🟡 [painful | evidence: `verify.md`, "The browser story"] **Task 5.2 isn't done.** The Chrome client / Firefox staff story order fails intermittently: 1 pass and 6 failures in CI on this branch, against 6 passes and 2 failures on `main`.
  - **The failure:** a press on a Firefox staff page never reaches the app.
  - **What the samples showed:** the throwaway variants didn't isolate a branch cause. A (CSS removed) and B (policy change removed) passed 2 of 2; D (`src/` as on `main`) failed 1 of 1.
  - **The plan from here:** the user ruled to fix #183 first, then merge `main` and run this branch's chrome-client story 4 times.
- 🟡 [painful | evidence: CI runs 42759889786, 42759902144] **The first test-order hypothesis cost a CI round.** Moving the Roster test after both orders (`35a73fa`) was justified, since the final review's only suspect was test order. But the test's cleanup had already been read and leaked nothing, so the move was a long shot. It stays as a precaution.
- 🟡 [painful | evidence: the two cancelled diagnostic runs] **Two CI runs hung 45 minutes** in "Playwright Firefox and its system packages" and were cancelled. Each cost a sample.
- 📌 [nit | evidence: ledger, Task 1] **The plan said the claim refusal was `VT001`**; the real code is `VT006`.
- 📌 [nit | evidence: ledger, Task 7] **The plan's live-redraw trigger was wrong:** a `people` update doesn't redraw a staff window, and a `workspaces` update does.
- 📌 [nit | evidence: ledger, final review] **Task 8 listed only two docs** (`setup.md` and `database.md`), not `frontend.md` and the developer README.
- 📌 [nit | evidence: `docs/developer/README.md:74`] Its pre-existing "the 8 RPCs" line is out of date (the store now calls seven). Left out of scope.
- 📌 [nit | evidence: ledger, Task 1] Ten test workspaces are left on the local stack from failed cleanups during Task 1's foreign-key fix.

## 3. Plan deviations

| Plan task | What changed | Why |
|---|---|---|
| 1.1 | `added_by_person_id` and `confirmed_by_person_id` are deferrable initially deferred | With immediate checks, deleting a workspace failed with 23503 inside its own cascade. |
| 1.5 | "Roles grant nothing" expects `VT006`, not `VT001` | `VT006` (`INELIGIBLE`) is the real claim refusal; the spec says only "refused". |
| 1.4 | `add_staff_member` also bumps the profile's revision on a link | So an open Edit drawer gets a conflict instead of overwriting a link (design D5). |
| 4.2 | The live-redraw check uses an unchanged-value `workspaces` update | A `people` change doesn't redraw a staff window. |
| 4.2 | The Roster test runs after both story orders (`35a73fa`) | A precaution during the #183 investigation. The test leaves nothing behind; the cause is unproven. |
| 5.1 | Docs also in `backend.md`, `frontend.md` and `docs/developer/README.md` | `backend.md` said "Staff are always new people", which became untrue; the final review asked for the other two. |
| 5.2 | Open | See §2. |

## 4. Skill / workflow compliance

| Skill | Used |
|---|---|
| superpowers:brainstorming | ✓ (verbal, then invoked at propose) |
| superpowers:writing-plans | ✓ |
| superpowers:using-git-worktrees | ✓ |
| superpowers:subagent-driven-development | ✓ |
| (transitive) superpowers:test-driven-development | ✓ |
| (transitive) superpowers:requesting-code-review | ✓ (task reviews, the final review and the separate D2/D3 security review) |
| superpowers:finishing-a-development-branch | Not yet. It comes after archive, once 5.2 is done. |

### Deliberately Skipped Skills

None. `openspec-verify-change` isn't installed, so its checks were run directly, as CLAUDE.md says. The skill's helper scripts (`sdd-workspace`, `task-brief`, `review-package`) were refused by the worktree-isolated shell, so the ledger, briefs and review packages were made by hand, with the same contents.

## 5. Surprises

- **Foreign keys to `people` inside a workspace's cascade** had to be deferred, or deleting the workspace failed.
- **Every checkout's `.env.test` pointed at an old OneDrive manifest path.** The target guard refused until this worktree's copy was fixed.
- **The story never calls `seedWorkspace`**, so the seed volunteers aren't in the story. A planned diagnostic (C, "without the seed volunteers") would have tested nothing and was replaced by D.
- **The press failures in #183 happen on `main` too:** 2 failures in 4 runs on 2026-11-10, after 5 of 5 passes earlier. When they recurred, no window had logged an error.
- **CI's per-ref concurrency** means a third dispatch on one branch cancels the queued one. Parallel samples need one throwaway commit that gives each run its own group.

## 6. Promote candidates → long-term learning

- [ ] 🟡 **Before blaming a branch for an intermittent story failure, sample `main` in the same batch.** → **Promote to memory** (type: feedback)
  > **Why**: `main` had passed 5 of 5 earlier, which made the branch look guilty. In a batch run at the same time, `main` failed 2 of 4.
  > **How to apply**: Whenever an intermittent CI failure is compared between a branch and `main`. Start both at the same time, with the same CI trim.

- [ ] 🟡 **For parallel CI samples, use a throwaway commit that runs only the job under test with a per-run concurrency group.** → **Promote to memory** (type: reference)
  > **Why**: `ci.yml`'s `group: ci-${{ github.ref }}` serialises runs on one ref and cancels extra queued ones.
  > **How to apply**: Any time several runs of one CI job are needed together. The trim commit is `b4c6bd6` (on the `diag/main` branch while it exists).

- [ ] 📌 **A diagnostic that removes code should first check the code is on the failing path.** → **One-off**
  > **Why**: Diagnostic C would have been a no-op, because the story calls `seedCases`. A grep caught it before any CI time was spent.

---

## Ledger summary

The subagent ledger (`progress.md`) isn't kept. Everything it recorded:

### Rulings

1. The Windows-only `write-test-env` unit failure is the baseline. It is on `main` and passes on Linux CI.
2. This worktree uses a copy of the local stack's target manifest, with only its own gitignored `.env.test` path fixed. The guard still checks the instance id and ports.
3. The backfill check used a scratch roster with a fresh workspace id and fictional accounts. The user's `.vitally-roster.local.json` was left untouched; it predates the required `defaultFollowup`.
4. `VT006` is accepted as the claim refusal in "roles grant nothing" (spec: "refused").
5. Task 7's browser test also proves drafts don't carry from one volunteer's drawer to the next, and that the Other-language field shows and hides. These were proven only by source-text tests before.
6. The live-redraw check uses an unchanged-value `workspaces` update, because a `people` update never redraws.
7. No local reruns of the story after Task 8. Instead, paired CI runs with a rule fixed in advance, after the user approved the push.
8. The final review's Important 1 (docs), the realtime comment placement and the store's RPC-count comment were fixed in one wave (`101b840`). Minors 2, 3 and 5 were recorded in `verify.md` instead.
9. Final Minor 4 is parked (Try again can disappear after a dismissed load error; opening the Roster again reloads).

### Parked

- **Try again after a dismissed load error** (final Minor 4): the Roster's Try again can disappear. Opening the screen again reloads the list. Costs an admin an extra click after a failed load.

### Deferred minors

- **Task 1:**
  - the new foreign keys are deferrable (recorded in `verify.md`);
  - the plan's `VT001` (corrected);
  - the backfill and the new-person path assume every staff account has an email;
  - the backfill includes inactive staff memberships, which matches D6 but may surprise;
  - 10 leftover test workspaces on the local stack.

  The comment placement in `tests/database-realtime.mjs` was fixed in `101b840`.
- **Task 2:**
  - an over-80-character name says "Enter a name." rather than that it is too long;
  - length limits and fixed-list values are untested in the pure module (the database enforces the values);
  - one many-assertion "problems" test;
  - `roles: undefined` noise in a fixture.
- **Task 3:**
  - the null `current_season` path (empty Roster) is untested;
  - `saveVolunteer` has no `requireStaffAccess` guard, consistent with other writes, since the policies and the RPC enforce access.
- **Task 4:**
  - no view test that a failed list shows the banner's Try again;
  - the controller's unknown-id `NOT_FOUND` save path is untested;
  - the sidebar's Volunteers icon reuses `user`;
  - an extra "Roster" `h2` under the "Volunteers" `h1`.
- **Task 5:**
  - the shell wiring checks match source text and could pass on dead code;
  - the `volunteer-` prefix draft sweep is a convention;
  - `.remote-badge` is a generic class name.
- **Task 6:**
  - no test where a signed-in staff member holds a seed address;
  - the story adds no volunteers by construction only;
  - the seed's delete and adds aren't one transaction (it fails loudly and a re-run recovers).
- **Task 7:**
  - the leftover-draft check covers Add and the same volunteer's Edit, not a different volunteer's Edit;
  - the search wait doesn't prove the last keystroke's redraw (the caret check is still sound);
  - Avery's empty phone depends on fixture data;
  - a dense regex escape;
  - a redundant `otherShown` check.
- **Final review:**
  - Minor 2: a re-save after a lost answer shows a misleading message;
  - Minor 3: Save after a conflict succeeds in the same drawer;
  - Minor 5: the backfill was checked by hand (all in `verify.md`);
  - `docs/developer/README.md:74`'s "8 RPCs" is left out of scope.

---

## Note for Wednesday's review: the local roster is out of date

The main checkout's `.vitally-roster.local.json` lists riley and jordan, has no `defaultFollowup`, and still has `presenters`. `seed:local` needs a roster with the Site Coordinator, Preparer, Reviewer and client A. The review's start steps must therefore include:
- a current roster;
- the corrected `VITALLY_TARGET_MANIFEST` path in that checkout's `.env.test`.

The file was not edited.
