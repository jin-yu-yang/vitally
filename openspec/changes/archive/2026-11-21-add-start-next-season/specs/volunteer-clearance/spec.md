## MODIFIED Requirements

### Requirement: A person's capabilities mirror this season's roles while they have a sign-in
`people.capabilities` SHALL equal the capabilities of the person's roles on their roster entry for the workspace's current season while the person has a sign-in (`user_id` set), and SHALL be empty otherwise. The database SHALL keep it so whoever writes `people` or `roster_entries`: a direct write of a different value SHALL be replaced by the mirror. Neither the roster command, workspace setup, account creation nor the site check SHALL choose a person's capabilities. A person with no current-season entry SHALL have none. Changes SHALL reach open staff windows through the existing `people` realtime messages, under the existing `people` read policy.

Start next season (capability `season-rollover`) SHALL recompute every person's mirror in the same transaction that changes `current_season`. Any other change of `current_season` SHALL NOT be relied on to update it.

#### Scenario: The mirror follows a role change
- **WHEN** an admin adds the Reviewer role to a signed-in Preparer and saves
- **THEN** that person's `people.capabilities` become `prepare` and `review`, and a staff window subscribed to `people` receives the change

#### Scenario: Removing every role
- **WHEN** an admin removes every role from a signed-in volunteer who holds no open work
- **THEN** their `people.capabilities` are empty

#### Scenario: A direct write is replaced
- **WHEN** a person's `people.capabilities` are written directly as `prepare` while their only role is Greeter
- **THEN** the stored capabilities stay empty

#### Scenario: Roles with no sign-in stay hidden until sign-in
- **WHEN** a Roster volunteer with no sign-in has the Preparer role and its certificates, and a staff member without `admin` reads `people`
- **THEN** that volunteer is not returned; and once the volunteer's account is created and they pass the site check, the staff member reads them with `prepare`

#### Scenario: An invited volunteer given the Admin role
- **WHEN** an invited volunteer passes the site check, and a site coordinator then gives them VSC, IT&QR and the Admin role
- **THEN** their `people.capabilities` are `admin`, `assist`, `followup` and `receive_documents`, and they open the Roster

#### Scenario: The season starts
- **WHEN** a site coordinator who is a cleared Admin and Reviewer in 2026 starts 2027
- **THEN** their `people.capabilities` are empty until 2027 roles are saved for them, and every other person's capabilities equal the mirror of their 2027 roles

