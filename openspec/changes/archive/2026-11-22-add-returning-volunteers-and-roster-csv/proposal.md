## Why

After Start next season the roster holds only the starter, so every returning volunteer must be typed in again, and Add a volunteer refuses them: their email still belongs to last season's profile, and the server answers a generic error the admin can't act on. The rollover dialog also tells admins to "export this season's roster", but there is no export; the season data export (#256) leaves the roster to this CSV. Both are needed before the Dec 21 work and the pilot season (#138).

## What Changes

- **Returning volunteers in Add a volunteer**
  - From: Add a volunteer only creates new people. A returning volunteer's email is refused with a generic validation error.
  - To:
    - The Add drawer has a search box, "Returning volunteer? Search last season's roster", listing last season's people who aren't on this roster, filtered by name or email. A full email matching any other profile in the workspace that isn't on this roster also appears, as "Earlier volunteer".
    - Picking someone fills name, email (locked), phone, works, languages and usual days. "New volunteer" is unticked and "Photo ID checked" is empty. Roles and certificates start empty and stay usable under the usual certificate rules; certificates are never copied. "Not this person" resets the form.
    - Saving sends the existing Edit call with the picked profile's revision, which adds them to the current season's roster.
    - Typing such an email into the plain form says "That email belongs to an earlier volunteer. Pick them above."
  - Reason: re-adding last season's volunteers without retyping, and without the dead end.
  - Impact: non-breaking. No RPC or migration change; the behaviour `vitally_save_volunteer` already has becomes a stated requirement with a database test.
- **Roster CSV export**
  - An "Export CSV" button on the Roster exports exactly the rows shown (search, role and Show filters), as `roster-<season>-<YYYY-MM-DD>.csv` (New York date), and is disabled when nothing matches.
  - Columns: Name, Email, Phone, Roles, Certificates (as the table names them, each with its confirmation date), Languages, Account, Cleared.
  - UTF-8 with a BOM; cells starting with `=`, `+`, `-`, `@`, a tab or a carriage return get a leading apostrophe.
  - Built in the browser by a shared `src/csv.mjs`, which #256 can reuse.
- **Local seed:** `seed:local` adds a previous season's roster (three fictional people only on it, and one of today's 8 on both), inserted directly with SQL, a stated exception to going through `vitally_save_volunteer`.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `volunteer-roster`:
  - Add a volunteer can add a returning volunteer from last season's roster, or an earlier volunteer by email;
  - saving through Edit adds a person with a profile who isn't on the current roster to the current season;
  - the form's duplicate-email message for an earlier volunteer;
  - the Roster exports the rows shown as a CSV.
- `local-seed-data`: the local seed adds a previous season's roster, written directly rather than through `vitally_save_volunteer`.

## Impact

- **Code:** `src/volunteer-roster.mjs` (past-season candidates, form fill, CSV rows, certificate dates in `combineVolunteers`), `src/volunteer-views.mjs` (picker, Export CSV button), `src/app.mjs` / `src/controller.mjs` (pick and export actions, download), `src/supabase-store.mjs` (`listVolunteers` also reads last season's roster entries), new `src/csv.mjs`, `tools/admin/seed-cases.mjs` (past-season rows), `src/styles.css` as needed.
- **Database:** none. No migration (058 stays free), no RPC, RLS or realtime change.
- **Tests:** unit tests (`npm test`), a database test for the Edit path, and a new `tests/browser.mjs` block (not the story).
- **Dependencies:** none new. Builds on migration 057 (`usualDays`), merged with #262.
