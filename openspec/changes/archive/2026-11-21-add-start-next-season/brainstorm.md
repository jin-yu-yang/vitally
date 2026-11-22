<!--
Raw capture of the brainstorm for add-start-next-season (#240, part of #138).
The design was agreed with Hailey in the explore session on 2026-11-21. The project
decisions doc "start-next-season-decisions.md" (decided Nov 21) was not on disk or
among the user's artifacts during the session; the settled list below is the one the
user pasted at the start of the session.
-->

# Brainstorm: Start next season

## Background

- #138 (volunteer roster) is almost done: roster records (044), clearance (045), accounts (047),
  season settings and site coordinators (052), clearance uploads (053). Start next season is the
  next item on #138's "Still to do (Before Dec 21)" list.
- #240 lists what Start next season must pick up from Season settings (#237):
  1. recompute the `people.capabilities` mirror for everyone when `workspaces.current_season`
     changes. The mirror's triggers fire only on writes to `people` and `roster_entries`;
  2. drop 052's `vitally_private.capabilities_before_052`;
  3. keep site coordinators' accounts active across the rollover, with at least one always remaining;
  4. take the workspace lock before calling `deactivate_account`, because its
     "last site coordinator" check relies on the caller holding the lock;
  5. add the person who starts the season to the new roster **with no roles**. A role can't exist
     before its certificates. Since 052 a site coordinator reaches the Roster and Season settings
     through the flag, so they tick their own certificates and add roles afterwards.
- Why now: before the pilot this is pressed once (2026 → 2027). It leaves only December's
  fictional test data behind.

### What the code says today

- `workspaces.current_season` (010) is the only season marker. A case gets `season` and its client
  number when it leaves Draft. A draft has `season = null` and joins the season that is current
  when it is submitted.
- Client numbers are unique per `(workspace, season)`.
- `listCases()` (`src/supabase-store.mjs:536`) loads every case in the workspace with no season
  filter. It serves both clients and staff.
- Realtime announces `{table, id}`, and the controller reads the list again through `listCases`.
  A workspace row change already makes every window re-read (`controller.mjs:1137`).
- `getCase(id)` (`supabase-store.mjs:637`) reads a case by id.
- `vitally_private.open_work(workspace, person)` (045) defines one person's open work:
  - preparer or reviewer on a case that isn't closed;
  - an open follow-up assigned to them;
  - being the default follow-up person;
  - an assigned help request.
- `vitally_private.lock_case` is the shared case lock, used by 33 call sites. Some case writes don't
  use it: labels, the contact log, help requests.
- `assistance_items`: `case_id` is nullable; status is `open`, `assigned` or `resolved`.
- `capabilities_before_052` is keyed by `(workspace_id, person_id)`.
- The Exit Form (`src/app.mjs:1920-1928`) passes `taxYear: season`, with a hard-coded `2025`
  fallback. review-and-corrections says the Exit Form shows "the tax year (the case's season)".
  season-settings says the label is "<season> for TY <season − 1>". **This is a spec conflict.**
- `deactivate_account`'s internal function acts on one membership "so a season rollover can reuse
  them" (sign-in-accounts).

## Settled before the session (not re-asked)

- Only site coordinators can start the next season. The user types the new filing year to confirm.
  The season moves forward by one only.
- It is refused while this season has open cases, open follow-ups or claimed help requests. The
  refusal lists them with counts.
- The confirmation only reminds the user to export this season's CSV. No export is required.
- The new roster holds only the starter, with no roles. Everyone else loses sign-in. Site
  coordinators' accounts stay active, and at least one always remains.
- Recompute the `people.capabilities` mirror, drop `capabilities_before_052`, and take the workspace
  lock before `deactivate_account`.
- Option A: staff views show only current-season cases; past seasons are read-only.
- Fix the spec conflict: the Exit Form's tax year becomes season − 1.

## Decision chain

### Q1. Which case stages count as open?

How each stage can still leave once only site coordinators can sign in:

```
stage                 way out for an admin              open?
--------------------  --------------------------------  -----
draft                 (no season yet)                    no
received ..reviewing  Close, with a reason               yes
review_approved       Close unsigned cases (season end)  yes
on_hold               Close / Got in touch               yes
ready_to_efile        Mark e-filed, or Close (withdrawn) yes
efiled                Record filing result only          yes
rejected              Close, or Return to signing        yes
accepted              terminal                           no
closed                terminal                           no
```

**Decision:** open = every stage except `draft`, `accepted` and `closed`, **counted across all
seasons**. Past seasons become read-only, so an open case left in an older season could never be
closed. Close unsigned cases already lists cases "whatever its season", which is the precedent.

### Q2. Where are past-season cases reached from?

The alternatives were:
- a "Past seasons" screen;
- a season picker on the case board;
- not reachable in this change.

**Decision: not reachable in the app in this change.**
- Staff views show only the current season: cases with `season = current_season`, plus drafts with
  `season = null`.
- Read access is unchanged. Cleared staff may still read past-season rows; we only stop showing
  them.
- Past seasons are read-only, enforced in the database. Writes to a case whose season isn't current
  are refused.
- A way to reach past seasons, and whether only admins may read them, is a later change, likely
  together with the season data export.
- Reason: before the pilot this is pressed once (2026 → 2027), and it leaves only December's
  fictional test data behind.

### Q3. Unclaimed help requests

Unclaimed help requests (`status = 'open'`) on a case would be stranded: the case is hidden and
read-only. One can exist on a case that isn't open, for example an Accepted client asking a
question.

The alternatives were:
- block the rollover on them;
- auto-resolve them with a fixed note;
- leave them claimable, as an exception to read-only.

**Decision: block.** Unclaimed help requests on a case are a fourth refusal line ("N unclaimed help
requests on past cases"). Ones with no case carry over.

### Defaults proposed and accepted (with the user's corrections)

1. **Read-only refusal.** `INVALID_TRANSITION` with detail `PAST_SEASON`, raised in
   `vitally_private.lock_case`. The case writes that don't go through it (labels, contact log, help
   requests and others found during planning) get the same check. A database test calls every
   case-writing RPC on a past-season case.
2. **The RPC.** `vitally_start_next_season(action_id, expected_season, typed_year)`.
   **Order (user correction):** FORBIDDEN → workspace lock → receipt replay → CONFLICT (the season
   already moved) → VALIDATION (the typed year isn't `expected_season + 1`) → open work (the four
   counts). The replay must come before CONFLICT, otherwise a retry after a lost reply gets CONFLICT
   instead of its stored answer. That is the same problem as #238's Mark reviewed retry.
   If nothing refuses, in one transaction it does all of this:
   - deactivates each account through the internal deactivate function;
   - adds the starter's roster entry with no roles;
   - sets `current_season + 1`;
   - recomputes the mirror;
   - writes a history row;
   - stores the receipt.
3. **Accounts.** Invited and active **staff** accounts that are not site coordinators are
   deactivated. Already-deactivated accounts and all client accounts are untouched. No email is sent.
4. **Afterwards.**
   - The starter has no roles, so their window goes to "Finish your setup".
   - Other site coordinators are listed as "not on this season's roster".
   - Everyone else's window shows "This account has no access".
5. **Where it lives.** A "Start next season…" button on Season settings, for site coordinators only.
   The dialog asks for the typed year and gives the CSV export reminder. A refusal lists the counts
   there.
6. **History.** One row per rollover records who started it, when, and from which season to which.
   Nothing shows it in the app yet.
7. **`capabilities_before_052` (user correction):** drop it in migration 054 itself. 052 is deployed
   on hosted and confirmed, so nothing will be restored from it. No row deletes in the RPC and no
   later migration.
8. **Exit Form.**
   - The tax year is season − 1, and the fallback is `current_season − 1`, not `2025`.
   - review-and-corrections' delta says "the case's season − 1".
   - The TaxSlayer-date rule ("from 1 January of the case's season") stays as it is: returns are
     filed in the season's year.
9. **Migration 054.**
   - The local Supabase stack is ready.
   - No Edge Function.
   - The hosted migration runs after merge.
10. **Checks.**
    - `npm test`;
    - `npm run db:migrate:test` with `npm run test:database`;
    - `npm run test:browser`, for the Season settings dialog, the setup and no-access windows, and
      the Exit Form tax year. CI may stand in under the project's rule.
    - `test:auth-browser` isn't needed unless sign-in code changes.

### Additions from the user

- **Clients still see their own past-season applications, read-only.** Read access is unchanged, and
  `lock_case` refuses writes. This goes in the delta specs, so the current-season filter applies to
  staff views only.
- **The current-season filter goes in `listCases`' query** (`season = current or season is null`),
  not only in the views, so past-season rows aren't loaded. Finding: `listCases` serves clients too,
  so the filter applies only when the caller is staff (`isStaffAccess`). Realtime needs no separate
  filter, because it re-reads through `listCases`.
- **Direct open of a past-season case (accepted default).** For staff, a case whose season isn't
  current is treated as unavailable. A restored or stale window goes to the home screen, as it does
  for other screens that are no longer allowed.

## Approaches considered for the rollover itself

| Approach | Trade-off | Picked? |
|---|---|---|
| **A. One database RPC, one transaction** (refuse → deactivate loop through the internal function → roster → season → recompute) | All or nothing. It reuses the deactivate internals and the workspace lock. A long transaction, but the workspace is small. | **Yes** |
| B. Browser-driven steps (deactivate each account, then move the season) | Partial rollovers if a step fails; the "last site coordinator" check isn't held under one lock | No |
| C. Edge Function orchestrating several RPCs | Adds a deployable without need, since no email or auth-admin call is involved | No |

Approach A is the one the existing specs prepared for: the internal deactivate function "so a season
rollover can reuse them", and the workspace lock note in #240.

## Scope in one sentence

**In:**
- a site-coordinator-only "Start next season" action that moves the workspace's season forward by
  one, refused with counts for:
  - open cases (any season);
  - open follow-ups;
  - claimed help requests;
  - unclaimed help requests on cases;
- otherwise it resets the roster to the starter, deactivates non-site-coordinator staff accounts,
  recomputes the mirror and records the rollover;
- staff views show only the current season, and past-season cases are read-only in the database;
- clients keep their own past applications, read-only;
- the Exit Form shows tax year season − 1;
- migration 054 drops `capabilities_before_052`.

**Out:**
- any in-app way to reach past seasons, and who may read them;
- the season data export;
- the returning-volunteer picker;
- My profile (#242).

## Dependencies

| Dependency | State |
|---|---|
| Local Supabase stack (`$VITALLY_STACK`) | ready |
| CI jobs: checks, database, sign-in, story | ready |
| Hosted migrate of 054 after merge (needs `NODE_EXTRA_CA_CERTS`) | ready |
| Edge Function / email | none needed |

## Builder check (fresh reviewer) and the answers

A fresh reviewer read this document as a builder would. It raised five questions. Three were answered from the code; two went to the user.

### Answered from the code (user agreed)

- **A late rejection on a past-season case.** Accepted is terminal, and E-filed is counted as open (Q1), so no past-season case needs Record filing result. `PAST_SEASON` needs no exceptions.
- **Returning clients.** The client home always offers "Start an application" (`src/client-views.mjs:159`), so an Accepted 2026 client can start a 2027 application. Nothing changes here.
- **An invited site coordinator.** This can't exist. Granting site coordinator needs an `active` account (`NO_ACTIVE_ACCOUNT`), and deactivating removes the mark.

### Q4. Accepted cases in `open_work` would block every deactivation

`vitally_private.deactivate_account` (052) refuses `OPEN_WORK` whenever `open_work` (045) returns a row. `open_work` counts preparer and reviewer on any case with `stage <> 'closed'`, so Accepted cases count. Nearly every preparer and reviewer has one.

The alternatives were:
- a rollover-only deactivate that skips the check;
- excluding Accepted everywhere;
- clearing preparer and reviewer on Accepted cases.

**Decision (user): change `open_work` to count only current-season cases** (`season = current_season or season is null`). With a rollover-only skip, a returning volunteer who prepared a case last season could never later lose a role or be deactivated in the new season: they would still be "preparing client 31", an Accepted past-season case that can't be reassigned because past seasons are read-only. Past-season cases have nothing left to finish, so this follows from the read-only rule. The current season's Accepted cases still count, as today; that stays as it is. Ordinary Deactivate and volunteer saves get the same scoping.

So the rollover needs no special deactivate. **The order inside the RPC:** move the default follow-up person → set `current_season` → deactivate through the ordinary `vitally_private.deactivate_account`.

**New test:** a returning volunteer with a past-season Accepted case can have Preparer removed in the new season.

### Q5. The default follow-up person may not be a site coordinator

`can_be_default_followup` (052 §8) allows a site coordinator or anyone with `followup` (the Admin role). An Admin who isn't a site coordinator would be deactivated, and four case actions assign new follow-ups to the default.

The alternatives were:
- keep or move the default;
- refuse with a fifth line. There is no screen to change the default.
- clear it to null. New follow-ups would then fail.

**Decision (user): keep the default if they are a site coordinator; otherwise move it to the starter.** This must run before the deactivations, because `open_work` counts "default follow-up person". The history row records the move.

## Review of the planning artifacts (user, 2026-11-21)

The user approved the artifacts, with these changes:
1. **No Start next season walk in the browser story.** The story is at ~590 s of 900 s, and new admin-screen walks get their own test, as Season settings and uploads have. It is a separate Chrome test with its own workspace. The story changes only its Exit Form assertion, to season − 1.
2. **No local Docker anywhere.**
   - While iterating: `gh workflow run database-quick.yml --ref add-start-next-season -f files="<the changed tests/database-*.mjs>"`.
   - Final checks: the PR's full CI run, linked in `verify.md`.
   - The migration changes functions and adds and drops tables but rewrites no existing rows, so the "local stack with main's migrations" rule does not apply.
   - Every subagent is told the same.
3. **Wording:** "unclaimed help requests on cases", not "on past cases". Before the start they are on current-season cases.
4. **The refusal lists counts without links to the lists.** This is a deliberate choice for this change.

Also found while applying these: `main` had already taken migration 054 (`054_return_to_signing_exit_forms.sql`, from #205), so this change's migration is **055**. The rollover's database test file is `tests/database-start-next-season.mjs`.
