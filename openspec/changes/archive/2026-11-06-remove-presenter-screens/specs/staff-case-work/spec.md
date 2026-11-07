## REMOVED Requirements

### Requirement: A staff account's screens have no persona picker or presenter controls
**Reason**: Its scenario "A presenter's screens are unchanged" stops being true when the presenter's screens are removed, and a modified requirement can't drop a scenario.
**Migration**: Replaced by "Staff screens have no persona picker or presenter controls" below. That requirement keeps the same rules for staff and states what a presenter now sees.

## ADDED Requirements

### Requirement: Staff screens have no persona picker or presenter controls
A `staff` account SHALL get the staff screens: the work board, the case pages and the office screens its capabilities allow. Its screens SHALL NOT show a persona picker, "Reset the sample cases" or "Load a sample checkpoint". They SHALL show "Signed in as <name>" with the staff member's person name. A staff window SHALL never save or restore a chosen persona, and SHALL ignore one left in its browser storage. Staff screens SHALL stay in English whatever language the browser chose. No account SHALL be offered a persona picker, a sample reset or a checkpoint. A presenter gets only the plain screen set by capability `sign-in`.

#### Scenario: A staff member signs in
- **WHEN** Riley Park signs in with a staff account
- **THEN** the work board opens with "Signed in as Riley Park", with no "Acting as" buttons and no reset or checkpoint controls

#### Scenario: A leftover persona in browser storage
- **WHEN** a browser whose storage still holds a persona chosen as Sam, left by an earlier presenter window, signs in as staff member Riley
- **THEN** Riley's window acts as Riley, never as Sam

#### Scenario: A presenter gets no staff screens
- **WHEN** a presenter signs in
- **THEN** the presenter sees only the plain "This account is no longer used" screen, with no persona picker, reset or checkpoint controls
