import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabaseFixture } from "./support/database-fixture.mjs";
import { makeSampleAnswers } from "../src/sample-data.mjs";

// Migration 023 (OpenSpec change remove-intake-v1, spec client-intake): version 2
// is the only intake version. The guard's and the cleanup's predicates were
// dropped with the sample-case tools (migration 040, OpenSpec change
// remove-sample-case-tools).

// The SQLSTATE: application codes (VT007) arrive mapped to a domain code
// (VALIDATION) with the database's own error as the cause.
const rejects = (promise, code) =>
  assert.rejects(promise, (error) => (error.cause?.code ?? error.code) === code);

// A fresh case reference in the shape the schema checks.
const REFERENCE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const reference = () => {
  const pick = () =>
    Array.from({ length: 4 }, () => REFERENCE_CHARS[Math.floor(Math.random() * REFERENCE_CHARS.length)]).join("");
  return `VT-${pick()}-${pick()}`;
};

test("version 2 is the only accepted version", async (t) => {
  const f = await createDatabaseFixture();
  try {
    await t.test("neither version column keeps a default of 1", async () => {
      const { rows } = await f.sql(
        "select table_name, column_default from information_schema.columns where table_schema='public' and ((table_name='cases' and column_name='intake_version') or (table_name='workspaces' and column_name='default_intake_version')) order by 1",
      );
      assert.deepEqual(rows.map((r) => [r.table_name, String(r.column_default).trim()]), [["cases", "2"], ["workspaces", "2"]]);
    });
    await t.test("a workspace defaults to 2 and can't be set to 1", async () => {
      assert.equal(Number((await f.sql("select default_intake_version v from public.workspaces where id=$1", [f.workspaceId])).rows[0].v), 2);
      await rejects(f.sql("update public.workspaces set default_intake_version=1 where id=$1", [f.workspaceId]), "23514");
      assert.equal(Number((await f.sql("select default_intake_version v from public.workspaces where id=$1", [f.workspaceId])).rows[0].v), 2);
    });
    await t.test("a client's and the office's new applications are version 2", async () => {
      const own = await f.createCase(f.applicantA, randomUUID(), { answers: {} });
      const office = await f.createCase(f.siteCoordinator, randomUUID(), { mode: "assisted", answers: {} });
      for (const { caseId } of [own, office])
        assert.equal(Number((await f.sql("select intake_version v from public.cases where id=$1", [caseId])).rows[0].v), 2);
    });
    await t.test("a create that carries answers is refused", async () => {
      await rejects(f.createCase(f.applicantA, randomUUID(), { answers: { tp_first: "Mei" } }), "VT007");
    });
    await t.test("an application's version never changes", async () => {
      const { caseId } = await f.draftCase(f.applicantA);
      await f.act(f.applicantA, caseId, "SAVE_ANSWERS", { answers: makeSampleAnswers({ seed: 1 }) });
      assert.equal(Number((await f.sql("select intake_version v from public.cases where id=$1", [caseId])).rows[0].v), 2);
      // 011's cases_intake_version_fixed refuses the change before the CHECK is reached.
      await rejects(f.sql("update public.cases set intake_version=1 where id=$1", [caseId]), "VT007");
      assert.equal(Number((await f.sql("select intake_version v from public.cases where id=$1", [caseId])).rows[0].v), 2);
    });
    await t.test("a version-1 insert is stored as version 2", async () => {
      // An otherwise-valid client row that asks for version 1. 023's insert
      // trigger stamps the workspace's version over whatever the row asked for.
      const ref = reference();
      await f.sql(
        "insert into public.cases(reference,workspace_id,owner_user_id,origin,created_by_user_id,intake_version) values($1,$2,$3,'client',$3,1)",
        [ref, f.workspaceId, f.applicantAUserId],
      );
      try {
        const { rows } = await f.sql("select intake_version from public.cases where reference=$1", [ref]);
        assert.deepEqual(rows.map((row) => Number(row.intake_version)), [2]);
      } finally {
        await f.sql("delete from public.cases where reference=$1", [ref]);
      }
    });
    await t.test("every workspace is version 2", async () => {
      assert.equal(Number((await f.sql("select count(*) n from public.workspaces where default_intake_version <> 2")).rows[0].n), 0);
    });
    await t.test("the version-1-only functions are gone", async () => {
      for (const name of ["intake_answer_keys", "fixture_answers"])
        assert.equal(
          (await f.sql("select count(*) n from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='vitally_private' and p.proname=$1", [name])).rows[0].n,
          "0",
          name,
        );
    });
    await t.test("the seed's submitted client case has no screening detail in its submit history", async () => {
      const runner = await f.seedRunner();
      try {
        const { caseIdsByScenario } = await runner.seed();
        const caseId = caseIdsByScenario.client_received;
        const [row] = (await f.sql("select origin, intake_version from public.cases where id=$1", [caseId])).rows;
        assert.deepEqual({ origin: row.origin, version: Number(row.intake_version) }, { origin: "client", version: 2 });
        const { rows: events } = await f.sql(
          "select detail from public.case_events where case_id=$1 and action='SUBMIT'",
          [caseId],
        );
        assert.equal(events.length, 1);
        assert.equal(events[0].detail?.screening, undefined);
      } finally {
        await runner.close();
      }
    });
  } finally {
    await f.close();
  }
});
