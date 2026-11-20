## MODIFIED Requirements

### Requirement: The Exit Form after a Return to signing prints only what ViTally holds
When a Return to signing came after a review's approval (by the case's staff history), that review's Exit Form SHALL print no value from its questionnaire. Only the latest such Return to signing SHALL count.

If that Return to signing stored corrected Exit Form values (capability `case-lifecycle`), the form SHALL print them:
- its Federal, State and Local groups and its Remarks;
- for a Federal or State group whose return is settled on the case (method set, result not `rejected`), the case's method;
- for a group whose return is not settled, the stored method.

A settled return with no stored group SHALL have its method ticked from the case, and nothing else.

If that Return to signing stored none, the form SHALL print the header, and SHALL tick a return's filing method from the case only when set and the result is not `rejected`. Results, amounts, payment methods, debit dates, Other Tax entries and Remarks SHALL be blank.

The values of an earlier Return to signing SHALL never be printed. A record without staff history SHALL offer no Exit Form.

#### Scenario: Returned to signing, one return rejected
- **WHEN** a case's federal return was e-filed and rejected, its state return was e-filed and accepted, and the office returned it to signing with no corrected values
- **THEN** the Exit Form ticks only the state's e-file box, writes no amount, payment method, debit date, Other Tax entry or Remarks, and the note lists the federal filing method, the refund or amount owed, Other Tax and Remarks

#### Scenario: Corrected values are printed
- **WHEN** the office returned a case to signing with Federal (e-file, refund 1,250.00, direct deposit), State (refund 85.00, check), a Local NPT entry (paper, none) and Remarks "Corrected dependent SSN", the state return being e-filed and accepted
- **THEN** the Exit Form ticks federal e-file and state e-file, shows the federal refund of 1,250.00 by direct deposit, the state refund of 85.00 by check, the NPT row on paper with no amount, and the Remarks

#### Scenario: The planned method until the refile
- **WHEN** the office returned a case to signing with a Federal group of method `paper` for the rejected federal return, before the refile
- **THEN** the Exit Form ticks the federal paper box

#### Scenario: The case's method wins once refiled
- **WHEN** that case's federal return is then e-filed again instead, and is waiting for an answer
- **THEN** the Exit Form ticks the federal e-file box, and still shows the stored federal result and amount

#### Scenario: The latest Return to signing decides
- **WHEN** a case was returned to signing with corrected values, rejected again, and returned to signing again with no corrected values
- **THEN** the Exit Form prints none of the first Return to signing's values

#### Scenario: Refiled after a Return to signing
- **WHEN** the rejected federal return of a case returned to signing with no corrected values has been e-filed again and is waiting for an answer
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
After a Return to signing, the office's Exit Form panel and the volunteer's "Download Exit Form" SHALL carry a note.

When the latest Return to signing stored no corrected values, the note SHALL read "The return was corrected after this review (Return to signing). This form prints only what ViTally holds. Fill in by hand: <list>." The list SHALL name, in this order:
- "the federal filing method" and "the Pennsylvania filing method", each when that box is not ticked;
- then always "the federal and Pennsylvania refund or amount owed and how it is paid", "Other Tax" and "Remarks".

When it stored corrected values, the note SHALL read "The return was corrected after this review (Return to signing). This form was filled from the corrected values recorded on <date>." The date SHALL be when that Return to signing was made. When something is still missing, the note SHALL go on " Fill in by hand: <list>." The list SHALL name, in this order and only when it applies:
- "the federal filing method" or "the Pennsylvania filing method", for a return with no box ticked and no stored group;
- "the federal refund or amount owed and how it is paid" or "the Pennsylvania refund or amount owed and how it is paid", for a return with a method on the case and no stored group;
- "Remarks", when none were stored.

Other Tax SHALL not be listed, because no stored entry means none.

#### Scenario: The note names the unticked method
- **WHEN** a case was returned to signing with its federal return rejected and its state return accepted, and no corrected values
- **THEN** both places carry the note, and its list reads "the federal filing method; the federal and Pennsylvania refund or amount owed and how it is paid; Other Tax; Remarks"

#### Scenario: Nothing missing
- **WHEN** a case was returned to signing with Federal and State groups and Remarks stored
- **THEN** both places read "The return was corrected after this review (Return to signing). This form was filled from the corrected values recorded on <date>." with no "Fill in by hand"

#### Scenario: Only the gaps are listed
- **WHEN** a case with both returns was returned to signing with a Federal group only and no Remarks, its state return being accepted
- **THEN** the note ends "Fill in by hand: the Pennsylvania refund or amount owed and how it is paid; Remarks."

#### Scenario: No note without a Return to signing
- **WHEN** a case was approved and has not been returned to signing
- **THEN** neither place carries the note
