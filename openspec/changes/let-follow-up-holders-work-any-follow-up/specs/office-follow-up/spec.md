## ADDED Requirements

### Requirement: Anyone with follow-up access works any open office follow-up
Any staff member whose person holds `followup` SHALL be able to log a contact linked to, and resolve with `RESOLVE_FOLLOWUP`, any open office follow-up in their workspace, whoever it is assigned to. This SHALL hold for every purpose: `request_documents`, `go_over_return` and `withdrawal_notice`, including a `withdrawal_notice` on a case that is already Closed.

A follow-up's assignee SHALL be a label only: it says whom the office asked, and it SHALL NOT limit who may work the task. No action SHALL reassign or claim a task. The case's history SHALL keep naming the person who resolved a task.

The database SHALL remain the authority, and SHALL refuse:
- a caller whose person lacks `followup`, with `FORBIDDEN`;
- a task that doesn't exist, or that belongs to another case, with `FORBIDDEN`;
- a task that is not open (resolved or cancelled), as not available (`INVALID_TRANSITION`), whoever sends it.

The office screens are admin-only, and `followup` requires `admin` (capability `sign-in`), so every `followup` holder can reach them. In Follow-ups, a "Call the client" row SHALL read "<n> open task" or "<n> open tasks", followed by " · assigned to " and the names of its open tasks' assignees. On the case page's Follow-up tab and in the Log contact drawer, each task SHALL show "Assigned to" and its assignee's name.

#### Scenario: Another follow-up holder works a document task
- **WHEN** a document follow-up is assigned to the Site Coordinator, and another staff member holding `admin` and `followup` logs a contact linked to it and then resolves it with outcome reached
- **THEN** both succeed, the entry is listed under the task's "Contacts so far", the task is resolved, and the case's history names the staff member who resolved it

#### Scenario: A task assigned to someone who can't act
- **WHEN** an open follow-up is assigned to a person no staff account is linked to, such as the persona Sam, and the Site Coordinator logs a contact linked to it and resolves it
- **THEN** both succeed, and the task is resolved

#### Scenario: A withdrawal notice on a Closed case
- **WHEN** a client withdraws a case at Filing in progress, and a staff member holding `followup` who is not the notice's assignee resolves the notice
- **THEN** the notice is resolved, and the case stays Closed

#### Scenario: Without follow-up access
- **WHEN** a preparer without `followup` sends a contact linked to an open task, or resolves it, directly to the database
- **THEN** the database refuses both as forbidden, and the task stays open

#### Scenario: A task from another case
- **WHEN** a staff member holding `followup` sends a contact on one case linked to a task of another case
- **THEN** the database refuses it as forbidden

#### Scenario: A resolved task
- **WHEN** a staff member holding `followup`, whether or not they are the assignee, sends a contact linked to a resolved task, or resolves it again
- **THEN** the database refuses it as not available

#### Scenario: The row names the assignees as a label
- **WHEN** a case has two open tasks, assigned to Sam and Jo
- **THEN** its Call the client row reads "2 open tasks · assigned to Sam, Jo"

### Requirement: The office works a go-over follow-up like any other task
The office SHALL see a case with an open `go_over_return` follow-up in Follow-ups as a "Call the client" row with its open-task count and **Log contact**, like any case with an open task. The office SHALL also see the task in the Log contact drawer and on the case page's Follow-up tab, titled "Go over the return with the client", with no document line.

Any staff member holding `followup` SHALL log contacts on it in the contact log, linked to the task, and close it with `RESOLVE_FOLLOWUP`, as for any open office follow-up (requirement "Anyone with follow-up access works any open office follow-up"). Closing the case SHALL cancel it like any other open follow-up. Resolving it, with either outcome and whoever resolves it, SHALL also switch the client's Ready to exit message from Go over first to the reviewer's signing variant (capability `case-lifecycle`). While it is open, Mark ready to e-file SHALL wait for it (capability `case-lifecycle`).

#### Scenario: The queue lists the task
- **WHEN** an office staff member opens Follow-ups after an approval answered no
- **THEN** the case has a "Call the client" row with 1 open task, and its Log contact drawer shows "Go over the return with the client: the reviewer did not." with no document request

#### Scenario: The case page names the task
- **WHEN** an office staff member opens the case's Follow-up tab
- **THEN** the task is titled "Go over the return with the client", with no document line, and its Log contact form starts with "Go over tax return" chosen

#### Scenario: The office logs and resolves it
- **WHEN** the assignee logs a reached phone call linked to the task, then resolves the follow-up with outcome reached
- **THEN** the entry is listed under the task's "Contacts so far", the follow-up is resolved, the case's stage and review attempt are unchanged, and an admin is now offered Mark ready to e-file… (capability `case-lifecycle`)

#### Scenario: Another follow-up holder works it
- **WHEN** a staff member holding `admin` and `followup` who is not the task's assignee logs a contact linked to it and then resolves it
- **THEN** both succeed, the client's message switches from Go over first to the reviewer's signing variant, and an admin is offered Mark ready to e-file…

## REMOVED Requirements

### Requirement: The office works a go-over follow-up like any other
**Reason**: Its sentence "The assignee SHALL log contacts on it" and its scenario "Only the assignee works it" stop being true, and a modified requirement can't drop a scenario.
**Migration**: Replaced by "The office works a go-over follow-up like any other task" above, which keeps every other rule and scenario and lets any `followup` holder work the task.
