## MODIFIED Requirements

### Requirement: An admin can deactivate and reactivate a volunteer's account
The drawer SHALL offer Deactivate for an `invited` or `active` staff account, after a confirmation, and Reactivate for a `deactivated` one. Both SHALL be database RPCs that take an action id, the volunteer and the account revision the drawer read. They SHALL refuse a stale revision with `CONFLICT`. They SHALL store a receipt, and a replay SHALL return it.

Deactivate SHALL:
- in one transaction, set the account to `deactivated` with `deactivated_at`, and make the membership inactive;
- keep the auth user and the person's link, so the email stays locked and the person stays on the Roster;
- be refused with `OPEN_WORK` (SQLSTATE VT004), the open work as its detail, while the person holds open work as defined for a volunteer save, which counts only current-season cases (capability `volunteer-roster`). Being the default follow-up person SHALL always count as open work here, site coordinator or not. The drawer SHALL say "<name> still has open work: <list>. Finish it or hand it over first.";
- be refused with `INVALID_TRANSITION` (`LAST_SITE_COORDINATOR`) for the last site coordinator, and the drawer SHALL say "At least one site coordinator must remain. Make someone else a site coordinator first.";
- for any other site coordinator, remove their site coordinator mark in the same transaction (capability `site-coordinators`);
- be refused with `VALIDATION` (`SELF`) for the caller's own account.

Reactivate SHALL:
- make the membership active again;
- set the account to `active` if the person has signed in before, or to `invited` if not;
- send no email;
- restore the account only: the person SHALL still need roles, certificates and any photo ID check to be cleared, and SHALL NOT be a site coordinator again;
- be refused with `VALIDATION` (`EMAIL_IN_USE`) when the user meanwhile has an active membership in another workspace.

Deactivate and reactivate SHALL each be built on one internal function that acts on a single membership, so Start next season can reuse them (capability `season-rollover`), deactivating each account as Deactivate does.

Clients SHALL NOT be deactivated in this release.

A Reactivate that gives `invited` SHALL start a new seven days and a new five site-check attempts.

#### Scenario: Deactivating
- **WHEN** an admin deactivates a volunteer who holds no open work
- **THEN** the account is `deactivated`, the membership is inactive, the Roster shows "Deactivated", and the volunteer's open window shows "This account has no access" the next time it wakes (focus, the tab becoming visible, `online`, or a realtime reconnect), without a reload

#### Scenario: Deactivating with open work
- **WHEN** an admin deactivates a volunteer who is preparing an open case
- **THEN** it is refused with `OPEN_WORK`, the drawer lists that case, and the account is unchanged

#### Scenario: Deactivating the default follow-up person
- **WHEN** a site coordinator deactivates the default follow-up person, who is another site coordinator
- **THEN** it is refused with `OPEN_WORK`, and the drawer lists being the default follow-up person

#### Scenario: Deactivating the last site coordinator
- **WHEN** an admin who is not a site coordinator deactivates the only site coordinator, who is not the default follow-up person
- **THEN** it is refused with `FORBIDDEN` (only a site coordinator deactivates a site coordinator, capability `site-coordinators`), and the account is unchanged

#### Scenario: Deactivating yourself
- **WHEN** an admin deactivates their own account
- **THEN** it is refused with `VALIDATION`

#### Scenario: Reactivating someone who signed in before
- **WHEN** an admin reactivates a deactivated volunteer who had signed in
- **THEN** the account is `active`, the membership is active, no email is sent, and the volunteer is cleared only if their roles and photo ID check allow it

#### Scenario: Reactivating someone who never signed in
- **WHEN** an admin reactivates a deactivated volunteer who never signed in
- **THEN** the account is `invited`, and Resend is offered

#### Scenario: A stale drawer
- **WHEN** two admins open the same volunteer, one deactivates, and the other then presses Deactivate
- **THEN** the second is refused with `CONFLICT`

#### Scenario: A past-season case is not open work
- **WHEN** an admin deactivates a volunteer whose only cases are Accepted cases from an earlier season
- **THEN** the account is `deactivated`
