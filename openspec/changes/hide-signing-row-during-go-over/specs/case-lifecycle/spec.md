## MODIFIED Requirements

### Requirement: Admins record signing and e-filing, with a confirmation
At Ready to exit, an admin SHALL be offered **Mark ready to e-file**. At Ready to e-file, an admin SHALL be offered **Mark e-filed**. Both SHALL be offered on the case page and on that case's Follow-ups row. Each SHALL open a confirmation dialog that:
- names the client (their first and last name from the application, or "this client" when both are empty) and the application ID;
- says what the client will be told;
- requires a confirmation box to be ticked before the move is sent.

Mark ready to e-file's box SHALL read "The client signed Form 8879, or the return will be given to the client on paper.". Mark e-filed's box SHALL read "Each return was e-filed, or given to the client on paper, as chosen above.". The database SHALL refuse either move without that confirmation. Neither move SHALL have an undo. Volunteers SHALL see neither button.

Mark e-filed SHALL record how each return was filed. On a first filing, its dialog SHALL offer exactly four choices, in this order: "Both returns e-filed"; "Federal e-filed, Pennsylvania on paper (given to the client to mail)"; "Federal on paper (given to the client to mail), Pennsylvania e-filed"; "Both returns on paper (given to the client to mail)". The database SHALL accept each of the four pairs, and SHALL refuse a payload missing either return, or a method other than `efile` or `paper`, with `VALIDATION`. On a filing after Return to signing, the dialog SHALL offer only the rejected returns, each "E-filed" or "On paper (given to the client to mail)", and SHALL show each accepted return, and each return given to the client, as already done ("Pennsylvania return: on paper, given to the client. Nothing to file again."). The database SHALL refuse a payload that names any return but the rejected ones. The dialog SHALL show beside each choice what the client will be told. Mark e-filed SHALL be allowed whatever signing plan the reviewer chose.

Mark ready to e-file SHALL wait for the reviewer's conversation with the client. While the approved review's conversation is not yet recorded as completed, the database SHALL refuse the move as not available. The admin SHALL see "The reviewer still needs to record the conversation with the client." instead of the button, on the case page and on the Follow-ups row.

Mark ready to e-file SHALL also wait for the office to go over the return with the client. While the case has an open follow-up with purpose `go_over_return` (capability `office-follow-up`), the database SHALL refuse the move as not available, and nothing SHALL be recorded. The admin SHALL see "The office still needs to go over the return with the client." instead of the button on the case page. Follow-ups SHALL list no Signing row for the case while that follow-up is open: its Call the client row stands for the case (capability `office-follow-up`). The wait SHALL end when that follow-up is resolved, whatever the outcome, and when it is cancelled.

#### Scenario: Marking a case e-filed
- **WHEN** an admin presses Mark e-filed… for Mei Chen's case, chooses both returns e-filed, ticks the confirmation and confirms
- **THEN** the dialog had named "Mei Chen" and the application ID, the case is E-filed with the staff name "Both e-filed", and the client's history gains "PCDC e-filed your return."

#### Scenario: Filing the state return on paper
- **WHEN** an admin marks a case e-filed with the federal return e-filed and the state return on paper
- **THEN** the case is E-filed with the staff name "E-filed, PA on paper", and the client's history gains "PCDC e-filed your federal return and gave your Pennsylvania return on paper to you or the person you sent. If it isn't signed yet, sign it, then mail it yourself. A reply can take about 3 months after you mail it."

#### Scenario: A combination PCDC doesn't use
- **WHEN** the database receives Mark e-filed with the federal return on paper and the state return e-filed, the pair that was refused before PCDC confirmed it uses all four
- **THEN** it accepts it, and the case is E-filed with the staff name "E-filed, federal on paper"

#### Scenario: A payload missing a return
- **WHEN** the database receives a first Mark e-filed that names only the federal return
- **THEN** it refuses it with `VALIDATION`, and the case stays at Ready to e-file

#### Scenario: Paper after a Customer Portal plan
- **WHEN** the reviewer chose the Customer Portal, and an admin marks the case e-filed with the state return on paper
- **THEN** the database accepts it

#### Scenario: The reviewer's call comes first
- **WHEN** a case is at Ready to exit and its reviewer has not yet recorded the conversation with the client
- **THEN** the admin sees "The reviewer still needs to record the conversation with the client." instead of Mark ready to e-file…, its Follow-ups row reads "Waiting for the reviewer's call with the client.", and the database refuses the move as not available

#### Scenario: The office's go-over comes first
- **WHEN** a reviewer approved with "no" to going over the return, and the go-over follow-up is still open
- **THEN** the admin sees "The office still needs to go over the return with the client." instead of Mark ready to e-file… on the case page, Follow-ups lists the case's Call the client row and no Signing row, and the database refuses the confirmed move as not available, leaving the case at Ready to exit

#### Scenario: Resolved after reaching the client
- **WHEN** the office resolves the go-over follow-up with outcome reached
- **THEN** the admin is offered Mark ready to e-file…, its Follow-ups row reads "Waiting for the client to sign.", and the database accepts the confirmed move

#### Scenario: Resolved with no further contact
- **WHEN** the office resolves the go-over follow-up with outcome no further contact
- **THEN** the admin is offered Mark ready to e-file…, Follow-ups shows the case's Signing row again, and the database accepts the confirmed move

#### Scenario: Keeping it as it is
- **WHEN** the admin closes the dialog without confirming
- **THEN** the case stays at Ready to e-file and nothing is sent

#### Scenario: From Follow-ups
- **WHEN** an admin presses Mark ready to e-file… on a Follow-ups row
- **THEN** the same confirmation opens without leaving Follow-ups

### Requirement: The lists and the case page show every stage
**The work board** SHALL keep its three tabs:
- **Available:** Pending intake / filing with no preparer.
- **Waiting for preparation:** Filing in progress and Corrections in progress.
- **Waiting for review:** Pending review and Review in progress.

Its search SHALL reach a case in any stage.

**The case pool** SHALL have these tabs, in this order: All, Intake (Draft, Request sent, Screening in progress), Available, Waiting for preparation, Waiting for review, Waiting on client (Waiting for documents, Ready to exit), Filing (Ready to e-file, E-filed), Needs attention (Hold, Rejected), Done (Accepted), and Closed. Its stage filter SHALL list every stage. The Closed tab SHALL have a reason filter: All, each of the six reasons, and No reason (cases closed before reasons existed). The pool, Follow-ups and the case page SHALL show E-filed and Accepted by their staff name for the case's filing method.

**Follow-ups** SHALL show an admin **Close unsigned cases…** above its rows (see "An admin closes unsigned cases at season end"), and:
- a row for each case at Request sent ("New application: open it to start screening."), with **Open**;
- a row for each case at Screening in progress ("Finish screening."), with **Open**;
- a **Waiting for documents** row for each case at Waiting for documents ("Waiting for the client's documents."), with **Put on hold…**;
- a **Hold** row for each case on Hold: "Can't reach the client about documents." for a Hold that came from Waiting for documents, or "Can't reach the client to sign." for one that came from Ready to exit. It has **Got in touch…** and **Close…**;
- a **Withdrawn** row for each open `withdrawal_notice` follow-up, with **Resolve**. It reads "The client withdrew; tell <name> to stop work." for a client's own withdrawal during preparation or review, "The client withdrew; make sure the return is not transmitted in TaxSlayer." for an admin's withdrawn close at Ready to exit, a Hold from Ready to exit, or Ready to e-file, or "The case was closed before filing; make sure the return is not transmitted in TaxSlayer." for an admin's individual close of a Hold from Ready to exit with any other reason;
- a row for each case at Ready to exit ("Waiting for the client to sign."), with **Mark ready to e-file…**. While the reviewer's call with the client is still pending, the row SHALL read "Waiting for the reviewer's call with the client." instead, with the call-pending explanation in place of the button. For a case returned to signing after a rejection, the row SHALL read "Waiting for the client to sign again.". While the case has an open `go_over_return` follow-up, whatever its reviewer's call or a Return to signing, Follow-ups SHALL list no row for it here: its Call the client row stands for the case until that follow-up is resolved or cancelled (capability `office-follow-up`);
- a row for each case at Ready to e-file ("Ready to e-file."), with **Mark e-filed…**;
- a **Filing result** row for each case at E-filed, and for each case at Rejected with an e-filed return still waiting, with **Record filing result…**. It SHALL read "Waiting for the IRS and Pennsylvania." while both returns wait, or "Waiting for Pennsylvania's answer." or "Waiting for the IRS's answer." while one e-filed return waits. A return on paper SHALL never be waited for;
- a **Rejected** row for each case at Rejected ("Rejected: contact the client to fix and sign again."), followed by the latest fix note, as typed, if there is one. It has **Return to signing…**, or, while an e-filed return still waits, "Waiting for Pennsylvania's answer before the return can go back to signing." (or "…the IRS's answer…") in its place;

alongside today's rows. A case at Accepted SHALL have no row. Follow-ups' filter SHALL list every kind. A row's waiting time SHALL count from the case's last move or recorded result.

The amber (3 days) and red (5 days) colouring SHALL apply to a Waiting for documents row and to a Filing result row. A Hold row, a Withdrawn row and a Rejected row SHALL never be coloured.

**The case page:**
- Its lifecycle bar SHALL show Request sent, Screening in progress, Pending intake / filing, Filing in progress, Pending review, Review in progress, Ready to exit, Ready to e-file, E-filed and Accepted. Accepted SHALL be the bar's last step: the bar SHALL NOT show Closed after Accepted for any case that is not closed. At Accepted every step SHALL be shown done, and no step SHALL be shown as the current one. A closed case's bar SHALL show Closed after Accepted as its only current step, and every step before it SHALL be shown neutral: neither done nor still to come. Where a closed case stopped SHALL be read in its History tab. Corrections in progress SHALL show on Filing in progress, and Rejected on E-filed. Waiting for documents SHALL show on the stage it was asked from. Hold SHALL show on the stage it came from: Ready to exit, or the stage the documents were asked from.
- For an admin, the intake-check form SHALL show at Screening in progress only.
- For an admin, the office actions panel SHALL offer Ask for documents…, Put on hold…, Got in touch… and Close… at the stages their moves allow. Close… SHALL offer the six reasons and the note.
- For an admin, the signing panel SHALL be headed "Signing". At a Hold that came from Ready to exit it SHALL say "The office could not reach the client to sign.", and before Ready to e-file it SHALL say "This is recorded once the client has signed.".
- At Request sent, the case page SHALL say that screening starts when an admin opens the case.
- A volunteer's "Your next step" SHALL say what each new stage is waiting for:
  - Waiting for documents: "The office is waiting for the client's documents.";
  - Hold: "The office is trying to reach the client.";
  - E-filed: "The office records the answers from the IRS and Pennsylvania.";
  - Rejected: "A return was rejected. The site coordinator fixes it in TaxSlayer, and the office contacts the client.";
  - Accepted: "The returns are accepted or given to the client on paper. Nothing more is needed here.".
- The case's history SHALL name each new move. Mark ready to e-file SHALL read "recorded the client's signature".

#### Scenario: The pool's Filing tab
- **WHEN** an admin opens the case pool's Filing tab
- **THEN** it lists the cases at Ready to e-file and E-filed, and no other

#### Scenario: Needs attention and Done
- **WHEN** an admin opens the case pool's Needs attention tab, then its Done tab
- **THEN** the first lists only cases on Hold and Rejected cases, and the second only Accepted cases

#### Scenario: Waiting on client
- **WHEN** an admin opens the case pool's Waiting on client tab
- **THEN** it lists the cases at Waiting for documents and Ready to exit, and no other

#### Scenario: Closed by reason
- **WHEN** an admin filters the Closed tab by Withdrawn
- **THEN** it lists only cases closed with reason `withdrawn`

#### Scenario: Follow-ups shows signing
- **WHEN** a case is approved by its reviewer, and the reviewer has recorded the conversation with the client
- **THEN** Follow-ups shows its row, "Waiting for the client to sign.", with Mark ready to e-file…

#### Scenario: No Signing row during a go-over
- **WHEN** a case is approved by its reviewer with "no" to going over the return, so its go-over follow-up is open
- **THEN** Follow-ups lists the case once, as its Call the client row with 1 open task and Log contact, and lists no Signing row for it

#### Scenario: The Signing row follows the go-over
- **WHEN** the office resolves that go-over follow-up, with either outcome
- **THEN** the go-over no longer counts in the case's Call the client row (which goes when no other task is open), and Follow-ups lists its Signing row, "Waiting for the client to sign.", with Mark ready to e-file…

#### Scenario: Waiting for documents turns amber
- **WHEN** a case has waited three days at Waiting for documents
- **THEN** its row is amber, and reads "Waiting for the client's documents."

#### Scenario: A hold is never coloured
- **WHEN** a case has been on Hold for ten days
- **THEN** its Hold row is not coloured

#### Scenario: A late acknowledgment turns amber
- **WHEN** a both-e-filed case has waited three days at E-filed with no answer recorded
- **THEN** its Filing result row is amber, and reads "Waiting for the IRS and Pennsylvania."

#### Scenario: A mailing row is never coloured
- **WHEN** a case was filed with the federal return on paper and the state return e-filed, and has waited six days at E-filed
- **THEN** no row waits for a mailing: its Filing result row reads "Waiting for Pennsylvania's answer.", is coloured red for Pennsylvania's wait, and mentions nothing about the paper return

#### Scenario: The Rejected row shows the fix note
- **WHEN** a case is Rejected with the fix note "Site coordinator to correct the dependent's SSN in TaxSlayer"
- **THEN** its Rejected row reads "Rejected: contact the client to fix and sign again." followed by that note, with Return to signing…

#### Scenario: Accepted leaves the queue
- **WHEN** the last waiting return of a case is recorded as accepted
- **THEN** the case has no Follow-ups row

#### Scenario: The bar of an Accepted case
- **WHEN** a staff member opens a case at Accepted
- **THEN** its lifecycle bar shows every step from Request sent to Accepted as done, no step as current, and no Closed

#### Scenario: The bar of a closed case
- **WHEN** a staff member opens a case that was closed from Pending review
- **THEN** its lifecycle bar shows Closed after Accepted as the current step, and every step from Request sent to Accepted as neutral, neither done nor still to come

#### Scenario: The bar of an open case ends at Accepted
- **WHEN** a staff member opens a case at Pending review
- **THEN** its lifecycle bar shows the steps before Pending review as done, Pending review as current, the steps from Review in progress to Accepted as still to come, and no Closed

#### Scenario: Rejected and Corrections in progress are unchanged
- **WHEN** a staff member opens a case at Rejected, and another at Corrections in progress
- **THEN** the first bar shows Rejected on the E-filed step and the second shows Corrections in progress on the Filing in progress step, each as the current step with the steps before it done
