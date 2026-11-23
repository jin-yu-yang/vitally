## REMOVED Requirements

### Requirement: The Workload shows the hours scheduled this week

**Reason**: Hours this week now means checked-in time (#257). Scheduled hours no longer feed the column, and its scenario "A shift added elsewhere" no longer holds.

**Migration**: Replaced by "The Workload shows the hours checked in this week" below. The column keeps its name, place and sorting. The browser reads `vitally_hours_this_week()` instead of the week's shifts.

## ADDED Requirements

### Requirement: The Workload shows the hours checked in this week
Each volunteer's row SHALL have an "Hours this week" column after Stalled. It SHALL be the sum of the minutes of their live check-ins (capability `volunteer-check-in`) dated from Monday to Sunday of the week that holds today in America/New_York. A missed or open check-in SHALL count to its end as that capability defines it. Removed check-ins SHALL NOT count, and shifts SHALL NOT count by themselves.

The sum SHALL be shown in hours to one decimal, rounded half up, and a whole number SHALL be shown without a decimal ("6.5", "7"). A volunteer with no check-ins that week SHALL show 0. The Unassigned row SHALL show no hours.

The hours SHALL be read through `vitally_hours_this_week()`. It SHALL take no arguments and answer a workspace admin with `weekStart`, `weekEnd` and each volunteer's minutes, and SHALL refuse anyone else with `FORBIDDEN`. The column SHALL update without a reload when a check-in, a shift or the site hours change in another window.

#### Scenario: Counting hours
- **WHEN** a volunteer checked in Tuesday from 5:00 pm to 8:00 pm and Saturday from 9:52 am to 1:22 pm this week, and has a check-in next Monday
- **THEN** their Hours this week is 6.5

#### Scenario: A missed check-out
- **WHEN** a volunteer with a shift 10 to 1 on Saturday checked in at 10:00 am and never checked out, and has no other check-in this week
- **THEN** their Hours this week is 3

#### Scenario: Scheduled but never came
- **WHEN** a volunteer has a 3-hour shift this week and no check-ins
- **THEN** their Hours this week is 0

#### Scenario: A check-in elsewhere
- **WHEN** an admin has the Workload open, and a volunteer checks out after a 2-hour check-in on Thursday this week
- **THEN** that volunteer's Hours this week goes up by 2 without a reload

#### Scenario: Not an admin
- **WHEN** a cleared preparer calls `vitally_hours_this_week()`
- **THEN** it is refused with `FORBIDDEN`
