import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabaseFixture, PREPARER } from "./support/database-fixture.mjs";
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
// This workspace's rows only: other test files create workspaces at the same
// time, and each new one gets the starter labels.
const counts = async (f) =>
  (
    await f.sql(
      "select (select count(*) from public.case_labels where workspace_id = $1) as labels, (select count(*) from public.case_label_links where workspace_id = $1) as links",
      [f.workspaceId],
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
        // Trimmed of tabs and line breaks too (as 049 trims), and one line only.
        ["\t", "sky"],
        ["\n\t", "sky"],
        ["Amended\n", "sky"],
        ["\tAmended", "sky"],
        ["Amend\ned", "sky"],
        ["Amend\red", "sky"],
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

    // As on 049's tables: only the two RPCs write labels, so the service key
    // gets no grant on either table.
    await t.test("service_role holds nothing on the label tables", async () => {
      for (const table of ["case_labels", "case_label_links"]) {
        const grants = await f.sql(
          `select p, has_table_privilege('service_role', $1, p) as granted
             from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p`,
          [`public.${table}`],
        );
        assert.deepEqual(grants.rows.filter((row) => row.granted).map((row) => row.p), [], table);
      }
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
        name: "\t City tax (Phila.)\r\n",
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
      await refuseSave(f.siteCoordinator, "VT007", { name: "\n\t", color: "sky" }, "only a tab and a line break");
      await refuseSave(f.siteCoordinator, "VT007", { name: "Amend\ned", color: "sky" }, "a line break inside");
      await refuseSave(f.siteCoordinator, "VT007", { name: "Amend\red", color: "sky" }, "a carriage return inside");
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

    await t.test("set case label", async (t) => {
      const eventsOf = async (caseId) =>
        (
          await f.sql(
            "select action,detail,actor_person_id from public.case_events where case_id=$1 and action in ('ADD_CASE_LABEL','REMOVE_CASE_LABEL') order by created_at,id",
            [caseId],
          )
        ).rows;
      const linksOf = async (caseId) =>
        (await f.sql("select * from public.case_label_links where case_id=$1", [caseId])).rows;
      const caseRow = async (caseId) =>
        (await f.sql("select revision,updated_at,stage from public.cases where id=$1", [caseId]))
          .rows[0];
      // Counted for this fixture's workspace only: other test files share the database.
      const allEvents = async () =>
        (
          await f.sql("select count(*)::int as n from public.case_events where workspace_id=$1", [
            f.workspaceId,
          ])
        ).rows[0].n;
      const scopedCounts = async () =>
        (
          await f.sql(
            "select (select count(*) from public.case_labels where workspace_id=$1) as labels, (select count(*) from public.case_label_links where workspace_id=$1) as links",
            [f.workspaceId],
          )
        ).rows[0];
      const receipts = async () =>
        (
          await f.sql(
            "select count(*)::int as n from public.action_receipts where operation='SET_CASE_LABEL' and workspace_id=$1",
            [f.workspaceId],
          )
        ).rows[0].n;
      const screeningCase = async () => {
        const { caseId } = await f.submittedClientCase();
        await f.act(f.siteCoordinator, caseId, "START_SCREENING", {});
        return caseId;
      };
      // Earlier tests renamed some starters, so these tests use their own.
      await insertLabel(f, "Spare", "green");
      await insertLabel(f, "Old name", "violet");
      const multi = await labelId(f, "Multi-state");

      await t.test("the preparer adds and removes", async () => {
        const caseId = await f.preparedCase();
        const actionId = randomUUID();
        const added = await f.setCaseLabel(f.preparer, caseId, multi, true, actionId);
        assert.equal(added.error, null);
        assert.deepEqual(added.data, { actionId, caseId, labelId: multi, on: true });
        let links = await linksOf(caseId);
        assert.equal(links.length, 1);
        assert.equal(links[0].active, true);
        assert.equal(links[0].changed_by_person_id, f.preparerId);
        let events = await eventsOf(caseId);
        assert.equal(events.length, 1);
        assert.equal(events[0].action, "ADD_CASE_LABEL");
        assert.deepEqual(events[0].detail, { labelId: multi, name: "Multi-state" });
        assert.equal(events[0].actor_person_id, f.preparerId);
        const removed = await f.setCaseLabel(f.preparer, caseId, multi, false);
        assert.equal(removed.error, null);
        links = await linksOf(caseId);
        assert.equal(links.length, 1);
        assert.equal(links[0].active, false);
        events = await eventsOf(caseId);
        assert.deepEqual(
          events.map((e) => e.action),
          ["ADD_CASE_LABEL", "REMOVE_CASE_LABEL"],
        );
        assert.equal(await f.receiptsFor(actionId), 1);
      });

      await t.test("the assigned reviewer adds and removes", async () => {
        const caseId = await f.preparedCase();
        await f.act(f.reviewer, caseId, "CLAIM_REVIEW", {});
        assert.equal((await f.setCaseLabel(f.reviewer, caseId, multi, true)).error, null);
        assert.equal((await linksOf(caseId))[0].active, true);
        assert.equal((await f.setCaseLabel(f.reviewer, caseId, multi, false)).error, null);
        assert.equal((await linksOf(caseId))[0].active, false);
        const events = await eventsOf(caseId);
        assert.deepEqual(
          events.map((e) => e.action),
          ["ADD_CASE_LABEL", "REMOVE_CASE_LABEL"],
        );
        for (const e of events) assert.equal(e.actor_person_id, f.reviewerId);
      });

      await t.test("the office labels any case", async () => {
        const caseId = await screeningCase();
        assert.equal((await caseRow(caseId)).stage, "screening");
        const { error } = await f.setCaseLabel(f.siteCoordinator, caseId, multi, true);
        assert.equal(error, null);
        assert.equal((await linksOf(caseId))[0].active, true);
      });

      await t.test("refusals in order", async () => {
        const caseId = await f.preparedCase();
        const refused = async (client, cid, lid, code, note) => {
          const actionId = randomUUID();
          const before = [await allEvents(), await scopedCounts(), await receipts()];
          const { data, error } = await f.setCaseLabel(client, cid, lid, true, actionId);
          assert.equal(data, null, note);
          assert.equal(error?.code, code, note);
          assert.equal(await f.receiptsFor(actionId), 0, note);
          assert.deepEqual([await allEvents(), await scopedCounts(), await receipts()], before, note);
        };
        const uncleared = await f.staff({
          key: "lena_uncleared_label",
          name: "Lena Uncleared",
          capabilities: ["prepare"],
          cleared: false,
        });
        await refused(uncleared.client, caseId, multi, "VT009", "uncleared");
        await refused(f.applicantA, caseId, multi, "VT001", "client");
        const draft = await f.draftCase(f.applicantA);
        await refused(f.siteCoordinator, draft.caseId, multi, "VT002", "draft");
        await refused(f.reviewer, caseId, multi, "VT001", "not the reviewer");
        const foreignLabel = await labelId(f, "MFS", f.foreignWorkspaceId);
        await refused(f.siteCoordinator, caseId, foreignLabel, "VT007", "foreign label");
        await refused(f.siteCoordinator, caseId, null, "VT007", "null label");
        await f.act(f.siteCoordinator, caseId, "CLOSE_CASE", {
          confirmed: true,
          reason: "duplicate",
        });
        await refused(f.siteCoordinator, caseId, multi, "VT004", "closed");
      });

      await t.test("a case in another workspace is not found", async () => {
        const staff = await f.staff({
          key: "fiona_foreign_label",
          name: "Fiona Foreign",
          capabilities: ["admin"],
          workspaceId: f.foreignWorkspaceId,
        });
        const caseId = await f.preparedCase();
        const before = await allEvents();
        const actionId = randomUUID();
        const { error } = await f.setCaseLabel(staff.client, caseId, multi, true, actionId);
        assert.equal(error?.code, "VT002");
        assert.equal(await f.receiptsFor(actionId), 0);
        assert.equal((await linksOf(caseId)).length, 0);
        assert.equal(await allEvents(), before);
      });

      await t.test("unchanged state writes nothing", async () => {
        const caseId = await f.preparedCase();
        const spare = await labelId(f, "Spare");
        const never = await f.setCaseLabel(f.preparer, caseId, spare, false);
        assert.equal(never.error, null);
        assert.equal((await eventsOf(caseId)).length, 0);
        assert.equal((await f.setCaseLabel(f.preparer, caseId, spare, true)).error, null);
        assert.equal((await f.setCaseLabel(f.siteCoordinator, caseId, spare, true)).error, null);
        assert.equal((await eventsOf(caseId)).length, 1);
        assert.equal((await linksOf(caseId))[0].changed_by_person_id, f.preparerId);
      });

      await t.test("concurrent adds", async () => {
        const caseId = await f.preparedCase();
        const results = await Promise.all([
          f.setCaseLabel(f.siteCoordinator, caseId, multi, true),
          f.setCaseLabel(f.preparer, caseId, multi, true),
        ]);
        for (const r of results) assert.equal(r.error, null);
        assert.equal((await linksOf(caseId)).length, 1);
        assert.equal((await eventsOf(caseId)).length, 1);
      });

      await t.test("the case row is untouched", async () => {
        const caseId = await f.readyCase();
        await f.act(f.preparer, caseId, "CLAIM_PREPARATION", {});
        const before = await caseRow(caseId);
        const { error } = await f.setCaseLabel(f.preparer, caseId, multi, true);
        assert.equal(error, null);
        const after = await caseRow(caseId);
        assert.equal(after.revision, before.revision);
        assert.equal(after.updated_at.getTime(), before.updated_at.getTime());
        // f.act reads the current revision, so pin the pre-label one by hand.
        const { error: submitError } = await f.preparer.rpc("vitally_apply_action", {
          p_action_id: randomUUID(),
          p_case_id: caseId,
          p_expected_revision: Number(before.revision),
          p_type: "SUBMIT_REVIEW",
          p_payload: { questionnaire: PREPARER },
        });
        assert.equal(submitError, null);
      });

      await t.test("replay", async () => {
        const caseId = await f.preparedCase();
        const actionId = randomUUID();
        const first = await f.setCaseLabel(f.preparer, caseId, multi, true, actionId);
        const again = await f.setCaseLabel(f.preparer, caseId, multi, true, actionId);
        assert.equal(again.error, null);
        assert.deepEqual(again.data, first.data);
        assert.equal((await eventsOf(caseId)).length, 1);
        const other = await f.setCaseLabel(f.preparer, caseId, multi, false, actionId);
        assert.equal(other.error?.code, "VT007");
        assert.equal((await eventsOf(caseId)).length, 1);
      });

      await t.test("reassignment keeps labels", async () => {
        const caseId = await f.preparedCase();
        assert.equal((await f.setCaseLabel(f.preparer, caseId, multi, true)).error, null);
        const other = await f.staff({
          key: "pia_new_preparer_label",
          name: "Pia Preparer",
          capabilities: ["prepare"],
        });
        await f.reassignPreparer(caseId, f.preparerId, other.personId);
        assert.equal((await linksOf(caseId))[0].active, true);
        const { error } = await f.setCaseLabel(f.preparer, caseId, multi, false);
        assert.equal(error?.code, "VT001");
        assert.equal((await f.setCaseLabel(other.client, caseId, multi, false)).error, null);
      });

      await t.test("history keeps the old name", async () => {
        const caseId = await f.preparedCase();
        const id = await labelId(f, "Old name");
        assert.equal((await f.setCaseLabel(f.preparer, caseId, id, true)).error, null);
        const { error } = await f.saveLabel(f.siteCoordinator, {
          labelId: id,
          expectedRevision: 1,
          name: "New name",
          color: "sky",
        });
        assert.equal(error, null);
        assert.equal((await eventsOf(caseId))[0].detail.name, "Old name");
      });
    });
  } finally {
    await f.close();
  }
});
