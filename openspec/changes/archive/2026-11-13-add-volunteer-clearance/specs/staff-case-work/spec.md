## MODIFIED Requirements

### Requirement: Staff see every case except a client's private draft
A cleared `staff` member (capability `volunteer-clearance`) SHALL be able to read every row of its own workspace in every table the staff screens use, except the rows of a client's private draft. Those tables are:
- cases;
- documents, requests and history;
- participation, follow-ups and assistance items;
- reviews, and preparer and reviewer questionnaires;
- filing attempts, returns and notes;
- materials, document cards, contacts and the contact log.

A cleared staff member SHALL receive the Realtime changes for those rows. A staff member who is not cleared SHALL read none of those rows and SHALL receive none of their changes. A staff member SHALL read nothing in another workspace.

#### Scenario: Every staff row
- **WHEN** a cleared staff member reads every staff table
- **THEN** the rows read equal a privileged read of that workspace's rows in those tables, minus clients' private drafts

#### Scenario: Not cleared
- **WHEN** a staff member who is not cleared reads every staff table
- **THEN** no row is returned

#### Scenario: A private draft stays private
- **WHEN** a client has an unsubmitted application
- **THEN** a cleared staff member reads no row of it

#### Scenario: Another workspace
- **WHEN** a cleared staff member reads the staff tables
- **THEN** no row from another workspace is returned

#### Scenario: Live updates
- **WHEN** a cleared staff member has the work board open and another window claims a case
- **THEN** the staff member's board shows the claim without a reload
