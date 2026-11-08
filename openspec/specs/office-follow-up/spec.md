# office-follow-up Specification

## Purpose
Office follow-up tasks that are not tied to a document request. A reviewer who approves without going over the return with the client opens a go-over task for the office. It covers how a follow-up's purpose and document request relate, and how the office works a go-over task in Follow-ups and the contact log like any other task.

## Requirements

### Requirement: Approving without going over the return opens an office follow-up
When a reviewer approves a review and answers "no" to going over the return with the taxpayer or spouse, the approval SHALL succeed. In the same transaction, the system SHALL open one office follow-up with purpose `go_over_return` on the case. The follow-up SHALL:
- be assigned to the workspace's configured office follow-up person;
- be created by the reviewer;
- have the reason "Go over the return with the client: the reviewer did not.";
- have no document request.

The same approval SHALL close the reviewer's own review-contact step (capability `review-and-corrections`), so the office follow-up is the only request to contact the client.

If the workspace has no configured office person, or that person lacks the `followup` capability, the approval SHALL be refused with `VALIDATION` and nothing SHALL change. An approval that answers "yes" SHALL open no follow-up.

#### Scenario: No opens a follow-up
- **WHEN** the reviewer approves with "Did you go over the return" answered no
- **THEN** the case moves to Ready to exit (`review_approved`) and has one open `go_over_return` follow-up assigned to the office person

#### Scenario: Yes opens none
- **WHEN** the reviewer approves with that question answered yes and a date
- **THEN** the case has no new follow-up

#### Scenario: No office person configured
- **WHEN** the workspace has no default office follow-up person and the reviewer approves with no
- **THEN** the database refuses the approval with `VALIDATION`, and the review attempt stays active

### Requirement: A follow-up has a purpose, and only a document follow-up names a request
Every office follow-up SHALL have a purpose:
- `request_documents`, opened by `ESCALATE_CONTACT` for an unanswered document request;
- `go_over_return`;
- `withdrawal_notice`, opened in two situations (capability `case-lifecycle`):
  - when a client withdraws a case that a preparer or reviewer was working on, so the office tells that volunteer to stop work;
  - when an admin closes a case before filing (with reason `withdrawn` at Ready to exit or Ready to e-file, or with any reason from a Hold that came from Ready to exit), so the office makes sure the return is not transmitted in TaxSlayer.

The season-end close of unsigned cases (capability `case-lifecycle`) SHALL open no `withdrawal_notice`. There, the admin's confirmation states once that none of the returns will be transmitted.

`request_documents` and `go_over_return` use the contact log's own words. `withdrawal_notice` is the office's own: it isn't a contact with the client.

A `request_documents` follow-up SHALL name its document request. A `go_over_return` or `withdrawal_notice` follow-up SHALL name none. The database SHALL reject any row that breaks this. Follow-ups that existed before purposes did SHALL have purpose `request_documents`.

A `withdrawal_notice` follow-up SHALL carry its own text, so Follow-ups shows the right instruction for each kind. It SHALL be created on a case that is already Closed. Unlike the case's other open follow-ups, Close SHALL not cancel it. It SHALL be resolved with `RESOLVE_FOLLOWUP`, with either outcome, while the case stays Closed.

#### Scenario: Existing follow-ups keep their request
- **WHEN** the migration runs on a workspace with an open document follow-up
- **THEN** that follow-up has purpose `request_documents` and still names its request

#### Scenario: Escalating a document still names the request
- **WHEN** a preparer escalates an unanswered document request
- **THEN** the new follow-up has purpose `request_documents` and names that request

#### Scenario: A withdrawal notice
- **WHEN** a client withdraws a case at Filing in progress
- **THEN** one open follow-up with purpose `withdrawal_notice` and no document request exists on the Closed case
- **AND WHEN** the office resolves it with outcome reached
- **THEN** it is resolved, and the case stays Closed

#### Scenario: The season-end close opens no notice
- **WHEN** an admin closes a Hold that came from Ready to exit, and a case at Ready to exit, with the season-end close
- **THEN** both cases are Closed, and neither has a `withdrawal_notice` follow-up

### Requirement: Anyone with follow-up access works any open office follow-up
Any staff member whose person holds `followup` SHALL be able to log a contact linked to, and resolve with `RESOLVE_FOLLOWUP`, any open office follow-up in their workspace, whoever it is assigned to. This SHALL hold for every purpose: `request_documents`, `go_over_return` and `withdrawal_notice`, including a `withdrawal_notice` on a case that is already Closed.

A follow-up's assignee SHALL be a label only: it says whom the office asked, and it SHALL NOT limit who may work the task. No action SHALL reassign or claim a task. The case's history SHALL keep naming the person who resolved a task.

The database SHALL remain the authority, and SHALL refuse:
- a caller whose person lacks `followup`, with `FORBIDDEN`;
- a contact linked to a task that doesn't exist, or that belongs to another case, with `FORBIDDEN`; a `RESOLVE_FOLLOWUP` naming such a task SHALL stay a `VALIDATION` refusal, as today;
- a task that is not open (resolved or cancelled), as not available (`INVALID_TRANSITION`), whoever sends it.

Two people may work the same task. Every contact either of them logs on it SHALL be kept. A resolve sent at a case revision older than another person's resolve SHALL be refused as a conflict, like any stale action, and after re-reading the task is not available.

The office screens are admin-only, and `followup` requires `admin` (capability `sign-in`), so every `followup` holder can reach them. In Follow-ups, a "Call the client" row SHALL read "<n> open task" or "<n> open tasks", followed by " · assigned to " and the names of its open tasks' assignees. On the case page's Follow-up tab and in the Log contact drawer, each task SHALL show "Assigned to" and its assignee's name.

#### Scenario: Another follow-up holder works a document task
- **WHEN** a document follow-up is assigned to the Site Coordinator, and another staff member holding `admin` and `followup` logs a contact linked to it and then resolves it with outcome reached
- **THEN** both succeed, the entry is listed under the task's "Contacts so far", the task is resolved, and the case's history names the staff member who resolved it

#### Scenario: A task assigned to someone who can't act
- **WHEN** an open follow-up is assigned to a person no staff account is linked to, such as the persona Sam, and the Site Coordinator logs a contact linked to it and resolves it
- **THEN** both succeed, and the task is resolved

#### Scenario: A withdrawal notice on a Closed case
- **WHEN** a client withdraws a case at Filing in progress, and a staff member holding `followup` who is not the notice's assignee logs a contact linked to the notice and then resolves it
- **THEN** both succeed, the notice is resolved, and the case stays Closed

#### Scenario: Without follow-up access
- **WHEN** a preparer without `followup` sends a contact linked to an open task, or resolves it, directly to the database
- **THEN** the database refuses both as forbidden, and the task stays open

#### Scenario: A task from another case
- **WHEN** a staff member holding `followup` sends a contact on one case linked to a task of another case, and then sends `RESOLVE_FOLLOWUP` on that case naming the same task
- **THEN** the database refuses the contact as forbidden and the resolve as invalid (`VALIDATION`), and the task stays open

#### Scenario: Two follow-up holders on one task
- **WHEN** the assignee and another follow-up holder each log a contact linked to the task, and the other holder then resolves it
- **THEN** both entries are listed under "Contacts so far", a resolve the assignee sends at the case revision from before that resolve is refused as a conflict, and a resolve sent after re-reading is refused as not available

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
