## Context

ViTally generates PCDC's bilingual, one-page Exit Form
in the browser using an existing PDF template and
approved review data.

The original behavior and its known limitations were
documented in the archived add-exit-form-pdf change.

PR #281 improves the blocked-popup fallback and debit
date readability. CI #561 passed all five jobs, but
subsequent review identified template presentation,
download lifecycle and OpenSpec workflow concerns.

The historical browser story verifies Exit Form PDF
behavior only when the staff browser is Chrome.
Additional coverage is required to establish actual
download behavior in Firefox staff windows.

The current implementation is on the
issue-122-exit-form-fixes branch.

## Goals / Non-Goals

**Goals:**

- Provide a visible, usable blocked-popup download link.
- Preserve user, case and review isolation.
- Ensure native PDF downloads work in both staff browsers.
- Fit full Federal and State debit dates at 9 pt.
- Preserve the PDF template's original visual language.
- Preserve blank date fields for handwriting.
- Complete the OpenSpec change lifecycle.
- Preserve the existing tab title fix.

**Non-Goals:**

- Fix Issue #122 items 1, 2 or 6.
- Change Remarks truncation or unrelated font behavior.
- Change database schemas, RPCs or authorization policies.
- Change preparation, review or signing workflows.
- Replace ordinary Draft 13614-C behavior.
- Introduce unrelated refactoring or runtime dependencies.

## Decisions

### D1: Modify the original PDF template

**Choice:** Edit the necessary vector geometry in
src/forms/exit-form-pcdc.pdf.

Inspect the actual PDF paths and text positions before
changing their coordinates.

Preserve the template's original border thickness,
underlines, bilingual labels, branding and page size.

Allow sufficient space for a full 9 pt date and maintain
separation from the Mail Check checkbox.

**Rationale:** A static template adjustment avoids seams
and inconsistent line thickness caused by runtime overlays.

**Alternatives considered:**

- Runtime white rectangles and replacement borders:
  rejected because they produce visible seams and remove
  the original underline.
- Smaller date font:
  rejected because it does not satisfy the readability goal.
- Rebuilding the entire form:
  rejected because it risks changing unrelated content
  and branding.

### D2: Remove runtime border replacement

**Choice:** Remove the debit date border-overlay code
introduced in the initial PR.

Adjust the Federal and State date placement and width
to match the final template geometry.

Preserve other PDF drawing operations, including those
needed by Return to signing.

**Rationale:** The template should define its static
layout, while the generator should draw the filled values.

**Alternative considered:** Keeping an overlay only when
a date exists. Rejected because it creates inconsistent
forms and retains unnecessary drawing complexity.

### D3: Preserve the native download mechanism

**Choice:** Keep the existing anchor-based download and
Blob URL mechanism.

Do not remove the anchor synchronously during its click
event. Start from the existing main-branch behavior,
which clears the offer without immediately removing
the element.

Inspect and test subsequent cleanup so a used or expired
link does not remain available incorrectly.

Preserve the URL lifetime and authorization boundaries.

**Rationale:** Native browser downloads already support
the required filename and PDF payload without introducing
a custom download implementation.

**Alternatives considered:**

- Synchronous DOM removal:
  rejected because it may interfere with default
  browser download behavior.
- A separate custom download mechanism:
  rejected unless native downloading proves insufficient.

### D4: Keep offers beside their corresponding buttons

**Choice:** Retain dedicated Exit Form download areas
associated with their review IDs.

Display an offer only in the appropriate authorized
staff view for its originating user, case and review.

Do not require access to the Intake answers or
contact-detail sections.

Retain the regeneration guidance and approximately
60-second lifetime.

**Rationale:** The fallback must be discoverable wherever
the authorized staff member presses the Exit Form button.

**Alternative considered:** Retaining a shared Intake
answers link. Rejected because it is hidden or absent
for some authorized staff.

### D5: Exercise both staff browsers

**Choice:** Extend blocked-popup download verification
to Chrome and Firefox staff windows.

Keep existing Chrome-only PDF preview checks where
necessary for browser compatibility.

Use the existing Playwright download-event pattern to
verify:
- A visible fallback link.
- Successful native file download.
- Expected suggested filename.
- Valid PDF bytes and a one-page document.
- Unchanged case stage and revision.

Exercise authorized volunteers without contact access.
Retain existing error and retry checks.

Use local font fixtures and fictional data.

**Rationale:** Link visibility and a Blob URL alone do
not prove the browser successfully downloads a file.

**Alternative considered:** Relying on the existing
passing browser story permutations. Rejected because
the original Exit Form phase is Chrome-staff-only.

### D6: Preserve existing regression boundaries

**Choice:** Retain the existing staff authorization
checks, corrected tab title, ordinary Draft 13614-C
behavior and Return to signing source rules.

Verify relevant offer expiration and isolation behavior.

Do not alter case state when generating or downloading
the PDF.

**Rationale:** The requested fixes concern presentation
and download usability, not tax workflow semantics.

### D7: Update requirements through OpenSpec archive

**Choice:** Create complete MODIFIED requirements for
the affected review-and-corrections requirements.

Restore the previous canonical requirement baseline
before archive applies the new deltas.

Preserve unrelated requirement content and scenarios.

**Rationale:** This is a documented behavior change
and must include a traceable OpenSpec change.

**Alternative considered:** Direct canonical spec
editing. Rejected because it bypasses the project's
change lifecycle.

### D8: Preserve the existing PR and branch

**Choice:** Continue on issue-122-exit-form-fixes and
update the existing draft PR #281.

Synchronize with main before the final push.

Preserve the Issue #157 stash and backup references,
and do not change the Issue #239 branch.

**Rationale:** This is follow-up work addressing review
feedback, not a separate feature.

## Risks / Trade-offs

- [Risk] Editing the PDF content stream may affect
  unrelated template elements.
  Mitigation: Inspect the original geometry, constrain
  changes to the required regions, and compare the
  rendered template before and after editing.

- [Risk] The enlarged date area may overlap neighboring
  labels or checkboxes.
  Mitigation: Measure actual font widths and template
  coordinates, then inspect both populated and blank forms.

- [Risk] Download cleanup may interrupt the browser
  or leave stale links.
  Mitigation: Verify actual downloads and offer lifecycle
  behavior in both staff browsers.

- [Risk] Existing browser tests may retain Chrome-only
  conditions that leave Firefox coverage unexecuted.
  Mitigation: Explicitly verify the staff browser used
  by each test permutation and record executed coverage.

- [Risk] Restoring the canonical baseline may overwrite
  unrelated requirements.
  Mitigation: Inspect the diff against current main and
  restore only the affected requirements.

- [Risk] Claude Code account expiration prevents
  invocation of the installed Superpowers skills.
  Mitigation: Record the tooling limitation and use
  explicitly approved manual planning. Obtain approval
  for any implementation workflow deviation and document
  it in retrospective.md.

- [Trade-off] A temporary PDF editing tool may be needed.
  It must not become a new ViTally runtime dependency.

## Migration Plan

No database or API migration is required.

The updated PDF template and corresponding generator
layout must be delivered together.

Before delivery:
1. Verify template geometry and populated PDF rendering.
2. Run the affected unit and browser regression tests.
3. Complete structural OpenSpec validation.
4. Record verification evidence and workflow deviations.
5. Archive the change against the latest main.
6. Push the completed update to PR #281.

If rollback is required, restore the matching template
and generator changes together.

## Open Questions

- Exact PDF vector coordinates:
  resolve during template inspection before editing.

- Temporary PDF editing tool:
  select after inspecting the available PDF structure.
  Do not introduce an unnecessary runtime dependency.

- Download cleanup timing:
  resolve through implementation inspection and actual
  Chrome and Firefox download tests.

- Manual Apply workflow approval:
  resolve before implementation begins because Claude
  Code authentication is currently unavailable.

No outstanding product-scope decisions remain.
