import test from "node:test";
import assert from "node:assert/strict";
import { createDatabaseFixture, TEST_SITE_NUMBER } from "./support/database-fixture.mjs";

// OpenSpec change add-season-export (design D1-D4), migration 062: the export
// RPC (site coordinators only, current season only, one record per call), its
// private record table, and Last export in the Season settings read.
// Specs: season-export, season-settings.

const one = async (f, text, values) => (await f.sql(text, values)).rows[0];
const FORBIDDEN = "VT001";
const CASE_KEYS = [
  "id", "clientNumber", "reference", "origin", "stage", "closingReason", "submittedAt",
  "preparerName", "reviewerName", "intakeVersion", "answers",
];

test("Season export against real Supabase", async (t) => {
  const f = await createDatabaseFixture();
  try {
    const sc = f.siteCoordinator;
    const exportCount = async () =>
      Number((await one(f, "select count(*) from public.season_exports where workspace_id=$1", [f.workspaceId])).count);
    const exportRows = async () =>
      (
        await f.sql(
          "select season, row_counts, exported_at from public.season_exports where workspace_id=$1 order by exported_at, id",
          [f.workspaceId],
        )
      ).rows;
    const exportAnswer = async (client = sc) => {
      const { data, error } = await client.rpc("vitally_export_season");
      assert.equal(error, null, `${error?.code} ${error?.message}`);
      return data;
    };
    const nadia = await f.staff({
      key: "nadia_export",
      name: "Nadia Brennan",
      capabilities: ["admin", "assist", "followup", "receive_documents"],
    });
    const { current_season: season } = await one(
      f,
      "select current_season from public.workspaces where id=$1",
      [f.workspaceId],
    );
    const refused = async (client, label) => {
      const before = await exportCount();
      const { data, error } = await client.rpc("vitally_export_season");
      assert.equal(error?.code, FORBIDDEN, `${label}: ${error?.code} ${error?.message}`);
      assert.equal(error.message, "FORBIDDEN");
      assert.equal(data, null, `${label}: no data`);
      assert.equal(await exportCount(), before, `${label}: nothing recorded`);
    };

    try {
      await t.test("refusal: an admin who is not a site coordinator", async () => {
        await refused(nadia.client, "admin");
      });

      await t.test("refusal: a preparer and a client", async () => {
        await refused(f.preparer, "preparer");
        await refused(f.applicantA, "client");
      });

      // Two submitted cases, a draft, and a submitted case moved to last season.
      const first = (await f.submittedClientCase()).caseId;
      const second = (await f.submittedClientCase()).caseId;
      const { caseId: draft } = await f.draftCase(f.applicantA);
      // A case numbered in last season: submitted while the workspace is
      // there (a number never changes afterwards), then the season is restored.
      const setSeason = (value) =>
        f.sql("update public.workspaces set current_season=$1 where id=$2", [value, f.workspaceId]);
      await setSeason(season - 1);
      let past;
      try {
        past = (await f.submittedClientCase()).caseId;
      } finally {
        await setSeason(season);
      }
      const inOrder = (
        await f.sql(
          "select id from public.cases where workspace_id=$1 and id = any($2) order by client_number",
          [f.workspaceId, [first, second]],
        )
      ).rows.map((r) => r.id);

      await t.test("only the current season's submitted cases", async () => {
        const answer = await exportAnswer();
        assert.equal(answer.season, season);
        const ids = answer.cases.map((c) => c.id);
        assert.ok(inOrder.every((id) => ids.includes(id)));
        assert.ok(!ids.includes(draft) && !ids.includes(past));
        // The fixture workspace may hold other numbered cases: the two of
        // this test keep their client-number order among them.
        assert.deepEqual(ids.filter((id) => inOrder.includes(id)), inOrder);
        const numbers = answer.cases.map((c) => c.clientNumber);
        assert.deepEqual(numbers, [...numbers].sort((a, b) => a - b));
        for (const c of answer.cases) {
          assert.ok(c.submittedAt, "submitted time from the SUBMIT event");
          assert.equal(typeof c.answers, "object");
        }
        assert.ok(answer.events.every((e) => ids.includes(e.caseId)));
      });

      await t.test("help requests on season cases and with no case", async () => {
        const insert = async (caseId, title) =>
          one(
            f,
            `insert into public.assistance_items(workspace_id,case_id,title,status,revision,assignee_person_id,language,contact_preference)
             values($1,$2,$3,'open',1,null,'English','Phone') returning id`,
            [f.workspaceId, caseId, title],
          );
        await insert(first, "Fictional: help on a season case");
        await insert(null, "Fictional: help with no case");
        await insert(past, "Fictional: help on a past case");
        const answer = await exportAnswer();
        const titles = answer.helpRequests.map((h) => h.title).filter((x) => x.startsWith("Fictional: help"));
        assert.deepEqual(titles.sort(), ["Fictional: help on a season case", "Fictional: help with no case"]);
        assert.equal(answer.helpRequests.find((h) => h.title.endsWith("no case")).caseId, null);
        assert.equal(answer.helpRequests.find((h) => h.title.endsWith("season case")).caseId, first);
      });

      await t.test("one record per call, with counts", async () => {
        const before = await exportCount();
        await exportAnswer();
        const answer = await exportAnswer();
        assert.equal(await exportCount(), before + 2);
        const latest = (await exportRows()).at(-1);
        assert.equal(Number(latest.season), season);
        assert.deepEqual(latest.row_counts, {
          "cases.csv": answer.cases.length,
          "status-history.csv": answer.events.length,
          "messages.csv": answer.documentRequests.length + answer.clientEvents.length,
          "follow-ups.csv": answer.followups.length,
          "call-log.csv": answer.contactLog.length + answer.contactAttempts.length,
          "help-requests.csv": answer.helpRequests.length,
        });
      });

      await t.test("the answer names, never ids, for people", async () => {
        const answer = await exportAnswer();
        assert.equal(answer.exportedByName, "Avery Lin");
        assert.ok(!Number.isNaN(Date.parse(answer.exportedAt)));
        for (const c of answer.cases) assert.deepEqual(Object.keys(c).sort(), [...CASE_KEYS].sort());
        assert.ok(!JSON.stringify(answer).includes(TEST_SITE_NUMBER));
      });

      await t.test("lastExport is the latest of the current season", async () => {
        const read = async () => (await sc.rpc("vitally_season_settings")).data;
        const latest = (await exportRows()).at(-1);
        const { lastExport } = await read();
        assert.equal(lastExport.name, "Avery Lin");
        assert.equal(new Date(lastExport.exportedAt).getTime(), latest.exported_at.getTime());
        const seen = (await nadia.client.rpc("vitally_season_settings")).data;
        assert.deepEqual(seen.lastExport, lastExport, "a non-coordinator admin reads the same lastExport");
        await f.sql("update public.season_exports set season=season-1 where workspace_id=$1", [f.workspaceId]);
        assert.equal((await read()).lastExport, null);
      });

      await t.test("no direct access", async () => {
        const { data, error } = await sc.from("season_exports").select();
        assert.ok(error || (Array.isArray(data) && data.length === 0));
        const inserted = await sc.from("season_exports").insert({
          workspace_id: f.workspaceId,
          season,
          exported_by_person_id: f.siteCoordinatorId,
          row_counts: {},
        });
        assert.ok(inserted.error, "a direct insert is refused");
      });
    } finally {
      await f.sql("delete from public.season_exports where workspace_id=$1", [f.workspaceId]);
    }
  } finally {
    await f.close();
  }
});
