## Why

When an admin removes a volunteer from the roster while the volunteer is checked in (#277), the check-in stays open. The volunteer can't check out, and no admin can correct the row. Remove check-in is the only way to clear it. Until then the Schedule and Hours this week go on counting it, to the site close rather than the shift that was removed.

Separately (#300), a replayed removal can be refused with `ADMIN_ROLE` instead of getting its stored result back. The sequence is: the removal lands, a site coordinator adds the volunteer back with the Admin role, and the first admin repeats the action id. Migration 061 fixed the same order in Save, and the volunteer-roster spec already promises the stored result.

## What Changes

**Removal closes today's open check-in (#277)**
- From: `vitally_remove_from_roster` leaves the volunteer's check-ins as they are.
- To: in the same transaction, the volunteer's live check-in dated today (New York) with no check-out is checked out at the removal time and marked corrected by the removing admin. Its revision, update time and updater move as for a save. An earlier day's open check-in is not changed, so it stays a missed check-out.
- Reason: no one can close the row once the volunteer is off the roster.
- Impact: non-breaking. No new column on `check_ins`, and no change to the check-in reads or tags. The RPC's answer is unchanged.

**The removal record**
- `roster_removals` gains `check_in_closed` (boolean).

**The confirmation**
- From: the shifts line is followed by the line about cases and contact details.
- To: the two are separated by one line, always shown: "If they are checked in now, they are checked out at this moment."

**Replay before ADMIN_ROLE (#300)**
- From: `ADMIN_ROLE` is checked before the receipt lookup.
- To: it is checked after the lookup, as Save has done since 061. A refusal still stores no receipt.
- Impact: non-breaking. Only a replay of a removal that had already landed answers differently.

**Migration 062** replaces `vitally_remove_from_roster` and adds the column. It corrects 059's comment about the order. 059 itself is not edited.

**Out of scope:** check-ins from earlier days; letting admins correct the check-ins of people who are off the roster; any new tag or read field.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `volunteer-roster`:
  - removal checks out today's open check-in;
  - the removal record says whether it did;
  - the confirmation gets the check-in line;
  - a replayed removal returns its stored result before `ADMIN_ROLE`.
- `volunteer-check-in`:
  - a roster removal is the one write of a check-out on the volunteer's behalf besides an admin's correction;
  - such a check-in counts as corrected by the remover, and counts to the removal time.

## Impact

- **Database:** new migration `supabase/migrations/062_close_check_in_on_roster_removal.sql`. It adds `roster_removals.check_in_closed`, which defaults to false for existing rows. It re-creates `vitally_remove_from_roster` with the same signature and grants. No RLS, realtime or read RPC changes. The closed check-in is an UPDATE on `check_ins`, which is already in the realtime publication, so open Schedule windows re-read it.
- **Browser:** `src/volunteer-views.mjs` (`removeFromRosterDialogBody`). Staff screen, English only, so no 简体 or 繁體 text.
- **Tests:**
  - `tests/database-remove-from-roster.mjs`: check-in closing, the record column, and the #300 replay;
  - `tests/volunteer-views.test.mjs`: the confirmation line;
  - the story, if it asserts the confirmation's text.
- **Docs:** `docs/developer/database.md` (the migration row, the `roster_removals` columns and the removal section).
- **Hosted:** 062 has to be applied to the hosted database at merge time. That is not part of this change's work.
