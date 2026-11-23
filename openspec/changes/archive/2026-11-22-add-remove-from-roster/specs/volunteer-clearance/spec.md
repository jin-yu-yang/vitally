## ADDED Requirements

### Requirement: Removing a person from the roster empties their capabilities and their clearance
When a person's current-season roster entry is removed (capability `volunteer-roster`), their `people.capabilities` SHALL be recomputed as the mirror, which is empty with no current-season entry, whether or not they keep a sign-in. They SHALL NOT be cleared. Case RPCs SHALL refuse them as an uncleared staff member if their membership is still active (a site coordinator), and as having no membership otherwise.

A removed person's open window SHALL learn of it on its next clearance re-read, on the wake events that already trigger one (focus, the tab becoming visible, `online`, or a realtime reconnect):
- a person whose account was deactivated SHALL see "This account has no access";
- a site coordinator, whose account stays active, SHALL see the setup screen.

#### Scenario: Capabilities after removal
- **WHEN** a Reviewer with an active account is removed from the current roster
- **THEN** their `people.capabilities` is empty

#### Scenario: A site coordinator's capabilities after removal
- **WHEN** a site coordinator holding the Admin role is removed by another site coordinator
- **THEN** their `people.capabilities` is empty, they are not cleared, and they are still a workspace admin through the site coordinator mark

#### Scenario: A removed site coordinator's window
- **WHEN** a site coordinator with the work board open is removed from the roster, and their window then regains focus
- **THEN** the window shows "Finish your setup", without a reload
