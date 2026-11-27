# Brainstorm: close-check-in-on-roster-removal (#277, #300)

The brainstorm took place in an earlier (cloud) session. Hailey chose every option there, and the decisions are in the project doc
`claude/remove-from-roster-check-in-decisions.md`. This file records that agreed design. The decisions are not reopened here.
The last section lists what the code reading at propose time found. Each finding is marked as either a consequence of a decision or the proposer's call.

## Background

- **#277.** `vitally_remove_from_roster` (059, #273) takes a volunteer off the current season's roster, deactivates their account
  (unless it is a site coordinator's), and marks their shifts from today on removed. It leaves their check-in (060, #257)
  untouched. A volunteer removed while checked in therefore keeps an open check-in that no one can close:
  - they can't check out, because `vitally_check_out` needs `can_check_in`, which needs a current-season roster entry;
  - an admin can't correct it, because `vitally_save_check_in` refuses with `NOT_ON_ROSTER` or `DEACTIVATED`. Only Remove check-in is left;
  - the day's end moves from the removed shift's end to the site close, so the counted minutes change;
  - Hours this week and the Schedule go on counting it.
- **#300.** Found in #238 / #298. `vitally_remove_from_roster` checks `ADMIN_ROLE` (step 4) before the receipt lookup
  (step 5). This is the order Save used before 061 moved it. Take this sequence: an admin who isn't a site coordinator removes
  a volunteer with no Admin role, a site coordinator adds the volunteer back with Admin, and the first admin replays the removal
  with the same action id. The replay answers `ADMIN_ROLE` instead of the stored result. Nothing is written, but the answer is
  wrong. It breaks the volunteer-roster rule that a repeated action id returns the stored result.

## Decisions (Hailey's, in the cloud session)

**Q1. Scope: one change for both issues.**
The change has two parts. First, `vitally_remove_from_roster` also checks out the volunteer's open check-in from today.
Second, it answers a replayed action id with its stored result before it checks `ADMIN_ROLE`.
**Out of scope:**
- check-ins from earlier days;
- letting admins correct the check-ins of people who are off the roster;
- any new tag or read field.

**Q2. #277: close, don't refuse.** Of the options in #277 (close the open check-in on removal, refuse removal while checked
in, let admins correct off-roster check-ins), the open check-in is closed.
- It closes in the same transaction as the removal. The rows affected are the person's live (not removed) check-ins dated
  today, New York date, with no check-out. Each gets `checked_out_at = now()`.
- An earlier day's open check-in stays as it is. It already counts as missed, to its day's end. The `check_ins_on_date`
  constraint also forbids a check-out on another date.

**Q3. How the closed row reads.**
- `corrected_by_person_id` is set to the removing admin, so the Schedule and the check-in drawer show "Corrected" with that name.
- `revision`, `updated_at` and `updated_by_person_id` move as they do for a save.
- No new columns on `check_ins`. No change to the `checkIns` read or to the UI tags.

**Q4. The record.** `roster_removals` gains `check_in_closed` (boolean), beside `account_deactivated` and `shifts_removed`.

**Q5. Lock order.** The check-in row is locked after the shifts and before the account. Zeye will be asked to check for
deadlocks on a scratch database, as for 059.

**Q6. Same instant.** The removal can land in the same instant as the check-in. `check_ins_out_after_in` needs
`checked_out_at > checked_in_at`, so the removal must handle that case.

**Q7. The confirmation.** `removeFromRosterDialogBody` (`src/volunteer-views.mjs`) gets one line after the shifts line,
shown every time: "If they are checked in now, they are checked out at this moment." A unit test covers it.

**Q8. #300: move the check.** The `ADMIN_ROLE` check moves below the receipt lookup, as 061 did for `vitally_save_volunteer`.
- A replay test goes in `tests/database-remove-from-roster.mjs`. An admin who is not a site coordinator removes a volunteer
  with no Admin role. A site coordinator adds them back with Admin. The first admin repeats the removal with the same action id
  and gets the stored result, not `ADMIN_ROLE`.
- The new migration replaces the function. It corrects 059's comment "Refused before the receipt is reserved, as Save does" in
  the new function body. 059 itself is never edited.

**Q9. Specs.**
- *volunteer-roster:* removal checks out today's open check-in. Scenarios: checked in → checked out at the removal and corrected
  by the remover; an earlier day's open check-in untouched; not checked in → nothing; a replayed removal returns its stored result
  before `ADMIN_ROLE`.
- *volunteer-check-in:* a check-in closed by a roster removal counts as corrected by the remover; Hours this week counts to the
  removal time.

**Q10. Logistics.**
- The change is named `close-check-in-on-roster-removal`. The migration is 062: no open PR adds a migration (checked 2026-11-27
  against PRs #281, #299, #302).
- No Docker or local stack. Iterate with `gh workflow run database-quick.yml --ref <branch> -f files="tests/database-remove-from-roster.mjs"`.
  The PR's full CI stands in for the database, sign-in and story runs.
- No merge, no reviewers, no hosted deploy.

## Approaches considered (from #277 and the cloud session)

| Approach | Trade-off | Outcome |
|---|---|---|
| Close today's open check-in on removal | Nothing is left dangling and the record stays true to what happened. It writes a check-out on the volunteer's behalf. | **Chosen** |
| Refuse removal while checked in (a new refusal) | Simple. It blocks a removal the admin wants now, and it adds a refusal code and UI copy. | Rejected |
| Let admins correct off-roster check-ins | It changes `vitally_save_check_in`'s refusals and the drawer, and still leaves the row open until someone notices. | Rejected (out of scope) |

For #300: move the check (chosen), or leave it as a rare sequence. Moving it keeps both admin RPCs in the same order and makes the
spec rule hold.

## Found at propose time (the proposer's reading of the code)

1. **A spec sentence changes (consequence of Q2).** volunteer-check-in says "Nothing SHALL write a check-out on the volunteer's
   behalf." A roster removal now does. The delta modifies that requirement and names roster removal as the one exception. This
   is drift that the decision causes. It is not a new decision.
2. **Counting after the day's end (consequence of Q2 and Q9).** While open, a check-in counts to the earlier of now and the day's
   end. Once it is checked out at the removal, it counts to the removal time. Suppose a volunteer forgot to check out after a
   shift that ended at 1 pm and is removed at 3 pm. The count rises by two hours, and no admin can correct it afterwards
   (`NOT_ON_ROSTER`); only Remove check-in is left. This follows from "Hours this week counts to the removal time" and is kept as
   decided. It is listed in design Risks for Hailey to look at in review.
3. **The answer shape (proposer's call).** The RPC's answer `{actionId, volunteerId, revision, accountDeactivated, shiftsRemoved}`
   stays as it is. No screen needs to know whether a check-in was closed, and Q1 rules out new read fields. The fact is kept in
   `roster_removals.check_in_closed`.
4. **Same instant (proposer's call for Q6).** Use the expression `vitally_check_out` uses:
   `greatest(now(), checked_in_at + interval '1 microsecond')`. Because a check-in is never in the future, it stays on the
   check-in's date.
5. **Locks (for Zeye's check, Q5).**
   - `vitally_check_in`, `vitally_check_out` and the admin check-in RPCs all take the workspace lock before the check-in row, and
     the removal holds the workspace lock throughout. So the check-in row lock adds no new wait cycle.
   - One shape existed before this change, from 060. A volunteer's own `vitally_check_in`/`vitally_check_out` holds their
     membership `FOR SHARE` (`require_membership`), then waits for the workspace lock. That is the shape 059's header already
     names as uncovered: removal holds the workspace lock and wants that membership `FOR UPDATE`.
   - Also from 060: `can_check_in` is tested before the workspace lock. So a site coordinator's check-in racing their own
     removal could land just after it, because their membership is not locked. These are listed for Zeye. Fixing them would
     change 060's RPCs, which is outside Q1's scope.

## Review of the planning artifacts (Hailey, 2026-11-27)

1. **The late-removal count is kept.** The check-out is the removal time, with no cap at the day's end. Finding 2's example above overstated the effect. Today the removal also removes the shifts from today on, so a check-in it leaves open counts to the earlier of now and the site close. The new count is later only when the removal happens after the site close (design, first risk).
2. **The rewritten volunteer-check-in sentence is accepted.**
3. **Both proposer's calls are accepted:** the answer stays unchanged, and the update closes every open check-in from today.
4. **The two 060 lock shapes are not fixed here.** One follow-up issue covers both: #305. It describes the site coordinator race as a gap in #277.
5. **The two unit tests that pin the old line order are updated as planned.**
6. **Fixes to the artifacts:**
   - tasks.md and plan.md now match, and `npm run build:hant -- --check` is run;
   - Zeye's scratch-database check is in design's acceptance list;
   - "today" test rows always fall on today's New York date.
