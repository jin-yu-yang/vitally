import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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

    // Design D3, D5: vitally_prepare_account, vitally_record_account,
    // vitally_deactivate_account, vitally_reactivate_account and
    // vitally_client_invitations. The Edge Function creates the auth user
    // between prepare and record; here `f.provision()` stands in for it (a
    // confirmed user, tracked for cleanup). Every refusal checks the SQLSTATE,
    // the reason in the detail, and that no receipt was stored.
    const FORBIDDEN = "VT001";
    const NOT_FOUND = "VT002";
    const CONFLICT = "VT003";
    const INVALID_TRANSITION = "VT004";
    const VALIDATION = "VT007";
    const CEILING = ["assist", "prepare", "receive_documents", "review"];
    const rpc = async (client, fn, args) => {
      const { data, error } = await client.rpc(fn, args);
      assert.equal(error, null, `${fn}: ${error?.code} ${error?.message} ${error?.details}`);
      return data;
    };
    const refusedWith = async (client, fn, args, code, detail, label = fn) => {
      const { error } = await client.rpc(fn, args);
      assert.equal(error?.code, code, `${label}: ${error?.code} ${error?.message} ${error?.details}`);
      if (detail !== undefined) assert.equal(error.details, detail, `${label} detail`);
      if (args?.p_action_id) assert.equal(await f.receiptsFor(args.p_action_id), 0, `${label} receipt`);
      return error;
    };
    const prepare = (op, target, actionId = null) => ({ p_action_id: actionId, p_op: op, p_target: target });
    const recordArgs = (op, target, userId, actionId = randomUUID()) => ({
      p_action_id: actionId,
      p_op: op,
      p_target: target,
      p_user_id: userId,
    });
    const changeArgs = (volunteerId, revision, actionId = randomUUID()) => ({
      p_action_id: actionId,
      p_volunteer_id: volunteerId,
      p_expected_revision: revision,
    });
    // A Roster volunteer with no sign-in, added by the admin.
    const addVolunteer = async (email, extra = {}) =>
      (
        await rpc(admin, "vitally_save_volunteer", {
          p_action_id: randomUUID(),
          p_volunteer_id: null,
          p_expected_revision: null,
          p_volunteer: {
            name: "Rowan Pike", email, phone: null, works: "on_site", languages: ["english"],
            otherLanguage: null, roles: [], certificates: [], isNew: false, photoIdChecked: false,
            ...extra,
          },
        })
      ).personId;
    const accountOfPerson = (personId) =>
      one(
        f,
        `select user_id,status,invited_at,activated_at,deactivated_at,invited_by,revision::int as revision
           from public.accounts where workspace_id=$1 and person_id=$2`,
        [f.workspaceId, personId],
      );
    const profileRevision = async (personId) =>
      Number(
        (
          await one(f, "select revision from public.volunteer_profiles where workspace_id=$1 and person_id=$2", [
            f.workspaceId,
            personId,
          ])
        ).revision,
      );
    const membershipOf = (userId, workspaceId = f.workspaceId) =>
      one(f, "select access,active from public.memberships where workspace_id=$1 and user_id=$2", [
        workspaceId,
        userId,
      ]);
    // A volunteer with an `invited` account, as Create account leaves them.
    const invitedVolunteer = async () => {
      const user = await f.provision();
      const personId = await addVolunteer(user.email);
      await rpc(admin, "vitally_record_account", recordArgs("create", { volunteerId: personId }, user.userId));
      return { ...user, personId };
    };
    const deactivate = async (personId) =>
      rpc(admin, "vitally_deactivate_account", changeArgs(personId, (await accountOfPerson(personId)).revision));
    const fresh = () => `v-${randomUUID()}@example.org`;

    await t.test("accounts is not in the realtime publication", async () => {
      const { rows } = await f.sql(
        "select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='accounts'",
      );
      assert.deepEqual(rows, []);
    });

    await t.test("prepare create returns the profile email and no reusable user", async () => {
      const email = fresh();
      const personId = await addVolunteer(email.toUpperCase());
      assert.deepEqual(await rpc(admin, "vitally_prepare_account", prepare("create", { volunteerId: personId })), {
        op: "create",
        email,
        reusableUserId: null,
        volunteerId: personId,
        accountRevision: null,
      });
      assert.equal(await accountOfPerson(personId), undefined, "prepare writes nothing");
    });

    await t.test("prepare reuses an auth user with no account row", async () => {
      const user = await f.provision();
      const personId = await addVolunteer(user.email);
      const answer = await rpc(admin, "vitally_prepare_account", prepare("create", { volunteerId: personId }));
      assert.equal(answer.reusableUserId, user.userId);
      assert.equal(answer.email, user.email);
      const invite = await rpc(admin, "vitally_prepare_account", prepare("invite", { email: fresh() }));
      assert.equal(invite.reusableUserId, null, "no auth user for a new address");
    });

    await t.test("record create links the volunteer", async () => {
      const user = await f.provision();
      const personId = await addVolunteer(user.email, { roles: ["greeter"], certificates: ["vsc"] });
      const revision = await profileRevision(personId);
      const actionId = randomUUID();
      const result = await rpc(
        admin,
        "vitally_record_account",
        recordArgs("create", { volunteerId: personId }, user.userId, actionId),
      );
      assert.deepEqual(result, { actionId, status: "invited", email: user.email, accountRevision: 1 });
      assert.deepEqual(await membershipOf(user.userId), { access: "staff", active: true });
      const person = await one(f, "select user_id,capabilities from public.people where id=$1", [personId]);
      assert.equal(person.user_id, user.userId);
      assert.deepEqual([...person.capabilities].sort(), CEILING);
      const account = await accountOfPerson(personId);
      assert.equal(account.user_id, user.userId);
      assert.equal(account.status, "invited");
      assert.ok(account.invited_at, "invited_at");
      assert.equal(account.invited_by, f.siteCoordinatorId);
      assert.equal(account.activated_at, null);
      assert.equal(account.revision, 1);
      assert.equal(await profileRevision(personId), revision + 1);
      assert.equal(await f.receiptsFor(actionId), 1);
      assert.equal(await clearedOf(f, personId), false, "invited is not cleared");
    });

    await t.test("record invite creates an applicant", async () => {
      const user = await f.provision();
      const result = await rpc(admin, "vitally_record_account", recordArgs("invite", { email: user.email }, user.userId));
      assert.equal(result.status, "invited");
      assert.deepEqual(await membershipOf(user.userId), { access: "applicant", active: true });
      const account = await accountOf(f, user.userId);
      assert.equal(account.status, "invited");
      assert.equal(account.person_id, null);
      assert.ok(account.invited_at, "invited_at");
      assert.equal(account.invited_by, f.siteCoordinatorId);
    });

    // Review Focus 2.
    await t.test("a repeated record returns the stored result", async () => {
      const user = await f.provision();
      const args = recordArgs("invite", { email: user.email }, user.userId);
      const first = await rpc(admin, "vitally_record_account", args);
      const second = await rpc(admin, "vitally_record_account", args);
      assert.deepEqual(second, first);
      assert.equal(await accountCount(f, user.userId), 1);
      assert.equal((await f.readMembership(user.userId)).length, 1);
      assert.equal(await f.receiptsFor(args.p_action_id), 1);
    });

    // Review Focus 2, end to end: a retried Create or Invite goes prepare, then
    // record, with the same action id.
    await t.test("prepare returns the stored result for a recorded action id", async () => {
      const user = await f.provision();
      const target = { email: user.email };
      const args = recordArgs("invite", target, user.userId);
      const recorded = await rpc(admin, "vitally_record_account", args);
      const before = await accountOf(f, user.userId);
      assert.deepEqual(await rpc(admin, "vitally_prepare_account", prepare("invite", target, args.p_action_id)), {
        replay: recorded,
      });
      assert.deepEqual(await accountOf(f, user.userId), before, "prepare writes nothing");
      assert.equal(await f.receiptsFor(args.p_action_id), 1);
      // Another caller with that action id holds no such receipt: the check runs.
      const foreignTarget = { email: `v-${randomUUID()}@example.org` };
      const foreign = await rpc(
        f.foreignStaff,
        "vitally_prepare_account",
        prepare("invite", foreignTarget, args.p_action_id),
      );
      assert.equal(foreign.replay, undefined);
      assert.equal(foreign.email, foreignTarget.email);
      // Without an action id, the same address is refused as invited.
      await refusedWith(admin, "vitally_prepare_account", prepare("invite", target), VALIDATION, "ALREADY_INVITED");
    });

    await t.test("record refuses a user whose email differs", async () => {
      const invited = await f.provision();
      const other = await f.provision();
      await refusedWith(
        admin,
        "vitally_record_account",
        recordArgs("invite", { email: invited.email }, other.userId),
        VALIDATION,
      );
      assert.deepEqual(await f.readMembership(other.userId), []);
      assert.equal(await accountCount(f, other.userId), 0);
    });

    // Review Focus 1.
    await t.test("invite trims and lower-cases the email", async () => {
      const user = await f.provision();
      const typed = `  ${user.email.toUpperCase()} `;
      const prepared = await rpc(admin, "vitally_prepare_account", prepare("invite", { email: typed }));
      assert.equal(prepared.email, user.email);
      assert.equal(prepared.reusableUserId, user.userId);
      const result = await rpc(admin, "vitally_record_account", recordArgs("invite", { email: typed }, user.userId));
      assert.equal(result.email, user.email);
      assert.equal((await accountOf(f, user.userId)).status, "invited");
      await refusedWith(
        admin,
        "vitally_prepare_account",
        prepare("invite", { email: user.email }),
        VALIDATION,
        "ALREADY_INVITED",
        "the same address again",
      );
    });

    await t.test("refusal: NO_EMAIL", async () => {
      // A person on the current roster with no profile row has no email.
      const { id } = await one(
        f,
        "insert into public.people(workspace_id,person_key,name,capabilities) values($1,'acct_no_email','Wren Calder','{}') returning id",
        [f.workspaceId],
      );
      await f.sql(
        "insert into public.roster_entries(workspace_id,person_id,season) select $1::uuid,$2::uuid,current_season from public.workspaces where id=$1::uuid",
        [f.workspaceId, id],
      );
      await refusedWith(admin, "vitally_prepare_account", prepare("create", { volunteerId: id }), VALIDATION, "NO_EMAIL");
    });

    await t.test("refusal: ALREADY_INVITED", async () => {
      const volunteer = await invitedVolunteer();
      const other = await f.provision();
      await refusedWith(
        admin,
        "vitally_record_account",
        recordArgs("create", { volunteerId: volunteer.personId }, other.userId),
        VALIDATION,
        "ALREADY_INVITED",
        "create twice",
      );
      // The outsider is a client of the other workspace.
      await refusedWith(
        admin,
        "vitally_prepare_account",
        prepare("invite", { email: f.outsiderEmail.toUpperCase() }),
        VALIDATION,
        "ALREADY_INVITED",
        "a client elsewhere",
      );
    });

    await t.test("refusal: USE_REACTIVATE", async () => {
      const member = await f.staff({ key: "uma_reactivate", name: "Uma Fenn", capabilities: ["prepare"], cleared: false });
      await deactivate(member.personId);
      await refusedWith(
        admin,
        "vitally_prepare_account",
        prepare("create", { volunteerId: member.personId }),
        VALIDATION,
        "USE_REACTIVATE",
      );
    });

    await t.test("refusal: EMAIL_IN_USE", async () => {
      // A volunteer whose email, in other letter case, is a client's sign-in in
      // the other workspace.
      const personId = await addVolunteer(f.outsiderEmail.toUpperCase());
      await refusedWith(
        admin,
        "vitally_prepare_account",
        prepare("create", { volunteerId: personId }),
        VALIDATION,
        "EMAIL_IN_USE",
        "create for a client's email",
      );
      await refusedWith(
        admin,
        "vitally_record_account",
        recordArgs("create", { volunteerId: personId }, f.outsiderUserId),
        VALIDATION,
        "EMAIL_IN_USE",
        "record for a client's email",
      );
      assert.equal(await accountOfPerson(personId), undefined);
      await refusedWith(
        admin,
        "vitally_prepare_account",
        prepare("invite", { email: f.roleAccounts.preparer.email.toUpperCase() }),
        VALIDATION,
        "EMAIL_IN_USE",
        "invite a staff email",
      );
      const gone = await f.staff({ key: "gil_gone", name: "Gil Ashby", capabilities: ["prepare"], cleared: false });
      await deactivate(gone.personId);
      await refusedWith(
        admin,
        "vitally_prepare_account",
        prepare("invite", { email: gone.email }),
        VALIDATION,
        "EMAIL_IN_USE",
        "invite a deactivated staff email",
      );
    });

    await t.test("refusal: EMAIL_ON_ROSTER", async () => {
      const email = fresh();
      await addVolunteer(email);
      await refusedWith(
        admin,
        "vitally_prepare_account",
        prepare("invite", { email: ` ${email.toUpperCase()}` }),
        VALIDATION,
        "EMAIL_ON_ROSTER",
      );
    });

    await t.test("refusal: FORBIDDEN for a preparer", async () => {
      const personId = await addVolunteer(fresh());
      const user = await f.provision();
      await refusedWith(f.preparer, "vitally_prepare_account", prepare("create", { volunteerId: personId }), FORBIDDEN);
      await refusedWith(
        f.preparer,
        "vitally_record_account",
        recordArgs("invite", { email: user.email }, user.userId),
        FORBIDDEN,
      );
      await refusedWith(f.preparer, "vitally_deactivate_account", changeArgs(f.reviewerId, 1), FORBIDDEN);
      await refusedWith(f.preparer, "vitally_reactivate_account", changeArgs(f.reviewerId, 1), FORBIDDEN);
      await refusedWith(f.applicantA, "vitally_prepare_account", prepare("invite", { email: fresh() }), FORBIDDEN);
      assert.deepEqual(await f.readMembership(user.userId), []);
    });

    await t.test("refusal: NOT_FOUND for a volunteer in another workspace", async () => {
      await refusedWith(
        admin,
        "vitally_prepare_account",
        prepare("create", { volunteerId: f.foreignStaffId }),
        NOT_FOUND,
      );
      await refusedWith(admin, "vitally_deactivate_account", changeArgs(f.foreignStaffId, 1), NOT_FOUND);
    });

    await t.test("resend is refused unless invited", async () => {
      const volunteer = await invitedVolunteer();
      const account = await accountOfPerson(volunteer.personId);
      assert.deepEqual(
        await rpc(admin, "vitally_prepare_account", prepare("resend", { volunteerId: volunteer.personId })),
        {
          op: "resend",
          email: volunteer.email,
          reusableUserId: null,
          volunteerId: volunteer.personId,
          accountRevision: account.revision,
        },
      );
      const client = await f.provision();
      await rpc(admin, "vitally_record_account", recordArgs("invite", { email: client.email }, client.userId));
      const resent = await rpc(admin, "vitally_prepare_account", prepare("resend", { email: client.email.toUpperCase() }));
      assert.equal(resent.email, client.email);
      assert.equal(resent.volunteerId, null);
      await refusedWith(
        admin,
        "vitally_prepare_account",
        prepare("resend", { volunteerId: f.preparerId }),
        INVALID_TRANSITION,
        undefined,
        "an active staff account",
      );
      await refusedWith(
        admin,
        "vitally_prepare_account",
        prepare("resend", { email: f.applicantAEmail }),
        INVALID_TRANSITION,
        undefined,
        "an active client account",
      );
    });

    await t.test("deactivate", async () => {
      const member = await f.staff({ key: "dee_deactivate", name: "Dee Lorne", capabilities: ["prepare"] });
      const before = await accountOfPerson(member.personId);
      const actionId = randomUUID();
      const result = await rpc(
        admin,
        "vitally_deactivate_account",
        changeArgs(member.personId, before.revision, actionId),
      );
      assert.deepEqual(result, { actionId, status: "deactivated", accountRevision: before.revision + 1 });
      const after = await accountOfPerson(member.personId);
      assert.equal(after.status, "deactivated");
      assert.ok(after.deactivated_at, "deactivated_at");
      assert.equal(after.revision, before.revision + 1);
      assert.deepEqual(await membershipOf(member.userId), { access: "staff", active: false });
      const person = await one(f, "select user_id from public.people where id=$1", [member.personId]);
      assert.equal(person.user_id, member.userId, "the link stays");
      assert.equal(await clearedOf(f, member.personId), false);
      // Their session is refused everywhere.
      const { error } = await member.client.rpc("vitally_my_clearance");
      assert.equal(error?.code, FORBIDDEN);
      // A replay returns the stored result.
      assert.deepEqual(
        await rpc(admin, "vitally_deactivate_account", changeArgs(member.personId, before.revision, actionId)),
        result,
      );
    });

    await t.test("deactivate with open work", async () => {
      const member = await f.staff({ key: "opal_open", name: "Opal Brandt", capabilities: ["prepare"] });
      const caseId = await f.readyCase();
      await f.act(member.client, caseId, "CLAIM_PREPARATION", {});
      const { n } = await one(
        f,
        "select coalesce(client_number::text,reference) as n from public.cases where id=$1",
        [caseId],
      );
      const before = await accountOfPerson(member.personId);
      const error = await refusedWith(
        admin,
        "vitally_deactivate_account",
        changeArgs(member.personId, before.revision),
        INVALID_TRANSITION,
      );
      assert.equal(error.message, "OPEN_WORK");
      assert.deepEqual(JSON.parse(error.details), [`preparing client ${n}`]);
      assert.deepEqual(await accountOfPerson(member.personId), before);
      assert.deepEqual(await membershipOf(member.userId), { access: "staff", active: true });
    });

    await t.test("deactivate yourself", async () => {
      const own = await accountOfPerson(f.siteCoordinatorId);
      await refusedWith(
        admin,
        "vitally_deactivate_account",
        changeArgs(f.siteCoordinatorId, own.revision),
        VALIDATION,
        "SELF",
      );
      assert.equal((await accountOfPerson(f.siteCoordinatorId)).status, "active");
    });

    // Review Focus 3.
    await t.test("a stale revision is refused", async () => {
      const member = await f.staff({ key: "sal_stale", name: "Sal Corwin", capabilities: ["prepare"], cleared: false });
      const read = (await accountOfPerson(member.personId)).revision;
      await rpc(admin, "vitally_deactivate_account", changeArgs(member.personId, read));
      await refusedWith(admin, "vitally_deactivate_account", changeArgs(member.personId, read), CONFLICT);
      await refusedWith(admin, "vitally_reactivate_account", changeArgs(member.personId, read), CONFLICT);
      assert.equal((await accountOfPerson(member.personId)).status, "deactivated");
    });

    await t.test("reactivate after sign-in gives active", async () => {
      const volunteer = await invitedVolunteer();
      const { error } = await volunteer.client.auth.signInWithPassword({
        email: volunteer.email,
        password: volunteer.password,
      });
      assert.equal(error, null, "sign-in");
      assert.equal((await accountOfPerson(volunteer.personId)).status, "active");
      await deactivate(volunteer.personId);
      const read = (await accountOfPerson(volunteer.personId)).revision;
      const result = await rpc(admin, "vitally_reactivate_account", changeArgs(volunteer.personId, read));
      assert.equal(result.status, "active");
      assert.equal(result.accountRevision, read + 1);
      const account = await accountOfPerson(volunteer.personId);
      assert.equal(account.status, "active");
      assert.equal(account.deactivated_at, null);
      assert.deepEqual(await membershipOf(volunteer.userId), { access: "staff", active: true });
    });

    await t.test("reactivate without a sign-in gives invited", async () => {
      const volunteer = await invitedVolunteer();
      await deactivate(volunteer.personId);
      const read = (await accountOfPerson(volunteer.personId)).revision;
      const result = await rpc(admin, "vitally_reactivate_account", changeArgs(volunteer.personId, read));
      assert.equal(result.status, "invited");
      assert.equal((await accountOfPerson(volunteer.personId)).status, "invited");
      assert.deepEqual(await membershipOf(volunteer.userId), { access: "staff", active: true });
      // Reactivating an account that is not deactivated is refused.
      await refusedWith(
        admin,
        "vitally_reactivate_account",
        changeArgs(volunteer.personId, read + 1),
        INVALID_TRANSITION,
      );
    });

    await t.test("reactivate refused when active elsewhere", async () => {
      const member = await f.staff({ key: "eli_elsewhere", name: "Eli Strand", capabilities: ["prepare"], cleared: false });
      await deactivate(member.personId);
      // Meanwhile the same user becomes a client of another workspace of this run.
      const lead = await f.provision();
      await f.initializeOwned({
        workspaceId: randomUUID(),
        applicantUserIds: [member.userId],
        staff: [{ userId: lead.userId, personKey: "eli_lead", name: "Hana Ortiz", capabilities: ["admin", "followup"] }],
        defaultFollowup: "eli_lead",
      });
      const read = (await accountOfPerson(member.personId)).revision;
      await refusedWith(
        admin,
        "vitally_reactivate_account",
        changeArgs(member.personId, read),
        VALIDATION,
        "EMAIL_IN_USE",
      );
      assert.equal((await accountOfPerson(member.personId)).status, "deactivated");
      assert.deepEqual(await membershipOf(member.userId), { access: "staff", active: false });
    });

    await t.test("reactivate restores the account only", async () => {
      const member = await f.staff({ key: "ros_restore", name: "Ros Whitby", capabilities: ["prepare"], cleared: false });
      await deactivate(member.personId);
      const read = (await accountOfPerson(member.personId)).revision;
      assert.equal(
        (await rpc(admin, "vitally_reactivate_account", changeArgs(member.personId, read))).status,
        "active",
      );
      const { roles } = await one(
        f,
        `select r.roles from public.roster_entries r join public.workspaces w on w.id=r.workspace_id and w.current_season=r.season
          where r.workspace_id=$1 and r.person_id=$2`,
        [f.workspaceId, member.personId],
      );
      assert.deepEqual(roles, []);
      assert.equal(await clearedOf(f, member.personId), false, "still needs roles to be cleared");
    });

    await t.test("client invitations list", async () => {
      // A deactivated client account is left out of the list.
      const gone = await f.provision();
      await rpc(admin, "vitally_record_account", recordArgs("invite", { email: gone.email }, gone.userId));
      await f.sql("update public.memberships set active=false where workspace_id=$1 and user_id=$2", [
        f.workspaceId,
        gone.userId,
      ]);
      await f.sql(
        "update public.accounts set status='deactivated',deactivated_at=now() where workspace_id=$1 and user_id=$2",
        [f.workspaceId, gone.userId],
      );
      const client = await f.provision();
      await rpc(admin, "vitally_record_account", recordArgs("invite", { email: client.email }, client.userId));
      const list = await rpc(admin, "vitally_client_invitations");
      assert.ok(!list.some((entry) => entry.email === gone.email), "no deactivated client");
      assert.ok(list.every((entry) => entry.status !== "deactivated"), "no deactivated status");
      assert.ok(Array.isArray(list), "an array");
      for (const entry of list)
        assert.deepEqual(Object.keys(entry).sort(), ["accountRevision", "activatedAt", "email", "invitedAt", "status"]);
      assert.deepEqual(list[0], {
        email: client.email,
        status: "invited",
        invitedAt: list[0].invitedAt,
        activatedAt: null,
        accountRevision: 1,
      });
      assert.ok(list[0].invitedAt, "invitedAt");
      const emails = list.map((entry) => entry.email);
      assert.ok(emails.includes(f.applicantAEmail.toLowerCase()), "a roster-made client");
      assert.ok(!emails.includes(f.outsiderEmail.toLowerCase()), "no other workspace's client");
      assert.ok(!emails.includes(f.roleAccounts.preparer.email.toLowerCase()), "no staff");
      const times = list.map((entry) => Date.parse(entry.invitedAt ?? entry.activatedAt));
      for (let i = 1; i < times.length; i++) assert.ok(times[i - 1] >= times[i], "newest first");
      await refusedWith(f.preparer, "vitally_client_invitations", undefined, FORBIDDEN);
    });
  } finally {
    await f.close();
  }
});
