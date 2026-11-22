## MODIFIED Requirements

### Requirement: The seed acts as role-named accounts found from the roster file
The command SHALL read the workspace id from the roster file (`--roster`, default `.vitally-roster.local.json`). In that workspace it SHALL find the people with person keys `site_coordinator`, `preparer` and `reviewer`, each linked to an active staff membership. The `site_coordinator` person SHALL be a site coordinator (capability `site-coordinators`). Client A SHALL be the roster file's first applicant. The workspace's default follow-up person SHALL be the `site_coordinator` person. If any of these is missing or different, the seed SHALL refuse before creating or deleting anything, with a message that names the missing role key or setting and never an email address.

When the workspace has no SIDN, the seed SHALL set the fictional SIDN `S00000000`, so a local invitation's site check can pass; it SHALL NOT change a SIDN that is already set (capability `season-settings`).

#### Scenario: All accounts are present
- **WHEN** the rehearsal workspace has the Site Coordinator, Preparer and Reviewer staff accounts, client A, and the Site Coordinator as a site coordinator and the default follow-up person
- **THEN** the seed proceeds

#### Scenario: A role account is missing
- **WHEN** the workspace has no person with key `reviewer`
- **THEN** the seed refuses with a message naming `reviewer`, and nothing is created or deleted

#### Scenario: The default follow-up person is still a persona
- **WHEN** the workspace's default follow-up person is Sam, as on a stack set up from the old example roster
- **THEN** the seed refuses, saying the default follow-up person must be the `site_coordinator` account and that the roster command should be re-run, and nothing is created or deleted

#### Scenario: The Site Coordinator is not a site coordinator
- **WHEN** the `site_coordinator` person is not a site coordinator, as on a stack set up from a roster file before this change
- **THEN** the seed refuses, saying `site_coordinator` must have `siteCoordinator: true` and that the roster command should be re-run, and nothing is created or deleted

#### Scenario: No SIDN yet
- **WHEN** the workspace has no SIDN and the seed runs
- **THEN** the workspace's SIDN is `S00000000`; and when a SIDN is already set, it is unchanged
