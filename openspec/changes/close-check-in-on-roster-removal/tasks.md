## 1. Migration 062 and its database tests (plan.md Task 1)

- [x] 1.1 In `tests/database-remove-from-roster.mjs`, add the helpers `TODAY_START`, `todayAgo(n)`, `addCheckIn` and `checkInsOf`. Add `check_in_closed` to `removalsOf`, and the check-ins to `stateOf`.
- [x] 1.2 Write the failing check-in subtests:
  - checked in today → checked out at the removal, corrected and updated by the remover, revision + 1, `check_in_closed` true;
  - yesterday's open check-in untouched;
  - a check-in already checked out today untouched, `check_in_closed` false;
  - another volunteer's check-in untouched;
  - a refused removal (`OPEN_WORK`) leaves the check-in open;
  - the Schedule shows the row as "Corrected" with the remover's name, and Hours this week counts to the removal;
  - same instant (one transaction, rolled back).
- [x] 1.3 Write the failing #300 replay subtest. A non-site-coordinator admin removes a volunteer; a site coordinator re-adds them with Admin; the first admin replays with the same action id and gets the stored result.
- [x] 1.4 Push the branch and run `gh workflow run database-quick.yml --ref close-check-in-on-roster-removal -f files="tests/database-remove-from-roster.mjs"`. Expect these failures.
- [x] 1.5 Write `supabase/migrations/062_close_check_in_on_roster_removal.sql`:
  - §1 the `check_in_closed` column;
  - §2 the function re-created from 059 §2, with the receipt before `ADMIN_ROLE` and 059's comment corrected, the check-in step between the shifts and the account, and the new record column;
  - the same answer, revoke and grant.
- [x] 1.6 Run the quick workflow on `tests/database-remove-from-roster.mjs tests/database-check-in.mjs tests/database-catalog.mjs` until green.
- [x] 1.7 Update the test file's header comment and commit.

## 2. The confirmation line (plan.md Task 2)

- [x] 2.1 In `tests/volunteer-views.test.mjs`, add a failing test that "If they are checked in now, they are checked out at this moment." is always shown, after the shifts line and before the cases line. Update the two tests that pin the shifts line directly before the cases line.
- [x] 2.2 Add the line to `removeFromRosterDialogBody` in `src/volunteer-views.mjs`.
- [x] 2.3 Run `npm test`. Confirm that no other test, the story included, pins the old order. Commit.

## 3. Developer docs and final checks (plan.md Task 3)

- [ ] 3.1 In `docs/developer/database.md`: the 062 row in the migrations table and 061's note; the function index; the `roster_removals` columns; and in "Removing a volunteer from the roster", the check-in bullet, the order of checks and the lock order.
- [ ] 3.2 Run `npm test`, `npx openspec validate --all` and `npm run build:hant -- --check`. All pass.
- [ ] 3.3 Commit and push. The PR's full CI run (checks, database, sign-in, both story legs) stands in for the local database, sign-in and story runs. It is linked in verify.md, which is outside this plan.
