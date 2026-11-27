## 1. Database (migration 062)

- [x] 1.1 Merge `main` and confirm `062` is the next free migration number
- [x] 1.2 Add `season_exports` (RLS on, no grants to signed-in users, index on workspace, season, time) in `supabase/migrations/062_season_export.sql`
- [x] 1.3 Add `public.vitally_export_season()`: `FORBIDDEN` first for anyone not an active site coordinator; one-snapshot answer of the current season's cases, events, client events, document requests, follow-ups, contact log, contact attempts and help requests (named fields only); insert one record with row counts
- [x] 1.4 Replace `public.vitally_season_settings()` with 058's body plus `lastExport` for the current season
- [x] 1.5 Database tests (`tests/database-season-export.mjs`): refusals record nothing; only current-season submitted cases; help requests with no case; one record per call with counts; `lastExport` latest-of-current-season and null after Start next season; no direct table access

## 2. Export files in the browser (`src/season-export.mjs`)

- [x] 2.1 `zipStored(files, date)`: stored entries, CRC-32, UTF-8 names; unit test parses it back and checks names, order and CRCs
- [x] 2.2 CSV builders for the eight files from the RPC answer with the spec's columns, New York times and English labels, using `toCsv`; unit tests per file, including visible answers only, multi-select joining, household rows, messages of both kinds, help request with no case, empty files
- [x] 2.3 `README.txt` builder and `seasonExportFilename(season, now)`; unit tests
- [x] 2.4 Sensitive-field guard test over the catalogue (SSN, ITIN, routing, account number)

## 3. Season settings page

- [x] 3.1 Store: call `vitally_export_season` and map `lastExport` from the Season settings read
- [x] 3.2 View: the Season export card (Last export line, button for site coordinators only) and the dialog with included / not-included lists, warning, Cancel and Download ZIP / Preparing…
- [x] 3.3 Controller and app: open / cancel the dialog, run the export, download the ZIP, say "Season exported", update the Last export line, re-read on `FORBIDDEN`
- [x] 3.4 View unit tests for the card and dialog for a site coordinator and another admin
- [x] 3.5 Browser test: a site coordinator exports, the download's name and entries are checked, and another admin sees the Last export line with no button

## 4. Checks

- [ ] 4.1 `npm test`
- [ ] 4.2 `npm run db:migrate:test`, then `npm run test:database`
- [ ] 4.3 `npm run test:browser`
- [ ] 4.4 `npx openspec validate --all`
