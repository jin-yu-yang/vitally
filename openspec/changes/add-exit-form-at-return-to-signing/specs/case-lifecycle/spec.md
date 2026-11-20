## ADDED Requirements

### Requirement: Return to signing can record the corrected Exit Form values
The Return to signing… confirmation SHALL offer, after "The fix is done.", optional corrected Exit Form values:
- a Federal group and a State group, each only for a return that has a filing method on the case;
- the five Local groups (NPT, BIRT, EET, SIT, PAIBWTR);
- a Remarks box.

Each group SHALL be collapsible, closed and empty when the dialog opens, and SHALL have "Clear this section". Nothing SHALL be filled in from the review's questionnaire. A group the admin typed in SHALL stay open when the dialog is shown again after a refusal.

A group SHALL ask the same fields, under the same rules, as the reviewer questionnaire's Exit Form groups. That includes the rule that no account number, routing number or other banking detail is ever stored. Two things differ:
- a settled return's group (its method set and its result not `rejected`) SHALL show that method as fixed, with no choice;
- the rejected return's group SHALL let the admin choose E-file or Paper.

`RETURN_TO_SIGNING` SHALL accept, besides `confirmed`, an optional `exitForm` in the reviewer questionnaire's shape and an optional `remarks` of up to 2000 characters. The database SHALL refuse the action with `VALIDATION`, changing nothing, when:
- `exitForm` breaks the reviewer questionnaire's Exit Form rules;
- it carries any other key;
- it has a Federal or State group for a return with no method on the case;
- a settled return's group has a different method.

When at least one group or Remarks is given, the values SHALL be stored once for that Return to signing and SHALL never be changed afterwards. With none, nothing SHALL be stored, and the move SHALL behave as before this change.

#### Scenario: The values are optional
- **WHEN** an admin returns a Rejected case to signing, ticking only "The fix is done."
- **THEN** the case is at Ready to exit, and no corrected Exit Form values are stored

#### Scenario: The values are stored with the move
- **WHEN** the federal return was rejected and the state return accepted, and the admin returns the case to signing with Federal (e-file, refund 1,250.00, direct deposit), State (refund 85.00, check) and Remarks "Corrected dependent SSN"
- **THEN** the case is at Ready to exit, and the stored values hold the Federal and State groups and the Remarks

#### Scenario: The groups start empty and closed
- **WHEN** an admin opens Return to signing… on a case whose approved review has Exit Form values
- **THEN** every group in the dialog is closed and empty, and the Remarks box is empty

#### Scenario: A settled return's method is fixed
- **WHEN** an admin opens Return to signing… on a case whose state return was e-filed and accepted
- **THEN** the State group shows E-file as fixed, with no Paper choice

#### Scenario: A settled method can't be changed
- **WHEN** `RETURN_TO_SIGNING` carries a State group with method `paper` for a case whose state return was e-filed and accepted
- **THEN** the database refuses it with `VALIDATION`, and the case stays Rejected

#### Scenario: No group for a return the case doesn't have
- **WHEN** `RETURN_TO_SIGNING` carries a State group for a case with no state filing method
- **THEN** the database refuses it with `VALIDATION`, and the case stays Rejected

#### Scenario: Banking details are refused
- **WHEN** `RETURN_TO_SIGNING` carries a Federal group with refund by direct deposit and an `accountNumber`
- **THEN** the database refuses it with `VALIDATION`, nothing is stored, and the case stays Rejected

### Requirement: The corrected Exit Form values stay with staff
The corrected Exit Form values recorded at Return to signing SHALL be readable by every cleared staff member who can open the case, under the same rule as the reviewer questionnaire. A client session SHALL read none of them, SHALL receive no realtime change that carries them, and no client message or history line SHALL contain them. Only `RETURN_TO_SIGNING` SHALL write them.

#### Scenario: A client can't read the corrected values
- **WHEN** a signed-in applicant selects the corrected Exit Form values of their own case after a Return to signing that stored them
- **THEN** no rows are returned

#### Scenario: Staff read them
- **WHEN** a cleared volunteer opens a case whose Return to signing stored corrected values
- **THEN** the case record holds those values

#### Scenario: Nothing writes them directly
- **WHEN** a staff session inserts a row of corrected Exit Form values directly
- **THEN** the database refuses it

## MODIFIED Requirements

### Requirement: A rejected case returns to signing
At Rejected, an admin SHALL be offered **Return to signing…**, on the case page and on the case's Rejected row in Follow-ups.
- Its confirmation SHALL name the client and the application ID, and its box SHALL read "The fix is done.". The database SHALL refuse the move without it.
- The confirmation SHALL also offer the optional corrected Exit Form values (see "Return to signing can record the corrected Exit Form values").
- The move SHALL take the case to Ready to exit, keeping each return's method and answer. It SHALL have no undo, and volunteers SHALL NOT see the button.
- While any e-filed return is still waiting for its answer, the move SHALL be refused as not available. The admin SHALL see "Waiting for Pennsylvania's answer before the return can go back to signing." (or "…the IRS's answer…") instead of the button.

Back at Ready to exit, Mark ready to e-file SHALL be offered without waiting again for the reviewer's conversation or the office's go-over, which were done the first time. Its confirmation SHALL say that this is the client's second signing. The next Mark e-filed SHALL offer only the rejected returns, may change their method to any of the two, and SHALL keep each accepted return, and each return given to the client, as it is. When the latest Return to signing stored a method for a rejected return, that Mark e-filed SHALL start with that method selected, and the admin MAY choose the other. A rejected return filed again on paper SHALL be given to the client at that Mark e-filed.

Close SHALL be allowed from Rejected, with a reason, as from the earlier stages.

#### Scenario: The fix is done
- **WHEN** an admin presses Return to signing… on a Rejected case whose returns all have an answer, ticks "The fix is done." and confirms
- **THEN** the case is at Ready to exit, it shows in the case pool's Waiting on client tab, and its Follow-ups row reads "Waiting for the client to sign again."

#### Scenario: Waiting for the other answer
- **WHEN** a case is Rejected for its federal return while the e-filed state return is still waiting
- **THEN** the admin sees "Waiting for Pennsylvania's answer before the return can go back to signing." instead of Return to signing…, and the database refuses the move as not available

#### Scenario: The second signing
- **WHEN** an admin presses Mark ready to e-file… on a case returned to signing
- **THEN** it is offered straight away, and the dialog says this is the client's second signing

#### Scenario: The planned method is preselected
- **WHEN** the state return was rejected, and the case was returned to signing with a State group of method `paper`, then marked ready to e-file
- **THEN** Mark e-filed… starts with the state return on paper selected, and the admin can choose e-file instead

#### Scenario: No planned method, nothing preselected
- **WHEN** a case was returned to signing with no corrected Exit Form values, then marked ready to e-file
- **THEN** Mark e-filed… starts with no choice selected

#### Scenario: Filing again, the PA-40 on paper
- **WHEN** the federal return was accepted and the state return rejected, the case went back to signing and was marked ready to e-file, and the admin marks it e-filed with the state return on paper
- **THEN** the dialog offered only the state return, the federal return stays accepted, the state return is given to the client, and the case is Accepted with the staff name "Accepted, PA on paper", with no Record filing result

#### Scenario: Filing again, the federal return on paper
- **WHEN** the federal return was rejected and the state return was given to the client on paper, and the admin files the federal return again on paper
- **THEN** the case is Accepted with the staff name "Paper"

#### Scenario: Closing a rejected case
- **WHEN** an admin closes a Rejected case, with a reason
- **THEN** the case is Closed
