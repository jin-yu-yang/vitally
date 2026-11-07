## REMOVED Requirements

### Requirement: Sample cases and checkpoints stay presenter-only
**Reason**: `vitally_reset_fixtures` and `vitally_load_checkpoint` are dropped by migration 040, so nobody can call them.
**Migration**: Rehearsal cases come from `npm run seed:local` (capability `local-seed-data`).

## MODIFIED Requirements

### Requirement: A workspace can have staff and no presenter
A roster SHALL need at least one presenter or one staff member, and SHALL NOT require a presenter. A roster with no presenter SHALL name a `defaultFollowup`. A workspace with no presenter SHALL work for staff and clients.

#### Scenario: A staff-only roster
- **WHEN** a roster lists staff members and clients, no presenters, and a `defaultFollowup` naming a staff member with `followup`
- **THEN** the roster command succeeds, the staff members can sign in and work cases, and new follow-ups go to that staff member

#### Scenario: A staff-only roster without a follow-up person
- **WHEN** a roster lists staff members and no presenters, and has no `defaultFollowup`
- **THEN** the roster command refuses it, and nothing is created in the workspace

#### Scenario: An empty staff side
- **WHEN** a roster lists only clients
- **THEN** the roster command refuses it
