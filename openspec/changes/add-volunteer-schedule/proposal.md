## Why

PCDC staffs 700+ requests with about 20 volunteers of uneven availability, and today the schedule lives in Airtable. Admins can't see which open hours lack a preparer, a reviewer or someone on site. They learn who is flexible only by chance. The Workload's "Hours this week" column has waited on this. Issue #140 (part of #129, target Dec 6) adds an hourly schedule with coverage gaps, and private "usual days" that hint admins while they schedule. Per the Nov 6 decision, every rostered volunteer can see the shifts and their own week.

## What Changes

**Schedule screen (new)**
- One day at a time (‹ Prev, date, Next ›, Today), with one column per open hour of that weekday and one row per volunteer with a shift that day.
- A shift is one volunteer, one date, a whole-hour start and end inside site hours, and one role the volunteer holds this season. One person's shifts never overlap.
- Workspace admins, cleared or not, edit:
  - drag across empty cells to create a shift, and drag an edge to resize it;
  - every drag has a button alternative: Add shift, and clicking a shift to change its hours or role, or to remove it.
- A coverage row shows, per open hour, what is missing against the targets ("1 more preparer"). The header reads "N of M hours have gaps".
  - Only cleared volunteers count.
  - Greeter and Intaker count only when the volunteer works on site.
  - Admin shifts, and shifts flagged "Role removed" or "Outside site hours", count toward nothing.
- Add shift lists volunteers who usually come on that weekday first ("Usually here Saturdays").
- Every staff member with a current-season roster entry and an active account, cleared or not, sees the Schedule read-only. They see names, roles and hours. Shifts of volunteers with no sign-in are hidden from non-admins.

**My profile (new)**
- Name and roles, read-only.
- Usual days: seven weekday toggles, which the volunteer edits.
- "Your shifts this week" (Monday to Sunday, New York time).
- Shown to the same people as the Schedule, the setup screen included.

**Season settings**
- From: season label, upload links, SIDN, site coordinators.
- To: also site hours (each weekday closed, or open from one whole hour to a later one, New York time) and coverage targets (preparers, reviewers, on-site greeters or intakers; whole numbers 0–9; defaults 2 / 1 / 1).
- Site coordinators edit them; other workspace admins see them as text.
- Impact: non-breaking. A workspace starts with every day closed.

**Roster**
- From: the Edit drawer has works, languages, roles and certificates.
- To: it also has usual days, readable only by admins and by the volunteer themselves.

**Workload**
- Adds the column "Hours this week": every scheduled hour of the volunteer, Monday to Sunday in New York time.

**Sidebar and setup screen**
- Adds the Schedule and My profile links, including on the setup screen for uncleared staff on the roster.

**Seed**
- `seed:local` adds fictional site hours, usual days and a few shifts this week.

## Capabilities

### New Capabilities
- `volunteer-schedule`: shifts (shape, roles, overlap, site-hours bounds, the flags), who edits and who reads them (the no-sign-in rule included), the Schedule day view with drag and button alternatives, coverage counting against the targets, usual days and their privacy, and the My profile page.

### Modified Capabilities
- `season-settings`: site hours and coverage targets on the page, edited only by site coordinators.
- `volunteer-roster`: the Edit drawer and `vitally_save_volunteer` carry usual days.
- `volunteer-workload`: the Hours this week column.
- `volunteer-clearance`: the setup screen's sidebar offers Schedule and My profile to rostered staff, and `vitally_my_clearance` says whether the caller may view the schedule.
- `local-seed-data`: site hours, usual days and shifts in the local seed.

## Impact

- **Database:** new migration `supabase/migrations/057_volunteer_schedule.sql`.
  - New: `volunteer_profiles.usual_days`, tables `schedule_settings` and `shifts` (published to realtime, read through RPCs), and RLS that follows the 044 (c) no-sign-in rule.
  - New RPCs: the schedule day, saving and removing a shift, schedule settings, my profile, saving my usual days.
  - Replaced: `vitally_save_volunteer`, `vitally_my_clearance` and `vitally_season_settings`.
- **Front end:**
  - New view modules for the Schedule and My profile.
  - Changed: `src/views.mjs` (sidebar), `src/controller.mjs` (screens, actions, realtime and focus re-reads), `src/supabase-store.mjs` (new RPCs; `shifts` and `schedule_settings` in the staff tables), `src/season-settings-views.mjs`, `src/volunteer-views.mjs` (usual days), `src/workload-views.mjs` and `src/volunteer-workload.mjs` (hours), `src/setup-views.mjs`, `src/app.mjs` (pointer drag), and CSS.
  - Staff screens only, in English. No client text changes.
- **Tools:** `tools/admin/seed*.mjs`.
- **Tests:**
  - New `tests/database-schedule.mjs` and unit tests for the coverage and week arithmetic.
  - Updates to the season settings, roster, workload and clearance database tests.
  - A short Schedule walk in the browser story.
- **Docs:** `docs/developer/database.md` (new tables and RPCs), the frontend notes, and the production roadmap line on the Workload.
