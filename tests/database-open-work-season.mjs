import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabaseFixture } from "./support/database-fixture.mjs";

// OpenSpec change add-start-next-season (design D6), migration 055 §2 and §3:
// open work counts only the current season's cases, so a returning volunteer
// can lose Preparer or be deactivated while a past season's cases still name
// them. A current-season case that isn't closed still counts. The table
// capabilities_before_052 is gone.

const EMPTY_ENTRY = (email) => ({
  name: "Taylor Brooks",
  email,
  phone: null,
  works: "on_site",
  languages: ["english"],
  otherLanguage: null,
  roles: [],
  certificates: [],
  isNew: false,
  photoIdChecked: false,
});

// A case the Preparer carried to Accepted (both returns on paper). Done
// before any season move: a past-season case is read-only (055 §1).
async function acceptedCase(f) {
  const caseId = await f.approvedCase();
  await f.act(f.siteCoordinator, caseId, "MARK_READY_TO_EFILE", { confirmed: true });
  await f.act(f.siteCoordinator, caseId, "MARK_EFILED", {
    confirmed: true,
    methods: { federal: "paper", state: "paper" },
  });
  return caseId;
}
const personOf = async (f, key) =>
  (await f.sql("select id from public.people where workspace_id=$1 and person_key=$2", [f.workspaceId, key]))
    .rows[0].id;
const clientOf = async (f, caseId) =>
  (await f.sql("select coalesce(client_number::text,reference) as n from public.cases where id=$1", [caseId]))
    .rows[0].n;
const saveArgs = async (f, personId, entry) => ({
  p_action_id: randomUUID(),
  p_volunteer_id: personId,
  p_expected_revision: Number(
    (await f.sql("select revision from public.volunteer_profiles where person_id=$1", [personId])).rows[0].revision,
  ),
  p_volunteer: entry,
});

test("a past-season case is not open work", async (t) => {
  const f = await createDatabaseFixture();
  try {
    const preparerId = await personOf(f, "preparer");
    const caseId = await acceptedCase(f);
    const stageRow = async () =>
      (await f.sql("select stage, preparer_id from public.cases where id=$1 and workspace_id=$2", [caseId, f.workspaceId]))
        .rows[0];
    assert.equal((await stageRow()).stage, "accepted");
    assert.equal((await stageRow()).preparer_id, preparerId);

    // The season moves on. Clearance is per season (045), so the staff get
    // new-season roster entries; the Preparer keeps Preparer there.
    await f.sql("update public.workspaces set current_season=current_season+1 where id=$1", [f.workspaceId]);
    for (const member of f.setup.staff) {
      await f.clearStaff(await personOf(f, member.personKey), member.capabilities, f.workspaceId, {
        siteCoordinator: member.siteCoordinator,
      });
    }
    const email = (await f.sql("select email from public.volunteer_profiles where person_id=$1", [preparerId])).rows[0]
      .email;

    await t.test("a returning volunteer's past-season case is not open work", async () => {
      const { data, error } = await f.siteCoordinator.rpc(
        "vitally_save_volunteer",
        await saveArgs(f, preparerId, EMPTY_ENTRY(email)),
      );
      assert.equal(error, null, `save: ${error?.code} ${error?.message} ${error?.details}`);
      assert.equal(data.personId, preparerId);
      const roles = (
        await f.sql(
          "select r.roles from public.roster_entries r join public.workspaces w on w.id=r.workspace_id and w.current_season=r.season where r.workspace_id=$1 and r.person_id=$2",
          [f.workspaceId, preparerId],
        )
      ).rows[0].roles;
      assert.deepEqual(roles, []);
      assert.equal((await stageRow()).preparer_id, preparerId);
    });

    await t.test("Deactivate ignores past-season cases", async () => {
      const account = (
        await f.sql("select revision::int as revision from public.accounts where workspace_id=$1 and person_id=$2", [
          f.workspaceId,
          preparerId,
        ])
      ).rows[0];
      const { data, error } = await f.siteCoordinator.rpc("vitally_deactivate_account", {
        p_action_id: randomUUID(),
        p_volunteer_id: preparerId,
        p_expected_revision: account.revision,
      });
      assert.equal(error, null, `deactivate: ${error?.code} ${error?.message} ${error?.details}`);
      assert.equal(data.status, "deactivated");
    });
  } finally {
    await f.close();
  }
});

test("a current-season Accepted case still counts as open work", async () => {
  const f = await createDatabaseFixture();
  try {
    const preparerId = await personOf(f, "preparer");
    const caseId = await acceptedCase(f);
    const email = (await f.sql("select email from public.volunteer_profiles where person_id=$1", [preparerId])).rows[0]
      .email;
    const { error } = await f.siteCoordinator.rpc(
      "vitally_save_volunteer",
      await saveArgs(f, preparerId, EMPTY_ENTRY(email)),
    );
    assert.equal(error?.code, "VT004");
    assert.equal(error.message, "OPEN_WORK");
    assert.deepEqual(JSON.parse(error.details), [`preparing client ${await clientOf(f, caseId)}`]);
  } finally {
    await f.close();
  }
});

test("capabilities_before_052 is gone", async () => {
  const f = await createDatabaseFixture();
  try {
    const { rows } = await f.sql("select to_regclass('vitally_private.capabilities_before_052') as t");
    assert.equal(rows[0].t, null);
  } finally {
    await f.close();
  }
});
