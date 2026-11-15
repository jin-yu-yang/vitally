# Verification Report

**Change**: `fix-exit-form-after-return-to-signing`
**Verified at**: `2026-11-15 01:58`
**Verifier**: Claude (controller session). The checks were run directly, because the `openspec-verify-change`
skill is not installed (CLAUDE.md §2 step 6).

---

## 1. Structural Validation (`openspec validate --all --json`)

- [x] Every item is `"valid": true`

**Result**:

```text
16 items, all valid: true (15 canonical specs plus this change)
```

| Item | Type | Issues |
|---|---|---|
| — | — | — |

---

## 2. Task Completion (`tasks.md`)

- [x] Every `- [ ]` is now `- [x]` (17 of 17)

**Unfinished tasks**: none.

| Task | Why unfinished | Blocks archive? |
|---|---|---|
| — | — | — |

---

## 3. Delta Spec Sync State

| Capability | Sync state | Notes |
|---|---|---|
| `review-and-corrections` | ✗ Needs sync | 2 ADDED and 2 MODIFIED requirements. Archive merges them (CLAUDE.md §2 step 8). |

---

## 4. Design / Specs Coherence Spot Check

| Sample | Design | Specs | Gap |
|---|---|---|---|
| A later Return to signing | D1: a `RETURN_TO_SIGNING` history entry after `decidedAt` | ADDED "…prints only what ViTally holds" ("by the case's staff history") | none |
| Settled methods | D3: method set and result not `rejected` | same requirement, plus the refiled e-file, paper and no-method scenarios | none |
| Fail-safes | D4: no `internalHistory` gives `null`; Risks: missing `decidedAt` counts as later | "A record without staff history SHALL offer no Exit Form", "No staff history" scenario | The missing-`decidedAt` rule is in design and code, not in the spec. Non-blocking: it only narrows when old values may print. |
| The note | D5: exact text and item order | ADDED "…says what to fill in by hand" | none; the code matches it character for character (Task 3 check) |
| No fallback | D6 | MODIFIED "An approved review offers the Exit Form", "No fallback to an earlier approval" scenario | none |

**Drift warnings** (non-blocking):

- The missing-`decidedAt` fail-safe lives in design.md, the code, a "keep" unit test and frontend.md, but no spec
  scenario names it. It's a guard for data that real approvals never have.

---

## 5. Implementation Signal

- [x] No unstaged files in the worktree (only this `verify.md` and the `tasks.md` 5.x ticks, committed next)
- [x] Every code commit is pushed; CI ran on `c8aa36b`

**Commit range**: `6add349..c8aa36b`. The code is in `4a47986`, `6fb4426`, `c4f7e82`/`da38e34` (docs) and
`c8aa36b`; the planning artifacts are in `141ae8a`.

**Checks run**
- **`npm test` (local):** 1715 of 1716. The one failure is `tests/write-test-env.test.mjs:157`, also failing
  on the baseline. The test puts a Windows temp path, which contains backslashes, into a `.env` value, and the
  writer refuses it. It isn't this change's and passes in CI on Linux. Unit tests went from 1712 to 1716 on this
  machine.
- **CI run [43686417511](https://github.com/jin-yu-yang/vitally/actions/runs/43686417511) on `c8aa36b`:**
  every job passed on its first try: `checks`, `database`, `sign-in`, `story (chrome-client)` and
  `story (firefox-client)`. The story's "the Exit Form opens from an approved review" check passed. The
  screenshot `firefox-client-chrome-staff--staff-case-review-approved-720` shows the approved review's recorded
  Exit Form values with no fill-by-hand note, which is the uncorrected path, as expected.
- **Not run locally:** the database, sign-in and story suites. The local stack is shared with other sessions,
  and no SQL changed. The passing CI run above stands in for them.
- **`build:hant --check`:** not needed, because no client text changed (staff text is English). `checks` ran
  it anyway.

---

## 6. Front-Door Routing Leak Detector (warning, non-blocking)

```bash
ls docs/superpowers/specs/*.md   # 8 files
```

- [x] The files that exist are legitimate, from before the schema was installed

| File | Captured in the change? | Action |
|---|---|---|
| The 8 historical design documents (last touched 2026-10-05) | Not from this cycle | None. CLAUDE.md keeps them as historical documents, not to be moved. |

---

## 7. Deferred Manual Dogfood vs Automated Test Equivalence

`plan.md` has no `[~]` rows, so this section is empty.

---

## Overall Decision

- [ ] ✅ PASS
- [x] ⚠️ PASS WITH WARNINGS: the missing-`decidedAt` fail-safe isn't named in a spec scenario (§4).
  Non-blocking.
- [ ] ❌ FAIL

**Next step**: retrospective, then merge `main` and archive, then open the PR.
