## ADDED Requirements

### Requirement: The local seed fills a week of the schedule
The `seed:local` command, acting as the Site Coordinator account and only through the public RPCs, SHALL:
- **Site hours:** save Tuesday and Thursday 5 pm – 8 pm and Saturday 10 am – 4 pm, with the default targets, when the workspace's site hours were never saved. It SHALL leave saved site hours as they are.
- **Usual days:** give at least four of the fictional volunteers usual days. At least two of them SHALL usually come on Saturdays.
- **Shifts:** add about six shifts in the current week in America/New_York, on open days, across the role accounts and at least one fictional volunteer with no sign-in. At least one open Saturday hour SHALL be left with a gap.

The ids of the shifts it adds SHALL be written to the run file. A re-run SHALL first remove exactly those shifts through the shift removal RPC, and SHALL leave every other shift alone. The browser story's use of the seed module SHALL add no site hours, usual days or shifts. Every value SHALL be fictional.

#### Scenario: The seed runs
- **WHEN** an operator runs `npm run seed:local` on a workspace with no saved site hours
- **THEN** Season settings shows the seeded site hours, and the Schedule for this week's Saturday shows shifts with at least one gap in its coverage row

#### Scenario: Saved hours are kept
- **WHEN** a site coordinator has saved Saturday as 9 am – 1 pm, and the seed runs
- **THEN** Saturday's hours are still 9 am – 1 pm

#### Scenario: The seed runs again
- **WHEN** the seed runs a second time in the same week, and an admin had added one shift of their own in between
- **THEN** the schedule holds one seeded set of shifts plus the admin's shift

#### Scenario: The browser story
- **WHEN** the browser story seeds its workspace
- **THEN** no site hours, usual days or shifts are added

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

A re-run SHALL first delete the people with no sign-in whose email is on the seed's list, so the same 8 volunteers exist afterwards. A volunteer on that list who holds a live shift the seed did not add (capability `volunteer-schedule`) SHALL be kept as they are, with their shifts and roster entry, and SHALL NOT be added again, because deleting them would delete the shift. It SHALL NOT change any staff member with a sign-in other than by clearing the role accounts. The browser story's use of the seed module SHALL NOT add volunteers.

#### Scenario: The seed runs
- **WHEN** an operator runs `npm run seed:local` on the rehearsal workspace set up from the example roster
- **THEN** the Roster lists the 8 fictional volunteers alongside the staff accounts, and the four role accounts are cleared

#### Scenario: The role accounts work as before
- **WHEN** the seed has run and the Preparer, Reviewer, Intaker and Site Coordinator accounts sign in
- **THEN** each sees the staff screens with the same actions as before this change

#### Scenario: The seed runs again
- **WHEN** the operator runs it a second time
- **THEN** the Roster still lists exactly those 8, the role accounts are unchanged, and no other staff member has changed

#### Scenario: A volunteer with an admin's shift
- **WHEN** an admin gives one of the 8 fictional volunteers a shift, and the seed runs again
- **THEN** that volunteer is the same person, their shift is still live, and the Roster still lists the 8

#### Scenario: A volunteer waiting for their form
- **WHEN** the seed has run
- **THEN** exactly one fictional volunteer shows no roles, and every fictional volunteer shows not cleared with "No account yet"

#### Scenario: The browser story
- **WHEN** the browser story seeds its workspace
- **THEN** no fictional volunteers are added to it

### Requirement: A seed re-run replaces the previous season's people
A re-run SHALL first delete the people with no sign-in whose email is on the previous-season list, so the same three exist afterwards. A person on that list who holds a live shift the seed did not add (capability `volunteer-schedule`) SHALL be kept as they are, with their shifts and their roster entries, and SHALL NOT be re-created, because deleting them would delete the shift. It SHALL NOT change a person with a sign-in. The browser story's use of the seed module SHALL NOT add them.

#### Scenario: The seed runs again
- **WHEN** the operator runs it a second time
- **THEN** exactly three previous-season-only fictional people exist, each with one previous-season roster entry

#### Scenario: A picked person is re-seeded
- **WHEN** an admin has added one of the three to the current season, with no sign-in and no shift, and the seed runs again
- **THEN** that person is replaced by the seeded previous-season-only version, and the current Roster again lists only the 8 and the staff accounts

#### Scenario: A picked person with a shift is kept
- **WHEN** an admin has added one of the three to the current season and given them a shift, and the seed runs again
- **THEN** that person is the same person, their shift is still live, and their current-season and previous-season roster entries remain; the other two are re-seeded

#### Scenario: The browser story
- **WHEN** the browser story seeds its workspace
- **THEN** no previous-season people are added to it
