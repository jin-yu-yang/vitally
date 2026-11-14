## ADDED Requirements

### Requirement: Only a cleared admin sees the Workload
The Volunteers page SHALL have a Workload tab next to the Roster tab. The Workload tab SHALL be offered only to a signed-in `staff` member who is cleared (capability `volunteer-clearance`) and whose effective capabilities include `admin`. A staff member whose `people.capabilities` include `admin` but who is not cleared SHALL keep the Roster tab alone, as today. A staff member without `admin` SHALL see neither.

#### Scenario: A cleared admin
- **WHEN** a cleared staff member with the Admin role opens Volunteers
- **THEN** the page shows a Roster tab and a Workload tab

#### Scenario: An uncleared admin
- **WHEN** a staff member whose ceiling includes `admin` but who is not cleared opens Volunteers
- **THEN** only the Roster is offered, and no Workload tab or case data is shown

#### Scenario: A preparer
- **WHEN** a cleared staff member with only the Preparer role is signed in
- **THEN** there is no Volunteers link and no Workload

### Requirement: The Workload has one row per volunteer who can prepare or review
The Workload SHALL list, one row each, every volunteer with a roster entry for the workspace's current season whose effective capabilities include `prepare` or `review`. A volunteer whose effective capabilities include neither, and who holds no Open case, SHALL NOT have a row, even with the Admin role. A volunteer with a row who is not cleared SHALL be tagged "Not cleared".

Anyone who holds an Open case in a slot whose capability they lack (`prepare` for a preparer, `review` for a reviewer) SHALL also have a row, so an admin can reassign the case: for example a volunteer whose role was removed by mistake, or a person with no roster entry for the current season (shown under their name, and tagged "Not cleared"). Such a row SHALL be tagged "Holds cases without the role", and each such case in its list SHALL say "No prepare role" or "No review role". Each row SHALL show:
- the volunteer's name;
- Open;
- a breakdown bar of Preparing and Review, with both numbers available to screen readers;
- Preparing;
- Review;
- Waiting on client;
- Stalled.

The Workload SHALL NOT show an hours column.

#### Scenario: Who has a row
- **WHEN** the roster has a cleared Preparer, a cleared Reviewer, a cleared admin with only the Admin role, and a Preparer who is new with no photo ID check
- **THEN** the Preparer, the Reviewer and the new Preparer have rows, the new Preparer's row is tagged "Not cleared", and the admin has no row

#### Scenario: An admin who also reviews
- **WHEN** a cleared volunteer has the Admin and Reviewer roles
- **THEN** they have a row

#### Scenario: A ceiling wider than the roles
- **WHEN** a volunteer's `people.capabilities` include `prepare` but their only role is Greeter, and they hold no case
- **THEN** they have no row

#### Scenario: A role removed while holding a case
- **WHEN** an admin unticks the Preparer role of a volunteer who is preparing VT-ABCD-EFGH, leaving them only Greeter
- **THEN** the volunteer keeps a row tagged "Holds cases without the role", with Open 1, and expanding it lists VT-ABCD-EFGH with "No prepare role" and Reassign

### Requirement: The Workload counts what each volunteer is holding
For each volunteer the Workload SHALL count:
- **Preparing**: cases whose preparer is the volunteer and whose stage is `preparing` or `corrections_required`;
- **Review**: cases whose reviewer is the volunteer and whose stage is `reviewing`;
- **Open**: Preparing plus Review;
- **Waiting on client**: the volunteer's Preparing cases with at least one document request whose status is `open`;
- **Stalled**: the volunteer's Open cases whose last activity was 5 or more calendar days ago.

A case's last activity SHALL be the later of when its last accepted case action was committed (`cases.updated_at`) and when its newest contact-log entry was logged. Editing an existing contact SHALL NOT count as activity. Cases at any other stage, including after approval, SHALL NOT count for the preparer or reviewer. Waiting on client and Stalled SHALL be parts of Open, not added to it. The counts SHALL update without a reload when another window changes a case.

#### Scenario: Counting a volunteer's cases
- **WHEN** a volunteer prepares two cases at Filing in progress, one of them with an open document request, prepares one at Corrections in progress, and reviews one at Review in progress
- **THEN** their row shows Preparing 3, Review 1, Open 4 and Waiting on client 1

#### Scenario: Approved cases leave the count
- **WHEN** a volunteer prepared a case that is now at Ready to exit
- **THEN** it is not in any of their counts

#### Scenario: A stalled case
- **WHEN** a volunteer's case at Filing in progress had its last accepted action 6 days ago and no contact logged since
- **THEN** their Stalled count includes it

#### Scenario: A logged contact keeps a case moving
- **WHEN** that case's last accepted action was 6 days ago, but a contact was logged on it 2 days ago
- **THEN** it is not stalled

#### Scenario: An edited contact does not
- **WHEN** a case's last accepted action and its newest contact were both 6 days ago, and that contact was edited today
- **THEN** it is stalled

#### Scenario: Another window claims a case
- **WHEN** an admin has the Workload open and a preparer claims a case in another window
- **THEN** that preparer's Preparing and Open counts go up by one without a reload

### Requirement: The Workload can be sorted and searched
The Workload SHALL sort by Open, highest first, and then by name, by default. Each column (name, Open, Preparing, Review, Waiting on client, Stalled) SHALL sort when its header is pressed, and pressing it again SHALL reverse the order. A search box SHALL show only the volunteers whose name contains the typed text, ignoring case. The Unassigned row SHALL stay first, whatever the sort or search.

#### Scenario: The default order
- **WHEN** an admin opens the Workload, and three volunteers have 4, 1 and 4 open cases
- **THEN** the two with 4 come first, in name order, then the one with 1

#### Scenario: Searching
- **WHEN** an admin types "par" into the search box
- **THEN** only volunteers whose names contain "par" are listed, below the Unassigned row

### Requirement: A volunteer's row lists their cases
Expanding a volunteer's row SHALL list their Open cases. Each case SHALL show:
- its case #;
- the primary taxpayer's full name (first and last name from the intake answers, "—" when neither is given);
- its staff stage name;
- which slot the volunteer holds;
- Stalled when it is stalled;
- an Open button that opens the staff case page;
- a Reassign button.

#### Scenario: Expanding a row
- **WHEN** an admin expands the row of a volunteer preparing VT-ABCD-EFGH for the fictional client Lena Ortiz
- **THEN** the list shows VT-ABCD-EFGH, "Lena Ortiz", "Filing in progress (preparing)", Preparer, Open and Reassign

### Requirement: Taxpayer names show only on the admin-only Workload
The primary taxpayer's name SHALL show in the Workload's case lists and in its Assign/Reassign drawer, which only a cleared admin opens. The work board, the case pool and the office queue SHALL keep showing no taxpayer names. Who can read case data SHALL NOT change.

#### Scenario: The board stays nameless
- **WHEN** a preparer opens the work board after this change
- **THEN** no taxpayer name is shown on it, as before

### Requirement: The Unassigned row lists cases waiting for a preparer or a reviewer
The first row of the Workload SHALL be "Unassigned". Its counts SHALL be how many cases wait for a preparer and how many wait for a reviewer. Expanded, it SHALL list:
- every case at Pending intake / filing with no preparer, as waiting for a preparer;
- every case at Pending review with no reviewer, as waiting for a reviewer.

Each case SHALL have its case #, the primary taxpayer's full name, its stage, an Open button and an Assign button.

#### Scenario: Cases waiting
- **WHEN** one case is at Pending intake / filing with no preparer, and another is at Pending review with no reviewer
- **THEN** the Unassigned row lists both, the first with Assign for a preparer and the second with Assign for a reviewer

### Requirement: The Assign/Reassign drawer offers only people who can take the slot
Assign and Reassign SHALL open a drawer that names the case (case # and full name) and the slot. The drawer SHALL list a person only when all of these hold:
- they are cleared;
- their effective capabilities include `prepare` for the preparer slot, or `review` for the reviewer slot;
- for the reviewer slot, they are not a preparation participant of the case;
- for the preparer slot, they are not the case's current reviewer.

The case's current holder of the slot SHALL be listed, marked "Current", and SHALL NOT be choosable. When any person was left out because they took part in preparing the case or are its reviewer, one line SHALL say how many, for example "1 person who prepared this case isn't shown." Each listed person SHALL show their name, languages, roles and Open count. A search box SHALL filter the list by name, ignoring case.

#### Scenario: A former preparer is not offered as reviewer
- **WHEN** an admin opens Reassign for the reviewer of a case that Alex Chen prepared before it was reassigned, and Alex Chen is a cleared Reviewer
- **THEN** Alex Chen is not listed, and the drawer says "1 person who prepared this case isn't shown."

#### Scenario: Uncleared people are not offered
- **WHEN** a Preparer is new with no photo ID check, and an admin opens Assign for a preparer
- **THEN** that Preparer is not listed

#### Scenario: The current holder
- **WHEN** an admin opens Reassign for a case's preparer
- **THEN** the current preparer is listed, marked "Current", with no Choose button

### Requirement: The drawer puts same-language volunteers first, then the least busy
The drawer SHALL order the people it lists in three groups:
1. those who speak the client's preferred language;
2. those who speak another language the client speaks;
3. everyone else.

Within each group, people SHALL be ordered by fewest Open cases, then by name. The client's languages SHALL be the ones the staff Language column uses. English SHALL count like any other language. "Other" SHALL match only when the volunteer's other language and the client's other language are the same text, ignoring case and surrounding spaces.

#### Scenario: Preferred, then another, then none
- **WHEN** the client prefers Cantonese and also speaks Mandarin, and the candidates are a Mandarin speaker with 1 open case, a Cantonese speaker with 3, and an English speaker with 0
- **THEN** the order is the Cantonese speaker, the Mandarin speaker, then the English speaker

#### Scenario: Fewest open cases within a group
- **WHEN** two Cantonese speakers have 2 and 0 open cases, and the client prefers Cantonese
- **THEN** the one with 0 comes first

#### Scenario: Other languages
- **WHEN** the client's other language is "Vietnamese", one volunteer's other language is "vietnamese " and another's is "Tagalog"
- **THEN** the first is in the preferred-or-another group and the second is not

### Requirement: An admin assigns or reassigns a case's preparer or reviewer
A staff member whose effective capabilities include `admin` SHALL be able to send `ASSIGN_CASE` with a slot (`preparer` or `reviewer`), a person, and the slot's holder as the admin saw it (none for an empty slot). It SHALL go through the case action path: receipt, case lock, revision check, and refusal of an uncleared caller with `NOT_CLEARED` first. The drawer SHALL send the case's revision and the slot's holder as they were when it opened, not as they are when Choose is pressed. It SHALL be allowed:
- preparer, no preparer yet: at Pending intake / filing (an Assign);
- preparer, already held: at Filing in progress, Corrections in progress, Pending review and Review in progress (a Reassign);
- reviewer, no reviewer yet: at Pending review (an Assign);
- reviewer, already held: at Review in progress (a Reassign).

A slot whose holder is not the one named SHALL be refused with `CONFLICT`, whatever revision is sent, so an Assign never becomes a Reassign. Any other stage, or assigning the slot's current holder again, SHALL be refused with `INVALID_TRANSITION`. A caller without effective `admin` SHALL be refused with `FORBIDDEN`. A person not in the workspace SHALL be refused with `FORBIDDEN`. A person who is not cleared, or whose effective capabilities lack `prepare` (preparer) or `review` (reviewer), SHALL be refused with `INELIGIBLE`. A preparation participant as reviewer, or the case's current reviewer as preparer, SHALL be refused with `SELF_REVIEW`. On any refusal nothing SHALL be written and no receipt SHALL be stored. A stale revision SHALL be refused with `CONFLICT`.

#### Scenario: A non-admin
- **WHEN** a cleared Reviewer sends `ASSIGN_CASE` for a case's preparer
- **THEN** it is refused with `FORBIDDEN`

#### Scenario: After approval
- **WHEN** an admin sends `ASSIGN_CASE` for the preparer of a case at Ready to exit
- **THEN** it is refused with `INVALID_TRANSITION`

#### Scenario: A preparer as their own reviewer
- **WHEN** an admin assigns, as reviewer, a cleared Reviewer who is a preparation participant of the case
- **THEN** it is refused with `SELF_REVIEW`, and the case is unchanged

#### Scenario: The reviewer as preparer
- **WHEN** an admin reassigns the preparer of a case at Review in progress to the case's current reviewer
- **THEN** it is refused with `SELF_REVIEW`

#### Scenario: Two admins at once
- **WHEN** two admins reassign the same case's preparer from the same revision
- **THEN** one succeeds and the other is refused with `CONFLICT`

#### Scenario: Claimed while the drawer is open
- **WHEN** an admin opens Assign a preparer for a case at Pending intake / filing, and a volunteer claims the case before the admin presses Choose
- **THEN** the admin's Choose is refused with `CONFLICT`, the drawer says the case changed and now offers Reassign the preparer, and the volunteer keeps the case

#### Scenario: A holder named wrongly at the current revision
- **WHEN** an admin's `ASSIGN_CASE` carries the case's current revision but names no holder for a preparer slot that is held
- **THEN** it is refused with `CONFLICT`, and the case is unchanged

### Requirement: Assigning an empty slot has the effects of the person's own claim
Assigning a preparer to a case at Pending intake / filing SHALL move it to Filing in progress, set the person as preparer and record them as a preparation participant, as their own claim would. Assigning a reviewer to a case at Pending review SHALL move it to Review in progress, set the person as reviewer and open an active review at the case's current preparation version, as their own claim would. The client SHALL see the same progress line as for a claim: "A volunteer has started preparing your return." or "An independent reviewer is checking your return."

#### Scenario: Assigning a preparer
- **WHEN** an admin assigns a cleared Preparer to a case at Pending intake / filing
- **THEN** the case is at Filing in progress with that preparer, they are a preparation participant, and the client's progress says "A volunteer has started preparing your return."

#### Scenario: Assigning a reviewer
- **WHEN** an admin assigns a cleared Reviewer to a case at Pending review
- **THEN** the case is at Review in progress with that reviewer, an active review is open for them, and the client's progress says "An independent reviewer is checking your return."

### Requirement: A reassignment hands over the work in progress
Reassigning a case's preparer SHALL set the new preparer and record them as a preparation participant. The previous preparer SHALL stay a preparation participant, so they can never be assigned or claim the case's review. The stage SHALL NOT change. Open corrections SHALL pass to the new preparer: the reviewer's findings stay on the case, and the new preparer resubmits as the preparer.

Reassigning a case's reviewer at Review in progress SHALL hand the active review to the new reviewer. Its preparation version and start time SHALL be kept, no new review SHALL be opened, and the new reviewer SHALL be able to request corrections or approve it. A reviewer questionnaire that the previous reviewer filled in but did not send exists only in their browser and SHALL NOT carry over.

A reassignment SHALL add no client progress line. The previous holder's screens SHALL drop the case from their own work without a reload. An action they send from a screen that was already open SHALL be refused as it is today for a case that is not theirs.

#### Scenario: Reassigning during corrections
- **WHEN** an admin reassigns the preparer of a case at Corrections in progress from Alex Chen to Jordan Park
- **THEN** Jordan Park is the preparer, both are preparation participants, the stage is unchanged, and Jordan Park can resubmit it

#### Scenario: Reassigning mid-review
- **WHEN** an admin reassigns the reviewer of a case at Review in progress from Morgan Lee to Riley Quinn
- **THEN** the same review is now Riley Quinn's, no new review exists, and Riley Quinn can approve it

#### Scenario: The previous reviewer's stale screen
- **WHEN** Morgan Lee, after being reassigned off the review, presses Approve on a screen that was already open
- **THEN** it is refused, and nothing is recorded

#### Scenario: No client line
- **WHEN** an admin reassigns a case's preparer
- **THEN** the client's progress gains no new line

### Requirement: Every assignment is in the case history
Each accepted `ASSIGN_CASE` SHALL add a case event with the admin as the actor and the slot, the person and the previous holder (none for an Assign). The staff history SHALL read "<admin> assigned <person> as preparer" or "as reviewer", followed by " (was <previous holder>)" for a reassignment.

#### Scenario: The history of a reassignment
- **WHEN** Sam Lee reassigns a case's preparer from Alex Chen to Jordan Park
- **THEN** the case's internal history shows "Sam Lee assigned Jordan Park as preparer (was Alex Chen)."

#### Scenario: The history of an assignment
- **WHEN** Sam Lee assigns Riley Quinn as reviewer of a case at Pending review
- **THEN** the history shows "Sam Lee assigned Riley Quinn as reviewer."
