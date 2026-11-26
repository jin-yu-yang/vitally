## ADDED Requirements

### Requirement: Staff generate and download the Exit Form without storing it

Only staff SHALL generate the Exit Form, in the browser. The form SHALL open in a new tab, with a native download link as the blocked-popup fallback. The offer SHALL be scoped to the originating user, case and review, and its address SHALL be revoked after about 60 seconds. Making or downloading the form SHALL leave the case unchanged. The form SHALL NOT be uploaded or stored.

#### Scenario: The form uses the applicable review or case values

- **WHEN** staff generate the Exit Form
- **THEN** the browser SHALL use the approved review's questionnaire and the case, or, after a Return to signing, the case alone under “The Exit Form after a Return to signing prints only what ViTally holds”

#### Scenario: The form opens in a new tab

- **WHEN** a reviewer presses "Download Exit Form" on an approved review
- **THEN** a new tab shows a one-page PDF, and the case's stage and revision are unchanged

#### Scenario: A blocked tab offers the link beside the button

- **WHEN** the office presses "Download Exit Form" on the Overview tab and the browser blocks the new tab
- **THEN** no error shows, a download link appears beside the matching button, the tab does not switch, and the page explains how to regenerate the form

#### Scenario: Contact access is not needed for the Exit Form link

- **WHEN** an authorized volunteer who may not see the case's contact details uses an available Exit Form button and the browser blocks the tab
- **THEN** the same download link is offered beside that button without revealing contact details

#### Scenario: The offered link downloads the PDF

- **WHEN** an authorized staff member activates the blocked-popup Exit Form link in Chrome or Firefox
- **THEN** the browser downloads a valid one-page PDF named `exit-form-<client number>.pdf`, and the case's stage and revision are unchanged
- **AND** clearing the offer SHALL NOT interrupt the browser's download

#### Scenario: The offer belongs to its maker and review

- **WHEN** the displayed user, case or review does not match the originating offer
- **THEN** that Exit Form download link is not offered in the displayed context

#### Scenario: The link stops working

- **WHEN** about 60 seconds have passed since the form was made
- **THEN** the link's address is revoked and the expired link is no longer offered

#### Scenario: The form can be regenerated

- **WHEN** an authorized staff member needs the form again after its offered link expires
- **THEN** pressing Download Exit Form again makes a new PDF

#### Scenario: A failure says so and can be tried again

- **WHEN** the form can't be made
- **THEN** the tab SHALL say “The Exit Form could not be made. Close this tab and try again.” and the case page's error notice SHALL say “The Exit Form could not be made. Try again.”
- **AND** pressing the notice's Try again once the cause is gone SHALL build the form again

#### Scenario: A client window makes nothing

- **WHEN** a client session reaches the Exit Form's action
- **THEN** no form is made, and no client screen offers the button

### Requirement: The Exit Form renders readable values within its template

Filled values SHALL be bold unless Helvetica cannot draw a character, in which case the entire value SHALL use the downloaded font. Federal and State debit dates SHALL fit in full at 9 pt. Their areas SHALL preserve consistent borders, underlines, readable bilingual labels and separation from Mail Check. Empty date areas SHALL remain suitable for handwriting.

#### Scenario: Filled values shrink to fit their places

- **WHEN** the form lays out the tax year, form date, client number, name or amounts
- **THEN** those values SHALL start larger than the form's 12 pt English labels, Remarks SHALL start at 12 pt, and debit dates SHALL start at 9 pt
- **AND** a filled value wider than its place SHALL shrink to fit, down to 6 pt, and SHALL be cut and end in “…” if it still does not fit
- **AND** Remarks SHALL occupy one line

#### Scenario: Header values and amounts are bold and larger than the labels

- **WHEN** the form shows a tax year, a date, a client number, the name Mei Chen and a Federal amount
- **THEN** each is drawn in bold, larger than 12 pt

#### Scenario: A name Helvetica can't draw is not bold

- **WHEN** the taxpayer's first name has a character Helvetica can't draw, such as a Chinese character, ễ or Ł
- **THEN** the whole name is drawn in the downloaded font, not in bold

#### Scenario: A debit date is readable

- **WHEN** the form shows the Federal or State debit date 04/15/2027
- **THEN** the full date is drawn at 9 pt without overlapping the labels, borders or Mail Check checkbox

#### Scenario: Empty debit dates preserve the template layout

- **WHEN** the form contains no Federal or State debit date
- **THEN** the date areas retain their borders, underlines and handwriting space

#### Scenario: A short remark is drawn whole

- **WHEN** the Remarks are "Bring the corrected W-2."
- **THEN** the form shows them whole, at 12 pt

#### Scenario: A longer remark is drawn smaller

- **WHEN** the Remarks are wider than their place at 12 pt but fit at 6 pt
- **THEN** the form shows them whole, smaller than 12 pt and at least 6 pt

#### Scenario: A remark too long for the line is cut (known problem, #122)

- **WHEN** the Remarks are 2000 characters
- **THEN** the form shows the start of them at 6 pt, ending in "…"
- **AND** the reviewer is not told that the rest was cut. This records current behaviour, not the intended one.

## REMOVED Requirements

### Requirement: Staff make the Exit Form in the browser and nothing is kept

**Reason**: The known-problem scenarios describe a hidden or missing blocked-popup download link. The successor specifies the corrected behavior and safe download lifecycle. OpenSpec 1.17.0 cannot replace scenario headings under MODIFIED.

**Migration**: Use “Staff generate and download the Exit Form without storing it” for future specification and test traceability. Existing case data and caller interfaces require no migration.

### Requirement: The Exit Form's values fit their places

**Reason**: The known-problem scenario describes a full debit date shrinking to 6.5 pt. The successor specifies full 9 pt dates and preserved template geometry. OpenSpec 1.17.0 cannot replace scenario headings under MODIFIED.

**Migration**: Use “The Exit Form renders readable values within its template” for future specification and test traceability. Existing case data and caller interfaces require no migration.
