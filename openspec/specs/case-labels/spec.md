# case-labels Specification

## Purpose
Staff-only case labels: short shared markers such as City Tax, MFS and Multi-state that staff put on a case. It covers a workspace's own labels (a name and one of six fixed colors, with three starter labels in every workspace), who creates, renames and recolors them (a cleared admin, from the case header's label menu) and who adds and removes them on a case (staff who work on the case, never on a closed case). It also covers where staff see them (the case header, the work board and the case pool, with a Label filter in the pool), that clients never see them, and the two RPCs, `vitally_save_label` and `vitally_set_case_label`, with their refusals, receipts and staff history. A label change never changes the case's revision or `updated_at`, and a removed label is recorded as inactive, never deleted.

## Requirements

### Requirement: A workspace has its own labels
Each workspace SHALL have its own set of case labels.
- Each label SHALL have a name and a color.
- The name SHALL be stored trimmed, with 1 to 24 characters.
- Two labels in one workspace SHALL NOT have names that are equal ignoring case.
- The color SHALL be one of `sky`, `amber`, `pink`, `green`, `violet` and `slate`.
- Two labels MAY share a color.
- A label SHALL never be visible to, or applied in, another workspace.

#### Scenario: Names are unique ignoring case
- **WHEN** a workspace has a label "City Tax" and an admin creates a label named "city tax"
- **THEN** the save is refused with `VALIDATION` and no label is added

#### Scenario: A name is trimmed and bounded
- **WHEN** an admin saves a label named "  Amended  "
- **THEN** it is stored as "Amended"

#### Scenario: A blank or long name is refused
- **WHEN** an admin saves a label whose trimmed name is empty, or longer than 24 characters
- **THEN** the save is refused with `VALIDATION`

#### Scenario: An unknown color is refused
- **WHEN** an admin saves a label with the color `red` or `#ff0000`
- **THEN** the save is refused with `VALIDATION`

#### Scenario: Colors may repeat
- **WHEN** an admin creates a label "Amended" with the color `sky` while "City Tax" is `sky`
- **THEN** the label is created

### Requirement: Every workspace starts with three labels
Every workspace SHALL have the labels City Tax (`sky`), MFS (`pink`) and Multi-state (`amber`).
- A new workspace SHALL get them when it is created.
- The migration SHALL add them to every existing workspace that has no label of that name, ignoring case.

#### Scenario: A new workspace
- **WHEN** a workspace is created
- **THEN** it has exactly the labels City Tax, MFS and Multi-state, with those colors

#### Scenario: An existing workspace
- **WHEN** the migration runs on a database with existing workspaces
- **THEN** each of them has the three labels

### Requirement: Only an admin creates, renames or recolors a label
`vitally_save_label(p_action_id, p_label_id, p_expected_revision, p_label)` SHALL be the only way to create or change a label.
- **Who:** the caller SHALL be a cleared `staff` member whose effective capabilities include `admin`.
- **Refusals:**
  - an uncleared staff member SHALL get `NOT_CLEARED`;
  - any other caller, a client included, SHALL get `FORBIDDEN`.
- **Payload:** `p_label` SHALL have exactly the keys `name` and `color`. Any other shape SHALL be refused with `VALIDATION`.
- **Create:** with no label id and no expected revision, the label SHALL be created at revision 1.
- **Edit:**
  - with a label id, the label SHALL be found in the caller's workspace (else `NOT_FOUND`);
  - its revision SHALL equal `p_expected_revision` (else `CONFLICT`);
  - its name and color SHALL be replaced, and its revision SHALL increase by 1.
- **Receipt:** the RPC SHALL return `{actionId, labelId, revision}`.
- **What it leaves alone:** it SHALL write no case history and SHALL change no case.

#### Scenario: An admin creates a label
- **WHEN** a cleared admin saves `{name: "Amended", color: "green"}` with no label id
- **THEN** the workspace has a label "Amended" in green at revision 1

#### Scenario: An admin renames and recolors
- **WHEN** a cleared admin saves `{name: "City tax (Phila.)", color: "violet"}` for City Tax at its current revision
- **THEN** every case carrying City Tax shows "City tax (Phila.)" in violet, and the label's revision increases by 1

#### Scenario: A stale edit
- **WHEN** two admins edit the same label from the same revision
- **THEN** the second save is refused with `CONFLICT`, and the first save's values remain

#### Scenario: A volunteer cannot manage labels
- **WHEN** a cleared preparer without `admin` calls `vitally_save_label`
- **THEN** it is refused with `FORBIDDEN`, and nothing changes

#### Scenario: A client cannot manage labels
- **WHEN** a client calls `vitally_save_label`
- **THEN** it is refused with `FORBIDDEN`

### Requirement: No label can be deleted
No RPC and no screen SHALL delete a label. A browser role SHALL have no grant to insert, update or delete rows of the label tables.

#### Scenario: No delete grant
- **WHEN** a staff session tries to delete a row of `case_labels` or `case_label_links` directly
- **THEN** the database refuses it

### Requirement: Staff who work on a case add and remove its labels
`vitally_set_case_label(p_action_id, p_case_id, p_label_id, p_on)` SHALL set whether a label is on a case.

- **Who may call it.** The caller SHALL be a cleared `staff` member who works on the case: a person whose effective capabilities include `admin` or `followup`, or the case's current preparer or reviewer.
- **Checks, in this order:**
  1. An uncleared staff member SHALL get `NOT_CLEARED`.
  2. A client SHALL get `FORBIDDEN`.
  3. A case that is missing, in another workspace, or a client's private draft SHALL get `NOT_FOUND`.
  4. A staff member who does not work on the case SHALL get `FORBIDDEN`.
  5. A label not in the case's workspace SHALL get `VALIDATION`.
  6. A closed case SHALL get `INVALID_TRANSITION`.
- **Receipt:** the RPC SHALL return `{actionId, caseId, labelId, on}`.

#### Scenario: The preparer adds a label
- **WHEN** a case's preparer sets Multi-state on that case
- **THEN** the case carries Multi-state

#### Scenario: The office adds a label to any case
- **WHEN** a cleared admin who is neither preparer nor reviewer sets City Tax on a case at `screening`
- **THEN** the case carries City Tax

#### Scenario: Someone else's case
- **WHEN** a cleared preparer sets a label on a case another volunteer prepares
- **THEN** it is refused with `FORBIDDEN`, and the case's labels do not change

#### Scenario: A closed case
- **WHEN** an admin sets or removes a label on a closed case
- **THEN** it is refused with `INVALID_TRANSITION`, and the case's labels do not change

#### Scenario: A label from another workspace
- **WHEN** an admin sets, on a case, a label id that belongs to another workspace
- **THEN** it is refused with `VALIDATION`

#### Scenario: A client's private draft
- **WHEN** an admin sets a label on a client's unsubmitted application
- **THEN** it is refused with `NOT_FOUND`

### Requirement: Setting a label's current state changes nothing
Setting a label that a case already carries, or removing one it does not carry, SHALL succeed and return a receipt. It SHALL write no link change and no history.

#### Scenario: Two people add the same label
- **WHEN** an admin and the case's preparer both set MFS on the case at the same time
- **THEN** both calls succeed, the case carries MFS once, and the history has one "added" line

### Requirement: A label change leaves the case row alone
Setting or removing a label SHALL NOT change the case's `revision` or `updated_at`.

#### Scenario: An open form is not interrupted
- **WHEN** a preparer has the case open at revision 7, an admin adds City Tax to it, and the preparer then submits for review expecting revision 7
- **THEN** the submit succeeds

#### Scenario: The case pool order is unchanged
- **WHEN** a label is added to a case
- **THEN** the case's `updated_at` is unchanged, and its place in the case pool does not move

### Requirement: A removed label is recorded, never deleted
Removing a label from a case SHALL mark its link inactive, never delete it. Adding the label again SHALL make the same link active. Each change SHALL record who made it and when.

#### Scenario: Other windows see a removal live
- **WHEN** two cleared staff members have the same case open and one removes MFS from it
- **THEN** the other window stops showing MFS without a reload

#### Scenario: Re-adding a label
- **WHEN** MFS is removed from a case and then added again
- **THEN** the case has one MFS link, active

### Requirement: Label changes appear in the staff history
Each actual add or remove SHALL write one `case_events` row: `ADD_CASE_LABEL` or `REMOVE_CASE_LABEL`, with `detail` `{labelId, name}`, where `name` is the label's name at that moment, and the acting person. The staff history SHALL show it as "<person> added label <name>" or "<person> removed label <name>". No `client_events` row SHALL be written.

#### Scenario: A history line
- **WHEN** Alex adds City Tax to a case
- **THEN** the case's staff history shows "Alex added label City Tax", and the client's progress shows nothing new

#### Scenario: After a rename
- **WHEN** City Tax was added to a case and the label is later renamed
- **THEN** the old history line still reads "added label City Tax"

### Requirement: Labels are staff-only
Only a cleared `staff` member of the workspace SHALL read `case_labels`. A cleared staff member SHALL read `case_label_links` only on cases they can see. A client SHALL read no label and no link, not even on their own case, and SHALL receive no Realtime change for either table.

#### Scenario: A client reads nothing
- **WHEN** a client whose case carries MFS reads `case_labels` and `case_label_links`
- **THEN** no row is returned

#### Scenario: A client gets no live change
- **WHEN** a client is subscribed to changes and staff add a label to the client's case
- **THEN** the client receives no change for the label tables

### Requirement: Staff see a case's labels where they work
A case's active labels SHALL show as chips, sorted by name, in three places:
- in the staff case header, after the stage badge and the people;
- on the work board, under the case's reference;
- in the admin case pool, under the case's reference.

Each chip SHALL show the label's name in its color's tokens. A case with no labels SHALL show no chip and no empty space for one.

#### Scenario: The three places
- **WHEN** case #093 carries City Tax
- **THEN** a City Tax chip in sky shows in its case header, under its reference on the work board, and under its reference in the case pool

#### Scenario: A rename shows everywhere
- **WHEN** an admin renames City Tax while another staff window shows the work board
- **THEN** that window shows the new name on every chip without a reload

### Requirement: The case header's label menu
- **Chips and the menu button.** When the signed-in staff member may label the case (they work on it, and it is not closed), the case header SHALL show:
  - a remove button on each chip, named "Remove label <name>";
  - a `+ Add a label` button.
- **The menu.** `+ Add a label` SHALL open a menu with:
  - a search box;
  - one toggle per workspace label, showing whether it is on the case.
- **For an admin only:**
  - each label row SHALL have an edit control that opens a form to rename it and pick one of the six colors;
  - when the search text matches no label's name ignoring case, the menu SHALL offer `Create "<text>"`, which opens the same form pre-filled.
- **Closing.** Escape SHALL close the menu and return focus to `+ Add a label`.
- **Duplicate names.** The form SHALL say "A label with this name already exists" for a duplicate name before sending anything.
- **Read-only.** A staff member who may not label the case SHALL see the chips with no remove button and no `+ Add a label`.

#### Scenario: A volunteer on their case
- **WHEN** the case's preparer opens the menu
- **THEN** they can turn labels on and off, and see no create row and no edit control

#### Scenario: An admin creates from the menu
- **WHEN** an admin types "Amended" in the menu's search and no label matches
- **THEN** the menu offers `Create "Amended"`, and saving it with a color creates the label and adds it to the case

#### Scenario: Read-only chips
- **WHEN** a cleared volunteer opens a case they neither prepare nor review
- **THEN** they see its chips, with no remove buttons and no `+ Add a label`

#### Scenario: A closed case
- **WHEN** an admin opens a closed case that carries MFS
- **THEN** the MFS chip shows, with no remove button and no `+ Add a label`

### Requirement: The case pool filters by label
The admin case pool SHALL have a single-choice "Label" filter. Its options SHALL be:
- `Any label` (the default);
- each workspace label, by name;
- `No label`.

The filter SHALL behave like the other pool filters:
- choosing a label SHALL show only cases carrying it;
- `No label` SHALL show only cases with no active label;
- the phase tab counts SHALL follow the filter;
- "Clear filters" SHALL reset it to `Any label`.

#### Scenario: Filtering by a label
- **WHEN** an admin chooses Multi-state in the Label filter
- **THEN** the pool shows only cases carrying Multi-state, and "Showing N of M cases" counts them

#### Scenario: No label
- **WHEN** an admin chooses `No label`
- **THEN** the pool shows only cases with no active label

#### Scenario: Clearing
- **WHEN** an admin has chosen a label and presses "Clear filters"
- **THEN** the Label filter shows `Any label` and every case is shown

### Requirement: Both label RPCs keep receipts
- **Receipts.** `vitally_save_label` and `vitally_set_case_label` SHALL each store a receipt per action id.
- **Replays.** A repeat of the same action id with the same arguments SHALL return the stored receipt without acting again. The same action id with different arguments SHALL be refused with `VALIDATION`.
- **Refusals.** A refused call SHALL leave no receipt, no link change, no label change and no history.

#### Scenario: A retried add
- **WHEN** a browser repeats a `vitally_set_case_label` call with the same action id after a network error
- **THEN** it gets the same receipt, and the history has one "added" line

#### Scenario: A refusal leaves nothing
- **WHEN** a preparer's `vitally_set_case_label` call on someone else's case is refused
- **THEN** no receipt, link or case event is written

### Requirement: Rehearsal cases carry labels
`npm run seed:local` SHALL put labels on some rehearsal cases through `vitally_set_case_label`:
- each starter label SHALL be on at least one case;
- one case SHALL carry two labels.

#### Scenario: Seeded labels
- **WHEN** a developer runs `npm run seed:local`
- **THEN** the case pool shows City Tax, MFS and Multi-state chips on rehearsal cases, and one case shows two chips
