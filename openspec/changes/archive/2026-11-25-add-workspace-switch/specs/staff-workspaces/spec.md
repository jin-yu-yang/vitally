## ADDED Requirements

### Requirement: Effective capabilities decide a staff member's sides
A cleared staff member SHALL have the **office side** when their effective capabilities include any of `admin`, `followup`, `assist` or `receive_documents`, and the **Cases side** when they include `prepare` or `review`.

#### Scenario: An Admin who reviews has both sides
- **WHEN** a cleared staff member holds the Admin and Reviewer roles
- **THEN** they have both the office side and the Cases side

#### Scenario: An Intaker has the office side
- **WHEN** a cleared staff member holds only the Intaker role
- **THEN** they have the office side and not the Cases side

### Requirement: Someone with one side or none works as before
A cleared staff member with one side SHALL work on that side, with no workspace switch. Someone with neither side SHALL get the Work board, as before. The side is a view choice: the database SHALL keep checking every capability on every action, and the side SHALL grant nothing.

#### Scenario: An Intaker lands in the office
- **WHEN** a cleared Intaker (`receive_documents`, `assist`) who is not a Preparer or Reviewer signs in
- **THEN** they see Follow-ups and no workspace switch

#### Scenario: Admin only
- **WHEN** a cleared Admin who is not a Preparer or Reviewer signs in
- **THEN** they see Follow-ups and All cases, as before, and no workspace switch

#### Scenario: Preparer or Reviewer only
- **WHEN** a cleared Reviewer with no office capability signs in
- **THEN** they see the Work board, as before, and no workspace switch

#### Scenario: No capabilities
- **WHEN** a cleared Greeter signs in
- **THEN** they see the Work board, as before, and no workspace switch

### Requirement: Someone with both sides gets an Office / Cases switch
A cleared staff member with both sides SHALL see, at the top of the staff sidebar above its navigation, a group named "Workspace" with two buttons, **Office** and **Cases**. The current side's button SHALL be pressed (`aria-pressed="true"`). The side SHALL default to Office. The switch SHALL NOT show on the setup screen of a staff member who is not cleared.

#### Scenario: The default
- **WHEN** a cleared Admin who is also a Reviewer signs in for the first time in this browser
- **THEN** the sidebar's Workspace group shows Office pressed, and Follow-ups shows

#### Scenario: Uncleared
- **WHEN** a workspace admin who is also a Reviewer and is not cleared signs in
- **THEN** the setup screen shows no workspace switch

### Requirement: The sidebar's navigation follows the side
The sidebar SHALL offer Follow-ups and, for effective `admin`, All cases on the office side, and the Work board on the Cases side. When the sidebar is collapsed, the switch SHALL be reached by opening the sidebar, like the rest of it.

#### Scenario: Switching to Cases
- **WHEN** a cleared Admin who is also a Reviewer presses Cases
- **THEN** the Work board shows, the navigation offers the Work board instead of Follow-ups and All cases, and Cases is pressed

#### Scenario: Back to Office
- **WHEN** they then press Office
- **THEN** Follow-ups shows with All cases in the navigation, and Office is pressed

### Requirement: The side used last is remembered in this browser
The side a person last chose with the switch SHALL be remembered in this browser for their account. It SHALL be used at the next sign-in and reload while they have both sides. Signing out SHALL NOT forget it. It SHALL hold only the side, and it SHALL NOT be shared with other browsers or devices.

#### Scenario: Sign-in returns to Cases
- **WHEN** an Admin who is also a Reviewer switches to Cases, signs out, and signs in again in the same browser
- **THEN** the Work board shows, with Cases pressed

#### Scenario: Another browser
- **WHEN** that person signs in in another browser
- **THEN** Follow-ups shows, with Office pressed

### Requirement: Blocked storage falls back to Office
When the browser's storage cannot be read or written, the window SHALL open on Office and SHALL otherwise work as before, without remembering the side.

#### Scenario: Blocked storage
- **WHEN** the browser refuses storage and an Admin who is also a Reviewer signs in
- **THEN** Follow-ups shows with Office pressed, and pressing Cases still shows the Work board

### Requirement: Pressing the switch on a list or a case keeps the person in place
Pressing the side that is not pressed SHALL switch the window. On Follow-ups or the Work board, it SHALL show the other side's home. On a case page, it SHALL show the same case as the other side's case page, on its Overview tab. Pressing the side that is already pressed SHALL do nothing.

#### Scenario: On a case page
- **WHEN** an Admin who is also a Reviewer, on the office side on a case's Contacts tab, presses Cases
- **THEN** the same case shows as the volunteer case page on its Overview tab

#### Scenario: The pressed side
- **WHEN** they press Cases while Cases is already pressed
- **THEN** nothing changes

### Requirement: Pressing the switch on an office-only screen goes to the Work board
On All cases, switching to Cases SHALL show the Work board. On Add a case, the window SHALL first ask to leave when answers are unsaved, as every other way out of Add a case does, and then show the Work board.

#### Scenario: On All cases
- **WHEN** an Admin who is also a Reviewer is on All cases and presses Cases
- **THEN** the Work board shows

#### Scenario: On Add a case with unsaved answers
- **WHEN** they have typed answers on Add a case and press Cases
- **THEN** the leave-without-saving dialog opens, and leaving shows the Work board

### Requirement: Screens on both sides stay put when the side changes
Volunteers, the Schedule, Post an update, Season settings, My profile and Notifications SHALL show on both sides, following their own rules. Pressing the switch on one of them SHALL keep the window on the same screen.

#### Scenario: On Volunteers
- **WHEN** an Admin who is also a Reviewer is on Volunteers and presses Cases
- **THEN** Volunteers stays, with its Workload tab

### Requirement: Links open a case on the side the window is on
Opening a case from the work board, the case pool, Follow-ups, All cases or the Workload SHALL show the case page of the side the window is on, and SHALL NOT change the side. The Work board and its pool SHALL exist only on the Cases side; Follow-ups, All cases and Add a case only on the office side.

#### Scenario: The Workload's Open on the Cases side
- **WHEN** an Admin who is also a Reviewer, on the Cases side, presses Open on a case in the Workload
- **THEN** the case shows as the volunteer case page, and Cases stays pressed

#### Scenario: A stored office screen on the Cases side
- **WHEN** a window whose side is Cases is reloaded while the stored screen is All cases
- **THEN** the Work board shows

### Requirement: The Workload, All cases and Add a case follow the capability
The Workload tab and All cases SHALL be offered for effective `admin` on either side, as before. Add a case SHALL be offered only for effective `admin`. A person with an office side but without `admin` SHALL NOT be offered All cases, the Workload or Add a case.

#### Scenario: Workload on the Cases side
- **WHEN** an Admin who is also a Reviewer is on the Cases side and opens Volunteers
- **THEN** the Workload tab is offered

#### Scenario: An Intaker has no admin screens
- **WHEN** a cleared Intaker is in the office
- **THEN** the sidebar offers no All cases, and Follow-ups offers no Add a case

### Requirement: An Intaker's Follow-ups lists only what they can act on
For a staff member on the office side without effective `admin`, Follow-ups SHALL list only:
- with `assist`: help requests that are open, or assigned to them;
- with `receive_documents`: cases waiting for documents that have no client account and an open document request.

The kind filter SHALL offer only those kinds, and each row SHALL open the office case page. A staff member with effective `admin` SHALL keep the full queue, unchanged.

#### Scenario: Help taken by someone else
- **WHEN** an Intaker opens Follow-ups and one help request is open, one is assigned to them, and one is assigned to someone else
- **THEN** Follow-ups lists the first two and not the third

#### Scenario: Documents from a client with an account
- **WHEN** an Intaker opens Follow-ups and two cases wait for documents with an open request, one office-owned and one whose client has an account
- **THEN** Follow-ups lists only the office-owned case

#### Scenario: The admin's queue is unchanged
- **WHEN** an Admin opens Follow-ups
- **THEN** it lists every kind of row it listed before

### Requirement: An Intaker's empty Follow-ups says what fills it
With no filter set and nothing to list, an Intaker's Follow-ups SHALL show the shared empty panel with the check icon and "Nothing waiting for you. Help requests and documents to receive show here." A list narrowed by a filter SHALL keep "Nothing here matches these filters." with its undo.

#### Scenario: Nothing for them
- **WHEN** an Intaker opens Follow-ups and nothing they can act on is waiting, while cases wait at other office stages
- **THEN** Follow-ups shows "Nothing waiting for you. Help requests and documents to receive show here."
