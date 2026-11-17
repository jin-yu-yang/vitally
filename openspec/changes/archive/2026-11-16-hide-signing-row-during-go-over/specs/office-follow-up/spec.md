## MODIFIED Requirements

### Requirement: The office works a go-over follow-up like any other task
The office SHALL see a case with an open `go_over_return` follow-up in Follow-ups as a "Call the client" row with its open-task count and **Log contact**, like any case with an open task. While the task is open, that row SHALL stand for the case at Ready to exit: Follow-ups SHALL list no Signing row for the case until the task is resolved or cancelled, and then the Signing row SHALL appear (capability `case-lifecycle`). The office SHALL also see the task in the Log contact drawer and on the case page's Follow-up tab, titled "Go over the return with the client", with no document line.

Any staff member holding `followup` SHALL log contacts on it in the contact log, linked to the task, and close it with `RESOLVE_FOLLOWUP`, as for any open office follow-up (requirement "Anyone with follow-up access works any open office follow-up"). Closing the case SHALL cancel it like any other open follow-up. Resolving it, with either outcome and whoever resolves it, SHALL also switch the client's Ready to exit message from Go over first to the reviewer's signing variant (capability `case-lifecycle`). While it is open, Mark ready to e-file SHALL wait for it (capability `case-lifecycle`).

#### Scenario: The queue lists the task
- **WHEN** an office staff member opens Follow-ups after an approval answered no
- **THEN** the case has a "Call the client" row with 1 open task, and its Log contact drawer shows "Go over the return with the client: the reviewer did not." with no document request, and the case has no Signing row

#### Scenario: The case page names the task
- **WHEN** an office staff member opens the case's Follow-up tab
- **THEN** the task is titled "Go over the return with the client", with no document line, and its Log contact form starts with "Go over tax return" chosen

#### Scenario: The office logs and resolves it
- **WHEN** the assignee logs a reached phone call linked to the task, then resolves the follow-up with outcome reached
- **THEN** the entry is listed under the task's "Contacts so far", the follow-up is resolved, the case's stage and review attempt are unchanged, an admin is now offered Mark ready to e-file…, and Follow-ups lists the case's Signing row, "Waiting for the client to sign." (capability `case-lifecycle`)

#### Scenario: Another follow-up holder works it
- **WHEN** a staff member holding `admin` and `followup` who is not the task's assignee logs a contact linked to it and then resolves it
- **THEN** both succeed, the client's message switches from Go over first to the reviewer's signing variant, and an admin is offered Mark ready to e-file…
