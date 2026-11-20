# site-coordinators Specification

## Purpose
The site coordinator: an account-level role kept across seasons that makes a person a workspace admin, governs the Admin role and Season settings, and needs the SC certificate to be cleared when on this season's roster. It covers who grants and removes it (site coordinators only, on Season settings, or the roster command for the first one), the rules that keep at least one and keep the default follow-up person a site coordinator, the audit history, the Site coordinators card, and what deactivating a site coordinator does.

## Requirements

### Requirement: A site coordinator is an account-level role kept across seasons
Each account SHALL record whether its person is a site coordinator. The site coordinators of a workspace SHALL be the people whose account there is `active` and marked as site coordinator. Being a site coordinator SHALL NOT depend on the season, the roster or roles: it SHALL stay until it is removed or the account is deactivated. Migration 052 SHALL mark nobody.

A site coordinator SHALL be a workspace admin, cleared or not (capability `volunteer-roster`). A site coordinator SHALL gain no case capability from it: what they do on cases SHALL come from their roles (capability `volunteer-clearance`).

#### Scenario: Not on this season's roster
- **WHEN** a site coordinator has no roster entry for the current season
- **THEN** they are still a site coordinator, open the Roster and Season settings, and are not cleared

#### Scenario: Nobody after the migration
- **WHEN** migration 052 runs on a workspace
- **THEN** no account is marked as site coordinator

### Requirement: Only a site coordinator grants or removes site coordinator
Site coordinator SHALL be granted and removed through one RPC that takes an action id, the volunteer, the account revision the page read, and whether to grant. It SHALL be allowed only for a site coordinator, and refused with `FORBIDDEN` for anyone else before any other check, writing nothing and storing no receipt. It SHALL refuse:
- a volunteer with no `active` account in the workspace, with `VALIDATION` (`NO_ACTIVE_ACCOUNT`);
- a grant to a site coordinator or a removal from someone who isn't one, with `INVALID_TRANSITION`;
- removing the last site coordinator, with `INVALID_TRANSITION` (`LAST_SITE_COORDINATOR`);
- removing the workspace's default follow-up person, with `INVALID_TRANSITION` (`DEFAULT_FOLLOWUP`);
- a stale account revision, with `CONFLICT`.

A change SHALL raise the account's revision and store a receipt; a repeated request SHALL return the stored result. A site coordinator MAY remove themselves when another remains.

#### Scenario: Granting
- **WHEN** a site coordinator makes an active volunteer a site coordinator
- **THEN** the volunteer is a site coordinator, and the change is in the history

#### Scenario: An admin who is not a site coordinator
- **WHEN** a staff member with the Admin role who is not a site coordinator grants or removes site coordinator directly
- **THEN** it is refused with `FORBIDDEN`, nothing changes, and no receipt is stored

#### Scenario: No active account
- **WHEN** a site coordinator grants site coordinator to a volunteer whose account is invited, deactivated or not created
- **THEN** it is refused with `VALIDATION` (`NO_ACTIVE_ACCOUNT`)

#### Scenario: The last site coordinator
- **WHEN** the only site coordinator removes themselves
- **THEN** it is refused with `LAST_SITE_COORDINATOR`, and the card says "At least one site coordinator must remain. Make someone else a site coordinator first."

#### Scenario: The default follow-up person
- **WHEN** a site coordinator removes site coordinator from the default follow-up person while another site coordinator remains
- **THEN** it is refused with `DEFAULT_FOLLOWUP`, and the card says "<name> is the default follow-up person, so they stay a site coordinator."

### Requirement: Every site coordinator change is recorded
Every grant and removal SHALL add one row to the workspace's site coordinator history: the person, whether it was a grant, who made it (null for the roster command), and when. Rows SHALL NOT be changed or deleted by any signed-in user, and signed-in users SHALL have no direct grant on the history.

#### Scenario: A grant and a removal
- **WHEN** a site coordinator grants site coordinator to Dana Wu and later removes it
- **THEN** the history has two rows for Dana Wu, a grant and a removal, each naming that site coordinator and the time

#### Scenario: The roster command
- **WHEN** the roster command marks an entry as site coordinator
- **THEN** the history has a grant for that person with no person named as the one who made it

### Requirement: The Site coordinators card lists them, with history
Season settings SHALL have a "Site coordinators" card with the note "Kept across seasons · at least one". It SHALL list each site coordinator with their name, a "You" badge for the signed-in person, their email, "since <date>" (their latest grant), and "not on this season's roster" when they have no current-season roster entry. For a site coordinator, each row SHALL have Remove, and below the list a picker "Make someone a site coordinator…", offering every person with an active staff account who is not a site coordinator, with Add. A History disclosure SHALL list the changes newest first, at most 50, as "<who> made <name> a site coordinator", "<who> removed <name> as site coordinator", or "The roster command made <name> a site coordinator", each with its date. Adding SHALL say "<name> is now a site coordinator", and removing "<name> is no longer a site coordinator".

#### Scenario: The list
- **WHEN** a workspace admin opens Season settings in a workspace with two site coordinators, one not on this season's roster
- **THEN** both are listed with their emails and since dates, and the second says "not on this season's roster"

#### Scenario: Adding from the picker
- **WHEN** a site coordinator picks a volunteer with an active account in "Make someone a site coordinator…" and presses Add
- **THEN** the list includes them, the page says "<name> is now a site coordinator", and History's first line says so

#### Scenario: The picker offers only active accounts
- **WHEN** a site coordinator opens the picker in a workspace with an invited volunteer and a deactivated one
- **THEN** neither is offered

### Requirement: Deactivating a site coordinator
Deactivating the account of the last site coordinator SHALL be refused with `INVALID_TRANSITION` (`LAST_SITE_COORDINATOR`), and the drawer SHALL say "At least one site coordinator must remain. Make someone else a site coordinator first." Deactivating any other site coordinator SHALL also remove their site coordinator mark in the same transaction, recorded in the history as a removal by the admin who deactivated them; reactivating them SHALL NOT restore it. Deactivating the default follow-up person SHALL stay refused as open work (capability `sign-in-accounts`).

#### Scenario: The last site coordinator
- **WHEN** an admin deactivates the only site coordinator's account
- **THEN** it is refused with `LAST_SITE_COORDINATOR`, and the account is unchanged

#### Scenario: Another site coordinator
- **WHEN** an admin deactivates a site coordinator who is not the last one and not the default follow-up person
- **THEN** the account is deactivated, they are no longer a site coordinator, the history records the removal, and reactivating them leaves them not a site coordinator
