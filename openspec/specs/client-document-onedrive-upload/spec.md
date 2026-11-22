# client-document-onedrive-upload Specification

## Purpose
TBD - created by archiving change add-client-documents-onedrive. Update Purpose after archive.

## Requirements

### Requirement: Client documents go to PCDC OneDrive

ViTally SHALL direct clients to PCDC's configured OneDrive file request link for taxpayer document uploads.

ViTally SHALL NOT receive or store the uploaded taxpayer document files.

The interface SHALL open the configured upload link in a new browser tab.

#### Scenario: Client opens the upload link
- **WHEN** a client has a configured documents upload URL and selects "Upload to PCDC"
- **THEN** the browser opens the configured OneDrive link without transferring the file through ViTally

#### Scenario: No upload link is configured
- **WHEN** the workspace has no client documents upload URL
- **THEN** the client sees instructions to contact or bring documents to PCDC, without an upload button

### Requirement: Clients can read only their document upload URL

`vitally_client_documents_link()` SHALL return the authenticated client's workspace-specific client documents URL.

It SHALL NOT expose the certificate upload URL or the complete Season settings record.

Execute permission SHALL be restricted to authenticated callers, and the RPC SHALL enforce membership authorization.

#### Scenario: Authorized client
- **WHEN** an authenticated client requests the upload link
- **THEN** the response contains only `clientDocumentsUrl` for that client's workspace

#### Scenario: Anonymous caller
- **WHEN** an anonymous caller requests the upload link
- **THEN** access is denied

#### Scenario: Staff-only link remains private
- **WHEN** a client reads their document upload URL
- **THEN** the response contains no certificate upload URL

### Requirement: Client upload reports are not verification

A client SHALL be able to report that a document was uploaded through OneDrive.

For document cards, the report SHALL be represented by the `sent` status.

For document requests, the response SHALL be recorded as awaiting verification.

A client report SHALL NOT automatically mark the document as received or verified.

#### Scenario: Client reports a document-card upload
- **WHEN** a client selects "I've uploaded it" for an eligible document card
- **THEN** the card becomes `sent`, without becoming `received` or `verified`

#### Scenario: Client responds to a document request
- **WHEN** a client reports sending a document for an open request
- **THEN** the request becomes `awaiting_verification`, and staff must verify it separately

#### Scenario: Client attempts to confirm receipt
- **WHEN** a client attempts to set a document-card status to `received` or `verified`
- **THEN** the database rejects the action

### Requirement: Staff controls receipt and verification

Authorized staff SHALL be able to record receipt and verification separately.

Clients SHALL NOT overwrite staff-confirmed document statuses.

A staff-recorded receipt SHALL NOT automatically verify the document.

#### Scenario: Staff records receipt
- **WHEN** authorized staff records a document response for an eligible request
- **THEN** the response is recorded as awaiting verification, and the staff member is identified as the actor

#### Scenario: Staff verifies a document
- **WHEN** an authorized preparer verifies a received document request
- **THEN** the request becomes verified

#### Scenario: Client tries to reverse a confirmed status
- **WHEN** a document card is already marked `received` or `verified` by staff and a client attempts to change it
- **THEN** the database rejects the change and preserves the staff-confirmed status

### Requirement: Document responses do not contain uploaded files

Document response actions SHALL use the document request ID to identify the request.

The caller SHALL NOT be required or permitted to submit a document filename as part of the response payload.

ViTally SHALL record workflow evidence rather than upload or retrieve taxpayer file contents.

#### Scenario: Valid response
- **WHEN** an authorized client responds to an open document request using its request ID
- **THEN** the workflow records the response without receiving document bytes or a client-supplied filename

#### Scenario: Unexpected filename
- **WHEN** a caller includes a filename in the document response payload
- **THEN** the payload is rejected as invalid

### Requirement: Existing application workflows remain compatible

Migration 055 SHALL preserve the Return to signing payload validation introduced in migration 054.

Adding the client documents RPC SHALL NOT remove or change unrelated application RPCs.

#### Scenario: Return to signing with corrected Exit Form
- **WHEN** an authorized staff member submits a valid Return to signing action with corrected Exit Form values
- **THEN** the payload passes the validation introduced in migration 054

#### Scenario: Existing workflows
- **WHEN** the OneDrive migration is applied after migrations 053 and 054
- **THEN** existing clearance, signing, and case-management workflows remain available
