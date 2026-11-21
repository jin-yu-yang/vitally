## MODIFIED Requirements

### Requirement: A save cannot take away what a person's open work needs
`vitally_save_volunteer` SHALL refuse a save, with nothing written, when it would leave the person without a capability their open work needs, or uncleared while they hold any open work. The capabilities before and after the save SHALL be the role capabilities of the stored and requested roles. Open work and the capability each needs SHALL be:
- preparer of a current-season case that is not closed: `prepare`;
- reviewer of a current-season case that is not closed: `review`;
- assignee of an open follow-up: `followup`;
- the workspace's default follow-up person: `followup`, unless they are a site coordinator, who meets this need whatever their roles or clearance;
- assignee of a claimed help request: `assist`.

The drawer SHALL say "<name> still has open work: <list>. Finish it or hand it over first.", listing that work. A current-season case SHALL be one whose season is the workspace's current season or is not yet set; a case from an earlier season SHALL NOT count, whatever its stage. A save that keeps every needed capability, and keeps the person cleared, SHALL be allowed.

#### Scenario: Removing Preparer while preparing
- **WHEN** an admin removes Preparer from a volunteer who is preparing an open case
- **THEN** the save is refused, the drawer lists that case, and the volunteer keeps Preparer

#### Scenario: Unticking a certificate the work needs
- **WHEN** a site coordinator unticks IT&QR for a default follow-up person who is not a site coordinator, which would remove their Admin role, and saves
- **THEN** the save is refused and the drawer lists being the default follow-up person

#### Scenario: A site coordinator who is the default
- **WHEN** a site coordinator removes the Admin role from the default follow-up person, who is a site coordinator and holds no other open work
- **THEN** the save succeeds, and they stay the default follow-up person

#### Scenario: A change the work doesn't need
- **WHEN** an admin removes Greeter from a volunteer who also has Preparer and is preparing an open case
- **THEN** the save succeeds

#### Scenario: Another certificate still covers the role
- **WHEN** an admin unticks Advanced for a Preparer who is preparing a case and also has Basic
- **THEN** the save succeeds, and they keep Preparer

#### Scenario: No open work
- **WHEN** an admin removes every role from a volunteer who holds no open work
- **THEN** the save succeeds, and the volunteer is no longer cleared

#### Scenario: A returning volunteer with a past-season case
- **WHEN** a volunteer was the preparer of an Accepted 2026 case, the season is now 2027, and an admin removes Preparer from their 2027 roster entry
- **THEN** the save succeeds, and the 2026 case still names them as its preparer

#### Scenario: A current-season Accepted case still counts
- **WHEN** an admin removes Preparer from a volunteer who prepared an Accepted case of the current season
- **THEN** the save is refused, and the drawer lists that case
