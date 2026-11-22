## MODIFIED Requirements

### Requirement: The local seed command adds fictional volunteers
The `seed:local` command SHALL first clear the workspace's role accounts, then add 8 fictional volunteers with no sign-in to the Roster. Both steps SHALL go through `vitally_save_volunteer`, acting as the Site Coordinator account. The one exception SHALL be the previous-season rows the seed adds afterwards, which are written directly (requirement "The local seed adds a previous season's roster"), because `vitally_save_volunteer` writes only the current season.

Clearing gives each role account present in the workspace a current-season role and its confirmed certificates, and marks it not new. The role accounts are:
- `site_coordinator`: Admin, with VSC and IT&QR;
- `preparer`: Preparer, with VSC, IT&QR and Basic;
- `reviewer`: Reviewer, with VSC, IT&QR and Advanced;
- `intaker`: Intaker, with VSC and IT&QR.

Each role account's effective capabilities SHALL then equal its roster capabilities. Clearing SHALL change nothing else about a role account. A role account that already has these roles and certificates SHALL be left as it is.

Every fictional volunteer's roles SHALL be backed by confirmed certificates. Between them the volunteers SHALL cover every role, every certificate, every language and every way of working. Exactly one volunteer SHALL have no roles and no certificates, waiting for their Form 13615. At least one SHALL be new with the photo ID check recorded, and one new without it. Every name, email and phone SHALL be fictional.

The fictional volunteers SHALL have no account, so none of them is cleared. The Roster SHALL show each of them as "Not created" in the Account column, with "No account yet" among what is missing.

A re-run SHALL first delete the people with no sign-in whose email is on the seed's list, so the same 8 volunteers exist afterwards. It SHALL NOT change any staff member with a sign-in other than by clearing the role accounts. The browser story's use of the seed module SHALL NOT add volunteers.

#### Scenario: The seed runs
- **WHEN** an operator runs `npm run seed:local` on the rehearsal workspace set up from the example roster
- **THEN** the Roster lists the 8 fictional volunteers alongside the staff accounts, and the four role accounts are cleared

#### Scenario: The role accounts work as before
- **WHEN** the seed has run and the Preparer, Reviewer, Intaker and Site Coordinator accounts sign in
- **THEN** each sees the staff screens with the same actions as before this change

#### Scenario: The seed runs again
- **WHEN** the operator runs it a second time
- **THEN** the Roster still lists exactly those 8, the role accounts are unchanged, and no other staff member has changed

#### Scenario: A volunteer waiting for their form
- **WHEN** the seed has run
- **THEN** exactly one fictional volunteer shows no roles, and every fictional volunteer shows not cleared with "No account yet"

#### Scenario: The browser story
- **WHEN** the browser story seeds its workspace
- **THEN** no fictional volunteers are added to it

## ADDED Requirements

### Requirement: The local seed adds a previous season's roster
After its 8 fictional volunteers, `seed:local` SHALL add roster entries for the season before the current one:
- three fictional people with no sign-in and no current-season entry, each with a profile (at least one with usual days), roles, and confirmed certificates that back them;
- an entry for one of the 8 fictional volunteers.

These rows SHALL be written directly with SQL in the seed's connection. This SHALL be the one exception to going through `vitally_save_volunteer`, which writes only the current season. Every name, email and phone SHALL be fictional.

#### Scenario: Returning volunteers to pick
- **WHEN** an operator runs `npm run seed:local` in season 2026, and an admin opens Add a volunteer
- **THEN** the search list offers the three previous-season people, and not the one of the 8 who is also on the 2026 roster

#### Scenario: The current Roster is unchanged
- **WHEN** the seed has run
- **THEN** the Roster lists the same 8 fictional volunteers and staff accounts as before, and none of the three previous-season people

### Requirement: A seed re-run replaces the previous season's people
A re-run SHALL first delete the people with no sign-in whose email is on the previous-season list, so the same three exist afterwards. It SHALL NOT change a person with a sign-in. The browser story's use of the seed module SHALL NOT add them.

#### Scenario: The seed runs again
- **WHEN** the operator runs it a second time
- **THEN** exactly three previous-season-only fictional people exist, each with one previous-season roster entry

#### Scenario: A picked person is re-seeded
- **WHEN** an admin has added one of the three to the current season, with no sign-in, and the seed runs again
- **THEN** that person is replaced by the seeded previous-season-only version, and the current Roster again lists only the 8 and the staff accounts

#### Scenario: The browser story
- **WHEN** the browser story seeds its workspace
- **THEN** no previous-season people are added to it
