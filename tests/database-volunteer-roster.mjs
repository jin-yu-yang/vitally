import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabaseFixture, applyArgs, assistanceArgs, rejected } from "./support/database-fixture.mjs";
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
const INVALID_TRANSITION = "VT004";
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
  isNew: false,
  photoIdChecked: false,
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
async function callerAnswer(f, userId, text, values) {
  await f.sql("begin");
  try {
    await f.sql("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    await f.sql("set local role authenticated");
    return (await one(f, `select ${text} as answer`, values)).answer;
  } finally {
    await f.sql("rollback");
  }
}
const adminAnswer = (f, userId, workspaceId) =>
  callerAnswer(f, userId, "vitally_policy.is_workspace_admin($1)", [workspaceId]);
// 045: the clearance helper takes no argument and answers for the caller.
const clearedAnswer = (f, userId) => callerAnswer(f, userId, "vitally_policy.cleared_workspace_id()", []);
const readable = async (client, table) => {
  const { data, error } = await client.from(table).select("*");
  assert.equal(error, null, `${table} read`);
  return data;
};
const peopleIds = async (client) => (await readable(client, "people")).map((row) => row.id);
// 045: an edit of an existing person at their current revision and email.
const editOf = async (f, personId, extra) =>
  editArgs(
    personId,
    await revisionOf(f, personId),
    volunteer({ email: (await profileOf(f, personId)).email, ...extra }),
  );
const clearedOf = async (f, personId) =>
  (await one(f, "select vitally_private.cleared($1,$2) as cleared", [f.workspaceId, personId])).cleared;
const rolesOf = async (f, personId) => (await entryOf(f, personId)).roles;
// The client number a case shows in the open-work labels.
const clientOf = async (f, caseId) =>
  (await one(f, "select coalesce(client_number::text,reference) as n from public.cases where id=$1", [caseId])).n;
// The open-work refusal: INVALID_TRANSITION with OPEN_WORK, no receipt, and
// the work as a JSON array of labels in the detail.
async function refusedForOpenWork(f, client, args) {
  const { error } = await client.rpc(RPC, args);
  assert.equal(error?.code, INVALID_TRANSITION, `${error?.code} ${error?.message}`);
  assert.equal(error.message, "OPEN_WORK");
  assert.equal(await f.receiptsFor(args.p_action_id), 0);
  const work = JSON.parse(error.details);
  assert.ok(Array.isArray(work), "the detail is a JSON array");
  return work;
}

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

    await t.test("an uncleared admin is still an admin", async () => {
      const lead = await f.staff({
        key: "una_uncleared_admin",
        name: "Una Ferris",
        capabilities: ["admin", "followup"],
        cleared: false,
      });
      assert.equal(await adminAnswer(f, lead.userId, f.workspaceId), true);
      assert.equal(await clearedAnswer(f, lead.userId), null);
      // The positive control: a cleared admin's answer is their workspace.
      assert.equal(await clearedAnswer(f, f.siteCoordinatorUserId), f.workspaceId);
      assert.equal(await clearedAnswer(f, f.applicantAUserId), null);
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

    // 045 (design D14): an uploaded certificate is the volunteer's own upload
    // awaiting an admin. A save leaves it alone unless it is ticked.
    const addWithUploadedVsc = async (label) => {
      const email = `${label}-${randomUUID()}@example.org`;
      const { personId } = await save(admin, addArgs(volunteer({ email, roles: [], certificates: [] })));
      await f.sql(
        "insert into public.certificates(workspace_id,person_id,season,certificate,status) select workspace_id,person_id,season,'vsc','uploaded' from public.roster_entries where person_id=$1",
        [personId],
      );
      return { personId, email };
    };

    await t.test("an uploaded certificate survives a save that doesn't send it", async () => {
      const { personId, email } = await addWithUploadedVsc("upl-keep");
      const before = await certificatesOf(f, personId);
      assert.equal(before.length, 1);
      assert.equal(before[0].status, "uploaded");
      await save(admin, editArgs(personId, 1, volunteer({ email, name: "Casey Renamed", roles: [], certificates: [] })));
      assert.deepEqual(await certificatesOf(f, personId), before);
    });

    await t.test("ticking an uploaded certificate confirms it", async () => {
      const { personId, email } = await addWithUploadedVsc("upl-confirm");
      await save(admin, editArgs(personId, 1, volunteer({ email, roles: ["greeter"], certificates: ["vsc"] })));
      const [row] = await certificatesOf(f, personId);
      assert.equal(row.certificate, "vsc");
      assert.equal(row.status, "confirmed");
      assert.equal(row.confirmed_by_person_id, f.siteCoordinatorId);
      assert.ok(row.confirmed_at, "confirmed_at is set");
      const age = await count(
        f,
        "select extract(epoch from now()-confirmed_at)::int as n from public.certificates where person_id=$1",
        [personId],
      );
      assert.ok(age >= 0 && age < 300, `confirmed just now (${age}s)`);
      assert.deepEqual(await rolesOf(f, personId), ["greeter"]);
    });

    await t.test("a confirmed certificate that stays ticked keeps its confirmer and date", async () => {
      const email = `keep-conf-${randomUUID()}@example.org`;
      const { personId } = await save(admin, addArgs(volunteer({ email, certificates: ["vsc"] })));
      const before = await certificatesOf(f, personId);
      await save(admin, editArgs(personId, 1, volunteer({ email, name: "Casey Again", certificates: ["vsc"] })));
      assert.deepEqual(await certificatesOf(f, personId), before);
      assert.equal(before[0].confirmed_by_person_id, f.siteCoordinatorId);
    });

    await t.test("unticking a confirmed certificate deletes it, an uploaded one beside it stays", async () => {
      const email = `del-conf-${randomUUID()}@example.org`;
      const { personId } = await save(admin, addArgs(volunteer({ email, roles: [], certificates: ["vsc", "basic"] })));
      await f.sql(
        "insert into public.certificates(workspace_id,person_id,season,certificate,status) select workspace_id,person_id,season,'itqr','uploaded' from public.roster_entries where person_id=$1",
        [personId],
      );
      await save(admin, editArgs(personId, 1, volunteer({ email, roles: [], certificates: ["vsc"] })));
      assert.deepEqual(
        (await certificatesOf(f, personId)).map((row) => [row.certificate, row.status]),
        [["itqr", "uploaded"], ["vsc", "confirmed"]],
      );
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
      const { isNew, ...noIsNew } = volunteer();
      const { photoIdChecked, ...noPhotoIdChecked } = volunteer();
      for (const [label, entry] of [
        ["an extra key", volunteer({ gender: "x" })],
        ["a missing key", missingKey],
        ["no isNew", noIsNew],
        ["no photoIdChecked", noPhotoIdChecked],
        ["an isNew that is not a boolean", volunteer({ isNew: "true" })],
        ["a null photoIdChecked", volunteer({ photoIdChecked: null })],
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

    // 045: was "roles grant nothing" (044's "Roles and certificates grant
    // nothing"). The save still never changes people.capabilities, and a role
    // grants nothing beyond that ceiling: Reviewer within a `prepare` ceiling
    // gives only `prepare`.
    await t.test("a recorded role grants nothing beyond the ceiling", async () => {
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

    // 045: a staff member acts with their roles' capabilities, so the
    // Preparer role stays, with the certificates it needs (VSC, IT&QR, Basic).
    await t.test("unticking certificates the roles don't need leaves preparation claimable", async () => {
      const member = await f.staff({ key: "ira_untick", name: "Ira Kohl", capabilities: ["prepare"] });
      const { email } = member;
      let revision = await revisionOf(f, member.personId);
      await save(
        admin,
        editArgs(member.personId, revision, volunteer({ email, roles: ["preparer"], certificates: ALL_CERTIFICATES })),
      );
      revision += 1;
      await save(
        admin,
        editArgs(member.personId, revision, volunteer({ email, roles: ["preparer"], certificates: ["vsc", "itqr", "basic"] })),
      );
      assert.deepEqual(
        (await certificatesOf(f, member.personId)).map((row) => row.certificate),
        ["basic", "itqr", "vsc"],
      );
      const caseId = await f.readyCase();
      await f.act(member.client, caseId, "CLAIM_PREPARATION", {});
    });

    await t.test("a save may have no roles", async () => {
      const { personId } = await save(admin, addArgs(volunteer({ roles: [], certificates: [] })));
      assert.deepEqual(await rolesOf(f, personId), []);
      assert.deepEqual(await certificatesOf(f, personId), []);
      assert.equal(await clearedOf(f, personId), false);
    });

    await t.test("a role without its certificates is refused", async () => {
      const entry = volunteer({ roles: ["preparer"], certificates: ["vsc"] });
      const args = addArgs(entry);
      const { error } = await admin.rpc(RPC, args);
      assert.equal(error?.code, VALIDATION);
      assert.equal(error.message, "ROLE_NEEDS");
      assert.equal(error.details, "preparer: IT&QR, Basic or Advanced");
      assert.equal(await f.receiptsFor(args.p_action_id), 0);
      assert.equal(
        await count(f, "select count(*) n from public.volunteer_profiles where email=$1", [entry.email]),
        0,
        "nothing is saved",
      );
    });

    // Review Focus 2: a role newly added in an edit, without its certificates.
    await t.test("a role added in an edit without its certificates is refused", async () => {
      const { personId } = await save(admin, addArgs());
      const { error } = await admin.rpc(RPC, await editOf(f, personId, { roles: ["greeter", "intaker"] }));
      assert.equal(error?.code, VALIDATION);
      assert.equal(error.details, "intaker: IT&QR");
      assert.deepEqual(await rolesOf(f, personId), ["greeter"]);
      assert.equal(await revisionOf(f, personId), 1);
    });

    // Review Focus 2, and 044's "Removing every certificate" scenario in its
    // 045 form: the roles that need an unticked certificate go with it.
    await t.test("unticking a certificate drops the roles that need it", async () => {
      const member = await f.staff({ key: "uma_untick_basic", name: "Uma Lowry", capabilities: ["prepare"] });
      await save(
        admin,
        await editOf(f, member.personId, { roles: ["greeter", "preparer"], certificates: ["vsc", "itqr", "basic"] }),
      );
      await save(
        admin,
        await editOf(f, member.personId, { roles: ["greeter", "preparer"], certificates: ["vsc", "itqr"] }),
      );
      assert.deepEqual(await rolesOf(f, member.personId), ["greeter"]);
      assert.deepEqual((await certificatesOf(f, member.personId)).map((row) => row.certificate), ["itqr", "vsc"]);
      assert.equal(await clearedOf(f, member.personId), true);
      const caseId = await f.readyCase();
      await assert.rejects(
        () => f.act(member.client, caseId, "CLAIM_PREPARATION", {}),
        rejected("INELIGIBLE"),
      );
    });

    // 047 (add-account-invitations, design D6): this volunteer has no sign-in
    // and so no account, and is never cleared. The test below is its
    // counterpart with an active account.
    await t.test("photo ID check is kept while ticked", async () => {
      const email = `photo-${randomUUID()}@example.org`;
      const { personId } = await save(admin, addArgs(volunteer({ email, isNew: true })));
      const entry = await entryOf(f, personId);
      assert.equal(entry.is_new, true);
      assert.equal(entry.photo_id_checked_at, null);
      assert.equal(await clearedOf(f, personId), false, "new without a photo ID check");
      await save(admin, editArgs(personId, 1, volunteer({ email, isNew: true, photoIdChecked: true })));
      const checkedAtOf = async () =>
        (await one(f, "select photo_id_checked_at::text as at from public.roster_entries where person_id=$1", [personId])).at;
      const checkedAt = await checkedAtOf();
      assert.ok(checkedAt, "the check time is stored");
      assert.equal(await clearedOf(f, personId), false, "no account");
      await save(admin, editArgs(personId, 2, volunteer({ email, name: "Casey Vale", isNew: true, photoIdChecked: true })));
      assert.equal(await checkedAtOf(), checkedAt, "kept while ticked");
      await save(admin, editArgs(personId, 3, volunteer({ email, isNew: true, photoIdChecked: false })));
      assert.equal(await checkedAtOf(), null, "unticked");
      assert.equal(await clearedOf(f, personId), false);
      await save(admin, editArgs(personId, 4, volunteer({ email, isNew: false, photoIdChecked: false })));
      assert.equal((await entryOf(f, personId)).is_new, false);
      assert.equal(await clearedOf(f, personId), false, "not new, but no account");
    });

    await t.test("photo ID check clears a volunteer with an active account", async () => {
      const member = await f.staff({ key: "pia_photo", name: "Pia Lund", capabilities: [], cleared: false });
      await save(admin, await editOf(f, member.personId, { isNew: true }));
      assert.equal(await clearedOf(f, member.personId), false, "new without a photo ID check");
      await save(admin, await editOf(f, member.personId, { isNew: true, photoIdChecked: true }));
      assert.equal(await clearedOf(f, member.personId), true);
      await save(admin, await editOf(f, member.personId, { isNew: true, photoIdChecked: false }));
      assert.equal(await clearedOf(f, member.personId), false);
      await save(admin, await editOf(f, member.personId, { isNew: false, photoIdChecked: false }));
      assert.equal(await clearedOf(f, member.personId), true, "not new");
    });

    await t.test("an uncleared admin saves their own Admin role", async () => {
      const lead = await f.staff({
        key: "abe_own_admin",
        name: "Abe Coulter",
        capabilities: ["admin", "followup"],
        cleared: false,
      });
      await save(
        lead.client,
        await editOf(f, lead.personId, { name: "Abe Coulter", roles: ["admin"], certificates: ["vsc", "itqr"] }),
      );
      assert.deepEqual(await rolesOf(f, lead.personId), ["admin"]);
      const { data, error } = await lead.client.rpc("vitally_my_clearance");
      assert.equal(error, null);
      assert.equal(data.cleared, true);
    });

    // The open-work rule (spec "A save cannot take away what a person's open
    // work needs"). Every refusal changes nothing.
    await t.test("open work: removing Preparer while preparing is refused", async () => {
      const prep = await f.staff({ key: "pru_open_prepare", name: "Pru Halden", capabilities: ["prepare"] });
      const caseId = await f.readyCase();
      await f.act(prep.client, caseId, "CLAIM_PREPARATION", {});
      const revision = await revisionOf(f, prep.personId);
      const work = await refusedForOpenWork(
        f,
        admin,
        await editOf(f, prep.personId, { roles: ["greeter"], certificates: ["vsc", "itqr", "basic"] }),
      );
      assert.deepEqual(work, [`preparing client ${await clientOf(f, caseId)}`]);
      assert.deepEqual(await rolesOf(f, prep.personId), ["preparer"]);
      assert.equal(await revisionOf(f, prep.personId), revision);
    });

    await t.test("open work: unticking IT&QR for the default follow-up person is refused", async () => {
      const coordinatorId = f.siteCoordinatorId;
      const { default_followup_person_id } = await one(
        f,
        "select default_followup_person_id from public.workspaces where id=$1",
        [f.workspaceId],
      );
      assert.equal(default_followup_person_id, coordinatorId);
      const before = await certificatesOf(f, coordinatorId);
      const work = await refusedForOpenWork(
        f,
        admin,
        await editOf(f, coordinatorId, {
          name: (await personOf(f, coordinatorId)).name,
          roles: ["admin"],
          certificates: ["vsc"],
        }),
      );
      assert.ok(work.includes("default follow-up person"), JSON.stringify(work));
      assert.deepEqual(await rolesOf(f, coordinatorId), ["admin"]);
      assert.deepEqual(await certificatesOf(f, coordinatorId), before);
    });

    await t.test("open work: removing Greeter while preparing is allowed", async () => {
      const prep = await f.staff({ key: "gwen_open_greeter", name: "Gwen Ostrander", capabilities: ["prepare"] });
      const certificates = ["vsc", "itqr", "basic"];
      await save(admin, await editOf(f, prep.personId, { roles: ["greeter", "preparer"], certificates }));
      const caseId = await f.readyCase();
      await f.act(prep.client, caseId, "CLAIM_PREPARATION", {});
      await save(admin, await editOf(f, prep.personId, { roles: ["preparer"], certificates }));
      assert.deepEqual(await rolesOf(f, prep.personId), ["preparer"]);
    });

    await t.test("open work: unticking Advanced while Basic covers is allowed", async () => {
      const prep = await f.staff({ key: "ada_open_advanced", name: "Ada Brennan", capabilities: ["prepare"] });
      await save(
        admin,
        await editOf(f, prep.personId, { roles: ["preparer"], certificates: ["vsc", "itqr", "basic", "advanced"] }),
      );
      const caseId = await f.readyCase();
      await f.act(prep.client, caseId, "CLAIM_PREPARATION", {});
      await save(admin, await editOf(f, prep.personId, { roles: ["preparer"], certificates: ["vsc", "itqr", "basic"] }));
      assert.deepEqual(await rolesOf(f, prep.personId), ["preparer"]);
      assert.deepEqual((await certificatesOf(f, prep.personId)).map((row) => row.certificate), ["basic", "itqr", "vsc"]);
    });

    await t.test("open work: none, and every role removed, is allowed and uncleared", async () => {
      const member = await f.staff({ key: "nico_no_work", name: "Nico Varga", capabilities: ["prepare"] });
      await save(admin, await editOf(f, member.personId, { roles: [], certificates: [] }));
      assert.deepEqual(await rolesOf(f, member.personId), []);
      assert.equal(await clearedOf(f, member.personId), false);
    });

    // Design D7: only what the save takes away counts. A person whose ceiling
    // lets them be the default follow-up person while their only role is
    // Preparer lacks `followup` already, and stays saveable.
    await t.test("open work: a capability already lacking doesn't block an unrelated save", async () => {
      const member = await f.staff({
        key: "fay_lacking_followup",
        name: "Fay Ormond",
        capabilities: ["prepare", "admin", "followup"],
        cleared: false,
      });
      await f.clearStaff(member.personId, ["prepare"]);
      assert.deepEqual(await rolesOf(f, member.personId), ["preparer"]);
      await f.sql("update public.workspaces set default_followup_person_id=$2 where id=$1", [
        f.workspaceId,
        member.personId,
      ]);
      try {
        const work = (
          await f.sql("select needs,label from vitally_private.open_work($1,$2)", [f.workspaceId, member.personId])
        ).rows;
        assert.deepEqual(work, [{ needs: "followup", label: "default follow-up person" }]);
        const certificates = ["vsc", "itqr", "basic"];
        await save(
          admin,
          await editOf(f, member.personId, { name: "Fay Ormond", phone: "412-555-0177", roles: ["preparer"], certificates }),
        );
        assert.equal((await profileOf(f, member.personId)).phone, "412-555-0177");
        await save(
          admin,
          await editOf(f, member.personId, { name: "Fay Ormond", roles: ["preparer"], certificates: [...certificates, "sc"] }),
        );
        assert.deepEqual(
          (await certificatesOf(f, member.personId)).map((row) => row.certificate),
          ["basic", "itqr", "sc", "vsc"],
        );
        assert.deepEqual(await rolesOf(f, member.personId), ["preparer"]);
      } finally {
        await f.sql("update public.workspaces set default_followup_person_id=$2 where id=$1", [
          f.workspaceId,
          f.siteCoordinatorId,
        ]);
      }
    });

    await t.test("open work: an already uncleared person who holds work can be saved", async () => {
      const prep = await f.staff({ key: "ugo_uncleared_work", name: "Ugo Barrett", capabilities: ["prepare"] });
      const caseId = await f.readyCase();
      await f.act(prep.client, caseId, "CLAIM_PREPARATION", {});
      await f.sql(
        `update public.roster_entries r set roles='{}' from public.workspaces w
          where w.id=r.workspace_id and r.season=w.current_season and r.workspace_id=$1 and r.person_id=$2`,
        [f.workspaceId, prep.personId],
      );
      assert.equal(await clearedOf(f, prep.personId), false);
      await save(
        admin,
        await editOf(f, prep.personId, {
          name: "Ugo Barrett",
          phone: "412-555-0178",
          roles: [],
          certificates: ["vsc", "itqr", "basic"],
        }),
      );
      assert.equal((await profileOf(f, prep.personId)).phone, "412-555-0178");
      assert.deepEqual(await rolesOf(f, prep.personId), []);
      assert.equal(await clearedOf(f, prep.personId), false);
    });

    await t.test("open work: each kind, with the capability it needs", async () => {
      const openWork = async (personId) =>
        (
          await f.sql("select needs,label from vitally_private.open_work($1,$2)", [f.workspaceId, personId])
        ).rows;
      // Reviewing, and being made new without a photo ID check while reviewing.
      const reviewer = await f.staff({ key: "rex_open_review", name: "Rex Pomeroy", capabilities: ["review"] });
      const reviewed = await f.preparedCase();
      await f.act(reviewer.client, reviewed, "CLAIM_REVIEW", {});
      const reviewing = `reviewing client ${await clientOf(f, reviewed)}`;
      assert.deepEqual(await openWork(reviewer.personId), [{ needs: "review", label: reviewing }]);
      const certificates = ["vsc", "itqr", "advanced"];
      assert.deepEqual(
        await refusedForOpenWork(f, admin, await editOf(f, reviewer.personId, { roles: ["preparer"], certificates: [...certificates, "basic"] })),
        [reviewing],
        "losing review",
      );
      assert.deepEqual(
        await refusedForOpenWork(f, admin, await editOf(f, reviewer.personId, { roles: ["reviewer"], certificates, isNew: true })),
        [reviewing],
        "uncleared while reviewing",
      );
      assert.equal(await clearedOf(f, reviewer.personId), true);

      // A claimed help request.
      const helper = await f.staff({ key: "hal_open_assist", name: "Hal Duquesne", capabilities: ["assist"] });
      const { itemId } = await f.seedAssistance();
      const claimed = await helper.client.rpc(
        "vitally_assistance_action",
        assistanceArgs({ itemId, revision: 1, type: "CLAIM" }),
      );
      assert.equal(claimed.error, null, "the claim");
      assert.deepEqual(await openWork(helper.personId), [{ needs: "assist", label: "a help request" }]);
      assert.deepEqual(
        await refusedForOpenWork(f, admin, await editOf(f, helper.personId, { roles: ["greeter"], certificates: ["vsc", "itqr"] })),
        ["a help request"],
      );
      assert.deepEqual(await rolesOf(f, helper.personId), ["intaker"]);

      // An open follow-up, assigned to the default follow-up person.
      const escalated = await f.readyCase();
      await f.act(f.preparer, escalated, "CLAIM_PREPARATION", {});
      await f.act(f.preparer, escalated, "REQUEST_DOCUMENT", f.sampleRequest);
      const { id: requestId } = await one(f, "select id from public.document_requests where case_id=$1", [escalated]);
      await f.act(f.preparer, escalated, "ESCALATE_CONTACT", {
        requestId,
        reason: "No response to the document request.",
      });
      const followup = `follow-up for client ${await clientOf(f, escalated)}`;
      const coordinatorWork = await openWork(f.siteCoordinatorId);
      for (const label of [followup, "default follow-up person"])
        assert.ok(
          coordinatorWork.some((row) => row.needs === "followup" && row.label === label),
          `${label}: ${JSON.stringify(coordinatorWork)}`,
        );
      // Someone with no work has none, and no client role can call it.
      assert.deepEqual(await openWork(randomUUID()), []);
      for (const role of ["anon", "authenticated", "service_role"])
        assert.equal(
          (
            await one(f, "select has_function_privilege($1,'vitally_private.open_work(uuid,uuid)'::regprocedure,'execute') as ok", [
              role,
            ])
          ).ok,
          false,
          role,
        );
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
