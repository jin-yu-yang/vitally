## Why

Workload's "Hours this week", and later #141's season volunteer hours, can
only count scheduled shifts today. Nothing records when a volunteer actually
worked. #140 has given ViTally shifts and site hours, so arrival and departure
can now be recorded against them. #147 asks that check-in work well on a phone,
and #141 needs real hours before the season's analytics mean anything.

## What Changes

- **New: volunteers check themselves in and out.**
  - A strip at the top of every staff screen, in cleared windows only, reads
    "Check in", or "Checked in since 9:52 am · Check out".
  - It follows the volunteer live across devices.
  - Uncleared staff and the setup screen get no strip.
- **New: a forgotten check-out is derived on read, never written.**
  - A check-in with no check-out from an earlier New York date counts to the
    latest end of that volunteer's shifts that day. With no shift, it counts
    to the site's close hour.
  - It counts 0 minutes if the check-in came after that end.
  - An open check-in today counts up to now, capped at that end.
- **Schedule (admin day view):**
  - From: shifts only, with rows for volunteers who have a shift.
  - To: each volunteer's check-ins drawn as bars under their shifts. A
    volunteer with check-ins and no shift gets a row. Bars carry the tags
    "No check-out", "Not scheduled", "Corrected" and "Outside site hours".
    Admins can Add check-in, edit the in and out times in 5-minute steps,
    and Remove a check-in (asks first).
  - The read-only Schedule shows no check-ins.
  - Impact: non-breaking. Coverage still counts shifts only.
- **Workload Hours this week:**
  - From: the sum of scheduled shift hours this week.
  - To: the sum of checked-in minutes this week, derived ends included,
    shown to one decimal ("6.5", "7").
  - Reason: the issue's decision that hours mean time actually worked.
  - Impact: the number an admin sees changes meaning. There is no data
    migration.
- **Local seed:** fictional check-ins, including one missed check-out and one
  "Not scheduled".

## Capabilities

### New Capabilities
- `volunteer-check-in`:
  - the check-in record;
  - self check-in and check-out by cleared staff, and the strip that offers
    them;
  - the derived end for a missed or open check-in;
  - admin corrections and their validation;
  - who reads check-ins, and how changes reach open windows.

### Modified Capabilities
- `volunteer-schedule`:
  - the admin day view shows check-in bars, rows for unscheduled check-ins,
    Add check-in and the check-in drawer;
  - the read-only Schedule shows none;
  - check-in changes re-read the day.
- `volunteer-workload`: "The Workload shows the hours scheduled this week"
  becomes checked-in hours this week, to one decimal, re-read on check-in,
  shift and site-hours changes.
- `local-seed-data`: "The local seed fills a week of the schedule" also adds
  fictional check-ins and removes exactly its own on a re-run.

## Impact

- **Database:** a new migration (expected `059_volunteer_check_in.sql`) adds:
  - the `public.check_ins` table, RPC-only for writes and in the realtime
    publication;
  - RPCs for check in, check out, the caller's own check-in state, the
    admin's save and remove, and the admin's hours this week;
  - a replaced `vitally_schedule_day`.
- **Front end:**
  - `src/supabase-store.mjs`: new RPC calls, and `check_ins` in the staff
    realtime tables;
  - `src/controller.mjs`: the strip's state, the check-in drawer, and
    re-reads;
  - `src/views.mjs`: the strip in the staff shell;
  - `src/schedule-views.mjs`: the bars and the drawer;
  - `src/volunteer-workload.mjs` and `src/workload-views.mjs`: hours from
    minutes;
  - `src/styles.css`.
- **Tools:** `tools/admin/seed-cases.mjs`, the seeded check-ins.
- **Tests:**
  - unit tests for the pure parts (time display, bar placement, hours
    format);
  - a new database suite for check-ins;
  - the browser story gains a short check-in walk.
- **Dependencies:**
  - #140 (PR #271): this branch is built on it, and it must merge first.
  - Supabase Realtime: ready.
  - No new packages.
- **No client text.** Staff screens are English only.
