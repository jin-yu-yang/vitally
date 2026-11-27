# Close the check-in on roster removal: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `vitally_remove_from_roster` checks out the volunteer's open check-in from today, marked as the remover's correction and recorded in `roster_removals.check_in_closed`. A replayed removal gets its stored result before the `ADMIN_ROLE` check. The confirmation says so.

**Architecture:**
- A new hand-written migration 062 adds one column. It re-creates `vitally_remove_from_roster` from 059 §2 with three changes: the receipt moves before `ADMIN_ROLE`; a check-in update goes between the shift update and the account step; the record gets the new column.
- One sentence is added to `removeFromRosterDialogBody`.
- No read, answer, tag or RLS changes.

**Tech Stack:** Postgres/PL/pgSQL (Supabase migrations), Node `node:test` database tests via `tests/support/database-fixture.mjs`, plain ES-module views.

**Spec:** in `openspec/changes/close-check-in-on-roster-removal/`, read `design.md` (D1–D8) and `specs/volunteer-roster/spec.md` and `specs/volunteer-check-in/spec.md`.

## Global Constraints

- **Never edit an applied migration.** 059, 060 and 061 stay byte-for-byte. The new file is `supabase/migrations/062_close_check_in_on_roster_removal.sql`.
- **Same signature.** The function keeps `vitally_remove_from_roster(p_action_id uuid,p_volunteer_id uuid,p_expected_revision bigint)`, the same revoke and grant lines, and the answer `{actionId, volunteerId, revision, accountDeactivated, shiftsRemoved}`. `tests/support/rpc-signatures.mjs` and `tests/database-catalog.mjs` do not change.
- **Exact copy:** the confirmation line is `If they are checked in now, they are checked out at this moment.`
- **Fictional data only:** use names such as Nadia Kerr, Ines Dalton and Rowan Pike, and emails `@example.org` or `@example.test`.
- **No Docker or local Supabase stack.** Never run `supabase start`, `npm run db:migrate:test` or `npm run test:database` locally.
  - Database tests run only by `gh workflow run database-quick.yml --ref close-check-in-on-roster-removal -f files="<files>"` on the pushed branch.
  - Watch the run with `timeout 1500 gh run watch <id> --exit-status`, a bounded wait.
  - On failure, read the log with `gh run view <id> --log-failed` before you change anything or rerun.
- **No hanging commands.**
  - Give every shell command a timeout.
  - Run no server in the foreground.
  - If a command needs approval or would need Docker, stop and report **BLOCKED**.
- Staff screens stay English, so there is no 简体 or 繁體 text in this change.
- Commit on the change branch. Push only to run the quick workflow or at the end. Never merge, never request reviewers, never deploy to hosted.

## Review Focus

1. **Same instant:** a removal in the same transaction instant as the check-in must not violate `check_ins_out_after_in`. Task 1 has a test.
2. **Near New York midnight:** a "today" row made with `now() - interval '2 minutes'` lands on yesterday in the first minutes after midnight New York time. Every "today" row is built with `todayAgo(n)`, which never falls before today's New York midnight, and the expected minutes are computed from the stored row, not hard-coded. What remains is a few milliseconds: midnight passing between a row's insert and the removal. A failure in that window is expected and is rerun, not fixed. Task 1 follows this.
3. **A refused removal must leave the check-in open:** `stateOf` includes check-ins, so every existing `refused(...)` case covers it. Task 1, step 1.
4. **The replay after a re-add with Admin (#300):** this must return the stored answer and must not close or touch anything new. Task 1 has a test.
5. **Unit tests that pin the old text order:** two existing tests assume the shifts line is followed directly by the cases line. Task 2 updates them.

---

### Task 1: Migration 062 and its database tests

**Files:**
- Create: `supabase/migrations/062_close_check_in_on_roster_removal.sql`
- Modify: `tests/database-remove-from-roster.mjs` (helpers near lines 70–115; new subtests inside `test("removing a volunteer from this season's roster", …)`, before the `finally`, at about line 629; header comment lines 6–16)

**Interfaces:**
- Consumes: the fixture API already used in the file: `f.staff({key,name,capabilities})` returns `{client, userId, personId}`; `f.sql`, `f.receiptsFor`, `sc`, `admin` (Ines Dalton, not a site coordinator), `removeNow`, `remove`, `refused`, `rpc`, `volunteer`, `profileOf`, `currentEntry`.
- Produces: the column `public.roster_removals.check_in_closed boolean not null default false`, and the 062 behaviour that Task 3 documents.

- [ ] **Step 1: Add the helpers and extend `removalsOf` and `stateOf`**

```js
// The start of today's New York date, and a time just before now that never
// falls before it, so a "today" row is on today's date even just after
// midnight.
const TODAY_START = "(((now() at time zone 'America/New_York')::date)::timestamp at time zone 'America/New_York')";
const todayAgo = (minutes) => `greatest(now() - interval '${minutes} minutes', ${TODAY_START})`;
// A live current-season check-in for the person at `at` (a timestamptz SQL
// expression), with a check-out at `out` when given. Returns its id.
const addCheckIn = async (f, personId, { at = todayAgo(2), out = null } = {}) =>
  (await one(f,
    `insert into public.check_ins(workspace_id,season,person_id,check_in_date,checked_in_at,checked_out_at)
      select w.id,w.current_season,$2,((${at}) at time zone 'America/New_York')::date,${at},${out ?? "null"}
      from public.workspaces w where w.id=$1 returning id`, [f.workspaceId, personId])).id;
const checkInsOf = async (f, personId) => (await f.sql(
  `select id,check_in_date::text as day,checked_in_at,checked_out_at,revision::int as revision,
    updated_by_person_id,corrected_by_person_id
    from public.check_ins where workspace_id=$1 and person_id=$2 order by checked_in_at,id`,
  [f.workspaceId, personId])).rows;
```

Add `check_in_closed` to `removalsOf`'s select list. Add `checkIns: await checkInsOf(f, personId)` to `stateOf`.

- [ ] **Step 2: Write the failing check-in subtests**

```js
await t.test("an open check-in today is checked out at the removal, corrected by the remover", async () => {
  const nadia = await f.staff({ key: "nadia_checked_in", name: "Nadia Kerr", capabilities: ["prepare"] });
  const id = await addCheckIn(f, nadia.personId);
  const [before] = await checkInsOf(f, nadia.personId);
  await removeNow(f, admin.client, nadia.personId);
  const [after] = await checkInsOf(f, nadia.personId);
  assert.equal(after.id, id);
  assert.ok(after.checked_out_at > after.checked_in_at);
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.corrected_by_person_id, admin.personId);
  assert.equal(after.updated_by_person_id, admin.personId);
  assert.equal((await one(f, "select (vitally_private.open_check_in($1,$2)).id as id", [f.workspaceId, nadia.personId])).id, null);
  assert.equal((await removalsOf(f, nadia.personId))[0].check_in_closed, true);
});
```

Write the further subtests in the same style:
- **"yesterday's open check-in is left missed"**: `at` is `"(((now() at time zone 'America/New_York')::date - 1) + time '12:00') at time zone 'America/New_York'"`. After the removal the row deep-equals its state before, and `check_in_closed` is `false`.
- **"a check-in already checked out today is left, and nothing is recorded as closed"**: `at` is `todayAgo(3)`, `out` is `"now()"`. The insert's `now()` is earlier than the removal's, which runs in a later transaction. The row is unchanged and `check_in_closed` is `false`.
- **"another volunteer's open check-in is untouched"**: two staff, one with an open check-in. Remove the other. The open row deep-equals its state before.
- **"a refused removal (OPEN_WORK) leaves an open check-in"**: copy the existing OPEN_WORK case setup (an open case as preparer) and add `addCheckIn` first. `refused(...)` already compares `checkIns`.
- **"the closed check-in reads as corrected, and counts to the removal"**: after an admin removal, `rpc(sc.client, "vitally_schedule_day", { p_date: <today NY text> })` returns `checkIns`. The item for the person has `flags.corrected === true` and `correctedByName === "Ines Dalton"`. `rpc(sc.client, "vitally_hours_this_week", {})` returns `hours`. The entry for the person has `minutes` equal to `Math.floor((checked_out_at - checked_in_at) / 60000)` from `checkInsOf`.
- **"same instant: the check-out is after the check-in"**:
  1. `await f.sql("begin")`.
  2. Insert a check-in at `now()` for a fresh staff member.
  3. `set_config('request.jwt.claims', …sc.userId…, true)`, then `set local role authenticated`.
  4. `select public.vitally_remove_from_roster($1,$2,$3)` with that person's profile revision.
  5. Read the row in the same transaction. Assert `checked_out_at > checked_in_at`, and that the New York date of `checked_out_at` is `check_in_date`.
  6. `rollback` in `finally`, following `callerAnswer`'s pattern.

- [ ] **Step 3: Write the failing #300 replay subtest**

```js
await t.test("a replay returns its stored result after the volunteer gained the Admin role (#300)", async () => {
  const rowan = await f.staff({ key: "rowan_replay", name: "Rowan Pike", capabilities: ["prepare"] });
  const { email } = await profileOf(f, rowan.personId);
  const { data, revision, actionId } = await removeNow(f, admin.client, rowan.personId);
  await rpc(sc.client, "vitally_save_volunteer", {
    p_action_id: randomUUID(), p_volunteer_id: rowan.personId, p_expected_revision: data.revision,
    p_volunteer: volunteer(email, { roles: ["admin"], certificates: ["vsc", "itqr"] }),
  });
  const entry = await currentEntry(f, rowan.personId);
  assert.deepEqual(entry.roles, ["admin"]);
  const again = await remove(admin.client, { actionId, volunteerId: rowan.personId, revision });
  assert.equal(again.error, null, failure(again.error));
  assert.deepEqual(again.data, data);
  assert.deepEqual(await currentEntry(f, rowan.personId), entry);
  assert.equal((await removalsOf(f, rowan.personId)).length, 1);
});
```

- [ ] **Step 4: Push the branch and run the file to see it fail**

Run:
```
timeout 60 git push -u origin close-check-in-on-roster-removal
timeout 60 gh workflow run database-quick.yml --ref close-check-in-on-roster-removal -f files="tests/database-remove-from-roster.mjs"
```
Then find the run with `gh run list --workflow database-quick.yml --branch close-check-in-on-roster-removal --limit 1` and watch it with `timeout 1500 gh run watch <id> --exit-status`.

Expected: FAIL. `removalsOf` errors on the missing column `check_in_closed`; the check-in assertions fail; the #300 subtest fails with `VT001 ADMIN_ROLE`. All the earlier subtests that don't touch `removalsOf` pass.

- [ ] **Step 5: Write migration 062**

The header names change `close-check-in-on-roster-removal` and #277 and #300. It states:
- the new lock order: the workspace lock, the membership, the profile, the entry, the shifts, the check-in, then the account (design D5);
- that every other `check_ins` writer takes the workspace lock first;
- the two 060 lock shapes this change leaves as they are (design Risks 2 and 3);
- that 059 is not edited, and that its comment "Refused before the receipt is reserved, as Save does" no longer holds.

§1: `alter table public.roster_removals add column check_in_closed boolean not null default false;`

§2: `create or replace function public.vitally_remove_from_roster(...)`. Copy the body from 059 lines 91–228 and mark every changed or new line `-- 062`, as 061 does. The changes:
- Declare `v_check_ins_closed integer=0;`.
- Move step 4 (the stored-roles select and the `ADMIN_ROLE` raise) to directly after the receipt's `return`. Its comment says that it is refused after the receipt lookup, so a replay returns its stored result although the roles changed since, and that the refusal rolls the reserved receipt back. Use 061's wording.
- After the shift update's `get diagnostics`, before the account select, add this step:
  ```sql
  update public.check_ins set checked_out_at=greatest(now(),checked_in_at+interval '1 microsecond'),
    revision=revision+1,updated_at=now(),updated_by_person_id=v_person.id,corrected_by_person_id=v_person.id
   where workspace_id=v_member.workspace_id and person_id=p_volunteer_id and removed_at is null
    and checked_out_at is null and check_in_date=(now() at time zone 'America/New_York')::date;
  get diagnostics v_check_ins_closed=row_count;
  ```
  Its comment cites design D1–D3: the predicate is `open_check_in`'s; earlier days stay missed; the Realtime UPDATE re-reads open Schedules.
- Add `check_in_closed` to the `roster_removals` insert, with the value `v_check_ins_closed>0`.
- Renumber the header's "Order of checks" comment and the step comments so they read in order.
- Keep the revoke and grant lines as they are.

- [ ] **Step 6: Run the file plus the neighbouring suites**

Run the quick workflow with `-f files="tests/database-remove-from-roster.mjs tests/database-check-in.mjs tests/database-catalog.mjs"` and watch it as in step 4.
Expected: PASS for all three files. On a failure, read `--log-failed` first.

- [ ] **Step 7: Update the test file's header comment** to name this change, migration 062, and the check-in and replay behaviour. Commit:

```bash
git add supabase/migrations/062_close_check_in_on_roster_removal.sql tests/database-remove-from-roster.mjs
git commit -m "Remove from roster checks out today's open check-in; replay before ADMIN_ROLE (#277, #300)"
```

### Task 2: The confirmation line

**Files:**
- Modify: `src/volunteer-views.mjs:290-295` (`removeFromRosterDialogBody`'s `lead` array)
- Test: `tests/volunteer-views.test.mjs:1036-1049`, plus one new test after it

**Interfaces:**
- Consumes: `removeFromRosterDialogBody({ volunteer, error })` and the test file's `withStatus(status, extra)`.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test, and update the two order assertions**

```js
test("the confirmation always says a check-in is checked out, before the cases line", () => {
  const LINE = /If they are checked in now, they are checked out at this moment\. Their cases and contact details are kept\./;
  for (const v of [withStatus("active"), withStatus("none"), withStatus("deactivated"),
    withStatus("active", { isSiteCoordinator: true }), withStatus("active", { hasShiftsFromToday: true })])
    assert.match(removeFromRosterDialogBody({ volunteer: v }), LINE);
  assert.match(removeFromRosterDialogBody({ volunteer: withStatus("active", { hasShiftsFromToday: true }) }),
    /removed from the Schedule\. If they are checked in now/);
});
```

In the shifts test, change `… from the Schedule\. Their cases and contact details are kept\.` to `… from the Schedule\. If they are checked in now, they are checked out at this moment\. Their cases and contact details are kept\.`. Change `… from the Schedule\. Their cases/` to `… from the Schedule\. If they are checked in now/`.

- [ ] **Step 2: Run the tests to see them fail**

Run: `timeout 300 node --test tests/volunteer-views.test.mjs`
Expected: FAIL in the new test and the shifts test.

- [ ] **Step 3: Add the line** to the `lead` array, after the shifts entry and before the cases entry, unconditionally: `"If they are checked in now, they are checked out at this moment."`.

- [ ] **Step 4: Run the unit suite**

Run: `timeout 600 npm test`
Expected: PASS. Then run `grep -rn "contact details are kept" tests` and confirm that no other test, the story included, pins the old adjacency. Update any match.

- [ ] **Step 5: Commit**

```bash
git add src/volunteer-views.mjs tests/volunteer-views.test.mjs
git commit -m "Removal confirmation: say an open check-in is checked out (#277)"
```

### Task 3: Developer docs and final checks

**Files:**
- Modify: `docs/developer/database.md`:
  - the migrations table, at about line 93 (add a 062 row after 061's, and change 061's "keeps its order" to "until 062");
  - the function index, at about line 144 (`059`, `062`);
  - the `roster_removals` row, at about line 258 (add `check_in_closed`);
  - "Removing a volunteer from the roster", from about line 569: add a **Check-ins** bullet after **Shifts**; move the receipt to before `ADMIN_ROLE` in the order of checks; add the check-in to the lock order.

**Interfaces:**
- Consumes: Task 1's behaviour. Produces: nothing.

- [ ] **Step 1: Edit the doc** in the doc's existing voice. The Check-ins bullet says what D1–D3 say: today's live open check-in is checked out at `greatest(now(), checked_in_at + 1 µs)`, marked corrected and updated by the remover with its revision raised, and recorded as `roster_removals.check_in_closed`. Earlier days stay missed. The answer is unchanged.
- [ ] **Step 2: Run the checks:** `timeout 600 npm test`, `timeout 120 npx openspec validate --all`, `timeout 300 npm run build:hant -- --check`. Expected: all pass. The build:hant check is cheap and confirms there is no Chinese drift.
- [ ] **Step 3: Commit, then push**

```bash
git add docs/developer/database.md
git commit -m "Database docs: 062, check-ins on removal, receipt before ADMIN_ROLE"
timeout 60 git push
```

The full CI on the PR (checks, database, sign-in, both story legs) is run and linked in lifecycle step 6 (verify). It is not part of this plan.
