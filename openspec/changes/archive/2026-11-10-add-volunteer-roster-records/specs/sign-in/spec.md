## MODIFIED Requirements

### Requirement: The roster creates staff members as new people, with no reserved keys
The roster file SHALL accept a `staff` list. Each entry SHALL have:
- an `email`;
- a `name` of 1 to 80 characters;
- a `personKey` that is a valid person key;
- `capabilities` from `prepare`, `review`, `admin`, `followup`, `receive_documents` and `assist`.

For each entry, the roster command SHALL create a confirmed, password-free Auth account if none exists. In one database transaction with the rest of the workspace setup, it SHALL create the `staff` membership and link it to a person:
- If a person in the workspace has no sign-in and their volunteer profile has this account's email, ignoring case, that person SHALL be linked. They SHALL take the entry's key and capabilities, and keep the name recorded on the Roster.
- Otherwise a new person SHALL be created with that key, name and capabilities, with a volunteer profile holding the account's email and a roster entry for the current season with no roles.

Re-running the same roster SHALL create nothing new and SHALL succeed. A re-run SHALL NOT compare the name, and SHALL NOT change the name in the database.

The roster command SHALL refuse:
- a key or address that appears twice;
- an address that is also listed as a client;
- an address with an active membership in another workspace;
- a capability outside the list above, or a staff entry with no capabilities;
- a re-run that gives an existing staff member a different key or capabilities;
- a key already held in the workspace by any person who is not exactly that staff member, including a kept demonstration persona.

No person key SHALL be reserved by name. A new workspace SHALL be created with no unlinked people.

When an entry links a person already on the Roster, the roster command SHALL print a line naming that entry's key, and SHALL say so when the name on the Roster differs from the name in the file.

The roster command SHALL never print an email address.

#### Scenario: A link is reported
- **WHEN** a roster run links an entry with key `riley` to a volunteer whose Roster name differs from the file's name
- **THEN** the command prints a line naming `riley`, says the names differ, and prints no email address

#### Scenario: A staff member is added
- **WHEN** an operator adds `{ email, name: "Riley Park", personKey: "riley", capabilities: ["prepare"] }` to the `staff` list and runs the roster command
- **THEN** a confirmed account exists for that address, with a `staff` membership linked to a new person `riley` named "Riley Park" with `prepare`, and Riley is on the Roster with that email and no roles

#### Scenario: Running the roster again
- **WHEN** the operator runs the same roster again
- **THEN** it succeeds and creates no account, membership or person

#### Scenario: A volunteer already on the Roster
- **WHEN** an admin has added a volunteer named "Riley Park" with no sign-in, and the operator then runs a roster with that email, the key `riley` and `prepare`, in any letter case and under any name
- **THEN** the workspace still has one person for that volunteer, now linked to a `staff` membership with key `riley` and `prepare`, still named "Riley Park" and still with their roles and certificates

#### Scenario: A renamed staff member on a re-run
- **WHEN** an admin renames a staff member on the Roster and the operator runs the same roster again
- **THEN** it succeeds, and the staff member keeps the name given on the Roster

#### Scenario: A freed key
- **WHEN** a staff entry uses the key `sam` in a workspace that has no person with that key
- **THEN** the staff member is added as a new person `sam`

#### Scenario: A key held by a kept persona
- **WHEN** a staff entry uses the key `sam` in a workspace that kept its unlinked Sam
- **THEN** the database refuses the roster, nothing is created in the workspace, and the kept Sam stays unlinked

#### Scenario: Changed capabilities on a re-run
- **WHEN** the operator changes `riley`'s capabilities to `["prepare","review"]` and runs the roster again
- **THEN** the roster command refuses it, and `riley` keeps `prepare` only

#### Scenario: A new workspace has no personas
- **WHEN** a roster runs on a new workspace
- **THEN** the workspace's people are exactly its staff members; it has no Alex, Morgan or Sam
