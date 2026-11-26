## Why

Issue #122 identifies usability problems in the Exit Form
provided to PCDC clients and staff. Blocked browser popups
can leave staff without a visible download link, while
Federal and State direct debit dates are difficult to read.

The initial implementation in PR #281 improves these
behaviors, but review identified inconsistent PDF borders,
a potentially unsafe download-link cleanup sequence, and
missing OpenSpec change artifacts. Addressing these concerns
will improve the reliability and presentation of the
client-facing form before the pilot.

## What Changes

**Exit Form download fallback**

- From: A blocked popup offers a link in the Intake answers
  tab, which may be hidden or unavailable to the staff member.
- To: Offer a visible download link beside the corresponding
  Download Exit Form button.
- Reason: Staff must be able to obtain the PDF without
  switching tabs or requiring contact-detail access.
- Impact: Non-breaking usability improvement for authorized
  staff.

**Download link lifecycle**

- From: The initial PR removes the anchor synchronously
  during its click event.
- To: Preserve native browser downloading and clean up the
  offer without interrupting the download.
- Reason: Avoid potential browser-dependent download failures.
- Impact: Preserve existing authorization, isolation and
  expiration behavior.

**Debit date readability**

- From: The original template fits full debit dates at
  approximately 6.5 pt. The initial PR adds replacement
  borders at runtime to accommodate 9 pt dates.
- To: Adjust the original PDF template so both debit dates
  fit fully at 9 pt without runtime border replacement.
- Reason: Improve readability while preserving the original
  template's visual consistency and handwriting space.
- Impact: Client-facing PDF presentation only.

**Browser verification**

- Verify actual blocked-popup PDF downloads in both Chrome
  and Firefox staff windows.
- Preserve existing preview, failure and retry coverage.
- Verify filename, PDF validity and unchanged case state.

**Existing tab title fix**

- Preserve the corrected Exit Form tab title introduced
  by PR #125.

Items 1, 2 and 6 of Issue #122 remain out of scope.
No database, RPC or tax workflow changes are included.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `review-and-corrections`: Update Exit Form blocked-popup
  download requirements and debit date layout requirements.

## Impact

Affected implementation:
- src/forms/exit-form-pcdc.pdf
- src/exit-form.mjs
- src/app.mjs
- src/staff-views.mjs, if required

Affected tests:
- tests/exit-form.test.mjs
- tests/browser.mjs
- tests/shell.test.mjs
- Existing draft and staff-view regression tests, as needed

Affected specification:
- openspec/specs/review-and-corrections/spec.md

No new runtime dependencies, database migrations,
RPC changes or external service integrations.

The complete OpenSpec change will be archived and included
in the existing PR #281.
