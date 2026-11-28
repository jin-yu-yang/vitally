# Season Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A site coordinator downloads one ZIP of CSVs of the current season from Season settings. Each export is recorded and shown to workspace admins as "Last export".

**Architecture:**
- **Database.** One `security definer` RPC, `vitally_export_season()` (migration 062), checks the caller, then builds the whole season answer as one `jsonb` in a single statement, records it in `season_exports`, and returns it.
- **Browser.** A pure module, `src/season-export.mjs`, turns that answer into eight CSVs (with `toCsv`) and a `README.txt`, packs them into a stored ZIP, and the app downloads it as the Roster CSV does.
- **The read.** `vitally_season_settings()` gains `lastExport`.

**Tech Stack:** Postgres/Supabase SQL migrations, plain ES modules in the browser, `node:test`, and Playwright (`tests/browser.mjs`).

**Spec:** `openspec/changes/add-season-export/specs/season-export/spec.md`, `openspec/changes/add-season-export/specs/season-settings/spec.md`, `openspec/changes/add-season-export/design.md` (D1–D8).

## Global Constraints

- The migration is `supabase/migrations/062_season_export.sql`, after merging `main`. Never edit an applied migration.
- No new dependency. No zip library, and no `CompressionStream`.
- Staff screens stay English. There is no client text, so no `build:hant`.
- Fictional data only in tests and fixtures.
- CSV rules: UTF-8 with a BOM, CR LF line endings, quoting, and a `'` formula guard. Always use `toCsv` from `src/csv.mjs`, never a second encoder.
- Times are `YYYY-MM-DD HH:MM` in `America/New_York`. The file name is `vitally-<season>-export-<YYYY-MM-DD>.zip` with the New York date.
- `vitally_export_season` takes no arguments and stores no action receipt (D2). Its `FORBIDDEN` (`VT001`) check comes first and records nothing.
- Only the current season. A case is exported when `workspace_id` matches, `season = workspaces.current_season`, and `client_number is not null`.
- Explicit field lists everywhere. No `to_jsonb(row.*)` and no `select *` into the answer.
- Exact copy:
  - card title "Season export";
  - "One ZIP of CSVs for PCDC's archive.";
  - "Last export: <name> · <Mon D, h:mm am/pm>";
  - "No export yet this season.";
  - button "Export this season…";
  - dialog title "Export the <season> season";
  - "Download ZIP", "Preparing…", "Cancel";
  - toast "Season exported";
  - warning "Messages, notes and call log entries are exported as staff and clients wrote them. Notes must not hold amounts or ID numbers."

## Review Focus

1. **A case whose `answers` has keys the catalogue doesn't know**, or values of the wrong type: the export must still build. Unknown keys are skipped, and odd values are written with `String(value)`. Test in Task 3.
2. **A season with zero cases:** every CSV must still have its header row, and the ZIP must still open. Tests in Tasks 2 and 3.
3. **Text with CR LF, quotes, commas or a leading `-`** in notes, titles or names: it must round-trip through the CSV. Test in Task 3 (a call log note of `-5` gives `'-5`).
4. **A follow-up or help request whose assignee is null**, or a contact attempt with no note: the cell is empty, never "null" or "undefined". Test in Task 3.
5. **A non-ASCII file name or text in the ZIP:** UTF-8 flag bit 11 is set, and the CRC is over the UTF-8 bytes. Test in Task 2.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/062_season_export.sql` (create) | the `season_exports` table, `vitally_export_season()`, and `vitally_season_settings()` replaced with `lastExport` |
| `tests/database-season-export.mjs` (create) | database tests for the RPC and `lastExport` |
| `tests/database-season-settings.mjs` (modify) | add `lastExport` to `READ_KEYS` |
| `src/zip.mjs` (create) | `crc32` and `zipStored` only |
| `tests/zip.test.mjs` (create) | ZIP round-trip parser and tests |
| `src/season-export.mjs` (create) | CSV builders, the README, the file name, `seasonExportFiles(answer, now)` |
| `tests/season-export.test.mjs` (create) | per-file CSV tests and the sensitive-field guard |
| `src/supabase-store.mjs` (modify) | `exportSeason()` |
| `src/season-settings-views.mjs` (modify) | the Season export card and `exportSeasonDialogBody` |
| `tests/season-settings-views.test.mjs` (modify) | card and dialog tests |
| `src/controller.mjs` (modify) | `exportSeason()` and the dialog state |
| `src/app.mjs` (modify) | actions `open-export-season` and `export-season`, and the download |
| `src/styles.css` (modify, only if needed) | the card |
| `tests/browser.mjs` (modify) | a standalone test, "A site coordinator exports the season" |

---

### Task 1: Migration 062 and database tests

**Files:**
- Create: `supabase/migrations/062_season_export.sql`
- Create: `tests/database-season-export.mjs`
- Modify: `tests/database-season-settings.mjs:63` (`READ_KEYS` gains `"lastExport"`)

**Interfaces:**
- Produces:
  - **RPC `public.vitally_export_season()`**, which returns `jsonb`:
    ```
    { season: int, exportedAt: timestamptz text, exportedByName: text,
      cases: [{id, clientNumber, reference, origin, stage, closingReason, submittedAt,
               preparerName, reviewerName, intakeVersion, answers}],
      events: [{caseId, createdAt, action, actorName, detail}],
      clientEvents: [{caseId, createdAt, message}],
      documentRequests: [{caseId, createdAt, title, message, status, requestedByName}],
      followups: [{caseId, reason, assigneeName, status, resolutionOutcome, resolutionNote, createdAt, resolvedAt}],
      contactLog: [{caseId, contactedAt, direction, withWhom, otherName, method, purpose, outcome, note, loggedByName}],
      contactAttempts: [{caseId, createdAt, outcome, note, actorName}],
      helpRequests: [{caseId, title, status, assigneeName, language, contactPreference, resolutionNote, createdAt}] }
    ```
    Every array is ordered as in the spec's table: cases by client number, and the others by time, then `id`.
  - **The read.** `vitally_season_settings()` gains `lastExport: {name, exportedAt} | null`.
  - **The table.** `public.season_exports(id uuid pk, workspace_id uuid fk, season smallint not null, exported_by_person_id uuid not null, exported_at timestamptz not null default now(), row_counts jsonb not null check (jsonb_typeof(row_counts)='object'))`. The foreign key `(workspace_id, exported_by_person_id)` references `people`. RLS is on, with `revoke all … from public,anon,authenticated` as in 055 §4, and an index on `(workspace_id, season, exported_at desc)`.

- [ ] **Step 1: Merge `main` and check the number.** Run `git merge main`, then `ls supabase/migrations | tail -3`. Expected: the last file is `061_admin_role_after_receipt.sql`. If it is higher, use the next number throughout this plan.

- [ ] **Step 2: Write the failing database tests** in `tests/database-season-export.mjs`. Follow `tests/database-season-settings.mjs`: one `createDatabaseFixture()`, a non-coordinator admin from `f.staff({key:"nadia_export", name:"Nadia Brennan", capabilities:["admin","assist","followup","receive_documents"]})`, and `FORBIDDEN = "VT001"`. Each sub-test:
  - **`refusal: an admin who is not a site coordinator`:**
    - `nadia.rpc("vitally_export_season")` gives error code `VT001`, and `data` is null;
    - `select count(*) from season_exports where workspace_id=$1` is unchanged.
  - **`refusal: a preparer and a client`:** the same for `f.preparer` and a client from `f.draftCase`'s owner.
  - **`only the current season's submitted cases`:**
    - set up `f.submittedClientCase()` twice and one `f.draftCase(...)`;
    - insert one case row moved to `season = current_season - 1` via SQL (copy the pattern in `tests/database-past-season.mjs`);
    - `answer.cases.map(c => c.id)` equals exactly the two submitted ids, in client-number order.
  - **`help requests on season cases and with no case`:**
    - insert three `assistance_items`: one on a season case, one with `case_id null`, and one on the past-season case;
    - `answer.helpRequests` has the first two only. The no-case one has `caseId === null`.
  - **`one record per call, with counts`:**
    - call twice;
    - two rows for the season;
    - `row_counts` of the latest equals `{"cases.csv": answer.cases.length, "status-history.csv": answer.events.length, "messages.csv": answer.documentRequests.length + answer.clientEvents.length, "follow-ups.csv": …, "call-log.csv": contactLog + contactAttempts, "help-requests.csv": …}`. `intake-answers.csv` and `household-members.csv` are counted by the browser, so the database stores only these six.
  - **`the answer names, never ids, for people`:**
    - `answer.exportedByName === "Avery Lin"`;
    - every `cases[i]` has exactly the keys listed in Interfaces;
    - `JSON.stringify(answer)` contains no `site_number` value (`TEST_SITE_NUMBER`).
  - **`lastExport is the latest of the current season`:**
    - after two exports, `read().lastExport.exportedAt` equals the latest row's `exported_at`, and `.name === "Avery Lin"`;
    - after `update season_exports set season=season-1` for this workspace, `lastExport === null`.
  - **`no direct access`:** `sc.from("season_exports").select()` returns `[]` or an error, and `sc.from("season_exports").insert({...})` is an error.

- [ ] **Step 3: Run to see them fail.** Run `npm run db:migrate:test`, then `node --env-file=.env.test --test tests/database-season-export.mjs`. Expected: FAIL with "Could not find the function public.vitally_export_season".

- [ ] **Step 4: Write `062_season_export.sql`.**
  - **Header comment:** what it adds, design D1–D4, no receipt (D2).
  - **§1:** the table.
  - **§2:** `create function public.vitally_export_season() returns jsonb language plpgsql security definer set search_path=''`.
    - The caller check copies 058's `vitally_save_schedule_settings` opening: `require_membership`, `acting_person`, `access='staff'`, and `vitally_private.is_site_coordinator(workspace, person)`. Otherwise `raise sqlstate 'VT001' using message='FORBIDDEN'`.
    - It builds the answer in **one** `select jsonb_build_object(...)` with a CTE `c` of the season's cases. `submittedAt` is `(select min(created_at) from case_events where case_id=c.id and action='SUBMIT')`, and names come from joins to `people`.
    - It inserts the record with `row_counts` computed from `jsonb_array_length` of that answer, then returns the answer with `exportedAt` and `exportedByName`.
    - `revoke all … ; grant execute … to authenticated;`.
  - **§3:** `create or replace function public.vitally_season_settings()`, 058's body verbatim plus `'lastExport', (select jsonb_build_object('name',p.name,'exportedAt',e.exported_at) from public.season_exports e join public.people p on p.workspace_id=e.workspace_id and p.id=e.exported_by_person_id join public.workspaces w on w.id=e.workspace_id where e.workspace_id=v_workspace and e.season=w.current_season order by e.exported_at desc, e.id desc limit 1)`. It keeps 058's revoke and grant lines.

- [ ] **Step 5: Add `"lastExport"` to `READ_KEYS`** in `tests/database-season-settings.mjs:63`.

- [ ] **Step 6: Run the tests.** Run `npm run db:migrate:test`, then `node --env-file=.env.test --test tests/database-season-export.mjs tests/database-season-settings.mjs tests/database-start-next-season.mjs`. Expected: all PASS.

- [ ] **Step 7: Commit.**
```bash
git add supabase/migrations/062_season_export.sql tests/database-season-export.mjs tests/database-season-settings.mjs
git commit -m "Season export: the export RPC, its record and Last export in the read (#256)"
```

---

### Task 2: The stored ZIP writer

**Files:**
- Create: `src/zip.mjs`
- Test: `tests/zip.test.mjs`

**Interfaces:**
- Produces:
  - `crc32(bytes: Uint8Array) => number`, unsigned;
  - `zipStored(files: Array<{name: string, text: string}>, date: Date) => Uint8Array`.

- [ ] **Step 1: Write the failing tests** in `tests/zip.test.mjs`. Include a small `readZip(bytes)` that walks the end-of-central-directory record, then the central directory, then the local headers, and returns `[{name, method, flags, crc, data}]`.
  - **`crc32 of "123456789" is 0xCBF43926`:** `assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926)`.
  - **`round-trips names, order and contents`:** zip `[{name:"README.txt",text:"hi\r\n"},{name:"cases.csv",text:"﻿a,b\r\n"}]`. Read it back: names in order, every `method === 0`, `crc === crc32(data)`, and decoded text equals the input.
  - **`UTF-8 names set flag bit 11`:** a file named `李小明.csv` reads back with the same name and `(flags & 0x0800) !== 0`.
  - **`an empty file`:** `{name:"x.csv", text:""}` reads back with zero-length data and crc 0.
  - **`starts with PK\x03\x04 and ends with the end record`:** check the first 4 bytes are `50 4b 03 04`, and that `50 4b 05 06` is at `length - 22`.

- [ ] **Step 2: Run to see them fail.** Run `node --test tests/zip.test.mjs`. Expected: FAIL, cannot find module `../src/zip.mjs`.

- [ ] **Step 3: Implement `src/zip.mjs`.**
  - CRC-32 uses the standard reflected polynomial `0xEDB88320` with a 256-entry table built once.
  - For each file: a local header (signature `0x04034b50`, version 20, flags `0x0800`, method 0, DOS time and date from `date` in local fields, crc, sizes, name length, extra 0), then the name and data.
  - Then a central directory entry per file (`0x02014b50`, with the local header's offset), then the end record (`0x06054b50`, the counts, the directory size and offset, comment length 0).
  - Write with `DataView`, little-endian.

- [ ] **Step 4: Run the tests.** Run `node --test tests/zip.test.mjs`. Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add src/zip.mjs tests/zip.test.mjs
git commit -m "Season export: a stored ZIP writer with CRC-32 (#256)"
```

---

### Task 3: The CSVs, README and file name

**Files:**
- Create: `src/season-export.mjs`
- Test: `tests/season-export.test.mjs`

**Interfaces:**
- Consumes:
  - `toCsv(header, rows)` from `src/csv.mjs`;
  - `zipStored` from `src/zip.mjs`;
  - `CATALOGUE`, `findQuestion`, `visibleAnswers`, `wording`, `memberNameParts` from `src/intake-catalogue.mjs`;
  - the staff label helpers the case page already uses for stage, closing reason and contact-log codes (find them with `grep -n "export const .*[Ll]abel" src/*.mjs`, and use the raw code where none exists);
  - the RPC answer shape from Task 1.
- Produces:
  - `EXPORT_FILES: string[]`: the eight CSV names in spec order;
  - `seasonExportFilename(season: number, now: Date) => string`;
  - `seasonExportCsvs(answer) => Array<{name: string, text: string, rows: number}>`, the eight CSVs in order;
  - `seasonExportReadme(answer, csvs) => string`;
  - `seasonExportZip(answer, now: Date) => {filename: string, bytes: Uint8Array}`.

- [ ] **Step 1: Write the failing tests** in `tests/season-export.test.mjs`. Use a fictional `answer` fixture built in the test file: season 2026, two cases (client numbers 1 and 2), one with a Chinese first name `小明`, one multi-select answer, and two household rows. Read a cell with a small `parse(text)` that strips the BOM and splits CR LF lines and quoted cells, as `csvCells` does in `tests/browser.mjs`.
  - **`seasonExportFilename`:** `seasonExportFilename(2026, new Date("2026-11-27T15:00:00Z")) === "vitally-2026-export-2026-11-27.zip"`, and `new Date("2026-11-28T03:00:00Z")` gives `2026-11-27`, because that is still Nov 27 in New York.
  - **`eight files in order with their headers`:**
    - `seasonExportCsvs(answer).map(f => f.name)` deep-equals `EXPORT_FILES`, which is `["cases.csv","intake-answers.csv","household-members.csv","status-history.csv","messages.csv","follow-ups.csv","call-log.csv","help-requests.csv"]`;
    - the header of `cases.csv` is `["Client Number","Reference","Origin","Stage","Closing Reason","Submitted At","Preparer","Reviewer"]`;
    - the headers of `intake-answers.csv`, `status-history.csv`, `messages.csv`, `follow-ups.csv`, `call-log.csv` and `help-requests.csv` are exactly the spec table's columns;
    - `household-members.csv` starts with `["Client Number","Reference","Member"]`.
  - **`every file has the BOM and CR LF`:** each `text.startsWith("﻿")` and `text.endsWith("\r\n")`.
  - **`times are New York`:** an event at `2026-11-27T20:05:00Z` gives Time `2026-11-27 15:05`.
  - **`visible answers only, in English, multi-select joined`:**
    - a value for a question hidden by `showIf` has no row;
    - the multi-select row's Answer is both English option labels joined by `"; "`;
    - the Question cell equals `wording(question, {lang:"en", answers})`.
  - **`unknown answer keys are skipped`:** the answer `{no_such_question:"x"}` gives no row and no throw (Review Focus 1).
  - **`household rows`:** two rows for case 1, with Member `1` and `2`.
  - **`messages of both kinds`:** a document request row has Kind `Document request` and From is the requester's name. A client event row has Kind `Client history`, From `PCDC`, and an empty Title and Status. Rows are ordered by time.
  - **`call log merges both sources`:** the `contactLog` and `contactAttempts` rows are sorted by time. A note `-5` gives the cell `'-5` (Review Focus 3).
  - **`null people and notes give empty cells`:** a follow-up with `assigneeName: null` has an empty Assignee, never `"null"` (Review Focus 4).
  - **`help request with no case`:** `caseId: null` gives an empty Client Number.
  - **`an empty season`:** with every array empty, each CSV is its header row only and `rows === 0`, and `seasonExportZip` still returns bytes starting `PK` (Review Focus 2).
  - **`README`:** it contains `2026`, the exporter's name, the New York time, one line per CSV as `"<name>: <rows> rows"`, the exact warning sentence, and "not re-imported". Lines end with CR LF.
  - **`no SSN, ITIN, routing or account-number question in the catalogue`:** for every question in `CATALOGUE`, neither its id nor its English wording matches `/\b(ssn|itin|social security number|routing( number)?|account number|acct)\b/i`. Phrases that only name a document card, such as "SSN / ITIN card", are allowed by listing their ids in an `ALLOWED` set in the test. Each id in that set gets a comment saying it only names the document.

- [ ] **Step 2: Run to see them fail.** Run `node --test tests/season-export.test.mjs`. Expected: FAIL, cannot find module.

- [ ] **Step 3: Implement `src/season-export.mjs`.**
  - Map `caseId` to `{clientNumber, reference}` from `answer.cases`.
  - One `Intl.DateTimeFormat("en-CA", {timeZone:"America/New_York", year/month/day/hour/minute, hourCycle:"h23"})` formatter gives `YYYY-MM-DD HH:MM`.
  - Every cell goes through `cell(v) => v == null ? "" : v`.
  - The household columns are the catalogue questions whose id matches `^household1` (the member fields), listed in catalogue order, with each row's value read from `household<n><rest>`. The rows shown are `memberCount` as the form counts them (see `vitally_private.household_rows` in 050 and its browser twin; grep `householdRows`).
  - `seasonExportZip` puts the README first, then the CSVs, and uses `zipStored(files, now)`.

- [ ] **Step 4: Run the tests.** Run `node --test tests/season-export.test.mjs tests/zip.test.mjs`. Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add src/season-export.mjs tests/season-export.test.mjs
git commit -m "Season export: the eight CSVs, README and file name (#256)"
```

---

### Task 4: Store, card, dialog, controller and download

**Files:**
- Modify: `src/supabase-store.mjs` (after `startNextSeason`, around line 1078)
- Modify: `src/season-settings-views.mjs` (a new `exportCard`, inserted in `renderSeasonSettings` at line 312, between `siteHoursCard` and `nextSeasonCard`, plus `exportSeasonDialogBody`)
- Modify: `src/controller.mjs` (`exportSeason`, exported next to `startNextSeason` at line 6189; `freshSettingsUi` stays as it is)
- Modify: `src/app.mjs` (the dialog wiring next to the start-season dialog at line 1601, and the click actions next to `download-shaded-copy` at line 2862)
- Test: `tests/season-settings-views.test.mjs`

**Interfaces:**
- Consumes: `seasonExportZip(answer, now)` (Task 3), and RPC `vitally_export_season` (Task 1).
- Produces:
  - `store.exportSeason() => Promise<answer>`;
  - `controller.exportSeason() => Promise<{filename, bytes} | null>`;
  - `exportSeasonDialogBody({season, busy})`;
  - `lastExportLine(lastExport) => string`;
  - dialog id `"export-season"`, actions `open-export-season` and `export-season`.

- [ ] **Step 1: Write the failing view tests** in `tests/season-settings-views.test.mjs`:
  - **`the Season export card for a site coordinator`:** `renderSeasonSettings({...view, lastExport:null}, {canEdit:true})` contains `Season export`, `No export yet this season.`, and `data-action="open-export-season"`. Its index is after `site-hours-title` and before `next-season-title`.
  - **`another admin sees the line and no button`:** with `lastExport:{name:"Dana Wu", exportedAt:"2026-11-27T20:05:00Z"}` and `canEdit:false`, the output contains `Last export: Dana Wu · Nov 27, 3:05 pm` and no `open-export-season`.
  - **`a missing lastExport reads as none`:** a view without the key shows `No export yet this season.`
  - **`the dialog`:** `exportSeasonDialogBody({season:2026})` contains `Export the 2026 season`, the exact warning sentence, `Roster → Export CSV`, `rebuilt from the answers`, `Cancel`, and `Download ZIP`. With `busy:true` the submit is `disabled` and reads `Preparing…`.

- [ ] **Step 2: Run to see them fail.** Run `node --test tests/season-settings-views.test.mjs`. Expected: FAIL.

- [ ] **Step 3: Implement the views.**
  - `lastExportLine` formats with `Intl.DateTimeFormat("en-US", {timeZone:"America/New_York", month:"short", day:"numeric", hour:"numeric", minute:"2-digit"})`, then lower-cases AM and PM and drops the comma before the time, giving `Nov 27, 3:05 pm`.
  - The card follows the markup of `nextSeasonCard` (`section.panel.settings-card`, `card-head`, `aria-labelledby="season-export-title"`).

- [ ] **Step 4: Implement the store and controller.**
  - **Store.** `async exportSeason() { return await call("vitally_export_season"); }`.
  - **Controller.** `exportSeason()` returns null when it is busy, not on Season settings, or already exporting. It then sets `state.seasonSettingsUi.exportBusy = true` and redraws.
    - **On success.** It calls `store.exportSeason()` and builds `seasonExportZip(answer, new Date())`. It sets `state.seasonSettings = {...state.seasonSettings, lastExport:{name:answer.exportedByName, exportedAt:answer.exportedAt}}`, closes the dialog, and returns the file.
    - **On `FORBIDDEN`.** It closes the dialog and re-reads Season settings, as the existing `settingsWrite` refusals do.
    - **On any other error.** It keeps the dialog, sets the usual error notice, and returns null.
    - **In `finally`.** It sets `exportBusy = false`.
  - **App.**
    - `open-export-season` sets the dialog to `"export-season"`.
    - `export-season` awaits `controller.exportSeason()`. When it gets a file, it downloads it with the Roster pattern (`new Blob([bytes], {type:"application/zip"})`, a hidden `<a download=filename>`, `revokeObjectURL` after 60 s), then calls `notify("success", "Season exported", by)` and returns focus to `[data-action="open-export-season"]`.

- [ ] **Step 5: Run the unit suite.** Run `npm test`. Expected: PASS. If an existing view test pins the Season settings card list or order, update it to include the new card.

- [ ] **Step 6: Commit.**
```bash
git add src/supabase-store.mjs src/season-settings-views.mjs src/controller.mjs src/app.mjs src/styles.css tests/season-settings-views.test.mjs
git commit -m "Season export: the Season export card, dialog and download (#256)"
```

---

### Task 5: Browser test

**Files:**
- Modify: `tests/browser.mjs`. Add a standalone `test("A site coordinator exports the season", {timeout:300_000}, …)` right after "A site coordinator changes Season settings" (line ~9873). Model it on that test and on the Roster CSV download at line 9842.

**Interfaces:**
- Consumes: the actions `open-export-season` and `export-season` (Task 4), the button text "Download ZIP", the toast "Season exported", and `readZip` (copy it from `tests/zip.test.mjs` into a tiny helper, or import it if Task 2 exported it from a `tests/support/` file).

- [ ] **Step 1: Write the test.** Chrome only, on its own fixture, with one submitted fictional case.
  1. The Site Coordinator opens Season settings and sees "No export yet this season.".
  2. They click `open-export-season`, and the dialog heading is "Export the <season> season".
  3. They wait for `page.waitForEvent("download")`, then click "Download ZIP".
  4. `download.suggestedFilename()` matches `/^vitally-\d{4}-export-\d{4}-\d{2}-\d{2}\.zip$/`.
  5. Reading the file back with `readZip` gives the names `["README.txt", ...EXPORT_FILES]`. `cases.csv` starts with the BOM, and has one data row with the case's client number.
  6. The toast "Season exported" shows. The card reads `Last export: Avery Lin · ` followed by a time.
  7. A second window, signed in as a non-coordinator admin created as in `tests/database-season-settings.mjs:66`, opens Season settings. It sees the same Last export line and no `open-export-season`.
  8. `assertConsoleQuiet` for both windows.

- [ ] **Step 2: Run it.** Run `node --env-file=.env.test --test --test-name-pattern="exports the season" tests/browser.mjs`. Expected: PASS.

- [ ] **Step 3: Run the full checks.**
  - `npm test`: PASS.
  - `npm run db:migrate:test`, then `npm run test:database`: PASS.
  - `npm run test:browser`: PASS, about 20–25 minutes.
  - `npx openspec validate --all`: valid.

- [ ] **Step 4: Commit.**
```bash
git add tests/browser.mjs
git commit -m "Season export: browser test of the export and the Last export line (#256)"
```
