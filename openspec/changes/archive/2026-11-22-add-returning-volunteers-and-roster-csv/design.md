## Context

- **The roster after a rollover.** Start next season (`season-rollover`, 055) leaves the new season's roster holding only the starter. Earlier roster entries, certificates and every `volunteer_profiles` row are kept, and other staff accounts are deactivated.
- **Why Add fails today.** `volunteer_profiles` is `unique (workspace_id, email)` across seasons. The browser's duplicate check in `src/volunteer-roster.mjs` only sees the current season's list, so a returning volunteer's email passes it, and then `vitally_save_volunteer` refuses with a generic `VALIDATION`.
- **The save already does the work.** `vitally_save_volunteer` (latest definition in 057) already adds a past volunteer to the current season through its Edit path. With `p_volunteer_id` set to the person and `p_expected_revision` set to their profile revision, every check passes for someone with a profile and no current-season entry: ADMIN_ROLE, NOT_FOUND/CONFLICT on the profile, email uniqueness excluding the person, ROLE_NEEDS and the open-work rule. The upsert on `roster_entries` then inserts the current-season row. Usual days follow `coalesce(v_days, usual_days)`, and the drawer always sends them (#262).
- **Reads.** Admin RLS on `volunteer_profiles`, `roster_entries` and `certificates` (044) has no season filter. `listVolunteers` (`src/supabase-store.mjs`) loads every profile and filters entries and certificates to `current_season`.
- **Accounts.** A returning volunteer's account is usually `deactivated`. Once they are on the roster, their row says "Account deactivated", and the drawer's existing Reactivate (047) applies. Reactivate does not depend on the season.
- **Export.** The rollover dialog says "Export this season's roster and cases first if you need them". The season data export (#256, not built) leaves the roster to this change. Downloads already use a Blob and a link (`downloadShadedCopy`, `src/app.mjs`).
- **Seed.** `seed:local` (`tools/admin/seed.mjs` → `seed-cases.mjs`, values in `seed-values.mjs`) adds its 8 fictional volunteers through `vitally_save_volunteer`, which writes only the current season. The seed already holds a direct database connection.
- **Constraints.**
  - Staff screens are English.
  - Fictional data only.
  - No local Docker: database and browser suites run in CI.
  - New screens get their own `tests/browser.mjs` block, not story phases.

## Goals / Non-Goals

**Goals:**
- An admin re-adds last season's volunteers from Add a volunteer without retyping them, and never hits a dead-end email error.
- An admin exports the Roster, as filtered on screen, to a CSV that Excel opens safely and that shows Chinese names correctly.
- The save behaviour this relies on becomes a stated requirement covered by a database test.
- The local seed has a previous season to rehearse with.

**Non-Goals:**
- Copying roles or certificates from an earlier season.
- Adding every returning volunteer in bulk.
- Reactivating accounts automatically.
- The season data export (#256).
- Any migration, RPC, RLS or realtime change.

## Decisions

### D1: A returning volunteer is added through the existing Edit call
- **Choice:** Picking a person makes the drawer's Save call `vitally_save_volunteer(actionId, personId, profileRevision, payload)`, exactly as Edit does. The database inserts the current-season roster entry. The behaviour is written down as a `volunteer-roster` requirement and pinned by a database test in `tests/database-volunteer-roster.mjs`.
- **Rationale:** The RPC already validates, takes receipts, refuses stale revisions and applies ROLE_NEEDS and the open-work rule. A second path would duplicate all of that.
- **Alternatives considered:**
  - A new RPC `vitally_add_returning_volunteer` (migration 058). It would be an explicit contract, but it adds no behaviour and would copy the save's validation.
  - Letting Add with an existing email reattach that person. It needs no UI, but it silently changes what Add means, and a typo would overwrite someone else's profile.

### D2: Who the picker offers
- **Choice:**
  - **Browse list:** people with a roster entry for `current_season - 1` and none for the current season, filtered as the admin types by name or email (case-insensitive substring), sorted by name.
  - **Email match:** when the box holds a full email equal, ignoring case, to a profile not on the current roster, that person is also offered, labelled "Earlier volunteer" if they weren't on last season's roster. This match covers any profile in the workspace.
- **Rationale:** The list stays short and relevant, and Add never fails on an email the admin can't see (decision Q3 (b)). Admins already load every profile, so nothing new is exposed.
- **Alternatives considered:** Offering last season only, by email as well. That leaves older profiles blocking Add with an error.

### D3: What a pick fills, and what it locks
- **Choice:**
  - **Filled:** name, email, phone, works, languages and other language, and usual days come from the profile.
  - **Season fields:** "New volunteer" is unticked and "Photo ID checked" is empty. Roles and certificates start empty and stay editable under ROLE_NEEDS. Certificates are never copied.
  - **Locked:** the email is read-only once a person is picked.
  - **Undo:** "Not this person" restores a blank Add, with New ticked by default.
- **Rationale:**
  - These are the clearance rules: roles come only after this season's Form 13615 certificates are confirmed.
  - Usual days must travel with the pick, because the drawer always sends them and a pick that left them out would wipe them.
  - The email decides which profile is updated.

### D4: The earlier volunteer's email in the plain form
- **Choice:** If the admin types into the email field (without picking) an email that belongs to a profile not on the current roster, the form says "That email belongs to an earlier volunteer. Pick them above." and does not send the save. "That email is already on the Roster." stays for current-roster emails.
- **Rationale:** It replaces the generic database refusal with a message the admin can act on.

### D5: Earlier volunteers are read with the Roster
- **Choice:** A new store method, `listEarlierVolunteers()`, reads the workspace's profiles, people, and `roster_entries` person ids for the current season and `current_season - 1`. It returns the people with a profile and no current-season entry, each with their profile fields, revision and `lastSeason` (whether they were on last season's roster).
  - The controller's `readVolunteers` calls it alongside `listVolunteers()`, in parallel, and keeps the result in `state.earlierVolunteers`.
  - `listVolunteers()` and `state.volunteers` keep their shape.
- **Rationale:** The picker's data is refreshed whenever the Roster is, and every consumer of the current list is left alone.
- **Alternatives considered:** Returning both from `listVolunteers`. That changes the shape that the views, controller and tests rely on.

### D6: The CSV is built in the browser from the filtered list
- **Choice:**
  - **Rows:** "Export CSV" in the Roster toolbar turns exactly the rows that `filterVolunteers` keeps into a CSV. It downloads as `roster-<season>-<YYYY-MM-DD>.csv`, with the date in New York time, and is disabled when no row is shown.
  - **Columns:**

    | Column | Content |
    |---|---|
    | Name | |
    | Email | |
    | Phone | |
    | Roles | screen labels, joined with `; ` |
    | Certificates | screen labels (`IT&QR`), each with its confirmation date as `YYYY-MM-DD` in New York time, e.g. `IT&QR (2026-11-03); Basic (2026-11-03)` |
    | Languages | screen labels, with the other language written out |
    | Account | Not created / Invited / Active / Deactivated |
    | Cleared | Yes / No |

  - **Dates:** `combineVolunteers` carries each certificate's `confirmed_at`. Only `confirmed` certificates appear, as on screen.
- **Rationale:** Every value is already in the loaded list, so the export matches what the admin sees. It is admin-only because the Roster is.
- **Alternatives considered:** An RPC or Edge Function. That adds a server contract for data the page already holds, and the filters would have to be mirrored on the server.

### D7: `src/csv.mjs`, a shared encoder
- **Choice:**
  - **Interface:** a pure module, `toCsv(header, rows)`, returning a string.
  - **Format:** a UTF-8 BOM first, RFC 4180 quoting (a field containing `"`, `,`, CR or LF is quoted, and `"` is doubled) and `\r\n` line endings.
  - **Formula guard:** a cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading `'`, before quoting. That includes phones, so `+1…` exports as `'+1…`.
- **Rationale:** The BOM makes Excel read the file as UTF-8, so Chinese names show correctly. The guard stops formula injection from admin-typed text. #256 will reuse the module.

### D8: The seed's previous season is written directly
- **Choice:** After its 8 volunteers, `seed:local` inserts with SQL, in the seed's own connection:
  - three fictional people, each with a profile (usual days among them) and a `current_season - 1` roster entry with roles and confirmed certificates, and no current entry;
  - a `current_season - 1` entry for one of the 8, so the picker visibly leaves out someone already on this roster.

  Re-runs delete them by their email list, under the same rule as the 8: only people with no sign-in. The browser story's use of the seed module adds none of them.
- **Rationale:** No RPC writes a past season. The rejected alternative, running Start next season, would deactivate the role accounts and empty the roster.
- **Spec impact:** This is stated as an exception in `local-seed-data`.

## Risks / Trade-offs

- [Risk] The Edit path is relied on for a case it wasn't written for. A future save change could break it. → Mitigation: a spec requirement plus a database test (pick → entry created, no roles, not new, revision raised, usual days kept, receipt replay).
- [Risk] A pick based on a stale profile revision. → Mitigation: the existing CONFLICT handling (re-read, then the drawer says so).
- [Risk] Two admins pick the same person at the same time. → Mitigation: the second save is a CONFLICT on the profile revision. Even without one, the upsert's primary key gives one entry.
- [Trade-off] The formula guard changes phones such as `+1 555…` to `'+1 555…` in the file. → Accepted: Excel hides the apostrophe, and safety outweighs exactness.
- [Trade-off] The email match covers any profile, including people from several seasons ago. → Accepted: admins already read these profiles, and the alternative is a dead end.
- [Risk] The seed's direct SQL may drift from what the RPC would write. → Mitigation: it writes only columns that have defaults or checks enforced by the tables, and `tests/database-seed.mjs` covers the result.

## Migration Plan

N/A. There is no database or deployment change: no migration, RPC, RLS or Edge Function. Deploying is the normal static front-end update, and rolling back is reverting the commit.

## Open Questions

None. All decisions were settled with Hailey on Nov 21–22 (see brainstorm.md).
