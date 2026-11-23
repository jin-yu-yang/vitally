## ADDED Requirements

### Requirement: Only a site coordinator removes a site coordinator from the roster
Removing a site coordinator from this season's roster (capability `volunteer-roster`) SHALL need a site coordinator. Anyone else SHALL be refused with `FORBIDDEN`, and the roster entry, the account, the site coordinator mark and its history SHALL be unchanged.

When a site coordinator removes another site coordinator, the removal SHALL delete only that person's current-season roster entry. It SHALL NOT deactivate their account and SHALL NOT remove their site coordinator mark or record a change in its history. They SHALL stay a site coordinator, keep the Roster and Season settings, and have no roles this season.

Removal SHALL NOT pass a site coordinator's account to the internal deactivation, so it can never be refused with `LAST_SITE_COORDINATOR`.

#### Scenario: An admin who isn't a site coordinator
- **WHEN** an admin by the Admin role who is not a site coordinator removes a site coordinator
- **THEN** it is refused with `FORBIDDEN`, and nothing is changed

#### Scenario: A site coordinator removes another
- **WHEN** a site coordinator removes another site coordinator who holds no open work
- **THEN** that person has no current-season roster entry, their account is still `active` and marked site coordinator, and the site coordinator history is unchanged

#### Scenario: The only other site coordinator
- **WHEN** a workspace has two site coordinators and one removes the other from the roster
- **THEN** the removal succeeds, both are still site coordinators, and the internal deactivation was not called

#### Scenario: The removed site coordinator's window
- **WHEN** a removed site coordinator's window next wakes
- **THEN** it shows the setup screen, and their sidebar still has the Roster and Season settings
