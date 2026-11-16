# Retrospective: fix-closed-lines-after-filing

> Written: 2026-11-14 (after verify passed with warnings)
> Commit range: `6add349..013b026`, plus this retrospective and the archive commit
> Worktree: D:/dev/vitally-closed-lines

---

## 0. Evidence

- **Commit range**: `6add349..013b026` (10 commits before this retrospective)
- **Diff size**: +1773 / -4 lines across 16 files. That includes about 900 lines of OpenSpec artifacts and 60 regenerated `src/zh-hant.mjs` entries.
- **Tasks done**: 13/13
- **Active hours**: about 3.5 (first commit 01:38, verify 05:03 New York time). CI waits (about 12 minutes per full run) make up a large part of that.
- **Subagent dispatches**: 8. Implementer: Task 1, Task 2, the fix wave. Reviewer: Task 1, Task 2. Final whole-branch review: 1. Re-review of the fix wave: 1.
- **New external dependencies**: none
- **Bugs encountered post-merge**: not merged yet
- **OpenSpec validate state at archive**: pass (16/16 before archive)
- **Test coverage signal**:
  - unit `npm test` 1705, of which 1704 pass; the one failure is the pre-existing Windows-only `write-test-env`.
  - CI database suite 595/595 on `f428a0c`, with `database-closed-after-filing.mjs` subtests 1–13 passing. Subtest 13 alone makes 119 SQL/JS parity calls.
  - New tests: 13 database subtests and 5 unit tests.

Commit chain:

```
16e2b06 Reproduce #170: failing tests for closes after a filed return
9200254 OpenSpec change: planning artifacts
fa1a351 pre-flight ruling: parity covers the reasons whose two texts already match
5f41c80 Closed messages say what was filed: shared rule and status panel
86a5897 tasks: group 1 done
e3127fa closed_line reads what was filed; notice after a filing
f663f21 database-hold: call the five-argument closed_line
b687206 tasks: groups 2 and 3 done
f428a0c Fix wave: 並 in 繁體 accepted lines, drop if exists, closedLine note
013b026 verify.md
```

---

## 1. Wins

- **Reproduction first.** [evidence: `16e2b06`, CI run 43567350441] Each of the 8 close paths had a failing test (16 database subtests and 1 unit test) before any design work. The report gave the user concrete paths to rule on, and the same tests became the acceptance check.
- **Tests that don't depend on wording.** [evidence: `tests/database-closed-after-filing.mjs`] The reproduction asserts only the negative ("no false 'not filed'"). That let it survive the wording brainstorm unchanged, apart from the regex narrowing below.
- **One rule, kept in step mechanically.** [evidence: subtest 13; `src/client-text.mjs` `closedLines()`] The status panel, the stored history line and the translation table all come from one rule, and an exhaustive parity test enforces it across 119 inputs, not just the 8 paths.
- **The final review caught a real client-facing defect.** [evidence: `f428a0c`] OpenCC rendered 已递交并被接受 as 遞交**併**, where the meaning "and" needs **並**. Neither task reviewer nor any test caught it. The whole-branch reviewer on the most capable model did, by reading the generated 繁體.
- **No overlap with #196/#197.** [evidence: diff stat] All new tests live in new files. The only existing test edited is `tests/database-hold.mjs`, one line, and neither PR touches that file.
- **One CI pass per round.** Database and story checks never touched the shared local stack. Run 43579513755 failed for a reason we could read; it was fixed from the recorded error, not by re-running.

## 2. Misses

- 🟡 [painful | evidence: CI run 43579513755] Dropping `closed_line(text)` broke `tests/database-hold.mjs:317`, which called the function directly. The plan's "grep shows no other caller" step only grepped `supabase/migrations`. A grep of `tests/` would have found it before the CI round trip (about 12 minutes).
- 🟡 [painful | evidence: plan.md Task 1 Step 1, `f428a0c`] The plan specified the 繁體 check as "converted, and not equal to 简体". That can't detect a wrong conversion. One exact 繁體 string would have caught 併 in Task 1.
- 📌 [nit | evidence: `fa1a351`] The delta spec's sentence "the status panel and the history line SHALL give the same text for the same case" was too broad: the `other` / no-reason lines already differed. The pre-flight scan caught it, but the brainstorm should have checked the existing `other` history line against the panel text.
- 📌 [nit | evidence: `5f41c80`] The reproduction regex `/was not filed|未递交/` contradicted the agreed design: a correct composed line says "Your federal return was not filed". It was narrowed by ruling in both files. The negative check had been written before the design and should have targeted the whole-return sentence from the start.

## 3. Plan deviations

| Plan task | What changed | Why |
|-----------|--------------|-----|
| Task 2 Step 1 (parity) | For `other` / null, the test asserts 036's generic history line plus a SENTENCES entry instead of panel parity | Pre-flight ruling: the two texts already differ by spec (`fa1a351`) |
| Task 2 Step 2 (RED CI run) | Skipped; one CI run after the migration | Ruling: subtests 1–8 were already RED in run 43567350441; 10 and 13 can't pass without the migration |
| Task 2 | An extra commit `f663f21` edits `tests/database-hold.mjs` | It called the dropped one-argument function (see Misses) |
| Task 1 / Task 2 reproduction | The regex was narrowed to `/Your return was not filed\|您的报税表未递交/` | Ruling: composed lines legitimately say one return was not filed |
| Task 3 | Run inline by the controller | Read-only greps and validate; no code to delegate |
| (new) Fix wave | hant override for 遞交並被接受, an exact 繁體 assertion, `drop function if exists`, a comment in `closedLine` | Final whole-branch review findings |

## 4. Skill / workflow compliance

| Skill                                            | Used |
|--------------------------------------------------|------|
| superpowers:brainstorming                        | ✓ (design agreed in conversation; the skill wrote brainstorm.md during propose) |
| superpowers:writing-plans                        | ✓ |
| superpowers:using-git-worktrees                  | ✓ (D:/dev/vitally-closed-lines) |
| superpowers:subagent-driven-development          | ✓ |
| (transitive) superpowers:test-driven-development | ✓ (RED evidence in both implementer reports; Task 2's RED is by construction and the earlier CI run, by ruling) |
| (transitive) superpowers:requesting-code-review  | ✓ (2 task reviews, final review, fix re-review) |
| superpowers:finishing-a-development-branch       | ✓ (lifecycle step 9, after archive) |

### Deliberately Skipped Skills

(none)

## 5. Surprises

- The `other` close has two different texts: the history line ("Your application was closed by the office… Contact PCDC if you have questions.", from 005) and the panel text ("This application was closed by the office…"). The "one rule" framing assumed they were the same.
- OpenCC's segmentation picks 併 after 交 even though it converts 并 correctly elsewhere ("人，並電子…"). `build:hant -- --check` only checks that the file is current, not that it's right.
- `tests/database-hold.mjs` calls a private SQL helper directly. Tests are callers too when a function is dropped.
- The local `tests/write-test-env.test.mjs` fails on Windows on `main` (a temp path with a character `.env` can't hold unquoted). It is invisible in CI, which runs on Linux.

## 6. Promote candidates → long-term learning

- [ ] 🟡 **When a migration drops or changes a function's signature, grep tests and tools for callers too, not only migrations** → **Promote to memory** (type: feedback)
  > **Why**: run 43579513755 failed because `tests/database-hold.mjs` called the dropped `closed_line(text)` directly. It cost a CI round trip that the shared local stack couldn't replace.
  > **How to apply**: any plan step or implementer brief that drops or renames a SQL function: `grep -rn "<fn>(" supabase tests tools src`.

- [ ] 🟡 **New 简体 client text needs at least one exact 繁體 assertion** → **Promote to memory** (type: feedback)
  > **Why**: "converted, and not equal to 简体" let 遞交併被接受 through every task review (`f428a0c`). OpenCC's segmentation errors look plausible.
  > **How to apply**: whenever a change adds 简体 sentences: pin one exact 繁體 string per new sentence family, and read the regenerated `zh-hant.mjs` diff for 并/后/干/发-type characters.

- [ ] 📌 **Negative reproduction tests should target the exact false claim, not a substring the fix may legitimately keep** → **One-off**
  > **Why**: `/was not filed/` also matched the correct per-return sentence. It was easy to rule on and the fix was one line, so it doesn't need a rule.

- [ ] 📌 **The Windows-only `write-test-env` failure on main** → **One-off** (worth an issue if it bothers local runs)
  > **Why**: it is pre-existing and unrelated, but every local `npm test` on Windows reports a failure, which hides real ones.

## Ledger summary (subagent-driven development, before the workspace was deleted)

Rulings:
1. **Parity for `other` / null.** The parity test asserts SQL equals panel for dismissed, withdrawn, out_of_scope, no_need_to_file and duplicate. For `other` / null it asserts 036's generic history line plus a SENTENCES entry. The delta-spec sentence was narrowed to match (`fa1a351`). Cost if wrong: one assertion to tighten.
2. **Task 2 CI.** Task 2 pushes the feature branch and runs CI for the database checks (the user authorized CI). Cost if wrong: an extra CI run.
3. **Reproduction regex.** Narrowed to the whole-return sentence in both reproduction files. Cost if wrong: the negative check misses a per-return false claim; the exact-text tests cover those.
4. **Task 2 RED run.** No separate RED CI run. RED for 1–8 is run 43567350441, and 10 and 13 can't pass without the migration. Cost if wrong: a new test passing for the wrong reason (the final review read the assertions).
5. **Task 3.** Run inline: read-only greps and validate. Cost if wrong: a missed doc mention.
6. **Fix wave.** The hant override, the exact 繁體 assertion, `drop function if exists` and the `closedLine` comment. The migration header and `-- 047` markers are left until the renumber. Cost if wrong: a stale comment number if the rename forgets it.
7. **Deferred minors.** All six left as they were, which the final reviewer's triage agreed with. Cost if wrong: small test gaps on unreachable inputs.

Parked findings: none.

Deferred minor findings, left as they are:
- The test that checks SENTENCES coverage is circular, because `closedLine` generates SENTENCES.
- `CLOSED_REASONS` is not exported, so the reason list is duplicated in tests.
- `return_outcome` is `security definer` though it needs no table access. That matches house style, and it is revoked from all roles.
- JS `!result` and SQL `is null` differ only on `''` results, which no write path stores.
- Subtest 13 doesn't cover paper with a null result or a case with no Pennsylvania return. Both are unreachable.
- `return_outcome` wasn't in the brief's Interfaces section. It is documented in the migration header.
