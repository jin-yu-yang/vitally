import test from "node:test";
import assert from "node:assert/strict";
import { createDatabaseFixture, rejected } from "./support/database-fixture.mjs";
import { initializeWorkspace } from "../tools/admin/workspace-setup.mjs";

// OpenSpec change add-account-invitations (design D1, D2, D6, D7), migration
// 046: one `accounts` row per membership, the backfill, the first sign-in
// trigger, the active accounts that the roster command and workspace setup
// write, and clearance needing an active account. Specs: sign-in-accounts and
// volunteer-clearance. The file shares one fixture; every staff member below
// has a person key of their own, since `add_staff_member` refuses changed
// values for an existing key.

const one = async (f, text, values) => (await f.sql(text, values)).rows[0];
const accountOf = (f, userId, workspaceId = f.workspaceId) =>
  one(
    f,
    `select person_id,status,invited_at,activated_at,deactivated_at,invited_by,revision::int as revision,updated_at
       from public.accounts where workspace_id=$1 and user_id=$2`,
    [workspaceId, userId],
  );
const accountCount = async (f, userId) =>
  Number(
    (await one(f, "select count(*) as n from public.accounts where user_id=$1", [userId])).n,
  );
const clearedOf = async (f, personId) =>
  (await one(f, "select vitally_private.cleared($1,$2) as cleared", [f.workspaceId, personId])).cleared;
const setStatus = (f, userId, status) =>
  f.sql("update public.accounts set status=$3 where workspace_id=$1 and user_id=$2", [
    f.workspaceId,
    userId,
    status,
  ]);
const addStaffMember = (f, userId, key, name, capabilities) =>
  f.withSetupLock(() =>
    f.sql("select vitally_private.add_staff_member($1,$2,$3,$4,$5::text[]) as person_id", [
      f.workspaceId,
      userId,
      key,
      name,
      capabilities,
    ]),
  );
const readable = async (client, table) => {
  const { data, error } = await client.from(table).select("*");
  assert.equal(error, null, `${table} read`);
  return data;
};

async function inTransaction(f, body) {
  await f.sql("begin");
  try {
    return await body();
  } finally {
    await f.sql("rollback");
  }
}
// A transaction whose commit the database must refuse; the rollback after it
// is a no-op unless the body threw first.
async function refusedAtCommit(f, body, label) {
  await f.sql("begin");
  try {
    await body();
    await assert.rejects(() => f.sql("commit"), rejected("VALIDATION"), label);
  } finally {
    await f.sql("rollback");
  }
}

test("sign-in accounts against real Supabase", async (t) => {
  const f = await createDatabaseFixture();
  try {
    const admin = f.siteCoordinator;

    await t.test("fixture staff have an active account", async () => {
      const member = await f.staff({ key: "ada_account", name: "Ada Quill", capabilities: ["prepare"] });
      const account = await accountOf(f, member.userId);
      assert.equal(account.status, "active");
      assert.equal(account.person_id, member.personId);
      assert.ok(account.activated_at, "activated_at");
      assert.equal(account.invited_at, null);
      assert.equal(account.deactivated_at, null);
      assert.equal(account.revision, 1);
      for (const [role, { userId, personId }] of Object.entries(f.roleAccounts)) {
        const roleAccount = await accountOf(f, userId);
        assert.equal(roleAccount?.status, "active", role);
        assert.equal(roleAccount.person_id, personId, role);
      }
      // The identical re-run of the roster command adds no second account.
      await addStaffMember(f, member.userId, "ada_account", "Ada Quill", ["prepare"]);
      assert.equal(await accountCount(f, member.userId), 1);
      assert.equal((await accountOf(f, member.userId)).revision, 1);
    });

    await t.test("applicants have an active account with no person", async () => {
      for (const userId of [f.applicantAUserId, f.applicantBUserId]) {
        const account = await accountOf(f, userId);
        assert.equal(account?.status, "active");
        assert.equal(account.person_id, null);
        assert.ok(account.activated_at, "activated_at");
      }
      // A re-run of workspace setup adds no second account.
      await f.withSetupLock(() =>
        initializeWorkspace({ workspaceId: f.workspaceId, applicantUserIds: f.setup.applicantUserIds }),
      );
      for (const userId of [f.applicantAUserId, f.applicantBUserId])
        assert.equal(await accountCount(f, userId), 1);
    });

    await t.test("an admin reads accounts; a preparer and a client read none", async () => {
      const rows = await readable(admin, "accounts");
      assert.ok(rows.length > 0, "the admin reads rows");
      assert.ok(rows.every((row) => row.workspace_id === f.workspaceId), "own workspace only");
      assert.ok(rows.some((row) => row.user_id === f.preparerUserId && row.person_id === f.preparerId));
      assert.ok(rows.some((row) => row.user_id === f.applicantAUserId && row.person_id === null));
      assert.deepEqual(await readable(f.preparer, "accounts"), [], "preparer");
      assert.deepEqual(await readable(f.applicantA, "accounts"), [], "client");
      // Another workspace's admin reads their own rows and none of this one's.
      const foreign = await readable(f.foreignStaff, "accounts");
      assert.ok(foreign.length > 0, "the other admin reads their own rows");
      assert.deepEqual(foreign.filter((row) => row.workspace_id === f.workspaceId), []);
      // Anonymous: no grant, so either a refusal or nothing.
      const anonymous = await f.anonymous.from("accounts").select("*");
      assert.deepEqual(anonymous.data ?? [], [], "anonymous");
    });

    await t.test("authenticated cannot write accounts", async () => {
      const before = await accountOf(f, f.preparerUserId);
      const inserted = await admin
        .from("accounts")
        .insert({ workspace_id: f.workspaceId, user_id: f.unapprovedUserId, status: "active" });
      assert.ok(inserted.error, "insert");
      const updated = await admin
        .from("accounts")
        .update({ status: "deactivated" })
        .eq("user_id", f.preparerUserId);
      assert.ok(updated.error, "update");
      const deleted = await admin.from("accounts").delete().eq("user_id", f.preparerUserId);
      assert.ok(deleted.error, "delete");
      assert.deepEqual(await accountOf(f, f.preparerUserId), before);
      assert.equal(await accountCount(f, f.unapprovedUserId), 0);
    });

    await t.test("a client account naming a person is refused at commit", async () => {
      await refusedAtCommit(
        f,
        async () => {
          const { id } = await one(
            f,
            "insert into public.people(workspace_id,person_key,name,capabilities) values($1,'acct_named','Noel Varga','{}') returning id",
            [f.workspaceId],
          );
          await f.sql("update public.accounts set person_id=$3 where workspace_id=$1 and user_id=$2", [
            f.workspaceId,
            f.applicantAUserId,
            id,
          ]);
        },
        "client with a person",
      );
      assert.equal((await accountOf(f, f.applicantAUserId)).person_id, null);
      // The other half of the rule: a staff account must name its person.
      await refusedAtCommit(
        f,
        () =>
          f.sql("update public.accounts set person_id=null where workspace_id=$1 and user_id=$2", [
            f.workspaceId,
            f.preparerUserId,
          ]),
        "staff with no person",
      );
      assert.equal((await accountOf(f, f.preparerUserId)).person_id, f.preparerId);
    });

    await t.test("sign-in activates an invited account", async () => {
      const member = await f.staff({ key: "ivo_invited", name: "Ivo Marsh", capabilities: ["prepare"] });
      await setStatus(f, member.userId, "invited");
      await f.sql("update public.accounts set activated_at=null where workspace_id=$1 and user_id=$2", [
        f.workspaceId,
        member.userId,
      ]);
      const before = await accountOf(f, member.userId);
      assert.equal(before.status, "invited");
      assert.equal(await clearedOf(f, member.personId), false, "not cleared while invited");
      const { error } = await member.client.auth.signInWithPassword({
        email: member.email,
        password: member.password,
      });
      assert.equal(error, null, "sign-in");
      const after = await accountOf(f, member.userId);
      assert.equal(after.status, "active");
      assert.ok(after.activated_at, "activated_at");
      assert.equal(after.revision, before.revision + 1);
      assert.ok(after.updated_at > before.updated_at, "updated_at");
      const stamped = await one(
        f,
        `select a.activated_at=u.last_sign_in_at as same from public.accounts a
          join auth.users u on u.id=a.user_id where a.workspace_id=$1 and a.user_id=$2`,
        [f.workspaceId, member.userId],
      );
      assert.equal(stamped.same, true, "activated_at is the sign-in time");
      assert.equal(await clearedOf(f, member.personId), true, "cleared after the sign-in");
      // A later sign-in changes nothing more.
      const again = await member.client.auth.signInWithPassword({
        email: member.email,
        password: member.password,
      });
      assert.equal(again.error, null, "second sign-in");
      assert.equal((await accountOf(f, member.userId)).revision, after.revision);
    });

    // Review Focus 5.
    await t.test("a deactivated account stays deactivated on sign-in", async () => {
      const member = await f.staff({ key: "dov_deactivated", name: "Dov Pryce", capabilities: ["prepare"] });
      await f.sql("update public.memberships set active=false where workspace_id=$1 and user_id=$2", [
        f.workspaceId,
        member.userId,
      ]);
      await f.sql(
        "update public.accounts set status='deactivated',deactivated_at=now() where workspace_id=$1 and user_id=$2",
        [f.workspaceId, member.userId],
      );
      const before = await accountOf(f, member.userId);
      const { error } = await member.client.auth.signInWithPassword({
        email: member.email,
        password: member.password,
      });
      assert.equal(error, null, "sign-in");
      assert.deepEqual(await accountOf(f, member.userId), before);
      assert.equal(await clearedOf(f, member.personId), false);
      const { data } = await member.client.from("memberships").select("*");
      assert.deepEqual(data ?? [], [], "no access");
    });

    await t.test("cleared requires an active account", async () => {
      const { current_season: season } = await one(
        f,
        "select current_season from public.workspaces where id=$1",
        [f.workspaceId],
      );
      // Roles and certificates, not new, and no account.
      await inTransaction(f, async () => {
        const { id } = await one(
          f,
          "insert into public.people(workspace_id,person_key,name,capabilities) values($1,'nan_no_account','Nan Sorel','{}') returning id",
          [f.workspaceId],
        );
        await f.sql(
          "insert into public.roster_entries(workspace_id,person_id,season,roles,is_new) values($1,$2,$3,'{preparer}',false)",
          [f.workspaceId, id, season],
        );
        await f.sql(
          `insert into public.certificates(workspace_id,person_id,season,certificate,status,confirmed_at)
            select $1::uuid,$2::uuid,$3::smallint,c,'confirmed',now() from unnest(array['vsc','itqr','basic']) c`,
          [f.workspaceId, id, season],
        );
        assert.equal(await clearedOf(f, id), false, "no account");
      });
      // The same roles and certificates with an active account.
      const member = await f.staff({ key: "abe_active", name: "Abe Tolland", capabilities: ["prepare"] });
      assert.equal(await clearedOf(f, member.personId), true, "active");
      await inTransaction(f, async () => {
        await setStatus(f, member.userId, "invited");
        assert.equal(await clearedOf(f, member.personId), false, "invited");
        await setStatus(f, member.userId, "deactivated");
        assert.equal(await clearedOf(f, member.personId), false, "deactivated");
      });
      assert.equal(await clearedOf(f, member.personId), true, "active again after the rollback");
    });

    // The backfill writes to every membership with no account, so it runs in a
    // transaction that is rolled back.
    await t.test("backfill", async () => {
      const active = await f.provision();
      const inactive = await f.provision();
      await inTransaction(f, async () => {
        await f.sql(
          "insert into public.memberships(workspace_id,user_id,access,active) values($1,$2,'applicant',true),($1,$3,'applicant',false)",
          [f.workspaceId, active.userId, inactive.userId],
        );
        assert.equal(await accountOf(f, active.userId), undefined, "no account before the backfill");
        await f.sql("select vitally_private.backfill_accounts()");
        const on = await accountOf(f, active.userId);
        assert.equal(on.status, "active");
        assert.equal(on.person_id, null);
        assert.equal(on.deactivated_at, null);
        const stamped = await one(
          f,
          `select a.activated_at=u.last_sign_in_at as same from public.accounts a
            join auth.users u on u.id=a.user_id where a.workspace_id=$1 and a.user_id=$2`,
          [f.workspaceId, active.userId],
        );
        assert.equal(stamped.same, true, "activated_at is the last sign-in");
        const off = await accountOf(f, inactive.userId);
        assert.equal(off.status, "deactivated");
        assert.ok(off.deactivated_at, "deactivated_at");
        // A second run adds nothing and changes nothing.
        await f.sql("select vitally_private.backfill_accounts()");
        assert.deepEqual(await accountOf(f, active.userId), on);
        assert.equal(await accountCount(f, active.userId), 1);
        // Existing rows are left alone.
        assert.equal((await accountOf(f, f.preparerUserId)).status, "active");
      });
    });

    // ---------------------------------------------------------------------
    // Part 2 (the account functions) follows below this line.
  } finally {
    await f.close();
  }
});
