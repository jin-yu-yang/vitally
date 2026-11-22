## MODIFIED Requirements

### Requirement: Approving without going over the return opens an office follow-up
When a reviewer approves a review and answers "no" to going over the return with the taxpayer or spouse, the approval SHALL succeed. In the same transaction, the system SHALL open one office follow-up with purpose `go_over_return` on the case. The follow-up SHALL:
- be assigned to the workspace's configured office follow-up person;
- be created by the reviewer;
- have the reason "Go over the return with the client: the reviewer did not.";
- have no document request.

The same approval SHALL close the reviewer's own review-contact step (capability `review-and-corrections`), so the office follow-up is the only request to contact the client.

If the workspace has no configured office person, or that person is neither a site coordinator (capability `site-coordinators`) nor holds the `followup` capability, the approval SHALL be refused with `VALIDATION` and nothing SHALL change. An approval that answers "yes" SHALL open no follow-up.

#### Scenario: No opens a follow-up
- **WHEN** the reviewer approves with "Did you go over the return" answered no
- **THEN** the case moves to Ready to exit (`review_approved`) and has one open `go_over_return` follow-up assigned to the office person

#### Scenario: A site coordinator with no roles is the office person
- **WHEN** the office person is a site coordinator with no current-season roles, and the reviewer approves with no
- **THEN** the approval succeeds, and the follow-up is assigned to them

#### Scenario: Yes opens none
- **WHEN** the reviewer approves with that question answered yes and a date
- **THEN** the case has no new follow-up

#### Scenario: No office person configured
- **WHEN** the workspace has no default office follow-up person and the reviewer approves with no
- **THEN** the database refuses the approval with `VALIDATION`, and the review attempt stays active
