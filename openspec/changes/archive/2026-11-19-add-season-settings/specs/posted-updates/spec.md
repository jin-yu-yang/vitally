## MODIFIED Requirements

### Requirement: Only a ceiling admin writes updates
`vitally_save_update` and `vitally_update_action` SHALL be allowed only for a `staff` caller who is a workspace admin in that workspace (`is_workspace_admin`: a site coordinator, or holding the Admin role this season; capability `volunteer-roster`), cleared or not. In this capability, "ceiling admin" SHALL mean such a workspace admin. Any other caller SHALL be refused with `FORBIDDEN`, and nothing SHALL be written. Every write to `posted_updates` and `update_reads` SHALL go through the public RPCs, because signed-in users have no insert, update or delete grant on either table.

#### Scenario: An uncleared site coordinator posts
- **WHEN** a site coordinator who has no roles posts an update
- **THEN** it is posted

#### Scenario: An uncleared admin posts
- **WHEN** a staff member with the Admin role who is not cleared, and is not a site coordinator, posts an update
- **THEN** it is posted

#### Scenario: A preparer tries to post
- **WHEN** a cleared staff member with only the Preparer role, who is not a site coordinator, calls `vitally_save_update`
- **THEN** it is refused with `FORBIDDEN`, and nothing is stored

#### Scenario: A client tries to post
- **WHEN** a client calls `vitally_save_update`
- **THEN** it is refused with `FORBIDDEN`

#### Scenario: No direct writes
- **WHEN** a signed-in admin tries to insert into `posted_updates` or `update_reads` directly
- **THEN** the insert is refused
