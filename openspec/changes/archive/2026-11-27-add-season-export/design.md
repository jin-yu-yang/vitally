## Context

**Today.**
- Season settings (`src/season-settings-views.mjs`, read by `public.vitally_season_settings()`, last replaced in 058) is open to every workspace admin.
- Only site coordinators (`vitally_private.is_site_coordinator`) change it.
- Its "Next season" card (055) already reminds: "Export this season's roster and cases first if you need them." No export exists yet.

**Where the season's data lives.**
- `cases`:
  - `season` and `client_number` are set at submission; drafts have neither;
  - `answers` (JSON keyed by catalogue question id) holds the intake answers, with household members as `household1…4*`;
  - `stage` and `closing_reason`;
  - `preparer_id` and `reviewer_id`, which point to `people`.
- `case_events`: the staff history. The first `SUBMIT` event gives the submission time.
- `client_events`: the client's history lines.
- `document_requests`: a staff title and message to the client.
- `admin_followups`: follow-ups.
- `contact_log`: the current version of each call-log entry; older versions are in `contact_log_versions`.
- `contact_attempts`: the older follow-up outcomes.
- `assistance_items`: help requests. `case_id` is nullable.

**Building blocks already in the browser.**
- `src/csv.mjs` (`toCsv`): the BOM, CR LF line endings, formula guard and quoting, written with #256 in mind.
- The Roster's download pattern (Blob and a hidden `<a download>`), with New York dates from `Intl.DateTimeFormat`.
- The catalogue helpers: `findQuestion`, `wording`, `visibleAnswers` and `memberNameParts`.

**Constraints.**
- Decided Nov 21 (Hailey): site coordinators only; any time; one ZIP of CSVs; no new library; the listed contents; the masking rule; each export recorded; no re-import.
- Migrations are hand-written and final. `062` is the next free number.
- Staff screens stay English.

## Goals / Non-Goals

**Goals:**
- A site coordinator downloads one ZIP of the current season's data in one press after a confirm dialog.
- The CSVs open correctly in Excel: Chinese text intact, formula injection guarded.
- Each export is recorded, so admins see "Last export", and #161 can check it later.
- No client data is ever returned to someone who isn't a site coordinator.

**Non-Goals:**
- Exporting past seasons (Q1 decided current only; see Open Questions).
- Re-import, scheduled or automatic exports, or uploading to SharePoint.
- The roster, certificates, 13614-C PDFs, filing attempts and returns, review questionnaires, exit forms and labels.
- Deleting anything (#161).
- Pushing a new "Last export" to other open windows over realtime.

## Decisions

### D1: One RPC records the export and returns the rows; the browser builds the files
- **Choice:**
  - `public.vitally_export_season()` takes no arguments. It is `security definer`, granted to `authenticated`.
  - It refuses with `FORBIDDEN` anyone who is not active staff with an acting person who is a site coordinator of the workspace. It checks this first and writes nothing on a refusal.
  - It then builds one `jsonb` answer for the workspace's current season in a single `select`, so all files share one snapshot.
  - It inserts one `season_exports` row with the row counts, and returns `{season, exportedAt, exportedByName, cases:[…], events:[…], clientEvents:[…], documentRequests:[…], followups:[…], contactLog:[…], contactAttempts:[…], helpRequests:[…]}`.
  - Each array element carries named fields only. No row is passed through whole.
- **Why:** it is one auth path, under the same RLS-free `security definer` discipline as the other Season settings RPCs. The browser already has the catalogue that turns answers into labelled rows. It is easy to test in Node and in the database suite.
- **Alternatives considered:**
  - An Edge Function building the ZIP: a new deploy surface, service-role access and Deno tests.
  - A second "record after save" RPC: two calls, and a record the client controls.

### D2: No action id or receipt
- **Choice:** the RPC takes no action id. Every successful call records one export.
- **Why:**
  - A receipt would have to store the whole answer, the season's data, in `action_receipts`.
  - A retry that records a second export is harmless: the later record is the truer one.
  - This breaks from the other Season settings saves on purpose, and the spec says so.
- **Alternative considered:** a receipt that stores only the record, with a replay that rebuilds the rows. A replay would then not return the stored result, which breaks the receipt contract.

### D3: The `season_exports` table
- **Choice:** columns `id`, `workspace_id`, `season smallint`, `exported_by_person_id`, `exported_at timestamptz default now()`, `row_counts jsonb` (an object of file name → integer, for the six files built straight from database rows; the intake answers and household files are derived in the browser and counted in `README.txt` only). RLS is on, with no grants to `anon` or `authenticated`. There is an index on `(workspace_id, season, exported_at desc)`.
- **Why:** #161 needs "the latest export of season S, and when". The counts let PCDC and #161 sanity-check a file without opening it.

### D4: The Season settings read gains `lastExport`
- **Choice:** replace `public.vitally_season_settings()`, keeping 058's body unchanged, and add `'lastExport', {name, exportedAt}` or `null`: the latest `season_exports` row whose season is the workspace's current season.
- **Why:** every admin sees the line. It resets to "No export yet this season." after Start next season, without touching 055.

### D5: Files and columns (built in `src/season-export.mjs`)
- **Choice:** eight CSVs in this order, each made with `toCsv`, with English Title Case headers:

  | File | Rows | Columns |
  |---|---|---|
  | `cases.csv` | the season's submitted cases, by client number | Client Number, Reference, Origin, Stage, Closing Reason, Submitted At, Preparer, Reviewer |
  | `intake-answers.csv` | each visible, answered question of each case, in catalogue order | Client Number, Reference, Question Id, Question, Answer |
  | `household-members.csv` | each household row the form shows (`household_rows`, 0–4) | Client Number, Reference, Member, then the member fields' questions as in the catalogue |
  | `status-history.csv` | `case_events`, by time | Client Number, Time, Action, By, Detail |
  | `messages.csv` | document requests and client history lines together, by time | Client Number, Time, Kind, From, Title, Message, Status |
  | `follow-ups.csv` | `admin_followups`, by opened time | Client Number, Reason, Assignee, Status, Outcome, Note, Opened, Resolved |
  | `call-log.csv` | `contact_log` (current versions) and `contact_attempts`, by time | Client Number, Contacted At, Direction, With Whom, Method, Purpose, Outcome, Note, Logged By |
  | `help-requests.csv` | `assistance_items` on season cases, plus every one with no case | Client Number, Title, Status, Assignee, Language, Contact Preference, Note, Created |

- **How cells are written:**
  - Times are `YYYY-MM-DD HH:MM` in America/New_York.
  - People are given by `people.name`.
  - Codes (stage, action, outcome and so on) use the staff label the screens already show where one exists, otherwise the raw code.
  - `Detail` is compact JSON.
  - Answers of option questions use the English option labels. Multi-select answers are joined with "; ".
  - Household answers appear in both `intake-answers.csv` and `household-members.csv`.
- **Why:** long-format answers don't change shape when the catalogue changes. A separate household file is readable for people.
- **Alternative considered:** wide answers (one column per question), which means hundreds of shifting columns.

### D6: A stored ZIP, hand-written
- **Choice:** `zipStored(files)` writes the local file headers, the central directory and the end record, with method 0 (stored), a CRC-32 from a 256-entry table, UTF-8 names (flag bit 11) and a DOS date from the export time. Files are given as `{name, text}` and encoded with `TextEncoder`. `README.txt` comes first.
- **Why:** no new library (the reason for ZIP over .xlsx), about 80 lines, deterministic, and checkable in Node by parsing it back and comparing CRCs.
- **Alternative considered:** `CompressionStream('deflate-raw')`. It's asynchronous, browser-dependent, and the files are small.

### D7: Sensitive fields
- **Choice:**
  - Every file is built from explicit column lists, and answers only from catalogue questions that `visibleAnswers` keeps.
  - A unit test fails if any catalogue question's id or English wording matches SSN, ITIN, routing number or account number.
  - A future change that adds such a field must add masking (last four digits for SSN or ITIN, never for bank fields) to pass it.
- **Why:** ViTally stores none of these today, so masking code now would be dead. The test makes the rule hold on the day one appears.

### D8: The page
- **Choice:**
  - A "Season export" card sits between the season card and "Next season". Its overline says the season, and it reads "One ZIP of CSVs for PCDC's archive." with the Last export line.
  - For a site coordinator it has "Export this season…", which opens the dialog "Export the <season> season". The dialog lists included and not-included data, shows the free-text warning, and has Cancel and Download ZIP.
  - While the call runs, Download ZIP is disabled and says "Preparing…".
  - On success the file downloads, the dialog closes, the page says "Season exported", and the card's Last export line shows the exporter's name and time from the answer.
  - On `FORBIDDEN` the page reads Season settings again. Another error keeps the dialog open with the usual error notice.
- **Why:** it follows the "Start next season…" dialog's pattern on the same page.

## Risks / Trade-offs

- **[Risk]** The record claims an export whose download then failed or was cancelled. → **Mitigation:** the site coordinator can export again at any time. #161 compares against the latest record. Accepted (Q2).
- **[Risk]** Free text (messages, notes, call log) may hold sensitive values. → **Mitigation:** the dialog's warning, and the staff rule that notes hold no amounts or ID numbers. It can't be masked automatically.
- **[Risk]** A large season makes a large JSON answer. → **Mitigation:** none needed for a classroom-sized workspace. Noted for production.
- **[Trade-off]** No receipt (D2): a lost reply followed by a retry records two exports. → Accepted; both are true.
- **[Trade-off]** Other open Season settings windows show the old Last export until they read again. → Accepted; no realtime table is added.

## Migration Plan

1. Merge `main`, then add `supabase/migrations/062_season_export.sql`: the table, the RPC, and the replaced Season settings read.
2. Run `npm run db:migrate:test` on a stack that already has `main`'s migrations, then `npm run test:database`.
3. Deploying applies 062. It changes no existing rows.
4. Rollback: a later migration drops the RPC and table and restores 058's read. The browser treats a missing `lastExport` as "No export yet this season."

## Open Questions

- **Exporting last season after Start next season.** Owner: #161. It affects #161's "export taken after the last change" check: after a start, the previous season can't be exported again with this change. #161 decides whether to rely on an export taken before the start, add a reminder, or widen the export in its own change.
