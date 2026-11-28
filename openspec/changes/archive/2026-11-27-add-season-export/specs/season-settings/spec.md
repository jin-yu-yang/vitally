## ADDED Requirements

### Requirement: Season settings has a Season export card with the last export
Season settings SHALL have a "Season export" card between the season card and the "Next season" card. It SHALL show:
- the current season;
- "One ZIP of CSVs for PCDC's archive.";
- one line: "Last export: <name> · <Mon D, h:mm am/pm>" (New York time) for the latest export of the current season (capability `season-export`), or "No export yet this season." when there is none.

Every workspace admin SHALL see the card and the line. A site coordinator SHALL also see "Export this season…". Any other workspace admin SHALL see no button.

#### Scenario: A site coordinator before any export
- **WHEN** a site coordinator opens Season settings in a season with no export
- **THEN** the Season export card says "No export yet this season." and offers "Export this season…"

#### Scenario: An admin who is not a site coordinator
- **WHEN** site coordinator Dana Wu exported at 3:05 pm on Nov 27, and an Admin who is not a site coordinator then opens Season settings
- **THEN** the card reads "Last export: Dana Wu · Nov 27, 3:05 pm" and has no button

#### Scenario: After the next season starts
- **WHEN** a season was exported, and a site coordinator then starts the next season
- **THEN** Season settings shows "No export yet this season." for the new season

### Requirement: The Season settings read carries the current season's last export
The Season settings read SHALL return `lastExport` to every workspace admin: the name of the person and the time of the latest recorded export whose season is the workspace's current season, or null when there is none. It SHALL return no other export data. A refused read SHALL return nothing, as today.

#### Scenario: The latest of two
- **WHEN** a site coordinator exported the current season at 10:00 and again at 11:00
- **THEN** the read's `lastExport` has the 11:00 time

#### Scenario: Only the current season
- **WHEN** the only export recorded is of the season before
- **THEN** the read's `lastExport` is null
