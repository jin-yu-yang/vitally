import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabaseFixture, applyArgs, rejected } from "./support/database-fixture.mjs";
import { openDatabase } from "../tools/admin/database.mjs";
import { SEED_VOLUNTEERS } from "../tools/admin/seed-values.mjs";
import { seedVolunteers } from "../tools/admin/seed-cases.mjs";
import { findRosterLink } from "../tools/admin/workspace-setup.mjs";

// OpenSpec change add-volunteer-roster-records (design D2-D6): the admin-only
// Roster records, the one RPC that writes them, the `people` policy that hides
// a volunteer with no sign-in, and the roster command's linking. Specs:
// volunteer-roster and sign-in. The file shares one fixture, and
// `add_staff_member` refuses changed values for an existing key, so every staff
// member below has a person key of their own.

const FORBIDDEN = "VT001";
const NOT_FOUND = "VT002";
const CONFLICT = "VT003";
const INELIGIBLE = "VT006";
const VALIDATION = "VT007";
const RPC = "vitally_save_volunteer";
const TABLES = ["volunteer_profiles", "roster_entries", "certificates"];
const ALL_CERTIFICATES = ["vsc", "itqr", "sc", "basic", "advanced"];

const volunteer = (extra = {}) => ({
  name: "Casey Morrow",
  email: `v-${randomUUID()}@example.org`,
  phone: null,
  works: "on_site",
  languages: ["english"],
  otherLanguage: null,
  roles: ["greeter"],
  certificates: ["vsc"],
  ...extra,
});
const addArgs = (entry = volunteer(), actionId = randomUUID()) => ({
  p_action_id: actionId,
  p_volunteer_id: null,
  p_expected_revision: null,
  p_volunteer: entry,
});
const editArgs = (personId, revision, entry) => ({
  p_action_id: randomUUID(),
  p_volunteer_id: personId,
  p_expected_revision: revision,
  p_volunteer: entry,
});
async function save(client, args) {
  const { data, error } = await client.rpc(RPC, args);
  assert.equal(error, null, `${RPC} failed: ${error?.code}`);
  return data;
}
async function refusedWith(client, args, code, label = RPC) {
  const { error } = await client.rpc(RPC, args);
  assert.equal(error?.code, code, label);
}
// One refused raw call: the SQLSTATE and no receipt behind it.
async function refuse(f, client, fn, args) {
  const { error } = await client.rpc(fn, args);
  assert.equal(error?.code, FORBIDDEN, `${fn} refused`);
  assert.equal(await f.receiptsFor(args.p_action_id), 0, `${fn} stored a receipt`);
}
const one = async (f, text, values) => (await f.sql(text, values)).rows[0];
const count = async (f, text, values) => Number((await one(f, text, values)).n);
const profileOf = (f, personId) =>
  one(f, "select * from public.volunteer_profiles where person_id=$1", [personId]);
const entryOf = (f, personId) =>
  one(f, "select * from public.roster_entries where person_id=$1", [personId]);
const personOf = (f, personId) =>
  one(f, "select * from public.people where id=$1", [personId]);
const revisionOf = async (f, personId) => Number((await profileOf(f, personId)).revision);
const certificatesOf = async (f, personId) =>
  (
    await f.sql(
      "select certificate,status,confirmed_at::text as confirmed_at,confirmed_by_person_id from public.certificates where person_id=$1 order by certificate",
      [personId],
    )
  ).rows;
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
// The helper's answer for one signed-in caller, in the role and with the JWT
// claims a real session has. The transaction is rolled back.
async function adminAnswer(f, userId, workspaceId) {
  await f.sql("begin");
  try {
    await f.sql("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    await f.sql("set local role authenticated");
    return (await one(f, "select vitally_policy.is_workspace_admin($1) as answer", [workspaceId]))
      .answer;
  } finally {
    await f.sql("rollback");
  }
}
const readable = async (client, table) => {
  const { data, error } = await client.from(table).select("*");
  assert.equal(error, null, `${table} read`);
  return data;
};
const peopleIds = async (client) => (await readable(client, "people")).map((row) => row.id);

test("volunteer roster records against real Supabase", async (t) => {
  const f = await createDatabaseFixture();
  try {
    const admin = f.siteCoordinator;
    const prep = await f.staff({ key: "pat_prepare", name: "Pat Ames", capabilities: ["prepare"] });
    const added = await save(admin, addArgs(volunteer({ certificates: ["vsc"] })));

    await t.test("an admin reads the three tables; a non-admin and a client read none", async () => {
      for (const table of TABLES) {
        assert.ok((await readable(admin, table)).length > 0, `admin ${table}`);
        assert.deepEqual(await readable(prep.client, table), [], `non-admin ${table}`);
        assert.deepEqual(await readable(f.applicantA, table), [], `client ${table}`);
      }
    });

    await t.test("another workspace's admin reads none", async () => {
      const other = await f.provision();
      const workspaceId = randomUUID();
      await f.initializeOwned({
        workspaceId,
        applicantUserIds: [],
        staff: [
          {
            userId: other.userId,
            personKey: "other_lead",
            name: "Noor Haddad",
            capabilities: ["admin", "followup"],
          },
        ],
        defaultFollowup: "other_lead",
      });
      // The positive control: this admin does read their own workspace's rows.
      assert.ok((await readable(other.client, "volunteer_profiles")).length > 0);
      for (const table of TABLES)
        assert.deepEqual(
          (await readable(other.client, table)).filter((row) => row.workspace_id === f.workspaceId),
          [],
          table,
        );
    });

    await t.test("direct writes are refused", async () => {
      const row = { workspace_id: f.workspaceId, person_id: added.personId };
      for (const table of TABLES) {
        const inserted = await admin.from(table).insert(row);
        assert.ok(inserted.error, `${table} insert`);
        const updated = await admin
          .from(table)
          .update({ workspace_id: f.workspaceId })
          .eq("person_id", added.personId);
        assert.ok(updated.error, `${table} update`);
        const deleted = await admin.from(table).delete().eq("person_id", added.personId);
        assert.ok(deleted.error, `${table} delete`);
      }
      assert.ok(await profileOf(f, added.personId), "the profile is still there");
      assert.equal((await certificatesOf(f, added.personId)).length, 1);
    });

    await t.test("the helper answers only for the caller", async () => {
      assert.equal(await adminAnswer(f, f.siteCoordinatorUserId, f.workspaceId), true);
      assert.equal(await adminAnswer(f, prep.userId, f.workspaceId), false);
      assert.equal(await adminAnswer(f, f.applicantAUserId, f.workspaceId), false);
      assert.equal(await adminAnswer(f, f.siteCoordinatorUserId, f.foreignWorkspaceId), false);
    });

    await t.test("table privileges are select-only", async () => {
      const privileges = (role, table) =>
        one(
          f,
          "select has_table_privilege($1,$2,'SELECT') as sel,has_table_privilege($1,$2,'INSERT') as can_insert,has_table_privilege($1,$2,'UPDATE') as can_update,has_table_privilege($1,$2,'DELETE') as can_delete",
          [role, `public.${table}`],
        );
      for (const table of TABLES) {
        assert.deepEqual(
          await privileges("authenticated", table),
          { sel: true, can_insert: false, can_update: false, can_delete: false },
          table,
        );
        for (const role of ["anon", "service_role"])
          assert.deepEqual(
            await privileges(role, table),
            { sel: false, can_insert: false, can_update: false, can_delete: false },
            `${role} ${table}`,
          );
      }
    });

    await t.test("a malformed call from a non-admin is forbidden", async () => {
      const malformed = { ...addArgs(), p_action_id: null };
      await refusedWith(prep.client, malformed, FORBIDDEN, "non-admin");
      await refusedWith(f.applicantA, malformed, FORBIDDEN, "client");
    });

    await t.test("people: a non-admin cannot read a volunteer with no sign-in", async () => {
      const { personId } = await save(admin, addArgs());
      const seen = await peopleIds(prep.client);
      assert.equal(seen.includes(personId), false, "non-admin");
      assert.equal((await peopleIds(admin)).includes(personId), true, "admin");
      const { rows } = await f.sql(
        "select id from public.people where workspace_id=$1 and user_id is not null",
        [f.workspaceId],
      );
      assert.ok(rows.length > 0);
      for (const row of rows) assert.ok(seen.includes(row.id), "everyone with a sign-in");
    });

    await t.test("people: an unlinked person with capabilities stays visible", async () => {
      const { id } = await one(
        f,
        "insert into public.people(workspace_id,person_key,name,capabilities) values($1,'kept_persona','Sam Okafor',array['assist']) returning id",
        [f.workspaceId],
      );
      assert.equal((await peopleIds(prep.client)).includes(id), true);
    });

    await t.test("add creates a person with no account or capabilities", async () => {
      const memberships = () =>
        count(f, "select count(*) n from public.memberships where workspace_id=$1", [f.workspaceId]);
      const before = await memberships();
      const entry = volunteer({
        name: "  Devon Marsh ",
        phone: " 412-555-0100 ",
        works: "remote",
        languages: ["mandarin", "other"],
        otherLanguage: " Hakka ",
        roles: ["preparer", "reviewer"],
        certificates: ["vsc", "itqr", "basic"],
      });
      const result = await save(admin, addArgs(entry));
      assert.deepEqual(Object.keys(result).sort(), ["actionId", "personId", "revision"]);
      assert.equal(result.revision, 1);
      const person = await personOf(f, result.personId);
      assert.equal(person.user_id, null);
      assert.deepEqual(person.capabilities, []);
      assert.equal(person.name, "Devon Marsh");
      assert.match(person.person_key, /^v_[0-9a-f]{12}$/);
      const profile = await profileOf(f, result.personId);
      assert.equal(profile.email, entry.email);
      assert.equal(profile.phone, "412-555-0100");
      assert.equal(profile.works, "remote");
      assert.deepEqual(profile.languages, ["mandarin", "other"]);
      assert.equal(profile.other_language, "Hakka");
      assert.equal(
        await count(f, "select count(*) n from public.volunteer_profiles where person_id=$1", [result.personId]),
        1,
      );
      const roster = await entryOf(f, result.personId);
      assert.equal(roster.added_by_person_id, f.siteCoordinatorId);
      assert.deepEqual(roster.roles, ["preparer", "reviewer"]);
      const { current_season } = await one(f, "select current_season from public.workspaces where id=$1", [f.workspaceId]);
      assert.equal(roster.season, current_season);
      const certificates = await certificatesOf(f, result.personId);
      assert.deepEqual(certificates.map((row) => row.certificate), ["basic", "itqr", "vsc"]);
      for (const row of certificates) {
        assert.equal(row.status, "confirmed");
        assert.ok(row.confirmed_at);
        assert.equal(row.confirmed_by_person_id, f.siteCoordinatorId);
      }
      assert.equal(await memberships(), before);
    });

    await t.test("a replay returns the stored result", async () => {
      const entry = volunteer();
      const args = addArgs(entry);
      const first = await save(admin, args);
      const second = await save(admin, args);
      assert.deepEqual(second, first);
      assert.equal(
        await count(f, "select count(*) n from public.volunteer_profiles where workspace_id=$1 and email=$2", [
          f.workspaceId,
          entry.email,
        ]),
        1,
      );
    });

    await t.test("email is stored trimmed and lower-case, unique ignoring case", async () => {
      const { personId } = await save(admin, addArgs(volunteer({ email: "  Ana@Example.ORG " })));
      assert.equal((await profileOf(f, personId)).email, "ana@example.org");
      await refusedWith(admin, addArgs(volunteer({ email: "ANA@example.org" })), VALIDATION);
    });

    await t.test("edit replaces values and bumps the revision", async () => {
      const { personId } = await save(admin, addArgs());
      assert.equal(await revisionOf(f, personId), 1);
      const email = `edited-${randomUUID()}@example.org`;
      const result = await save(
        admin,
        editArgs(
          personId,
          1,
          volunteer({ name: "Casey Lund", email, phone: "412-555-0199", works: "on_site_and_remote", roles: ["intaker"], certificates: ["vsc", "itqr"] }),
        ),
      );
      assert.equal(result.revision, 2);
      assert.equal(result.personId, personId);
      assert.equal(await revisionOf(f, personId), 2);
      assert.equal((await personOf(f, personId)).name, "Casey Lund");
      const profile = await profileOf(f, personId);
      assert.equal(profile.email, email);
      assert.equal(profile.phone, "412-555-0199");
      assert.equal(profile.works, "on_site_and_remote");
      assert.deepEqual((await entryOf(f, personId)).roles, ["intaker"]);
    });

    await t.test("a ticked certificate keeps its date; an unticked one is deleted", async () => {
      const email = `cert-${randomUUID()}@example.org`;
      const { personId } = await save(admin, addArgs(volunteer({ email, certificates: ["vsc"] })));
      const [original] = await certificatesOf(f, personId);
      await save(admin, editArgs(personId, 1, volunteer({ email, certificates: ["vsc", "basic"] })));
      const both = await certificatesOf(f, personId);
      assert.deepEqual(both.map((row) => row.certificate), ["basic", "vsc"]);
      assert.deepEqual(both[1], original);
      await save(admin, editArgs(personId, 2, volunteer({ email, certificates: ["vsc"] })));
      assert.deepEqual(await certificatesOf(f, personId), [original]);
    });

    await t.test("a stale revision is a conflict", async () => {
      const email = `stale-${randomUUID()}@example.org`;
      const { personId } = await save(admin, addArgs(volunteer({ email })));
      await save(admin, editArgs(personId, 1, volunteer({ email, name: "First Save" })));
      await refusedWith(admin, editArgs(personId, 1, volunteer({ email, name: "Second Save" })), CONFLICT);
      assert.equal((await personOf(f, personId)).name, "First Save");
      assert.equal(await revisionOf(f, personId), 2);
    });

    await t.test("a locked email is refused", async () => {
      const member = await f.staff({ key: "lee_locked", name: "Lee Tran", capabilities: ["prepare"] });
      const revision = await revisionOf(f, member.personId);
      await refusedWith(
        admin,
        editArgs(member.personId, revision, volunteer({ email: `other-${randomUUID()}@example.org` })),
        VALIDATION,
      );
      assert.equal((await profileOf(f, member.personId)).email, member.email);
      await save(admin, editArgs(member.personId, revision, volunteer({ email: member.email.toUpperCase() })));
      assert.equal((await profileOf(f, member.personId)).email, member.email);
    });

    await t.test("validation refuses bad payloads", async () => {
      const people = () =>
        count(f, "select count(*) n from public.people where workspace_id=$1", [f.workspaceId]);
      const before = await people();
      const { certificates, ...missingKey } = volunteer();
      for (const [label, entry] of [
        ["an extra key", volunteer({ gender: "x" })],
        ["a missing key", missingKey],
        ["no roles", volunteer({ roles: [] })],
        ["an unknown role", volunteer({ roles: ["driver"] })],
        ["an unknown certificate", volunteer({ certificates: ["cpa"] })],
        ["an unknown works", volunteer({ works: "sometimes" })],
        ["other with no name", volunteer({ languages: ["other"], otherLanguage: null })],
        ["other with a blank name", volunteer({ languages: ["other"], otherLanguage: "   " })],
        ["a named language without other", volunteer({ otherLanguage: "Hakka" })],
        ["an unknown language", volunteer({ languages: ["klingon"] })],
        ["a repeated role", volunteer({ roles: ["greeter", "greeter"] })],
        ["a blank name", volunteer({ name: "   " })],
        ["an 81-character name", volunteer({ name: "x".repeat(81) })],
        ["a 31-character phone", volunteer({ phone: "1".repeat(31) })],
        ["a 41-character language", volunteer({ languages: ["other"], otherLanguage: "x".repeat(41) })],
        ["an invalid email", volunteer({ email: "no at sign" })],
        ["a number for a name", volunteer({ name: 7 })],
        ["a role that is not text", volunteer({ roles: [7] })],
        ["roles that are not a list", volunteer({ roles: "greeter" })],
      ])
        await refusedWith(admin, addArgs(entry), VALIDATION, label);
      for (const args of [
        { ...addArgs(), p_action_id: null },
        { ...addArgs(), p_volunteer: null },
        { ...addArgs(), p_expected_revision: 1 },
        { ...addArgs(), p_volunteer_id: randomUUID() },
      ])
        await refusedWith(admin, args, VALIDATION, "the envelope");
      assert.equal(await people(), before);
    });

    await t.test("a non-admin and a client are refused with no receipt", async () => {
      await refuse(f, prep.client, RPC, addArgs());
      await refuse(f, f.applicantA, RPC, addArgs());
      await refuse(f, prep.client, RPC, editArgs(added.personId, 1, volunteer()));
    });

    await t.test("an unknown id or another workspace's id is not found", async () => {
      await refusedWith(admin, editArgs(randomUUID(), 1, volunteer()), NOT_FOUND, "unknown");
      const foreign = await save(f.foreignStaff, addArgs());
      await refusedWith(admin, editArgs(foreign.personId, 1, volunteer()), NOT_FOUND, "foreign");
      assert.equal(await revisionOf(f, foreign.personId), 1);
    });

    await t.test("roles grant nothing", async () => {
      const member = await f.staff({ key: "gale_record", name: "Gale Ito", capabilities: ["prepare"] });
      const { email } = member;
      await save(
        admin,
        editArgs(
          member.personId,
          await revisionOf(f, member.personId),
          volunteer({ email, roles: ["reviewer"], certificates: ALL_CERTIFICATES }),
        ),
      );
      assert.deepEqual((await personOf(f, member.personId)).capabilities, ["prepare"]);
      const caseId = await f.preparedCase();
      const { revision } = await one(f, "select revision from public.cases where id=$1", [caseId]);
      // Without `review` the claim is INELIGIBLE (006's claim check).
      const args = applyArgs({ caseId, revision: Number(revision), type: "CLAIM_REVIEW" });
      const { error } = await member.client.rpc("vitally_apply_action", args);
      assert.equal(error?.code, INELIGIBLE);
      assert.equal(await f.receiptsFor(args.p_action_id), 0);
      assert.equal((await one(f, "select reviewer_id from public.cases where id=$1", [caseId])).reviewer_id, null);
    });

    await t.test("unticking certificates leaves preparation claimable", async () => {
      const member = await f.staff({ key: "ira_untick", name: "Ira Kohl", capabilities: ["prepare"] });
      const { email } = member;
      let revision = await revisionOf(f, member.personId);
      await save(admin, editArgs(member.personId, revision, volunteer({ email, certificates: ALL_CERTIFICATES })));
      revision += 1;
      // Greeter needs VSC (045), so VSC is the one certificate left.
      await save(admin, editArgs(member.personId, revision, volunteer({ email, certificates: ["vsc"] })));
      assert.deepEqual((await certificatesOf(f, member.personId)).map((row) => row.certificate), ["vsc"]);
      const caseId = await f.readyCase();
      await f.act(member.client, caseId, "CLAIM_PREPARATION", {});
    });

    await t.test("the roster links a matching volunteer", async () => {
      const account = await f.provision();
      const { personId } = await save(
        admin,
        addArgs(volunteer({ name: "Riley Park", email: account.email.toUpperCase(), roles: ["preparer"], certificates: ["vsc", "itqr", "basic"] })),
      );
      await addStaffMember(f, account.userId, "riley_link", "R. Park", ["prepare"]);
      const { rows } = await f.sql("select * from public.people where workspace_id=$1 and user_id=$2", [
        f.workspaceId,
        account.userId,
      ]);
      assert.equal(rows.length, 1, "one person");
      assert.equal(rows[0].id, personId);
      assert.equal(rows[0].person_key, "riley_link");
      assert.deepEqual(rows[0].capabilities, ["prepare"]);
      assert.equal(rows[0].name, "Riley Park");
      assert.deepEqual((await entryOf(f, personId)).roles, ["preparer"]);
      assert.deepEqual((await certificatesOf(f, personId)).map((row) => row.certificate), ["basic", "itqr", "vsc"]);
      assert.equal(await revisionOf(f, personId), 2);
      assert.deepEqual(await f.readMembership(account.userId), [
        { workspace_id: f.workspaceId, user_id: account.userId, access: "staff", active: true },
      ]);
    });

    await t.test("a new staff member gets records", async () => {
      const member = await f.staff({ key: "nia_new", name: "Nia Cole", capabilities: ["review"], cleared: false });
      const profile = await profileOf(f, member.personId);
      assert.equal(profile.email, member.email);
      assert.equal(profile.works, "on_site");
      assert.equal(Number(profile.revision), 1);
      assert.deepEqual((await entryOf(f, member.personId)).roles, []);
    });

    await t.test("a re-run ignores a changed name", async () => {
      const member = await f.staff({ key: "oren_rerun", name: "Oren Shah", capabilities: ["prepare"] });
      const { rows } = await addStaffMember(f, member.userId, "oren_rerun", "Someone Else", ["prepare"]);
      assert.equal(rows[0].person_id, member.personId);
      assert.equal((await personOf(f, member.personId)).name, "Oren Shah");
    });

    await t.test("a re-run with changed capabilities is still refused", async () => {
      const member = await f.staff({ key: "tess_rerun", name: "Tess Boyd", capabilities: ["prepare"] });
      await assert.rejects(
        () => addStaffMember(f, member.userId, "tess_rerun", "Tess Boyd", ["prepare", "review"]),
        rejected("VALIDATION"),
      );
      assert.deepEqual((await personOf(f, member.personId)).capabilities, ["prepare"]);
    });

    await t.test("findRosterLink finds only a no-sign-in match", async () => {
      const account = await f.provision();
      await save(admin, addArgs(volunteer({ name: "Uma Reid", email: account.email })));
      assert.deepEqual(await findRosterLink(f.sql, f.workspaceId, account.userId), { name: "Uma Reid" });
      await addStaffMember(f, account.userId, "uma_link", "Uma Reid", ["assist"]);
      assert.equal(await findRosterLink(f.sql, f.workspaceId, account.userId), null);
      const stranger = await f.provision();
      assert.equal(await findRosterLink(f.sql, f.workspaceId, stranger.userId), null);
    });

    await t.test("seedVolunteers twice leaves exactly the rehearsal volunteers", async () => {
      const emails = SEED_VOLUNTEERS.map((v) => v.email);
      const staffQuery =
        "select id,name,capabilities,user_id from public.people where workspace_id=$1 and user_id is not null order by id";
      const staffBefore = await f.sql(staffQuery, [f.workspaceId]);
      const db = await openDatabase({ kind: "test" });
      try {
        const args = { workspaceId: f.workspaceId, actorUserId: f.siteCoordinatorUserId };
        assert.equal(await seedVolunteers(db, args), 8);
        assert.equal(await seedVolunteers(db, args), 8);
      } finally {
        await db.end();
      }
      assert.equal(
        await count(
          f,
          "select count(*) n from public.people p join public.volunteer_profiles v on v.person_id=p.id where p.workspace_id=$1 and v.email=any($2)",
          [f.workspaceId, emails],
        ),
        8,
      );
      const staffAfter = await f.sql(staffQuery, [f.workspaceId]);
      assert.deepEqual(staffAfter.rows, staffBefore.rows);
    });
  } finally {
    await f.close();
  }
});
