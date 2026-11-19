## ADDED Requirements

### Requirement: A cleared window re-reads its clearance on wake events
A cleared staff window SHALL re-read `vitally_my_clearance()`, before its lists, on each wake event: focus, the tab becoming visible, `online`, and a realtime reconnect. An answer that is not cleared SHALL show the setup screen without reading the lists. The refresh after a successful action SHALL NOT re-read it. Role changes SHALL NOT come through realtime.

#### Scenario: An added role shows on focus
- **WHEN** a cleared Preparer's window is in the background, an admin adds the Reviewer role to them, and the window regains focus
- **THEN** a case waiting for review offers the claim-review button without a reload

#### Scenario: A tab that becomes visible re-reads
- **WHEN** a cleared staff member's tab is hidden, an admin adds a role to them, and the tab becomes visible again
- **THEN** the window shows that role's buttons without a reload

#### Scenario: Every role removed, noticed on focus
- **WHEN** an admin removes every role from a cleared staff member while their window is in the background, and the window regains focus
- **THEN** the window shows the setup screen, and no case list is read

#### Scenario: The refresh after an action does not re-read
- **WHEN** a cleared staff member's action succeeds and the window refreshes its lists
- **THEN** no clearance request is sent

### Requirement: A refusal makes a cleared window re-read its clearance
When an action in a cleared staff window is refused with `FORBIDDEN` or `INELIGIBLE`, the window SHALL re-read `vitally_my_clearance()`. The refusal SHALL stay on screen while the buttons follow the answer. An `INELIGIBLE` refusal for assigning someone who is not cleared SHALL also cause the re-read.

#### Scenario: A narrowed role is noticed on the refusal
- **WHEN** a cleared staff member whose roles were Preparer and Reviewer loses Reviewer while their window is open, and they press Claim review on a case
- **THEN** the claim is refused with `INELIGIBLE`, the refusal stays on screen, and no claim-review button is offered any more

#### Scenario: Assigning someone uncleared
- **WHEN** a cleared admin assigns a case's preparer to a person who is not cleared, and the assignment is refused with `INELIGIBLE`
- **THEN** the window re-reads its clearance once, the refusal stays on screen, and the admin's buttons are unchanged

### Requirement: Saving one's own Roster row re-reads the clearance
After the signed-in admin saves their own Roster row, the window SHALL wait for any clearance request already out, then re-read `vitally_my_clearance()` once more, whether or not they were cleared.

#### Scenario: Saving one's own row while cleared
- **WHEN** a cleared admin who is also a Preparer removes Preparer from their own Roster row and saves
- **THEN** no preparation button is offered any more

#### Scenario: Saving one's own row removes every role
- **WHEN** a cleared admin removes every role from their own Roster row and saves
- **THEN** the window shows the setup screen, and they stay on the Roster

### Requirement: Clearance re-reads are one at a time and quiet when nothing changed
A window SHALL have at most one clearance request out. A wake event or refusal that comes while one is out SHALL share its answer. An answer with the same effective capabilities and the same `isAdmin` as before SHALL NOT redraw the window.

#### Scenario: One request at a time
- **WHEN** a cleared window's clearance request is still out, and the window regains focus, becomes visible, and has an action refused with `FORBIDDEN`
- **THEN** no second clearance request is sent until the first is answered

#### Scenario: Nothing changed
- **WHEN** a cleared window regains focus and the answer has the same effective capabilities and `isAdmin`
- **THEN** the window is not redrawn for the clearance answer

### Requirement: Losing or gaining effective Admin keeps the person in place
When a re-read changes whether a cleared staff member has effective `admin`, the window SHALL switch between the office frame and the work board:
- **Follow-ups** SHALL stay on the same screen, which becomes the Work board.
- **All cases** SHALL move to the Work board.
- **An office case page** SHALL stay on the same case, shown as the volunteer case page.
- **The Roster and Post an update** SHALL NOT move.

Gaining effective `admin` SHALL work in reverse.

#### Scenario: Losing Admin on Follow-ups
- **WHEN** a cleared admin who is also a Preparer is on Follow-ups, loses the Admin role, and the window re-reads its clearance
- **THEN** the same screen shows the Work board, without the All cases link

#### Scenario: Losing Admin on All cases
- **WHEN** a cleared admin who is also a Preparer is on All cases, loses the Admin role, and the window re-reads its clearance
- **THEN** the window shows the Work board, and a later gain of Admin does not return them to All cases by itself

#### Scenario: Losing Admin on an office case page
- **WHEN** a cleared admin who is also a Preparer has a case open, loses the Admin role, and the window re-reads its clearance
- **THEN** the same case shows as the volunteer case page, with no office actions

### Requirement: A form whose capability is gone keeps its text and drops its submit
A drawer, dialog or Add a case page whose action needs an effective capability the staff member lacks SHALL keep its typed text and error. Its submit SHALL be replaced by "Your roles changed, so you can't send this any more." A case page form SHALL show its explanation line and keep its draft.

#### Scenario: Losing Admin on Add a case
- **WHEN** a cleared admin who is also a Preparer has typed answers on Add a case, loses the Admin role, and the window re-reads its clearance
- **THEN** the page and the typed answers stay, and its Save draft and Send to the office buttons are replaced by "Your roles changed, so you can't send this any more."

#### Scenario: A drawer that needs a lost capability
- **WHEN** a cleared admin has typed a note in the Log call drawer, loses the Admin role, and the window re-reads its clearance
- **THEN** the drawer stays open with the note, and its submit buttons are replaced by "Your roles changed, so you can't send this any more."

#### Scenario: Gaining a role with a form in view
- **WHEN** a cleared Intaker who is not a Preparer has a case in preparation open, an admin adds the Preparer role and assigns them as the case's preparer, and the window regains focus
- **THEN** the case page offers the preparation form

### Requirement: Dialogs on the roster ceiling keep their submit
A dialog whose RPC checks the roster ceiling (`people.capabilities`), or only that the caller is staff (Notifications), SHALL NOT be replaced when effective capabilities change. These are the volunteer drawer, Send invitation, Cancel invitation, Deactivate account, Who has read it, Unpublish, Delete draft and Notifications.

#### Scenario: A ceiling drawer is not replaced
- **WHEN** a cleared admin has the volunteer drawer open, loses the Admin role but keeps `admin` in their roster ceiling, and the window re-reads its clearance
- **THEN** the volunteer drawer keeps its Save button

### Requirement: Each staff form follows the capability its RPC checks
The submit of each staff form below SHALL depend on the effective capability its RPC checks:
- `admin`: Add a case, Assign, Close unsigned, Close case, Put on hold, Resume from hold, Mark ready to e-file, Mark e-filed, Record filing result, Return to signing, Request documents;
- `followup`: Log call;
- `assist`: Resolve help;
- `review`: Ask for corrections.

#### Scenario: Resolve help without assist
- **WHEN** a cleared Intaker has the Resolve help drawer open, loses the Intaker role while keeping Greeter, and the window re-reads its clearance
- **THEN** the drawer's submit is replaced by "Your roles changed, so you can't send this any more."

### Requirement: Every dialog is classified by the capability it needs
Every dialog SHALL be in exactly one category: an effective capability (`admin`, `followup`, `assist` or `review`), the roster-ceiling dialogs, or the dialogs that need no capability. The last are the client dialogs Help, Regenerate, Print and Withdraw, and Leave without saving, which calls no RPC. A dialog that needs no capability SHALL never be replaced.

#### Scenario: Every dialog is classified
- **WHEN** the dialog keys are listed
- **THEN** each is in exactly one category, and a new key in none of them fails the check
