## 1. Preparation and baseline

- [x] 1.1 Confirm the approved planning artifacts and permitted manual implementation workflow.
- [x] 1.2 Confirm the branch, latest main baseline and preservation of unrelated work.
- [x] 1.3 Read the relevant archived Exit Form and Return to signing designs.
- [x] 1.4 Restore the two affected canonical requirements to their current main baseline before archive.
- [x] 1.5 Confirm that no unrelated requirements or source files are changed.

## 2. PDF template layout

- [x] 2.1 Inspect the original PDF template geometry, border widths, underlines and adjacent checkbox positions.
- [x] 2.2 Add or strengthen tests for full Federal and State debit dates at 9 pt.
- [x] 2.3 Adjust only the necessary vector geometry in src/forms/exit-form-pcdc.pdf.
- [x] 2.4 Update the date placement and width in src/exit-form.mjs.
- [x] 2.5 Remove the runtime debit-date border replacement workaround.
- [x] 2.6 Verify populated and blank PDF rendering, including border consistency, labels, underlines and handwriting space.
- [x] 2.7 Run Exit Form PDF and Return to signing regression tests.

## 3. Blocked-popup download lifecycle

- [x] 3.1 Inspect the existing draft offer lifecycle, redraw behavior and authorization boundaries.
- [x] 3.2 Add regression coverage for native download behavior and offer cleanup.
- [x] 3.3 Remove synchronous anchor replacement from the download click path.
- [x] 3.4 Ensure used or expired links are cleared without interrupting downloading.
- [x] 3.5 Verify user, case and review isolation, expiration and regeneration.
- [x] 3.6 Verify authorized volunteers without contact access can obtain the Exit Form.
- [x] 3.7 Preserve ordinary Draft 13614-C behavior and existing staff authorization.

## 4. Browser verification

- [x] 4.1 Separate blocked-popup download coverage from Chrome-only PDF preview coverage.
- [x] 4.2 Verify actual Exit Form downloads in Chrome staff windows.
- [x] 4.3 Verify actual Exit Form downloads in Firefox staff windows.
- [x] 4.4 Assert the expected filename, PDF signature and one-page PDF validity.
- [x] 4.5 Verify that generation and downloading leave case stage and revision unchanged.
- [x] 4.6 Preserve the existing tab title, error-handling and retry tests.
- [x] 4.7 Confirm browser routes and popup overrides are cleaned up.

## 5. Implementation review and verification

- [x] 5.1 Review the complete implementation against the design and delta requirements.
- [x] 5.2 Run the full unit test suite.
- [x] 5.3 Run applicable browser tests locally or obtain acceptable CI evidence.
- [x] 5.4 Inspect the PDF and relevant browser visual evidence.
- [x] 5.5 Run strict OpenSpec validation and inspect whitespace errors.
- [x] 5.6 Confirm the implementation diff contains no unrelated changes.
- [x] 5.7 Commit the reviewed implementation and record its verification evidence.
