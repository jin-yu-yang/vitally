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
