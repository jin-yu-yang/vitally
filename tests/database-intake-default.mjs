import test from "node:test";
import assert from "node:assert/strict";
import { createDatabaseFixture } from "./support/database-fixture.mjs";
import { makeSampleAnswers } from "../src/sample-data.mjs";

// The column default the fixture's workspaces keep, the seed's version-2
// answers, and the switch-over that makes version 2 the default (migration
// 020, OpenSpec change make-intake-v2-default, spec client-intake).

const versionsOf = async (f) =>
  (
    await f.sql(
      "select id, default_intake_version from public.workspaces where id = any($1::uuid[]) order by id",
      [[f.workspaceId, f.foreignWorkspaceId]],
    )
  ).rows.map((row) => Number(row.default_intake_version));

const columnDefault = async (f) =>
  String(
    (
      await f.sql(
        "select column_default from information_schema.columns where table_schema='public' and table_name='workspaces' and column_name='default_intake_version'",
      )
    ).rows[0].column_default,
  ).trim();

const versionOfCase = async (f, caseId) =>
  Number((await f.sql("select intake_version from public.cases where id=$1", [caseId])).rows[0].intake_version);

test("the column default", async (t) => {
  await t.test("the column default is 2, and a workspace that keeps it is version 2", async () => {
    const f = await createDatabaseFixture();
    try {
      assert.equal(await columnDefault(f), "2");
      assert.deepEqual(await versionsOf(f), [2, 2]);
    } finally {
      await f.close();
    }
  });
});

test("the switch-over (020): new applications are version 2", async (t) => {
  await t.test("a client's new application is version 2", async () => {
    const f = await createDatabaseFixture();
    try {
      const { caseId } = await f.createCase(f.applicantA, crypto.randomUUID(), { answers: {} });
      assert.equal(await versionOfCase(f, caseId), 2);
    } finally {
      await f.close();
    }
  });

  await t.test("the office's new assisted application is version 2", async () => {
    const f = await createDatabaseFixture();
    try {
      const { caseId } = await f.createCase(f.siteCoordinator, crypto.randomUUID(), {
        mode: "assisted",
        answers: {},
      });
      assert.equal(await versionOfCase(f, caseId), 2);
    } finally {
      await f.close();
    }
  });
});

test("private functions, the seed's answers, and version-2 round trips", async (t) => {
  const f = await createDatabaseFixture();
  try {
    await t.test("the new private functions are not executable by clients", async () => {
      for (const signature of ["vitally_private.initialize_workspace(uuid,uuid[],uuid[])"])
        for (const role of ["anon", "authenticated"]) {
          const { rows } = await f.sql("select has_function_privilege($1, $2::regprocedure, 'execute') as ok", [
            role,
            signature,
          ]);
          assert.equal(rows[0].ok, false, `${role} on ${signature}`);
        }
    });

    await t.test("the seed's case answers pass the field checks", async () => {
      const runner = await f.seedRunner();
      try {
        const { caseIdsByScenario } = await runner.seed();
        const { rows } = await f.sql(
          "select id, intake_version, answers from public.cases where id = any($1::uuid[])",
          [Object.values(caseIdsByScenario)],
        );
        assert.equal(rows.length, 11);
        for (const row of rows) {
          assert.equal(row.intake_version, 2, row.id);
          const { rows: checks } = await f.sql(
            `select a.key, f.field_id is not null as known,
               coalesce(vitally_private.check_intake_value(f, a.value), false) as ok
             from jsonb_each($1::jsonb) a
             left join vitally_private.intake_fields f
               on f.version=2 and f.group_id is null and f.field_id=a.key`,
            [JSON.stringify(row.answers)],
          );
          assert.ok(checks.length > 0, `${row.id} has answers`);
          assert.equal(checks.length, Object.keys(row.answers).length);
          for (const check of checks) {
            assert.equal(check.known, true, `${check.key} is a field`);
            assert.equal(check.ok, true, `${check.key} passes`);
          }
        }
      } finally {
        await runner.close();
      }
    });

    await t.test("a client case round-trips on version 2", async () => {
      const full = makeSampleAnswers({ seed: 0 });
      const keys = Object.keys(full);
      const half = (from, to) => Object.fromEntries(keys.slice(from, to).map((key) => [key, full[key]]));
      const { caseId } = await f.createCase(f.applicantA, crypto.randomUUID(), { answers: {} });
      assert.equal(
        (await f.sql("select intake_version from public.cases where id=$1", [caseId])).rows[0].intake_version,
        2,
      );
      const middle = Math.floor(keys.length / 2);
      await f.act(f.applicantA, caseId, "SAVE_ANSWERS", { answers: half(0, middle) });
      await f.act(f.applicantA, caseId, "SAVE_ANSWERS", { answers: half(middle, keys.length) });
      await f.act(f.applicantA, caseId, "SUBMIT", { confirmed: true });
      const row = (await f.sql("select stage, client_number from public.cases where id=$1", [caseId])).rows[0];
      assert.equal(row.stage, "received");
      assert.ok(Number.isInteger(Number(row.client_number)) && Number(row.client_number) > 0);
    });

    await t.test("an office case round-trips on version 2", async () => {
      const { caseId } = await f.createCase(f.siteCoordinator, crypto.randomUUID(), {
        mode: "assisted",
        answers: {},
      });
      assert.equal(
        (await f.sql("select intake_version from public.cases where id=$1", [caseId])).rows[0].intake_version,
        2,
      );
      await f.act(f.siteCoordinator, caseId, "SAVE_ANSWERS", {
        answers: makeSampleAnswers({ seed: 0 }),
      });
      await f.act(f.siteCoordinator, caseId, "SUBMIT", { confirmed: true });
      const row = (await f.sql("select stage, client_number from public.cases where id=$1", [caseId])).rows[0];
      // The office has already screened a client it entered itself.
      assert.equal(row.stage, "screening");
      assert.ok(Number.isInteger(Number(row.client_number)) && Number(row.client_number) > 0);
    });
  } finally {
    await f.close();
  }
});
