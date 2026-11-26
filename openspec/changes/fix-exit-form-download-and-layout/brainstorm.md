# Brainstorm: Fix Exit Form Download and Layout

## Background

Issue #122 identifies several problems with the Exit Form.
This change addresses items 3–5 and the review feedback
on PR #281.

Item 3, the incorrect Exit Form tab title, was previously
fixed by PR #125. This change preserves that behavior.

The initial implementation addressed the blocked-popup
download link and increased debit date readability.
All 2,484 local tests and all five jobs in CI #561 passed.

However, subsequent review identified three concerns:

1. The runtime PDF border overlay creates visible seams,
   inconsistent line thickness, removes the date underline,
   and leaves insufficient spacing near Mail Check.
2. Canonical requirements were edited directly rather than
   through an OpenSpec change.
3. Removing the download anchor synchronously during its
   click event may interfere with the browser's download.

Further exploration found that the existing Exit Form
browser phase only exercises its PDF behavior when the
staff browser is Chrome. Passing both story permutations
therefore does not establish Firefox download coverage.

## Q1: What is the scope?

Decision:
Address items 3–5 of Issue #122 and the three concerns
raised in the review of PR #281.

In scope:
- Preserve the corrected Exit Form tab title.
- Make blocked-popup download links visible beside
  their corresponding Exit Form buttons.
- Improve Federal and State debit date readability.
- Correct the PDF template geometry.
- Verify actual downloads in Chrome and Firefox.
- Complete the formal OpenSpec lifecycle.

Out of scope:
- Items 1, 2, and 6 of Issue #122.
- Remarks truncation and unrelated font-fetch issues.
- Database migrations and RPC changes.
- Changes to tax preparation or signing workflows.
- Unrelated refactoring.

## Q2: How should the PDF layout be corrected?

Alternatives considered:

A. Continue drawing replacement borders at runtime.
   This avoids editing the template but creates visual
   seams and changes blank forms unnecessarily.

B. Modify the original PDF template geometry.
   This preserves a consistent static layout and removes
   the need for runtime border overlays.

C. Reduce the date font size.
   This is simple but does not solve the readability
   problem described in Issue #122.

Decision:
Choose B.

Inspect the original vector geometry in
src/forms/exit-form-pcdc.pdf and adjust only the
necessary date areas.

Preserve:
- Original border thickness.
- Date underlines and handwriting space.
- English and Chinese labels.
- PCDC branding.
- Sufficient separation from Mail Check.
- Other template content and page dimensions.

Federal and State debit dates must fit fully at 9 pt.

Remove the runtime rectangle and border-redrawing
workaround from src/exit-form.mjs.

Exact coordinates must be determined from the actual
template, not estimated.

## Q3: How should blocked-popup links behave?

Decision:

When the browser blocks the Exit Form tab, offer the PDF
beside the corresponding Download Exit Form button.

The link must:
- Be visible without switching tabs.
- Work without requiring contact-detail access.
- Belong to the originating user, case and review.
- Have the correct PDF filename.
- Expire after approximately 60 seconds.
- Explain how to regenerate the PDF.

Preserve existing staff authorization and Return to
signing behavior.

Making or downloading the form must not change the case.

## Q4: How should the click handler be corrected?

Exploration confirmed that draftOffers.drop() clears
the offer without immediately revoking the Blob URL.

The Blob URL is normally revoked by the lifetime timer.
An outstanding offer is also revoked when its owner
changes or signs out.

Alternatives considered:

A. Remove the anchor synchronously inside its click
   handler, as in the initial PR implementation.

B. Preserve the browser's default anchor behavior and
   clear the offer without synchronous DOM removal.

C. Replace native downloading with a separate custom
   download mechanism.

Decision:
Prefer B, consistent with the existing draft mechanism.

The implementation must also ensure that stale links
are cleared after use, expiry, or an authorization
change without interrupting the download.

If additional cleanup is necessary, determine its
timing using browser tests.

Do not introduce a custom download mechanism unless
the native mechanism cannot satisfy the requirements.

## Q5: How should the behavior be verified?

Decision:

Keep the existing Chrome PDF preview, failure and retry
checks.

Extend blocked-popup verification to both staff browsers,
rather than leaving it inside the Chrome-only branch.

Use Playwright's download event to verify:
- The actual download starts.
- The suggested filename is correct.
- The downloaded bytes begin with %PDF-.
- The file parses as a valid one-page PDF.
- Case stage and revision remain unchanged.

Cover authorized volunteers without contact access,
offer expiration and isolation, ordinary Draft 13614-C
behavior, and Return to signing regression risks.

Use fictional data exclusively.

Inspect both populated and blank PDF templates visually.
Preserve the existing PCDC logo without modification.

## Q6: How should the OpenSpec requirements be updated?

Decision:

Create a formal change named
fix-exit-form-download-and-layout.

Modify the existing review-and-corrections capability.

The two affected requirements are:
- Staff make the Exit Form in the browser and nothing
  is kept.
- The Exit Form's values fit their places.

Restore the canonical baseline for these requirements
before archive applies the complete MODIFIED deltas.

Preserve unrelated scenarios and known-problem notes.

Do not use direct canonical spec edits as a substitute
for the archive process.

## Q7: Dependencies and workflow constraints

Ready:
- Existing PDF generation implementation.
- Existing PDF template.
- OpenSpec CLI 1.17.0.
- Project superpowers-bridge schema.
- Playwright browser test infrastructure.
- Existing GitHub PR #281.

Mockable:
- Blocked browser popup.
- Font fetching using existing local test fixtures.
- Fictional client and review data.

Unknown until inspected:
- Exact vector coordinates in the PDF template.
- Whether additional PDF editing tools are required.
- Whether any deferred DOM cleanup is necessary.

Tooling limitation:
Claude Code authentication is unavailable because the
account subscription has expired.

The user has opted to proceed with manual planning using
OpenSpec CLI and ChatGPT.

No Superpowers skill execution is claimed.
Manual implementation remains subject to the project's
workflow requirements and team approval of any deviation.
Record all actual workflow deviations in retrospective.md.

Do not change the project's schema configuration.

## Q8: Branch and delivery

Decision:

Continue using issue-122-exit-form-fixes and the existing
draft PR #281.

The latest origin/main has been merged locally.

Preserve Issue #157's stash and backup references.
Do not modify the Issue #239 branch.

Do not create another PR or merge PR #281.

## Acceptance criteria

- The corrected Exit Form tab title remains intact.
- A blocked popup offers a visible, usable PDF link.
- Chrome and Firefox staff windows can download the PDF.
- Download filename and PDF content are verified.
- User, case and review isolation are preserved.
- Offer expiration and cleanup work correctly.
- Both debit dates fit at 9 pt.
- The template has consistent borders and underlines.
- Blank date fields remain suitable for handwriting.
- Existing Draft 13614-C and Return to signing
  behavior remains intact.
- No unrelated case state changes occur.
- Unit tests and applicable browser tests pass.
- OpenSpec validation passes.
- The complete change is verified and archived.

## Design approval

The user approved this design on 2026-11-26.

This document manually captures the agreed design from
the conversation. It is not output from an executed
Superpowers brainstorming skill.
