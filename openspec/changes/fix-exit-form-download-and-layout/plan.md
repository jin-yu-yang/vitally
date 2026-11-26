# Exit Form Download and Layout Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development
> to implement this plan task-by-task.
>
> Claude Code authentication is currently unavailable.
> This plan is manually authored with user approval.
> Any manual implementation fallback requires explicit
> approval and must be documented in retrospective.md.
> No Superpowers skill execution is claimed.

**Goal:** Resolve Issue #122 items 3–5 and the outstanding
review concerns on PR #281.

**Architecture:** Preserve browser-side PDF generation and
native Blob URL downloading. Move static debit date layout
corrections into the original PDF template. Keep download
offers scoped to their originating user, case and review.
Update the canonical specification through OpenSpec archive.

**Tech Stack:** JavaScript ES modules, PDF-lib, PDF.js,
Node.js test runner, Playwright, OpenSpec CLI and Git.

**References:**
- brainstorm.md
- proposal.md
- design.md
- specs/review-and-corrections/spec.md
- tasks.md
- GitHub Issue #122
- GitHub PR #281

---

## Task 1: Preparation and canonical baseline

Covers tasks.md 1.1–1.5.

**Files:**
- CLAUDE.md
- openspec/specs/review-and-corrections/spec.md
- Current change planning artifacts

- [x] **Step 1:** Review all six planning artifacts with the
  user and obtain approval before implementation.

- [x] **Step 2:** Confirm the permitted implementation
  workflow. Record any approved manual fallback and
  unavailable Superpowers skills.

- [x] **Step 3:** Check branch and repository state.

  Run:
  git branch --show-current
  git status --short
  git stash list
  git worktree list

  Expected: issue-122-exit-form-fixes is the active branch,
  and unrelated Issue #157 work remains safely stashed.

- [x] **Step 4:** Fetch origin/main and inspect divergence.

  Run:
  git fetch origin
  git log --oneline HEAD..origin/main

  If main has advanced, inspect and integrate it according
  to CLAUDE.md. Stop on canonical specification conflicts.

- [x] **Step 5:** Read the archived designs for:
  - 2026-11-03-add-exit-form-pdf
  - 2026-11-15-fix-exit-form-after-return-to-signing
  - 2026-11-20-add-exit-form-at-return-to-signing

- [x] **Step 6:** Inspect the canonical specification diff.

  Run:
  git diff origin/main HEAD -- openspec/specs/review-and-corrections/spec.md

- [x] **Step 7:** Restore only the two affected requirements
  to their current main baseline. Preserve every unrelated
  requirement.

  If the entire file diff contains only these requirements,
  restoring that file from origin/main is acceptable.
  Otherwise restore the requirements individually.

- [x] **Step 8:** Validate the planning artifacts.

  Run:
  npx openspec validate fix-exit-form-download-and-layout --strict
  git diff --check

- [x] **Step 9:** Review and commit the approved planning
  artifacts and canonical baseline correction.

  Suggested commit:
  docs(openspec): plan exit form download and layout fixes

## Task 2: Inspect the original PDF geometry

Covers tasks.md 2.1.

**Files:**
- src/forms/exit-form-pcdc.pdf
- src/exit-form.mjs
- tests/exit-form.test.mjs

- [x] **Step 1:** Inspect existing date placement constants,
  font sizing and PDF generation tests.

- [x] **Step 2:** Record the original page dimensions,
  document metadata, date labels, underline coordinates,
  border widths and Mail Check positions.

- [x] **Step 3:** Inspect the PDF content stream and identify
  the exact drawing operations responsible for the Federal
  and State date areas.

- [x] **Step 4:** Measure the width of a complete debit date
  using the same Helvetica Bold font at 9 pt.

- [x] **Step 5:** Determine the minimum geometry adjustment
  that accommodates the date and preserves adjacent
  content.

- [x] **Step 6:** Save a baseline rendering of the original
  template outside the repository for visual comparison.

If a temporary editing tool is required, obtain approval
before installing it in an isolated environment.

Do not introduce a runtime dependency or modify package
lockfiles for temporary PDF editing.

No implementation commit is required for inspection alone.

## Task 3: Correct PDF layout using TDD

Covers tasks.md 2.2–2.7.

**Files:**
- src/forms/exit-form-pcdc.pdf
- src/exit-form.mjs
- tests/exit-form.test.mjs
- tests/exit-form-source.test.mjs

- [x] **Step 1 — RED:** Strengthen the existing regression
  tests to require both Federal and State dates to fit
  fully at 9 pt.

- [x] **Step 2 — RED:** Add regression coverage for blank
  date areas and the absence of runtime date-border
  replacement.

  Select assertions that verify observable behavior or
  stable template properties rather than brittle
  implementation details.

- [x] **Step 3:** Run the focused PDF tests.

  Run:
  node --test tests/exit-form.test.mjs

  Confirm that the new assertions detect the relevant
  missing behavior. Do not claim previously passing
  date-size assertions are new failing tests.

- [x] **Step 4 — GREEN:** Adjust only the identified vector
  geometry in src/forms/exit-form-pcdc.pdf.

  Preserve the original border style, date underlines,
  bilingual labels and logo.

- [x] **Step 5 — GREEN:** Update Federal and State debitOn
  coordinates and widths in EXIT_FORM_LAYOUT using the
  measured geometry.

- [x] **Step 6 — GREEN:** Remove the runtime debit date
  rectangle and border-redrawing loop from buildExitFormPdf.

  Preserve unrelated drawing operations.

- [x] **Step 7:** Run the focused regression tests.

  Run:
  node --test tests/exit-form.test.mjs tests/exit-form-source.test.mjs

- [x] **Step 8:** Generate fictional populated and blank
  Exit Forms.

  Use Federal and State dates such as 04/15/2027 and
  04/30/2027 for the populated form.

- [x] **Step 9:** Visually inspect both generated forms.

  Confirm:
  - Full dates at 9 pt.
  - Consistent borders.
  - Retained underlines.
  - No clipped or overlapping text.
  - Adequate Mail Check separation.
  - Usable handwriting space.
  - Unchanged branding and unrelated content.

- [x] **Step 10 — REFACTOR:** Remove temporary debugging
  code and inspect the final PDF-related diff.

- [x] **Step 11:** Review and commit the PDF changes.

  Suggested commit:
  fix(exit-form): correct debit date template geometry

## Task 4: Download offer lifecycle

Covers tasks.md 3.1–3.7.

**Files:**
- src/app.mjs
- src/draft-pdf.mjs, if required
- src/staff-views.mjs, if required
- tests/shell.test.mjs
- Existing draft offer and staff-view tests

- [x] **Step 1:** Read createDraftOffer, draftLink,
  showDraftLink, viewDraft and viewExitForm.

- [x] **Step 2:** Inspect the existing expiration callback,
  user-switch behavior and application redraw lifecycle.

- [x] **Step 3 — RED:** Add regression tests that detect
  synchronous anchor removal and incorrect stale-offer
  cleanup.

- [x] **Step 4 — RED:** Cover user, case and review
  mismatches, expiration, regeneration and unauthorized
  client access.

- [x] **Step 5:** Run the relevant existing test files and
  confirm that the new assertions detect the defect.

  Locate relevant tests with:
  git grep -nE 'createDraftOffer|draftLink|showDraftLink|exit-form-ready' -- tests

- [x] **Step 6 — GREEN:** Preserve native anchor download
  behavior and remove synchronous anchor replacement
  from the Exit Form click path.

  Starting point:

  link.addEventListener("click", () => {
    draftOffers.drop();
  });

  This is not the final implementation until cleanup
  and authorization tests pass.

- [x] **Step 7:** Implement safe cleanup of used and
  expired links without interrupting the native download.

  Account for the fact that drop() clears the offer
  without immediately revoking its Blob URL.

  Do not leave stale download links in the DOM.
  Do not allow an old cleanup callback to remove a
  newly generated offer.

- [x] **Step 8:** Preserve ordinary Draft 13614-C behavior.

  Keep any Exit Form-specific cleanup scoped to Exit Form
  links unless a shared change is justified and tested.

- [x] **Step 9:** Verify that authorized volunteers without
  contact access receive the download offer beside the
  matching Exit Form button.

- [x] **Step 10:** Run the focused shell, draft offer and
  staff-view tests.

  Run:
  node --test tests/shell.test.mjs tests/staff-views.test.mjs

  Also run the draft offer test file identified in Step 5.

- [x] **Step 11 — REFACTOR:** Review security boundaries,
  stale-link behavior and unintended shared changes.

- [x] **Step 12:** Review and commit the lifecycle fix.

  Suggested commit:
  fix(exit-form): preserve native fallback downloads

## Task 5: Chrome and Firefox browser verification

Covers tasks.md 4.1–4.7.

**Files:**
- tests/browser.mjs

- [x] **Step 1:** Locate the existing Exit Form browser phase.

  Run:
  git grep -nE 'exit-form-ready-link|Exit Form|exitForm' -- tests/browser.mjs

- [x] **Step 2:** Identify Chrome-only preview conditions
  and the browser engine assigned to staff in each
  browser story permutation.

- [x] **Step 3 — RED:** Add actual download verification
  to the blocked-popup path.

  Adapt the project's existing Playwright pattern:

  const downloaded = staff.waitForEvent("download", {
    timeout: ARRIVAL_MS,
  });

  await link.click({ timeout: CLICK_MS });

  const download = await downloaded;
  const bytes = await readFile(await download.path());

  assert.equal(download.suggestedFilename(), expectedFilename);
  assert.equal(bytes.subarray(0, 5).toString("latin1"), "%PDF-");

  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1);

  Use the existing test's actual variables and fixtures.
  Do not introduce undefined identifiers.

- [x] **Step 4:** Move blocked-popup coverage outside
  Chrome-only preview guards while preserving preview,
  failure and retry behavior.

- [x] **Step 5:** Exercise both Chrome staff and Firefox
  staff download paths using fictional client data.

- [x] **Step 6:** Verify the matching download area,
  expected filename and unchanged case stage and revision.

- [x] **Step 7:** Exercise the authorized volunteer path
  without contact-detail access.

- [x] **Step 8:** Verify expiration, regeneration and
  relevant user, case and review isolation behavior.

- [x] **Step 9:** Ensure font routes and window.open
  overrides are restored even when a test fails.

- [x] **Step 10:** Run browser tests using the documented
  project setup.

  Run:
  npm run test:browser

  If local infrastructure prevents execution, record the
  exact blocker and use CI evidence only as permitted
  by CLAUDE.md.

- [x] **Step 11:** Verify that both staff browser engines
  actually executed the new assertions.

  A skipped Firefox phase is not passing Firefox coverage.

- [x] **Step 12:** Review browser screenshots and evidence.

- [x] **Step 13:** Commit the browser test changes.

  Suggested commit:
  test(exit-form): verify fallback downloads in both browsers

## Task 6: Full implementation review

Covers tasks.md 5.1–5.7.

- [x] **Step 1:** Review the complete diff against design.md
  and the delta specifications.

- [x] **Step 2:** Run the full unit test suite.

  Run:
  npm test

- [x] **Step 3:** Run applicable browser regression tests
  or collect the permitted equivalent CI evidence.

- [x] **Step 4:** Confirm the corrected Exit Form tab title
  and Return to signing behavior remain intact.

- [x] **Step 5:** Inspect PDF visual evidence for populated
  and blank date fields.

- [x] **Step 6:** Validate OpenSpec artifacts.

  Run:
  npx openspec validate fix-exit-form-download-and-layout --strict
  npx openspec validate --all --json

- [x] **Step 7:** Inspect the implementation diff.

  Run:
  git diff --check
  git diff origin/main HEAD --stat
  git status --short

- [x] **Step 8:** Confirm there are no unrelated database,
  RPC, dependency, workflow or branding changes.

- [x] **Step 9:** Update tasks.md and plan.md checkboxes
  only when the corresponding work is verified.

- [x] **Step 10:** Commit remaining reviewed implementation
  changes and record the relevant commit range.

## Post-implementation lifecycle

These steps follow completion of the Apply tasks.
Do not create verification evidence before implementation.

1. Generate verify.md using the schema's verification
   instructions and actual test evidence.
2. Resolve all blocking verification issues.
3. Generate retrospective.md with factual evidence,
   actual skill usage and approved workflow deviations.
4. Integrate current main before archive as CLAUDE.md
   requires. Revalidate after integration.
5. Archive the completed change with:

   npx openspec archive fix-exit-form-download-and-layout -y

6. Confirm only the intended requirements were updated.
7. Run final validation and inspect the complete diff.
8. Commit the archived OpenSpec change.
9. Update the existing draft PR #281 after approval.
10. Verify CI results and review visual evidence for
    the relevant commit.
11. Respond to the outstanding PR review concerns.

Do not merge PR #281.
Do not close the entirety of Issue #122.
Do not alter Issue #157's stash or the Issue #239 branch.
