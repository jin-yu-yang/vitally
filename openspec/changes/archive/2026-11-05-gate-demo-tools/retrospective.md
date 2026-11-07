# Retrospective: gate-demo-tools

> Written: 2026-11-05 (after verify passed with warnings)
> Commit range: `9712a3a..5d7b1a0`, before archive
> Worktree: `.claude/worktrees/gate-demo-tools`

---

## 0. Evidence

- **Commit range:** `9712a3a..5d7b1a0`, 10 commits: 1 plan, 6 task, 1 issue link, 1 final-review fix wave, 1 verify.
- **Diff size:** +965 / −61 lines across 33 files, planning artifacts included.
- **Tasks done:** 17 of 17 in `tasks.md`.
- **Active hours:** about 4, spread over one evening, with browser runs waiting on others.
- **Subagent dispatches:** about 13. That's 5 implementers, 5 task reviews, 1 final whole-branch review, 1 fix wave and 1 scoped re-review. Task 3's ruling was applied by resuming its implementer.
- **New external dependencies:** none.
- **Bugs found after merge:** none yet; not merged.
- **OpenSpec validate state:** `openspec validate --all` 11 of 11 before archive.
- **Test signal:**
  - `npm test` went from 1489 to 1499 tests, all passing.
  - `npm run test:browser` passed 81 of 81 in one run alone on `d05a1fd`.

Commit chain:

```
a8914e0 Plan OpenSpec change gate-demo-tools
4250884 Demo tools: loopback helper and the demoTools key in the public config
7980dd0 Demo tools: the browser's switch, in controller state
9e8d654 Demo tools: the three fill controls render from the switch
3b6e7c0 Demo tools: the presenter panel's fill button follows the switch
96ff98d Demo tools: fill handlers do nothing without the switch
0fa8580 gate-demo-tools: link issue #133
5fe62fd Demo tools: committed-config guard, browser fixture and docs
d05a1fd Demo tools: final-review fixes (developer guide, setup, staff-case-work title)
5d7b1a0 Demo tools: tasks done, verification report
```

---

## 1. Wins

- **One shared helper.** `isLoopbackUrl` in `src/loopback.mjs` (4250884) is used by the server, the browser (`demoToolsFromConfig`) and the browser fixture's refusal. There's one place to get it wrong instead of three.
- **The opt-in can't be turned on by accident.** With the flag and a hosted URL, the served config stays at four keys and prints the warning; this was checked against a running `server.mjs` during verify.
- **The task reviews caught a gap the plan had missed.** Task 3's implementer flagged the presenter panel's own fill button (`src/presenter-views.mjs`), and it was gated in 3b6e7c0 before anyone shipped a fourth, ungated placement.
- **The final review caught three wrong statements that no test checks:** two doc lines and a canonical spec title. They were fixed in one wave (d05a1fd).

## 2. Misses

- 🟡 **The browser suite could not be judged at first.** The first gate run overlapped another branch's run on the same local stack, so its result meant nothing. Three quiet runs one at a time were needed, which cost about 1.5 hours of wall clock. They showed that `main` itself can go over the 900-second limit per order (#126).
- 📌 **The plan's inventory left out two files:** `docs/developer/frontend.md`, and the presenter panel as a fourth fill placement. Both were found in review, not in the pre-flight scan.
- 📌 **Task 4.4 was done at the served-config level, not by looking at a screen.** The browser story and unit tests cover what the screen shows (verify §2).

## 3. Plan deviations

| Plan task | What changed | Why |
|---|---|---|
| 1.2 (design D2) | The start-up warning is in `server.mjs`'s direct-run block, not in `createAppServer`. | Ruling at pre-flight: the spec asks for one warning at start-up; this keeps the in-process test servers quiet. Cost if wrong: an embedding caller gets no warning, but still no key. |
| 2.3 | The presenter panel's "Fill fictional details" is gated too (`renderPresenterPanel({ demoTools })`). | Ruling in Task 3: the spec says no fill control is shown to anyone without the switch, and that includes presenters. |
| 3.3 / 3.4 | The fix wave also corrected `docs/developer/frontend.md` (rows at about 147–148) and step 5 of `docs/setup.md`. | Final-review ruling: they described the shipped behaviour wrongly. |
| (none) | A RENAMED delta was added to `staff-case-work`: "…no persona picker or demo tools" becomes "…no persona picker or presenter controls". | Final-review ruling: after archive, the old title would read as contradicting `demo-tools`. The body is unchanged. Surfaced to the user. |

Minor review findings, all deferred and triaged "leave" by the final review:
- `server.mjs` comment not re-wrapped;
- the flag is not tested through the served `/public-config.json` route; verify covered it by hand;
- the controller re-applies `=== true`;
- one test is placed above a banner;
- a long ternary in `client-views.mjs`;
- only the preparer form has its own switch test;
- a redundant overlapping pill test in `tests/presenter.test.mjs`;
- the handler test is a source-text check and fragile to reordering;
- the config scan is a substring match, depends on the working directory and throws on a tracked-but-deleted file;
- the §6 note sits under a "(pending)" heading;
- long lines in `docs/setup.md` and a `frontend.md` table row.

## 4. Skill / workflow compliance

| Skill | Used |
|---|---|
| superpowers:brainstorming | ✓ (brainstorm.md) |
| superpowers:writing-plans | ✓ (plan.md) |
| superpowers:using-git-worktrees | ✓ (`.claude/worktrees/gate-demo-tools`) |
| superpowers:subagent-driven-development | ✓ (ledger, task reviews, final review) |
| (transitive) superpowers:test-driven-development | ✓ (each task wrote failing tests first) |
| (transitive) superpowers:requesting-code-review | ✓ (per-task and whole-branch reviews) |
| superpowers:finishing-a-development-branch | ✓ (push and PR, after archive) |

### Deliberately Skipped Skills

(none)

## 5. Surprises

- **`assertTestTarget` alone doesn't mean "local".** It also accepts a hosted test project, so the fixture needed its own loopback refusal.
- **The browser story runs close to its 900-second budget per order on `main`.** One order ran past it with every phase passing, so a failure there can be timing, not behaviour.
- **Two browser runs on one local stack make both results meaningless.**

## 6. Promote candidates → long-term learning

- [ ] 🟡 **Run `npm run test:browser` alone on the local stack, never alongside another branch's run.** → **Promote to memory** (type: feedback; extend `browser-story-run-gap-clue`)
  > **Why:** the overlapping run on this change had to be thrown away, which cost about 1.5 hours of reruns.
  > **How to apply:** before starting a browser run, check that no other `test:browser` is running from another worktree.
- [ ] 📌 **A plan's file inventory should include `grep` for every placement of the control being changed, not only the list from design.** → **One-off** (record only)
  > **Why:** the presenter panel's fill was a fourth placement that the design's list of three missed.
  > **How to apply:** when a change gates or removes a UI control, grep for its action name across `src/` during writing-plans.
