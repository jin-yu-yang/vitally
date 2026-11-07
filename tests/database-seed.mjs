import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createDatabaseFixture } from "./support/database-fixture.mjs";
import { openDatabase } from "../tools/admin/database.mjs";
import {
  applyAction,
  deletePreviousRun,
  readRun,
  recordRun,
  resolveSeedTargets,
  runFilePath,
  SEED_SCENARIOS,
  seedCases,
  seedWorkspace,
} from "../tools/admin/seed-cases.mjs";
import * as SEED_VALUES from "../tools/admin/seed-values.mjs";

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
        presenterUserIds: [],
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
          [f.workspaceId, f.sam],
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
  } finally {
    await client.end();
    await f.close();
  }
});
