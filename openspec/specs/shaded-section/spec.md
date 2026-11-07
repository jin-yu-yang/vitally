# shaded-section Specification

## Purpose
The preparer's part of Form 13614-C, the shaded section "To be completed by certified volunteer": its 106 fields and the values each one allows, who may save it and at which stages, how a save replaces the section and how a stale save is refused, the staff history line that names the changed fields, the editing copy and the two ways to fill it (the editor on the case page, and download and upload), and who can read the saved values (staff only).

## Requirements

### Requirement: The shaded section has 106 fields in every form
The system SHALL treat exactly 106 fields of Form 13614-C as the shaded section ("To be completed by certified volunteer"):
- on page 1, five cells for each of household rows 1 to 4: qualifying child or dependent, provided more than 50% of own support, had less than $5,200 of income, taxpayer provided more than 50% of support, and taxpayer paid more than half the cost of maintaining a home;
- on page 2, the 47 Income to be included fields and their notes;
- on page 3, the Standard or itemized deductions, Expenses to report, and Information to report fields, and each block's notes.

Each field SHALL have one stable key. The same key SHALL name the field in the English, Simplified Chinese and Traditional Chinese forms, whatever the form's own field name. The forms' names differ only for the energy-efficient home improvement box.

#### Scenario: Every key names a field in all three forms
- **WHEN** the 106 keys are looked up in the English, Simplified Chinese and Traditional Chinese 13614-C forms
- **THEN** every key names exactly one field in each form, and no shaded field of any form is left without a key

#### Scenario: The one name that differs
- **WHEN** the energy-efficient home improvement box is looked up
- **THEN** its key names `informationToReport[0].efficientHomeImprovement[0].efficientHomeImprovement[0]` on the English form and `informationToReport[0].efficientHomeImprovement[0]` on both Chinese forms

### Requirement: Shaded values follow the rules of their field
A saved shaded section SHALL hold only filled values. A field left blank SHALL be absent, and a checkbox SHALL be stored only when ticked. Each value SHALL follow its field's rule, or the save SHALL be refused with `VALIDATION`, changing nothing:
- a household cell: Yes, No or N/A. Typed `Y`, `yes`, `N`, `no`, `N/A` or `NA`, in any case, SHALL be read as one of them;
- a checkbox: ticked. A pair's Yes and No SHALL NOT both be ticked. The pairs are itemized last year, capital loss carryover, alimony excluded from income, and alimony payments as an adjustment to income;
- a count ("#"): a whole number from 0 to 99;
- an amount ("$"): a whole number of dollars from 0 to 999999, with up to two decimal places. A `$` and commas SHALL be ignored when it is read;
- the VIN: 1 to 17 letters and digits;
- the year disallowed: a four-digit year from 2000 through the year before the case's season (the workspace's current season if the case has none);
- the reason disallowed: 1 to 120 characters;
- each block's notes: 1 to 500 characters, line breaks allowed.

Text MAY be in any language. A key outside the 106 SHALL be refused. A household cell SHALL be refused on a row with no household member. The browser SHALL apply these rules before sending and SHALL name the field it refuses. The database SHALL remain the authority.

#### Scenario: A typed answer is read as its value
- **WHEN** the preparer types `y` in row 1's qualifying child cell and `n/a` in its own support cell, and saves
- **THEN** the saved section holds Yes and N/A for those cells

#### Scenario: A word that isn't Yes, No or N/A
- **WHEN** the preparer types `maybe` in row 1's qualifying child cell and saves
- **THEN** the save is refused, the browser names that cell, and nothing is stored

#### Scenario: Both Yes and No
- **WHEN** the preparer ticks both Yes and No for "Itemized last year" and saves
- **THEN** the save is refused with `VALIDATION`, and the stored section is unchanged

#### Scenario: An amount with a dollar sign
- **WHEN** the preparer enters `$1,250.50` as the refund amount and saves
- **THEN** the saved section holds `1250.50`

#### Scenario: A count out of range
- **WHEN** the preparer enters `120` as the number of W-2s and saves
- **THEN** the save is refused with `VALIDATION`

#### Scenario: A year in the case's own season
- **WHEN** the preparer enters 2026 as the year disallowed on a case whose season is 2026
- **THEN** the save is refused with `VALIDATION`, and 2025 is accepted

#### Scenario: A row with no household member
- **WHEN** the preparer fills a row 3 cell on a case whose household has two members, and saves
- **THEN** the save is refused with `VALIDATION`, and the browser names row 3

#### Scenario: A note in Chinese
- **WHEN** the preparer writes "收入说明：一份 W-2" in the income notes and saves
- **THEN** the note is stored as typed

### Requirement: Only the case's preparer saves the shaded section, while preparing
`SAVE_PREPARER_FIELDS` SHALL be accepted only from the case's preparer: the person who holds the `prepare` capability, is the case's preparer, and is one of its preparation participants. It SHALL be accepted only at Filing in progress (`preparing`) and at Corrections in progress (`corrections_required`). The reviewer, an admin who isn't the case's preparer, and every other staff member SHALL be refused. At any other stage, including On hold, the save SHALL be refused with `INVALID_TRANSITION`. A refused save SHALL change nothing.

The case page SHALL offer the shaded-section tools ("Fill the shaded section", "Download to fill elsewhere" and "Upload the filled copy") only when a save would be accepted. Otherwise it SHALL say why, in place.

#### Scenario: The case's preparer at Filing in progress
- **WHEN** Alex, the case's preparer, saves the shaded section on a case at Filing in progress
- **THEN** the save is accepted

#### Scenario: The reviewer is refused
- **WHEN** Morgan, the case's reviewer, sends `SAVE_PREPARER_FIELDS` on a case at Corrections in progress
- **THEN** the database refuses it, and nothing is stored

#### Scenario: After Send to review
- **WHEN** the case's preparer sends `SAVE_PREPARER_FIELDS` on a case at Pending review
- **THEN** the database refuses it with `INVALID_TRANSITION`, and the case page offers no shaded-section tools

### Requirement: A save replaces the section, and a stale save is refused
`SAVE_PREPARER_FIELDS` SHALL carry exactly the whole set of filled values and the version it was based on. An accepted save SHALL replace the case's stored section and raise its version by one. A case with no saved section SHALL be at version 0. A save whose version is not the stored version SHALL be refused with `CONFLICT`, changing nothing. A save SHALL NOT be refused because the case changed in other ways since the preparer started. A save MAY leave every field blank, and it MAY save no change.

#### Scenario: Another action on the case doesn't block the save
- **WHEN** the office logs a contact on the case while the preparer is filling the shaded section, and the preparer then saves
- **THEN** the save is accepted

#### Scenario: A save from a second window
- **WHEN** the preparer saves the section in one window, then saves in a second window that was opened before that save
- **THEN** the second save is refused with `CONFLICT`, and the first window's values stay stored

#### Scenario: A partial save
- **WHEN** the preparer fills only the household table and saves
- **THEN** the save is accepted, and the other fields stay blank

### Requirement: A save records which fields changed, for staff only
Each accepted save SHALL add one staff history line naming the fields whose values changed, by their English labels, and never the values. A save that changed nothing SHALL say "no fields changed". A save SHALL add no client history line and no client message.

#### Scenario: Changes after review are visible
- **WHEN** the preparer changes the number of W-2s and the income notes on a case at Corrections in progress
- **THEN** the case's History shows that the shaded section was saved, naming "W-2s #" and "Income notes", with neither value
- **AND** the client's history has no new line

### Requirement: Only staff can read the shaded section
The saved shaded section SHALL be readable only by staff, under the same rule as the preparer questionnaire. A client session SHALL read none of it, and SHALL receive no realtime change that carries it. A client SHALL NOT be able to make the 13614-C editing copy, as for the draft 13614-C.

#### Scenario: A client reads nothing
- **WHEN** a signed-in client reads the shaded-section table for their own case
- **THEN** no row is returned

### Requirement: The editing copy keeps only the shaded fields fillable
The system SHALL make an editing copy of the English 13614-C for the case's preparer. It SHALL show the client's answers as the draft does, and SHALL keep exactly the 106 shaded fields fillable, already holding the saved values. Every other field SHALL be flattened. The copy SHALL be built for any client answers the draft supports, including names and addresses in Chinese, and with saved notes in Chinese. The editing copy SHALL never be uploaded or stored.

#### Scenario: Only the shaded fields are fillable
- **WHEN** the editing copy is built for a case
- **THEN** it has exactly 106 form fields, the shaded ones, and the client's answers are drawn on the pages

#### Scenario: A client with a Chinese name
- **WHEN** the editing copy is built for a client whose first name is "美玲" and whose saved income note is in Chinese
- **THEN** it builds without an error, with exactly the 106 shaded fields fillable

### Requirement: The preparer can fill the section elsewhere and upload it
The case page SHALL offer "Download to fill elsewhere", which saves the editing copy, with the note "Open it in Chrome or the free Adobe Acrobat Reader, not macOS Preview." beside it. It SHALL also offer "Upload the filled copy", which reads a chosen PDF in the browser. The downloaded copy SHALL carry the case's reference and the section version it was made from.

An uploaded copy SHALL be refused, in place beside the upload control and saving nothing, when:
- it has none of the shaded fields. It SHALL then say "This copy has no form fields. In Chrome, use the download button, not Print.";
- it was made for another case;
- any value breaks its field's rule, naming the field;
- it has the shaded fields but no filled value. It SHALL then say "No filled values were found in this copy. If you filled it in macOS Preview, fill it again in Chrome or Adobe Acrobat Reader." When the PDF's Producer shows macOS Quartz PDFContext, it SHALL add "This copy was saved by macOS Preview." A blank or whitespace-only text field and an unticked box are not filled; a count of 0 is.

When a copy passes every check above, the upload SHALL NOT save it yet. In place of the upload control, the case page SHALL show "Check what was read from this copy" with:
- the number of filled fields, as "<n> filled fields:" or "1 filled field:";
- every filled field, in the form's order, as its label and value: "ticked" for a checkbox, Yes, No or N/A for a household cell, a note in full with its line breaks, and every other value as read;
- when the PDF's Producer shows macOS Quartz PDFContext, the line "This copy was saved by macOS Preview, which can drop or change values. Check them before saving.";
- "Save these values" and "Cancel".

"Save these values" SHALL save exactly the values shown, on the copy's own section version. The save SHALL be refused, in place and saving nothing, when the section was saved since the copy was downloaded (`CONFLICT`). "Cancel" SHALL discard what was read and save nothing. What was read SHALL stay shown when the case page redraws, and SHALL be discarded when another case is opened or the person signs out, and it SHALL never be saved to another case.

The uploaded file SHALL NOT be uploaded to the server or kept.

#### Scenario: A copy filled in another program
- **WHEN** the preparer downloads the editing copy, ticks W-2s and enters 2 as their number in another PDF program, uploads it, and presses "Save these values"
- **THEN** the shaded section is saved with W-2s ticked and 2 W-2s

#### Scenario: What was read is shown before saving
- **WHEN** the preparer uploads a copy with W-2s ticked, 2 W-2s and an income note
- **THEN** the case page shows "Check what was read from this copy", "3 filled fields:", and "W-2s: ticked", "W-2s #: 2" and the income note in that order, and nothing is saved yet

#### Scenario: Cancel saves nothing
- **WHEN** the preparer uploads a filled copy and presses "Cancel"
- **THEN** nothing is saved, and the upload control is offered again

#### Scenario: Another case is opened before saving
- **WHEN** the preparer uploads a filled copy and opens another case before pressing "Save these values"
- **THEN** what was read is discarded, and nothing is saved to either case

#### Scenario: A copy saved by macOS Preview
- **WHEN** the preparer uploads a filled copy whose Producer shows macOS Quartz PDFContext
- **THEN** the summary also says "This copy was saved by macOS Preview, which can drop or change values. Check them before saving.", and "Save these values" is still offered

#### Scenario: A copy with no filled values
- **WHEN** the preparer uploads a copy that has the shaded fields but no filled value
- **THEN** the upload is refused with "No filled values were found in this copy. If you filled it in macOS Preview, fill it again in Chrome or Adobe Acrobat Reader.", and nothing is saved

#### Scenario: An empty copy saved by macOS Preview
- **WHEN** the preparer uploads a copy with no filled value whose Producer shows macOS Quartz PDFContext
- **THEN** the refusal also says "This copy was saved by macOS Preview."

#### Scenario: A printed copy
- **WHEN** the preparer uploads a PDF of the editing copy made with the browser's Print
- **THEN** the upload is refused with "This copy has no form fields. In Chrome, use the download button, not Print.", and nothing is saved

#### Scenario: Another case's copy
- **WHEN** the preparer uploads a copy downloaded from a different case
- **THEN** the upload is refused, and nothing is saved

### Requirement: The preparer fills the section on the form in ViTally
"Fill the shaded section" SHALL open the editing copy in a full-screen editor on the case page, where only the shaded fields can be edited. The editor's Save SHALL save the shaded values and show "Saved" while the editor stays open. Save SHALL be disabled until something changes. The editor SHALL keep the preparer's edits when the case page redraws, when the case changes, and when a save is refused. On a refusal it SHALL say why, and when the refusal is because of the case's stage, Save SHALL stay disabled. Closing an editor with unsaved changes, or leaving the page, SHALL ask first. The editor SHALL be loaded only when it is opened.

#### Scenario: Fill, save and keep working
- **WHEN** the preparer opens "Fill the shaded section", types Yes in row 1's qualifying child cell, ticks W-2s, enters 2 W-2s and presses Save
- **THEN** the editor shows "Saved" and stays open, and the case's History names the changed fields

#### Scenario: The case changes while the editor is open
- **WHEN** the office records materials on the case while the preparer has unsaved edits in the editor
- **THEN** the edits are still there, and pressing Save saves them

#### Scenario: Closing with unsaved changes
- **WHEN** the preparer presses Close after changing a field without saving
- **THEN** the editor asks "Discard your changes?", and keeps the changes unless the preparer confirms

### Requirement: The editor states the browsers it supports
The shaded-section editor SHALL support Chrome and Edge 125 or later, Firefox ESR or later, and Safari 18 or later. The download and upload tools SHALL always be offered beside it. When the editor can't be opened, the error SHALL say so and point to "Download to fill elsewhere".

#### Scenario: The editor can't load
- **WHEN** the editor's files fail to load after the preparer presses "Fill the shaded section"
- **THEN** the case page says the editor couldn't open and to use "Download to fill elsewhere", and the download and upload tools are still offered
