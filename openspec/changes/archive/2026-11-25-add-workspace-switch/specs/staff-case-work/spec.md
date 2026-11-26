## ADDED Requirements

### Requirement: A case page shows only its own side's actions
A case page SHALL show only the actions of the side the window is on: the office case page on the office side, the volunteer case page on the Cases side. It SHALL NOT show both sides' actions together.

#### Scenario: An admin-reviewer sees a case waiting for review
- **WHEN** an Admin who is also a Reviewer, on the office side, opens a case at Pending review that nobody has claimed and that they did not prepare
- **THEN** the office case page shows no Claim review

### Requirement: The office case page points a person with both sides to Cases
On the office case page of a staff member who has the workspace switch, the Overview tab SHALL open with at most one line pointing to Cases. It SHALL be the first the volunteer case's rules allow, in this order:
1. claim preparation: "You can claim this case — switch to Cases"
2. claim the review: "You can review this case — switch to Cases"
3. preparation work: "You're preparing this case — switch to Cases"
4. the review decision: "You're reviewing this case — switch to Cases"

#### Scenario: A review to claim
- **WHEN** an Admin who is also a Reviewer, on the office side, opens a case at Pending review that nobody has claimed and that they did not prepare
- **THEN** the Overview shows "You can review this case — switch to Cases"

#### Scenario: Work already held
- **WHEN** an Intaker who is also a Preparer and is this case's preparer opens it on the office side while it is being prepared
- **THEN** the Overview shows "You're preparing this case — switch to Cases"

#### Scenario: Nothing to claim
- **WHEN** an Admin who is also a Preparer opens, on the office side, a case at Screening in progress
- **THEN** no line pointing to Cases shows

#### Scenario: Admin only
- **WHEN** an Admin with no `prepare` or `review` opens a case at Ready to prepare
- **THEN** no line pointing to Cases shows

### Requirement: Switch to Cases keeps the same case open
The line pointing to Cases SHALL carry a **Switch to Cases** button. Pressing it SHALL switch the window to Cases, as the workspace switch does, and SHALL show the same case as the volunteer case page on its Overview tab.

#### Scenario: Switching from the line
- **WHEN** the Admin who is also a Reviewer presses Switch to Cases on that case
- **THEN** the same case shows as the volunteer case page on its Overview tab, with Claim review, and Cases is pressed in the sidebar
