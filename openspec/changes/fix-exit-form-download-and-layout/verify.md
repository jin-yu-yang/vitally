# Verification Report

**Change**: `fix-exit-form-download-and-layout`  
**Verified at**: 2026-11-26, America/New_York  
**Verifier**: Codex with independent Superpowers task and branch reviews

## 1. Structural validation

- [x] OpenSpec 1.17.0 strict validation passed against the canonical spec restored from current `origin/main` at `86e6319`.
- [x] `openspec validate --all --json` reported 27 of 27 valid items, including 26 canonical specs and the active change.
- [x] `git diff --check origin/main` passed.

## 2. Task completion

- [x] All 33 tracked Apply tasks are complete. The Verify precheck found 9 branch commits since the merge base and 33 checked tasks.
- [x] PDF and source regression tests passed 51 of 51. Three expected geometry and blank-area regressions failed with the original template and overlay before the correction.
- [x] Shell, staff-view, and draft PDF tests passed 321 of 321. Four new lifecycle assertions failed against the original implementation before the correction.

### Full unit suite and baseline comparison

| Revision | Runtime | Pass | Fail |
| --- | --- | ---: | ---: |
| `1c7b433f6a41f81bdf574cfc5178993b793b2e37` | Pinned Node 24.21.0 | 2,588 | 0 |
| Apply code through `f8b414a` | Pinned Node 24.21.0 | 2,599 | 0 |

The preflight failure was in `tests/write-test-env.test.mjs:149`, **the .env text parses back to the same values and refuses what it cannot hold**. The failing assertion at line 151 was `assert.deepEqual(parseEnv(formatEnv(env)), env)`. It returned `AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal`, with `[Object: null prototype]` on the actual side and a plain object on the expected side. The original escalated shell picked Homebrew Node **25.9.0** via PATH. On baseline `1c7b433`, the failure reproduced with the explicit Homebrew binary and `--test-name-pattern='env text parses back'`. The same command using the absolute pinned Node **24.21.0** binary passed, as did both complete pinned runs. The test and Node pin are unchanged. The approved baseline exception was therefore unnecessary for the pinned run.

### Browser suite and baseline comparison

`npm run test:browser` ran on Node 24.21.0 against a dedicated local Supabase stack with fictional data. Both complete story permutations passed. The full command reported **97 passed, 1 failed, 0 skipped or cancelled**.

| Staff browser | Exit Form evidence |
| --- | --- |
| Firefox 159.0, Playwright build 1572 | Native office and volunteer downloads, expiration and regeneration, and user, case, review and client isolation passed |
| Chrome 158.0.8127.88 | Same native download and isolation assertions passed. The new tab preview, tab title, font failure and retry passed |

Each engine received an actual Playwright download event for `exit-form-12.pdf`. The file began with `%PDF-` and parsed as a one-page PDF. The links appeared beside their matching buttons on Overview, and stage and revision stayed unchanged. An authorized unassigned volunteer downloaded without contact details. The production lifetime elapsed and revoked the unused URL, a regenerated offer downloaded, and sign-out revoked the volunteer's remaining offer.

The separate test **An admin adds, finds and edits a volunteer on the Roster** timed out after 10,000 ms waiting for the search to show only the new volunteer. Both isolated reruns, on `1c7b433` and on the final code, reproduced the same timeout and displayed `Nobody matches. 0 of 5 volunteers`. The Roster test block is byte-identical on `origin/main`, baseline and final. Later steps within that test did not execute. The Roster failure is outside the Exit Form scope.

The local stack migrations ran to set up the browser fixtures. Separate database and authentication suites were outside the change's verification surface because the diff changes neither database behavior nor sign-in. Chinese client text was also unchanged.

## 3. Delta spec sync state

| Capability | State before archive | Evidence |
| --- | --- | --- |
| `review-and-corrections` | Pending archive | Canonical spec matched `origin/main` byte for byte. Disposable OpenSpec rehearsal applied two additions and two removals and preserved all 17 unrelated requirements in order. |

## 4. Design and spec coherence

| Decision | Evidence |
| --- | --- |
| Static PDF geometry | Original 612 × 792 pt template and fictional populated and blank renderings were visually inspected. Both complete dates fit at 9 pt. The original border weight, writing rules, bilingual labels, Mail Check separation and PCDC branding were visible. |
| Date source | PDF tests cover original approved dates, corrected Return to signing dates, no correction values, and a latest valueless Return to signing after an older correction with dates. |
| Native fallback | Shell regression tests cover deferred cleanup and stale callbacks. Both browser stories verify actual downloads and authorization boundaries. |
| Formal spec replacement | The delta is byte-identical to the approved rehearsal and carries Reason and Migration mappings. |

The original and final PDF images, selected 720 px screenshots of the approved-review view in each browser, and unit and browser logs are available locally under `artifacts/exit-form-122/`. The browser screenshots were inspected. The native download link and file were verified by the browser assertions.

## 5. Implementation signal

- [x] All relevant source, tests and Apply task tracking are committed. Worktree was clean before this report.
- [ ] Pushing is pending the user's approval.

Apply range `1c7b433..0d3808c`. The full unit rerun preceded the browser-only commit and covered identical unit inputs. The full browser run used the committed browser test contents at `f8b414a`.

## 6. Front-door routing

The detector found eight existing files under `docs/superpowers/specs/`. They are historical files explicitly protected by `CLAUDE.md`. This change wrote its planning artifacts only under its OpenSpec change folder.

## 7. Deferred manual checks

The plan has no deferred manual checks.

## Overall Decision

- [ ] ✅ PASS
- [x] ⚠️ PASS WITH WARNINGS
- [ ] ❌ FAIL

The approved behavior passed the unit, visual and both staff-browser story checks. The independently reproduced Roster baseline timeout remains a warning on the full browser command.
