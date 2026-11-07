# staff-case-work Specification

## Purpose
What staff see and do on a case page and in the tables that list cases. It covers how a client's phone numbers are shown, masked or revealable, depending on whether the chosen persona works on the case. It also covers how the work board, the case pool and Follow-ups show every language a client speaks, and how their language filters find a client by any of those languages.

## Requirements

### Requirement: A client's phone on the staff case page is shown masked
On the staff case page, which is the volunteer case page and the admin/office case page, each client phone SHALL first show as a mask in the form `(•••) •••-1234`. The mask SHALL be built from the number's last four digits only. This SHALL hold for the Phone and Spouse phone rows of the Contact details card, and for the phone rows of "What the client told us". An empty phone SHALL read as it does today, for every viewer. In the Contact details card it SHALL read "Not given". In "What the client told us" it SHALL follow the rule for any unanswered question: an empty required phone reads "Not answered", and an empty optional phone shows no row.

#### Scenario: The case page shows the mask first
- **WHEN** a staff persona opens a case whose client phone is `(215) 555-0123`
- **THEN** the Phone row shows `(•••) •••-0123`, and the full number is not visible until the viewer reveals it

#### Scenario: An empty spouse phone in the contact card
- **WHEN** a case has no spouse phone
- **THEN** the Contact details card's Spouse phone row reads "Not given"

#### Scenario: An empty required phone in the answers
- **WHEN** a case has no client phone
- **THEN** the Phone number row of "What the client told us" reads "Not answered", whether or not the viewer may see contact details

### Requirement: A viewer who works on the case can reveal the phone
When the chosen persona may see the case's contact details, the mask SHALL carry an eye icon and SHALL reveal the full number on pointer hover and on keyboard focus. The persona may see them when it has `admin` or `followup`, or when it is the case's preparer or reviewer. After the viewer clicks the mask, the full number SHALL stay shown until focus leaves it, so it can be selected and copied. It SHALL be hidden again once focus leaves. There SHALL be no copy button. The full number SHALL be present only as page text, never in a `title`, `aria-label` or any other attribute. Screen readers SHALL read the full number.

#### Scenario: Hover reveals the number
- **WHEN** Alex has claimed the case and moves the pointer over the masked phone
- **THEN** `(215) 555-0123` is shown in place of the mask

#### Scenario: Keyboard focus reveals the number
- **WHEN** Sam tabs to the masked phone on any case
- **THEN** the full number is shown while the mask has focus

#### Scenario: A click keeps the number shown until focus leaves
- **WHEN** Alex clicks the masked phone on a case Alex prepares and moves the pointer away
- **THEN** the full number stays shown
- **AND WHEN** focus moves elsewhere
- **THEN** the mask shows again

#### Scenario: A realtime update keeps a revealed number revealed
- **WHEN** Alex has the masked phone focused, so the number is revealed, and a realtime update redraws the case page
- **THEN** the mask still has focus and the full number stays shown

#### Scenario: No attribute carries the number
- **WHEN** the case page is rendered for a viewer who may see the number
- **THEN** no attribute in the page contains the phone's digits beyond the last four

### Requirement: A viewer who does not work on the case sees a locked mask
When the chosen persona may not see the case's contact details, the phone rows SHALL show the mask muted, with a lock icon and the tooltip "Claim this case to see the full number". This covers a volunteer on an unclaimed case, or on a case someone else prepares or reviews. The full number SHALL NOT be anywhere in the page, in text or in any attribute, and the mask SHALL NOT be focusable. Screen readers SHALL hear the last four digits and the sentence "Claim this case to see the full number." In the Contact details card, best time and the note SHALL stay hidden, and the sentence "Contact details are shown to the office, and to the preparer and reviewer once the case is claimed." SHALL show in their place. The draft 13614-C buttons SHALL NOT be offered.

#### Scenario: An unclaimed case shows the locked mask
- **WHEN** Alex opens an available case that nobody has claimed
- **THEN** the Phone row shows `(•••) •••-0123` with a lock icon and the tooltip "Claim this case to see the full number", and `(215) 555-0123` appears nowhere in the page

#### Scenario: Best time and the note stay hidden
- **WHEN** Alex opens an available case
- **THEN** the Contact details card shows the masked phones and the sentence "Contact details are shown to the office, and to the preparer and reviewer once the case is claimed.", and no best time or note

#### Scenario: The answers panel masks the phone too
- **WHEN** Alex opens an available case
- **THEN** "What the client told us" shows the phone rows locked and masked, not left out

#### Scenario: Claiming the case unlocks the phone
- **WHEN** Alex claims preparation of the case
- **THEN** the lock is replaced by the eye icon, and the number can be revealed

### Requirement: Staff tables show every language a client speaks
The Language column of the work board, the case pool and Follow-ups SHALL list every language the client speaks, as letters, the preferred language first:
- E for English, C for Cantonese, M for Mandarin and O for Other, separated by ", ";
- no language listed twice.

The cell SHALL give the full names on hover, and screen readers SHALL read the full names instead of the letters, for example "Cantonese (preferred), Mandarin, Other: Vietnamese". A cell with no language SHALL show "—".

A Follow-ups row without a case SHALL use the help request's own language text:
- English, Cantonese or Mandarin shows its letter;
- any other text shows "O", with that text in the full names.

#### Scenario: A client with two languages
- **WHEN** staff open the work board, and a case's client prefers Cantonese and also speaks Mandarin
- **THEN** that row's Language cell shows "C, M", and its full names read "Cantonese (preferred), Mandarin"

#### Scenario: Another language
- **WHEN** a client prefers English and also named Other, typing "Vietnamese"
- **THEN** the case pool row shows "E, O", and its full names read "English (preferred), Other: Vietnamese"

#### Scenario: Only the preferred language
- **WHEN** a client named only Mandarin
- **THEN** the row shows "M"

#### Scenario: A help request without a case
- **WHEN** a Follow-ups row comes from a help request whose language is "Cantonese" and which has no case
- **THEN** its Language cell shows "C"

### Requirement: Language filters match any language the client speaks
The work board's and Follow-ups' language chips and the case pool's language filter SHALL match a client when any language they speak, preferred or other, is the chosen language. The filter's options SHALL be the full names of every language that appears among the listed cases, preferred or other, sorted. A saved filter value that names English, Cantonese, Mandarin or Other SHALL keep working; a saved free-text value (for example "Polish", from before this change) SHALL match no row until it is cleared, and the empty state SHALL offer to show all languages.

#### Scenario: Filtering by a second language
- **WHEN** staff choose "Mandarin" on the work board
- **THEN** the board shows both a client who prefers Mandarin and a client who prefers Cantonese and also speaks Mandarin

#### Scenario: The options include second languages
- **WHEN** the only Mandarin speaker in the case pool named Mandarin in Q0.5
- **THEN** "Mandarin" is one of the pool's language options

#### Scenario: A saved free-text filter
- **WHEN** Follow-ups opens with a saved language filter of "Polish"
- **THEN** no row matches, and the empty state offers "Show all languages"

### Requirement: The work board and the case pool show each client's phone masked
The volunteer work board and the admin case pool SHALL each have a "Phone" column, placed right after the Stage column. Each row SHALL show the case's client phone, never the spouse phone, in the mask form and with the same rule as the staff case page: `(•••) •••-1234`, built from the last four digits only, revealable when the chosen persona may see the case's contact details and locked otherwise. A case with no client phone SHALL show "—" in that cell, for every viewer. In each row, the case's reference link SHALL come before the phone in keyboard tab order. Each table's note SHALL keep saying it shows workflow only, and SHALL add one sentence saying that phone numbers stay masked.

#### Scenario: The board shows the phone column after Stage
- **WHEN** a staff persona opens the work board and a listed case's client phone is `(215) 555-0123`
- **THEN** the table's columns read Client, Stage, Phone, then the rest, and that case's Phone cell shows `(•••) •••-0123`

#### Scenario: The case pool shows the phone column after Stage
- **WHEN** Sam opens the case pool
- **THEN** the table's columns read Client, Stage, Phone, then the rest, and each case with a client phone shows its mask

#### Scenario: A case with no phone shows a dash
- **WHEN** a listed case has no client phone
- **THEN** its Phone cell reads "—", whoever is viewing

#### Scenario: The spouse phone is not listed
- **WHEN** a listed case has a spouse phone
- **THEN** no list cell shows the spouse phone or its last four digits

#### Scenario: The case link comes before the phone
- **WHEN** a viewer who may see a listed case's phone focuses that row's reference link and presses Tab
- **THEN** focus moves to the row's phone mask, and the full number shows

### Requirement: A viewer who works on a listed case can reveal its phone
When the chosen persona may see a listed case's contact details, its phone cell SHALL be the revealable mask the case page uses: an eye icon, the full number shown on pointer hover and on keyboard focus, kept shown after a click until focus leaves, present only as page text and never in an attribute. Each revealable mask SHALL have an id unique to its row (`board-phone-<case id>` on the work board, `pool-phone-<case id>` in the case pool), so that a redraw puts focus back on it.

#### Scenario: A volunteer reveals the phone of their own case on the board
- **WHEN** Alex prepares a listed case and moves the pointer over its masked phone on the work board
- **THEN** `(215) 555-0123` is shown in place of the mask

#### Scenario: An admin can reveal every phone in the case pool
- **WHEN** Sam opens the case pool
- **THEN** every listed phone carries the eye icon and is focusable, including cases nobody has claimed

#### Scenario: A realtime update keeps a revealed listed number revealed
- **WHEN** Alex has the masked phone of their own case focused on the work board, so the number is revealed, and a realtime update redraws the board
- **THEN** that row's mask still has focus and the full number stays shown

#### Scenario: No attribute carries a listed number
- **WHEN** the work board or the case pool is rendered for a viewer who may see the listed numbers
- **THEN** no attribute in the page contains a listed phone's digits beyond the last four

### Requirement: A listed case the viewer does not work on shows a locked phone
When the chosen persona may not see a listed case's contact details, which covers an available case and a case someone else prepares or reviews, its phone cell SHALL show the locked mask the case page uses: muted, with a lock icon and the tooltip "Claim this case to see the full number", not focusable, with no id, and read to screen readers as the last four digits and the sentence "Claim this case to see the full number." The full number SHALL NOT be anywhere in that row, in text or in any attribute.

#### Scenario: An available case is locked on the board
- **WHEN** Alex opens the work board and a case nobody has claimed is listed with client phone `(215) 555-0123`
- **THEN** its Phone cell shows `(•••) •••-0123` with a lock icon and the tooltip "Claim this case to see the full number", is not focusable, and `(215) 555-0123` appears nowhere in the row

#### Scenario: Someone else's case is locked on the board
- **WHEN** Morgan opens the work board and a case Alex prepares is listed
- **THEN** its Phone cell shows the locked mask

### Requirement: Claiming a case unlocks its listed phone without a reload
When the chosen persona claims preparation or review of a case, every work board showing that case to that persona SHALL show its phone as revealable after the claim, with no page reload and no navigation, including a board open in another window.

#### Scenario: Another window's board unlocks the row in place
- **WHEN** Alex has the work board open in one window, showing an available case's phone locked, and claims preparation of that case in another window
- **THEN** in the first window, without a reload, that row's phone becomes the revealable mask with the id `board-phone-<case id>`

#### Scenario: The claiming window's board shows the row unlocked
- **WHEN** Alex claims preparation of a case from the work board and then returns to the work board
- **THEN** that case's phone is the revealable mask

### Requirement: Staff can log a contact on any case they can open
Every staff persona SHALL be able to log a contact on any case a presenter can open (every case except a client's private draft), at any stage, whatever the persona's capabilities. An entry SHALL record:
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

### Requirement: Only the logger or an admin can edit a contact, and every version is kept
The persona that logged an entry, and any persona with the `admin` capability, SHALL be able to edit the entry's direction, contact time, with, name, method, purpose, outcome and note, under the same rules as logging. Any other persona SHALL be refused by the database. Each edit SHALL keep every earlier version unchanged, with who saved it and when. An edited entry SHALL show "edited" and the time of its latest edit, and its earlier versions SHALL be openable from the entry, read-only. An edit sent against a version that is no longer current SHALL be refused as a conflict, and the newest version SHALL be shown. Editing SHALL NOT change the entry's logger, logged-at time or follow-up task.

#### Scenario: A sent text is answered
- **WHEN** Alex logged a text as "Sent" at 10:00 and, after the client answers, edits it to "Client replied" at 11:30
- **THEN** the entry reads "Client replied" and shows "edited" with 11:30, and its earlier versions list the "Sent" version saved at 10:00

#### Scenario: The contact time is corrected
- **WHEN** Alex edits an entry's contact time from 3:45 PM to 2:45 PM
- **THEN** the summary line uses 2:45 PM, and the earlier version keeps 3:45 PM

#### Scenario: An admin corrects someone else's entry
- **WHEN** Sam edits an entry that Morgan logged
- **THEN** the edit is saved, and the entry still says Morgan logged it

#### Scenario: Another persona cannot edit
- **WHEN** Alex tries to edit an entry that Morgan logged
- **THEN** no Edit button is offered to Alex, and the database refuses the edit sent directly

#### Scenario: Two edits at once
- **WHEN** Morgan and Sam both open the same entry for editing and Morgan saves first
- **THEN** Sam's save is refused as a conflict and Sam sees Morgan's version

### Requirement: No one can delete a contact
The contact log SHALL offer no way to delete an entry or any of its versions, on screen or in the database. A wrong entry SHALL be corrected by editing it.

#### Scenario: No delete anywhere
- **WHEN** any staff persona or a client tries to delete or overwrite an entry or a version through the database
- **THEN** the database refuses it, and the entry and its versions are unchanged

### Requirement: Clients can never see the contact log
Only staff SHALL be able to read log entries and their versions. A client session SHALL read no entry and no version, not even on its own case, and SHALL receive no Realtime change about them. Logging or editing a contact SHALL show no phone number; the masked-phone rules stay as they are.

#### Scenario: A client reads nothing
- **WHEN** a client session reads the log tables for its own case, which has logged contacts
- **THEN** it receives no rows

#### Scenario: A client cannot write
- **WHEN** a client session calls the log or edit function
- **THEN** the database refuses it as forbidden

### Requirement: Other staff windows see new and edited contacts live
Another staff window open on the same case SHALL show a new or edited entry, in the Contacts tab and in the linked task's list, without a reload and without any change to the case itself.

#### Scenario: A second window
- **WHEN** Alex has a case open in one window and Sam logs a contact on it in another
- **THEN** Alex's Contacts tab shows the entry without a reload
- **AND WHEN** Sam edits it
- **THEN** Alex's window shows the edited entry

### Requirement: The staff case page has a Contacts tab
The staff case page, for volunteers and for the office, SHALL have a "Contacts" tab between Follow-up and History, showing the number of entries on the tab when there are any. The tab SHALL hold a "Contacts" section with, in order: Copy all in the section header when there is at least one entry; the Log contact form; and the entries, newest contact time first. Each entry SHALL show its summary line, a Copy button, Edit when the persona may edit it, "edited <time>" when it was edited, the follow-up task it belongs to when it is linked, and "Earlier versions (<n>)" when it has any. A case with no entries SHALL say "No contacts logged yet." and offer no Copy all.

#### Scenario: The tab and its count
- **WHEN** a staff persona opens a case with three logged contacts
- **THEN** the tabs read Overview, Intake answers, Documents, Follow-up, Contacts, History, and the Contacts tab shows 3

#### Scenario: Newest first
- **WHEN** a case has contacts at 10:00 and at 15:45 the same day
- **THEN** the 15:45 entry is listed first

#### Scenario: An empty log
- **WHEN** a staff persona opens the Contacts tab of a case with no contacts
- **THEN** it says "No contacts logged yet." and has the Log contact form and no Copy all

### Requirement: Each contact has a one-line summary to copy
Each entry SHALL have one English summary line, built from its latest version, with its contact time in America/New_York time:
- outgoing: `<M/D/YYYY h:mm AM/PM> — <logger> → <who>, <method> — <purpose> — <outcome>.`
- incoming: `<M/D/YYYY h:mm AM/PM> — <who> → <logger>, <method> — <purpose>.`
- in person: the outcome segment is left out, as for incoming;
- followed by ` Note: <note>` only when there is a note.

The logger SHALL be the persona's first name and the initial of its last name with a period ("Hailey Z.") when the name has two or more words, and the name as it is otherwise ("Alex"). `<who>` SHALL be "client (<first> <last>)" or "spouse (<first> <last>)" with the names from the intake, just "client" or "spouse" when the intake has no name, or the typed name for other. Method, purpose and outcome SHALL read: phone, text, email, in person, video; Go over tax return, Ask a question, Request documents, Schedule an appointment, Other; Reached, No answer, Left voicemail, Wrong or invalid number, Sent, Client replied, Failed to deliver. Every time shown in the log SHALL be America/New_York time, whatever the viewer's time zone.

Copy SHALL put the entry's line on the clipboard. Copy all SHALL put every entry's line for the case on it, oldest contact time first, one per line. Both SHALL work without leaving the page and SHALL confirm with the toast. If the browser refuses the clipboard, the toast SHALL say so, and the lines SHALL stay on screen to copy by hand.

#### Scenario: The exact line
- **WHEN** a persona named "Hailey Zhang" logged an outgoing phone call with the client Mei Wang at 3:45 PM New York time on 10/17/2026, to go over the tax return, outcome reached, note "asked about the 1099-R; she'll bring it Monday."
- **THEN** Copy puts `10/17/2026 3:45 PM — Hailey Z. → client (Mei Wang), phone — Go over tax return — Reached. Note: asked about the 1099-R; she'll bring it Monday.` on the clipboard

#### Scenario: An incoming contact
- **WHEN** the client Mei Wang phoned Hailey Zhang at the same time to ask a question
- **THEN** the line reads `10/17/2026 3:45 PM — client (Mei Wang) → Hailey Z., phone — Ask a question.`

#### Scenario: A one-word persona, a text and no note
- **WHEN** Alex texted the spouse, whose intake name is Lin Wang, to request documents, and the text was sent, with no note
- **THEN** the line ends `— Alex → spouse (Lin Wang), text — Request documents — Sent.` with no "Note:"

#### Scenario: New York time for every viewer
- **WHEN** a browser set to Pacific time shows an entry whose contact time is 3:45 PM New York time
- **THEN** the line says 3:45 PM

#### Scenario: Copy all
- **WHEN** a case has three entries and a persona presses Copy all
- **THEN** the clipboard holds the three lines, oldest contact time first, separated by line breaks, and the toast confirms the copy

### Requirement: Office follow-up contacts are logged in the contact log
The case page's Follow-up tab and the office queue's drawer SHALL use the same Log contact form as the Contacts tab, inside each open task the persona may record on, and SHALL call it "Log contact"; the drawer and the queue button that opens it SHALL be named "Log contact". A contact logged there SHALL be a log entry linked to that task. Inside a task, the form SHALL start with the task's purpose chosen: "Request documents" for a document follow-up, "Go over tax return" for a go-over follow-up (capability `office-follow-up`). The persona SHALL be able to choose another purpose. The Contacts tab's own form SHALL still start with no purpose chosen. Only the task's assignee, holding `followup`, SHALL be able to log a contact linked to an open task; the database SHALL refuse a link to a task that is not open, or by anyone else. Each task SHALL list, under "Contacts so far", the summary lines of the entries linked to it, oldest first, or "No contact has been logged on this task yet.". "Resolve this task" SHALL stay as it is, separate from logging.

#### Scenario: Sam logs from the drawer
- **WHEN** Sam, assigned to an open follow-up task, logs a phone call with no answer from the office queue's Log contact drawer
- **THEN** the entry appears under that task's "Contacts so far" and in the case's Contacts tab, marked with the task, and the task stays open

#### Scenario: The task's purpose is chosen
- **WHEN** Sam opens the Log contact form inside a document follow-up, and then inside a go-over follow-up
- **THEN** the first starts with "Request documents" chosen and the second with "Go over tax return", and the Contacts tab's form starts with no purpose chosen

#### Scenario: Someone else cannot log on the task
- **WHEN** Alex sends a contact linked to Sam's open task directly to the database
- **THEN** the database refuses it as forbidden

#### Scenario: A resolved task takes no more contacts
- **WHEN** a contact is sent linked to a resolved task
- **THEN** the database refuses it as an invalid transition

#### Scenario: Resolving is unchanged
- **WHEN** Sam resolves the task with "Reached" and a note
- **THEN** the task is resolved exactly as before, and no log entry is created by resolving

### Requirement: Earlier follow-up attempts are moved into the contact log once
The migration SHALL move every recorded follow-up attempt into the contact log once, as an entry with one version, linked to its task: outgoing, phone, with the client, purpose request documents, with its contact time and logged-at time equal to the attempt's time and its logger equal to the attempt's persona. The old outcomes SHALL map as: no answer → no answer; reached → reached; no further contact → reached, with "Client asked for no further contact." before the note; closure requested → reached, with "Client asked to close the case." before the note. After the move no attempt SHALL remain in the old list.

#### Scenario: A closing outcome keeps its meaning
- **WHEN** a task had an attempt recorded as "closure requested" with the note "Will file elsewhere."
- **THEN** after the migration the task lists an entry with outcome Reached and the note "Client asked to close the case. Will file elsewhere."

#### Scenario: Times and people are kept
- **WHEN** an attempt was recorded by Sam on 3/2/2026 at 9:15 AM New York time
- **THEN** its entry's contact time and logged-at time are that moment and its logger is Sam

### Requirement: The old attempt action refuses new requests
The database SHALL refuse every new `RECORD_CONTACT` request as a validation error, and no screen SHALL send one. A replay of a `RECORD_CONTACT` request that was accepted before the change SHALL still return its stored receipt. History events that earlier attempts recorded SHALL keep their wording.

#### Scenario: A stale tab records an attempt
- **WHEN** a window still running the old code sends `RECORD_CONTACT`
- **THEN** the database refuses it as a validation error and records nothing

### Requirement: For a staff account, the persona is its own person
Wherever a staff requirement refers to "the chosen persona", "a staff persona" or "the persona", it SHALL mean, for a `staff` account, the person linked to that account, for every staff screen and rule, including phone masking, the contact log and the follow-up queue. A presenter's chosen persona SHALL keep meaning the persona chosen in its window.

#### Scenario: A staff member who prepares a case sees its phone
- **WHEN** a staff member has claimed preparation of a case and opens it
- **THEN** the client's phone is revealable, as it is for a presenter acting as that case's preparer

#### Scenario: A staff member's contact log entry
- **WHEN** a staff member named "Riley Park" logs a contact
- **THEN** the entry's "Logged by" is Riley Park, and only Riley Park or someone with `admin` can edit it

### Requirement: Staff actions are attributed to the signed-in staff member
Every record of who did something on a case SHALL name the signed-in staff member's person when a `staff` account acts. That covers the action receipt, the case's internal history (`case_events`), the person who created a case in assisted mode, the preparation participants, the preparer and reviewer on the case, reviews, follow-up records, assistance items and contact log entries. The browser SHALL NOT be able to make a staff action be recorded under any other person.

#### Scenario: Two staff members share a case
- **WHEN** staff member Riley (`prepare`) claims and submits a case for review, and staff member Jordan (`review`) claims and approves the review, each in their own window
- **THEN** the case's history names Riley for the preparation steps and Jordan for the review steps, and each step's receipt names the same person

#### Scenario: A tampered request
- **WHEN** Riley's browser sends Jordan's person id with an action
- **THEN** the action is refused with `FORBIDDEN`, and nothing is recorded under either name

### Requirement: A staff member never reviews a case they prepared
The independence rule SHALL hold between staff accounts: a staff member whose person is a preparation participant of a case SHALL NOT be able to claim its review, request corrections on it or approve it, whichever window or browser they use.

#### Scenario: A preparer who can also review
- **WHEN** a staff member with both `prepare` and `review` prepares a case and submits it for review, then tries to claim its review
- **THEN** the claim is refused, and the case stays waiting for review

#### Scenario: Another reviewer can claim it
- **WHEN** a different staff member with `review` claims the same case's review
- **THEN** the claim succeeds

### Requirement: Staff see the same cases and rows as presenters
A `staff` member SHALL be able to read exactly the rows a presenter in the same workspace can read, in every table the staff screens use: every case except a client's private draft, with its documents, requests, history, participation, follow-ups, assistance items, reviews, preparer and reviewer questionnaires, filing attempts, returns and notes, materials, document cards, contacts and contact log. A staff member SHALL receive the same Realtime changes a presenter receives. A staff member SHALL read nothing in another workspace.

#### Scenario: Same rows as a presenter
- **WHEN** a presenter and a staff member in the same workspace each read every staff table
- **THEN** both read the same rows

#### Scenario: A private draft stays private
- **WHEN** a client has an unsubmitted application
- **THEN** a staff member reads no row of it, as a presenter reads none

#### Scenario: Live updates
- **WHEN** a staff member has the work board open and another window claims a case
- **THEN** the staff member's board shows the claim without a reload

### Requirement: Staff screens have no persona picker or presenter controls
A `staff` account SHALL get the staff screens: the work board, the case pages and the office screens its capabilities allow. Its screens SHALL NOT show a persona picker, "Reset the sample cases" or "Load a sample checkpoint". They SHALL show "Signed in as <name>" with the staff member's person name. A staff window SHALL never save or restore a chosen persona, and SHALL ignore one left in its browser storage. Staff screens SHALL stay in English whatever language the browser chose. No account SHALL be offered a persona picker, a sample reset or a checkpoint. A presenter gets only the plain screen set by capability `sign-in`.

#### Scenario: A staff member signs in
- **WHEN** Riley Park signs in with a staff account
- **THEN** the work board opens with "Signed in as Riley Park", with no "Acting as" buttons and no reset or checkpoint controls

#### Scenario: A leftover persona in browser storage
- **WHEN** a browser whose storage still holds a persona chosen as Sam, left by an earlier presenter window, signs in as staff member Riley
- **THEN** Riley's window acts as Riley, never as Sam

#### Scenario: A presenter gets no staff screens
- **WHEN** a presenter signs in
- **THEN** the presenter sees only the plain "This account is no longer used" screen, with no persona picker, reset or checkpoint controls
