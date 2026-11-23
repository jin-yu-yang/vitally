import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createDatabaseFixture, TEST_SITE_NUMBER } from "./support/database-fixture.mjs";
import { openDatabase } from "../tools/admin/database.mjs";
import { applyRoster, parseRoster } from "../tools/admin/roster.mjs";
import { initializeWorkspace } from "../tools/admin/workspace-setup.mjs";
import {
  applyAction,
  deletePreviousRun,
  ensureSiteNumber,
  readRun,
  recordRun,
  resolveSeedTargets,
  runFilePath,
  SEED_SCENARIOS,
  seedCases,
  seedPastSeason,
  seedVolunteers,
  seedWorkspace,
} from "../tools/admin/seed-cases.mjs";
import * as SEED_VALUES from "../tools/admin/seed-values.mjs";
import { addDays, coverageRows, weekBounds } from "../src/volunteer-schedule.mjs";

// The fixture's role account (f.roleAccounts) for each person key.
const ROLE_BY_KEY = Object.freeze({
  site_coordinator: "siteCoordinator",
  preparer: "preparer",
  reviewer: "reviewer",
  intaker: "intaker",
});
const tempRunDir = () => mkdtemp(path.join(tmpdir(), "seed-run-"));
const readRunFile = async (workspaceId, runDir) =>
  JSON.parse(await readFile(runFilePath(workspaceId, runDir), "utf8"));

test("seed command against real Supabase", async (t) => {
  const f = await createDatabaseFixture();
  const client = await openDatabase();
  try {
    await t.test(
      "acting as a staff account goes through the RPC as that person",
      async () => {
        const caseId = await f.readyCase();
        const before = (await client.query("select current_user as u")).rows[0].u;
        await applyAction(client, f.preparerUserId, caseId, "CLAIM_PREPARATION");
        const row = (
          await f.sql("select preparer_id, stage from public.cases where id=$1", [
            caseId,
          ])
        ).rows[0];
        assert.equal(row.preparer_id, f.preparerId);
        assert.equal(row.stage, "preparing");
        const receipts = (
          await f.sql(
            "select operation, actor_person_id from public.action_receipts where target_id=$1 and actor_user_id=$2",
            [caseId, f.preparerUserId],
          )
        ).rows;
        assert.ok(receipts.length >= 1);
        for (const receipt of receipts)
          assert.equal(receipt.actor_person_id, f.preparerId);
        const after = (await client.query("select current_user as u")).rows[0].u;
        assert.equal(after, before);
        assert.notEqual(after, "authenticated");
      },
    );

    await t.test("resolves the role accounts and client A", async () => {
      const targets = await resolveSeedTargets(client, {
        workspaceId: f.workspaceId,
        clientAEmail: f.applicantAEmail,
      });
      assert.equal(targets.workspaceId, f.workspaceId);
      assert.deepEqual(targets.siteCoordinator, {
        userId: f.siteCoordinatorUserId,
        personId: f.siteCoordinatorId,
      });
      assert.deepEqual(targets.preparer, {
        userId: f.preparerUserId,
        personId: f.preparerId,
      });
      assert.deepEqual(targets.reviewer, {
        userId: f.reviewerUserId,
        personId: f.reviewerId,
      });
      assert.deepEqual(targets.clientA, { userId: f.applicantAUserId });
    });

    await t.test("refuses a missing role key", async () => {
      const workspaceId = randomUUID();
      await f.initializeOwned({
        workspaceId,
        applicantUserIds: [],
      });
      await f.staff({
        key: "preparer",
        name: "Pat Preparer",
        capabilities: ["prepare"],
        workspaceId,
      });
      await assert.rejects(
        resolveSeedTargets(client, {
          workspaceId,
          clientAEmail: f.applicantAEmail,
        }),
        (error) =>
          error.code === "SEED_SETUP" && error.message.includes("site_coordinator"),
      );
    });

    await t.test("refuses missing ids", async () => {
      for (const args of [
        { clientAEmail: f.applicantAEmail },
        { workspaceId: f.workspaceId },
      ])
        await assert.rejects(
          resolveSeedTargets(client, args),
          (error) => error.code === "SEED_SETUP" && !error.message.includes("@"),
        );
    });

    await t.test(
      "refuses when the default follow-up person is not the site coordinator",
      async () => {
        await f.sql(
          "update public.workspaces set default_followup_person_id=$2 where id=$1",
          [f.workspaceId, f.preparerId],
        );
        try {
          await assert.rejects(
            resolveSeedTargets(client, {
              workspaceId: f.workspaceId,
              clientAEmail: f.applicantAEmail,
            }),
            (error) =>
              error.code === "SEED_SETUP" && !error.message.includes("@"),
          );
        } finally {
          await f.sql(
            "select vitally_private.set_default_followup($1,$2)",
            [f.workspaceId, "site_coordinator"],
          );
        }
      },
    );

    // Change add-season-settings (spec local-seed-data, "The Site Coordinator
    // is not a site coordinator"), as on a stack set up from an older roster.
    await t.test(
      "refuses when the site_coordinator account is not a site coordinator",
      async () => {
        const runDir = await tempRunDir();
        const setFlag = (value) =>
          f.sql(
            "update public.accounts set is_site_coordinator=$3 where workspace_id=$1 and person_id=$2",
            [f.workspaceId, f.siteCoordinatorId, value],
          );
        const counts = async () =>
          (
            await f.sql(
              `select (select count(*)::int from public.cases where workspace_id=$1) as cases,
                      (select count(*)::int from public.people where workspace_id=$1) as people`,
              [f.workspaceId],
            )
          ).rows[0];
        const before = await counts();
        await setFlag(false);
        try {
          const refusal = (error) =>
            error.code === "SEED_SETUP" &&
            error.message.includes('"site_coordinator"') &&
            error.message.includes("siteCoordinator: true") &&
            error.message.includes("roster command") &&
            !error.message.includes("@");
          await assert.rejects(
            resolveSeedTargets(client, {
              workspaceId: f.workspaceId,
              clientAEmail: f.applicantAEmail,
            }),
            refusal,
          );
          await assert.rejects(
            seedWorkspace({ workspaceId: f.workspaceId, clientAEmail: f.applicantAEmail, runDir }),
            refusal,
          );
          assert.deepEqual(await counts(), before, "nothing created or deleted");
        } finally {
          await setFlag(true);
          await rm(runDir, { recursive: true, force: true });
        }
      },
    );

    // Change add-season-settings (spec local-seed-data, "No SIDN yet"). The
    // fixture's own SIDN is put back afterwards. Fictional numbers only.
    await t.test("sets the fictional SIDN only when none is set", async () => {
      const runDir = await tempRunDir();
      const stored = async () =>
        (
          await f.sql(
            "select sidn, updated_at from vitally_private.site_numbers where workspace_id=$1",
            [f.workspaceId],
          )
        ).rows[0];
      try {
        await f.sql("delete from vitally_private.site_numbers where workspace_id=$1", [f.workspaceId]);
        await seedWorkspace({ workspaceId: f.workspaceId, clientAEmail: f.applicantAEmail, runDir });
        assert.equal((await stored())?.sidn, "S00000000");
        // A SIDN already set (here, another fictional one) is left alone.
        await f.sql("select vitally_private.set_site_number($1,$2)", [f.workspaceId, "S12345678"]);
        const set = await stored();
        assert.equal(
          await ensureSiteNumber(client, {
            workspaceId: f.workspaceId,
            actorUserId: f.siteCoordinatorUserId,
          }),
          false,
        );
        assert.deepEqual(await stored(), set);
      } finally {
        // The seeded cases go, so later tests start from the fixture's own.
        await deletePreviousRun(client, await readRun(f.workspaceId, runDir));
        await f.sql("select vitally_private.set_site_number($1,$2)", [f.workspaceId, TEST_SITE_NUMBER]);
        await rm(runDir, { recursive: true, force: true });
      }
    });

    // Review Focus 5 (spec sign-in, "Running the roster again" and "An old
    // roster with a site number"): the fixture's roster, run again through the
    // roster command's own path with old keys, adds no site coordinator
    // history row and leaves the SIDN set on Season settings alone.
    await t.test("re-running the same roster is a no-op", async () => {
      const history = async () =>
        (
          await f.sql(
            "select count(*)::int as count from public.site_coordinator_changes where workspace_id=$1",
            [f.workspaceId],
          )
        ).rows[0].count;
      const sidn = async () =>
        (
          await f.sql(
            "select sidn, updated_at from vitally_private.site_numbers where workspace_id=$1",
            [f.workspaceId],
          )
        ).rows[0];
      const accounts = [
        ...Object.values(f.roleAccounts).map(({ userId, email }) => ({ id: userId, email })),
        { id: f.applicantAUserId, email: f.applicantAEmail },
        { id: f.applicantBUserId, email: f.applicantBEmail },
      ].map((user) => ({ ...user, email_confirmed_at: "then" }));
      const admin = {
        auth: {
          admin: {
            listUsers: async () => ({ data: { users: accounts }, error: null }),
            createUser: async () => assert.fail("a re-run creates no account"),
            updateUserById: async () => assert.fail("a re-run confirms no account"),
          },
        },
      };
      const raw = {
        workspaceId: f.workspaceId,
        staff: f.setup.staff.map((member) => ({
          email: f.roleAccounts[ROLE_BY_KEY[member.personKey]].email,
          name: member.name,
          personKey: member.personKey,
          capabilities: member.capabilities,
          ...(member.siteCoordinator ? { siteCoordinator: true } : {}),
        })),
        defaultFollowup: f.setup.defaultFollowup,
        siteNumber: "S99999999",
        applicants: [f.applicantAEmail, f.applicantBEmail],
      };
      const roster = parseRoster(raw);
      assert.ok(roster.notices.some((note) => note.startsWith("siteNumber is no longer used")));
      const beforeHistory = await history();
      const beforeSidn = await sidn();
      const people = async () =>
        (
          await f.sql(
            "select id, person_key, name, user_id from public.people where workspace_id=$1 order by id",
            [f.workspaceId],
          )
        ).rows;
      const beforePeople = await people();
      for (let run = 0; run < 2; run += 1) {
        const result = await applyRoster(roster, {
          admin,
          initialize: (setup) => f.withSetupLock(() => initializeWorkspace(setup)),
        });
        assert.equal(result.created, 0);
        assert.equal(await history(), beforeHistory, "no site coordinator history row");
        assert.deepEqual(await sidn(), beforeSidn, "the SIDN is unchanged");
        assert.deepEqual(await people(), beforePeople, "no person added or renamed");
      }
    });

    await t.test("refuses when the first applicant has no account", async () => {
      await assert.rejects(
        resolveSeedTargets(client, {
          workspaceId: f.workspaceId,
          clientAEmail: "nobody@example.org",
        }),
        (error) =>
          error.code === "SEED_SETUP" && !error.message.includes("nobody"),
      );
    });

    await t.test(
      "deletePreviousRun deletes only listed rows in its own workspace",
      async () => {
        const own = await f.createCase(f.applicantA, randomUUID());
        const foreign = await f.createCase(f.outsider, randomUUID());
        const result = await deletePreviousRun(client, {
          workspaceId: f.workspaceId,
          caseIds: [own.caseId, foreign.caseId, randomUUID()],
          assistanceIds: [randomUUID()],
        });
        assert.equal(result.casesRemoved, 1);
        const left = (
          await f.sql("select id from public.cases where id = any($1::uuid[])", [
            [own.caseId, foreign.caseId],
          ])
        ).rows.map((r) => r.id);
        assert.deepEqual(left, [foreign.caseId]);
      },
    );

    await t.test("readRun returns empty lists when there is no file", async () => {
      const runDir = await mkdtemp(path.join(tmpdir(), "seed-run-"));
      try {
        const workspaceId = randomUUID();
        assert.deepEqual(await readRun(workspaceId, runDir), {
          workspaceId,
          caseIds: [],
          assistanceIds: [],
          shifts: [],
          checkInIds: [],
        });
        assert.equal(
          runFilePath(workspaceId, runDir),
          `${runDir}/seed-${workspaceId}.json`,
        );
      } finally {
        await rm(runDir, { recursive: true, force: true });
      }
    });

    await t.test("recordRun then readRun round-trips", async () => {
      const base = await mkdtemp(path.join(tmpdir(), "seed-run-"));
      const runDir = path.join(base, "nested");
      try {
        const run = {
          workspaceId: randomUUID(),
          caseIds: [randomUUID(), randomUUID()],
          assistanceIds: [randomUUID()],
          shifts: [{ id: randomUUID(), revision: 1 }],
          checkInIds: [randomUUID()],
        };
        await recordRun(run, runDir);
        assert.deepEqual(await readRun(run.workspaceId, runDir), run);
      } finally {
        await rm(base, { recursive: true, force: true });
      }
    });

    await t.test("readRun turns missing or non-array id lists into empty lists", async () => {
      const runDir = await tempRunDir();
      try {
        const workspaceId = randomUUID();
        await writeFile(
          runFilePath(workspaceId, runDir),
          JSON.stringify({ workspaceId, caseIds: "not a list" }),
        );
        assert.deepEqual(await readRun(workspaceId, runDir), {
          workspaceId,
          caseIds: [],
          assistanceIds: [],
          shifts: [],
          checkInIds: [],
        });
      } finally {
        await rm(runDir, { recursive: true, force: true });
      }
    });

    const targetsFor = () =>
      resolveSeedTargets(client, {
        workspaceId: f.workspaceId,
        clientAEmail: f.applicantAEmail,
      });
    const caseRows = async (ids) =>
      (
        await f.sql(
          "select id, stage, owner_user_id, preparer_id, reviewer_id, closing_reason, hold_origin, revision from public.cases where id = any($1::uuid[])",
          [ids],
        )
      ).rows;

    await t.test(
      "seeds client A's case, ten office scenarios and one help request",
      async () => {
        const runDir = await tempRunDir();
        try {
          const result = await seedWorkspace({
            workspaceId: f.workspaceId,
            clientAEmail: f.applicantAEmail,
            runDir,
          });
          assert.equal(result.casesCreated, 11);
          assert.equal(result.casesRemoved, 0);
          const run = await readRunFile(f.workspaceId, runDir);
          assert.equal(run.caseIds.length, SEED_SCENARIOS.length);
          // The run file lists the cases in scenario order.
          const ids = Object.fromEntries(
            SEED_SCENARIOS.map((scenario, i) => [scenario, run.caseIds[i]]),
          );
          const rows = Object.fromEntries(
            (await caseRows(run.caseIds)).map((row) => [row.id, row]),
          );
          const row = (scenario) => rows[ids[scenario]];
          assert.deepEqual(
            SEED_SCENARIOS.map((scenario) => row(scenario).stage),
            [
              "received",
              "preparation_ready",
              "preparing",
              "preparing",
              "review_ready",
              "corrections_required",
              "review_approved",
              "rejected",
              "accepted",
              "on_hold",
              "closed",
            ],
          );
          for (const scenario of SEED_SCENARIOS)
            assert.equal(
              row(scenario).owner_user_id,
              scenario === "client_received" ? f.applicantAUserId : null,
              scenario,
            );
          assert.equal(row("preparation_ready").preparer_id, null);
          assert.equal(row("review_ready").reviewer_id, null);
          assert.equal(row("on_hold").hold_origin, "awaiting_documents");
          const prepared = SEED_SCENARIOS.slice(
            SEED_SCENARIOS.indexOf("waiting_documents"),
            SEED_SCENARIOS.indexOf("accepted") + 1,
          );
          for (const scenario of prepared)
            assert.equal(row(scenario).preparer_id, f.preparerId, scenario);
          for (const scenario of ["review_approved", "rejected", "accepted"])
            assert.equal(row(scenario).reviewer_id, f.reviewerId, scenario);
          // REQUEST_CORRECTIONS clears cases.reviewer_id (migration 006); the
          // Reviewer stays named on the review that asked for the corrections.
          assert.equal(row("corrections_required").reviewer_id, null);
          const correctionReviews = (
            await f.sql(
              "select reviewer_person_id from public.reviews where case_id=$1 and status='corrections_requested'",
              [ids.corrections_required],
            )
          ).rows;
          assert.deepEqual(correctionReviews, [{ reviewer_person_id: f.reviewerId }]);
          assert.equal(row("withdrawn").closing_reason, "withdrawn");
          const followups = (
            await f.sql(
              "select assignee_person_id from public.admin_followups where case_id=$1 and status='open'",
              [ids.admin_followup],
            )
          ).rows;
          assert.deepEqual(followups, [{ assignee_person_id: f.siteCoordinatorId }]);
          const requests = (
            await f.sql(
              "select id from public.document_requests where case_id=$1 and status='open'",
              [ids.waiting_documents],
            )
          ).rows;
          assert.equal(requests.length, 1);
          const stateReturn = (
            await f.sql(
              "select result from public.filing_returns where case_id=$1 and return_kind='state'",
              [ids.rejected],
            )
          ).rows;
          assert.deepEqual(stateReturn, [{ result: "rejected" }]);
          const acceptedReturns = (
            await f.sql(
              "select result from public.filing_returns where case_id=$1",
              [ids.accepted],
            )
          ).rows;
          assert.deepEqual(acceptedReturns, [
            { result: "accepted" },
            { result: "accepted" },
          ]);
          const help = (
            await f.sql(
              "select id from public.assistance_items where case_id=$1 and status='open' and assignee_person_id is null",
              [ids.client_received],
            )
          ).rows;
          assert.deepEqual(help.map((item) => item.id), run.assistanceIds);
          assert.equal(help.length, 1);
        } finally {
          await rm(runDir, { recursive: true, force: true });
        }
      },
    );

    await t.test(
      "seedWorkspace clears the role accounts once and backs every volunteer",
      async () => {
        const runDir = await tempRunDir();
        const keys = ["site_coordinator", "preparer", "reviewer", "intaker"];
        try {
          // Start from uncleared role accounts: no roles, no certificates.
          await f.sql("begin");
          try {
            await f.sql(
              `update public.roster_entries e set roles='{}', is_new=true, photo_id_checked_at=null
                 from public.people p
                where p.id=e.person_id and p.workspace_id=$1 and p.person_key=any($2)`,
              [f.workspaceId, keys],
            );
            await f.sql(
              `delete from public.certificates c using public.people p
                where p.id=c.person_id and p.workspace_id=$1 and p.person_key=any($2)`,
              [f.workspaceId, keys],
            );
            await f.sql("commit");
          } catch (error) {
            await f.sql("rollback").catch(() => {});
            throw error;
          }
          const args = {
            workspaceId: f.workspaceId,
            clientAEmail: f.applicantAEmail,
            runDir,
          };
          await seedWorkspace(args);
          const accounts = async () =>
            (
              await f.sql(
                `select p.person_key, p.capabilities,
                        vitally_private.cleared(p.workspace_id, p.id) as cleared,
                        vitally_private.effective_capabilities(p.workspace_id, p.id) as effective,
                        v.revision, e.roles, e.is_new,
                        array(select c.certificate from public.certificates c
                               where c.person_id=p.id and c.season=e.season and c.status='confirmed'
                               order by 1) as certificates
                   from public.people p
                   join public.volunteer_profiles v on v.person_id=p.id
                   join public.workspaces w on w.id=p.workspace_id
                   join public.roster_entries e on e.person_id=p.id and e.season=w.current_season
                  where p.workspace_id=$1 and p.person_key=any($2)
                  order by p.person_key`,
                [f.workspaceId, keys],
              )
            ).rows;
          const first = await accounts();
          assert.deepEqual(first.map((r) => r.person_key), [...keys].sort());
          for (const row of first) {
            const want = SEED_VALUES.ROLE_ACCOUNT_CLEARANCE[row.person_key];
            assert.equal(row.cleared, true, row.person_key);
            assert.deepEqual(
              [...row.effective].sort(),
              [...row.capabilities].sort(),
              row.person_key,
            );
            assert.deepEqual(row.roles, want.roles, row.person_key);
            assert.deepEqual(row.certificates, [...want.certificates].sort(), row.person_key);
            assert.equal(row.is_new, false, row.person_key);
          }
          // A second run changes nothing about the role accounts.
          await seedWorkspace(args);
          const second = await accounts();
          assert.deepEqual(
            second.map((r) => [r.person_key, r.revision]),
            first.map((r) => [r.person_key, r.revision]),
          );
          // Exactly one volunteer has no roles, and is not cleared.
          const volunteers = (
            await f.sql(
              `select v.email, e.roles, e.is_new, e.photo_id_checked_at is not null as photo,
                      vitally_private.cleared(p.workspace_id, p.id) as cleared,
                      exists(select 1 from public.accounts a
                              where a.workspace_id=p.workspace_id and a.person_id=p.id) as has_account,
                      (select count(*)::int from public.certificates c
                        where c.person_id=p.id and c.season=e.season) as certs
                 from public.people p
                 join public.volunteer_profiles v on v.person_id=p.id
                 join public.workspaces w on w.id=p.workspace_id
                 join public.roster_entries e on e.person_id=p.id and e.season=w.current_season
                where p.workspace_id=$1 and v.email=any($2)`,
              [f.workspaceId, SEED_VALUES.SEED_VOLUNTEERS.map((v) => v.email)],
            )
          ).rows;
          assert.equal(volunteers.length, SEED_VALUES.SEED_VOLUNTEERS.length);
          const empty = volunteers.filter((v) => v.roles.length === 0);
          assert.equal(empty.length, 1);
          assert.equal(empty[0].certs, 0);
          assert.equal(empty[0].cleared, false);
          // 047 (add-account-invitations, design D6): the seed volunteers have
          // no sign-in and so no account, and none is cleared, not even the new
          // one whose photo ID is checked. The role accounts above, which have
          // active accounts, are the cleared counterpart.
          assert.ok(volunteers.every((v) => !v.has_account), "no seed volunteer has an account");
          assert.ok(volunteers.some((v) => v.is_new && v.photo && v.roles.length > 0 && !v.cleared));
          assert.ok(volunteers.some((v) => v.is_new && !v.photo && !v.cleared));
          assert.ok(volunteers.every((v) => !v.cleared), "no seed volunteer is cleared");
        } finally {
          await rm(runDir, { recursive: true, force: true });
        }
      },
    );

    await t.test(
      "clearing a role account keeps the extra roles and certificates it already has",
      async () => {
        const runDir = await tempRunDir();
        const ids = {
          site_coordinator: f.siteCoordinatorId,
          reviewer: f.reviewerId,
          intaker: f.intakerId,
        };
        const state = async () =>
          Object.fromEntries(
            (
              await f.sql(
                `select p.person_key, v.revision, e.roles, e.is_new,
                        vitally_private.cleared(p.workspace_id, p.id) as cleared,
                        array(select c.certificate from public.certificates c
                               where c.person_id=p.id and c.season=e.season and c.status='confirmed'
                               order by 1) as certificates
                   from public.people p
                   join public.volunteer_profiles v on v.person_id=p.id
                   join public.workspaces w on w.id=p.workspace_id
                   join public.roster_entries e on e.person_id=p.id and e.season=w.current_season
                  where p.workspace_id=$1 and p.id=any($2::uuid[])`,
                [f.workspaceId, Object.values(ids)],
              )
            ).rows.map((r) => [r.person_key, r]),
          );
        const extraCertificate = (personId, certificate) =>
          f.sql(
            `insert into public.certificates(workspace_id,person_id,season,certificate,status,confirmed_at,confirmed_by_person_id)
              select $1::uuid,$2::uuid,w.current_season,$3,'confirmed',now(),$2::uuid
                from public.workspaces w where w.id=$1::uuid
              on conflict (workspace_id,person_id,season,certificate) do nothing`,
            [f.workspaceId, personId, certificate],
          );
        try {
          // Site Coordinator: an extra certificate and an extra role it backs
          // (already cleared, so nothing needs saving). Its SC is not extra:
          // as a site coordinator it needs SC to be cleared (add-season-settings,
          // D6), so the extra one is Basic. Reviewer: an extra certificate.
          // Intaker: no role yet and an extra certificate, so the save does
          // run and must add to what it has.
          await extraCertificate(ids.site_coordinator, "basic");
          await f.sql(
            `update public.roster_entries e set roles=array['admin','intaker']
               from public.workspaces w
              where w.id=e.workspace_id and e.season=w.current_season
                and e.workspace_id=$1 and e.person_id=$2`,
            [f.workspaceId, ids.site_coordinator],
          );
          await extraCertificate(ids.reviewer, "basic");
          await extraCertificate(ids.intaker, "sc");
          await f.sql(
            `update public.roster_entries e set roles='{}'
               from public.workspaces w
              where w.id=e.workspace_id and e.season=w.current_season
                and e.workspace_id=$1 and e.person_id=$2`,
            [f.workspaceId, ids.intaker],
          );
          const args = {
            workspaceId: f.workspaceId,
            clientAEmail: f.applicantAEmail,
            runDir,
          };
          await seedWorkspace(args);
          const first = await state();
          const has = (row, list) => list.every((x) => row.certificates.includes(x));
          assert.deepEqual(first.site_coordinator.roles, ["admin", "intaker"]);
          assert.ok(has(first.site_coordinator, ["vsc", "itqr", "sc", "basic"]));
          assert.deepEqual(first.reviewer.roles, ["reviewer"]);
          assert.ok(has(first.reviewer, ["vsc", "itqr", "advanced", "basic"]));
          assert.deepEqual(first.intaker.roles, ["intaker"]);
          assert.ok(has(first.intaker, ["vsc", "itqr", "sc"]));
          for (const row of Object.values(first)) {
            assert.equal(row.cleared, true, row.person_key);
            assert.equal(row.is_new, false, row.person_key);
          }
          await seedWorkspace(args);
          const second = await state();
          for (const key of Object.keys(first))
            assert.equal(second[key].revision, first[key].revision, key);
        } finally {
          await rm(runDir, { recursive: true, force: true });
          for (const [key, personId] of Object.entries(ids)) {
            const { rows } = await f.sql(
              "select capabilities from public.people where id=$1",
              [personId],
            );
            await f.clearStaff(personId, rows[0].capabilities);
            await f.sql(
              `delete from public.certificates where workspace_id=$1 and person_id=$2
                and certificate = any($3::text[])`,
              [f.workspaceId, personId, key === "intaker" ? ["sc"] : ["basic"]],
            );
          }
        }
      },
    );

    await t.test("the receipts name the acting people", async () => {
      const runDir = await tempRunDir();
      try {
        const { caseIdsByScenario } = await seedCases(client, await targetsFor(), {
          runDir,
        });
        const actors = (
          await f.sql(
            "select distinct actor_person_id from public.action_receipts where target_id=$1",
            [caseIdsByScenario.review_approved],
          )
        ).rows.map((r) => r.actor_person_id);
        for (const personId of [f.siteCoordinatorId, f.preparerId, f.reviewerId])
          assert.ok(actors.includes(personId));
      } finally {
        await rm(runDir, { recursive: true, force: true });
      }
    });

    await t.test(
      "each screened case records the checks its stored service calls for",
      async () => {
        const runDir = await tempRunDir();
        try {
          const { caseIdsByScenario } = await seedCases(
            client,
            await targetsFor(),
            { runDir },
          );
          // The service is read from the stored answers, not from the seed's values.
          const screened = (
            await f.sql(
              "select e.case_id, e.detail, c.answers->>'service' as service from public.case_events e join public.cases c on c.id=e.case_id where e.action='VERIFY_INTAKE' and e.case_id = any($1::uuid[])",
              [Object.values(caseIdsByScenario)],
            )
          ).rows;
          assert.ok(screened.length > 0);
          for (const { case_id, detail, service } of screened)
            assert.deepEqual(
              detail.checks,
              {
                phone: true,
                documents: true,
                in_scope: true,
                ...(service === "online" ? { identity: true } : {}),
              },
              case_id,
            );
        } finally {
          await rm(runDir, { recursive: true, force: true });
        }
      },
    );

    await t.test(
      "a second run replaces the first and leaves other cases alone",
      async () => {
        const runDir = await tempRunDir();
        try {
          const appCases = [await f.readyCase(), await f.assistedCase()];
          const others = (
            await f.sql(
              "select id, revision from public.cases where id = any($1::uuid[]) order by id",
              [appCases],
            )
          ).rows;
          assert.equal(others.length, 2);
          const first = await seedCases(client, await targetsFor(), { runDir });
          const firstIds = Object.values(first.caseIdsByScenario);
          const second = await seedCases(client, await targetsFor(), { runDir });
          assert.equal(second.casesRemoved, 11);
          assert.deepEqual(await caseRows(firstIds), []);
          assert.equal(
            (
              await f.sql("select id from public.assistance_items where id=$1", [
                first.assistanceId,
              ])
            ).rows.length,
            0,
          );
          const run = await readRunFile(f.workspaceId, runDir);
          assert.deepEqual(
            [...run.caseIds].sort(),
            Object.values(second.caseIdsByScenario).sort(),
          );
          assert.deepEqual(run.assistanceIds, [second.assistanceId]);
          const after = (
            await f.sql(
              "select id, revision from public.cases where id = any($1::uuid[]) order by id",
              [others.map((row) => row.id)],
            )
          ).rows;
          assert.deepEqual(after, others);
        } finally {
          await rm(runDir, { recursive: true, force: true });
        }
      },
    );

    await t.test("receipts outlive the cases a re-run deletes", async () => {
      const runDir = await tempRunDir();
      try {
        const first = await seedCases(client, await targetsFor(), { runDir });
        const firstIds = Object.values(first.caseIdsByScenario);
        const receiptsOf = async () =>
          (
            await f.sql(
              "select id, target_id from public.action_receipts where target_id = any($1::uuid[]) order by id",
              [firstIds],
            )
          ).rows;
        const before = await receiptsOf();
        // Every case the first run made has at least its create receipt.
        assert.deepEqual(
          [...new Set(before.map((row) => row.target_id))].sort(),
          [...firstIds].sort(),
        );
        await seedCases(client, await targetsFor(), { runDir });
        assert.deepEqual(await caseRows(firstIds), []);
        assert.deepEqual(await receiptsOf(), before);
      } finally {
        await rm(runDir, { recursive: true, force: true });
      }
    });

    await t.test("a partial earlier run is cleaned up", async () => {
      const runDir = await tempRunDir();
      try {
        const leftover = await f.readyCase();
        await recordRun(
          { workspaceId: f.workspaceId, caseIds: [leftover], assistanceIds: [] },
          runDir,
        );
        const result = await seedCases(client, await targetsFor(), { runDir });
        assert.equal(result.casesCreated, 11);
        assert.equal(result.casesRemoved, 1);
        assert.deepEqual(await caseRows([leftover]), []);
      } finally {
        await rm(runDir, { recursive: true, force: true });
      }
    });

    await t.test("the rehearsal cases carry the starter labels", async () => {
      const runDir = await tempRunDir();
      try {
        const { caseIdsByScenario } = await seedCases(client, await targetsFor(), {
          runDir,
        });
        const ids = Object.values(caseIdsByScenario);
        const links = (
          await f.sql(
            `select k.case_id, l.name, c.stage
               from public.case_label_links k
               join public.case_labels l on l.id = k.label_id
               join public.cases c on c.id = k.case_id
              where k.active and k.case_id = any($1::uuid[])`,
            [ids],
          )
        ).rows;
        for (const name of ["City Tax", "MFS", "Multi-state"])
          assert.ok(links.some((r) => r.name === name), name);
        const perCase = new Map();
        for (const r of links) perCase.set(r.case_id, (perCase.get(r.case_id) ?? 0) + 1);
        assert.ok([...perCase.values()].some((n) => n === 2));
        assert.ok(links.every((r) => r.stage !== "closed"));
      } finally {
        await rm(runDir, { recursive: true, force: true });
      }
    });

    await t.test("a refused step names the scenario and keeps the run file", async () => {
      const runDir = await tempRunDir();
      try {
        const values = {
          ...SEED_VALUES,
          DOCUMENT_REQUEST: { title: "", message: "A fictional note." },
        };
        await assert.rejects(
          seedCases(client, await targetsFor(), { runDir, values }),
          (error) =>
            error.code === "SEED_STEP_FAILED" &&
            error.message.startsWith("waiting_documents: REQUEST_DOCUMENT"),
        );
        const run = await readRunFile(f.workspaceId, runDir);
        // client_received, preparation_ready and the waiting_documents case itself.
        assert.equal(run.caseIds.length, 3);
        assert.equal((await caseRows(run.caseIds)).length, 3);
      } finally {
        await rm(runDir, { recursive: true, force: true });
      }
    });
    // Spec local-seed-data, "The local seed adds a previous season's roster".
    await t.test("the previous season's roster is added, and replaced on a re-run", async () => {
      const past = SEED_VALUES.SEED_PAST_VOLUNTEERS.map((v) => v.email);
      const alsoCurrent = SEED_VALUES.SEED_PAST_ALSO_CURRENT_EMAIL;
      const seedClient = await openDatabase({ kind: "test" });
      const args = { workspaceId: f.workspaceId, actorPersonId: f.siteCoordinatorId };
      const rowsFor = async () =>
        (
          await f.sql(
            `select v.email, w.current_season,
                    array(select e.season::int from public.roster_entries e
                           where e.person_id=p.id order by e.season) as seasons,
                    (select count(*)::int from public.certificates c
                      where c.person_id=p.id and c.season=w.current_season-1) as certs
               from public.people p
               join public.volunteer_profiles v on v.person_id=p.id
               join public.workspaces w on w.id=p.workspace_id
              where p.workspace_id=$1 and v.email=any($2)`,
            [f.workspaceId, [...past, alsoCurrent]],
          )
        ).rows;
      const rosterCount = async () =>
        (
          await f.sql(
            `select count(*)::int n from public.roster_entries e
               join public.workspaces w on w.id=e.workspace_id
              where e.workspace_id=$1 and e.season=w.current_season`,
            [f.workspaceId],
          )
        ).rows[0].n;
      try {
        await seedVolunteers(seedClient, {
          workspaceId: f.workspaceId,
          actorUserId: f.siteCoordinatorUserId,
        });
        const before = await rosterCount();
        for (let run = 0; run < 2; run += 1) {
          assert.equal(await seedPastSeason(seedClient, args), 3);
          const rows = await rowsFor();
          const pastOnly = rows.filter((r) => past.includes(r.email));
          assert.equal(pastOnly.length, 3);
          for (const r of pastOnly) {
            assert.deepEqual(r.seasons, [r.current_season - 1]);
            assert.ok(r.certs > 0);
          }
          const both = rows.find((r) => r.email === alsoCurrent);
          assert.deepEqual(both.seasons, [both.current_season - 1, both.current_season]);
          assert.equal(await rosterCount(), before);
        }
        // A picked person (added to the current season, no sign-in) is replaced.
        await f.sql(
          `insert into public.roster_entries(workspace_id,person_id,season,roles)
           select p.workspace_id,p.id,w.current_season,'{}'
             from public.people p join public.volunteer_profiles v on v.person_id=p.id
             join public.workspaces w on w.id=p.workspace_id
            where p.workspace_id=$1 and v.email=$2`,
          [f.workspaceId, past[0]],
        );
        assert.equal(await rosterCount(), before + 1);
        assert.equal(await seedPastSeason(seedClient, args), 3);
        assert.equal(await rosterCount(), before);
        const rows = await rowsFor();
        assert.equal(rows.filter((r) => past.includes(r.email)).length, 3);
        assert.ok(rows.filter((r) => past.includes(r.email)).every((r) => r.seasons.length === 1));
      } finally {
        await seedClient.end();
      }
    });

    await t.test("the story's use of the seed module adds no previous-season people", async () => {
      const past = SEED_VALUES.SEED_PAST_VOLUNTEERS.map((v) => v.email);
      await f.sql(
        `delete from public.people p using public.volunteer_profiles v
          where v.person_id=p.id and p.workspace_id=$1 and p.user_id is null and v.email=any($2)`,
        [f.workspaceId, past],
      );
      const runDir = await tempRunDir();
      try {
        await seedCases(client, await targetsFor(), { runDir });
        const { rows } = await f.sql(
          `select count(*)::int n from public.volunteer_profiles
            where workspace_id=$1 and email=any($2)`,
          [f.workspaceId, past],
        );
        assert.equal(rows[0].n, 0);
      } finally {
        await rm(runDir, { recursive: true, force: true });
      }
    });

    await t.test("a seed re-run keeps a seed volunteer who got an account", async () => {
      const emails = SEED_VALUES.SEED_VOLUNTEERS.map((v) => v.email);
      const args = { workspaceId: f.workspaceId, actorUserId: f.siteCoordinatorUserId };
      const seedClient = await openDatabase({ kind: "test" });
      try {
        await seedVolunteers(seedClient, args);
        // What Create account does to the person: give them a sign-in.
        const account = await f.provision();
        // One statement, so the staff membership and the link exist together at commit.
        const linked = await f.sql(
          `with m as (
             insert into public.memberships(workspace_id,user_id,access)
             values($1,$3,'staff') returning user_id
           )
           update public.people p set user_id=(select user_id from m)
             from public.volunteer_profiles v
            where v.person_id=p.id and v.workspace_id=p.workspace_id
              and p.workspace_id=$1 and v.email=$2 returning p.id`,
          [f.workspaceId, emails[0], account.userId],
        );
        assert.equal(linked.rows.length, 1);
        assert.equal(await seedVolunteers(seedClient, args), 8);
      } finally {
        await seedClient.end();
      }
      const rows = (
        await f.sql(
          `select v.email, count(*)::int n, max(p.user_id::text) as user_id
             from public.people p join public.volunteer_profiles v on v.person_id=p.id
            where p.workspace_id=$1 and v.email=any($2) group by v.email`,
          [f.workspaceId, emails],
        )
      ).rows;
      assert.equal(rows.length, 8);
      assert.ok(rows.every((r) => r.n === 1));
      assert.ok(rows.find((r) => r.email === emails[0]).user_id);
    });

    // Change add-volunteer-schedule (spec local-seed-data, "The local seed
    // fills a week of the schedule"). Every test puts the schedule back.
    const resetSchedule = async () => {
      await f.sql("delete from public.check_ins where workspace_id=$1", [f.workspaceId]);
      await f.sql("delete from public.shifts where workspace_id=$1", [f.workspaceId]);
      await f.sql("delete from public.schedule_settings where workspace_id=$1", [f.workspaceId]);
    };
    const liveShifts = async () =>
      (
        await f.sql(
          `select s.id, s.revision, s.shift_date::text as date, s.start_hour, s.end_hour, s.role,
                  p.user_id is null as no_sign_in
             from public.shifts s join public.people p on p.id=s.person_id
            where s.workspace_id=$1 and s.removed_at is null order by s.shift_date, s.start_hour, s.id`,
          [f.workspaceId],
        )
      ).rows;
    const isoDay = (date) => new Date(`${date}T12:00:00Z`).getUTCDay() || 7;

    await t.test("seeds site hours, usual days and a week of shifts, and a re-run keeps an admin's shift", async () => {
      const runDir = await tempRunDir();
      const args = { workspaceId: f.workspaceId, clientAEmail: f.applicantAEmail, runDir };
      const today = (await f.sql("select (now() at time zone 'America/New_York')::date::text as d")).rows[0].d;
      const { monday, sunday } = weekBounds(today);
      const saturday = addDays(monday, 5);
      try {
        await resetSchedule();
        await seedWorkspace(args);
        const settings = (
          await f.sql("select site_hours, preparers_needed, reviewers_needed, on_site_needed from public.schedule_settings where workspace_id=$1", [f.workspaceId])
        ).rows[0];
        assert.deepEqual(settings.site_hours, {
          2: { open: 17, close: 20 },
          4: { open: 17, close: 20 },
          6: { open: 10, close: 16 },
        });
        assert.deepEqual([settings.preparers_needed, settings.reviewers_needed, settings.on_site_needed], [2, 1, 1]);

        const days = (
          await f.sql(
            "select v.usual_days from public.volunteer_profiles v where v.workspace_id=$1 and v.email=any($2)",
            [f.workspaceId, SEED_VALUES.SEED_VOLUNTEERS.map((v) => v.email)],
          )
        ).rows.map((r) => r.usual_days);
        assert.ok(days.filter((d) => d.length > 0).length >= 4, "four volunteers have usual days");
        assert.ok(days.filter((d) => d.includes("sat")).length >= 2, "two usually come on Saturdays");

        const first = await liveShifts();
        // About six this week, plus at most three the check-ins follow on past days.
        assert.ok(first.length >= 5 && first.length <= 11, `about six shifts, got ${first.length}`);
        for (const shift of first) {
          assert.ok(
            (shift.date >= monday && shift.date <= sunday) || shift.date < today,
            `${shift.date} is outside this week and not a past day`,
          );
          const hours = settings.site_hours[isoDay(shift.date)];
          assert.ok(hours && shift.start_hour >= hours.open && shift.end_hour <= hours.close, "inside site hours");
        }
        assert.ok(first.some((s) => s.no_sign_in), "one shift is a volunteer with no sign-in");
        assert.ok(first.some((s) => !s.no_sign_in), "role accounts have shifts");
        const run = await readRunFile(f.workspaceId, runDir);
        assert.deepEqual(run.shifts.map((s) => s.id).sort(), first.map((s) => s.id).sort());
        assert.ok(run.shifts.every((s) => Number.isInteger(s.revision)));

        // This week's Saturday, read by the site coordinator, has a gap.
        const { data: day, error } = await f.siteCoordinator.rpc("vitally_schedule_day", { p_date: saturday });
        assert.equal(error, null);
        assert.ok(day.shifts.length > 0);
        const rows = coverageRows({ hours: day.hours, targets: day.targets, shifts: day.shifts });
        assert.ok(rows.some((r) => r.text !== "OK"), "a Saturday hour has a gap");

        // An admin adds a shift of their own; a re-run keeps it and one seeded set.
        const maya = (await f.sql("select person_id from public.volunteer_profiles where workspace_id=$1 and email=$2", [f.workspaceId, SEED_VALUES.SEED_VOLUNTEERS[0].email])).rows[0].person_id;
        const { data: own, error: ownError } = await f.siteCoordinator.rpc("vitally_save_shift", {
          p_action_id: randomUUID(),
          p_shift_id: null,
          p_expected_revision: null,
          p_shift: { volunteerId: maya, date: saturday, startHour: 15, endHour: 16, role: "preparer" },
        });
        assert.equal(ownError, null);
        await seedWorkspace(args);
        const second = await liveShifts();
        assert.equal(second.length, first.length + 1);
        assert.ok(second.some((s) => s.id === own.shiftId), "the admin's shift is kept");
        assert.ok(first.every((s) => !second.some((x) => x.id === s.id)), "the first seeded set is gone");
        const run2 = await readRunFile(f.workspaceId, runDir);
        assert.equal(run2.shifts.length, first.length);
        assert.ok(run2.shifts.every((s) => second.some((x) => x.id === s.id)));
      } finally {
        await deletePreviousRun(client, await readRun(f.workspaceId, runDir));
        await resetSchedule();
        await rm(runDir, { recursive: true, force: true });
      }
    });

    await t.test("a re-run keeps a seed volunteer an admin gave a shift, and soft-removes the seeded shifts", async () => {
      const runDir = await tempRunDir();
      const args = { workspaceId: f.workspaceId, clientAEmail: f.applicantAEmail, runDir };
      const emails = SEED_VALUES.SEED_VOLUNTEERS.map((v) => v.email);
      const today = (await f.sql("select (now() at time zone 'America/New_York')::date::text as d")).rows[0].d;
      const saturday = addDays(weekBounds(today).monday, 5);
      try {
        await resetSchedule();
        await seedWorkspace(args);
        const first = await liveShifts();
        assert.ok(first.length > 0);
        // A seed volunteer with no sign-in and no seeded shift, so the admin's shift cannot overlap.
        const candidates = (
          await f.sql(
            `select p.id, v.email, e.roles[1] as role from public.people p
               join public.workspaces w on w.id=p.workspace_id
               join public.volunteer_profiles v on v.person_id=p.id and v.workspace_id=p.workspace_id
               join public.roster_entries e on e.person_id=p.id and e.workspace_id=p.workspace_id and e.season=w.current_season
              where p.workspace_id=$1 and p.user_id is null and v.email=any($2)
                and e.roles[1] is not null
                and exists (select 1 from public.certificates c
                             where c.person_id=p.id and c.workspace_id=p.workspace_id
                               and c.season=w.current_season and c.status='confirmed')
                and not exists (select 1 from public.shifts s where s.person_id=p.id and s.removed_at is null)
              order by v.email`,
            [f.workspaceId, emails],
          )
        ).rows;
        assert.ok(candidates.length > 0, "a seed volunteer without a shift");
        const volunteer = candidates[0];
        const { data: own, error } = await f.siteCoordinator.rpc("vitally_save_shift", {
          p_action_id: randomUUID(),
          p_shift_id: null,
          p_expected_revision: null,
          p_shift: { volunteerId: volunteer.id, date: saturday, startHour: 15, endHour: 16, role: volunteer.role },
        });
        assert.equal(error, null);

        await seedWorkspace(args);

        const mine = (await f.sql("select id, removed_at from public.shifts where id=$1", [own.shiftId])).rows;
        assert.equal(mine.length, 1, "the admin's shift row is still there");
        assert.equal(mine[0].removed_at, null, "and still live");
        const person = (
          await f.sql(
            "select p.id from public.people p join public.volunteer_profiles v on v.person_id=p.id where p.workspace_id=$1 and v.email=$2",
            [f.workspaceId, volunteer.email],
          )
        ).rows;
        assert.deepEqual(person.map((r) => r.id), [volunteer.id], "the same person");
        const old = (
          await f.sql("select id, removed_at from public.shifts where id=any($1::uuid[])", [first.map((s) => s.id)])
        ).rows;
        // A re-created no-sign-in volunteer takes their (already soft-removed)
        // shift rows with them; a role account's shifts stay as removed rows.
        const roleAccountShifts = first.filter((s) => !s.no_sign_in);
        assert.ok(roleAccountShifts.length > 0);
        const kept = old.filter((r) => roleAccountShifts.some((s) => s.id === r.id));
        assert.equal(kept.length, roleAccountShifts.length, "the role accounts' shifts are still rows");
        assert.ok(old.every((r) => r.removed_at), "and every shift still there is soft-removed");
        const count = (
          await f.sql(
            `select count(distinct v.email)::int n from public.people p
               join public.volunteer_profiles v on v.person_id=p.id and v.workspace_id=p.workspace_id
              where p.workspace_id=$1 and v.email=any($2)`,
            [f.workspaceId, emails],
          )
        ).rows[0].n;
        assert.equal(count, 8);
      } finally {
        await deletePreviousRun(client, await readRun(f.workspaceId, runDir));
        await resetSchedule();
        await rm(runDir, { recursive: true, force: true });
      }
    });

    // Change add-volunteer-schedule (spec local-seed-data, "A picked person with a shift is kept").
    await t.test("a re-run keeps a previous-season person an admin added and gave a shift", async () => {
      const runDir = await tempRunDir();
      const args = { workspaceId: f.workspaceId, clientAEmail: f.applicantAEmail, runDir };
      const past = SEED_VALUES.SEED_PAST_VOLUNTEERS;
      const today = (await f.sql("select (now() at time zone 'America/New_York')::date::text as d")).rows[0].d;
      const saturday = addDays(weekBounds(today).monday, 5);
      const personRows = async (email) =>
        (
          await f.sql(
            `select p.id, array(select e.season::int from public.roster_entries e
                                 where e.person_id=p.id order by e.season) as seasons
               from public.people p join public.volunteer_profiles v on v.person_id=p.id
              where p.workspace_id=$1 and v.email=$2`,
            [f.workspaceId, email],
          )
        ).rows;
      try {
        await resetSchedule();
        await seedWorkspace(args);
        const picked = past[0];
        const [before] = await personRows(picked.email);
        const others = [];
        for (const v of past.slice(1)) others.push((await personRows(v.email))[0].id);
        // The admin adds the picked person to the current season and confirms the role's certificates.
        await f.sql(
          `insert into public.roster_entries(workspace_id,person_id,season,roles)
           select p.workspace_id,p.id,w.current_season,'{}'
             from public.people p join public.workspaces w on w.id=p.workspace_id
            where p.id=$1 and p.workspace_id=$2`,
          [before.id, f.workspaceId],
        );
        for (const certificate of picked.certificates)
          await f.sql(
            `insert into public.certificates(workspace_id,person_id,season,certificate,status,confirmed_at,confirmed_by_person_id)
             select $1,$2,w.current_season,$3,'confirmed',now(),$4 from public.workspaces w where w.id=$1
             on conflict do nothing`,
            [f.workspaceId, before.id, certificate, f.siteCoordinatorId],
          );
        await f.sql(
          `update public.roster_entries e set roles=$3::text[]
             from public.workspaces w
            where e.workspace_id=w.id and w.id=$1 and e.person_id=$2 and e.season=w.current_season`,
          [f.workspaceId, before.id, picked.roles],
        );
        const { data: own, error } = await f.siteCoordinator.rpc("vitally_save_shift", {
          p_action_id: randomUUID(),
          p_shift_id: null,
          p_expected_revision: null,
          p_shift: { volunteerId: before.id, date: saturday, startHour: 11, endHour: 12, role: picked.roles[0] },
        });
        assert.equal(error, null);

        await seedWorkspace(args);

        const after = await personRows(picked.email);
        assert.equal(after.length, 1);
        assert.equal(after[0].id, before.id, "the same person");
        assert.equal(after[0].seasons.length, 2, "both roster entries are still there");
        const mine = (await f.sql("select removed_at from public.shifts where id=$1", [own.shiftId])).rows;
        assert.equal(mine.length, 1, "the admin's shift row is still there");
        assert.equal(mine[0].removed_at, null, "and still live");
        for (const [i, v] of past.slice(1).entries()) {
          const rows = await personRows(v.email);
          assert.equal(rows.length, 1);
          assert.notEqual(rows[0].id, others[i], "the other previous-season people are re-seeded");
          assert.equal(rows[0].seasons.length, 1);
        }
      } finally {
        await deletePreviousRun(client, await readRun(f.workspaceId, runDir));
        await resetSchedule();
        await rm(runDir, { recursive: true, force: true });
      }
    });

    await t.test("a plain re-run leaves one seeded set and the same eight volunteers", async () => {
      const runDir = await tempRunDir();
      const args = { workspaceId: f.workspaceId, clientAEmail: f.applicantAEmail, runDir };
      const emails = SEED_VALUES.SEED_VOLUNTEERS.map((v) => v.email);
      try {
        await resetSchedule();
        await seedWorkspace(args);
        const first = await liveShifts();
        await seedWorkspace(args);
        const second = await liveShifts();
        assert.equal(second.length, first.length);
        assert.ok(first.every((s) => !second.some((x) => x.id === s.id)));
        const run = await readRunFile(f.workspaceId, runDir);
        assert.deepEqual(run.shifts.map((s) => s.id).sort(), second.map((s) => s.id).sort());
        const volunteers = (
          await f.sql(
            `select count(distinct p.id)::int n from public.people p
               join public.volunteer_profiles v on v.person_id=p.id and v.workspace_id=p.workspace_id
              where p.workspace_id=$1 and v.email=any($2)`,
            [f.workspaceId, emails],
          )
        ).rows[0].n;
        assert.equal(volunteers, 8);
      } finally {
        await deletePreviousRun(client, await readRun(f.workspaceId, runDir));
        await resetSchedule();
        await rm(runDir, { recursive: true, force: true });
      }
    });

    await t.test("saved site hours are kept and the seeded shifts fit inside them", async () => {
      const runDir = await tempRunDir();
      const args = { workspaceId: f.workspaceId, clientAEmail: f.applicantAEmail, runDir };
      try {
        await resetSchedule();
        await f.sql(
          "insert into public.schedule_settings(workspace_id,site_hours) values($1,$2)",
          [f.workspaceId, JSON.stringify({ 6: { open: 9, close: 13 } })],
        );
        await seedWorkspace(args);
        const settings = (await f.sql("select site_hours, revision from public.schedule_settings where workspace_id=$1", [f.workspaceId])).rows[0];
        assert.deepEqual(settings.site_hours, { 6: { open: 9, close: 13 } });
        assert.equal(Number(settings.revision), 1);
        const shifts = await liveShifts();
        assert.ok(shifts.length > 0, "shifts are placed on the open day");
        for (const s of shifts) {
          assert.equal(isoDay(s.date), 6);
          assert.ok(s.start_hour >= 9 && s.end_hour <= 13);
        }
      } finally {
        await deletePreviousRun(client, await readRun(f.workspaceId, runDir));
        await resetSchedule();
        await rm(runDir, { recursive: true, force: true });
      }
    });

    await t.test("the story's seedCases adds no site hours, usual days or shifts", async () => {
      const runDir = await tempRunDir();
      try {
        await resetSchedule();
        await seedCases(client, await targetsFor(), { runDir });
        assert.equal((await f.sql("select count(*)::int n from public.schedule_settings where workspace_id=$1", [f.workspaceId])).rows[0].n, 0);
        assert.equal((await liveShifts()).length, 0);
        assert.equal((await readRunFile(f.workspaceId, runDir)).shifts, undefined);
      } finally {
        await deletePreviousRun(client, await readRun(f.workspaceId, runDir));
        await rm(runDir, { recursive: true, force: true });
      }
    });

    const liveCheckIns = async () =>
      (
        await f.sql(
          `select c.id, c.check_in_date::text as date, c.checked_out_at, c.corrected_by_person_id,
                  p.person_key, p.user_id is not null as signed_in,
                  exists (select 1 from public.shifts s
                           where s.workspace_id=c.workspace_id and s.person_id=c.person_id
                             and s.shift_date=c.check_in_date and s.removed_at is null) as has_shift
             from public.check_ins c join public.people p on p.id=c.person_id
            where c.workspace_id=$1 and c.removed_at is null order by c.check_in_date, c.checked_in_at, c.id`,
          [f.workspaceId],
        )
      ).rows;

    // Each runs the seed as if "today" were that New York date (all past, so
    // no time is ever in the future): a Monday, a Saturday and a Sunday, and
    // the real today.
    const realToday = async () =>
      (await f.sql("select (now() at time zone 'America/New_York')::date::text as d")).rows[0].d;
    for (const label of ["Monday 2026-11-16", "Saturday 2026-11-21", "Sunday 2026-11-22", "today"]) {
      await t.test(`seed: adds check-ins on recent open days (${label})`, async () => {
        const runDir = await tempRunDir();
        const today = label === "today" ? await realToday() : label.split(" ")[1];
        const args = { workspaceId: f.workspaceId, clientAEmail: f.applicantAEmail, runDir, today };
        try {
          await resetSchedule();
          await seedWorkspace(args);
          const rows = await liveCheckIns();
          assert.ok(rows.length >= 3, "at least three check-ins");
          assert.ok(rows.every((r) => r.date < today), "all dated before today");
          assert.ok(rows.every((r) => r.corrected_by_person_id), "all set by the admin");
          assert.ok(rows.some((r) => r.checked_out_at === null), "one has no check-out");
          assert.ok(
            rows.filter((r) => r.has_shift).length >= 3,
            "at least three sit on their volunteer's own live shift",
          );
          const reviewer = rows.filter((r) => r.person_key === "reviewer");
          assert.equal(reviewer.length, 1, "one for the reviewer account");
          assert.equal(reviewer[0].has_shift, false, "with no shift that day");
          const run = await readRunFile(f.workspaceId, runDir);
          assert.deepEqual(run.checkInIds.sort(), rows.map((r) => r.id).sort());
          // Every live shift the seed added is recorded, so a re-run removes it.
          const shifts = await liveShifts();
          assert.deepEqual(run.shifts.map((x) => x.id).sort(), shifts.map((x) => x.id).sort());
          await seedWorkspace(args);
          assert.equal((await liveCheckIns()).length, rows.length, "a re-run leaves one set");
          assert.equal((await liveShifts()).length, shifts.length);
        } finally {
          await deletePreviousRun(client, await readRun(f.workspaceId, runDir));
          await resetSchedule();
          await rm(runDir, { recursive: true, force: true });
        }
      });
    }

    await t.test("seed: re-run replaces only its own check-ins", async () => {
      const runDir = await tempRunDir();
      const args = { workspaceId: f.workspaceId, clientAEmail: f.applicantAEmail, runDir };
      try {
        await resetSchedule();
        await seedWorkspace(args);
        const first = await liveCheckIns();
        const intaker = (
          await f.sql("select id from public.people where workspace_id=$1 and person_key='intaker'", [f.workspaceId])
        ).rows[0].id;
        const yesterday = (await f.sql("select ((now() at time zone 'America/New_York')::date-1)::text as d")).rows[0].d;
        const { data: own, error } = await f.siteCoordinator.rpc("vitally_save_check_in", {
          p_action_id: randomUUID(),
          p_check_in_id: null,
          p_expected_revision: null,
          p_check_in: { volunteerId: intaker, date: yesterday, checkedIn: "06:00", checkedOut: "06:30" },
        });
        assert.equal(error, null);

        await seedWorkspace(args);

        const after = await liveCheckIns();
        assert.ok(after.some((r) => r.id === own.checkInId), "the admin's check-in is still live");
        assert.equal(after.length, first.length + 1, "one seeded set plus the admin's");
        assert.ok(first.every((r) => !after.some((x) => x.id === r.id)), "the earlier seeded ones are replaced");
      } finally {
        await deletePreviousRun(client, await readRun(f.workspaceId, runDir));
        await resetSchedule();
        await rm(runDir, { recursive: true, force: true });
      }
    });

    await t.test("seed: the story's seed adds no check-ins", async () => {
      const runDir = await tempRunDir();
      try {
        await resetSchedule();
        await seedCases(client, await targetsFor(), { runDir });
        assert.equal((await f.sql("select count(*)::int n from public.check_ins where workspace_id=$1", [f.workspaceId])).rows[0].n, 0);
        assert.equal((await readRunFile(f.workspaceId, runDir)).checkInIds, undefined);
      } finally {
        await deletePreviousRun(client, await readRun(f.workspaceId, runDir));
        await rm(runDir, { recursive: true, force: true });
      }
    });

  } finally {
    await client.end();
    await f.close();
  }
});
