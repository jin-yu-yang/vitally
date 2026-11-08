## ADDED Requirements

### Requirement: Office follow-up contacts are logged in the contact log by anyone with follow-up access
The case page's Follow-up tab and the office queue's drawer SHALL use the same Log contact form as the Contacts tab, inside each open task, and SHALL call it "Log contact"; the drawer and the queue button that opens it SHALL be named "Log contact". A contact logged there SHALL be a log entry linked to that task. Inside a task, the form SHALL start with the task's purpose chosen: "Request documents" for a document follow-up, "Go over tax return" for a go-over follow-up (capability `office-follow-up`). The staff member SHALL be able to choose another purpose. The Contacts tab's own form SHALL still start with no purpose chosen.

Any staff member whose person holds `followup` SHALL be able to log a contact linked to an open task, whoever it is assigned to (capability `office-follow-up`). The browser SHALL offer the form and "Resolve this task" to them on every open task. The database SHALL refuse a link to a task that is not open, to a task of another case, or by anyone without `followup`. Each task SHALL list, under "Contacts so far", the summary lines of the entries linked to it, oldest first, or "No contact has been logged on this task yet.". "Resolve this task" SHALL stay as it is, separate from logging.

The office's Follow-up tab SHALL carry the note "The office raises a task when a preparer asks it to contact a client, when a reviewer didn't go over the return with the client, or when a case is withdrawn or closed before its return is filed. Anyone in the office with follow-up access can log contacts on it and resolve it.". Each task SHALL show "Assigned to" and its assignee's name as a label.

The volunteer's case page SHALL list the case's office tasks read-only, each with its status and "Assigned to" and its assignee's name, and SHALL keep the note "Contacts for an office task are logged on the office screens. Any other contact goes in the Contacts tab.".

#### Scenario: The Site Coordinator logs from the drawer
- **WHEN** the Site Coordinator, assigned to an open follow-up task, logs a phone call with no answer from the office queue's Log contact drawer
- **THEN** the entry appears under that task's "Contacts so far" and in the case's Contacts tab, marked with the task, and the task stays open

#### Scenario: The task's purpose is chosen
- **WHEN** the Site Coordinator opens the Log contact form inside a document follow-up, and then inside a go-over follow-up
- **THEN** the first starts with "Request documents" chosen and the second with "Go over tax return", and the Contacts tab's form starts with no purpose chosen

#### Scenario: Another follow-up holder logs on the task
- **WHEN** a staff member holding `admin` and `followup` opens the Follow-up tab of a case whose open task is assigned to someone else
- **THEN** the task offers Log contact and "Resolve this task", and a contact they log is linked to the task

#### Scenario: Someone without follow-up access cannot log on the task
- **WHEN** a preparer without `followup` sends a contact linked to an open task directly to the database
- **THEN** the database refuses it as forbidden

#### Scenario: A resolved task takes no more contacts
- **WHEN** a contact is sent linked to a resolved task
- **THEN** the database refuses it as an invalid transition

#### Scenario: Resolving is unchanged
- **WHEN** the Site Coordinator resolves the task with "Reached" and a note
- **THEN** the task is resolved exactly as before, and no log entry is created by resolving

#### Scenario: The Follow-up tab says who may work a task
- **WHEN** an office staff member opens a case's Follow-up tab
- **THEN** it reads "The office raises a task when a preparer asks it to contact a client, when a reviewer didn't go over the return with the client, or when a case is withdrawn or closed before its return is filed. Anyone in the office with follow-up access can log contacts on it and resolve it.", and each task shows "Assigned to" and its assignee's name

#### Scenario: The volunteer page shows the assignee as a label
- **WHEN** the case's preparer opens its Follow-up tab, and the case has an open office task assigned to the Site Coordinator
- **THEN** the task shows "Assigned to Sky Chen (site coordinator)", and no form to log or resolve

## REMOVED Requirements

### Requirement: Office follow-up contacts are logged in the contact log
**Reason**: Its rule "Only the task's assignee, holding `followup`, SHALL be able to log a contact linked to an open task" and its scenarios "Sam logs from the drawer" and "Someone else cannot log on the task" stop being true, and a modified requirement can't drop a scenario.
**Migration**: Replaced by "Office follow-up contacts are logged in the contact log by anyone with follow-up access" above, which keeps the form, the purposes, "Contacts so far" and "Resolve this task", and lets any `followup` holder log on an open task.
