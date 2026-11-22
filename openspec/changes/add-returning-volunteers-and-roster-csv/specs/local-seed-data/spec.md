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
