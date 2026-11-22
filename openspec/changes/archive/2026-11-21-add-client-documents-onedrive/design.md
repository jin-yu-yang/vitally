## Context

PCDC clients must send their tax documents through PCDC's OneDrive file request link rather than uploading documents into ViTally.

Migration 052 introduced Season settings, including the client documents upload URL. The existing intake workflow already contains document cards and document requests, but it needs a way to direct clients to OneDrive and distinguish a client's upload report from staff-confirmed receipt.

Migration 053 adds volunteer clearance uploads, while migration 054 changes Return to signing behavior. This change therefore uses migration 056 and must preserve both earlier migrations.

## Goals / Non-Goals

### Goals

- Direct client document uploads to PCDC's OneDrive file request.
- Provide the correct upload link in the client interface.
- Allow clients to report that they uploaded a document.
- Keep client reports separate from staff confirmation and verification.
- Prevent clients from changing staff-confirmed document statuses.
- Protect staff-only configuration and taxpayer information.
- Support the application's client languages.
- Preserve existing case, document request, and review workflows.

### Non-Goals

- Uploading taxpayer document files into ViTally.
- Storing document binary data in ViTally.
- Integrating with the Microsoft Graph or OneDrive API.
- Automatically checking whether a OneDrive upload succeeded.
- Automatically verifying client documents.
- Exposing the staff certificate upload link to clients.

## Decisions

### D1: OneDrive remains the document repository

Clients open the configured PCDC OneDrive file request in a new browser tab.

ViTally does not receive the uploaded file or communicate with OneDrive to inspect it. The application records workflow information rather than storing taxpayer documents.

This separates sensitive document storage from case management.

### D2: Expose only the client documents URL

The database provides:

`public.vitally_client_documents_link()`

This RPC identifies the authenticated user's workspace and returns its configured `clientDocumentsUrl`.

It must never return the staff certificate upload URL or the complete Season settings record.

The function uses the existing membership authorization mechanism. Because that mechanism may acquire database locks, the RPC must not be declared STABLE when PostgREST might execute it inside a read-only transaction.

Clients receive only the URL required for uploading their documents.

### D3: A client upload report is not proof of receipt

After uploading through OneDrive, the client can select "I've uploaded it."

For document cards, the reported status is `sent`.

For document requests, the response is recorded through the existing document action workflow, and the request becomes `awaiting_verification`.

Neither operation verifies that OneDrive actually received a file.

The interface must clearly distinguish a client's report from staff confirmation.

### D4: Staff controls receipt and verification

Only authorized staff may mark document cards as `received` or `verified`.

Clients cannot set these statuses or overwrite staff-confirmed statuses.

A staff-recorded document response records receipt but does not automatically verify the document request. Verification remains a separate staff action.

Database authorization must enforce these rules independently of the user interface.

### D5: Keep the document action payload minimal

For a document request response, the caller supplies a request ID rather than a filename.

ViTally must not accept a client-supplied document filename as proof of an upload.

Any existing document record represents workflow evidence, not the underlying taxpayer file. Legacy database fields are retained where required for compatibility.

### D6: Handle missing configuration safely

If the workspace does not have a configured client documents URL, the application must not display a working upload button.

Instead, clients see instructions to contact or bring documents to PCDC.

A client cannot report a document-card OneDrive upload unless a valid client documents URL has been configured.

### D7: Preserve existing database behavior

Migration 056 extends the document workflow without removing unrelated functionality.

The `check_payload` definition must preserve migration 054's separate `RETURN_TO_SIGNING` validation, including corrected Exit Form values and optional remarks.

Migration 056 must not replace that validation with an older shared confirmation-only branch.

Migration execution order is:

1. 053_clearance_uploads.sql
2. 054_return_to_signing_exit_forms.sql
3. 056_onedrive_client_documents.sql

### D8: Keep the interface and translations consistent

The client interface provides an upload link, an upload-report action, and clear document statuses.

The workflow must work in the supported client languages, including English, Simplified Chinese, and Traditional Chinese.

Staff-facing controls remain consistent with existing document request and verification actions.

### D9: Verify security and regression behavior

Tests must verify that:

- The client RPC returns only the client documents URL.
- Anonymous and unauthorized access is rejected.
- Clients cannot set or undo staff-confirmed statuses.
- Client upload reports do not automatically verify documents.
- Staff can record receipt and perform separate verification.
- Document response payloads do not accept client-supplied filenames.
- Missing upload links are handled safely.
- Migration 054's Return to signing validation remains intact.
- The public RPC catalog includes the new function.
- Existing database, browser, and sign-in workflows continue working.

## Risks / Trade-offs

### Client reports may be inaccurate

A client may click "I've uploaded it" without successfully uploading a file.

Mitigation: The application labels this as a report, and staff independently confirms receipt and verification.

### OneDrive availability is external

ViTally cannot guarantee that OneDrive is reachable or that an upload completed.

Mitigation: Use the configured external file request and provide PCDC contact instructions when necessary.

### Migration compatibility

Overwriting shared SQL functions may accidentally remove behavior introduced by earlier migrations.

Mitigation: Build migration 056 on top of migration 054, preserve unrelated action validation, and run database regression tests.

## Migration Plan

1. Apply migrations 053 to 055 before 056.
2. Apply migration 056 to the test database.
3. Run database and RPC authorization tests.
4. Run browser and sign-in integration tests.
5. Confirm that the new workflow does not store taxpayer document binaries.
6. Deploy migration 056 through the project's existing migration process after review and merge.
