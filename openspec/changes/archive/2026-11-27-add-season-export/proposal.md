## Why

PCDC wants to see that its data can leave ViTally. The agreed season flow (decided Nov 21, #256 and #161) is:

1. A site coordinator exports the season's data.
2. PCDC keeps the file in SharePoint.
3. ViTally deletes the old season later.

There is no export today. #161's "Delete last season's data" also needs a record of who exported and when, so it can refuse a delete that no export covers. The pilot needs this before Dec 21.

## What Changes

**New: export the current season (Season settings).**
- **The card.** A new "Season export" card on Season settings, before "Next season".
  - Every workspace admin sees "Last export: <name> · <time>", or "No export yet this season."
  - Only a site coordinator gets "Export this season…".
- **The dialog.**
  - It lists what is and isn't included.
  - It warns that messages, notes and the call log are exported as written.
  - It downloads `vitally-<season>-export-<YYYY-MM-DD>.zip`. Open work doesn't stop the export.
- **The ZIP's files.**
  - Eight CSVs: `cases`, `intake-answers`, `household-members`, `status-history`, `messages`, `follow-ups`, `call-log` and `help-requests`.
  - A `README.txt`.
- **What the files hold.**
  - Current-season submitted cases only; drafts are excluded.
  - Help requests on those cases, plus every help request with no case.
  - Not included: the roster and certificates (the Roster CSV covers them), and the 13614-C PDFs.
- **The CSV format.** The files use the Roster CSV's rules: UTF-8 with a BOM, CR LF line endings, quoting and formula guarding.
- **Sensitive fields.** Bank account and routing numbers are never exported, and an SSN or ITIN would keep only its last four digits. ViTally stores none of them today, and a test keeps it that way until a masking rule is written.

**New: the export RPC and its record.**
- `vitally_export_season()` is for active site coordinators only; anyone else gets `FORBIDDEN`.
- In one transaction, it records the export (season, person, time, row counts) in a new table, `season_exports`, and returns the rows. The browser builds the CSVs and an uncompressed ZIP. No new library is added.

**Season settings read**
- From: the read returns the links, SIDN status, schedule and site coordinators.
- To: it also returns `lastExport` (name and time) for the current season.
- Reason: the card's "Last export" line. #161 also relies on the same record.
- Impact: non-breaking. A field is added.

## Capabilities

### New Capabilities
- `season-export`: who can export, what the ZIP and each CSV contain, the CSV and ZIP format, the sensitive-field rule, and recording each export.

### Modified Capabilities
- `season-settings`: the page gains the Season export card, and the Season settings read gains the current season's last export.

## Impact

- **Database:**
  - migration `062_season_export.sql`: the `season_exports` table, `public.vitally_export_season()`, and `public.vitally_season_settings()` replaced to add `lastExport`.
- **Browser:**
  - a new `src/season-export.mjs`, which builds the CSVs and the stored ZIP with CRC-32, and reuses `src/csv.mjs` and the catalogue helpers;
  - `src/season-settings-views.mjs`, for the card and dialog;
  - `src/app.mjs` and `src/controller.mjs`, for the action and the download;
  - `src/supabase-store.mjs`, for the RPC call;
  - `src/styles.css`, if the card needs it.
- **Tests:** unit tests (CSV, ZIP, columns, sensitive-field guard), database tests for the RPC and the read, and a browser test of the card and the download.
- **Not affected:** client screens and client text (staff screens stay English), realtime publications, and the Roster CSV.
- **Relates to:** #161 reads `season_exports`, and #138 owns the Roster CSV.
