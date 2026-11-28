# Brainstorm: add-season-export (#256)

Raw capture of the design agreed in conversation on 2026-11-27 with codychi2006.

## Background

PCDC wants to see that its data can leave ViTally. The agreed season flow (decided Nov 21 with Hailey, recorded in #256 and #161) is:

1. A site coordinator exports the season's data from Season settings.
2. PCDC keeps the file in SharePoint.
3. ViTally deletes the old season later (#161).

There is no export yet.

Fixed by the Nov 21 decision (not reopened):
- **Who:** site coordinators only, from Season settings.
- **When:** any time, also mid-season, as a backup or to show PCDC. Open work doesn't stop it.
- **Format:** one ZIP with one CSV per kind of data. Not a multi-sheet .xlsx, so no new library.
- **Contents:**
  - cases and intake answers;
  - household members and status history;
  - messages between clients and staff;
  - follow-ups, call log and help requests.
- **Not included:**
  - the volunteer roster and certificates (the Roster CSV covers them, #138);
  - the generated 13614-C PDFs (they can be rebuilt from the answers).
- **Sensitive fields:**
  - Bank account and routing numbers are never exported.
  - An SSN or ITIN keeps only its last four digits.
  - ViTally stores neither today, so nothing is masked now. The rule holds if such a field is ever added.
- **Each export is recorded** (who, when). Season settings shows "Last export: <name> · <time>". #161 relies on the record.
- **Delivery:** a browser download. There is no re-import.

## What the code told us (recon)

- **Seasons.** `cases.season` is set when a case is submitted. Drafts have `season` null and no client number. `workspaces.current_season` is the current season.
- **Case-level data.** Everything else hangs off a case:
  - `case_events`: the staff status history, with actors and a `detail` JSON;
  - `client_events`: the client's plain-language history lines;
  - `document_requests`: a staff title and message to the client;
  - `admin_followups`: follow-ups;
  - `contact_log`: the call log, with an edited-versions table;
  - `contact_attempts`: the older follow-up call outcomes;
  - `assistance_items`: help requests. `case_id` is nullable, and a request with no case belongs to no season.
- **Answers.** Intake answers live in `cases.answers` (JSON keyed by catalogue question id). Household members are keys `household1…4*` inside it.
- **Catalogue in the browser.** The browser has the catalogue: English wording, option labels, `visibleAnswers()`, and `memberNameParts()`.
- **No chat.** There is no chat table. "Messages between clients and staff" means document requests plus client history lines.
- **CSV helper.** `src/csv.mjs` (`toCsv`) was written for #256 too: a UTF-8 BOM, CR LF line endings, formula guarding with `'`, and quoting.
- **Roster download.** The Roster CSV download is a Blob plus a hidden `<a download>`, named `roster-<season>-<YYYY-MM-DD>.csv` with the New York date.
- **No zip library.** There is no zip library in the project.
- **Migration number.** The last migration on `main` is 061, so this change takes `062` (merge `main` first, per Hailey's comment on #256).

## Decision chain

### Q1. Which seasons can be exported?

Options considered:
- (a) any season, with a picker;
- (b) the current and previous season;
- (c) the current season only.

I recommended (a), because #161 deletes *last* season's data only after an export "taken after the last change". That export can only be taken after Start next season.

**Decided: (c) current season only.**

Consequence, recorded as an open question **owned by #161**: once Start next season runs, the previous season can no longer be exported. #161's "export after the last change" check has to live with that. It could rely on an export taken before the start, add its own reminder, or widen the export in a later change. This affects only #161's check; this change does not block on it.

### Q2. Where are the files built, and when is the export recorded?

Options considered:
- (a) one RPC that checks the caller, records the export and returns the rows as JSON in one transaction; the browser builds the CSVs and the ZIP;
- (b) an Edge Function that builds the ZIP with the service role (a new deploy surface, a second auth path, Deno tests);
- (c) like (a), but a second RPC records the export after the browser has built the file. That is more honest when the download fails, but it takes two calls, and a client could skip or fake the record.

**Decided: (a).**

### Q3. Which files, and in what shape?

**Decided: as proposed.** Eight CSVs and a `README.txt`. Intake answers are in long format.

| File | One row per | Main columns |
|---|---|---|
| `cases.csv` | submitted case of the current season (drafts excluded) | client number, reference, origin, stage (staff name), close reason, submitted at, preparer, reviewer |
| `intake-answers.csv` | answer, visible answers only | client number, reference, question id, question (English), answer (English option labels) |
| `household-members.csv` | household member | client number, reference, member number, name, relationship, birth date, and the other member fields |
| `status-history.csv` | `case_events` row | client number, time, action, by, detail |
| `messages.csv` | document request, and client history line | client number, time, kind ("Document request" / "Client history"), from, title, message, status |
| `follow-ups.csv` | follow-up | client number, reason, assignee, status, outcome, note, opened, resolved |
| `call-log.csv` | contact log entry (current version), and older contact attempt | client number, contacted at, direction, with whom, method, purpose, outcome, note, logged by |
| `help-requests.csv` | help request on a current-season case, plus every help request with no case | client number (blank when none), title, status, assignee, language, contact preference, note, created |

Format rules:
- Times are in New York time, `YYYY-MM-DD HH:MM`.
- People are named by display name.
- The ZIP is named `vitally-<season>-export-<YYYY-MM-DD>.zip`, with the New York date.
- `README.txt` lists the files, the season, who exported it and when, and the free-text warning.
- Fixture or demo cases in the season are included like any other case.

Alternatives not taken:
- wide intake answers, one column per question: hundreds of columns, which shift with every catalogue change;
- an extra `filing-results.csv`: outside the Nov 21 list.

### Q4. The page and the record

**Decided: as described.**

**The card.**
- A new **"Season export"** card on Season settings, before "Next season".
- Every workspace admin sees "Last export: <name> · <Mon D, h:mm am/pm>" (New York time), or "No export yet this season."
- Only a site coordinator gets **"Export this season…"**.

**The dialog.**
- It is titled "Export the <season> season".
- It lists what's included and what isn't: the roster and certificates (use Roster → Export CSV), and the 13614-C PDFs (rebuilt from the answers).
- It warns: "Messages, notes and call log entries are exported as staff and clients wrote them. Notes must not hold amounts or ID numbers."
- Its buttons are Cancel and **Download ZIP**.
- Open work doesn't stop the export.

```
┌ Season export ─────────────── 2026 ┐
│ One ZIP of CSVs for PCDC's archive. │
│ Last export: Dana Wu · Nov 27, 3:05 pm│
│                [Export this season…] │
└──────────────────────────────────────┘
```

**The record.**
- A new table, `season_exports`: workspace, season, person, time, and row counts per file.
- It is written in the same transaction that returns the rows.
- Signed-in users have no direct grants on it.
- The Season settings read gains `last_export` for the current season, so it reads "No export yet" again after Start next season.

**Other calls I made, stated in the conversation and not objected to:**
- **No action-id receipt.** A receipt would have to store the whole export, and a retry that records a second export is harmless. This breaks from the other Season settings saves on purpose.
- **Refusal.** Anyone who is not an active site coordinator gets `FORBIDDEN`, and nothing is recorded.
- **One snapshot.** The RPC builds its whole answer in one statement, so every file sees the same moment.
- **Explicit columns.** Each file has an explicit column list, never `select *`. Answers go through `visibleAnswers`.
- **Sensitive-field guard.** A unit test fails if the catalogue ever gains an SSN, ITIN, routing or account-number field. The masking rule then has to be written on the day such a field appears.
- **Zip writer.** A small hand-written writer in `src/` builds a stored (uncompressed) ZIP with CRC-32. It needs no new library, and Node can check it.
- **Migration.** `062_season_export.sql`.

## Approaches (summary)

| Approach | Trade-off | Chosen |
|---|---|---|
| RPC returns rows, browser builds CSVs and a stored ZIP | Simple, unit-testable, no new deploy surface. The record can claim an export whose download then failed | **Yes** |
| Edge Function builds the ZIP | Thin browser, but a new function, a service-role path and Deno tests | No |
| RPC, then a record-after-save RPC | A more honest "Last export", but two calls and a record the client controls | No |

## Scope

**In:** a site coordinator downloads one ZIP of CSVs of the current season from Season settings. Each export is recorded and shown to workspace admins as "Last export".

**Out:**
- past seasons;
- re-import;
- the roster and certificates;
- PDFs;
- deletion (#161);
- an Edge Function;
- filing results.

## Dependencies

- Supabase RPC, RLS and migration `062`: ready.
- `src/csv.mjs`, the Roster download pattern, the catalogue helpers: ready.
- #161: a consumer, mockable. It only reads `season_exports`.

## Acceptance

- New capability spec `season-export`, and a `season-settings` delta for the card and `last_export` in the read.
- Anyone who is not a site coordinator gets `FORBIDDEN`, and nothing is recorded.
- The CSVs:
  - have a BOM, CR LF line endings and formula guarding;
  - keep Chinese text intact;
  - have the column lists above;
  - hold current-season cases only, with drafts excluded;
  - include help requests with no case.
- The ZIP opens with a standard unzip, checked in Node.
- "Last export" shows after an export, and resets after Start next season.
- The sensitive-field guard test passes.
- Checks:
  - `npm test`;
  - `npm run db:migrate:test`, then `npm run test:database`;
  - `npm run test:browser`.

  Not needed: `build:hant --check`, because staff screens stay English.

## Left to the builder

- **Exact column headers and order within each file.** Keep the meanings above. Use English headers in Title Case, as the Roster CSV does.
- **How `case_events.detail` is written.** Compact JSON text is fine.
- **How stage, action and other codes are turned into labels.** Reuse the staff labels the screens already use where they exist; otherwise use the raw code.
- **"Submitted at" and "close reason".** Take them from where the case page already reads them. When a value is missing, for example on a case closed before reasons existed, leave the cell empty. (My call.)
- **Other open Season settings windows.** They are not pushed a new "Last export" over realtime. They show it on their next read of Season settings. The exporter's page updates from the RPC answer. (My call: no new realtime table.)
- **Size limit.** None. One workspace's season is classroom-sized. (My call.)
- **Where the Season export card's code lives:** `src/season-settings-views.mjs`, with a new `src/season-export.mjs` for the CSV and ZIP building.
