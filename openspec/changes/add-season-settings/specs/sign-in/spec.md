## ADDED Requirements

### Requirement: Follow-up access always comes with admin
A staff member whose capabilities include `followup` SHALL also have `admin`, because office follow-ups are worked on the office screens, which are admin-only (capability `office-follow-up`). The Admin role gives both (capability `volunteer-clearance`). The database SHALL never store a person whose capabilities include `followup` but not `admin`, whoever writes the row: a written value is replaced by the mirror of the person's roles (capability `volunteer-clearance`), and a check constraint still refuses any row that would hold `followup` without `admin`.

#### Scenario: No follow-up-only person can be stored
- **WHEN** a person's capabilities are written as `followup` and `review` directly in the database
- **THEN** the stored capabilities stay the mirror of the person's roles, never `followup` without `admin`, and the check constraint refusing `followup` without `admin` is still in place

#### Scenario: The Admin role gives both
- **WHEN** a signed-in volunteer is given the Admin role
- **THEN** their capabilities include both `admin` and `followup`

## MODIFIED Requirements

### Requirement: The roster can choose the default follow-up person
The roster file SHALL require a `defaultFollowup`, naming the `personKey` of a staff entry marked `siteCoordinator: true`. The workspace's default follow-up person SHALL become that person, and follow-ups escalated afterwards SHALL be assigned to them. Follow-ups already open SHALL keep their assignee. Withdrawal notices SHALL go to the default follow-up person, as escalated follow-ups do.

The roster command SHALL refuse a `defaultFollowup` that is missing, that names no staff entry, or that names an entry not marked `siteCoordinator: true`, with "defaultFollowup must name a staff entry with siteCoordinator: true.".

Every database check of the default follow-up person SHALL accept a person with a sign-in who is a site coordinator (capability `site-coordinators`) or whose `people.capabilities` include `followup`: setting the default, the workspace setup re-run, and assigning work to them when a document request is escalated, a review is approved without going over the return, a case is closed before filing, or a client withdraws. Clearance SHALL never be asked of the default follow-up person (capability `volunteer-clearance`).

#### Scenario: A staff member takes new follow-ups
- **WHEN** the roster sets `defaultFollowup` to a staff entry marked `siteCoordinator: true` who has no roles, and a document request then goes unanswered and is escalated
- **THEN** the new follow-up is assigned to that staff member

#### Scenario: Open follow-ups stay where they are
- **WHEN** a staff member has an open follow-up and the roster sets `defaultFollowup` to another staff member
- **THEN** the open follow-up is still assigned to the first staff member

#### Scenario: No default given
- **WHEN** a roster has staff members and no `defaultFollowup`
- **THEN** the roster command refuses it, and nothing is created in the workspace

#### Scenario: A default without the capability
- **WHEN** `defaultFollowup` names a staff entry without `siteCoordinator: true`
- **THEN** the roster command refuses the roster with "defaultFollowup must name a staff entry with siteCoordinator: true.", and the default does not change

#### Scenario: A default with the Admin role but no site coordinator yet
- **WHEN** migration 052 has run and nobody is a site coordinator yet, and the default follow-up person holds the Admin role this season
- **THEN** escalations, approvals without going over the return, closes before filing and withdrawals still assign to them

### Requirement: The roster creates staff members as new people, with no reserved keys
The roster file SHALL accept a `staff` list. Each entry SHALL have:
- an `email`;
- a `name` of 1 to 80 characters;
- a `personKey` that is a valid person key;
- optionally `siteCoordinator: true`.

A staff entry that still has `capabilities` SHALL be accepted, and the command SHALL print once "capabilities is no longer used and was ignored; roles on the Roster decide what each person can do." A `siteCoordinator` that is not `true` or `false` SHALL stop the command with "staff[<n>].siteCoordinator must be true or false.", where <n> is the entry's position counted from 0.

For each entry, the roster command SHALL create a confirmed, password-free Auth account if none exists. In one database transaction with the rest of the workspace setup, it SHALL create the `staff` membership and link it to a person:
- If a person in the workspace has no sign-in and their volunteer profile has this account's email, ignoring case, that person SHALL be linked. They SHALL take the entry's key, and keep the name, roles and certificates recorded on the Roster.
- Otherwise a new person SHALL be created with that key and name, with a volunteer profile holding the account's email and a roster entry for the current season with no roles.

An entry with `siteCoordinator: true` SHALL make that person a site coordinator in the same transaction (capability `site-coordinators`), recorded in the history as made by the roster command. An entry without it SHALL NOT remove site coordinator from anyone. The person's capabilities SHALL come from their roles (capability `volunteer-clearance`); the roster command SHALL NOT set them.

Re-running the same roster SHALL create nothing new and SHALL succeed. A re-run SHALL NOT compare the name, and SHALL NOT change the name in the database.

The roster command SHALL refuse:
- a key or address that appears twice;
- an address that is also listed as a client;
- an address with an active membership in another workspace;
- a re-run that gives an existing staff member a different key;
- a key already held in the workspace by any person who is not exactly that staff member, including a kept demonstration persona.

No person key SHALL be reserved by name. A new workspace SHALL be created with no unlinked people.

When an entry links a person already on the Roster, the roster command SHALL print a line naming that entry's key, and SHALL say so when the name on the Roster differs from the name in the file.

The roster command SHALL never print an email address.

#### Scenario: A link is reported
- **WHEN** a roster run links an entry with key `riley` to a volunteer whose Roster name differs from the file's name
- **THEN** the command prints a line naming `riley`, says the names differ, and prints no email address

#### Scenario: A staff member is added
- **WHEN** an operator adds `{ email, name: "Riley Park", personKey: "riley" }` to the `staff` list and runs the roster command
- **THEN** a confirmed account exists for that address, with a `staff` membership linked to a new person `riley` named "Riley Park" with no capabilities, and Riley is on the Roster with that email and no roles

#### Scenario: A site coordinator is added
- **WHEN** an operator adds `{ email, name: "Sky Chen", personKey: "site_coordinator", siteCoordinator: true }` and runs the roster command
- **THEN** Sky Chen is a site coordinator, opens the Roster and Season settings, and the history says the roster command made them a site coordinator

#### Scenario: An old roster with capabilities
- **WHEN** a roster whose staff entries still have `capabilities` is run
- **THEN** the command prints that capabilities is no longer used and was ignored, succeeds, and no person's capabilities differ from their roles' capabilities

#### Scenario: Changed capabilities on a re-run
- **WHEN** the operator changes `riley`'s `capabilities` in the file to `["prepare","review"]` and runs the roster again
- **THEN** the command prints that capabilities is no longer used and was ignored, succeeds, and `riley`'s capabilities still come from their roles

#### Scenario: Running the roster again
- **WHEN** the operator runs the same roster again
- **THEN** it succeeds and creates no account, membership, person or site coordinator history row

#### Scenario: A volunteer already on the Roster
- **WHEN** an admin has added a volunteer named "Riley Park" with no sign-in and the Preparer role, and the operator then runs a roster with that email and the key `riley`, in any letter case and under any name
- **THEN** the workspace still has one person for that volunteer, now linked to a `staff` membership with key `riley`, still named "Riley Park", still with their roles and certificates, and with `prepare`

#### Scenario: A renamed staff member on a re-run
- **WHEN** an admin renames a staff member on the Roster and the operator runs the same roster again
- **THEN** it succeeds, and the staff member keeps the name given on the Roster

#### Scenario: A freed key
- **WHEN** a staff entry uses the key `sam` in a workspace that has no person with that key
- **THEN** the staff member is added as a new person `sam`

#### Scenario: A key held by a kept persona
- **WHEN** a staff entry uses the key `sam` in a workspace that kept its unlinked Sam
- **THEN** the database refuses the roster, nothing is created in the workspace, and the kept Sam stays unlinked

#### Scenario: A new workspace has no personas
- **WHEN** a roster runs on a new workspace
- **THEN** the workspace's people are exactly its staff members; it has no Alex, Morgan or Sam

### Requirement: A roster needs staff and a default follow-up person
A roster SHALL list at least one staff member and SHALL name a `defaultFollowup`. A roster that still has a `siteNumber` SHALL be accepted, and the command SHALL print "siteNumber is no longer used and was ignored; set the SIDN on Season settings." and SHALL NOT change the workspace's site number (capability `season-settings`). A roster that still has a `presenters` list SHALL be accepted, and the command SHALL print "presenters is no longer used and was ignored; those addresses get no access." It SHALL create no account and no membership for those addresses. A workspace SHALL work for its staff and clients.

#### Scenario: A staff roster
- **WHEN** a roster lists staff members and clients and a `defaultFollowup` naming a staff entry marked `siteCoordinator: true`
- **THEN** the roster command succeeds, the staff members can sign in, and new follow-ups go to that staff member

#### Scenario: An empty staff side
- **WHEN** a roster lists only clients
- **THEN** the roster command refuses it

#### Scenario: An old roster with a site number
- **WHEN** a roster that still has `siteNumber` is run on a workspace whose SIDN was set on Season settings
- **THEN** the command prints that siteNumber is no longer used and was ignored, and the workspace's SIDN is unchanged

#### Scenario: An old roster with presenters
- **WHEN** a roster that also lists `presenters` is run
- **THEN** the command prints that presenters is no longer used and those addresses get no access, and no account or membership is created for them

## REMOVED Requirements

### Requirement: A staff member with follow-up access also has admin

**Reason**: Replaced by "Follow-up access always comes with admin". The roster command and `add_staff_member` no longer take capabilities, so their refusals of `followup` without `admin` ("staff[<n>].capabilities must include admin when they include followup.", and `add_staff_member`'s `VALIDATION`) are gone with the code that made them. A person can no longer hold `admin` without `followup`, because only the Admin role gives either.

**Migration**: Roster files may keep `capabilities`; they are ignored with a notice. The database check that refuses `followup` without `admin` stays, under the new requirement.
