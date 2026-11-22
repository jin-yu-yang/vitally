## 1. Database migration

- [x] 1.1 Create the OneDrive client document migration.
- [x] 1.2 Rename the migration to `056_onedrive_client_documents.sql` to avoid conflicts with migrations 053 to 055.
- [x] 1.3 Preserve migration 054's `RETURN_TO_SIGNING` payload validation.
- [x] 1.4 Add the applicant-safe `vitally_client_documents_link()` RPC.
- [x] 1.5 Remove the RPC's STABLE declaration to avoid read-only transaction errors.
- [x] 1.6 Extend document-card statuses to support sent, received, and verified.
- [x] 1.7 Restrict client actions so they cannot confirm or undo staff-verified documents.
- [x] 1.8 Run migration 056 against a fresh database containing migrations 053 to 055.

## 2. Client document workflow

- [x] 2.1 Display the configured PCDC OneDrive file request link.
- [x] 2.2 Provide an "I've uploaded it" action for client document cards.
- [x] 2.3 Allow clients to report responses to document requests without supplying filenames.
- [x] 2.4 Keep client-reported uploads separate from staff receipt and verification.
- [x] 2.5 Provide fallback instructions when no OneDrive URL is configured.
- [x] 2.6 Update English, Simplified Chinese, and Traditional Chinese client messages.

## 3. Staff document workflow

- [x] 3.1 Allow staff to record that a document was received.
- [x] 3.2 Keep receipt and verification as separate steps.
- [x] 3.3 Prevent clients from changing staff-confirmed statuses.
- [x] 3.4 Update staff-facing document status messages.

## 4. Security and database tests

- [x] 4.1 Add the new RPC to the public database catalog test.
- [x] 4.2 Classify the RPC as a read operation in the database tests.
- [x] 4.3 Update the staff document receipt message assertion.
- [x] 4.4 Add regression tests for document status permissions and payload validation.
- [x] 4.5 Confirm database integration tests pass against the migrated database.
- [x] 4.6 Verify the client RPC does not expose the certificate upload URL.

## 5. Browser and regression tests

- [x] 5.1 Run the JavaScript test suite: 2,229 tests passed locally.
- [x] 5.2 Run Chrome client browser integration tests.
- [x] 5.3 Run Firefox client browser integration tests.
- [x] 5.4 Run sign-in integration tests.
- [x] 5.5 Investigate and resolve any remaining HTTP 405 errors. Investigated, not reproducible: no HTTP 405 was ever observed (ManQi, Nov 21). The logs of CI runs 44968312239 and 44975200752 contain none, and the only 405s in the repo are intended (`server.mjs` refusing methods other than GET/HEAD, covered by `tests/server.test.mjs`; the `accounts` Edge Function refusing non-POST), neither changed by this PR. No API change needed.
- [x] 5.6 Confirm all GitHub Actions checks pass.

## 6. Documentation and OpenSpec

- [x] 6.1 Update developer documentation for the OneDrive workflow.
- [x] 6.2 Create the OpenSpec proposal.
- [x] 6.3 Create the OpenSpec technical design.
- [x] 6.4 Create the OpenSpec implementation task list.
- [x] 6.5 Add formal OpenSpec requirements and scenarios.
- [x] 6.6 Run OpenSpec validation successfully.

## 7. Final review and delivery

- [x] 7.1 Review the complete diff against the latest main branch. Claude Code, Nov 21, against `601b650`. Permissions: a client acts only on their own case, and staff go through `works_on_case` in `check_authority`. Clients can't set `received` / `verified` or change a card once it has one. `vitally_client_documents_link` returns only the client link. Transitions: 056's five functions differ from their last versions (054, 036, 017, 004) only in the intended lines. The new status constraint accepts every existing value (`not_done` is stored as null). Caching: the link is read on load, on wake and after a Settings save, and becomes null if a read fails. Nits fixed in the same pass: a stale 046 comment, two unused text keys, an unused staff `clientDocumentsUrl`, and the clock icon on a verified document. Final review: Zeye.
- [x] 7.2 Commit the fixes to `issue-157-onedrive-documents`.
- [x] 7.3 Push the branch to update PR #245.
- [x] 7.4 Confirm CI passes and address outstanding reviewer comments.
- [x] 7.5 Mark PR #245 ready for review after all required checks pass.
