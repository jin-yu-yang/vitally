## MODIFIED Requirements

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
