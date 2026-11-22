import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  applyArgs,
  assistanceArgs,
  contactArgs,
  createDatabaseFixture,
  editContactArgs,
  SAMPLE_CONTACT,
} from "./support/database-fixture.mjs";

// OpenSpec change add-start-next-season (design D5), migration 055 §1: once the
// workspace's season moves on, a case numbered in an earlier season is
// read-only for everyone. lock_case refuses it, so every case-writing RPC
// does, and a help request naming it can't be claimed or resolved. A draft has
// no season yet, so it stays writable and submits into the new season.

const PAST_SEASON = { code: "VT004", message: "INVALID_TRANSITION", details: "PAST_SEASON" };

test("past-season cases are read-only", async (t) => {
  const f = await createDatabaseFixture();
  try {
    const caseRow = async (caseId) =>
      (
        await f.sql(
          "select stage, season, revision from public.cases where id=$1 and workspace_id=$2",
          [caseId, f.workspaceId],
        )
      ).rows[0];
    const count = async (sql, id) => Number((await f.sql(sql, [id, f.workspaceId])).rows[0].count);
    const refusal = (error) => error && { code: error.code, message: error.message, details: error.details };

    // In the current season: an Accepted case (both returns on paper), a case
    // at review_approved that a staff action and the season-end close would
    // otherwise accept, a received client case its owner could otherwise
    // withdraw, and a draft. Each written case gets what an RPC needs to
    // reach it: a contact log entry, a label, and help requests.
    const accepted = await f.approvedCase();
    await f.act(f.siteCoordinator, accepted, "MARK_READY_TO_EFILE", { confirmed: true });
    await f.act(f.siteCoordinator, accepted, "MARK_EFILED", {
      confirmed: true,
      methods: { federal: "paper", state: "paper" },
    });
    assert.equal((await caseRow(accepted)).stage, "accepted");
    const approved = await f.approvedCase();
    const { caseId: received } = await f.submittedClientCase();
    const { caseId: draft } = await f.draftCase(f.applicantA);
    await f.logContact(f.siteCoordinator, accepted, SAMPLE_CONTACT());
    const contact = (
      await f.sql("select id, revision from public.contact_log where case_id=$1 and workspace_id=$2", [
        accepted,
        f.workspaceId,
      ])
    ).rows[0];
    const labelId = (
      await f.sql("select id from public.case_labels where workspace_id=$1 order by name limit 1", [
        f.workspaceId,
      ])
    ).rows[0].id;
    const helpItem = async (caseId) =>
      (
        await f.sql(
          `insert into public.assistance_items(workspace_id,case_id,title,status,revision,assignee_person_id,language,contact_preference)
           values($1,$2,$3,'open',1,null,$4,$5) returning id`,
          [
            f.workspaceId,
            caseId,
            f.sampleAssistance.title,
            f.sampleAssistance.language,
            f.sampleAssistance.contactPreference,
          ],
        )
      ).rows[0].id;
    const pastItem = await helpItem(accepted);
    const looseItem = await helpItem(null);
    const season = Number((await caseRow(accepted)).season);
    assert.equal((await caseRow(draft)).season, null);

    // The season moves on. Clearance is per season (045), so the staff are
    // cleared for the new one too.
    await f.sql("update public.workspaces set current_season=current_season+1 where id=$1", [f.workspaceId]);
    for (const member of f.setup.staff) {
      const { id } = (
        await f.sql("select id from public.people where workspace_id=$1 and person_key=$2", [
          f.workspaceId,
          member.personKey,
        ])
      ).rows[0];
      await f.clearStaff(id, member.capabilities, f.workspaceId, { siteCoordinator: member.siteCoordinator });
    }

    await t.test("every case-writing RPC refuses a past-season case", async () => {
      const revision = async (caseId) => Number((await caseRow(caseId)).revision);
      const calls = [
        ["staff vitally_apply_action PUT_ON_HOLD", approved, async () =>
          f.siteCoordinator.rpc(
            "vitally_apply_action",
            applyArgs({ caseId: approved, revision: await revision(approved), type: "PUT_ON_HOLD", payload: { confirmed: true } }),
          )],
        ["client vitally_apply_action WITHDRAW", received, async () =>
          f.applicantA.rpc(
            "vitally_apply_action",
            applyArgs({ caseId: received, revision: await revision(received), type: "WITHDRAW", payload: { confirmed: true } }),
          )],
        ["vitally_log_contact", accepted, async () =>
          f.siteCoordinator.rpc("vitally_log_contact", contactArgs({ caseId: accepted, entry: SAMPLE_CONTACT() }))],
        ["vitally_edit_contact", accepted, async () =>
          f.siteCoordinator.rpc(
            "vitally_edit_contact",
            editContactArgs({
              contactId: contact.id,
              revision: Number(contact.revision),
              entry: { ...SAMPLE_CONTACT(), note: "Fictional: an edit after the season." },
            }),
          )],
        ["vitally_set_case_label", accepted, async () => f.setCaseLabel(f.siteCoordinator, accepted, labelId, true)],
        ["vitally_close_unsigned", approved, async () =>
          f.siteCoordinator.rpc("vitally_close_unsigned", {
            p_action_id: randomUUID(),
            p_cases: [{ caseId: approved, revision: await revision(approved) }],
            p_confirmed: true,
          })],
      ];
      const before = {};
      for (const caseId of [accepted, approved, received]) before[caseId] = await caseRow(caseId);
      const contactRows = await count("select count(*) from public.contact_log where case_id=$1 and workspace_id=$2", accepted);
      const outcomes = [];
      for (const [name, caseId, call] of calls) {
        const { error } = await call();
        outcomes.push({ name, refusal: refusal(error), unchanged: (await revision(caseId)) === Number(before[caseId].revision) });
      }
      assert.deepEqual(
        outcomes,
        calls.map(([name]) => ({ name, refusal: PAST_SEASON, unchanged: true })),
      );
      for (const caseId of [accepted, approved, received]) assert.deepEqual(await caseRow(caseId), before[caseId]);
      assert.equal(
        await count("select count(*) from public.contact_log where case_id=$1 and workspace_id=$2", accepted),
        contactRows,
      );
      assert.equal(
        (
          await f.sql("select revision from public.contact_log where id=$1 and workspace_id=$2", [contact.id, f.workspaceId])
        ).rows[0].revision,
        contact.revision,
      );
      assert.equal(
        await count("select count(*) from public.case_label_links where case_id=$1 and workspace_id=$2", accepted),
        0,
      );
    });

    await t.test("a help request on a past-season case is refused", async () => {
      const { error } = await f.siteCoordinator.rpc(
        "vitally_assistance_action",
        assistanceArgs({ itemId: pastItem, revision: 1, type: "CLAIM" }),
      );
      assert.deepEqual(refusal(error), PAST_SEASON);
      const item = (
        await f.sql("select status, revision, assignee_person_id from public.assistance_items where id=$1 and workspace_id=$2", [
          pastItem,
          f.workspaceId,
        ])
      ).rows[0];
      assert.deepEqual({ ...item, revision: Number(item.revision) }, { status: "open", revision: 1, assignee_person_id: null });
    });

    await t.test("a help request with no case is still claimable", async () => {
      await f.actAssistance(f.siteCoordinator, looseItem, "CLAIM");
      const item = (
        await f.sql("select status, assignee_person_id from public.assistance_items where id=$1 and workspace_id=$2", [
          looseItem,
          f.workspaceId,
        ])
      ).rows[0];
      assert.equal(item.assignee_person_id, f.siteCoordinatorId);
    });

    await t.test("a draft stays writable and submits into the current season", async () => {
      const { answers } = (
        await f.sql("select answers from public.cases where id=$1 and workspace_id=$2", [draft, f.workspaceId])
      ).rows[0];
      await f.act(f.applicantA, draft, "SAVE_ANSWERS", { answers });
      await f.act(f.applicantA, draft, "SUBMIT", { confirmed: true });
      const row = await caseRow(draft);
      assert.equal(row.stage, "received");
      assert.equal(Number(row.season), season + 1);
    });

    await t.test("clients still read their past-season application", async () => {
      const { data, error } = await f.applicantA.from("cases").select("id,season,stage").eq("id", accepted);
      assert.equal(error, null);
      assert.deepEqual(data, [{ id: accepted, season, stage: "accepted" }]);
    });
  } finally {
    await f.close();
  }
});
