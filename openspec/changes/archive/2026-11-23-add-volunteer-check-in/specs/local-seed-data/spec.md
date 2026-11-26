## MODIFIED Requirements

### Requirement: The local seed fills a week of the schedule
The `seed:local` command, acting as the Site Coordinator account and only through the public RPCs, SHALL:
- **Site hours:** save Tuesday and Thursday 5 pm – 8 pm and Saturday 10 am – 4 pm, with the default targets, when the workspace's site hours were never saved. It SHALL leave saved site hours as they are.
- **Usual days:** give at least four of the fictional volunteers usual days. At least two of them SHALL usually come on Saturdays.
- **Shifts:** add about six shifts in the current week in America/New_York, on open days, across the role accounts and at least one fictional volunteer with no sign-in. At least one open Saturday hour SHALL be left with a gap.
- **Check-ins:** add about four check-ins through the admin check-in save (capability `volunteer-check-in`), on the most recent open days before today. Most SHALL match a seeded shift. At least one SHALL have no check-out, and at least one SHALL be for a role account with no shift that day.

The ids of the shifts and check-ins it adds SHALL be written to the run file. A re-run SHALL first remove exactly those, through the shift removal RPC and the check-in removal RPC, and SHALL leave every other shift and check-in alone. The browser story's use of the seed module SHALL add no site hours, usual days, shifts or check-ins. Every value SHALL be fictional.

#### Scenario: The seed runs
- **WHEN** an operator runs `npm run seed:local` on a workspace with no saved site hours
- **THEN** Season settings shows the seeded site hours, and the Schedule for this week's Saturday shows shifts with at least one gap in its coverage row

#### Scenario: Saved hours are kept
- **WHEN** a site coordinator has saved Saturday as 9 am – 1 pm, and the seed runs
- **THEN** Saturday's hours are still 9 am – 1 pm

#### Scenario: The seed runs again
- **WHEN** the seed runs a second time in the same week, and an admin had added one shift and one check-in of their own in between
- **THEN** the schedule holds one seeded set of shifts and check-ins plus the admin's shift and check-in

#### Scenario: Seeded check-ins
- **WHEN** the seed has run and an admin opens the most recent open day before today
- **THEN** the Schedule shows check-in bars tagged "Corrected", including one tagged "No check-out" or, on another seeded day, one tagged "Not scheduled"

#### Scenario: The browser story
- **WHEN** the browser story seeds its workspace
- **THEN** no site hours, usual days, shifts or check-ins are added
