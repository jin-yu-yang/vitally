## Why

The season only moves when someone edits `workspaces.current_season` by hand. Nothing resets the roster or removes sign-ins, and the capability mirror goes stale (#240). Staff views also mix every season's cases, even though client numbers repeat across seasons. Before the pilot, PCDC presses Start next season once (2026 → 2027). It has to leave a clean new season: only the site coordinator who started it on the roster, nobody else signed in, and last season out of the way and safe from edits. This is #138's next "Before Dec 21" item.

## What Changes

**Start next season (new)**
- A site coordinator presses "Start next season…" on Season settings. They type the new filing year to confirm, and the dialog reminds them to export this season's CSV. The season moves forward by one only.
- The rollover is refused while any of these exist. The refusal lists each with its count:
  - open cases in any season, meaning every stage but Draft, Accepted and Closed;
  - open follow-ups;
  - claimed help requests;
  - unclaimed help requests on a case. Ones with no case carry over.
- Otherwise, in one transaction, it does all of this:
  - keeps the default follow-up person if they are a site coordinator, or moves the default to the starter;
  - sets the new season;
  - adds the starter to the new roster with no roles;
  - deactivates every invited or active staff account that isn't a site coordinator's;
  - recomputes the `people.capabilities` mirror;
  - records the rollover.

  Clients and site coordinators keep their accounts, and at least one site coordinator always remains.
- One RPC, `vitally_start_next_season`, takes an action id. Its order is FORBIDDEN → workspace lock → receipt replay → CONFLICT → VALIDATION → refusal counts.

**Past seasons are read-only**
- From: every case can be written whatever its season.
- To: the database refuses any write to a case whose season isn't current, with `INVALID_TRANSITION` (`PAST_SEASON`).
- Reason: past-season cases are finished, and they can't be fixed without reaching them in the app.
- Impact: non-breaking for the current season.

**Staff views show only the current season**
- From: `listCases` loads every case in the workspace.
- To: for staff, it loads cases with `season = current_season` and drafts (`season is null`). A staff window opening a past-season case goes to its home screen.
- Clients still see their own past-season applications, read-only. Read access is unchanged.

**Open work counts only current-season cases**
- From: being preparer or reviewer on any case that isn't Closed is open work, in any season.
- To: only current-season cases (and drafts) count. Current-season Accepted cases still count.
- Reason: a returning volunteer can't be held by a past case that can never be reassigned.
- Impact: affects Deactivate and volunteer saves.

**Exit Form tax year**
- From: the Exit Form shows the case's season as the tax year.
- To: it shows season − 1, matching season-settings' "<season> for TY <season − 1>".

**Migration 055** drops `vitally_private.capabilities_before_052`. 052 is deployed and confirmed, so nothing is left to restore from it.

## Capabilities

### New Capabilities
- `season-rollover`: covers all of this:
  - Start next season: who can press it, the dialog, the refusals, and what it changes;
  - its RPC and history;
  - past seasons being read-only;
  - clients keeping their past applications.

### Modified Capabilities
- `staff-case-work`: staff screens list only current-season cases and drafts. Read access is unchanged.
- `volunteer-clearance`: the mirror is recomputed when the season starts. This replaces the "later change" sentence.
- `volunteer-roster`: open work for a volunteer save counts only current-season cases.
- `sign-in-accounts`: open work for Deactivate counts only current-season cases.
- `review-and-corrections`: the Exit Form's tax year is the case's season − 1.

## Impact

- **Database.** Migration 055:
  - `vitally_start_next_season` and a rollover history table;
  - the `PAST_SEASON` check in `vitally_private.lock_case`, and in the case writes that don't use it;
  - `open_work` scoped to the current season;
  - drops `capabilities_before_052`.
- **Browser.**
  - `src/supabase-store.mjs`: `listCases` and `getCase` for staff;
  - the Season settings view and controller, for the button, the dialog and the refusal list;
  - `src/app.mjs`: the Exit Form tax year.
- **Tests.**
  - database suite: rollover, past-season refusals, open-work scoping, and the returning-volunteer case;
  - unit tests: views and controller;
  - browser story: the Season settings dialog, setup and no-access windows, and the Exit Form.
- **Deploy.** The hosted `migrate` run for 055 after merge. No Edge Function and no email.
- **Out of scope:**
  - reaching past seasons in the app, and who may read them;
  - the season data export;
  - the returning-volunteer picker;
  - My profile (#242).
