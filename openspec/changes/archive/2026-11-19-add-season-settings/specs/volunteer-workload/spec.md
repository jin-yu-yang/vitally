## MODIFIED Requirements

### Requirement: Only a cleared admin sees the Workload
The Volunteers page SHALL have a Workload tab next to the Roster tab. The Workload tab SHALL be offered only to a signed-in `staff` member who is cleared (capability `volunteer-clearance`) and whose effective capabilities include `admin`. A workspace admin (capability `volunteer-roster`) who is not cleared, or who is a site coordinator without the Admin role, SHALL keep the Roster tab alone. A staff member who is not a workspace admin SHALL see neither.

#### Scenario: A cleared admin
- **WHEN** a cleared staff member with the Admin role opens Volunteers
- **THEN** the page shows a Roster tab and a Workload tab

#### Scenario: An uncleared admin
- **WHEN** a staff member with the Admin role who is not cleared opens Volunteers
- **THEN** only the Roster is offered, and no Workload tab or case data is shown

#### Scenario: A site coordinator without the Admin role
- **WHEN** a cleared site coordinator whose only role is Preparer opens Volunteers
- **THEN** only the Roster is offered

#### Scenario: A preparer
- **WHEN** a cleared staff member with only the Preparer role, who is not a site coordinator, is signed in
- **THEN** there is no Volunteers link and no Workload

### Requirement: The Workload has one row per volunteer who can prepare or review
The Workload SHALL list, one row each, every volunteer with a roster entry for the workspace's current season whose effective capabilities include `prepare` or `review`. A volunteer whose effective capabilities include neither, and who holds no Open case, SHALL NOT have a row, even with the Admin role. A volunteer with a row who is not cleared SHALL be tagged "Not cleared".

Anyone who holds an Open case in a slot whose capability they lack (`prepare` for a preparer, `review` for a reviewer) SHALL also have a row, so an admin can reassign the case: for example a volunteer whose role was removed by mistake, or a person with no roster entry for the current season (shown under their name, and tagged "Not cleared"). Such a row SHALL be tagged "Holds cases without the role", and each such case in its list SHALL say "No prepare role" or "No review role". Each row SHALL show:
- the volunteer's name;
- Open;
- a breakdown bar of Preparing and Review, with both numbers available to screen readers;
- Preparing;
- Review;
- Waiting on client;
- Stalled.

The Workload SHALL NOT show an hours column.

#### Scenario: Who has a row
- **WHEN** the roster has a cleared Preparer, a cleared Reviewer, a cleared admin with only the Admin role, and a Preparer who is new with no photo ID check
- **THEN** the Preparer, the Reviewer and the new Preparer have rows, the new Preparer's row is tagged "Not cleared", and the admin has no row

#### Scenario: An admin who also reviews
- **WHEN** a cleared volunteer has the Admin and Reviewer roles
- **THEN** they have a row

#### Scenario: A ceiling wider than the roles
- **WHEN** a volunteer's only role is Greeter, `prepare` is written directly into their `people.capabilities`, and they hold no case
- **THEN** they have no row

#### Scenario: A role removed while holding a case
- **WHEN** an admin unticks the Preparer role of a volunteer who is preparing VT-ABCD-EFGH, leaving them only Greeter
- **THEN** the volunteer keeps a row tagged "Holds cases without the role", with Open 1, and expanding it lists VT-ABCD-EFGH with "No prepare role" and Reassign
