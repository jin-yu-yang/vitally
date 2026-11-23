## ADDED Requirements

### Requirement: Removing a volunteer from the roster deactivates their account as Deactivate does
Removing a volunteer from this season's roster (capability `volunteer-roster`) SHALL deactivate their account through the same internal function that Deactivate and Start next season use, when the account is `invited` or `active` and is not a site coordinator's. The deactivation SHALL be recorded with the remover as the person who changed it. It SHALL send no email.

The removal SHALL NOT cancel an invitation: an `invited` account SHALL become `deactivated`, keeping the auth user, the membership and the person's link, so the email stays linked to the person.

With no account, or an account already `deactivated`, the removal SHALL NOT call the deactivation, and the account SHALL be unchanged.

Afterwards, Reactivate SHALL work as for any deactivated account: `active` if the person signed in before, otherwise `invited` with a new seven days.

#### Scenario: An active account
- **WHEN** an admin removes a volunteer with an active account
- **THEN** the account is `deactivated` with `deactivated_at` set, the membership is inactive, and the Roster's search offers the person as an earlier volunteer with the account shown as deactivated

#### Scenario: An invited account
- **WHEN** an admin removes a volunteer whose invitation is still pending
- **THEN** the account is `deactivated`, the membership is inactive but kept, and the profile email can't be edited

#### Scenario: Reactivating after a re-add
- **WHEN** a removed volunteer who had signed in is added back and an admin presses Reactivate
- **THEN** the account is `active`, and the volunteer is cleared only once their roles and photo ID check allow it

#### Scenario: The removed volunteer's window
- **WHEN** a removed volunteer has the work board open and the window then regains focus
- **THEN** their window shows "This account has no access", without a reload
