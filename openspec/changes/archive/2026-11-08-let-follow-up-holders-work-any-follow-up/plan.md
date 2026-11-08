# Let follow-up holders work any follow-up: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anyone holding `followup` can log contacts on, and resolve, any open office follow-up of every purpose; the assignee becomes a label; and `followup` requires `admin` in the roster, `add_staff_member` and the stored people.

**Architecture:**
- **One hand-written migration, 042** (design D1, D2, D6). It redefines `vitally_private.lock_open_followup` without the assignee check, redefines `vitally_private.add_staff_member` with one more refusal, and adds the check `people_followup_needs_admin`. It can be re-run.
- **The roster command** refuses `followup` without `admin` before any account is made (D2).
- **The browser** drops its one assignee check and changes three texts (D4).
- **Tests** convert the ones that assert the old rule and add one per purpose and per refusal (D7).

**Tech Stack:** PostgreSQL / Supabase SQL migrations, ES-module browser app, `node:test` unit and database suites, the Playwright browser story, Node tooling in `tools/admin/`.

**Spec:**
- `openspec/changes/let-follow-up-holders-work-any-follow-up/specs/`: office-follow-up, staff-case-work, sign-in;
- design: `openspec/changes/let-follow-up-holders-work-any-follow-up/design.md`, D1–D7;
- decision log: `openspec/changes/let-follow-up-holders-work-any-follow-up/brainstorm.md`. Its "Consequences found while checking" lists the tests and docs this touches.

## Global Constraints

- **The migration file** is `supabase/migrations/042_let_follow_up_holders_work_any_follow_up.sql`. Never edit an applied migration (001–041). No `begin;`/`commit;` in the file: `tools/admin/migrate.mjs` wraps each run in one transaction.
- **#136 (`remove-presenter-access`) also numbers its migration 042 and also redefines `add_staff_member`.** Before writing or applying 042, run `git fetch origin` and `git ls-tree --name-only origin/main supabase/migrations/ | tail -3`. If `main` already has a `042_*.sql`, stop and report BLOCKED: this change's migration must be renumbered and `add_staff_member` copied from the latest migration that defines it (design D6).
- **`lock_open_followup`** keeps its signature `(p_case public.cases, p_person public.people, p_payload jsonb) returns public.admin_followups`, `security definer`, `set search_path=''`. Missing or other-case task → `raise sqlstate 'VT001' using message='FORBIDDEN'`. Status not `open` → `raise sqlstate 'VT004' using message='INVALID_TRANSITION'`.
- **The check** is named `people_followup_needs_admin`: `check (not ('followup'=any(capabilities)) or 'admin'=any(capabilities))`, added after `alter table public.people drop constraint if exists people_followup_needs_admin`.
- **Staff text, verbatim:**
  - the Follow-up panel note: `The office raises a task when a preparer asks it to contact a client, when a reviewer didn't go over the return with the client, or when a case is withdrawn or closed before its return is filed. Anyone in the office with follow-up access can log contacts on it and resolve it.`
  - the Call the client row: `<n> open task` / `<n> open tasks`, then ` · assigned to ` and the names joined with `, `;
  - the volunteer page's task heading: `Assigned to <name>`;
  - the roster refusal: `staff[<n>].capabilities must include admin when they include followup.`
- **Staff screens stay English.** No client text changes, so `build:hant` is not needed.
- **The local stack** (`vitally-task2`, at 041):
  - Never run `supabase start` from the repo root.
  - **The controller runs `db:migrate:test`, `test:database` and `test:browser`, not a subagent** (the user's approval to apply covers the controller only). An implementer who reaches one of these steps reports NEEDS_CONTEXT naming the step, and waits.
  - The database and browser suites run one at a time, with no other test process on the stack.
  - In the worktree, `.env.test` and `.env.local` must be linked or copied from the main checkout before any database or browser suite runs.
- **Data and output:** fictional data only (`@example.org`, fictional names), no email address in output, LF only.
- **Git:** never `git add -A` (the worktree's `node_modules` is a symlink); add files by name. **No attribution lines in commit messages.**

## Review Focus

1. **A task on another case, or a missing task, is still `FORBIDDEN`,** not `INVALID_TRANSITION`. `tests/database-contacts.mjs` "a contact linked to a task" (about line 308) must pass unchanged. Task 1.
2. **The new check must not refuse any existing row:** the personas (Sam holds `admin` and `followup`) and every fixture the suites create. The whole database suite passes. Task 1.
3. **A capable non-assignee on a resolved task gets `INVALID_TRANSITION`,** not `FORBIDDEN`. Task 1.
4. **The roster refuses before any account is made,** at any position in `staff`. Task 2.
5. **The snapshot fixture changes by the note only.** Task 3.

---

### Task 1: Migration 042 and its database tests

**Files:**
- Create: `supabase/migrations/042_let_follow_up_holders_work_any_follow_up.sql`
- Modify: `tests/database-documents.mjs` (about lines 919-970 and 1063-1090, plus a new subtest)
- Modify: `tests/database-staff-identity.mjs` (about lines 638-660, 752-797, plus a new subtest)
- Modify: `tests/database-actions.mjs` (about lines 314-330 and 942-945)
- Modify: `tests/database-review.mjs` (a new subtest after "a go-over resolved during a hold still switches the plan")
- Modify: `tests/database-hold.mjs` (a new subtest in the withdraw group, after about line 440)
- Scratch, not committed: the dry-run script, in the session scratchpad

**Interfaces:**
- Consumes: the fixture helpers `f.staff({ key, name, capabilities })` → `{ client, userId, personId, email }`, `f.act(client, caseId, type, payload)`, `f.logContact(client, caseId, entry, followupId)`, `f.readStaffCase(caseId)`, `f.siteCoordinator`, `f.siteCoordinatorId`, `f.sam`, `f.reviewer`, `f.reviewerId`, and in `database-staff-identity.mjs` the local `addStaffMember`, `personRow`, `rejected`.
- Produces: the migrated schema that Tasks 2–5 rely on. The browser needs no new field.

- [ ] **Step 0: The #136 check.** Run the Global Constraints check. Expected: `main` ends at `041_resolve_go_over_during_hold.sql`.

- [ ] **Step 1: Convert the tests that assert the old rule or store a follow-up-only person.**

  `tests/database-documents.mjs`:
  - Rename the top-level test `"admin follow-up is assigned, recorded and resolved by its own person"` (about line 627) to `"admin follow-up is assigned, recorded and resolved by the office"`.
  - Rename the subtest `"contact and resolution need the assigned person and a listed outcome"` to `"contact and resolution need the follow-up capability and a listed outcome"`.
  - In the comment `// RECORD_CONTACT refuses every outcome now (design D12); the assignee` / `// logs linked contacts instead, and none resolves the task.` (about lines 986-987), "the assignee logs" becomes "the office logs".
  - Delete the block that starts `// Step 7: the capability alone is not the assignment.` and ends with the `finally` that restores `["review"]` (about lines 945-969). Keep the line after it, `assert.deepEqual(await taskContacts(f, followupId), []);`.
  - Replace the block that starts `// Assignment answers before readiness: a capable non-assignee is` (about lines 1065-1090) with:

    ```js
        // Readiness answers anyone who may act (042): a capable non-assignee
        // is told the resolved task is not available.
        await f.sql("update public.people set capabilities=$1 where id=$2", [
          ["admin", "followup", "review"],
          f.reviewerId,
        ]);
        try {
          await assert.rejects(
            () =>
              f.act(f.reviewer, caseId, "RESOLVE_FOLLOWUP", {
                followupId,
                outcome: "reached",
                note: "Once more",
              }),
            rejected("INVALID_TRANSITION"),
          );
          await assert.rejects(
            () =>
              f.logContact(f.reviewer, caseId, SAMPLE_CONTACT(), followupId),
            rejected("INVALID_TRANSITION"),
          );
        } finally {
          await f.sql("update public.people set capabilities=$1 where id=$2", [
            ["review"],
            f.reviewerId,
          ]);
        }
    ```

  `tests/database-staff-identity.mjs`, in `"a staff member takes new follow-ups and withdrawal notices"`:
  - Frankie's hire becomes `capabilities: ["admin", "followup"]`.
  - Replace the block from `// Review Focus 5: the new default cannot take over the Site Coordinator's` through `assert.equal(resolved.assignee_person_id, f.siteCoordinatorId);` (about lines 768-796) with:

    ```js
      // Review Focus 5, changed by 042: the new default may work the Site
      // Coordinator's open task too, and the task keeps its assignee.
      const resolvePayload = {
        followupId: firstFollowup.id,
        outcome: "reached",
        note: "Spoke with the client.",
      };
      const statusOf = async () =>
        (
          await f.sql("select status,assignee_person_id from public.admin_followups where id=$1", [
            firstFollowup.id,
          ])
        ).rows[0];
      await f.act(frankie.client, firstFollowup.case_id, "RESOLVE_FOLLOWUP", resolvePayload);
      assert.deepEqual(await statusOf(), { status: "resolved", assignee_person_id: f.siteCoordinatorId });
    ```

  `tests/database-actions.mjs`:
  - About line 944: Dana's hire becomes `capabilities: ["admin", "followup"]`, and the comment above it reads `// A staff member with \`followup\` (and so \`admin\`, 042), so moving the default to them is a`.
  - About lines 315-318: the stripped capabilities become `["assist", "receive_documents"]` (`admin` and `followup` go together, because 042 refuses `followup` without `admin`). The restore in the `finally` stays `["admin", "assist", "followup", "receive_documents"]`.

- [ ] **Step 2: Add the failing tests for the new rule.**

  `tests/database-documents.mjs`, a new subtest right after `"contact and resolution need the follow-up capability and a listed outcome"`:

  ```js
    await t.test("anyone with follow-up access works the task (042)", async () => {
      const jo = await f.staff({ key: "jo", name: "Jo Rivera", capabilities: ["admin", "followup"] });
      const caseId = await requestedCase(f);
      await f.act(f.preparer, caseId, "ESCALATE_CONTACT", { reason: "Office contact needed" });
      const [task] = (await f.readStaffCase(caseId)).followups;
      assert.equal(task.assigneeId, f.siteCoordinatorId);
      const payload = { followupId: task.id, outcome: "reached", note: "Spoke with the client" };
      // Another case's id never reaches the task: a contact is forbidden, and a
      // resolve is invalid (check_related refuses it first).
      const otherCaseId = await requestedCase(f);
      await assert.rejects(
        () => f.logContact(jo.client, otherCaseId, SAMPLE_CONTACT(), task.id),
        rejected("FORBIDDEN"),
      );
      await assert.rejects(
        () => f.act(jo.client, otherCaseId, "RESOLVE_FOLLOWUP", payload),
        rejected("VALIDATION"),
      );
      // Two people on one task: both contacts are kept.
      await f.logContact(f.siteCoordinator, caseId, SAMPLE_CONTACT(), task.id);
      await f.logContact(jo.client, caseId, SAMPLE_CONTACT(), task.id);
      assert.equal((await taskContacts(f, task.id)).length, 2);
      // Logging never moves the case revision, so this is the revision before the resolve.
      const before = Number(
        (await f.sql("select revision from public.cases where id=$1", [caseId])).rows[0].revision,
      );
      await f.act(jo.client, caseId, "RESOLVE_FOLLOWUP", payload);
      const [after] = (await f.readStaffCase(caseId)).followups;
      assert.equal(after.status, "resolved");
      assert.equal(after.assigneeId, f.siteCoordinatorId, "the assignee stays as a label");
      const events = await f.sql(
        "select actor_person_id from public.case_events where case_id=$1 and action='RESOLVE_FOLLOWUP'",
        [caseId],
      );
      assert.deepEqual(events.rows, [{ actor_person_id: jo.personId }]);
      // The assignee's resolve from before is stale (VT003 CONFLICT), and after
      // re-reading the task is not available.
      const stale = await f.siteCoordinator.rpc(
        "vitally_apply_action",
        applyArgs({ caseId, revision: before, type: "RESOLVE_FOLLOWUP", payload }),
      );
      assert.equal(stale.error?.code, "VT003");
      await assert.rejects(
        () => f.act(f.siteCoordinator, caseId, "RESOLVE_FOLLOWUP", payload),
        rejected("INVALID_TRANSITION"),
      );
    });
    await t.test("a task assigned to someone who can't act is worked by the office (042)", async () => {
      const caseId = await requestedCase(f);
      await f.act(f.preparer, caseId, "ESCALATE_CONTACT", { reason: "Office contact needed" });
      const [task] = (await f.readStaffCase(caseId)).followups;
      // Sam is a persona no staff account is linked to.
      await f.sql("update public.admin_followups set assignee_person_id=$2 where id=$1", [task.id, f.sam]);
      await f.logContact(f.siteCoordinator, caseId, SAMPLE_CONTACT(), task.id);
      await f.act(f.siteCoordinator, caseId, "RESOLVE_FOLLOWUP", {
        followupId: task.id,
        outcome: "reached",
        note: "Spoke with the client",
      });
      assert.equal((await f.readStaffCase(caseId)).followups[0].status, "resolved");
    });
  ```

  `tests/database-review.mjs`, a new subtest right after `"a go-over resolved during a hold still switches the plan"`:

  ```js
    await t.test("another follow-up holder resolves the go-over (042)", async () => {
      const jo = await f.staff({ key: "jo", name: "Jo Rivera", capabilities: ["admin", "followup"] });
      const caseId = await reviewingCase(f, f.reviewer);
      await setService(f, caseId, "online");
      await f.act(f.reviewer, caseId, "APPROVE_REVIEW", { questionnaire: NO });
      const [task] = await goOver(f, caseId);
      assert.notEqual(task.assignee_person_id, jo.personId);
      await f.logContact(jo.client, caseId, SAMPLE_CONTACT(), task.id);
      await f.act(jo.client, caseId, "RESOLVE_FOLLOWUP", {
        followupId: task.id,
        outcome: "reached",
        note: "Fictional: went over the return by phone.",
      });
      assert.deepEqual(await plan(f, caseId), { signing_plan: "portal", signing_appointment_at: null });
      await f.act(f.siteCoordinator, caseId, "MARK_READY_TO_EFILE", { confirmed: true });
      assert.equal((await f.readStaffCase(caseId)).stage, "ready_to_efile");
    });
  ```

  `tests/database-hold.mjs`: add `SAMPLE_CONTACT` to the import from `./support/database-fixture.mjs` (line 3), and a new subtest in the withdraw group (after `"withdraw before preparation"`):

  ```js
    await t.test("another follow-up holder logs on and resolves a withdrawal notice on the Closed case (042)", async () => {
      const jo = await f.staff({ key: "jo", name: "Jo Rivera", capabilities: ["admin", "followup"] });
      const caseId = await preparingCase();
      await withdraw(caseId);
      const [notice] = await notices(caseId);
      assert.equal(notice.status, "open");
      assert.notEqual(notice.assignee_person_id, jo.personId);
      const { contactId } = await f.logContact(jo.client, caseId, SAMPLE_CONTACT(), notice.id);
      const linked = await f.sql("select followup_id from public.contact_log where id=$1", [contactId]);
      assert.equal(linked.rows[0].followup_id, notice.id);
      await f.act(jo.client, caseId, "RESOLVE_FOLLOWUP", {
        followupId: notice.id,
        outcome: "reached",
        note: "Fictional: told the preparer to stop work.",
      });
      assert.equal((await notices(caseId))[0].status, "resolved");
      assert.equal((await columns(caseId)).stage, "closed");
    });
  ```

  `tests/database-staff-identity.mjs`:
  - In `"add_staff_member refuses what the roster must refuse"`, before `// Nothing was created for the account.`, add:

    ```js
      // Follow-up access without admin (042).
      await refused(f.unapprovedUserId, "quinn", "Quinn Ross", ["followup"]);
      await refused(f.unapprovedUserId, "quinn", "Quinn Ross", ["followup", "review"]);
    ```

  - A new subtest right after it:

    ```js
    await t.test("no follow-up-only person can be stored (042)", async () => {
      // f.sql wraps the pg error; the constraint name is on its cause.
      const byTheCheck = (error) =>
        error.code === "23514" && error.cause?.constraint === "people_followup_needs_admin";
      try {
        await assert.rejects(
          () => f.sql("update public.people set capabilities=$1 where id=$2", [["followup", "review"], riley.personId]),
          byTheCheck,
        );
        await assert.rejects(
          () =>
            f.sql(
              "insert into public.people(workspace_id,person_key,name,capabilities) values($1,'quinn_direct','Quinn Direct',$2)",
              [f.workspaceId, ["followup"]],
            ),
          byTheCheck,
        );
        // Admin without follow-up is still a valid person.
        await f.sql("update public.people set capabilities=$1 where id=$2", [["admin", "prepare"], riley.personId]);
      } finally {
        // On 041 the refused writes succeed; put Riley back so later subtests are unaffected.
        await f.sql("update public.people set capabilities=$1 where id=$2", [["prepare"], riley.personId]);
        await f.sql("delete from public.people where workspace_id=$1 and person_key='quinn_direct'", [f.workspaceId]);
      }
      assert.deepEqual((await personRow(f, "riley")).capabilities, ["prepare"]);
    });
    ```

  If a helper named here does not exist under that name in the file, use the file's own equivalent and say so in the report.

- [ ] **Step 3: Controller: see them fail on 041.** The implementer reports NEEDS_CONTEXT, "ready for the controller to run the five files on 041". The controller runs, one at a time:

  `node --env-file=.env.test --test tests/database-documents.mjs tests/database-staff-identity.mjs tests/database-actions.mjs tests/database-review.mjs tests/database-hold.mjs`

  Expected failures, each for the reason named:
  - the four new "(042)" rule subtests: `FORBIDDEN` where success is expected;
  - the converted resolved-task check: `FORBIDDEN` where `INVALID_TRANSITION` is expected;
  - the converted Frankie step: `FORBIDDEN`;
  - "add_staff_member refuses what the roster must refuse": the first new refusal's call succeeds (and creates the staff member `quinn`);
  - "no follow-up-only person can be stored": the update succeeds;
  - on 041 only, because `quinn` now exists: "initialize_workspace runs again once staff exist" fails its staff count by one.

  Any other failure is reported as is. The fixture tears its workspace down at the end, so `quinn` doesn't outlive the run; Step 5's count confirms it.

- [ ] **Step 4: Write 042.**

  ```sql
  -- 042: anyone holding `followup` works any open office follow-up, and
  -- `followup` requires `admin` (OpenSpec change
  -- let-follow-up-holders-work-any-follow-up, design D1, D2 and D6; issue #172).
  --
  --   * `lock_open_followup` (004, its only definition) no longer checks the
  --     assignee: the assignee is a label. A task that doesn't exist here, or
  --     belongs to another case, is still FORBIDDEN; a task that isn't open is
  --     INVALID_TRANSITION, whoever asks. Its callers, act_resolve_followup (041)
  --     and vitally_log_contact (038), check `followup` before calling it and
  --     are unchanged; `p_person` stays in the signature for them.
  --   * `add_staff_member` (038, its latest definition) also refuses capabilities
  --     with `followup` and no `admin`. The one changed line ends `-- 042`.
  --   * The check `people_followup_needs_admin` refuses any person with
  --     `followup` and no `admin`, whoever writes the row.
  --
  -- #136 (remove-presenter-access) also numbers its migration 042 and also
  -- redefines add_staff_member: whichever change merges second renumbers its
  -- migration and copies add_staff_member from the latest migration that
  -- defines it.
  --
  -- Written to be safe to apply again on a local test stack: `create or
  -- replace`, and the check dropped if it exists before it is added.
  --
  -- If adding the check fails, a follow-up-only person exists, usually left in
  -- a test workspace by an aborted test run. Find it with
  --   select workspace_id, person_key, capabilities from public.people
  --    where 'followup'=any(capabilities) and not 'admin'=any(capabilities);
  -- then give that person `admin` or remove its test workspace, and run the
  -- migrator again.

  -- ---------------------------------------------------------------------------
  -- 1. The lock: the task exists on this case and is open.

  create or replace function vitally_private.lock_open_followup(p_case public.cases,p_person public.people,p_payload jsonb)
  returns public.admin_followups language plpgsql security definer set search_path='' as $$
  declare v_followup public.admin_followups;
  begin
   select * into v_followup from public.admin_followups
    where workspace_id=p_case.workspace_id and case_id=p_case.id
     and id=vitally_private.payload_uuid(p_payload,'followupId') for update;
   if not found then -- 042
    raise sqlstate 'VT001' using message='FORBIDDEN';
   end if;
   if v_followup.status is distinct from 'open' then
    raise sqlstate 'VT004' using message='INVALID_TRANSITION';
   end if;
   return v_followup;
  end;
  $$;

  -- ---------------------------------------------------------------------------
  -- 2. add_staff_member, from 038.
  ```

  Then copy `create or replace function vitally_private.add_staff_member(...)` from `038_staff_identity.sql` (about lines 901-954, through its closing `$$;`) **verbatim**, and add one line inside its first `if`, immediately **before** the line `  or cardinality(p_capabilities)<>(select count(distinct c) from unnest(p_capabilities) c) then`, which stays as it is:

  ```sql
    or ('followup'=any(p_capabilities) and not 'admin'=any(p_capabilities)) -- 042
  ```

  Then:

  ```sql
  -- ---------------------------------------------------------------------------
  -- 3. Follow-up access needs admin, whoever writes the person.

  alter table public.people drop constraint if exists people_followup_needs_admin;
  alter table public.people add constraint people_followup_needs_admin
   check (not ('followup'=any(capabilities)) or 'admin'=any(capabilities));

  revoke all on all functions in schema vitally_private from public,anon,authenticated,service_role;
  ```

  Check the copy: `diff` the function body from 038 against 042's. The only difference must be the one added `-- 042` line.

- [ ] **Step 5: Controller: check the stack, dry-run, apply.** The implementer reports NEEDS_CONTEXT, "ready to apply 042". The controller:
  1. re-runs the #136 check;
  2. runs `select count(*) from public.people where 'followup'=any(capabilities) and not 'admin'=any(capabilities)` (expected 0);
  3. dry-runs 042 in `begin; \i …; checks; rollback;` with `docker cp` and `psql -f`. The checks: the lock's body has no `assignee_person_id`; `prosecdef` is true for both functions; neither is executable by `anon`, `authenticated` or `service_role`; the check exists;
  4. applies it with `npm run db:migrate:test`.

- [ ] **Step 6: Controller: see them pass.** Run the same five files (expected: all pass), then the whole `npm run test:database` alone. Expected: all pass. Record `ℹ tests` for Task 4.

- [ ] **Step 7: Commit** "Database: anyone with follow-up access works any open follow-up; followup needs admin (#172)", with the migration and the five test files, added by name.

### Task 2: The roster refuses `followup` without `admin`

**Files:**
- Modify: `tools/admin/roster.mjs` (`parseStaff`, about lines 54-82)
- Test: `tests/roster.test.mjs`

**Interfaces:**
- Consumes: nothing from Task 1. The command refuses before it talks to the database.
- Produces: `parseRoster(raw)` throws `ROSTER_INVALID` with `staff[<n>].capabilities must include admin when they include followup.` for such an entry.

- [ ] **Step 1: Write the failing tests** in `tests/roster.test.mjs`:
  - The `riley()` helper (about line 209) gets `capabilities: ["prepare", "admin", "followup"]`. Update the two expectations that name its capabilities (about lines 228 and 345) to `["prepare", "admin", "followup"]`.
  - In `"staff entries are validated before any account is made"`, add two rows to the table:

    ```js
    [riley({ capabilities: ["followup"] }), /staff\[0\]\.capabilities must include admin when they include followup\./],
    [riley({ capabilities: ["followup", "assist"] }), /staff\[0\]\.capabilities must include admin when they include followup\./],
    ```

    and replace the single-capability loop with:

    ```js
    for (const capability of ["prepare", "review", "admin", "receive_documents", "assist"])
      parseRoster(withStaff([riley({ capabilities: [capability] })]));
    parseRoster(withStaff([riley({ capabilities: ["admin", "followup"] })]));
    parseRoster(withStaff([riley({ capabilities: ["admin", "receive_documents"] })]));
    ```

  - A new test after it:

    ```js
    test("follow-up access without admin is refused at any position (042)", () => {
      const kai = riley({ email: "kai@example.org", name: "Kai Mensah", personKey: "kai", capabilities: ["followup", "assist"] });
      assert.throws(
        () => parseRoster(withStaff([riley(), kai])),
        refused(/^staff\[1\]\.capabilities must include admin when they include followup\.$/),
      );
    });
    ```

- [ ] **Step 2: Run it to see it fail:** `node --test tests/roster.test.mjs`. Expected: the new rows and test FAIL (the entries are accepted).

- [ ] **Step 3: The refusal.** The comment `// Mirrors vitally_private.add_staff_member (migration 038) so the operator gets` (about line 37) becomes `// Mirrors vitally_private.add_staff_member (latest in migration 042) so the operator gets`. In `parseStaff`, right after the capabilities check that throws `${where}.capabilities must be a non-empty list of: …`, add:

  ```js
      if (capabilities.includes("followup") && !capabilities.includes("admin"))
        throw invalid(`${where}.capabilities must include admin when they include followup.`);
    ```

- [ ] **Step 4: Run it to see it pass:** `node --test tests/roster.test.mjs`, then `npm test`. Expected: PASS.

- [ ] **Step 5: Commit** "Roster: follow-up access needs admin (#172)".

### Task 3: The browser follows the database

**Files:**
- Modify: `src/admin-views.mjs` (`followupWork` about lines 293-308; the comment about lines 371-372; the comment above `followupForms` about lines 549-552; the panel note about line 617)
- Modify: `src/office-views.mjs` (the Call the client row, about lines 274-278)
- Modify: `src/staff-views.mjs` (`followupPanel`, about line 1918; the comment about lines 239-240)
- Modify: `src/supabase-store.mjs` (comments only, about lines 459-461 and 535-536)
- Modify: `tests/database-store.mjs` (a comment only, about line 149)
- Test: `tests/admin-views.test.mjs`, `tests/office-views.test.mjs`, `tests/staff-views.test.mjs`, `tests/fixtures/empty-states.json`, `tests/empty-states.test.mjs`

**Interfaces:**
- Consumes: Task 1's rule. The browser only mirrors it.
- Produces: no new exports. `adminEligibility(...).recordContact` and `.resolveFollowup` allow any `followup` holder on an open task.

- [ ] **Step 1: Write the failing tests.**

  `tests/admin-views.test.mjs`:
  - Replace the `MORGAN_FOLLOWUP` constant and its comment (about lines 42-48) with:

    ```js
    // A second office person: holding `admin` and `followup` is enough to work
    // any open task, whoever it is assigned to (042).
    const JO_OFFICE = {
      id: "jo",
      name: "Jo",
      capabilities: ["admin", "followup"],
    };
    ```

  - Replace the comment `// There is no way to hand the task to somebody else.` and the two lines after it (about lines 315-317) with:

    ```js
      // There is no way to hand the task to somebody else, and the note says
      // anyone with follow-up access may work it.
      assert.doesNotMatch(html, /name="assignee/i);
      assert.match(
        html,
        /The office raises a task when a preparer asks it to contact a client, when a reviewer didn't go over the return with the client, or when a case is withdrawn or closed before its return is filed\. Anyone in the office with follow-up access can log contacts on it and resolve it\./,
      );
      assert.doesNotMatch(html, /no way to hand it to someone else/i);
    ```

  - Replace the block from `// Holding the capability is still not holding the task.` to the end of that test (about lines 323-328) with:

    ```js
      // Holding the capability is enough: the assignee is a label (042).
      const forJo = renderAdminCase(record, { person: JO_OFFICE });
      assert.match(forJo, linkedForm("task-1"));
      assert.match(forJo, /data-case-action="RESOLVE_FOLLOWUP"/);
      assert.match(forJo, /<span>Assigned to<\/span><strong>Sam<\/strong>/);
      assert.doesNotMatch(forJo, /The office assigned this task to someone else\./);
      // Admin without follow-up access is still refused, by capability.
      const forDesk = renderAdminCase(record, {
        person: { id: "desk", name: "Desk", capabilities: ["admin", "receive_documents"] },
      });
      assert.doesNotMatch(forDesk, linkedForm("task-1"));
      assert.match(forDesk, /Needs office follow-up access\./);
    });
    ```

  `tests/office-views.test.mjs`:
  - Rename `"a call row opens the log-a-call drawer and says who owes the call"` to `"a call row opens the log-a-call drawer and names the assignees as a label"`, and change its last assertion to `assert.match(row, /2 open tasks · assigned to Sam, Jo/);`.
  - Replace the test `"a task assigned to someone else shows the reason and no form"` (about lines 444-453) with:

    ```js
    test("a task assigned to someone else offers the forms (042)", () => {
      const html = logCallDrawerBody({
        record: called([task({ assigneeId: "p-jo", assigneeName: "Jo" })]),
        person: sam,
        ui: {},
        caseId: "c1",
      });
      assert.doesNotMatch(html, /The office assigned this task to someone else\./);
      assert.match(html, /<span>Assigned to<\/span><strong>Jo<\/strong>/);
      assert.match(html, /<form class="staff-form contact-form" data-case-id="c1" data-followup-id="f1">/);
      assert.match(html, /data-case-action="RESOLVE_FOLLOWUP"[^>]*data-followup-id="f1"/);
    });
    ```

  `tests/staff-views.test.mjs`, a new test (with `staffCase` and `ALEX` as the file defines them):

  ```js
  test("the volunteer page shows a task's assignee as a label (042)", () => {
    const html = renderStaffCase(
      staffCase({
        followups: [
          { id: "f1", status: "open", reason: "Office contact needed", assigneeId: "sam", assigneeName: "Sam" },
        ],
      }),
      ALEX,
    );
    const panel = html.slice(html.indexOf('id="followup-title"'));
    assert.match(panel, /<span class="muted small">Assigned to Sam<\/span>/);
    assert.doesNotMatch(panel, /data-case-action="RESOLVE_FOLLOWUP"/);
    assert.match(panel, /Contacts for an office task are logged on the office screens\./);
  });
  ```

  If `staffCase(...)` does not produce a staff-shaped record (one with `participants` and `reviews` arrays), pass those arrays in the overrides.

- [ ] **Step 2: Run them to see them fail:** `node --test tests/admin-views.test.mjs tests/office-views.test.mjs tests/staff-views.test.mjs`. Expected: FAIL on the new note, on the forms for Jo, on "assigned to", and on "Assigned to Sam".

- [ ] **Step 3: The code.**

  `src/admin-views.mjs`, the comment and `followupWork`:

  ```js
    // The office contacts a client about one task. The assignment is the
    // server's (`ESCALATE_CONTACT` reads the workspace default) and is only a
    // label: anyone holding `followup` may work any open task (042). There is
    // no assignee selector anywhere.
    const followupWork = () => {
      const stopped = gate("followup");
      if (stopped) return stopped;
      if (!followup) return refused("This task is no longer on screen.");
      if (followup.status !== "open")
        return refused(
          followup.status === "cancelled"
            ? "This task was cancelled when the case closed."
            : "This task is already resolved.",
        );
      return allowed;
    };
  ```

  The comment above `recordContact: contact,` becomes:

  ```js
      // One rule, two actions: the database checks the same capability and the
      // same open status for both.
  ```

  The comment above `export function followupForms` starts `// The two forms anyone with follow-up access uses on an open task: the shared Log contact form,` and keeps its other lines.

  In `adminFollowupPanel`, the note:

  ```js
  <p class="field-note">The office raises a task when a preparer asks it to contact a client, when a reviewer didn't go over the return with the client, or when a case is withdrawn or closed before its return is filed. Anyone in the office with follow-up access can log contacts on it and resolve it.</p>
  ```

  `src/office-views.mjs`, the call row:

  ```js
    if (kind === "call") {
      const n = callTasks(record);
      const assignees = record?.followupAssigneeNames ?? [];
      return `${esc(n)} open ${n === 1 ? "task" : "tasks"}${when(assignees.length, ` · assigned to ${esc(assignees.join(", "))}`)}`;
    }
  ```

  The comments that call the assignee the person who owes a call:
  - `src/staff-views.mjs` (about lines 239-240): `// A board row carries the assignees of its open tasks, as a label, rather than the tasks` / `// themselves (Ruling R56), and they get names here like everybody else.`
  - `src/supabase-store.mjs` (about line 461): "or who owes somebody a call" becomes "or whom the office asked to call somebody"; (about lines 535-536): `// The assignees of this client's open tasks, as a label (042), without the tasks` / `// themselves: the board names people, and the case screen holds the work.`
  - `tests/database-store.mjs` (about line 149): "and it names who owes the call" becomes "and it names whom the office assigned the call to".

  `src/staff-views.mjs`, in `followupPanel`, the task heading's span:

  ```js
  <span class="muted small">Assigned to ${esc(followup?.assigneeName ?? UNKNOWN_PERSON)}</span>
  ```

- [ ] **Step 4: The snapshot fixture.** In `tests/fixtures/empty-states.json`, in the `adminCase` string only, replace `The office raises a task when a preparer asks it to contact a client. ViTally assigns it; there is no way to hand it to someone else here.` with the new note (Global Constraints). Do it with a script that asserts the old sentence occurs exactly once. In the header comment of `tests/empty-states.test.mjs`, append: `The office case page's Follow-up note changed on purpose (change let-follow-up-holders-work-any-follow-up).`

- [ ] **Step 5: Run them to see them pass:** `node --test tests/admin-views.test.mjs tests/office-views.test.mjs tests/staff-views.test.mjs tests/empty-states.test.mjs`, then `npm test`. Expected: PASS. Then `grep -rn 'assigned this task to someone else\|no way to hand it to someone else\|waiting on \${\|owes\? \(a\|the\|this\|somebody\) call\|[Ww]ho owe' src/ tests/fixtures/` (single quotes). Expected: no match. The tests keep `doesNotMatch` assertions on the old texts, which is why `tests/` itself is not searched.

- [ ] **Step 6: Commit** "Follow-up tasks: anyone with follow-up access works them; the assignee is a label (#172)".

### Task 4: Docs and counts

**Files:**
- Modify: `docs/developer/database.md`, `docs/developer/backend.md`, `docs/setup.md`, `README.md`, `docs/developer/README.md`

**Interfaces:**
- Consumes: Task 1's migration name and the test counts from Task 1 Step 6, Task 3 Step 5 and Task 5.
- Produces: docs only.

- [ ] **Step 1: The migration docs.**
  - `docs/developer/database.md`:
    - "The schema is forty-one plain SQL files" becomes "forty-two".
    - A row after 041's in the migration table: `| \`042_let_follow_up_holders_work_any_follow_up.sql\` | Hand-written: \`lock_open_followup\` no longer checks the assignee, so anyone holding \`followup\` works any open office follow-up (a missing or other-case task is still \`FORBIDDEN\`); \`add_staff_member\`, copied from 038, refuses \`followup\` without \`admin\`; the check \`people_followup_needs_admin\` (#172) |`
    - In the latest-definition table, take `add_staff_member` out of the 038 row, and add `| \`vitally_private.lock_open_followup\`, \`add_staff_member\` | \`042_let_follow_up_holders_work_any_follow_up.sql\` |`.
    - In the `RECORD_CONTACT` and `RESOLVE_FOLLOWUP` rows, `Assignee; task \`open\`` becomes `Task \`open\` (any \`followup\` holder, 042)`.
    - The contact-log rule (about lines 620-622): "Linking to a follow-up task (`p_followup_id`) needs `followup` and an open task on this case; since 042 any `followup` holder may link, not only the task's assignee."
  - `docs/setup.md`:
    - "Forty-one migrations, applied in order." becomes "Forty-two migrations, applied in order."
    - A row after 041's: `| \`042_let_follow_up_holders_work_any_follow_up.sql\` | Hand-written: anyone holding \`followup\` works any open office follow-up, whoever it is assigned to, and \`followup\` requires \`admin\` (#172) |`
    - In the roster's `staff` row (about line 702), after the capabilities list: "an entry with `followup` must also have `admin`;".
  - `docs/developer/database.md`, two more passages:
    - the `people` row (about line 190): after the capability list, "; `followup` requires `admin` (042, check `people_followup_needs_admin`)";
    - the `add_staff_member` bullet (about lines 325-329): add "capabilities with `followup` but not `admin` (042)" to its `VT007` refusal list, right after "a capability outside the known set".
  - `docs/developer/backend.md`, the roster's `staff` row (about line 163): after the capability list, "; an entry with `followup` must also have `admin` (042)", worded as in setup.md.
  - `docs/developer/backend.md` (about line 164): the `defaultFollowup` row's reason becomes "**Required when the roster has no presenter**, so that new follow-ups name a real staff member rather than the persona Sam (since 042 anyone holding `followup` can work them). The person must have `followup`, and so `admin`".
  - `README.md` and `docs/developer/README.md`: the migration range `001–041` / `001-041` becomes `001–042` / `001-042`.

- [ ] **Step 2: Grep for what's now false.** `grep -rn -i --include='*.md' 'assignee\|someone else\|waiting on\|any combination\|is non-empty\|owes\? \(a\|the\) call' docs README.md | grep -v docs/superpowers`. Fix each claim that says only the assignee works a task, or that `followup` needs nothing else. Do not touch `docs/superpowers/` or `openspec/changes/archive/`.

- [ ] **Step 3: The test counts.** Using the real numbers from the runs:
  - `docs/setup.md`: the Unit and Database rows, and the last-verified sentence (verified on this change, on the date of the runs, with migration 042 applied);
  - `docs/developer/README.md`: the unit and database counts;
  - `docs/developer/database.md`: the database count.

  Browser story count only if Task 5's run changes it.

- [ ] **Step 4: Commit** "Docs: follow-up holders work any follow-up; migration 042 (#172)".

### Task 5: Final checks (controller)

**Files:** none, unless a check fails.

- [ ] **Step 1:** `npm run test:browser` alone, with `.env.test` linked in the worktree. Expected: pass. If the story's count changes, Task 4 Step 3 records it.
- [ ] **Step 2:** `npm test`, `npx openspec validate --all`, and `git diff --check`. Expected: pass and clean.
- [ ] **Step 3:** `git fetch origin`, then merge `origin/main`. Confirm `ls supabase/migrations | grep '^042_'` prints exactly one file, and that #136 hasn't merged in between. If it has, stop and follow design D6.
