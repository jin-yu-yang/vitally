# season-settings Specification

## Purpose
The Season settings page for a workspace: the current season's label, the certificate and photo ID upload link and the client documents upload link (stored once per workspace and kept across seasons), and the site's SIDN, which a site coordinator sets here and which is never read back. It covers who opens the page (every workspace admin), who changes it (site coordinators only), how the links and the SIDN are validated, and that no answer, table or realtime message returns the SIDN.

## Requirements

### Requirement: Workspace admins open Season settings, and only site coordinators change it
The staff sidebar SHALL show a "Season settings" link after Post an update to every workspace admin (capability `volunteer-roster`), cleared or not, and SHALL open a screen titled "Season settings" with the overline "OFFICE · ADMIN". A staff member who is not a workspace admin SHALL see no link, and a window of theirs left on Season settings SHALL get their home screen and no settings data.

A site coordinator (capability `site-coordinators`) SHALL see the page's inputs and buttons. Any other workspace admin SHALL see the same values as text, with no Save, Change, Add or Remove, and the note "Only site coordinators can change these settings."

#### Scenario: A site coordinator opens the page
- **WHEN** a site coordinator signs in and presses "Season settings"
- **THEN** the page shows the season card with both link inputs and Save, the SIDN row with Change, and the Site coordinators card with Remove, the picker and Add

#### Scenario: An admin who is not a site coordinator
- **WHEN** a staff member with the Admin role who is not a site coordinator opens Season settings
- **THEN** the page shows the same values as text, no inputs or buttons, and "Only site coordinators can change these settings."

#### Scenario: An uncleared site coordinator
- **WHEN** a site coordinator who is not cleared signs in
- **THEN** the setup screen's sidebar has the "Season settings" link, and the page opens with its controls

#### Scenario: A preparer
- **WHEN** a staff member with only the Preparer role signs in, or restores a window whose saved screen is Season settings
- **THEN** there is no "Season settings" link, and they get their home screen

### Requirement: The page shows the current season and its upload links
The season card SHALL be headed with the current season's label, "<season> for TY <season − 1>" (for `current_season` 2027, "2027 for TY 2026"), and a "Current" tag. It SHALL hold two fields:
- "Certificate and photo ID upload link", with the help text "Volunteers open this from \"Finish your setup\". Use a folder only site coordinators can see.";
- "Client documents upload link", with the help text "Clients open this to send documents."

Each link SHALL be empty or an `https://` address with no spaces, at most 500 characters, after trimming. A site coordinator's Save SHALL store both links for the workspace and say "Season settings saved". An invalid link SHALL be refused, naming the field, with "Enter a link that starts with https://." and nothing SHALL be stored. A save from a page that read an older version SHALL be refused with `CONFLICT`, and the page SHALL read the settings again and say "Someone else changed these settings. Check them and save again."

The links SHALL be stored once per workspace and SHALL be kept when the season changes; the season label SHALL be derived from the workspace's current season, not stored. The SIDN SHALL likewise stay one per workspace. The certificate and photo ID upload link SHALL also be returned to a staff member with a current-season roster entry in their own clearance answer, for the setup screen's Upload (capability `volunteer-clearance`). The Season settings read itself SHALL stay for workspace admins only. The client documents link SHALL NOT be shown anywhere else; #157 will use it.

#### Scenario: Saving the links
- **WHEN** a site coordinator enters `https://example.org/certificates` and `https://example.org/client-documents` and presses Save
- **THEN** both links are stored for the workspace, the page says "Season settings saved", and reopening the page shows them

#### Scenario: A link that isn't https
- **WHEN** a site coordinator enters `http://example.org/certificates` and presses Save
- **THEN** it is refused, the certificate link field says "Enter a link that starts with https://.", and nothing is stored

#### Scenario: Clearing a link
- **WHEN** a site coordinator empties the client documents link and presses Save
- **THEN** the client documents link is stored as empty

#### Scenario: Two site coordinators save
- **WHEN** two site coordinators open the page, one saves, and the other then saves
- **THEN** the second is refused with `CONFLICT`, and their page reads the settings again

#### Scenario: A volunteer gets the certificate link
- **WHEN** a site coordinator saves `https://example.org/certificates`, and a staff member with a current-season roster entry and no roles reads their clearance
- **THEN** their clearance answer carries `https://example.org/certificates`, and not the client documents link

### Requirement: The SIDN is set on Season settings and never read back
The SIDN row SHALL show "Set · updated <date>" when the workspace has a site number, or "Not set" when it has none, with the help text "Volunteers type it at their first sign-in." For a site coordinator it SHALL offer "Change…", which opens a dialog titled "Change the SIDN" with one field, "SIDN", and Save and Cancel. Spaces, hyphens and letter case SHALL be ignored. A value that is not `S` followed by eight digits SHALL be refused with "Enter the site's SIDN: S followed by eight digits." Saving SHALL replace the site number, record when it was updated, close the dialog and say "SIDN updated".

The site number SHALL NOT be returned to the browser by any RPC, policy or realtime message: the page's read SHALL say only whether it is set and when it was last updated, and the save SHALL answer the same. Only the volunteer site check SHALL compare against it (capability `sign-in-accounts`). Season settings SHALL be the only way a signed-in user sets the SIDN.

#### Scenario: Setting the SIDN
- **WHEN** a site coordinator presses Change…, enters `s1234-5678`, and saves
- **THEN** the site number is `S12345678`, the row says "Set · updated <today>", and an invited volunteer who enters `S12345678` at the site check passes it

#### Scenario: A malformed SIDN
- **WHEN** a site coordinator enters `S1234` and saves
- **THEN** the dialog says "Enter the site's SIDN: S followed by eight digits.", and the site number is unchanged

#### Scenario: The SIDN is never returned
- **WHEN** a site coordinator or another workspace admin reads Season settings, or a staff member calls every public RPC and reads every table they can reach
- **THEN** no answer contains the site number

#### Scenario: An admin who is not a site coordinator
- **WHEN** a staff member with the Admin role who is not a site coordinator calls the SIDN save directly
- **THEN** it is refused with `FORBIDDEN`, and the site number is unchanged

### Requirement: Only site coordinators write Season settings
The Season settings read SHALL be allowed for a workspace admin, and refused with `FORBIDDEN` for anyone else. The links save and the SIDN save SHALL be allowed only for a site coordinator, refused with `FORBIDDEN` for anyone else before any other check, and SHALL write nothing and store no receipt when refused. Each save SHALL take an action id; a repeated request with the same action id SHALL return the stored result and write nothing more. Signed-in users SHALL have no direct read or write grant on the stored settings.

#### Scenario: An admin who is not a site coordinator saves links
- **WHEN** a staff member with the Admin role who is not a site coordinator calls the links save
- **THEN** it is refused with `FORBIDDEN`, nothing changes, and no receipt is stored

#### Scenario: A preparer reads the settings
- **WHEN** a staff member with only the Preparer role calls the Season settings read
- **THEN** it is refused with `FORBIDDEN`

#### Scenario: A repeated save
- **WHEN** a site coordinator's links save is sent twice with the same action id
- **THEN** both answers are the same, and the revision went up once

#### Scenario: No direct access
- **WHEN** a signed-in site coordinator reads or writes the stored settings table directly
- **THEN** the read returns nothing or is refused, and the write is refused

### Requirement: Season settings holds the site hours and the coverage targets
Season settings SHALL have a "Site hours and coverage" card after the season card. The card SHALL be stored once per workspace and kept across seasons, with its own revision and its own Save.

**Site hours:**
- Seven weekday tiles, Monday to Sunday, each either closed or open.
- An open day has an open hour and a close hour, whole hours in America/New_York, with 0 ≤ open < close ≤ 24.
- The same week SHALL apply to every date. There are no one-off closures.
- A workspace whose site hours were never saved SHALL have every day closed.

**Coverage targets** (capability `volunteer-schedule`):
- preparers needed, reviewers needed, and greeters or intakers needed on site;
- each a whole number from 0 to 9;
- defaults 2, 1 and 1.

A site coordinator SHALL see the tiles, the hour pickers, the three number inputs and Save. Any other workspace admin SHALL see the same values as text, such as "Saturday · 10 am – 4 pm" and "Tuesday · Closed", with no inputs. The save SHALL be refused with `VALIDATION`, naming the field, for:
- an open day whose close hour is not after its open hour;
- an hour outside 0–24;
- a weekday key outside Monday to Sunday;
- a target outside 0–9 or not a whole number.

Changing site hours SHALL NOT change or remove any shift.

#### Scenario: Setting site hours
- **WHEN** a site coordinator opens Tuesday and Thursday from 5 pm to 8 pm and Saturday from 10 am to 4 pm, and presses Save
- **THEN** the card shows those hours with every other day closed, and the Schedule shows three columns on Tuesdays and six on Saturdays

#### Scenario: A close hour before the open hour
- **WHEN** a site coordinator sets Saturday to open at 4 pm and close at 10 am, and presses Save
- **THEN** the save is refused naming Saturday's hours, and nothing changes

#### Scenario: The defaults
- **WHEN** an admin opens Season settings in a workspace that never saved this card
- **THEN** every day reads Closed, and the targets read 2 preparers, 1 reviewer and 1 on site

#### Scenario: An admin who is not a site coordinator
- **WHEN** a staff member with the Admin role who is not a site coordinator opens Season settings
- **THEN** the site hours and targets are shown as text with no inputs and no Save for the card

### Requirement: Only site coordinators write the site hours and coverage targets
The Season settings read SHALL include the site hours, the targets and their revision for every workspace admin. The schedule settings save SHALL be allowed only for a site coordinator. Anyone else SHALL be refused with `FORBIDDEN` before any other check, and the refusal SHALL write nothing and store no receipt. The save SHALL take an action id, and a repeated request with the same action id SHALL return the stored result and write nothing more. It SHALL be sent at the revision the page read. A stale revision SHALL be refused with `CONFLICT`, and with no row the revision is 0.

Signed-in users SHALL have no direct write grant on the stored schedule settings. Schedule viewers (capability `volunteer-schedule`) SHALL be able to read the row only so that realtime can deliver its changes.

#### Scenario: An admin who is not a site coordinator saves
- **WHEN** a staff member with the Admin role who is not a site coordinator calls the schedule settings save
- **THEN** it is refused with `FORBIDDEN`, nothing changes, and no receipt is stored

#### Scenario: Two site coordinators save
- **WHEN** two site coordinators open Season settings at the same revision, and both change Saturday's hours and press Save
- **THEN** the second is refused with `CONFLICT`, and the card shows the first one's hours after it re-reads

#### Scenario: A repeated save
- **WHEN** a site coordinator's schedule settings save is sent twice with the same action id
- **THEN** both answers are the same, and the revision went up once

#### Scenario: No direct write
- **WHEN** a signed-in site coordinator writes the stored schedule settings table directly
- **THEN** the write is refused
