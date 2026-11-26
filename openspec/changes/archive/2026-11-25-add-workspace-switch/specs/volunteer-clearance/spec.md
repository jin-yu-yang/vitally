## MODIFIED Requirements

### Requirement: Losing or gaining effective Admin keeps the person in place
When a re-read changes which sides a cleared staff member has (see staff-workspaces: the office side is any of `admin`, `followup`, `assist` or `receive_documents`; the Cases side is `prepare` or `review`), the window SHALL follow these rules without a reload.

**Losing the side the window is on** SHALL move the window to the side that remains:
- **Follow-ups** SHALL stay on the same screen, which becomes the Work board, and the reverse.
- **All cases** SHALL move to the Work board.
- **A case page** SHALL stay on the same case, shown as the other side's case page.
- **The Roster, Post an update, Season settings, the Schedule and My profile** SHALL NOT move.

**Gaining a side** SHALL show the switch and SHALL NOT change the screen or the workspace. The remembered side SHALL change only when the person presses the switch.

**Losing the other side** SHALL remove the switch and SHALL NOT move the window.

All cases SHALL stay effective Admin's: losing effective `admin` on All cases SHALL move the window to its home, even when an office side remains.

#### Scenario: Losing Admin on Follow-ups
- **WHEN** a cleared admin who is also a Preparer is on Follow-ups, loses the Admin role, and the window re-reads its clearance
- **THEN** the same screen shows the Work board, without the All cases link and without the switch

#### Scenario: Losing Admin on All cases
- **WHEN** a cleared admin who is also a Preparer is on All cases, loses the Admin role, and the window re-reads its clearance
- **THEN** the window shows the Work board, and a later gain of Admin does not return them to All cases by itself

#### Scenario: Losing Admin on an office case page
- **WHEN** a cleared admin who is also a Preparer has a case open, loses the Admin role, and the window re-reads its clearance
- **THEN** the same case shows as the volunteer case page, with no office actions

#### Scenario: Gaining Admin on the work board
- **WHEN** a cleared Preparer is on the Work board, gains the Admin role, and the window re-reads its clearance
- **THEN** the Work board stays, and the switch appears at the top of the sidebar with Cases pressed

#### Scenario: Gaining Admin on a case page, then reloading
- **WHEN** a cleared Preparer who has never pressed the switch has a case open, gains the Admin role, the window re-reads its clearance, and the person then reloads without pressing the switch
- **THEN** after the re-read the same volunteer case page stays, with Cases pressed; after the reload the window opens on the office side, because nothing was remembered and Office is the default

#### Scenario: Losing Review while on the Cases side
- **WHEN** a cleared Admin who is also a Reviewer is on the Work board on the Cases side, loses the Reviewer role, and the window re-reads its clearance
- **THEN** the same screen shows Follow-ups, the switch is gone, and their remembered side is still Cases

#### Scenario: Losing the other side
- **WHEN** a cleared Admin who is also a Reviewer is on Follow-ups, loses the Reviewer role, and the window re-reads its clearance
- **THEN** Follow-ups stays and the switch is gone

### Requirement: A form whose capability is gone keeps its text and drops its submit
A drawer, dialog or Add a case page whose action needs an effective capability the staff member lacks SHALL keep its typed text and error. Its submit SHALL be replaced by "Your roles changed, so you can't send this any more." A case page form SHALL show its explanation line and keep its draft.

#### Scenario: Losing Admin on Add a case
- **WHEN** a cleared admin who is also a Preparer has typed answers on Add a case, loses the Admin role, and the window re-reads its clearance
- **THEN** the page and the typed answers stay, and its Save draft and Send to the office buttons are replaced by "Your roles changed, so you can't send this any more."

#### Scenario: A drawer that needs a lost capability
- **WHEN** a cleared admin has typed a note in the Log call drawer, loses the Admin role, and the window re-reads its clearance
- **THEN** the drawer stays open with the note, and its submit buttons are replaced by "Your roles changed, so you can't send this any more."

#### Scenario: Gaining a role with a form in view
- **WHEN** a cleared Intaker who is not a Preparer has a case in preparation open on the office case page, an admin adds the Preparer role and assigns them as the case's preparer, and the window regains focus
- **THEN** the office case page stays, the switch appears with Office pressed, the Overview shows "You're preparing this case — switch to Cases", and pressing Switch to Cases shows the preparation form
