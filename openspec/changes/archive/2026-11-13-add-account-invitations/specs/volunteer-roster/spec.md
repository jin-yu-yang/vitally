## MODIFIED Requirements

### Requirement: The Roster lists the current season's volunteers and whether each is cleared
The Roster SHALL list every volunteer with a roster entry for the workspace's current season, one row each. Each row SHALL show:
- the name, and a Remote badge when they work remotely or both;
- email and phone;
- their roles, and their confirmed certificates as neutral labels;
- their languages;
- their account: "Not created", "Invited", "Active" or "Deactivated";
- whether they are cleared, and if not, what is missing, in this order:
  - their Form 13615 when they have no roles;
  - the photo ID check when they are new and unchecked;
  - "No account yet" when they have no account, "Hasn't signed in yet" when it is invited, or "Account deactivated" when it is deactivated;
- an Edit button.

A volunteer with no roles SHALL show "No roles recorded", and one with no certificates SHALL show "None recorded". The page SHALL say that a volunteer works on cases only once they are cleared. The page SHALL show no season label.

#### Scenario: The list
- **WHEN** an admin opens the Roster
- **THEN** every volunteer on the current season's roster has one row with those columns

#### Scenario: A staff member nobody has recorded yet
- **WHEN** a staff member created by the roster command appears on the Roster before anyone has recorded them
- **THEN** their row shows the email from their account, "No roles recorded", "Active", and that they are not cleared because their Form 13615 is missing

#### Scenario: A cleared volunteer
- **WHEN** a volunteer with an active account has Preparer with VSC, IT&QR and Basic confirmed, and is not marked new
- **THEN** their row shows them as cleared

#### Scenario: New and not yet checked
- **WHEN** a volunteer with an active account has Greeter with VSC, and is marked new with no photo ID check
- **THEN** their row says the photo ID check is missing

#### Scenario: Roles but no account
- **WHEN** a volunteer with no sign-in has Preparer with its certificates and is not marked new
- **THEN** their row shows "Not created" and not cleared, with "No account yet"

#### Scenario: Invited
- **WHEN** a volunteer with roles has an invited account
- **THEN** their row shows "Invited" and not cleared, with "Hasn't signed in yet"

#### Scenario: Deactivated
- **WHEN** a volunteer with roles has a deactivated account
- **THEN** their row shows "Deactivated" and not cleared, with "Account deactivated"
