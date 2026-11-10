## Why

Volunteers exist only as entries in an operator's JSON roster file, and nothing records a volunteer's contact details, roles or certificates. PCDC is reviewing the admin side on the evening of 2026-11-11 and needs to see and react to a working Roster. This change is the first slice of #138: it gives admins a place to record volunteers, without changing who can do what in ViTally.

## What Changes

**New: Volunteers > Roster (admins only)**
- A "Volunteers" sidebar link and a Roster table: Volunteer (name, Remote badge, email and phone), Roles, Certificates, Languages, Edit.
- Search on name, email and phone, and a role filter.
- Add a volunteer and Edit, in a drawer: name, email, phone, languages, works, roles, certificate ticks.
- One line on the page says roles and certificates are recorded and don't change what anyone can do yet.

**New: records, admin-only**
- Three new tables: `volunteer_profiles`, `roster_entries`, `certificates`. Only admins can read them.
- One new RPC, `vitally_save_volunteer`, for Add and Edit. Non-admins are refused.
- Roles and certificates grant no capability. Access still comes from the roster command.
- Existing staff are added to the Roster by the migration, with no roles recorded.

**Who can see a volunteer with no sign-in**
- From: every staff member can read every person.
- To: a person who has a roster entry and no sign-in can be read only by admins, and is not offered in the All cases "Anyone" filter.
- Reason: Roster records are admin-only.
- Impact: non-breaking. Staff with sign-ins remain visible to staff as before.

**The roster command links instead of duplicating**
- From: a staff entry always creates a new person, and a re-run with a changed name is refused.
- To: a staff entry whose email matches a volunteer with no sign-in links that record. A re-run no longer compares the name; the name in the database wins.
- Reason: a volunteer added on the Roster gets their access from the roster command, and a name edited on the Roster must not abort the next run.
- Impact: non-breaking for roster files. Changed keys and capabilities are still refused.

**Rehearsal data**
- `seed:local` adds about 8 fictional volunteers for the review.

**Out of scope (the rest of #138):** clearance and the setup screen, certificate and photo ID uploads, Change role, Create account, deactivation, the open-work refusal, Season settings and Start next season, site coordinator, My profile and the volunteer summary, the #104 switch, returning volunteers, removing a volunteer, CSV export, and the fields gender, usual days, phone sharing, new and photo ID.

## Capabilities

### New Capabilities
- `volunteer-roster`: the admin-only Roster screen and its records: listing, searching, filtering, adding and editing volunteers, and who may read and write them.

### Modified Capabilities
- `sign-in`: the roster command links a matching volunteer record, creates roster records for new staff, and no longer compares names on a re-run.
- `local-seed-data`: the local seed also creates fictional volunteers.

## Impact

- **Database:** one new migration (three tables, RLS policies, the RPC, a replaced `add_staff_member`, a changed `people` read policy, a backfill of existing staff from `auth.users`).
- **Browser:** the staff sidebar, a new office screen and drawer, store reads and one store write, styles for the table and drawer.
- **Tools:** `seed:local`. `tools/admin/roster.mjs` needs no change to its file format.
- **Tests:** unit, database and one new browser test.
- **Docs:** `docs/setup.md` migration list and `docs/developer/database.md`.
- **Dependencies:** none added.
