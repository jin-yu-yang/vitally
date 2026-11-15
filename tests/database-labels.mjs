import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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

    await t.test("an admin creates a label", async () => {
      const { data, error } = await f.saveLabel(f.siteCoordinator, {
        name: "Late filing",
        color: "green",
      });
      assert.equal(error, null);
      assert.equal(data.revision, 1);
      const row = (
        await f.sql(
          "select name,color,revision,created_by_person_id from public.case_labels where id=$1",
          [data.labelId],
        )
      ).rows[0];
      assert.equal(row.name, "Late filing");
      assert.equal(row.color, "green");
      assert.equal(String(row.revision), "1");
      assert.equal(row.created_by_person_id, f.siteCoordinatorId);
    });

    await t.test("an admin renames and recolors", async () => {
      const id = await labelId(f, "City Tax");
      const { data, error } = await f.saveLabel(f.siteCoordinator, {
        labelId: id,
        expectedRevision: 1,
        name: " City tax (Phila.) ",
        color: "violet",
      });
      assert.equal(error, null);
      assert.equal(data.revision, 2);
      assert.equal(data.labelId, id);
      const row = (
        await f.sql(
          "select name,color,updated_by_person_id from public.case_labels where id=$1",
          [id],
        )
      ).rows[0];
      assert.equal(row.name, "City tax (Phila.)");
      assert.equal(row.color, "violet");
      assert.equal(row.updated_by_person_id, f.siteCoordinatorId);
    });

    await t.test("refusals in order", async () => {
      const uncleared = await f.staff({
        key: "uncleared_admin",
        name: "Noor Haddad",
        capabilities: ["admin"],
        cleared: false,
      });
      const mfs = await labelId(f, "MFS");
      const foreign = (
        await f.sql("select id from public.case_labels where workspace_id=$1 limit 1", [
          f.foreignWorkspaceId,
        ])
      ).rows[0].id;
      const refuseSave = async (client, code, args, why) => {
        const actionId = randomUUID();
        const { error } = await f.saveLabel(client, { actionId, ...args });
        assert.equal(error?.code, code, why);
        assert.equal(await f.receiptsFor(actionId), 0, why);
      };
      const ok = { name: "Fresh", color: "sky" };
      await refuseSave(uncleared.client, "VT009", ok, "uncleared admin");
      await refuseSave(f.applicantA, "VT001", ok, "client");
      await refuseSave(f.preparer, "VT001", ok, "preparer");
      await refuseSave(f.siteCoordinator, "VT007", { label: { ...ok, x: 1 } }, "extra key");
      await refuseSave(f.siteCoordinator, "VT007", { name: "   ", color: "sky" }, "blank");
      await refuseSave(f.siteCoordinator, "VT007", { name: "x".repeat(25), color: "sky" }, "long");
      await refuseSave(f.siteCoordinator, "VT007", { name: "Fresh", color: "#ff0000" }, "color");
      await refuseSave(f.siteCoordinator, "VT007", { name: "mfs", color: "sky" }, "clash");
      await refuseSave(
        f.siteCoordinator,
        "VT007",
        { ...ok, expectedRevision: 1 },
        "create with a revision",
      );
      await refuseSave(
        f.siteCoordinator,
        "VT002",
        { ...ok, labelId: randomUUID(), expectedRevision: 1 },
        "unknown id",
      );
      await refuseSave(
        f.siteCoordinator,
        "VT002",
        { ...ok, labelId: foreign, expectedRevision: 1 },
        "foreign id",
      );
      await refuseSave(
        f.siteCoordinator,
        "VT003",
        { ...ok, labelId: mfs, expectedRevision: 99 },
        "stale revision",
      );
      await refuseSave(
        f.siteCoordinator,
        "VT007",
        { name: "Multi-state", color: "sky", labelId: mfs, expectedRevision: 1 },
        "rename onto another label",
      );
    });

    await t.test("replay returns the receipt", async () => {
      const actionId = randomUUID();
      const args = { actionId, name: "Replayed", color: "slate" };
      const first = await f.saveLabel(f.siteCoordinator, args);
      assert.equal(first.error, null);
      const again = await f.saveLabel(f.siteCoordinator, args);
      assert.equal(again.error, null);
      assert.deepEqual(again.data, first.data);
      const row = (
        await f.sql("select revision from public.case_labels where id=$1", [first.data.labelId])
      ).rows[0];
      assert.equal(String(row.revision), "1");
      const other = await f.saveLabel(f.siteCoordinator, { ...args, name: "Different" });
      assert.equal(other.error?.code, "VT007");
    });

    await t.test("no case history", async () => {
      const count = async () =>
        (
          await f.sql("select count(*) as n from public.case_events where workspace_id=$1", [
            f.workspaceId,
          ])
        ).rows[0].n;
      const before = await count();
      const id = await labelId(f, "MFS");
      const { error } = await f.saveLabel(f.siteCoordinator, {
        labelId: id,
        expectedRevision: 1,
        name: "MFS filers",
        color: "pink",
      });
      assert.equal(error, null);
      assert.equal(await count(), before);
    });
  } finally {
    await f.close();
  }
});
