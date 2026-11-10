## ADDED Requirements

### Requirement: The local seed command adds fictional volunteers
The `seed:local` command SHALL add 8 fictional volunteers with no sign-in to the workspace's Roster, through `vitally_save_volunteer` acting as the Site Coordinator account. Between them they SHALL cover every role, every certificate, every language and every way of working. Every name, email and phone SHALL be fictional. A re-run SHALL first delete the people with no sign-in whose email is on the seed's list, so the same 8 volunteers exist afterwards. It SHALL NOT change any staff member with a sign-in. The browser story's use of the seed module SHALL NOT add volunteers.

#### Scenario: The seed runs
- **WHEN** an operator runs `npm run seed:local` on the rehearsal workspace
- **THEN** the Roster lists the 8 fictional volunteers alongside the staff accounts

#### Scenario: The seed runs again
- **WHEN** the operator runs it a second time
- **THEN** the Roster still lists exactly those 8, and no staff member has changed

#### Scenario: The browser story
- **WHEN** the browser story seeds its workspace
- **THEN** no fictional volunteers are added to it
