import test from "node:test";
import assert from "node:assert/strict";
import { createDatabaseFixture } from "./support/database-fixture.mjs";
import { openDatabase } from "../tools/admin/database.mjs";
import { relabelSeason } from "../tools/admin/relabel-season.mjs";
import { makeSampleAnswers } from "../src/sample-data.mjs";

// tools/admin/relabel-season.mjs: renaming the current season moves the
// roster, certificates, cases and client-number counter to the new label and
// changes nobody's capabilities or clearance. A dry run writes nothing.

const submittedCase = async (f, actor = f.applicantA) => {
  const created = await f.createCase(actor, crypto.randomUUID(), { answers: {} });
  await f.act(actor, created.caseId, "SAVE_ANSWERS", { answers: makeSampleAnswers() });
  await f.act(actor, created.caseId, "SUBMIT", { confirmed: true });
  return created.caseId;
};

const snapshot = async (f) => {
  const one = async (text) => (await f.sql(text, [f.workspaceId])).rows;
  return {
    season: Number((await one("select current_season from public.workspaces where id=$1"))[0].current_season),
    roster: await one(
      "select person_id::text,season,roles,is_new,photo_id_checked_at from public.roster_entries where workspace_id=$1 order by person_id,season",
    ),
    certificates: await one(
      "select person_id::text,season,certificate,status from public.certificates where workspace_id=$1 order by person_id,certificate",
    ),
    cases: await one(
      "select id::text,season,client_number from public.cases where workspace_id=$1 and season is not null order by id",
    ),
    people: await one(
      "select id::text,capabilities,vitally_private.cleared(workspace_id,id) as cleared from public.people where workspace_id=$1 order by id",
    ),
  };
};
const atSeason = (rows, season) => rows.map((row) => ({ ...row, season }));
const refused = (pattern) => (error) => error.code === "RELABEL_REFUSED" && pattern.test(error.message);

test("relabel-season renames the current season against real Supabase", async (t) => {
  const f = await createDatabaseFixture();
  const client = await openDatabase({ kind: "test" });
  try {
    const caseId = await submittedCase(f);
    const before = await snapshot(f);
    const from = before.season;
    const to = from + 1;
    assert.ok(before.roster.length > 0 && before.certificates.length > 0 && before.cases.length > 0);

    await t.test("a dry run reports the counts and writes nothing", async () => {
      const result = await relabelSeason(client, { workspaceId: f.workspaceId, from, to });
      assert.equal(result.applied, false);
      assert.equal(result.rosterEntries, before.roster.length);
      assert.equal(result.certificates, before.certificates.length);
      assert.equal(result.cases, before.cases.length);
      assert.deepEqual(await snapshot(f), before);
    });

    await t.test("the wrong current season is refused", async () => {
      await assert.rejects(
        () => relabelSeason(client, { workspaceId: f.workspaceId, from: from - 1, to: from, apply: true }),
        refused(/current season is/),
      );
      assert.deepEqual(await snapshot(f), before);
    });

    await t.test("--apply moves everything and changes nobody's standing", async () => {
      const result = await relabelSeason(client, { workspaceId: f.workspaceId, from, to, apply: true });
      assert.equal(result.applied, true);
      const after = await snapshot(f);
      assert.equal(after.season, to);
      assert.deepEqual(after.roster, atSeason(before.roster, to));
      assert.deepEqual(after.certificates, atSeason(before.certificates, to));
      assert.deepEqual(after.cases, atSeason(before.cases, to));
      assert.deepEqual(after.people, before.people);
    });

    await t.test("cleared staff still read the case, and the next number follows on", async () => {
      const seen = await f.preparer.from("cases").select("id").eq("id", caseId);
      assert.equal(seen.error, null);
      assert.equal(seen.data.length, 1);
      const highest = Math.max(...before.cases.map((c) => c.client_number));
      const next = await submittedCase(f);
      const row = (await f.sql("select season,client_number from public.cases where id=$1", [next])).rows[0];
      assert.deepEqual(row, { season: to, client_number: highest + 1 });
    });

    await t.test("a season that already has rows is refused", async () => {
      await f.sql("update public.workspaces set current_season=$2 where id=$1", [f.workspaceId, from]);
      try {
        await assert.rejects(
          () => relabelSeason(client, { workspaceId: f.workspaceId, from, to, apply: true }),
          refused(/already has rows/),
        );
      } finally {
        await f.sql("update public.workspaces set current_season=$2 where id=$1", [f.workspaceId, to]);
      }
    });
  } finally {
    await client.end();
    await f.close();
  }
});
