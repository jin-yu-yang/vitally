# Retrospective

**Change**: `fix-exit-form-download-and-layout`
**Written**: 2026-11-26 after Verify passed with warnings

## 0. Evidence

- **Apply range**: `1c7b433..0d3808c` with five commits and 12 files changed, 625 insertions and 259 deletions.
- **Tasks**: 33 of 33. About 45 minutes elapsed through Apply, including browser runs. Nine subagent dispatches covered preparation, implementation and independent reviews.
- **Dependencies**: None added or upgraded. Test setup used the pinned Supabase CLI and both installed browser engines.
- **Verification**: 2,599 of 2,599 pinned unit tests passed. Focused PDF/source and lifecycle checks passed 51 of 51 and 321 of 321. Both complete browser story permutations passed, including native Exit Form downloads. The full browser command reported 97 passes and the reproducible baseline Roster failure detailed below.
- **OpenSpec**: 27 of 27 items validated before archive. The disposable archive rehearsal applied two additions and two removals, preserved all 17 unrelated requirements and validated 26 of 26 canonical specs afterward.
- **Post-merge results**: Pending an eventual PR merge.

```text
9b30f24 Restore the canonical baseline and declare the replacements
a23da7b Correct debit date template geometry
389e88a Preserve native fallback downloads
f8b414a Exercise native downloads in both staff browsers
0d3808c Record completed Apply tasks
```

## 1. Wins

- The PDF edit changed only the two date areas in a pixel comparison of the original and edited templates. Both fictional rendered samples preserve the original branding, border weight and writing rules.
- The browser suite now proves the Firefox and Chrome download paths with Playwright download events, parsed PDF files and case-state assertions. The corrected Return to signing selection was verified through the generated PDF for all four requested source combinations.
- Independent review checked each changed area and the whole branch. The scope excludes Issue #122 items 1, 2 and 6.

## 2. Misses

- **Pinned runtime detection.** The first escalated command resolved Homebrew Node **25.9.0** even though the repository pins **24.21.0**. Baseline `1c7b433f6a41f81bdf574cfc5178993b793b2e37` failed **the .env text parses back to the same values and refuses what it cannot hold** in `tests/write-test-env.test.mjs:149`. Line 151 raised `AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal` because the actual object had a null prototype. Running the focused test with `--test-name-pattern='env text parses back'` against the explicit v25 binary reproduced the failure. The explicit v24.21.0 binary passed the same test and all 2,588 baseline tests. All 2,599 final tests passed on the same pinned version. The test was preserved. The approved baseline exception did not need to be exercised in the pinned runs.
- **Browser baseline failure.** The unchanged Roster test **An admin adds, finds and edits a volunteer on the Roster** timed out after 10,000 ms waiting for the only matching volunteer. Isolated reruns on baseline and final code produced the same `Nobody matches. 0 of 5 volunteers` screen. The full suite result and missing later Roster steps are recorded in Verify. Roster search remains outside this change's scope.
- **Disposable-stack setup.** The documented example port was occupied. A separate port range let the isolated test stack start without touching the existing stack.

## 3. Plan deviations and rulings

- Restoring the canonical baseline exposed OpenSpec 1.17.0's scenario-loss check. A `MODIFIED` block that replaces an obsolete scenario title is rejected by both strict validation and archive. The earlier strict validation had compared against the already modified canonical file. [OpenSpec #1697](https://github.com/Fission-AI/OpenSpec/issues/1697) · [OpenSpec #1793](https://github.com/Fission-AI/OpenSpec/issues/1793)
- The team authorized a one-time schema authoring exception to replace the two requirement identities using standard `ADDED` and `REMOVED` operations. The rehearsed delta passed strict validation against the restored baseline and archived in a disposable copy with normal validation. OpenSpec, dependencies and schema configuration were preserved.
- Each Reason explains which obsolete behavior was superseded. Each Migration maps an original name to its successor. Only the canonical spec, active planning artifacts and historical archives referenced the old names in the repository. The two historical archives preserve their original identities. External links to the old canonical headings would need updating. OpenSpec appends the two new requirements and preserves the other 17 requirements in their original order.
- Ordinary Draft 13614-C activation follows the existing main-branch drop-only behavior. Exit Form cleanup removes its own DOM link after native activation and leaves URL revocation with the expiry timer. The review observed that overlapping generation requests can still finish out of order, a pre-existing behavior outside the stale-cleanup race fixed here.

## 4. Skill and workflow compliance

| Skill or stage | Actual use |
| --- | --- |
| Brainstorming and writing-plans | Available in Codex. Earlier planning artifacts were manually authored with user approval because Claude Code authentication was unavailable. Neither skill was executed during the earlier planning phase. |
| Using git worktrees | Managed isolated worktree at approved planning commit `1c7b433`. |
| Subagent-driven development | Task implementers and independent task and final reviews. The ledger recorded progress and rulings. |
| Test-driven development and requesting code review | PDF and lifecycle red/green runs and independent reviews. Browser tests ran against the changed implementation in both permutations. |
| Verify | The CLI-generated schema checks were run directly, as prescribed by `CLAUDE.md` when the verification skill is absent. |
| Finishing a development branch | Routed to the local finishing step after archive, with the existing PR preserved and push authorization pending. |

### Deliberately skipped planning skills

Claude Code authentication was unavailable while the six artifacts were created, so the user approved manual planning for this change. The committed artifacts were retained during Apply. For future changes, check tool authentication and skill availability before proposal and record any approved fallback at the time it is used.

## 5. Surprises

- The escalated shell's PATH and the interactive shell resolved different Node executables. Recording the absolute binary and version with each aggregate result separated the prototype assertion from the pinned baseline.
- Moving authority back to current main surfaced a delta incompatibility that could not be seen while the new scenario headings were already canonical.

## 6. Promote candidates

- [ ] 📌 Record the actual Node version with each aggregate test run.
  - **Promote to** one-off
  - **Why** Escalated and interactive shells can resolve different binaries.
  - **How to apply** Set the pinned PATH explicitly when running privileged local test commands.
- [ ] 📌 Rehearse OpenSpec scenario replacements against the untouched canonical baseline.
  - **Promote to** one-off
  - **Why** The OpenSpec version in use compares scenario headings by identity.
  - **How to apply** When planning replaces a scenario description, validate before any canonical sync.
