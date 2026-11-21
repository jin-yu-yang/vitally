## 1. Database migration

- [x] 1.1 Create the OneDrive client document migration.
- [x] 1.2 Rename the migration to `055_onedrive_client_documents.sql` to avoid conflicts with migrations 053 and 054.
- [x] 1.3 Preserve migration 054's `RETURN_TO_SIGNING` payload validation.
- [x] 1.4 Add the applicant-safe `vitally_client_documents_link()` RPC.
- [x] 1.5 Remove the RPC's STABLE declaration to avoid read-only transaction errors.
- [x] 1.6 Extend document-card statuses to support sent, received, and verified.
- [x] 1.7 Restrict client actions so they cannot confirm or undo staff-verified documents.
- [ ] 1.8 Run migration 055 against a fresh database containing migrations 053 and 054.

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
- [ ] 4.5 Confirm database integration tests pass against the migrated database.
- [ ] 4.6 Verify the client RPC does not expose the certificate upload URL.

## 5. Browser and regression tests

- [x] 5.1 Run the JavaScript test suite: 2,229 tests passed locally.
- [ ] 5.2 Run Chrome client browser integration tests.
- [ ] 5.3 Run Firefox client browser integration tests.
- [ ] 5.4 Run sign-in integration tests.
- [ ] 5.5 Investigate and resolve any remaining HTTP 405 errors.
- [ ] 5.6 Confirm all GitHub Actions checks pass.

## 6. Documentation and OpenSpec

- [x] 6.1 Update developer documentation for the OneDrive workflow.
- [x] 6.2 Create the OpenSpec proposal.
- [x] 6.3 Create the OpenSpec technical design.
- [x] 6.4 Create the OpenSpec implementation task list.
- [ ] 6.5 Add formal OpenSpec requirements and scenarios.
- [ ] 6.6 Run OpenSpec validation successfully.

## 7. Final review and delivery

- [ ] 7.1 Review the complete diff against the latest main branch.
- [ ] 7.2 Commit the fixes to `issue-157-onedrive-documents`.
- [ ] 7.3 Push the branch to update PR #245.
- [ ] 7.4 Confirm CI passes and address outstanding reviewer comments.
- [ ] 7.5 Mark PR #245 ready for review after all required checks pass.
