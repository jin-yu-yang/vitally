## MODIFIED Requirements

### Requirement: The admin check answers only for the caller
The schema `vitally_policy` SHALL hold exactly four functions:
- `is_workspace_admin(p_workspace_id uuid)`, which answers whether the signed-in caller's person has `admin` in `people.capabilities` in the given workspace;
- `cleared_workspace_id()`, which returns the workspace of the caller's active `staff` membership when the caller is cleared for its current season, and null otherwise;
- `in_update_audience(p_workspace_id uuid, p_audience text, p_roles text[])`, which answers whether the signed-in caller's person is in a posted update's audience (capability `posted-updates`);
- `unpublished_read_window()`, which returns how long the audience still reads an unpublished update (capability `posted-updates`).

None SHALL take a user id, and each that answers about a person SHALL answer only for the signed-in caller. `is_workspace_admin`, `cleared_workspace_id` and `in_update_audience` SHALL be `security definer` and `stable` with `search_path=''`. `unpublished_read_window` reads nothing: it SHALL be `immutable`, not `security definer`, with `search_path=''`. Execute on each SHALL be granted to `authenticated` only, and SHALL NOT be held by `public`, `anon` or `service_role`.

#### Scenario: The catalog
- **WHEN** the database catalog is read
- **THEN** `vitally_policy` holds only `is_workspace_admin(uuid)`, `cleared_workspace_id()`, `in_update_audience(uuid, text, text[])` and `unpublished_read_window()`, with those properties and grants, and no argument of any function in the schema names a user

#### Scenario: A non-admin asks
- **WHEN** a staff member without `admin` calls `is_workspace_admin` for their own workspace
- **THEN** it returns false

#### Scenario: An admin asks about another workspace
- **WHEN** an admin of one workspace calls `is_workspace_admin` for another workspace
- **THEN** it returns false

#### Scenario: An uncleared admin is still an admin
- **WHEN** a staff member whose `people.capabilities` include `admin` and who has no roles calls `is_workspace_admin` for their own workspace
- **THEN** it returns true, and `cleared_workspace_id()` returns null
