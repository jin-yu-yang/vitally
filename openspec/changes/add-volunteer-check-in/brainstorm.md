# Brainstorm: add-volunteer-check-in (#257)

Recorded from the brainstorm held in conversation on 2026-11-22. Every
decision below was confirmed by the user in that conversation.

## Background

- Workload's "Hours this week" (capability `volunteer-workload`) and #141's
  later season volunteer hours can only count scheduled shifts today. Nothing
  records when a volunteer actually worked.
- Decided earlier (Nov 21, recorded in #257):
  - this is its own change, after #140 Schedule (`add-volunteer-schedule`,
    PR #271). This branch is built on #140's branch;
  - volunteers check themselves in and out in ViTally, at the top after
    sign-in, and admins can correct the times;
  - checking in without a shift that day is allowed, marked "Not scheduled"
    for admins;
  - a forgotten check-out is counted to the end of that day's scheduled
    shift, or with no shift to the site's closing time (#140's site hours),
    and is marked so an admin can see it wasn't a real check-out;
  - Hours this week, and later #141's volunteer hours, use checked-in time;
  - check-in must work well on a phone (#147).
- What exists after #140:
  - `public.shifts` (whole hours, one role, one date, current season, with
    revision and `removed_at`) and `public.schedule_settings` (site hours
    and coverage targets per workspace), both in the realtime publication
    (migration 058);
  - the Schedule day view: an editable grid for workspace admins, read-only
    for other schedule viewers, who never see shifts of no-sign-in
    volunteers;
  - the Workload's Hours this week, which sums shift hours Monday to Sunday,
    New York time;
  - the staff sidebar, which can be collapsed (and usually is on a phone).

## Decision chain

### Q1. Who can check in?
Options:
- A. cleared only;
- B. anyone on this season's roster with an active sign-in, uncleared
  check-ins tagged;
- C. cleared, plus uncleared site coordinators.

**Decided: A, cleared only.** Only a cleared staff member (capability
`volunteer-clearance`) sees Check in. The setup screen has no Check in.
Hours then match the people allowed to work, and #141's hours aren't inflated
by people still being set up.

### Q2. Where do admins correct times?
Options:
- A. on the Schedule day view;
- B. on the Workload;
- C. a new Hours tab under Volunteers.

**Decided: A, the Schedule day view.**
- Each volunteer's row shows their checked-in time as a thin bar under their
  shifts.
- A volunteer who checked in with no shift that day gets a row tagged
  "Not scheduled".
- Pressing a bar opens a drawer to correct it.
- "Add check-in" covers someone who forgot to check in at all.
- Every workspace admin uses the Schedule, site coordinators without the
  Admin role included. The Workload is limited to cleared admins with the
  Admin role, which is why B was rejected.
- Non-admins on the read-only Schedule see no check-ins at all.

### Q3. Precision and display
Options:
- A. exact minutes, Hours this week to one decimal;
- B. round each check-in to 15 minutes;
- C. whole hours like shifts.

**Decided: A.**
- Check in and Check out store the exact time.
- Admin corrections use 5-minute steps.
- Hours this week sums minutes and shows one decimal ("6.5"), with a whole
  number shown without a decimal ("7").
- A check-in still open today counts up to now. It is re-read on the usual
  live and focus events, not as a ticking clock.
- The Schedule bar is drawn at its real position inside the hour columns.

### Q4. Forgotten check-out
**Decided (confirmed as proposed):**
1. The end is derived when hours are read, not stored. Nothing writes a
   check-out on the volunteer's behalf (there is no background job). A
   check-in with no check-out whose New York date is before today is a
   **missed check-out**. If an admin later enters a real check-out, it
   replaces the derived end.
2. The day's end is the latest end hour of the volunteer's live shifts that
   day. With no shift, it is that weekday's site close hour.
3. A check-in made after that end counts 0 minutes, but is still tagged so an
   admin can fix it. This covers a check-in after the shift ended, and a
   closed day with no shift.
4. A check-in still open today counts up to now, capped at the day's end. A
   real later check-out counts in full.
5. At midnight New York time, yesterday's open check-in stops being open, and
   the volunteer sees Check in again.
6. Admin tags: "No check-out" for a missed check-out, and "Not scheduled" for
   a check-in with no shift that day.
7. More than one check-in a day is allowed. They can't overlap, and a
   volunteer can't check in while already checked in.

The alternative, writing the derived check-out into the row later, was
rejected. It mixes guessed times with real ones, and a correction would have
to know which was which.

### Q5. Where the volunteer's button goes
Options:
- A. a slim strip at the top of the main area on every staff screen;
- B. only on the home screen;
- C. in the sidebar under the account row.

**Decided: A.**
- The strip reads "Check in", or "Checked in since 9:52 am · Check out".
- It shows for cleared windows only, above the page title, whether or not
  the sidebar is collapsed. On a phone it is the first thing on screen.
- It follows the volunteer across devices live: check in on a phone, and the
  laptop shows Check out.
- Check out asks nothing. Mistakes are for an admin to correct.
- C was rejected because the sidebar is hidden when collapsed, which is the
  usual case on a phone.

### Q6. Admin corrections
**Decided (confirmed as proposed):**
1. Edit the in and out times of any check-in, in 5-minute steps, on that
   same date. Clearing the out time makes it open again, or a missed
   check-out if the day is past.
2. Add check-in for a volunteer who forgot to check in. The picker is the
   same as Add shift's: rostered volunteers with a role and an account that
   isn't deactivated, usual days first.
3. Remove a check-in. It asks first, in the shared confirmation dialog.
4. A check-in an admin edited or added is tagged "Corrected", and the drawer
   shows "Corrected by <name>". The volunteer's original time is not kept
   separately (confirmed: no need to keep it).
5. The same guards as shifts:
   - workspace admins only;
   - action ids and revisions, with `CONFLICT` on a stale revision;
   - no direct table writes.

   Validation refuses an out time before the in time, overlapping
   check-ins, and times in the future. Outside site hours is allowed, but
   tagged "Outside site hours".
6. Volunteers can't edit their own check-ins, only check in and check out.

## Scope

**In:**
- cleared volunteers check themselves in and out from a strip on every
  staff screen;
- workspace admins see check-ins on the Schedule day view and correct them
  there;
- Workload's Hours this week becomes checked-in time;
- fictional check-ins in the local seed data, including one missed
  check-out and one "Not scheduled".

**Out:**
- a volunteer's own check-in history screen;
- #141's season hours (they will read the same hours later);
- admin-side phone layouts (#147).

Capabilities:
- new `volunteer-check-in`;
- modified `volunteer-schedule`, `volunteer-workload` and `local-seed-data`.

## Dependencies
- #140, PR #271 (`add-volunteer-schedule`): ready but not yet merged. This
  branch is built on it, and it must be in `main` before this change is
  archived.
- Supabase Realtime: ready.
- #141: not affected. It reads the same hours later.

## Open questions
- The migration number, expected `059`. Owner: the implementer. Check it
  against `main` before the migration is written. Only the file name depends
  on it.

## Acceptance
- Delta specs with scenarios for the four capabilities above.
- Checks:
  - `npm test`;
  - `npm run db:migrate:test`, then `npm run test:database`, for the new
    table, RPCs, row-level security and realtime;
  - `npm run test:browser`, with the story extended by check in and check
    out, a missed check-out and an admin correction, and with no sideways
    scroll on the strip at 390 px.
- Not needed:
  - `test:auth-browser`, because sign-in is unchanged;
  - `build:hant --check`, because staff screens are English only. CI runs
    it anyway.

## Update 2026-11-23: overlap with an open check-in
The final review found that an admin could add a check-in after a volunteer's still-open one today, because the open row was measured only to its day's end. The volunteer's next check-out then closed the wrong row, and the two overlapped. **Decided by the user:** for the OVERLAP check, an open check-in dated today runs on until it is checked out. The counted minutes are unchanged.
