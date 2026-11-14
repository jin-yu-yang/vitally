## Why

The site coordinator cannot see who is carrying how many cases, which cases have stopped
moving, or hand a case to someone else. When a volunteer is ill, has a schedule conflict, or
is simply carrying more than others, the cases they hold wait for them: only the holder can
move a case on. Waiting cases sit until a volunteer claims
them. Issue #139 (part of #129) asks for a Workload view with reassignment. Migration 045
already provides the clearance check that a staff-chosen assignee needs, and left this
change as its first caller.

## What Changes

- **Volunteers gets a Workload tab** next to Roster, for a cleared staff member with
  effective `admin`. An uncleared admin keeps the Roster alone.
- **One row per volunteer whose effective capabilities include `prepare` or `review`,** and a
  tagged row for anyone still holding an Open case without the slot's role (added after the
  PR #195 review). Each
  row shows Open, a Preparing/Review breakdown, Waiting on client and Stalled (no accepted
  action and no contact logged for 5 calendar days). The table is sortable and searchable by
  name. A row expands to that volunteer's cases: case #, the primary taxpayer's full name,
  the stage, Open and Reassign.
- **An Unassigned row** lists cases at Pending intake / filing with no preparer and at
  Pending review with no reviewer, each with Assign.
- **An Assign/Reassign drawer** with search lists only people who can take the slot. It
  orders them: speaks the client's preferred language, then any of the client's languages,
  then the rest; within each group, fewest open cases. It marks the current holder and notes
  anyone hidden for independent review.
- **A new case action, `ASSIGN_CASE {slot, personId, expectedHolderId}`.**
  - It assigns an empty slot with the same effects as the person's own claim, or reassigns a
    full one, at any stage before approval.
  - A mid-review reassignment hands the active review to the new reviewer.
  - It refuses an uncleared assignee or one without the slot's effective capability
    (`INELIGIBLE`), and a preparation participant as reviewer or the current reviewer as
    preparer (`SELF_REVIEW`).
  - It writes a case event naming who assigned whom. An Assign sends the claim's client
    line; a Reassign sends none.
- **Taxpayer names** show in full on the admin-only Workload. The work board, case pool and
  office queue stay nameless. Who can read case data does not change.

**Assigning work to someone else**
- From: no function assigns case work to someone other than the caller. Checks of another
  person read `people.capabilities`.
- To: `act_assign_case` assigns only a cleared person whose effective capabilities include
  the slot's capability, and joins the guard list of assigning functions.
- Reason: assign only work the person can act on.
- Impact: non-breaking. The default follow-up person, follow-up assignee checks and filters
  are unchanged.

Out of scope:
- Hours this week (#140, with the Schedule tab);
- follow-up load and follow-up reassignment;
- notices to people (#150);
- "last season's preparer first" (#146);
- any change to who can read case data;
- extending the browser story.

## Capabilities

### New Capabilities
- `volunteer-workload`: the Workload tab, its counts and Stalled rule, the Unassigned row,
  the Assign/Reassign drawer and its ordering, the `ASSIGN_CASE` action and its handovers,
  case event and client line, and where taxpayer names show.

### Modified Capabilities
- `volunteer-clearance`: "Staff assign work only to a cleared person". The new assigning
  function `act_assign_case` checks the assignee's effective capabilities and joins the guard
  list.

## Impact

- **Database:** one new migration (046, or the next free number at PR time).
  - `vitally_private.act_assign_case`, dispatched from `vitally_apply_action`.
  - `ASSIGN_CASE` in the action checks: authority (effective `admin`), payload and related
    checks.
  - The guard test in `tests/database-clearance.mjs`, and new database tests.
- **Browser:**
  - `src/volunteer-views.mjs` (tabs, Workload, drawer), with a new module for the counts and
    ordering;
  - `src/controller.mjs` and `src/app.mjs` (the tab, the drawer and the action);
  - `src/supabase-store.mjs` (latest contact time per case);
  - `src/contracts.mjs` and `src/case-actions.mjs` (the action);
  - `src/staff-views.mjs` (the history sentence);
  - `src/styles.css`.
- **No change** to sign-in, client text or the intake catalogue.
