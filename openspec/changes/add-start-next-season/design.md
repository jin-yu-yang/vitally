## Context

A workspace's season is `workspaces.current_season` (010). It drives these:
- client numbers, unique per `(workspace, season)`;
- the roster: `roster_entries` and `certificates` are per season;
- the capability mirror: `people.capabilities` equals the current-season roles while a person has a sign-in (052);
- the Season settings label, "<season> for TY <season − 1>".

A case gets `season` when it leaves Draft. Drafts have `season = null`.

Nothing moves the season today. #240 lists what Start next season must pick up from 052:
- recompute the mirror, because its triggers don't fire on `workspaces`;
- drop `capabilities_before_052`;
- keep site coordinators;
- take the workspace lock before `deactivate_account`;
- put the starter on the new roster with no roles.

Constraints:
- Fictional data only.
- Migrations are final once applied.
- 052 and 053 are deployed on hosted.
- Before the pilot, this runs once on hosted (2026 → 2027).

The case-writing RPCs that go through `vitally_private.lock_case`:
- `vitally_apply_action` (the dispatcher for every case move and edit);
- `vitally_close_unsigned`;
- `vitally_log_contact`;
- `vitally_edit_contact`;
- `vitally_set_case_label`.

`vitally_assistance_action` acts on `assistance_items`, which may name a case. It does not lock the case. `vitally_create_case` makes new cases in the current season.

The brainstorm (`brainstorm.md`) records the decisions and who made them. This document organizes them for building.

## Goals / Non-Goals

**Goals:**
- One site-coordinator action moves the season forward by one, all or nothing. It is refused, with counts, while anything is unfinished.
- After it, the new season has only the starter on its roster, no other staff sign-ins, a valid default follow-up person, and a correct mirror.
- Past-season cases are read-only in the database. Staff screens don't load them. Clients still see their own.
- Open work never counts a past-season case.
- The Exit Form's tax year is season − 1.
- Migration 055 drops `capabilities_before_052`.

**Non-Goals:**
- Any in-app way to reach past-season cases, or a narrower read policy for them. That is a later change, with the season export.
- The season CSV export itself. The dialog only reminds.
- The returning-volunteer picker, and My profile (#242).
- Moving the season backwards, or by more than one.
- Changing client accounts, or what clients read.

## Decisions

### D1. One RPC, one transaction
- **Choice:** `public.vitally_start_next_season(p_action_id uuid, p_expected_season smallint, p_typed_year smallint) returns jsonb`, security definer, granted to `authenticated`. All of it runs in one transaction under the workspace advisory lock. That is the lock `vitally_save_volunteer` takes: `pg_advisory_xact_lock(hashtextextended(workspace_id::text,0))`.
- **Why:** all or nothing. It also satisfies `deactivate_account`'s last-site-coordinator check, which assumes the caller holds the lock. The internal deactivate exists so a rollover can reuse it (sign-in-accounts).
- **Alternatives:**
  - browser-driven steps: could leave a partial rollover, and the lock isn't held across steps;
  - an Edge Function: a deployable with no need, since no email or auth-admin call is involved.

### D2. Order of checks
- **Choice:** FORBIDDEN (the caller isn't an active site coordinator of their workspace) → workspace lock → receipt reserve/replay (operation `START_NEXT_SEASON`, digest of the arguments) → `CONFLICT` (`current_season ≠ p_expected_season`) → `VALIDATION` (`p_typed_year ≠ p_expected_season + 1`, or `p_expected_season + 1 > 2100`) → the refusal counts.
- **Why:**
  - FORBIDDEN first stores no receipt, as in every site coordinator RPC.
  - The replay comes before CONFLICT, so a retry after a lost reply gets its stored answer. This is the #238 Mark reviewed lesson.
- **Alternatives:** CONFLICT before replay. Rejected: a retried success would read as a conflict.

### D3. The refusal counts
- **Choice:** refuse with `VT004` `SEASON_NOT_FINISHED`. The detail is a JSON object with four non-negative counts, and the refusal is raised only when one is above 0:
  - `openCases`: cases in the workspace with `stage not in ('draft','accepted','closed')`, any season;
  - `openFollowups`: `admin_followups.status='open'`;
  - `claimedHelp`: `assistance_items.status='assigned'`;
  - `unclaimedHelpOnCases`: `assistance_items.status='open' and case_id is not null`.

  The dialog shows one line per count above 0:
  - "N open cases";
  - "N open follow-ups";
  - "N claimed help requests";
  - "N unclaimed help requests on cases".

  Singular wording is used when N is 1.
- **Why:** these are settled decisions Q1 and Q3. They count across seasons, because a past-season case that is still open could never be closed once read-only. Close unsigned cases is the precedent. Help requests with no case carry over.
- **Counts only, no links (deliberate, for this change):** each line is a count with no link to the list it counts. The office finds the cases, follow-ups and help requests on the screens it already uses.
- **Alternatives:**
  - a per-person `OPEN_WORK` list. Rejected: what the office needs is counts per kind.
  - lines that link to filtered lists. Left out of this change.

### D4. What a rollover changes, in order
1. **The default follow-up person.** If `default_followup_person_id` is not a site coordinator, set it to the starter. The starter is an active site coordinator, so `can_be_default_followup` holds. This runs before step 4, because `open_work` counts "default follow-up person".
2. **The season.** Set `workspaces.current_season = p_expected_season + 1`. Client numbers in the new season start at 1, because the counter is per `(workspace, season)`.
3. **The starter's roster entry.** Insert one row for the new season with no roles: `added_by` the starter, `is_new = false`, no photo ID check. No certificates are copied.
4. **Deactivate.** For each `accounts` row in the workspace whose membership access is `staff`, whose status is `invited` or `active`, and which isn't a site coordinator, in `person_id` order, call `vitally_private.deactivate_account(workspace, user_id, starter)`. Clients, deactivated accounts and site coordinators are skipped. No email is sent. An `invited` account's pending invitation stays cancelled as deactivation leaves it (047's rules).
5. **The mirror.** Recompute `people.capabilities` for every person in the workspace, using the same expression the 052 triggers use. After this, everyone's mirror reflects the new season's roles: none, except what the starter later adds.
6. **History.** Insert one `season_starts` row with:
   - `workspace_id`;
   - `from_season` and `to_season`;
   - `started_by_person_id` and `started_at`;
   - `default_followup_from` and `default_followup_to`, both null when unchanged;
   - `deactivated_count`.
7. **Receipt.** Store and return `{actionId, season, deactivated, defaultFollowupMoved}`.
- **Why:** this order is the user's (Q4, Q5). The default moves first and the season is set before the deactivations, so `open_work` (D6) sees the new season. Then no current-season case can hold anyone, and the ordinary `deactivate_account` works unchanged.
- **Alternatives:** a rollover-only deactivate that skips open work. Rejected: it would leave returning volunteers held by past cases (D6).

### D5. Past seasons are read-only
- **Choice:**
  - `vitally_private.lock_case` raises `VT004` `INVALID_TRANSITION` with detail `PAST_SEASON` when the locked case's `season` is not null and isn't the workspace's `current_season`. That covers all five lock_case RPCs, for staff and clients alike.
  - `vitally_assistance_action` gets the same check when its item names a case.
  - Planning inventories any direct table grants or storage policies that write case rows (for example document uploads) and adds the same refusal there.
  - A database test calls every case-writing RPC on a past-season case and expects `PAST_SEASON`.
- **Why:**
  - one choke point covers the RPCs;
  - the refusal code matches "not available" moves;
  - drafts (`season is null`) stay writable, so a leftover draft submits into the new season.
- **Alternatives:** hiding buttons only. Rejected: the settled decision says enforced in the database.

### D6. Open work counts only current-season cases
- **Choice:** in `vitally_private.open_work`, the preparer and reviewer branches add `and (c.season = ws.current_season or c.season is null)`. The follow-up and help branches are unchanged: after a rollover none can be open on a past case, and a past case can't gain one. Current-season Accepted cases still count, as today.
- **Why:** the user's decision (Q4). Otherwise a returning volunteer stays "preparing client 31" through an Accepted past-season case that can never be reassigned. That would block a later role removal or Deactivate in the new season.
- **Alternatives:**
  - excluding Accepted everywhere: changes current-season behaviour;
  - clearing preparer and reviewer on past cases: rewrites history.
- **Test:** a returning volunteer with a past-season Accepted case has Preparer removed in the new season, and the save succeeds.

### D7. Staff load only the current season
- **Choice:**
  - In `src/supabase-store.mjs`, `listCases()` adds `.or("season.eq.<current>,season.is.null")` to the cases query when the caller is staff (`isStaffAccess`). The current season comes from the workspace row the store already reads.
  - `getCase(id)` returns nothing to staff for a past-season case. The controller then treats it as unavailable and sends the window to its home screen, as it does for screens that are no longer allowed.
  - Clients' queries are unchanged.
  - Realtime needs nothing new: it re-reads through `listCases`, and the rollover's `workspaces` change already makes every window re-read (`controller.mjs:1137`).
- **Why:** the user asked for past-season rows not to be loaded at all, not only hidden in views. Client numbers repeat across seasons.
- **Alternatives:** a filter in the views only. Rejected by the user.

### D8. The Season settings UI
- **Choice:**
  - Site coordinators see a "Start next season…" button in a new "Next season" card on Season settings. Other admins see the card's text without the button.
  - The dialog is titled "Start the <season+1> season". It explains, in words close to these:
    - who keeps sign-in (site coordinators);
    - who loses it (everyone else on staff);
    - that the roster starts with only you.
  - It reminds: "Export this season's roster and cases first if you need them." It has one field, "Type <season+1> to confirm", and the confirm button stays disabled until the field equals that year.
  - A `SEASON_NOT_FINISHED` refusal keeps the dialog open and lists D3's lines under "Finish these first:".
  - A `CONFLICT` makes the page re-read Season settings and close the dialog, saying "The season has already moved."
  - On success, every window re-reads:
    - the starter lands on "Finish your setup";
    - other site coordinators keep the admin screens, and their Roster shows only the starter;
    - everyone else's open window shows "This account has no access" the next time it wakes (focus, the tab becoming visible, `online`, or a realtime reconnect), without a reload.
  - Staff screens stay English.
- **Why:** Season settings is where site coordinators already govern the season (052).
- **Alternatives:** a button on the Roster. Rejected: the Roster is per season, and the action is about the workspace.

### D9. Exit Form tax year
- **Choice:** in `src/app.mjs`, the Exit Form passes `taxYear: season - 1`. The fallback is `state.workspace.currentSeason - 1`, and the hard-coded `2025` is dropped. A case always has a season once it can reach the Exit Form, so the fallback is defensive only. In the delta, review-and-corrections' header requirement says "the tax year (the case's season − 1)", and its scenario changes to season 2026 → 2025.
- **Why:** this resolves the conflict with season-settings' "<season> for TY <season − 1>".

### D10. Migration 055
- **Choice:** `055_start_next_season.sql` includes all of this. (`main` took 054 for `054_return_to_signing_exit_forms.sql`.)
  - the `season_starts` table, RLS on, with no grants to signed-in users;
  - `lock_case` with the past-season check;
  - `vitally_assistance_action` with the same check;
  - `open_work` scoped to the current season;
  - `vitally_start_next_season`;
  - `drop table vitally_private.capabilities_before_052`.

  Each replaced function is copied from its latest migration with marked `-- 055` lines, as 052 did.
- **Why:**
  - 052 is deployed and confirmed, so nothing will be restored from its copy (the user's correction);
  - no later migration is needed.

## Risks / Trade-offs

- **[Risk] A past-season write path is missed** (a direct grant or a storage policy), so a past case stays writable. → **Mitigation:** the D5 inventory, plus a database test that sweeps every case-writing RPC and every direct write grant on case tables.
- **[Risk] A long transaction on a large roster.** → **Mitigation:** the workspace is small (tens of staff). One loop, no network calls.
- **[Risk] An irreversible action pressed by mistake.** → **Mitigation:**
  - only site coordinators can press it;
  - the year must be typed;
  - the refusal blocks it while work is open;
  - deactivated people can be reactivated one by one, though their roster entry must then be re-recorded for the new season.
- **[Trade-off] Past-season cases are unreachable in the app until a later change.** → Accepted: before the pilot this leaves only December's fictional data behind.
- **[Trade-off] Cleared staff can still read past-season rows directly.** Read access is unchanged. → Accepted. Narrowing it is a compliance decision for the later change.
- **[Risk] Scoping `open_work` changes ordinary Deactivate and volunteer saves.** → **Mitigation:** current-season behaviour is unchanged, including Accepted. Only past-season cases stop counting, and that is tested.
- **[Risk] `capabilities_before_052` is dropped before someone wants it.** → Accepted. The user confirmed 052 on hosted.
- **[Trade-off] A deactivated person's open window switches to "This account has no access" only on its next wake (D8).** Data access ends at once: RLS and the RPCs refuse every read and write from the moment the start commits. Only the screen switch waits, so a window left untouched keeps showing what it had already loaded. → Accepted (user, at verify). An instant switch would need new polling, since a deactivated user gets no realtime.

## Migration Plan

1. No local Docker or local stack. While iterating, push the branch and run only the changed database files with `gh workflow run database-quick.yml --ref add-start-next-season -f files="<tests/database-*.mjs>"`.
2. The final checks are the PR's full CI run (checks, database, sign-in, story), linked in `verify.md`. 055 changes functions and adds and drops tables but rewrites no existing rows, so the "local stack with main's migrations" rule does not apply.
3. After merge, on the same day: run the hosted `node --env-file=.env.admin tools/admin/migrate.mjs --target classroom`, with `NODE_EXTRA_CA_CERTS` set.
4. Press Start next season on hosted only when the office decides: 2026 → 2027 before the pilot.

Rollback: there is no down migration. A wrong rollover is undone by hand, with an operator script (out of scope), from the `season_starts` row and the deactivation history.

## Open Questions

None outstanding. These are left to planning:
- the exact dialog wording (English only, staff text);
- the list of direct write grants the D5 inventory finds.
