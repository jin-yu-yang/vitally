## ADDED Requirements

### Requirement: An update's audience is resolved live from the current season's roster
An update SHALL have the audience `everyone` ("All volunteers") or `roles`, with a non-empty subset of `greeter`, `intaker`, `preparer`, `reviewer` and `admin`. A person SHALL be in an update's audience when all of these hold:
- their person is linked to an active `staff` membership in the update's workspace;
- they have a `roster_entries` row for the workspace's current season;
- the audience is `everyone`, or that entry's roles include at least one of the update's roles.

Clearance SHALL NOT matter. The audience SHALL be evaluated whenever it is read, never stored per person, so people added to the roster later are in it, and people who leave it are not. The audience check SHALL live in one function, so it can later switch from the active staff membership to an active account.

#### Scenario: An uncleared volunteer is in All volunteers
- **WHEN** a staff member has a current-season roster entry with no roles, and an update to All volunteers is posted
- **THEN** that staff member is in its audience

#### Scenario: Added to the roster later
- **WHEN** an update to All volunteers was posted yesterday, and a staff member gets a current-season roster entry today
- **THEN** that staff member is in its audience and sees it in their feed

#### Scenario: No current-season entry
- **WHEN** a staff member has a roster entry for an earlier season only
- **THEN** they are in no update's audience

#### Scenario: Inactive membership
- **WHEN** a person with a current-season roster entry has only an inactive staff membership
- **THEN** they are in no update's audience

#### Scenario: A role audience
- **WHEN** an update's audience is Reviewer, and one staff member's entry has Reviewer and another's has only Preparer
- **THEN** only the first is in its audience

### Requirement: Only a ceiling admin writes updates
`vitally_save_update` and `vitally_update_action` SHALL be allowed only for a `staff` caller whose `people.capabilities` include `admin` in that workspace, cleared or not. Any other caller SHALL be refused with `FORBIDDEN`, and nothing SHALL be written. Every write to `posted_updates` and `update_reads` SHALL go through the public RPCs, because signed-in users have no insert, update or delete grant on either table.

#### Scenario: An uncleared admin posts
- **WHEN** a staff member whose `people.capabilities` include `admin`, and who has no roles, posts an update
- **THEN** it is posted

#### Scenario: A preparer tries to post
- **WHEN** a cleared staff member without `admin` in `people.capabilities` calls `vitally_save_update`
- **THEN** it is refused with `FORBIDDEN`, and nothing is stored

#### Scenario: A client tries to post
- **WHEN** a client calls `vitally_save_update`
- **THEN** it is refused with `FORBIDDEN`

#### Scenario: No direct writes
- **WHEN** a signed-in admin tries to insert into `posted_updates` or `update_reads` directly
- **THEN** the insert is refused

### Requirement: An update is validated
An update SHALL have:
- a kind, `irs_policy` ("IRS policy update") or `office_notice` ("Office notice");
- a title of 1 to 120 characters and a message of 1 to 2000 characters, both after trimming;
- an audience as above;
- an optional "keep at the top until" date;
- an "ask to confirm" flag.

An IRS link SHALL be optional, allowed only on an `irs_policy` update, at most 500 characters, and an `https` URL whose host is `irs.gov` or ends in `.irs.gov`. An invalid update SHALL be refused with `VALIDATION`, naming the field, and nothing SHALL be stored. The browser SHALL show the same checks in the form before sending.

#### Scenario: A link that is not irs.gov
- **WHEN** an admin saves an IRS policy update with the link `https://example.org/irs`
- **THEN** it is refused with `VALIDATION` naming the link, and the form shows the problem

#### Scenario: A link on an office notice
- **WHEN** an admin saves an office notice with an IRS link
- **THEN** it is refused with `VALIDATION`

#### Scenario: An empty title
- **WHEN** an admin saves an update whose title is only spaces
- **THEN** it is refused with `VALIDATION` naming the title

#### Scenario: A role audience with no roles
- **WHEN** an admin saves an update with audience `roles` and no roles chosen
- **THEN** it is refused with `VALIDATION` naming the audience

### Requirement: Updates move from draft to posted to unpublished, and only drafts are deleted
An update SHALL be a draft, posted or unpublished.
- **Draft:**
  - Save draft creates or edits a draft.
  - Post update creates a posted update, or posts a draft. Posting records who posted it and when.
  - A draft SHALL be visible only to ceiling admins.
- **Delete:** a draft SHALL be deleted with `vitally_update_action` type `DELETE`. Deleting a posted or unpublished update SHALL be refused with `INVALID_TRANSITION`.
- **Unpublish:** type `UNPUBLISH` SHALL turn a posted update into an unpublished one. Unpublishing a draft or an unpublished update SHALL be refused with `INVALID_TRANSITION`. An unpublished update SHALL NOT be edited or posted again, and SHALL leave every feed.
- **Revision and replay:** each write SHALL take the update's current revision and SHALL be refused with `CONFLICT` when it is stale. Each write SHALL store a receipt, so a repeated action id returns the first result without a second change.

#### Scenario: Save a draft, then post it
- **WHEN** an admin saves a draft and then posts it from the table
- **THEN** it is posted, with the admin as poster and the time it was posted, and it appears in its audience's feeds

#### Scenario: Delete a draft
- **WHEN** an admin deletes a draft
- **THEN** it no longer exists

#### Scenario: A posted update cannot be deleted
- **WHEN** an admin calls `DELETE` on a posted update
- **THEN** it is refused with `INVALID_TRANSITION`, and the update is unchanged

#### Scenario: Unpublish
- **WHEN** an admin unpublishes a posted update
- **THEN** it is unpublished, it leaves every feed, and it stays in the admin table with its counts

#### Scenario: An unpublished update cannot be edited
- **WHEN** an admin saves changes to an unpublished update
- **THEN** it is refused with `INVALID_TRANSITION`

#### Scenario: A stale edit
- **WHEN** two admins open the same update, and the second saves after the first
- **THEN** the second save is refused with `CONFLICT`

#### Scenario: A replayed post
- **WHEN** an admin's post is sent twice with the same action id
- **THEN** one update is posted, and both calls return the same result

### Requirement: Editing a posted update keeps reads unless the admin asks everyone to read it again
Saving changes to a posted update SHALL keep it posted and record that it was edited. By default, its reads and confirmations SHALL be kept. When the admin ticks "Ask everyone to read it again", every read and confirmation of that update SHALL be removed in the same save, so it is unread for everyone. The checkbox SHALL be offered only when editing a posted update. Saving changes to a draft SHALL NOT touch any read.

#### Scenario: A typo fix keeps confirmations
- **WHEN** an update has 6 confirmations, and an admin fixes a typo without ticking the checkbox
- **THEN** it still has 6 confirmations, and the panel marks it "Edited"

#### Scenario: Ask everyone to read it again
- **WHEN** an admin edits that update with "Ask everyone to read it again" ticked
- **THEN** it has no reads or confirmations, and it is unread in every audience member's feed

### Requirement: The feed returns the caller's posted updates in one item shape
`vitally_my_updates()` SHALL return, for a `staff` caller (cleared or not), the posted updates whose audience includes the caller, and the badge count. A client or an anonymous caller SHALL be refused with `FORBIDDEN`.

Each item SHALL have exactly these fields, so later system notifications can join the same feed with their own `source`:
- `source` (`posted_update`), `id`, `kind`, `title`, `message`, `irsLink`;
- `postedAt`, `postedByName`, `edited`, `pinned`;
- `askConfirm`, `readAt`, `confirmedAt`.

The order SHALL be:
- pinned items first;
- then the rest;
- within each group, newest `postedAt` first.

An item SHALL be pinned while its "keep at the top until" date is today or later in New York time. A past date only stops pinning; it SHALL NOT hide the item.

The badge count SHALL be the number of items that are unread, or that ask for confirmation and are not confirmed.

#### Scenario: Pinned first
- **WHEN** an older update is kept at the top until a future date, and a newer one is not pinned
- **THEN** the older one comes first

#### Scenario: A past pin date
- **WHEN** an update's keep-at-the-top date was yesterday
- **THEN** it is in the feed, not pinned, ordered by when it was posted

#### Scenario: Drafts and unpublished updates are not in the feed
- **WHEN** the workspace has a draft, a posted and an unpublished update to All volunteers
- **THEN** a volunteer's feed holds only the posted one

#### Scenario: Unconfirmed keeps the badge
- **WHEN** a volunteer has read an update that asks for confirmation but has not confirmed it
- **THEN** the badge count includes it

### Requirement: Opening the panel marks its updates read, and "I've read this" confirms
`vitally_mark_updates(p_update_ids, p_confirm)` SHALL record, for the signed-in staff caller and each given id in their feed, that they read it. It SHALL keep the first read time. With `p_confirm` true, for an update that asks for confirmation, it SHALL also record the first confirmation time. Ids not in the caller's feed SHALL be ignored without saying why. More than 200 ids SHALL be refused with `VALIDATION`. It SHALL store no receipt.

The browser SHALL:
- mark every unread item shown when the Notifications panel opens;
- show an "I've read this" button on each item that asks for confirmation and is not confirmed;
- show the confirmation date once confirmed.

#### Scenario: Opening the panel
- **WHEN** a volunteer with two unread updates, neither asking for confirmation, opens the panel
- **THEN** both are recorded as read, and the badge goes to 0

#### Scenario: Confirming
- **WHEN** the volunteer presses "I've read this" on an update that asks for confirmation
- **THEN** the confirmation is recorded, the button is replaced by the confirmation date, and the badge drops by one

#### Scenario: Someone else's update
- **WHEN** a volunteer marks the id of an update addressed only to Reviewers, and they are not a Reviewer
- **THEN** nothing is recorded, and the call reports 0 marked

#### Scenario: Marking again keeps the first time
- **WHEN** a volunteer opens the panel twice
- **THEN** each update's read time is the first one

### Requirement: Read state is reachable only through the RPCs
`update_reads` SHALL have row security on, with no grant to `anon` or `authenticated`. No signed-in user SHALL read or write it directly. It SHALL NOT be in the realtime publication.

#### Scenario: A direct read
- **WHEN** a signed-in admin selects from `update_reads`
- **THEN** the read is refused

### Requirement: Staff read posted-update rows only as admins or as their audience
`posted_updates` SHALL be readable by signed-in users only through two policies:
- a ceiling admin reads every row in their workspace;
- any staff member reads the non-draft rows whose audience includes them.

Unpublished rows SHALL stay readable to their audience, so realtime can tell an open window that an update was unpublished. The feed SHALL leave them out. A client SHALL read no rows. The audience policy SHALL NOT depend on clearance.

#### Scenario: A draft is hidden
- **WHEN** a cleared preparer selects from `posted_updates` while a draft exists
- **THEN** they do not get the draft

#### Scenario: Another role's update is hidden
- **WHEN** a preparer selects from `posted_updates` while a posted update addressed only to Reviewers exists
- **THEN** they do not get it

#### Scenario: A client reads nothing
- **WHEN** a client selects from `posted_updates`
- **THEN** they get no rows

### Requirement: Posted-update changes reach open staff windows without publishing reads
`posted_updates` SHALL be in the realtime publication, among the tables a staff window watches, and SHALL NOT be among the tables a client window watches. A cleared staff window SHALL re-read its feed when it is told of a `posted_updates` change, and SHALL also re-read the admin table if the Post an update screen is open. An uncleared window SHALL re-read its feed whenever it re-checks its clearance. The admin table SHALL re-read when the screen opens, when the window regains focus or comes back online, and after each of the admin's own saves and actions.

#### Scenario: A post reaches a volunteer live
- **WHEN** a cleared volunteer's window is open, and an admin posts an update to All volunteers
- **THEN** the volunteer's badge shows the new update without reloading

#### Scenario: Unpublish reaches a volunteer live
- **WHEN** a cleared volunteer's window is open, and an admin unpublishes an update in their feed
- **THEN** the update leaves their panel without reloading

#### Scenario: An uncleared window catches up on focus
- **WHEN** an uncleared volunteer's window is in the background, an update is posted, and the window regains focus
- **THEN** the badge shows the update

### Requirement: The Post an update screen writes updates and shows a live preview
A ceiling admin, cleared or not, SHALL have a "Post an update" link in the sidebar and a screen titled "Post an update". Its New update form SHALL have:
- Type (IRS policy update or Office notice), Title and Message;
- "Link to the IRS source (optional)", shown for IRS policy updates only;
- "Who sees it": All volunteers or Chosen roles, with a checkbox for each of the five roles when Chosen roles is picked;
- "Keep at the top until", a date that cannot be before today;
- "Ask volunteers to confirm they have read it";
- Save draft and Post update.

A Preview SHALL show the update as volunteers will see it, updated as the admin types, with a line naming the audience and whether confirmation is asked. When an existing update is edited, the form SHALL be filled with it and SHALL offer Cancel. A posted update's form SHALL also offer "Ask everyone to read it again". A successful save SHALL clear the form and show a confirmation message. A failed save SHALL keep what was typed.

#### Scenario: Post an update
- **WHEN** an admin fills in an IRS policy update to All volunteers that asks for confirmation, and presses Post update
- **THEN** it is posted, the form is cleared, a message says it was posted, and it appears at the top of the Posted updates table

#### Scenario: The preview follows the form
- **WHEN** an admin types a title
- **THEN** the preview shows that title without a save

#### Scenario: A volunteer has no link
- **WHEN** a staff member without `admin` in `people.capabilities` looks at the sidebar
- **THEN** there is no Post an update link, and the screen is not available to them

### Requirement: The Posted updates table shows every update with live counts
`vitally_posted_updates()` SHALL return to a ceiling admin every update in the workspace, newest first. Each update SHALL come with:
- its fields and status;
- its live audience size;
- how many of the current audience have read it and have confirmed it;
- each audience member's name, read time and confirmation time.

Reads by people no longer in the audience SHALL NOT count. Any other caller SHALL be refused with `FORBIDDEN`.

The table SHALL show, for each update:
- title, type, posted date or "Draft", and audience;
- read count, as "read/audience size" with a bar;
- confirmed count with a bar, or "Not asked";
- its actions:
  - for posted updates: Edit and Unpublish;
  - for drafts: Edit, Post and Delete;
  - for unpublished updates: none, with a status of "Unpublished".

Pressing a read or confirmed count SHALL open a list of the audience with each person's read and confirmed state.

#### Scenario: Counts follow the roster
- **WHEN** an update to All volunteers has 7 of 8 read, and a ninth volunteer is added to the roster
- **THEN** the table shows 7/9

#### Scenario: Who has confirmed
- **WHEN** an admin presses an update's confirmed count
- **THEN** a list shows every audience member's name, with read and confirmed dates or "Not yet"

#### Scenario: A non-admin
- **WHEN** a staff member without `admin` in `people.capabilities` calls `vitally_posted_updates`
- **THEN** it is refused with `FORBIDDEN`

### Requirement: Unpublish and Delete need a confirmation
Unpublish SHALL open a confirmation naming the update and saying volunteers will no longer see it, with "Unpublish" and "Keep it" buttons. Delete on a draft SHALL open a confirmation saying the draft will be deleted, with "Delete draft" and "Keep it" buttons. Nothing SHALL change until the admin confirms.

#### Scenario: Keep it
- **WHEN** an admin presses Unpublish and then Keep it
- **THEN** the update stays posted

#### Scenario: Confirm unpublish
- **WHEN** an admin presses Unpublish and then confirms
- **THEN** the update is unpublished, and a message says so

### Requirement: Every staff sidebar has Notifications with an unread badge
Every staff window, cleared or not, SHALL have a "Notifications" entry with a bell in its sidebar. When the badge count is above 0, the entry SHALL show it, and its accessible name SHALL be "Notifications, N unread". It SHALL open the Notifications panel. Client windows SHALL NOT have it.

The panel SHALL:
- list the feed;
- show each item's poster name, type, title, message, the IRS link if any, and when it was posted;
- show "Edited" when edited, and a pinned marker while pinned;
- highlight items that are unread or waiting for confirmation;
- end with "Office admins relay IRS policy updates here. Replies are turned off.";
- show "No updates yet." when the feed is empty.

There SHALL be no reply, reaction or message control.

#### Scenario: The badge
- **WHEN** a volunteer has three unread updates
- **THEN** the sidebar shows Notifications with a badge of 3, named "Notifications, 3 unread"

#### Scenario: No replies
- **WHEN** a volunteer opens the panel
- **THEN** there is no way to reply

#### Scenario: Empty
- **WHEN** a volunteer with no updates opens the panel
- **THEN** it says "No updates yet."

#### Scenario: A client
- **WHEN** a client is signed in
- **THEN** there is no Notifications entry
