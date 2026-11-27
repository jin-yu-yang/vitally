## Context

Migration 059 (`add-remove-from-roster`) added `vitally_remove_from_roster`. It runs in this order:
- FORBIDDEN, VALIDATION and SELF;
- the workspace lock;
- the person's membership, `FOR UPDATE`, when step 13 will deactivate it;
- **ADMIN_ROLE**;
- the receipt;
- invitation expiry;
- the profile, with NOT_FOUND and CONFLICT;
- the current-season entry, with NOT_FOUND;
- FORBIDDEN for a site coordinator;
- OPEN_WORK.

The writes then follow in order: delete the entry, mark the shifts from today on removed, deactivate the account, raise the profile revision, insert into `roster_removals`, store the receipt.

Migration 060 (`add-volunteer-check-in`) added `check_ins`:
- The checks: `checked_out_at > checked_in_at`, and the check-out falls on the check-in's New York date, at the latest the next midnight.
- `vitally_private.open_check_in(workspace, person)`: today's live row with no check-out.
- The self RPCs `vitally_check_in` and `vitally_check_out`. Both test `can_check_in`, which needs a current-season roster entry.
- The admin RPCs `vitally_save_check_in` and `vitally_remove_check_in`. Save refuses `NOT_ON_ROSTER` and `DEACTIVATED`.
- `check_in_item`, which marks a row "Corrected" when `corrected_by_person_id` is set and names that person.
- `check_in_span`: an `out` row counts to its check-out, an `open` row to the earlier of now and the day's end.

Migration 061 moved Save's ADMIN_ROLE check below the receipt lookup and left removal as it was.

The agreed decisions are in `brainstorm.md` (Hailey, cloud session). This document arranges them into a design.

## Goals / Non-Goals

**Goals:**
- A removal leaves the volunteer with no open check-in today. The check-in reads as closed at the removal, corrected by the remover.
- The removal record says whether a check-in was closed.
- The confirmation tells the admin this will happen.
- A replayed removal returns its stored result even if the volunteer has gained the Admin role since.

**Non-Goals:**
- Check-ins from earlier days.
- Admin corrections of check-ins for people off the roster.
- New tags, read fields or answer fields.
- Changes to 060's RPCs, including the lock shapes noted under Risks.
- Editing 059.

## Decisions

### D1: Close today's open check-in instead of refusing the removal
- **Choice:** in the removal's transaction, lock and update the person's live check-in for today (New York) with no check-out, if there is one. It is the row `vitally_private.open_check_in` returns.
- **Why:** after the removal nobody can close the row. Refusing the removal would block an admin who wants the person off the roster now.
- **Alternatives:** refuse while checked in, which needs a new refusal code and UI copy; let admins correct off-roster rows, which changes `vitally_save_check_in` and the drawer and still leaves the row open. Both were rejected in the brainstorm.
- **Earlier days:** left as they are. They already count as missed to their day's end, and `check_ins_on_date` would refuse a check-out today on an earlier row.
- **More than one open row today:** at most one can exist, because `vitally_check_in` refuses `ALREADY_CHECKED_IN` and Save refuses `OVERLAP`. The update targets the rows the `open_check_in` predicate matches anyway, so a stray second row would be closed too. **Proposer's call:** the update uses the predicate, not the single row `open_check_in` returns. `check_in_closed` is true when at least one row changed.

### D2: The check-out time and the same instant
- **Choice:** `checked_out_at = greatest(now(), checked_in_at + interval '1 microsecond')`, the expression `vitally_check_out` uses.
- **Why:** `check_ins_out_after_in` needs a strictly later check-out. A check-in is never later than now, because Save refuses `IN_FUTURE` and self check-in uses `now()`. So the result is the removal time, or one microsecond after a check-in made in the same instant. Both stay inside the check-in's date.
- `updated_at` is `now()`, as Save sets it.

### D3: The row reads as an admin's correction
- **Choice:** `corrected_by_person_id` and `updated_by_person_id` are set to the remover, and `revision` goes up by one, as `vitally_save_check_in`'s edit does.
- **Why:** the Schedule and the drawer then show "Corrected" with the remover's name, with no new column, tag or read field.
- **Alternative:** a dedicated "closed by removal" marker, rejected as a new read field.

### D4: The record and the answer
- **Choice:** `roster_removals.check_in_closed boolean not null default false`. The default keeps earlier rows valid, and the removal always writes the value.
- **Proposer's call:** the RPC answer stays `{actionId, volunteerId, revision, accountDeactivated, shiftsRemoved}`. No screen uses the fact, and new fields are out of scope. `tests/support/rpc-signatures.mjs` is not affected, because the signature is unchanged.

### D5: Lock order (step numbers in 062)
- **Choice:** the workspace lock, the membership, the profile, the entry, the shifts, **the check-in**, then the account. The new step sits between the shift update (059 step 12) and the account (059 step 13). 062's header documents the order.
- **Why:** every other writer of `check_ins` takes the workspace lock first: `vitally_check_in`, `vitally_check_out`, `vitally_save_check_in` and `vitally_remove_check_in`. The removal holds that lock throughout, so it waits on no check-in row that another holder of the workspace lock could hold. Zeye will check for deadlocks on a scratch database, as for 059.

### D6: ADMIN_ROLE after the receipt (#300)
- **Choice:** reorder the checks to: FORBIDDEN, VALIDATION, SELF, the workspace lock, the membership, **the receipt**, **ADMIN_ROLE**, then the rest unchanged.
- **Why:** this is the volunteer-roster rule that a repeated action id returns its stored result, and the order Save has had since 061.
- A refusal raises in the transaction that reserved the receipt, so no receipt is stored and the "no receipt stored" wording in the spec still holds.
- The comment is corrected in 062's function body: "Refused before the receipt is reserved, as Save does" becomes the 061 wording.

### D7: How the migration is written
- **Choice:** `062_close_check_in_on_roster_removal.sql`, hand-written. Its sections:
  - §1 alters `roster_removals`;
  - §2 is `create or replace function public.vitally_remove_from_roster`, copied from 059 §2, with each changed or added line marked `-- 062`, as 061 marks its lines;
  - the same revoke and grant lines.
- **Why:** the convention 061 set. A reviewer can diff 062 §2 against 059 §2.

### D8: The confirmation line
- **Choice:** in `removeFromRosterDialogBody`, an always-present line goes after the conditional shifts line and before the cases line: "If they are checked in now, they are checked out at this moment."
- **Why:** the Roster's read has no check-in state, and no new read field is allowed, so the line can't be conditional.
- The spec's ordered list of confirmation lines is updated to match.

## Risks / Trade-offs

- **[Trade-off] The check-out is the removal time, with no cap at the day's end** (Hailey, at review). Compare today's behaviour:
  - The removal also removes the person's shifts from today on. So today, a check-in left open by a removal has no shift that day, and it counts to the earlier of now and the site close.
  - After this change, it counts to the removal time.
  - So the new count is later than today's only when the removal happens after the site close. Otherwise it is the same or earlier.
  - No admin can correct the row afterwards (`NOT_ON_ROSTER`); they can only remove it.
- **[Risk] Pre-existing 060 lock shape: a self check-in or check-out racing a removal can deadlock.** `require_membership` holds the volunteer's membership `FOR SHARE`, then the RPC waits for the workspace lock. The removal holds the workspace lock and wants that membership `FOR UPDATE`. Postgres aborts one of them with 40P01, and nothing half-written remains. 059's header already names this shape for other calls. → Mitigation: Zeye's scratch-database check (acceptance list), and the follow-up issue (#305). A fix would change 060's RPCs, which is out of scope.
- **[Risk] A gap in #277: a site coordinator's check-in can land just after their removal and stay open.** `can_check_in` is tested before the workspace lock, and the removal does not lock a site coordinator's membership, because it does not deactivate it. Such a check-in can wait for the lock and insert once the removal has committed. That leaves an open check-in for someone off the roster, the state #277 is about, and this change does not close it. → Mitigation: the follow-up issue (#305), which would re-test `can_check_in` after the lock in 060's RPCs. Not fixed here (Hailey, at review).
- **[Risk] The story or a unit test pins the exact confirmation text.** → Mitigation: the plan searches the tests for the confirmation's sentences and updates every match. The unit test for the cases line keeps passing because it matches that sentence alone; the test that pins the shifts line followed by the cases line needs the new line between them.
- **[Trade-off] The line is always shown, even when the volunteer isn't checked in.** Accepted: the read carries no check-in state, and it may not gain one.

## Migration Plan

- **Deploy:** apply 062 after 061, by the usual hosted migration at merge time (by Hailey, outside this change). It needs no data migration: existing `roster_removals` rows get `check_in_closed = false`, which is true of them.
- **Rollback:** a further migration re-creating 059's function body and dropping the column. Nothing else depends on it.
- **Acceptance:**
  - `npm test` passes, including the new view test;
  - the database suite passes in CI, including the new removal tests: checked in → closed and corrected; an earlier day's open check-in untouched; not checked in → `check_in_closed` false; same instant; the #300 replay;
  - the story passes in CI on both legs;
  - `npx openspec validate --all` and `npm run build:hant -- --check` pass;
  - Zeye's check on a scratch database: a self check-in or check-out racing a removal may deadlock; Postgres cancels one side, nothing is half-written, and a retry succeeds.

## Open Questions

- **Deadlock check on a scratch database**, owner Zeye (Hailey to ask). It can affect the lock-order comment and, if a new shape is found, the step order in 062 before merge.
- **The two 060 lock shapes (Risks 2 and 3)** are left to the follow-up issue (#305). The site coordinator race is a gap in #277: it can leave an open check-in for someone off the roster.
