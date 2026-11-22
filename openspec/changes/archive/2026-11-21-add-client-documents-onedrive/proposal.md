## Why

PCDC clients need a secure and clear way to send their tax documents to the office. Client documents should be uploaded directly through PCDC's OneDrive file request link, rather than stored in ViTally.

ViTally should help clients find the correct upload link and track the progress of requested documents without collecting or storing taxpayer files. A client's statement that a document was uploaded is not proof that PCDC received it. Staff must independently confirm receipt and verification.

## What Changes

- **OneDrive is the document destination.** Client Intake document cards and document requests provide a link to PCDC's OneDrive file request. ViTally does not upload or store taxpayer document files.

- **Client upload link.** The site coordinator configures the client documents URL in Season settings. A new applicant-safe RPC, `vitally_client_documents_link()`, returns only this URL, without exposing the separate certificate upload URL.

- **Client confirmation.** After uploading through OneDrive, clients can select "I've uploaded it." This records their report in ViTally but does not automatically confirm that PCDC received the document.

- **Staff verification.** Staff can record that a document was received and subsequently verify it. Clients cannot mark documents as received or verified or reverse staff-confirmed statuses.

- **Document status tracking.** Document cards support the statuses `sent`, `received`, and `verified`, alongside existing incomplete or not-needed states. Document requests retain their receipt and verification workflow.

- **Missing upload link.** If no client documents URL is configured, ViTally directs clients to contact or bring documents to PCDC rather than presenting an unusable upload button.

- **Client languages.** The upload instructions, confirmation actions, and document status messages support the application's client languages.

## Capabilities

### New Capabilities

- `client-document-onedrive-upload`: Clients can open the PCDC OneDrive file request and report that documents have been uploaded without transferring document files through ViTally.

### Modified Capabilities

- Client document requests and intake document cards distinguish client-reported uploads from staff-confirmed receipt and verification.
- Season settings provide an applicant-safe read of the client upload URL without exposing staff-only configuration data.

## Impact

- **Database:** Migration `056_onedrive_client_documents.sql` adds the client-link RPC and adjusts document status and action handling. It builds on migrations 053 and 054 without removing their functionality.

- **Frontend:** Client document cards and document requests use the OneDrive link and show the appropriate confirmation and verification states.

- **Security:** Taxpayer document bytes and client-supplied filenames are not uploaded to ViTally. The certificate upload URL is not exposed to clients. Database permissions enforce the separation between client reports and staff confirmations.

- **Testing:** Unit tests, database tests, browser tests, and the existing GitHub CI checks validate the workflow and prevent regressions.

- **Documentation:** Developer documentation explains the OneDrive workflow, RPC permissions, document statuses, and deployment requirements.

- **Deployment:** Migration 056 must be applied after migrations 053 to 055.

- **Issue:** Closes #157.
