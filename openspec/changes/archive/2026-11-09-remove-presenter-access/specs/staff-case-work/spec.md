## REMOVED Requirements

### Requirement: Staff see the same cases and rows as presenters

**Reason**: No presenter remains to compare against.

**Migration**: Replaced by "Staff see every case except a client's private draft", which states the same rows directly.

### Requirement: Staff screens have no persona picker or presenter controls

**Reason**: No presenter remains, so the requirement's presenter sentence and scenario no longer apply.

**Migration**: Replaced by "Staff screens have no persona picker or sample controls", which keeps every staff rule.

## MODIFIED Requirements

### Requirement: Staff can log a contact on any case they can open
Every staff persona SHALL be able to log a contact on any case staff can read (every case except a client's private draft), at any stage, whatever the persona's capabilities. An entry SHALL record:
- **Direction**: we contacted the client (outgoing) or the client contacted us (incoming); "we contacted" by default;
- **Contact time**: when the contact happened, now by default, settable when logging, and no later than five minutes from now;
- **Logged by** and **logged at**: the chosen persona and the time of logging, filled in, never typed and never changed afterwards;
- **With**: client, spouse, or other; "other" SHALL require a name of 1 to 80 characters, and client or spouse SHALL carry no name;
- **Method**: phone, text, email, in person or video; phone by default;
- **Purpose**: go over tax return, ask a question, request documents, schedule an appointment, or other; required;
- **Outcome**, which follows the method: for phone and video, reached, no answer, left voicemail, or wrong or invalid number; for text and email, sent, client replied, or failed to deliver; for in person, and for every incoming contact, always reached, with no choice offered;
- **Note**: optional free text of at most 1000 characters; a blank note SHALL be stored as no note.

Direction, method, purpose and outcome SHALL be one-click button groups. The stored values SHALL be the keys `outgoing`, `incoming`; `phone`, `text`, `email`, `in_person`, `video`; `go_over_return`, `ask_question`, `request_documents`, `schedule_appointment`, `other`; `reached`, `no_answer`, `left_voicemail`, `wrong_number`, `sent`, `replied`, `failed`. The database SHALL refuse an entry that breaks any of these rules. Logging a contact SHALL NOT change the case's stage, revision or history, and SHALL send the client nothing.

#### Scenario: Each staff persona logs a contact
- **WHEN** Alex, Morgan and Sam each log a phone call on a case in a different stage
- **THEN** each entry shows its contact time and the persona's name, and none of them typed the name or the logged-at time

#### Scenario: The defaults
- **WHEN** a persona opens the Log contact form
- **THEN** "We contacted" and "Phone" are already chosen, the contact time is now in New York time, and purpose and outcome are not chosen

#### Scenario: Outcomes follow the method
- **WHEN** a persona chooses "Text"
- **THEN** the outcome choices are Sent, Client replied and Failed to deliver
- **AND WHEN** the persona chooses "In person"
- **THEN** no outcome is offered, and the entry is stored as reached

#### Scenario: An incoming contact is reached
- **WHEN** a persona logs that the client phoned in
- **THEN** no outcome is offered, the entry is stored as reached, and the database refuses an incoming entry with any other outcome

#### Scenario: A contact time in the past
- **WHEN** a persona logs a call that happened yesterday at 2:10 PM, setting the contact time
- **THEN** the entry's contact time is yesterday 2:10 PM in New York time, and its logged-at time is now

#### Scenario: Required choices
- **WHEN** a persona leaves purpose or a shown outcome unchosen, or picks "Other" with no name
- **THEN** the entry is not logged, and the database refuses the same entry sent directly

#### Scenario: Logging leaves the case alone
- **WHEN** Sam logs a contact on a case that Alex has open in another window
- **THEN** the case's revision is unchanged and Alex's open forms raise no conflict

#### Scenario: A private draft cannot be logged on
- **WHEN** a persona logs a contact on a case that is a client's private draft
- **THEN** the database refuses it as not found

### Requirement: For a staff account, the persona is its own person
Wherever a staff requirement refers to "the chosen persona", "a staff persona" or "the persona", it SHALL mean the person linked to the signed-in `staff` account, for every staff screen and rule, including phone masking, the contact log and the follow-up queue. Names such as Alex, Morgan and Sam in these requirements' scenarios SHALL stand for staff members with those names.

#### Scenario: A staff member who prepares a case sees its phone
- **WHEN** a staff member has claimed preparation of a case and opens it
- **THEN** the client's phone is revealable

#### Scenario: A staff member's contact log entry
- **WHEN** a staff member named "Riley Park" logs a contact
- **THEN** the entry's "Logged by" is Riley Park, and only Riley Park or someone with `admin` can edit it

### Requirement: Staff actions are attributed to the signed-in staff member
Every record of who did something on a case SHALL name the signed-in staff member's person when a `staff` account acts. That covers:
- the action receipt;
- the case's internal history (`case_events`);
- the person who created a case in assisted mode;
- the preparation participants;
- the preparer and reviewer on the case;
- reviews, follow-up records, assistance items and contact log entries.

The browser SHALL NOT be able to make a staff action be recorded under any other person. Its requests SHALL carry no person.

#### Scenario: Two staff members share a case
- **WHEN** staff member Riley (`prepare`) claims and submits a case for review, and staff member Jordan (`review`) claims and approves the review, each in their own window
- **THEN** the case's history names Riley for the preparation steps and Jordan for the review steps, and each step's receipt names the same person

#### Scenario: A tampered request
- **WHEN** Riley's browser sends Jordan's person id as `p_person_id` with an action
- **THEN** no function matches the call, and nothing is recorded under either name

## ADDED Requirements

### Requirement: Staff see every case except a client's private draft
A `staff` member SHALL be able to read every row of its own workspace in every table the staff screens use, except the rows of a client's private draft. Those tables are:
- cases;
- documents, requests and history;
- participation, follow-ups and assistance items;
- reviews, and preparer and reviewer questionnaires;
- filing attempts, returns and notes;
- materials, document cards, contacts and the contact log.

A staff member SHALL receive the Realtime changes for those rows. A staff member SHALL read nothing in another workspace.

#### Scenario: Every staff row
- **WHEN** a staff member reads every staff table
- **THEN** the rows read equal a privileged read of that workspace's rows in those tables, minus clients' private drafts

#### Scenario: A private draft stays private
- **WHEN** a client has an unsubmitted application
- **THEN** a staff member reads no row of it

#### Scenario: Another workspace
- **WHEN** a staff member reads the staff tables
- **THEN** no row from another workspace is returned

#### Scenario: Live updates
- **WHEN** a staff member has the work board open and another window claims a case
- **THEN** the staff member's board shows the claim without a reload

### Requirement: Staff screens have no persona picker or sample controls
A `staff` account SHALL get the staff screens: the work board, the case pages and the office screens its capabilities allow. Its screens SHALL NOT show a persona picker, "Reset the sample cases" or "Load a sample checkpoint". They SHALL show "Signed in as <name>" with the staff member's person name. A staff window SHALL never save or restore a chosen persona, and SHALL ignore one left in its browser storage. Staff screens SHALL stay in English whatever language the browser chose. No account SHALL be offered a persona picker, a sample reset or a checkpoint.

#### Scenario: A staff member signs in
- **WHEN** Riley Park signs in with a staff account
- **THEN** the work board opens with "Signed in as Riley Park", with no "Acting as" buttons and no reset or checkpoint controls

#### Scenario: A leftover persona in browser storage
- **WHEN** a browser whose storage still holds a persona chosen as Sam, left by an earlier version of the app, signs in as staff member Riley
- **THEN** Riley's window acts as Riley, never as Sam
