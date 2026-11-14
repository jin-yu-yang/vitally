## MODIFIED Requirements

### Requirement: A staff member is cleared only with a role and, if new, a photo ID check
A person SHALL be cleared for a workspace when:
- their roster entry for the workspace's current season has at least one role;
- either the entry is not marked new or its photo ID check is recorded;
- their account in that workspace is `active`.

A person SHALL NOT be cleared if they have no roster entry for the current season, no roles, or no account, or if their account is `invited` or `deactivated`. A cleared person's roles are in effect, because a role exists only once its certificates are confirmed.

#### Scenario: Roles and an old hand
- **WHEN** a staff member with an active account has a current-season entry with Preparer, is not marked new, and has their certificates confirmed
- **THEN** they are cleared

#### Scenario: No roles
- **WHEN** a staff member's current-season entry has no roles
- **THEN** they are not cleared

#### Scenario: New without photo ID
- **WHEN** a staff member with an active account has an entry with Greeter that is marked new with no photo ID check
- **THEN** they are not cleared, and once the photo ID check is recorded they are

#### Scenario: Last season only
- **WHEN** a staff member has roles only on an earlier season's entry
- **THEN** they are not cleared

#### Scenario: No account
- **WHEN** a volunteer with no sign-in has Preparer with its certificates and is not marked new
- **THEN** they are not cleared

#### Scenario: Invited but not signed in
- **WHEN** a volunteer with Preparer and its certificates has an `invited` account, and then signs in for the first time
- **THEN** they are not cleared before the sign-in, and are cleared after it

#### Scenario: Deactivated
- **WHEN** a cleared staff member's account is deactivated
- **THEN** they are not cleared, and work cannot be assigned to them
