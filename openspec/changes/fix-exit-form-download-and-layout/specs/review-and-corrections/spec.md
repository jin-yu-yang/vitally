## MODIFIED Requirements

### Requirement: Staff make the Exit Form in the browser and nothing is kept

Only a staff window SHALL be able to make the Exit Form. The form SHALL be built in the browser from the approved review's questionnaire and the case, or, after a Return to signing, from the case alone (see "The Exit Form after a Return to signing prints only what ViTally holds"). It SHALL NOT be uploaded or stored. Pressing "Download Exit Form" SHALL open the PDF in a new tab. If the form can't be made, the tab SHALL say "The Exit Form could not be made. Close this tab and try again.", the case page's error notice SHALL say "The Exit Form could not be made. Try again.", and the notice's Try again SHALL build it again. Making the form SHALL NOT change the case.

If the browser blocks the tab, ViTally SHALL show no error and SHALL offer the finished PDF as a download link beside the matching Download Exit Form button, named `exit-form-<client number>.pdf`. The link SHALL be available without requiring access to contact details. The tab SHALL NOT switch.

The offered link SHALL be scoped to its originating user, case and review. Its address SHALL be revoked after about 60 seconds. The page SHALL explain how to regenerate the form.

Activating the offered link SHALL download the PDF without changing the case. Cleaning up the offer SHALL NOT interrupt the browser's download.

#### Scenario: The form opens in a new tab

- **WHEN** a reviewer presses "Download Exit Form" on an approved review
- **THEN** a new tab shows a one-page PDF, and the case's stage and revision are unchanged

#### Scenario: A blocked tab offers the link beside the button

- **WHEN** the office presses "Download Exit Form" on the Overview tab and the browser blocks the new tab
- **THEN** no error shows, a download link appears beside the matching button, and the tab does not switch

#### Scenario: Contact access is not needed for the Exit Form link

- **WHEN** an authorized volunteer who may not see the case's contact details uses an available Exit Form button and the browser blocks the tab
- **THEN** the same download link is offered beside that button without revealing contact details

#### Scenario: The offered link downloads the PDF

- **WHEN** an authorized staff member activates the blocked-popup Exit Form link in Chrome or Firefox
- **THEN** the browser downloads a valid one-page PDF named `exit-form-<client number>.pdf`, and the case's stage and revision are unchanged

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
- **THEN** the tab and the error notice say so, and pressing the notice's Try again once the cause is gone makes the form

#### Scenario: A client window makes nothing

- **WHEN** a client session reaches the Exit Form's action
- **THEN** no form is made, and no client screen offers the button

### Requirement: The Exit Form's values fit their places

Filled values SHALL be drawn in bold, except a value with a character Helvetica can't draw (Chinese, or a letter like "ễ" or "Ł"), which SHALL be drawn entirely in the downloaded font. The tax year, the date, the client number, the name and the amounts SHALL start larger than the form's 12 pt English labels. The Remarks SHALL start at 12 pt, and a debit date at 9 pt. A value wider than its place SHALL be drawn smaller, down to 6 pt, and if it still doesn't fit, SHALL be cut and end in "…". This applies to filled values, and most affects the Remarks, which are drawn on one line.

Federal and State debit dates SHALL fit in full at 9 pt. The date areas SHALL preserve consistent borders, date underlines, readable bilingual labels and separation from the Mail Check checkbox. Empty date areas SHALL remain suitable for handwriting.

Known problem, see #122: the reviewer may enter up to 2000 characters of Remarks, which can be more than the line holds, and the reviewer is not told when the rest is cut. This records current behaviour, not the intended one.

#### Scenario: Header values and amounts are bold and larger than the labels

- **WHEN** the form shows a tax year, a date, a client number, the name Mei Chen and a Federal amount
- **THEN** each is drawn in bold, larger than 12 pt

#### Scenario: A name Helvetica can't draw is not bold

- **WHEN** the taxpayer's first name has a character Helvetica can't draw
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
