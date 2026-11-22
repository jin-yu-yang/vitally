# Brainstorm: add-volunteer-schedule

Issue #140 (part of #129, Admin side: volunteers, scheduling, analytics). Target Dec 6, in the Dec 21 test release.
Brainstormed in conversation on 2026-11-21. The user approved every decision below; items marked **(builder's call)** are minor choices made while recording the design, open to correction at review.

## Background

**What the issue asks:** a Schedule tab, one day at a time with one cell per hour; a role per shift (active roles only); coverage gaps (2 preparers, 1 reviewer, 1 on-site greeter or intaker per open hour); site hours in Season settings; a button alternative to every drag.

**Visibility decision (Nov 6, issue comment):** a volunteer's availability (usual days on their profile) is private: only that volunteer and admins see it. Admins see it as a hint while scheduling. Scheduled shifts are visible to every volunteer on the current roster, and each volunteer's My profile lists their shifts for this week.

**Why:** PCDC runs ~20 volunteers of uneven availability against 700+ requests (docs/spec.md §3.3). The admin team didn't learn that Liu Fen was flexible until late in the season (docs/proposal.md §3). The roadmap moves the schedule over from Airtable (docs/roadmap.md, Adoption). Success looks like this: an admin can see, day by day, which open hours are short of preparers, reviewers or someone on site, and fill them from volunteers who usually come that day.

**What exists on main (7e06662):**
- Roster records (044): `volunteer_profiles` (email, phone, works `on_site` / `remote` / `on_site_and_remote`, languages; admin-only RLS, with a profile revision) and `roster_entries` (per season, roles Greeter/Intaker/Preparer/Reviewer/Admin).
- Clearance (045). Workload (046), whose "Hours this week" column has waited for #140 (docs/developer/production-roadmap.md). Accounts (047). The realtime publication pattern for a browser-read table (posted updates, 049). Season settings and site coordinators (052). Clearance uploads (053).
- `staffSidebar` (src/views.mjs) already names Schedule as a screen that does not exist yet.
- No availability field exists, and no My profile screen exists.

**Prototype notes (docs/design/DESIGN.md, 2026-09-27):**
- Season settings has "office shift days (toggle tiles) and hours".
- The People drawer and roster table have "usual days".
- The Schedule screen itself is not described there.

## Decision chain

**Q1. Scope. Usual days and My profile don't exist yet. Build them here?** Options: all in one; schedule plus usual days without My profile; schedule only.
→ **All in one.** This one change adds the Schedule, site hours, coverage gaps, usual days and a small My profile page. It delivers the whole Nov 6 decision.

**Q2. What is a shift?** Options: a span of whole hours; one hour per shift.
→ **A span of whole hours.**
- A shift is one volunteer, one date, a start and an end on the hour inside site hours, and one role.
- One person's shifts may not overlap. A person may have more than one shift in a day if they don't overlap. **(builder's call)**
- A shift never crosses midnight. **(builder's call)**

**Q3. Site hours shape.** Options: a range per weekday; the same hours every open day; weekday ranges plus closed dates.
→ **A range per weekday.**
- Seven weekday tiles, each open or closed. Each open day has its own open and close hour: whole hours, America/New_York.
- The same week repeats all season. There are no one-off closures.
- Site coordinators edit site hours on Season settings, like the rest of that page. Other workspace admins see them as text.
- If hours shrink later, existing shifts are kept and flagged "Outside site hours".
- Creating a shift, or changing its hours, outside site hours is refused. A closed weekday refuses every new shift.
- The open hour is 0–23 and the close hour is open+1 to 24. **(builder's call)**
- A new workspace starts with every day closed, so the Schedule says to set site hours first. **(builder's call)**

**Q4. Who edits, and who can be given a shift?** Options: workspace admins with any roster role; cleared admins with cleared volunteers only; site coordinators only.
→ **Workspace admins (`is_workspace_admin`), cleared or not, like the Roster.** The schedule holds no case data.
- A shift's role must be one the volunteer holds in the current season.
- Uncleared volunteers can be scheduled. They carry a "Not cleared" tag and don't count toward coverage.
- Deactivated volunteers are not offered.
- If a role is removed later, its shift stays, flagged "Role removed", and stops counting.
- A shift's role may be Admin. It counts toward nothing. **(builder's call; follows from "active roles only")**

**Q5. Who sees Schedule and My profile?** Options: everyone on the roster; cleared volunteers only.
→ **Everyone on the roster.** That means every staff member with a current-season roster entry and an active account, cleared or not.
- Both links are in the sidebar, the setup screen's included, so a new volunteer can set usual days and see shifts during preseason.
- For non-admins the Schedule is read-only and shows names and roles only, never usual days, email or phone.
- Shifts of a volunteer with no sign-in are hidden from non-admins (OQ1).

**Q6. What do usual days hold?** Options: weekdays only; weekdays with hours.
→ **Weekdays only.**
- Seven optional toggles.
- The volunteer sets them on My profile. An admin sets them on the Roster drawer.
- Only that volunteer and admins can read them.
- On the Schedule, the Add shift picker lists volunteers who usually come on that weekday first, tagged "Usually here Saturdays", then everyone else.

**Q7. Coverage targets: fixed or editable?** Options: fixed at 2/1/1; editable in Season settings.
→ **Editable in Season settings by site coordinators,** defaulting to 2 preparers, 1 reviewer and 1 on-site greeter or intaker.
- Each target is a whole number from 0 to 9, where 0 means not needed. **(builder's call for the range)**
- Counting: per open hour, count cleared volunteers by the role of the shift that covers that hour.
- A Greeter or Intaker shift counts as on site only if the volunteer's Works is On site or On site and remote.
- Admin shifts, uncleared volunteers' shifts and flagged shifts ("Role removed", "Outside site hours") count toward nothing.
- Each hour shows OK or what is missing ("1 more preparer"). The day header says "N of M hours have gaps".

**Q8. Layout of the day view.** Options: rows are volunteers; rows are hours.
→ **Rows are volunteers.**
- A day picker: ‹ Prev, the date, Next ›, Today.
- Columns are the day's open hours. There is one row per volunteer with a shift that day, and a coverage row at the bottom. A closed day says "Closed".
- Dragging across empty cells in a row creates a shift. Dragging a shift's edge resizes it.
- Button alternatives: "Add shift" opens a drawer (volunteer, role, start, end). Clicking a shift opens the same drawer to change its hours or role, or to remove it.
- Moving a shift to another person is a remove plus an add.

Sketch:

```
‹ Prev   Saturday, February 7   Next ›  [Today]   [+ Add shift]
2 of 6 hours have gaps

              10   11   12   1    2    3
Rowan Diaz   [Preparer =======]
Hana Moretti      [Preparer ==========]
Ari Novak         [Reviewer ==========]
Jordan Reyes [Greeter Not cleared]
----------------------------------------
Coverage      1P   ok   ok   ok   1R   all
```

- Creating a shift with an empty row: a drag can only start in an existing row, so a new volunteer for the day goes through Add shift. **(builder's call)**
- The Schedule opens on today's date in New York. **(builder's call)**
- Past days can be edited too, so the Workload's hours stay correct. **(builder's call)**
- Remove asks for confirmation through the shared confirmation dialog (screen-states). **(builder's call)**
- The grid scrolls sideways inside its own box. The page never scrolls sideways. Full mobile layouts are #147. **(builder's call)**

**Q9. Workload "Hours this week".** Options: include it; leave it out.
→ **Include it.** Each Workload row shows the volunteer's scheduled hours for this week, Monday to Sunday in New York time. It counts every shift of every role, flagged or not. **(builder's call: flagged shifts still count as hours scheduled)**

**Q10. Two admins on the same day.** Options: revisions plus a live refresh; re-read on focus only.
→ **Revisions plus a live refresh.**
- Each shift has a revision. A change sent from a stale screen is refused as a conflict, and the day re-reads.
- Shifts and site hours are published to realtime under RLS, with 049's pattern (INSERT/UPDATE, plus DELETE for shifts).
- Open Schedule and My profile windows refresh from it, and also re-read on focus, as the Roster does.
- Usual days are not published.

## My profile (from Q1, Q5, Q6)

My profile is a staff screen in English, like every staff screen. It shows:
- the volunteer's name and current-season roles, read-only;
- usual days, as seven toggles with Save;
- "Your shifts this week": each shift's day, date, hours and role, Monday to Sunday in New York time, or "No shifts this week."

Every staff member who has Schedule also has My profile, admins included. **(builder's call)**

The volunteer saves their usual days through their own RPC, which raises the profile revision. An admin's Roster drawer that is open on the old revision then gets the usual conflict. **(builder's call)**

## Approaches considered (whole design)

1. **One change, new `volunteer-schedule` capability (chosen).** New shift and site-hours storage in migration 057, RPCs for the writes, and three surfaces: the Schedule screen, My profile and the Season settings sections. It touches Roster, Workload and the sidebar. It delivers the Nov 6 decision at once, but it is a large change for Dec 6.
2. **Split: schedule now, profile and availability later.** Faster to the first merge. But the Nov 6 hint would be missing while admins first schedule, and volunteers couldn't see their week anywhere but the Schedule.
3. **Schedule only.** The smallest change. Admins would schedule blind to availability, which is the pain the interviews named.

The user picked approach 1.

## Goals, non-goals, anti-goals

**Goals:**
- An admin fills a day's open hours knowing who usually comes and where the gaps are.
- Every rostered volunteer can see the schedule and their own week.
- Every drag has a button alternative.

**Non-goals:**
- One-off closed dates.
- Hours on usual days.
- Moving a shift to another person in one step.
- Client appointments (docs/spec.md §7.2 keeps them out).
- Notifications about shifts.
- Shift swaps requested by volunteers.
- Mobile layouts (#147).

**Anti-goals:**
- Usual days leaking to other volunteers.
- Coverage showing OK because of uncleared or remote people.
- A drag-only interaction.

## Open questions

- **OQ1, resolved 2026-11-21 (user): hide the shifts of a volunteer with no sign-in from non-admins.**
  - Admins can schedule a volunteer with no sign-in. Admins see the row tagged "No sign-in".
  - Non-admin staff see no row and no shift for that person, in the read-only Schedule, the realtime feed and every RPC answer.
  - This keeps the volunteer-roster requirement "A volunteer with no sign-in is visible only to admins" unchanged.
  - The coverage row is the same for everyone, because such shifts never count (the person can't be cleared).
  - Rejected alternatives: show the row unnamed; refuse to schedule people with no sign-in.
- **OQ2: PCDC's real site hours.** Owner: the team. They affect only the seed, which uses fictional hours until then.
- **OQ3: the Dec 6 target.** Owner: the user. If the change runs late, the Workload column and the seeded shifts are the first things to cut.

## Dependencies

- **Ready:** 044 roster, 045 clearance, 046 workload, 047 accounts, 049 realtime pattern, 052 Season settings and site coordinators.
- **Mockable:** none needed.
- **Unknown:** none.

## Acceptance (as agreed)

**Deliverables:**
- Migration 057: tables, RPCs, RLS, realtime.
- Views and controller changes.
- Delta specs: new `volunteer-schedule`; modified `season-settings`, `volunteer-roster`, `volunteer-workload`, `volunteer-clearance` (setup-screen sidebar), `local-seed-data` (site hours, usual days, a few shifts).

**Checks:**
- `npm test`.
- `npm run db:migrate:test` and `npm run test:database`.
- `npm run test:browser`.
- Not `build:hant`: these are staff screens only.
- `test:auth-browser` only if sign-in is touched.

## Update 2026-11-22: overlap with main's My profile (#262)

**What happened.** At archive time, main had merged a separate My profile change (`add-my-profile`, #262, then #264 and #265; migration `057_my_profile.sql`). It had already shipped:
- `volunteer_profiles.usual_days text[]` (`mon`…`sun`);
- `vitally_my_profile()` and `vitally_save_my_profile()`;
- a My profile page opened from the sidebar's account row for cleared windows only;
- admin editing of usual days on the Roster;
- its own rebuilds of `vitally_my_clearance` and `vitally_save_volunteer`.

This change had built overlapping versions of all of these.

**Q11. How to reconcile?** Options: adopt main's My profile; keep this change's model and convert main's; pause and talk to the team.
→ **Adopt main's My profile** (user, 2026-11-22).
- Drop this change's usual-days column and validator, `vitally_my_profile`, `vitally_save_my_usual_days`, its My profile page, its Roster usual-days toggles and its usual-days requirements.
- The Add-shift hint and the seed read main's `usual_days`.
- Rebuild `vitally_my_clearance` from main's 057 body. Stop replacing `vitally_save_volunteer`.
- Renumber to 058.
- Add only "Your shifts this week" to main's page, through a new `vitally_my_shifts()`.

**Q12. Who sees "Your shifts this week"?** Options: follow main (cleared only); open My profile to uncleared viewers.
→ **Follow main: cleared only** (user, 2026-11-22). Uncleared rostered volunteers keep the read-only Schedule. This narrows the original Q5 answer for My profile only; the Schedule still goes to every rostered viewer.

**Unchanged:** the Schedule, coverage, site hours and targets, drag, the Workload column, and live updates on the Schedule.

**Q14. What does a seed re-run do with a fictional person who holds an admin's shift?** This came up at the pre-archive merge of main's #267, which added three previous-season fictional people that a re-run deletes and re-creates. Main's seed spec says the re-run deletes them; this change's seed spec says a re-run leaves every admin-added shift alone. Deleting the person would cascade-delete the shift. Options: record the exception; follow main's spec and narrow ours.
→ **Record the exception** (user, 2026-11-22). Such a person, current or previous-season, is kept with their shift and roster entries. The delta spec MODIFIES main's two seed requirements to say so, and tasks.md group 9 adds the test and tidies the guard.

**Q13. What re-reads on a site-hours change?** The final review found the spec saying a change to shifts or schedule settings re-reads My profile's shifts and the Workload hours, while the code re-reads those two only on shift changes (and a new season). Options: narrow the spec; change the code to match.
→ **Narrow the spec** (user, 2026-11-22). Site hours and targets can't change the caller's shifts or anyone's hours, so the extra reads would be wasted. A change to shifts or schedule settings re-reads the open Schedule. A change to shifts re-reads My profile's shifts and the Workload hours. No code change.
