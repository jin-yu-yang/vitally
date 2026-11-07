import test from "node:test";
import assert from "node:assert/strict";
import {
  createDatabaseFixture,
  applyArgs,
  rejected,
} from "./support/database-fixture.mjs";
import { makeSampleAnswers } from "../src/sample-data.mjs";

// Part 2 (docs/superpowers/specs/2026-09-29-client-numbers-design.md §6).
// Every subtest shares one workspace, so each one reads the counter first and
// compares against it rather than assuming an absolute number.

const numberOf = async (f, caseId) =>
  (
    await f.sql("select season,client_number from public.cases where id=$1", [
      caseId,
    ])
  ).rows[0];
const counter = async (f, season = 2025, workspaceId = f.workspaceId) =>
  (
    await f.sql(
      "select last_number from vitally_private.client_number_counters where workspace_id=$1 and season=$2",
      [workspaceId, season],
    )
  ).rows[0]?.last_number ?? 0;
const submittedCase = async (f, actor = f.applicantA) => {
  const created = await f.createCase(actor, crypto.randomUUID(), {
    answers: {},
  });
  await f.act(actor, created.caseId, "SAVE_ANSWERS", {
    answers: makeSampleAnswers(),
  });
  await f.act(actor, created.caseId, "SUBMIT", { confirmed: true });
  return created.caseId;
};
const revisionOf = async (f, caseId) =>
  Number(
    (await f.sql("select revision from public.cases where id=$1", [caseId]))
      .rows[0].revision,
  );

test("client numbers are assigned on submit, per season, and never reused", async (t) => {
  const f = await createDatabaseFixture();
  try {
    await t.test("submitting assigns the next number", async () => {
      const created = await f.createCase(f.applicantA, crypto.randomUUID(), {
        answers: {},
      });
      assert.deepEqual(await numberOf(f, created.caseId), {
        season: null,
        client_number: null,
      });
      const before = await counter(f);
      await f.act(f.applicantA, created.caseId, "SAVE_ANSWERS", {
        answers: makeSampleAnswers(),
      });
      await f.act(f.applicantA, created.caseId, "SUBMIT", {
        confirmed: true,
      });
      assert.deepEqual(await numberOf(f, created.caseId), {
        season: 2025,
        client_number: before + 1,
      });
      assert.equal(await counter(f), before + 1);
      const [event] = (
        await f.sql(
          "select detail from public.case_events where case_id=$1 and action='SUBMIT'",
          [created.caseId],
        )
      ).rows;
      // Version 2 has no screening, so the number is all the detail says.
      assert.deepEqual(event.detail, { clientNumber: before + 1 });
    });

    await t.test("an assisted submit takes the next number", async () => {
      const previous = await submittedCase(f);
      const created = await f.draftCase(f.siteCoordinator, { mode: "assisted" });
      await f.act(f.siteCoordinator, created.caseId, "SUBMIT", {
        confirmed: true,
      });
      const { client_number: previousNumber } = await numberOf(f, previous);
      assert.deepEqual(await numberOf(f, created.caseId), {
        season: 2025,
        client_number: previousNumber + 1,
      });
    });

    await t.test("a refused submit assigns nothing", async () => {
      const incomplete = await f.createCase(
        f.applicantA,
        crypto.randomUUID(),
        { answers: {} },
      );
      const before = await counter(f);
      await assert.rejects(
        f.act(f.applicantA, incomplete.caseId, "SUBMIT", {
          confirmed: true,
        }),
        rejected("VALIDATION"),
      );
      assert.equal((await numberOf(f, incomplete.caseId)).client_number, null);
      assert.equal(await counter(f), before);

      // A complete draft sent at an old revision stops at the conflict check.
      const complete = await f.createCase(f.applicantA, crypto.randomUUID(), {
        answers: {},
      });
      await f.act(f.applicantA, complete.caseId, "SAVE_ANSWERS", {
        answers: makeSampleAnswers(),
      });
      const stale = await f.applicantA.rpc(
        "vitally_apply_action",
        applyArgs({
          caseId: complete.caseId,
          revision: (await revisionOf(f, complete.caseId)) - 1,
          type: "SUBMIT",
          payload: { confirmed: true },
        }),
      );
      assert.equal(stale.error.code, "VT003");
      assert.equal((await numberOf(f, complete.caseId)).client_number, null);
      assert.equal(await counter(f), before);
    });

    await t.test(
      "closing an assisted draft without sending assigns nothing",
      async () => {
        const created = await f.draftCase(f.siteCoordinator, { mode: "assisted" });
        const before = await counter(f);
        await f.act(f.siteCoordinator, created.caseId, "CLOSE_CASE", {
          reason: "other",
          note: "The client decided to file elsewhere.",
          confirmed: true,
        });
        const [row] = (
          await f.sql(
            "select stage,season,client_number from public.cases where id=$1",
            [created.caseId],
          )
        ).rows;
        assert.deepEqual(row, {
          stage: "closed",
          season: null,
          client_number: null,
        });
        assert.equal(await counter(f), before);
      },
    );

    await t.test(
      "concurrent submits get distinct consecutive numbers",
      async () => {
        const drafts = [];
        for (const actor of [f.applicantA, f.applicantB]) {
          const created = await f.createCase(actor, crypto.randomUUID(), {
            answers: {},
          });
          await f.act(actor, created.caseId, "SAVE_ANSWERS", {
            answers: makeSampleAnswers(),
          });
          drafts.push([actor, created.caseId]);
        }
        const before = await counter(f);
        await Promise.all(
          drafts.map(([actor, caseId]) =>
            f.act(actor, caseId, "SUBMIT", { confirmed: true }),
          ),
        );
        const numbers = [];
        for (const [, caseId] of drafts)
          numbers.push((await numberOf(f, caseId)).client_number);
        assert.deepEqual(numbers.toSorted((a, b) => a - b), [
          before + 1,
          before + 2,
        ]);
        assert.equal(await counter(f), before + 2);
      },
    );

    await t.test("a seed re-run never reuses a number", async () => {
      const runner = await f.seedRunner();
      try {
        const numbersOf = async ({ caseIdsByScenario }) =>
          (
            await f.sql(
              "select client_number from public.cases where id = any($1::uuid[])",
              [Object.values(caseIdsByScenario)],
            )
          ).rows.map((row) => row.client_number);
        const first = await numbersOf(await runner.seed());
        const second = await numbersOf(await runner.seed());
        assert.equal(first.length, 11);
        assert.equal(second.length, 11);
        for (const number of [...first, ...second]) assert.notEqual(number, null);
        const firstMax = Math.max(...first);
        for (const number of second) assert.ok(number > firstMax);
        const classCase = await submittedCase(f);
        assert.ok((await numberOf(f, classCase)).client_number > Math.max(...second));
      } finally {
        await runner.close();
      }
    });

    await t.test("a season change restarts at 1", async () => {
      const old = await submittedCase(f);
      const oldNumber = await numberOf(f, old);
      try {
        await f.sql(
          "update public.workspaces set current_season=2026 where id=$1",
          [f.workspaceId],
        );
        const next = await submittedCase(f);
        assert.deepEqual(await numberOf(f, next), {
          season: 2026,
          client_number: 1,
        });
        assert.deepEqual(await numberOf(f, old), oldNumber);
        assert.equal(oldNumber.season, 2025);
      } finally {
        await f.sql(
          "update public.workspaces set current_season=2025 where id=$1",
          [f.workspaceId],
        );
      }
    });

    await t.test("numbers never change: an update is refused, even for the database owner", async () => {
      const caseId = await submittedCase(f);
      const set = await numberOf(f, caseId);
      await assert.rejects(
        f.sql(
          "update public.cases set client_number=client_number+100 where id=$1",
          [caseId],
        ),
        rejected("VALIDATION"),
      );
      await assert.rejects(
        f.sql(
          "update public.cases set client_number=null,season=null where id=$1",
          [caseId],
        ),
        rejected("VALIDATION"),
      );
      await assert.rejects(
        f.sql("update public.cases set season=2024 where id=$1", [caseId]),
        rejected("VALIDATION"),
      );
      assert.deepEqual(await numberOf(f, caseId), set);
    });

    await t.test("the counter is private", async () => {
      for (const role of ["anon", "authenticated", "service_role"]) {
        const [row] = (
          await f.sql(
            `select has_table_privilege($1,'vitally_private.client_number_counters','select') as can_select,
               has_table_privilege($1,'vitally_private.client_number_counters','update') as can_update,
               has_function_privilege($1,'vitally_private.next_client_number(uuid)','execute') as can_execute`,
            [role],
          )
        ).rows;
        assert.deepEqual(
          row,
          { can_select: false, can_update: false, can_execute: false },
          role,
        );
      }
    });

    await t.test("an applicant reads their own number", async () => {
      const caseId = await submittedCase(f);
      const { client_number } = await numberOf(f, caseId);
      const own = await f.applicantA
        .from("cases")
        .select("client_number")
        .eq("id", caseId);
      assert.equal(own.error, null);
      assert.deepEqual(own.data, [{ client_number }]);
      const other = await f.applicantB
        .from("cases")
        .select("client_number")
        .eq("id", caseId);
      assert.equal(other.error, null);
      assert.deepEqual(other.data, []);
    });
  } finally {
    await f.close();
  }
});
