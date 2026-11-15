import test from "node:test";
import assert from "node:assert/strict";
import { createDatabaseFixture } from "./support/database-fixture.mjs";
// OpenSpec change add-case-labels (design D1, D2, D6): the two label tables,
// the starter labels, and who may read them.
const STARTERS = [
  { name: "City Tax", color: "sky" },
  { name: "MFS", color: "pink" },
  { name: "Multi-state", color: "amber" },
];
const labelsOf = async (f, workspaceId) =>
  (
    await f.sql(
      "select name,color from public.case_labels where workspace_id=$1 order by name",
      [workspaceId],
    )
  ).rows;
const insertLabel = (f, name, color, workspaceId = f.workspaceId) =>
  f.sql("insert into public.case_labels(workspace_id,name,color) values($1,$2,$3)", [
    workspaceId,
    name,
    color,
  ]);
const labelId = async (f, name, workspaceId = f.workspaceId) =>
  (
    await f.sql(
      "select id from public.case_labels where workspace_id=$1 and name=$2",
      [workspaceId, name],
    )
  ).rows[0].id;
const linkCase = async (f, caseId, name, personId, workspaceId = f.workspaceId) =>
  f.sql(
    "insert into public.case_label_links(workspace_id,case_id,label_id,active,changed_by_person_id) values($1,$2,$3,true,$4)",
    [workspaceId, caseId, await labelId(f, name, workspaceId), personId],
  );
const counts = async (f) =>
  (
    await f.sql(
      "select (select count(*) from public.case_labels) as labels, (select count(*) from public.case_label_links) as links",
    )
  ).rows[0];

test("case labels", async (t) => {
  const f = await createDatabaseFixture();
  try {
    await t.test("starter labels in a new workspace", async () => {
      assert.deepEqual(await labelsOf(f, f.workspaceId), STARTERS);
      assert.deepEqual(await labelsOf(f, f.foreignWorkspaceId), STARTERS);
    });

    await t.test("names are checked", async () => {
      for (const [name, color] of [
        [" Amended", "sky"],
        ["Amended ", "sky"],
        ["", "sky"],
        ["x".repeat(25), "sky"],
        ["city tax", "green"],
        ["Amended", "red"],
      ]) {
        await assert.rejects(insertLabel(f, name, color), undefined, `${name}/${color}`);
      }
      await insertLabel(f, "x".repeat(24), "slate");
      await insertLabel(f, "Amended", "sky");
      assert.equal((await labelsOf(f, f.workspaceId)).length, 5);
      // The same name in another workspace is allowed.
      await insertLabel(f, "Amended", "sky", f.foreignWorkspaceId);
    });

    await t.test("clients read no labels", async () => {
      const { caseId } = await f.submittedClientCase();
      await linkCase(f, caseId, "MFS", f.preparerId);
      for (const table of ["case_labels", "case_label_links"]) {
        const { data, error } = await f.applicantA.from(table).select();
        assert.equal(error, null);
        assert.deepEqual(data, [], table);
      }
    });

    await t.test("staff read their workspace only", async () => {
      const own = await f.submittedClientCase();
      await linkCase(f, own.caseId, "City Tax", f.preparerId);
      const foreignCase = await f.draftCase(f.outsider);
      await f.act(f.outsider, foreignCase.caseId, "SUBMIT", { confirmed: true });
      await linkCase(f, foreignCase.caseId, "MFS", f.foreignStaffId, f.foreignWorkspaceId);

      const labels = await f.preparer.from("case_labels").select("workspace_id,name");
      assert.equal(labels.error, null);
      assert.ok(labels.data.length >= 3);
      assert.ok(labels.data.every((row) => row.workspace_id === f.workspaceId));
      assert.deepEqual(
        labels.data.map((row) => row.name).filter((n) => STARTERS.some((s) => s.name === n)).sort(),
        ["City Tax", "MFS", "Multi-state"],
      );

      const links = await f.preparer.from("case_label_links").select("workspace_id,case_id");
      assert.equal(links.error, null);
      assert.ok(links.data.some((row) => row.case_id === own.caseId));
      assert.ok(links.data.every((row) => row.workspace_id === f.workspaceId));
      assert.ok(!links.data.some((row) => row.case_id === foreignCase.caseId));

      const foreign = await f.foreignStaff.from("case_label_links").select("case_id");
      assert.ok(foreign.data.some((row) => row.case_id === foreignCase.caseId));
      assert.ok(!foreign.data.some((row) => row.case_id === own.caseId));
    });

    await t.test("uncleared staff read nothing", async () => {
      const uncleared = await f.staff({
        key: "uncleared",
        name: "Kai Moreno",
        capabilities: ["prepare"],
        cleared: false,
      });
      for (const table of ["case_labels", "case_label_links"]) {
        const { data, error } = await uncleared.client.from(table).select();
        assert.equal(error, null);
        assert.deepEqual(data, [], table);
      }
    });

    await t.test("no write grants", async () => {
      const { caseId } = await f.submittedClientCase();
      const id = await labelId(f, "MFS");
      const before = await counts(f);
      const attempts = {
        case_labels: [
          (c) => c.from("case_labels").insert({ workspace_id: f.workspaceId, name: "Hacked", color: "sky" }),
          (c) => c.from("case_labels").update({ color: "green" }).eq("id", id),
          (c) => c.from("case_labels").delete().eq("id", id),
        ],
        case_label_links: [
          (c) =>
            c.from("case_label_links").insert({
              workspace_id: f.workspaceId,
              case_id: caseId,
              label_id: id,
              active: true,
              changed_by_person_id: f.preparerId,
            }),
          (c) => c.from("case_label_links").update({ active: false }).eq("label_id", id),
          (c) => c.from("case_label_links").delete().eq("label_id", id),
        ],
      };
      for (const [table, fns] of Object.entries(attempts))
        for (const attempt of fns) {
          const { error } = await attempt(f.preparer);
          assert.ok(error, `${table} write refused`);
        }
      assert.deepEqual(await counts(f), before);
      const anon = await f.anonymous.from("case_labels").select();
      assert.ok(anon.error || anon.data.length === 0);
    });
  } finally {
    await f.close();
  }
});
