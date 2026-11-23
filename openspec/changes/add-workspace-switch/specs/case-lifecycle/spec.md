## MODIFIED Requirements

### Requirement: Screening starts when an admin first opens a case
When a staff member with `admin` opens a case's page at Request sent while their window is on the office side, their window SHALL start screening for that case. It SHALL do this whether the case page was opened by its reference, the search, Follow-ups, the case pool or a reload. A list control that acts on a case without opening its page (for example Log contact on Follow-ups) SHALL NOT start screening. The window of a staff member without `admin` SHALL start nothing, and so SHALL a window on the Cases side, whatever its capabilities. When a staff member with `admin` switches from Cases to Office while a case at Request sent is open, their window SHALL start screening for it, as opening it there would. The start SHALL be sent once per case.

**Quietly:**
- It SHALL NOT disable the page's buttons.
- It SHALL NOT show an error, a Try again or a toast for itself.
- When another admin started screening first, or the case changed meanwhile, the window SHALL re-read the case and show it at Screening in progress.
- When the connection is down, the case SHALL stay at Request sent under the connection notice, and the start SHALL be sent again once the connection returns while the case is open.

Starting screening SHALL tell the client (see "Clients are told at each new step"). It SHALL NOT be undone.

#### Scenario: An admin opens a new application
- **WHEN** the Site Coordinator, an admin, opens a case at Request sent
- **THEN** the case moves to Screening in progress, the client's page shows "Being reviewed", and the client's history gains "PCDC started reviewing your application. We may call you."

#### Scenario: Two admins open it at once
- **WHEN** two admin windows open the same Request sent case
- **THEN** the case moves to Screening in progress once, and neither window shows an error

#### Scenario: A volunteer opens it
- **WHEN** a staff member without `admin`, such as the Preparer, opens a case at Request sent
- **THEN** the case stays at Request sent

#### Scenario: An Intaker opens it
- **WHEN** an Intaker, whose window is on the office side, opens a case at Request sent
- **THEN** the case stays at Request sent

#### Scenario: An admin on the Cases side opens it
- **WHEN** an Admin who is also a Reviewer, on the Cases side, opens a case at Request sent
- **THEN** the case stays at Request sent

#### Scenario: Switching to Office on the case
- **WHEN** that Admin then presses Office on the workspace switch while the case is open
- **THEN** the case moves to Screening in progress

#### Scenario: A reload on the case page
- **WHEN** an admin window on the office side reloads while it shows a case at Request sent
- **THEN** the case moves to Screening in progress

#### Scenario: Logging a contact from Follow-ups
- **WHEN** an admin logs a contact from a Follow-ups row for a case at Request sent, without opening its page
- **THEN** the case stays at Request sent

#### Scenario: Offline on open
- **WHEN** an admin opens a Request sent case while the connection is down, and the connection then returns
- **THEN** no error is shown, and once connected the case moves to Screening in progress
