## ADDED Requirements

### Requirement: The Exit Form after a Return to signing prints only what ViTally holds
When a Return to signing came after a review's approval (by the case's staff history), that review's Exit Form SHALL print no value from its questionnaire. It SHALL print the header, and SHALL tick a return's filing method from the case only when set and the result is not `rejected`. Results, amounts, payment methods, debit dates, Other Tax entries and Remarks SHALL be blank. A record without staff history SHALL offer no Exit Form.

#### Scenario: Returned to signing, one return rejected
- **WHEN** a case's federal return was e-filed and rejected, its state return was e-filed and accepted, and the office returned it to signing
- **THEN** the Exit Form ticks only the state's e-file box, writes no amount, payment method, debit date, Other Tax entry or Remarks, and the note lists the federal filing method, the refund or amount owed, Other Tax and Remarks

#### Scenario: Refiled after a Return to signing
- **WHEN** the rejected federal return of a case returned to signing has been e-filed again and is waiting for an answer
- **THEN** the Exit Form ticks the federal e-file box as well, and the note no longer lists the federal filing method

#### Scenario: Refiled on paper
- **WHEN** the rejected federal return was refiled on paper (given to the client)
- **THEN** the Exit Form ticks the federal paper box

#### Scenario: A return with no method
- **WHEN** a case returned to signing has no filing method for a return
- **THEN** that return has no box ticked

#### Scenario: No Return to signing
- **WHEN** a case was approved and has not been returned to signing
- **THEN** the Exit Form shows the questionnaire's results, amounts, payment methods, Other Tax entries and Remarks, and carries no fill-by-hand note

#### Scenario: Both paths follow the rule
- **WHEN** a case was returned to signing after its approval
- **THEN** the PDF made from the office's panel and from the volunteer's button has none of the questionnaire's values

#### Scenario: No staff history
- **WHEN** a case record carries no staff history
- **THEN** no "Download Exit Form" is offered

### Requirement: The Exit Form after a Return to signing says what to fill in by hand
After a Return to signing, the office's Exit Form panel and the volunteer's "Download Exit Form" SHALL carry the note "The return was corrected after this review (Return to signing). This form prints only what ViTally holds. Fill in by hand: <list>." The list SHALL name, in this order, "the federal filing method" and "the Pennsylvania filing method" when that box is not ticked, then always "the federal and Pennsylvania refund or amount owed and how it is paid", "Other Tax" and "Remarks".

#### Scenario: The note names the unticked method
- **WHEN** a case was returned to signing with its federal return rejected and its state return accepted
- **THEN** both places carry the note, and its list reads "the federal filing method; the federal and Pennsylvania refund or amount owed and how it is paid; Other Tax; Remarks"

#### Scenario: No note without a Return to signing
- **WHEN** a case was approved and has not been returned to signing
- **THEN** neither place carries the note

## MODIFIED Requirements

### Requirement: An approved review offers the Exit Form
ViTally SHALL offer "Download Exit Form" for an approved review that has a reviewer questionnaire. On a volunteer's case page, each such review in the Independent review panel SHALL have the button, whether or not that volunteer is on the case. On the office's case page, which has no Independent review panel, the Overview SHALL have an Exit Form panel with the button for the latest approved review. If the latest approved review has no questionnaire, there SHALL be no panel: ViTally SHALL NOT fall back to an earlier approved review. Neither SHALL appear for a review with no questionnaire, or before there is an approved review. The office's panel SHALL stay on the case at later stages. What the form prints after a Return to signing is set by "The Exit Form after a Return to signing prints only what ViTally holds".

#### Scenario: A volunteer sees the button on the approved review
- **WHEN** a volunteer opens a case with an approved review that has a reviewer questionnaire
- **THEN** that review in the Independent review panel has "Download Exit Form"

#### Scenario: A volunteer not on the case sees the button
- **WHEN** a volunteer who is neither the case's preparer nor its reviewer opens that case
- **THEN** the approved review has "Download Exit Form"

#### Scenario: A review with no questionnaire offers nothing
- **WHEN** a case's approved review has no reviewer questionnaire
- **THEN** neither a volunteer's case page nor the office's has "Download Exit Form"

#### Scenario: The office uses the latest approval
- **WHEN** an office persona opens a case with two approved reviews that each have a questionnaire
- **THEN** the Exit Form panel has one button, and it is for the later review

#### Scenario: No fallback to an earlier approval
- **WHEN** an office persona opens a case whose latest approved review has no questionnaire and an earlier approved review has one
- **THEN** the Overview has no Exit Form panel

#### Scenario: The office's panel stays after filing
- **WHEN** an office persona opens an e-filed case whose approved review has a questionnaire
- **THEN** the Overview still has the Exit Form panel

#### Scenario: The office sees no panel before approval
- **WHEN** an office persona opens a case with no approved review
- **THEN** the Overview has no Exit Form panel

### Requirement: Staff make the Exit Form in the browser and nothing is kept
Only a staff window SHALL be able to make the Exit Form. The form SHALL be built in the browser from the approved review's questionnaire and the case, or, after a Return to signing, from the case alone (see "The Exit Form after a Return to signing prints only what ViTally holds"). It SHALL NOT be uploaded or stored. Pressing "Download Exit Form" SHALL open the PDF in a new tab. If the form can't be made, the tab SHALL say "The Exit Form could not be made. Close this tab and try again.", the case page's error notice SHALL say "The Exit Form could not be made. Try again.", and the notice's Try again SHALL build it again. Making the form SHALL NOT change the case.

If the browser blocks the tab, ViTally SHALL show no error, and SHALL draw the finished PDF as a link in the case page's Intake answers tab, named `exit-form-<client number>.pdf`. The link SHALL stop working after about 60 seconds. The tab SHALL NOT switch.

Known problem, see #122: the button is on the Overview tab, so a person who presses it can't see the link where they are. A volunteer who may not see the case's contact details has no place for the link, so they get no link and no error. This records current behaviour, not the intended one.

#### Scenario: The form opens in a new tab
- **WHEN** a reviewer presses "Download Exit Form" on an approved review
- **THEN** a new tab shows a one-page PDF, and the case's stage and revision are unchanged

#### Scenario: A blocked tab draws the link in the Intake answers tab (known problem, #122)
- **WHEN** the office presses "Download Exit Form" on the Overview tab and the browser blocks the new tab
- **THEN** no error shows and no link can be seen on the Overview tab, and the Intake answers tab, once selected, shows a link named `exit-form-<client number>.pdf`

#### Scenario: A volunteer not on the case gets no link (known problem, #122)
- **WHEN** a volunteer who may not see the case's contact details opens the case
- **THEN** the page has no place for the link

#### Scenario: The link stops working
- **WHEN** about 60 seconds have passed since the form was made
- **THEN** the link's address is revoked

#### Scenario: A failure says so and can be tried again
- **WHEN** the form can't be made
- **THEN** the tab and the error notice say so, and pressing the notice's Try again once the cause is gone makes the form

#### Scenario: A client window makes nothing
- **WHEN** a client session reaches the Exit Form's action
- **THEN** no form is made, and no client screen offers the button
