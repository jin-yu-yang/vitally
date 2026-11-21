## ADDED Requirements

### Requirement: Staff screens show only the current season's cases
A staff window SHALL load and list only cases from the workspace's current season, plus drafts the office owns, whose season is not yet set. Past-season cases SHALL NOT be loaded into a staff window at all. Staff SHALL NOT be offered any way to reach past-season cases in this release. A staff window that opens or restores a past-season case SHALL treat it as unavailable and go to its home screen. Read access to past-season rows SHALL be unchanged (see "Staff see every case except a client's private draft"). When the season starts, every open staff window SHALL read its cases again.

#### Scenario: After the season starts
- **WHEN** the workspace moves from 2026 to 2027 and an admin opens the case pool
- **THEN** no 2026 case is listed, and the pool says "No cases yet this season."

#### Scenario: An office draft
- **WHEN** an admin started an office draft before the season started
- **THEN** it is still listed after the start

#### Scenario: A restored window
- **WHEN** a staff window whose saved screen is a 2026 case is restored after the season moved to 2027
- **THEN** the window shows its home screen, not the case

#### Scenario: Client numbers repeat
- **WHEN** 2026 and 2027 each have a client number 31
- **THEN** a staff list shows only the 2027 case
