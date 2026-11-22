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

**My profile (main's page, one new section)**
- Main's merged My profile (`add-my-profile`, #262) already owns the page, usual days (`mon`…`sun`) and the volunteer's own edits. This change adds only "Your shifts this week" (Monday to Sunday, New York time) to it, through a new `vitally_my_shifts()`.
- My profile stays cleared-only, as main's spec says. Uncleared rostered volunteers see their shifts on the read-only Schedule.

**Season settings**
- From: season label, upload links, SIDN, site coordinators.
- To: also site hours (each weekday closed, or open from one whole hour to a later one, New York time) and coverage targets (preparers, reviewers, on-site greeters or intakers; whole numbers 0–9; defaults 2 / 1 / 1).
- Site coordinators edit them; other workspace admins see them as text.
- Impact: non-breaking. A workspace starts with every day closed.

**Workload**
- Adds the column "Hours this week": every scheduled hour of the volunteer, Monday to Sunday in New York time.

**Sidebar and setup screen**
- Adds the Schedule link, including on the setup screen for uncleared staff on the roster. My profile stays main's account-row link for cleared windows.

**Seed**
- `seed:local` adds fictional site hours, usual days and a few shifts this week.

## Capabilities

### New Capabilities
- `volunteer-schedule`: shifts (shape, roles, overlap, site-hours bounds, the flags), who edits and who reads them (the no-sign-in rule included), the Schedule day view with drag and button alternatives, coverage counting against the targets, the usual-days hint in Add shift, and "Your shifts this week" on My profile with `vitally_my_shifts()`.

### Modified Capabilities
- `season-settings`: site hours and coverage targets on the page, edited only by site coordinators.
- `volunteer-workload`: the Hours this week column.
- `volunteer-clearance`: the setup screen's sidebar offers Schedule to rostered staff, and `vitally_my_clearance` says whether the caller may view the schedule (re-based on main's text after #262).

Usual days and the My profile page are main's (`volunteer-roster` and `my-profile`, from #262), not this change's.
- `local-seed-data`: site hours, usual days and shifts in the local seed.

## Impact

- **Database:** new migration `supabase/migrations/058_volunteer_schedule.sql` (main took 055–057 while this change was open).
  - New: tables `schedule_settings` and `shifts` (published to realtime, read through RPCs), and RLS that follows the 044 (c) no-sign-in rule. Usual days come from main's `volunteer_profiles.usual_days` (057).
  - New RPCs: the schedule day, saving and removing a shift, schedule settings, my shifts this week.
  - Replaced: `vitally_my_clearance` (from main's 057) and `vitally_season_settings` (from 052).
- **Front end:**
  - New view module for the Schedule, and a "Your shifts this week" section on main's My profile page.
  - Changed: `src/views.mjs` (sidebar), `src/controller.mjs` (screens, actions, realtime and focus re-reads), `src/supabase-store.mjs` (new RPCs; `shifts` and `schedule_settings` in the staff tables), `src/season-settings-views.mjs`, `src/profile-views.mjs` (the shifts section), `src/workload-views.mjs` and `src/volunteer-workload.mjs` (hours), `src/app.mjs` (pointer drag), and CSS.
  - Staff screens only, in English. No client text changes.
- **Tools:** `tools/admin/seed*.mjs`.
- **Tests:**
  - New `tests/database-schedule.mjs` and unit tests for the coverage and week arithmetic.
  - Updates to the season settings, workload and clearance database tests.
  - A short Schedule walk in the browser story.
- **Docs:** `docs/developer/database.md` (new tables and RPCs), the frontend notes, and the production roadmap line on the Workload.
