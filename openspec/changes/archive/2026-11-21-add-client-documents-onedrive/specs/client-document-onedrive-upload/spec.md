## ADDED Requirements

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


### Requirement: A client reports an upload only while the client documents link is set

The database SHALL refuse a client's report of an upload, both a document card marked `sent` and a response to a document request, with `INVALID_TRANSITION` while the workspace has no client documents upload link.

The office's recorded receipt (`RECORD_DOCUMENT_RESPONSE`) SHALL NOT require the link.

#### Scenario: No link, client reports a request response
- **WHEN** the workspace has no client documents link and a client responds to an open document request
- **THEN** the action is refused with `INVALID_TRANSITION` and the request stays open

#### Scenario: No link, office records a receipt
- **WHEN** the workspace has no client documents link and authorized staff record a document response on an office case
- **THEN** the request becomes `awaiting_verification`

### Requirement: A mis-marked document card can be taken back

Until staff mark a card `received` or `verified`, a client who marked it `sent` SHALL be offered Later, Don't have and Mark as not done again.

Staff SHALL be offered **Undo received** on a `received` card (back to `sent`) and **Undo verified** on a `verified` card (back to `received`).

#### Scenario: Client takes back a reported upload
- **WHEN** a client's card is `sent` and staff have not confirmed it
- **THEN** the card offers Later, Don't have and Mark as not done, and choosing one replaces `sent`

#### Scenario: Staff undo a verification
- **WHEN** a staff member who may mark the card selects Undo verified
- **THEN** the card becomes `received`

### Requirement: Staff screens carry no OneDrive folder link

Staff screens SHALL NOT link to the client documents upload URL. The link is upload-only; staff open the OneDrive folder themselves.

#### Scenario: A reported upload on the staff checklist
- **WHEN** a card is `sent` or a document request is awaiting verification
- **THEN** the staff screen shows when it was reported, with no "Open upload folder" link

### Requirement: Uploaded files are named with the case reference

The upload instructions SHALL tell the client to name the file with the case's `VT-…` reference, before and after submit, and never with the client number.

#### Scenario: A submitted case with a client number
- **WHEN** a client with client number 47 and reference VT-GJPY-JAY9 sees the upload instructions
- **THEN** the suggested name starts with VT-GJPY-JAY9

### Requirement: The client documents link is read on load and wake

The browser SHALL read the client documents link when the window loads its data, on each wake (focus, tab visible, `online`), and after a Season settings save, and SHALL NOT read it again on every realtime refresh.

#### Scenario: A realtime change
- **WHEN** a realtime change makes the window refresh without a wake
- **THEN** the link is not read again

### Requirement: Existing application workflows remain compatible

Migration 056 SHALL preserve the Return to signing payload validation introduced in migration 054.

Adding the client documents RPC SHALL NOT remove or change unrelated application RPCs.

#### Scenario: Return to signing with corrected Exit Form
- **WHEN** an authorized staff member submits a valid Return to signing action with corrected Exit Form values
- **THEN** the payload passes the validation introduced in migration 054

#### Scenario: Existing workflows
- **WHEN** the OneDrive migration is applied after migrations 053 to 055
- **THEN** existing clearance, signing, and case-management workflows remain available
