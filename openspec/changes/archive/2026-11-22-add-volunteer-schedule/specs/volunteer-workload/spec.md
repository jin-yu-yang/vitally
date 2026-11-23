## ADDED Requirements

### Requirement: The Workload shows the hours scheduled this week
Each volunteer's row SHALL have an "Hours this week" column after Stalled. It SHALL be the sum of the hours of their shifts (capability `volunteer-schedule`) dated from Monday to Sunday of the week that holds today in America/New_York. It SHALL count every role, and shifts tagged "Role removed" or "Outside site hours" too. Removed shifts SHALL NOT count. A volunteer with no shifts that week SHALL show 0. The Unassigned row SHALL show no hours. The column SHALL update without a reload when a shift changes in another window.

#### Scenario: Counting hours
- **WHEN** a volunteer has a Preparer shift Tuesday 5 to 8 and a Reviewer shift Saturday 10 to 2 this week, and a shift next Monday
- **THEN** their Hours this week is 7

#### Scenario: A shift added elsewhere
- **WHEN** an admin has the Workload open, and another admin adds a 3-hour shift for a volunteer on Thursday this week
- **THEN** that volunteer's Hours this week goes up by 3 without a reload

## MODIFIED Requirements

### Requirement: The Workload can be sorted and searched
The Workload SHALL sort by Open, highest first, and then by name, by default. Each column (name, Open, Preparing, Review, Waiting on client, Stalled, Hours this week) SHALL sort when its header is pressed, and pressing it again SHALL reverse the order. A search box SHALL show only the volunteers whose name contains the typed text, ignoring case. The Unassigned row SHALL stay first, whatever the sort or search.

#### Scenario: The default order
- **WHEN** an admin opens the Workload, and three volunteers have 4, 1 and 4 open cases
- **THEN** the two with 4 come first, in name order, then the one with 1

#### Scenario: Searching
- **WHEN** an admin types "par" into the search box
- **THEN** only volunteers whose names contain "par" are listed, below the Unassigned row

#### Scenario: Sorting by hours
- **WHEN** an admin presses the Hours this week header, and three volunteers have 6, 0 and 9 hours this week
- **THEN** the rows are 9, 6, 0 below the Unassigned row, and pressing it again reverses them
