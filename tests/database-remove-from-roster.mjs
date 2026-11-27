import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabaseFixture } from "./support/database-fixture.mjs";
import { openDatabase } from "../tools/admin/database.mjs";

// OpenSpec change add-remove-from-roster (design D1-D7), migration 059: an
// admin removes a volunteer from the current season's roster. The entry goes,
// with its certificates and sent and reviewed fields; the person, profile,
// earlier seasons and cases stay; the account is deactivated as Deactivate
// does, unless there is none, it is already deactivated, or it is a site
// coordinator's; the profile revision goes up and the removal is recorded.
// Specs: volunteer-roster, sign-in-accounts, site-coordinators and
// volunteer-clearance.
// OpenSpec change close-check-in-on-roster-removal (#277, #300), migration
// 062: the volunteer's open check-in from today is checked out at the removal
// as the remover's correction, and roster_removals.check_in_closed records it
// (an earlier day's open check-in stays missed); and a replayed removal
// returns its stored result although the volunteer has since gained the Admin
// role. Specs: volunteer-roster and volunteer-check-in. One fixture is shared, and each scenario removes a
// person of its own; the case history scenario removes the fixture's own
// preparer, so it has its own fixture.

const FORBIDDEN = "VT001";
const NOT_FOUND = "VT002";
const CONFLICT = "VT003";
const OPEN_WORK = "VT004";
const VALIDATION = "VT007";

const one = async (f, text, values) => (await f.sql(text, values)).rows[0];
const remove = (client, { actionId = randomUUID(), volunteerId, revision }) =>
  client.rpc("vitally_remove_from_roster", {
    p_action_id: actionId,
    p_volunteer_id: volunteerId,
    p_expected_revision: revision,
  });
const refusal = (error) => error && { code: error.code, message: error.message };
const failure = (error) => `${error?.code} ${error?.message} ${error?.details}`;
const seasonOf = async (f) =>
  Number((await one(f, "select current_season from public.workspaces where id=$1", [f.workspaceId])).current_season);
const profileOf = (f, personId) =>
  one(f, "select to_jsonb(v.*) as row from public.volunteer_profiles v where v.workspace_id=$1 and v.person_id=$2", [
    f.workspaceId,
    personId,
  ]).then((r) => r?.row ?? null);
const profileRevision = async (f, personId) => Number((await profileOf(f, personId)).revision);
const personOf = (f, personId) =>
  one(f, "select to_jsonb(p.*) as row from public.people p where p.workspace_id=$1 and p.id=$2", [
    f.workspaceId,
    personId,
  ]).then((r) => r?.row ?? null);
const currentEntry = (f, personId) =>
  one(
    f,
    `select to_jsonb(r.*) as row from public.roster_entries r
      join public.workspaces w on w.id=r.workspace_id and w.current_season=r.season
      where r.workspace_id=$1 and r.person_id=$2`,
    [f.workspaceId, personId],
  ).then((r) => r?.row ?? null);
const currentCertificates = async (f, personId) =>
  (
    await f.sql(
      `select to_jsonb(c.*) as row from public.certificates c
        join public.workspaces w on w.id=c.workspace_id and w.current_season=c.season
        where c.workspace_id=$1 and c.person_id=$2 order by c.certificate`,
      [f.workspaceId, personId],
    )
  ).rows.map((r) => r.row);
const accountOf = (f, personId) =>
  one(f, "select to_jsonb(a.*) as row from public.accounts a where a.workspace_id=$1 and a.person_id=$2", [
    f.workspaceId,
    personId,
  ]).then((r) => r?.row ?? null);
const membershipOf = (f, userId) =>
  one(f, "select to_jsonb(m.*) as row from public.memberships m where m.workspace_id=$1 and m.user_id=$2", [
    f.workspaceId,
    userId,
  ]).then((r) => r?.row ?? null);
const removalsOf = async (f, personId) =>
  (
    await f.sql(
      `select season,person_id,removed_by_person_id,account_deactivated,shifts_removed,check_in_closed,removed_at
        from public.roster_removals where workspace_id=$1 and person_id=$2 order by removed_at`,
      [f.workspaceId, personId],
    )
  ).rows;
const siteCoordinatorChanges = async (f) =>
  Number((await one(f, "select count(*) as n from public.site_coordinator_changes where workspace_id=$1", [f.workspaceId])).n);
// A shift for the person, `days` from today (the America/New_York date, as
// migration 058 reckons it), in the current season. Returns its id.
const addShift = async (f, personId, days, { removed = false } = {}) =>
  (
    await one(
      f,
      `insert into public.shifts(workspace_id,season,person_id,shift_date,start_hour,end_hour,role,removed_at)
        select w.id,w.current_season,$2,(now() at time zone 'America/New_York')::date+$3::int,10,13,'preparer',
         case when $4 then now() - interval '1 hour' end
        from public.workspaces w where w.id=$1 returning id`,
      [f.workspaceId, personId, days, removed],
    )
  ).id;
const shiftsOf = async (f, personId) =>
  (
    await f.sql(
      `select id,shift_date::text as day,revision::int as revision,removed_at,updated_by_person_id
        from public.shifts where workspace_id=$1 and person_id=$2 order by shift_date,id`,
      [f.workspaceId, personId],
    )
  ).rows;
const shiftById = (f, id) =>
  one(f, "select id,revision::int as revision,removed_at,updated_at,updated_by_person_id from public.shifts where id=$1", [id]);
// The start of today's New York date, and a time just before now that never
// falls before it, so a "today" row is on today's date even just after
// midnight.
const TODAY_START = "(((now() at time zone 'America/New_York')::date)::timestamp at time zone 'America/New_York')";
const todayAgo = (minutes) => `greatest(now() - interval '${minutes} minutes', ${TODAY_START})`;
// A live current-season check-in for the person at `at` (a timestamptz SQL
// expression), with a check-out at `out` when given. Returns its id.
const addCheckIn = async (f, personId, { at = todayAgo(2), out = null } = {}) =>
  (
    await one(
      f,
      `insert into public.check_ins(workspace_id,season,person_id,check_in_date,checked_in_at,checked_out_at)
        select w.id,w.current_season,$2,((${at}) at time zone 'America/New_York')::date,${at},${out ?? "null"}
        from public.workspaces w where w.id=$1 returning id`,
      [f.workspaceId, personId],
    )
  ).id;
const checkInsOf = async (f, personId) =>
  (
    await f.sql(
      `select id,check_in_date::text as day,checked_in_at,checked_out_at,revision::int as revision,
        updated_by_person_id,corrected_by_person_id
        from public.check_ins where workspace_id=$1 and person_id=$2 order by checked_in_at,id`,
      [f.workspaceId, personId],
    )
  ).rows;
// Everything a refused removal must leave as it was.
const stateOf = async (f, personId) => ({
  checkIns: await checkInsOf(f, personId),
  shifts: await shiftsOf(f, personId),
  person: await personOf(f, personId),
  profile: await profileOf(f, personId),
  entry: await currentEntry(f, personId),
  certificates: await currentCertificates(f, personId),
  account: await accountOf(f, personId),
  removals: await removalsOf(f, personId),
});
// The helper's answer for one signed-in caller, in the role and with the JWT
// claims a real session has (as tests/database-volunteer-roster.mjs does). The
// transaction is rolled back.
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
const rpc = async (client, fn, args) => {
  const { data, error } = await client.rpc(fn, args);
  assert.equal(error, null, `${fn}: ${failure(error)}`);
  return data;
};
// A removal that must succeed, at the profile revision now stored.
const removeNow = async (f, client, personId, actionId = randomUUID()) => {
  const revision = await profileRevision(f, personId);
  const { data, error } = await remove(client, { actionId, volunteerId: personId, revision });
  assert.equal(error, null, failure(error));
  return { data, revision, actionId };
};
// A removal that must be refused, changing nothing and storing no receipt.
const refused = async (f, client, personId, { code, message, details, revision, volunteerId = personId }) => {
  const before = personId ? await stateOf(f, personId) : null;
  const actionId = randomUUID();
  const { data, error } = await remove(client, {
    actionId,
    volunteerId,
    revision: revision ?? (personId ? await profileRevision(f, personId) : 1),
  });
  assert.equal(data, null);
  assert.deepEqual(refusal(error), { code, message }, failure(error));
  if (details !== undefined) assert.deepEqual(error.details, details);
  assert.equal(await f.receiptsFor(actionId), 0, "no receipt");
  if (personId) assert.deepEqual(await stateOf(f, personId), before, "nothing changed");
  return error;
};
const fresh = () => `v-${randomUUID()}@example.org`;
const volunteer = (email, extra = {}) => ({
  name: "Rowan Pike",
  email,
  phone: null,
  works: "on_site",
  languages: ["english"],
  otherLanguage: null,
  roles: [],
  certificates: [],
  isNew: false,
  photoIdChecked: false,
  ...extra,
});
// A Roster volunteer with no sign-in, added by the admin.
const addVolunteer = async (f, email = fresh(), extra = {}) =>
  (
    await rpc(f.siteCoordinator, "vitally_save_volunteer", {
      p_action_id: randomUUID(),
      p_volunteer_id: null,
      p_expected_revision: null,
      p_volunteer: volunteer(email, extra),
    })
  ).personId;
const caseNumber = async (f, caseId) =>
  (await one(f, "select coalesce(client_number::text,reference) as n from public.cases where id=$1", [caseId])).n;
const setDefaultFollowup = (f, personKey) =>
  f.sql("select vitally_private.set_default_followup($1,$2)", [f.workspaceId, personKey]);
// A case carried through filing with both returns on paper: stage accepted.
async function acceptedCase(f) {
  const caseId = await f.approvedCase();
  await f.act(f.siteCoordinator, caseId, "MARK_READY_TO_EFILE", { confirmed: true });
  await f.act(f.siteCoordinator, caseId, "MARK_EFILED", {
    confirmed: true,
    methods: { federal: "paper", state: "paper" },
  });
  return caseId;
}
// A case filed, rejected and then closed: stage closed.
async function closedCase(f) {
  const caseId = await f.approvedCase();
  await f.act(f.siteCoordinator, caseId, "MARK_READY_TO_EFILE", { confirmed: true });
  await f.act(f.siteCoordinator, caseId, "MARK_EFILED", {
    confirmed: true,
    methods: { federal: "efile", state: "efile" },
  });
  const day = (await one(f, "select (now() at time zone 'America/New_York')::date::text as d")).d;
  await f.act(f.siteCoordinator, caseId, "RECORD_FILING_RESULT", {
    confirmed: true,
    results: { federal: { result: "rejected", date: day, code: "C1" } },
  });
  await f.act(f.siteCoordinator, caseId, "CLOSE_CASE", { confirmed: true, reason: "dismissed" });
  return caseId;
}
// The Volunteers badge's count (supabase-store countUploadsToReview): current
// season entries with either sent date set, read as the admin.
const uploadsToReview = async (f, client) => {
  const season = await seasonOf(f);
  const { count, error } = await client
    .from("roster_entries")
    .select("person_id", { count: "exact", head: true })
    .eq("season", season)
    .or("form_13615_sent_at.not.is.null,photo_id_sent_at.not.is.null");
  assert.equal(error, null, failure(error));
  return count;
};

test("removing a volunteer from this season's roster", async (t) => {
  const f = await createDatabaseFixture();
  try {
    const sc = { client: f.siteCoordinator, personId: f.siteCoordinatorId, userId: f.siteCoordinatorUserId };
    const admin = await f.staff({ key: "ines_admin", name: "Ines Dalton", capabilities: ["admin", "followup"] });
    const season = await seasonOf(f);

    await t.test("removes the current-season entry and deactivates an active account", async () => {
      const nadia = await f.staff({ key: "nadia_kerr", name: "Nadia Kerr", capabilities: ["prepare"] });
      await f.sql("update public.volunteer_profiles set usual_days='{mon,wed}' where workspace_id=$1 and person_id=$2", [
        f.workspaceId,
        nadia.personId,
      ]);
      assert.ok(await currentEntry(f, nadia.personId), "on the roster");
      assert.ok((await currentCertificates(f, nadia.personId)).length > 0, "with certificates");
      const { data, revision, actionId } = await removeNow(f, sc.client, nadia.personId);
      assert.equal(await currentEntry(f, nadia.personId), null);
      assert.deepEqual(await currentCertificates(f, nadia.personId), []);
      const account = await accountOf(f, nadia.personId);
      assert.equal(account.status, "deactivated");
      assert.ok(account.deactivated_at, "deactivated_at");
      assert.equal((await membershipOf(f, nadia.userId)).active, false);
      const profile = await profileOf(f, nadia.personId);
      assert.equal(Number(profile.revision), revision + 1);
      assert.deepEqual(profile.usual_days, ["mon", "wed"]);
      const person = await personOf(f, nadia.personId);
      assert.ok(person, "the person stays");
      assert.deepEqual(person.capabilities, []);
      const removals = await removalsOf(f, nadia.personId);
      assert.equal(removals.length, 1);
      assert.deepEqual(
        {
          season: Number(removals[0].season),
          personId: removals[0].person_id,
          by: removals[0].removed_by_person_id,
          deactivated: removals[0].account_deactivated,
        },
        { season, personId: nadia.personId, by: sc.personId, deactivated: true },
      );
      assert.ok(removals[0].removed_at, "removed_at");
      assert.deepEqual(data, {
        actionId,
        volunteerId: nadia.personId,
        revision: revision + 1,
        accountDeactivated: true,
        shiftsRemoved: 0,
      });
      assert.equal(Number(removals[0].shifts_removed), 0);
    });

    await t.test("sent and reviewed fields go with the entry", async () => {
      const member = await f.staff({ key: "sol_sent", name: "Sol Ambry", capabilities: ["prepare"] });
      await f.sql(
        `update public.roster_entries set form_13615_sent_at=now(),photo_id_sent_at=now(),
           photo_id_reviewed_at=now(),photo_id_review_reason='Fictional: the photo was unreadable.'
          where workspace_id=$1 and person_id=$2 and season=$3`,
        [f.workspaceId, member.personId, season],
      );
      const before = await uploadsToReview(f, sc.client);
      assert.ok(before >= 1, "counted before");
      await removeNow(f, sc.client, member.personId);
      const { n } = await one(
        f,
        `select count(*)::int as n from public.roster_entries where workspace_id=$1 and person_id=$2
          and (form_13615_sent_at is not null or photo_id_sent_at is not null
           or form_13615_reviewed_at is not null or photo_id_reviewed_at is not null)`,
        [f.workspaceId, member.personId],
      );
      assert.equal(n, 0);
      assert.equal(await uploadsToReview(f, sc.client), before - 1);
    });

    await t.test("no account: only the entry is deleted", async () => {
      const personId = await addVolunteer(f);
      assert.ok(await currentEntry(f, personId));
      const { data } = await removeNow(f, sc.client, personId);
      assert.equal(await currentEntry(f, personId), null);
      assert.equal(await accountOf(f, personId), null);
      assert.equal(data.accountDeactivated, false);
      assert.equal((await removalsOf(f, personId))[0].account_deactivated, false);
    });

    await t.test("invited account is deactivated, not cancelled", async () => {
      const user = await f.provision();
      const personId = await addVolunteer(f, user.email);
      await rpc(sc.client, "vitally_record_account", {
        p_action_id: randomUUID(),
        p_op: "create",
        p_target: { volunteerId: personId },
        p_user_id: user.userId,
      });
      assert.equal((await accountOf(f, personId)).status, "invited");
      const { data } = await removeNow(f, sc.client, personId);
      assert.equal(data.accountDeactivated, true);
      assert.equal((await accountOf(f, personId)).status, "deactivated");
      const membership = await membershipOf(f, user.userId);
      assert.ok(membership, "the membership stays");
      assert.equal(membership.active, false);
      assert.equal((await personOf(f, personId)).user_id, user.userId);
    });

    await t.test("already deactivated: entry deleted, account unchanged", async () => {
      const member = await f.staff({ key: "dee_done", name: "Dee Lorne", capabilities: ["prepare"] });
      await rpc(sc.client, "vitally_deactivate_account", {
        p_action_id: randomUUID(),
        p_volunteer_id: member.personId,
        p_expected_revision: Number((await accountOf(f, member.personId)).revision),
      });
      const before = await accountOf(f, member.personId);
      assert.equal(before.status, "deactivated");
      const { data } = await removeNow(f, sc.client, member.personId);
      assert.equal(data.accountDeactivated, false);
      assert.equal(await currentEntry(f, member.personId), null);
      assert.deepEqual(await accountOf(f, member.personId), before);
    });

    await t.test("refuses a caller who is not a workspace admin", async () => {
      const member = await f.staff({ key: "fay_forbidden", name: "Fay Orlo", capabilities: ["prepare"] });
      await refused(f, f.preparer, member.personId, { code: FORBIDDEN, message: "FORBIDDEN" });
    });

    await t.test("refuses ADMIN_ROLE for a non-site-coordinator caller", async () => {
      const other = await f.staff({ key: "ada_admin", name: "Ada Quill", capabilities: ["admin", "followup"] });
      await refused(f, admin.client, other.personId, { code: FORBIDDEN, message: "ADMIN_ROLE" });
    });

    await t.test("a site coordinator removes an Admin-role person", async () => {
      const other = await f.staff({ key: "abe_admin", name: "Abe Corran", capabilities: ["admin", "followup"] });
      const { data } = await removeNow(f, sc.client, other.personId);
      assert.equal(data.accountDeactivated, true);
      assert.equal(await currentEntry(f, other.personId), null);
      assert.equal((await accountOf(f, other.personId)).status, "deactivated");
    });

    await t.test("refuses SELF", async () => {
      // A site coordinator, and an admin who isn't one: SELF comes before
      // ADMIN_ROLE (design D4 step 2), so the Admin role doesn't answer first.
      await refused(f, sc.client, sc.personId, { code: VALIDATION, message: "VALIDATION", details: "SELF" });
      const own = await f.staff({ key: "sela_self", name: "Sela Brune", capabilities: ["admin", "followup"] });
      await refused(f, own.client, own.personId, { code: VALIDATION, message: "VALIDATION", details: "SELF" });
    });

    await t.test("refuses a missing argument", async () => {
      const member = await f.staff({ key: "mia_missing", name: "Mia Torv", capabilities: ["prepare"] });
      const revision = await profileRevision(f, member.personId);
      for (const args of [
        { p_action_id: null, p_volunteer_id: member.personId, p_expected_revision: revision },
        { p_action_id: randomUUID(), p_volunteer_id: null, p_expected_revision: revision },
        { p_action_id: randomUUID(), p_volunteer_id: member.personId, p_expected_revision: null },
      ]) {
        const { error } = await sc.client.rpc("vitally_remove_from_roster", args);
        assert.deepEqual(refusal(error), { code: VALIDATION, message: "VALIDATION" });
      }
      assert.ok(await currentEntry(f, member.personId));
    });

    await t.test("refuses NOT_FOUND", async () => {
      // A person of another workspace: no profile in the caller's.
      await refused(f, sc.client, null, {
        code: NOT_FOUND,
        message: "NOT_FOUND",
        volunteerId: f.foreignStaffId,
        revision: 1,
      });
      // A person with a profile but no current-season entry.
      const member = await f.staff({ key: "ned_none", name: "Ned Halloway", capabilities: ["prepare"] });
      await f.sql("delete from public.roster_entries where workspace_id=$1 and person_id=$2 and season=$3", [
        f.workspaceId,
        member.personId,
        season,
      ]);
      await refused(f, sc.client, member.personId, { code: NOT_FOUND, message: "NOT_FOUND" });
      // An id that names no one.
      await refused(f, sc.client, null, { code: NOT_FOUND, message: "NOT_FOUND", volunteerId: randomUUID(), revision: 1 });
    });

    await t.test("refuses CONFLICT for a stale profile revision", async () => {
      const member = await f.staff({ key: "cal_conflict", name: "Cal Voss", capabilities: ["prepare"] });
      const revision = await profileRevision(f, member.personId);
      for (const stale of [revision - 1, revision + 1])
        await refused(f, sc.client, member.personId, { code: CONFLICT, message: "CONFLICT", revision: stale });
    });

    await t.test("refuses a site coordinator's removal by a non-site-coordinator admin", async () => {
      // No Admin role, so ADMIN_ROLE doesn't answer first.
      const other = await f.staff({
        key: "sid_sc",
        name: "Sid Marlow",
        capabilities: ["prepare"],
        siteCoordinator: true,
      });
      const changes = await siteCoordinatorChanges(f);
      await refused(f, admin.client, other.personId, { code: FORBIDDEN, message: "FORBIDDEN" });
      assert.equal((await accountOf(f, other.personId)).is_site_coordinator, true);
      assert.equal(await siteCoordinatorChanges(f), changes);
    });

    await t.test("a site coordinator removes another without deactivating", async () => {
      const other = await f.staff({
        key: "morgan_sc",
        name: "Morgan Hale",
        capabilities: ["admin", "followup"],
        siteCoordinator: true,
      });
      const changes = await siteCoordinatorChanges(f);
      const { data } = await removeNow(f, sc.client, other.personId);
      assert.equal(data.accountDeactivated, false);
      assert.equal(await currentEntry(f, other.personId), null);
      const account = await accountOf(f, other.personId);
      assert.equal(account.status, "active");
      assert.equal(account.is_site_coordinator, true);
      assert.equal(await siteCoordinatorChanges(f), changes);
      assert.deepEqual((await personOf(f, other.personId)).capabilities, []);
      assert.equal((await removalsOf(f, other.personId))[0].account_deactivated, false);
      // Not cleared, so the setup screen; still a workspace admin by the mark.
      const clearance = await rpc(other.client, "vitally_my_clearance");
      assert.equal(clearance.cleared, false);
      assert.equal(clearance.isAdmin, true);
      assert.equal(await callerAnswer(f, other.userId, "vitally_policy.is_workspace_admin($1)", [f.workspaceId]), true);
    });

    await t.test("refuses OPEN_WORK", async (t) => {
      await t.test("an open current-season case as preparer", async () => {
        const member = await f.staff({ key: "opal_open", name: "Opal Brandt", capabilities: ["prepare"] });
        const caseId = await f.readyCase();
        await f.act(member.client, caseId, "CLAIM_PREPARATION", {});
        const error = await refused(f, sc.client, member.personId, { code: OPEN_WORK, message: "OPEN_WORK" });
        assert.deepEqual(JSON.parse(error.details), [`preparing client ${await caseNumber(f, caseId)}`]);
      });
      await t.test("an Accepted current-season case as preparer", async () => {
        const caseId = await acceptedCase(f);
        assert.equal((await one(f, "select stage from public.cases where id=$1", [caseId])).stage, "accepted");
        const error = await refused(f, sc.client, f.preparerId, { code: OPEN_WORK, message: "OPEN_WORK" });
        assert.deepEqual(JSON.parse(error.details), [`preparing client ${await caseNumber(f, caseId)}`]);
      });
      await t.test("the default follow-up person", async () => {
        const dana = await f.staff({ key: "dana_default", name: "Dana Wren", capabilities: ["admin", "followup"] });
        await setDefaultFollowup(f, "dana_default");
        try {
          const error = await refused(f, sc.client, dana.personId, { code: OPEN_WORK, message: "OPEN_WORK" });
          assert.deepEqual(JSON.parse(error.details), ["default follow-up person"]);
        } finally {
          await setDefaultFollowup(f, "site_coordinator");
        }
      });
    });

    await t.test("shifts from today on are removed, earlier ones kept", async () => {
      const shay = await f.staff({ key: "shay_shifts", name: "Shay Morrow", capabilities: ["prepare"] });
      const other = await f.staff({ key: "otto_other", name: "Otto Venn", capabilities: ["prepare"] });
      const past = await addShift(f, shay.personId, -1);
      const today = await addShift(f, shay.personId, 0);
      const future = await addShift(f, shay.personId, 7);
      const gone = await addShift(f, shay.personId, 3, { removed: true });
      const theirs = await addShift(f, other.personId, 2);
      const before = Object.fromEntries(
        await Promise.all([past, today, future, gone, theirs].map(async (id) => [id, await shiftById(f, id)])),
      );
      const { data } = await removeNow(f, sc.client, shay.personId);
      assert.equal(data.shiftsRemoved, 2);
      assert.equal(Number((await removalsOf(f, shay.personId))[0].shifts_removed), 2);
      for (const id of [today, future]) {
        const after = await shiftById(f, id);
        assert.ok(after.removed_at, "removed");
        assert.equal(after.revision, before[id].revision + 1, "revision raised");
        assert.equal(after.updated_by_person_id, sc.personId);
        assert.ok(after.updated_at > before[id].updated_at, "updated_at");
      }
      for (const id of [past, gone, theirs]) assert.deepEqual(await shiftById(f, id), before[id], "untouched");
    });

    await t.test("a refused removal (OPEN_WORK) leaves the shifts as they were", async () => {
      const member = await f.staff({ key: "olive_open", name: "Olive Strand", capabilities: ["prepare"] });
      const shiftId = await addShift(f, member.personId, 1);
      const caseId = await f.readyCase();
      await f.act(member.client, caseId, "CLAIM_PREPARATION", {});
      const before = await shiftById(f, shiftId);
      await refused(f, sc.client, member.personId, { code: OPEN_WORK, message: "OPEN_WORK" });
      assert.deepEqual(await shiftById(f, shiftId), before);
      assert.equal(before.removed_at, null);
    });

    await t.test("a replay does not remove shifts again", async () => {
      const member = await f.staff({ key: "remy_replay", name: "Remy Hale", capabilities: ["prepare"] });
      await addShift(f, member.personId, 2);
      const { data, revision, actionId } = await removeNow(f, sc.client, member.personId);
      assert.equal(data.shiftsRemoved, 1);
      const removed = await shiftsOf(f, member.personId);
      // A shift added after the removal is not the replay's to remove.
      const later = await addShift(f, member.personId, 4);
      const laterBefore = await shiftById(f, later);
      const again = await remove(sc.client, { actionId, volunteerId: member.personId, revision });
      assert.equal(again.error, null, failure(again.error));
      assert.deepEqual(again.data, data);
      assert.deepEqual(await shiftById(f, later), laterBefore);
      assert.deepEqual(
        (await shiftsOf(f, member.personId)).filter((row) => row.id !== later),
        removed,
      );
    });

    await t.test("a stale Save after removal gets CONFLICT and does not re-add", async () => {
      const member = await f.staff({ key: "sam_stale", name: "Sam Ostrow", capabilities: ["prepare"] });
      const { email } = await profileOf(f, member.personId);
      const { revision } = await removeNow(f, sc.client, member.personId);
      const actionId = randomUUID();
      const { error } = await sc.client.rpc("vitally_save_volunteer", {
        p_action_id: actionId,
        p_volunteer_id: member.personId,
        p_expected_revision: revision,
        p_volunteer: volunteer(email, { roles: ["preparer"], certificates: ["vsc", "itqr", "basic"] }),
      });
      assert.deepEqual(refusal(error), { code: CONFLICT, message: "CONFLICT" });
      assert.equal(await f.receiptsFor(actionId), 0);
      assert.equal(await currentEntry(f, member.personId), null);
    });

    await t.test("Deactivate first, then Remove", async () => {
      const member = await f.staff({ key: "dora_first", name: "Dora Pell", capabilities: ["prepare"] });
      const revision = await profileRevision(f, member.personId);
      await rpc(sc.client, "vitally_deactivate_account", {
        p_action_id: randomUUID(),
        p_volunteer_id: member.personId,
        p_expected_revision: Number((await accountOf(f, member.personId)).revision),
      });
      const deactivated = await accountOf(f, member.personId);
      const { data, error } = await remove(admin.client, { volunteerId: member.personId, revision });
      assert.equal(error, null, failure(error));
      assert.equal(data.accountDeactivated, false);
      assert.equal(await currentEntry(f, member.personId), null);
      assert.deepEqual(await accountOf(f, member.personId), deactivated);
      assert.equal((await removalsOf(f, member.personId))[0].account_deactivated, false);
    });

    await t.test("Remove first, then Deactivate", async () => {
      const member = await f.staff({ key: "rex_first", name: "Rex Lyle", capabilities: ["prepare"] });
      const accountRevision = Number((await accountOf(f, member.personId)).revision);
      await removeNow(f, sc.client, member.personId);
      const removed = await accountOf(f, member.personId);
      const actionId = randomUUID();
      const { error } = await admin.client.rpc("vitally_deactivate_account", {
        p_action_id: actionId,
        p_volunteer_id: member.personId,
        p_expected_revision: accountRevision,
      });
      assert.deepEqual(refusal(error), { code: CONFLICT, message: "CONFLICT" });
      assert.equal(await f.receiptsFor(actionId), 0);
      assert.deepEqual(await accountOf(f, member.personId), removed);
    });

    await t.test("a replay returns the stored receipt", async () => {
      const member = await f.staff({ key: "ray_replay", name: "Ray Dunmore", capabilities: ["prepare"] });
      const { data, revision, actionId } = await removeNow(f, sc.client, member.personId);
      const again = await remove(sc.client, { actionId, volunteerId: member.personId, revision });
      assert.equal(again.error, null, failure(again.error));
      assert.deepEqual(again.data, data);
      assert.equal((await removalsOf(f, member.personId)).length, 1);
      assert.equal(await f.receiptsFor(actionId), 1);
    });

    await t.test("roster_removals has no grant", async () => {
      const denied = (result, label) => assert.equal(result.error?.code, "42501", `${label}: ${failure(result.error)}`);
      denied(await sc.client.from("roster_removals").select("*"), "select");
      denied(
        await sc.client.from("roster_removals").insert({
          workspace_id: f.workspaceId,
          season,
          person_id: sc.personId,
          removed_by_person_id: sc.personId,
          account_deactivated: false,
        }),
        "insert",
      );
      denied(
        await sc.client.from("roster_removals").update({ account_deactivated: true }).eq("workspace_id", f.workspaceId),
        "update",
      );
      denied(await sc.client.from("roster_removals").delete().eq("workspace_id", f.workspaceId), "delete");
      const { rows } = await f.sql(
        `select r.role, p.p from (values ('anon'),('authenticated'),('service_role')) r(role)
          cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(p)
          where has_table_privilege(r.role,'public.roster_removals',p.p)`,
      );
      assert.deepEqual(rows, []);
      const security = await one(f, "select relrowsecurity from pg_class where oid='public.roster_removals'::regclass");
      assert.equal(security.relrowsecurity, true);
    });

    await t.test("re-adding through Save keeps the account deactivated", async () => {
      const member = await f.staff({ key: "rue_readd", name: "Rue Kestrel", capabilities: ["prepare"] });
      const { email } = await profileOf(f, member.personId);
      const { data } = await removeNow(f, sc.client, member.personId);
      await rpc(sc.client, "vitally_save_volunteer", {
        p_action_id: randomUUID(),
        p_volunteer_id: member.personId,
        p_expected_revision: data.revision,
        p_volunteer: volunteer(email),
      });
      const entry = await currentEntry(f, member.personId);
      assert.ok(entry, "back on the roster");
      assert.deepEqual(entry.roles, []);
      assert.equal((await accountOf(f, member.personId)).status, "deactivated");
    });

    await t.test("an open check-in today is checked out at the removal, corrected by the remover", async () => {
      const nadia = await f.staff({ key: "nadia_checked_in", name: "Nadia Kerr", capabilities: ["prepare"] });
      const id = await addCheckIn(f, nadia.personId);
      const [before] = await checkInsOf(f, nadia.personId);
      await removeNow(f, admin.client, nadia.personId);
      const [after] = await checkInsOf(f, nadia.personId);
      assert.equal(after.id, id);
      assert.ok(after.checked_out_at > after.checked_in_at);
      assert.equal(after.revision, before.revision + 1);
      assert.equal(after.corrected_by_person_id, admin.personId);
      assert.equal(after.updated_by_person_id, admin.personId);
      assert.equal(
        (await one(f, "select (vitally_private.open_check_in($1,$2)).id as id", [f.workspaceId, nadia.personId])).id,
        null,
      );
      assert.equal((await removalsOf(f, nadia.personId))[0].check_in_closed, true);
    });

    await t.test("yesterday's open check-in is left missed", async () => {
      const yara = await f.staff({ key: "yara_yesterday", name: "Yara Voss", capabilities: ["prepare"] });
      await addCheckIn(f, yara.personId, {
        at: "(((now() at time zone 'America/New_York')::date - 1) + time '12:00') at time zone 'America/New_York'",
      });
      const before = await checkInsOf(f, yara.personId);
      assert.equal(before.length, 1);
      assert.equal(before[0].checked_out_at, null);
      await removeNow(f, admin.client, yara.personId);
      assert.deepEqual(await checkInsOf(f, yara.personId), before);
      assert.equal((await removalsOf(f, yara.personId))[0].check_in_closed, false);
    });

    await t.test("a check-in already checked out today is left, and nothing is recorded as closed", async () => {
      const cora = await f.staff({ key: "cora_checked_out", name: "Cora Lind", capabilities: ["prepare"] });
      await addCheckIn(f, cora.personId, { at: todayAgo(3), out: "now()" });
      const before = await checkInsOf(f, cora.personId);
      assert.ok(before[0].checked_out_at, "already checked out");
      await removeNow(f, admin.client, cora.personId);
      assert.deepEqual(await checkInsOf(f, cora.personId), before);
      assert.equal((await removalsOf(f, cora.personId))[0].check_in_closed, false);
    });

    await t.test("another volunteer's open check-in is untouched", async () => {
      const mina = await f.staff({ key: "mina_in", name: "Mina Okoro", capabilities: ["prepare"] });
      const gus = await f.staff({ key: "gus_leaving", name: "Gus Almeida", capabilities: ["prepare"] });
      await addCheckIn(f, mina.personId);
      const before = await checkInsOf(f, mina.personId);
      await removeNow(f, admin.client, gus.personId);
      assert.deepEqual(await checkInsOf(f, mina.personId), before);
      assert.equal(before[0].checked_out_at, null);
    });

    await t.test("a refused removal (OPEN_WORK) leaves an open check-in", async () => {
      const member = await f.staff({ key: "olga_open", name: "Olga Reyes", capabilities: ["prepare"] });
      const checkInId = await addCheckIn(f, member.personId);
      const caseId = await f.readyCase();
      await f.act(member.client, caseId, "CLAIM_PREPARATION", {});
      const before = await checkInsOf(f, member.personId);
      await refused(f, sc.client, member.personId, { code: OPEN_WORK, message: "OPEN_WORK" });
      const after = await checkInsOf(f, member.personId);
      assert.deepEqual(after, before);
      assert.equal(after[0].id, checkInId);
      assert.equal(after[0].checked_out_at, null);
    });

    await t.test("the closed check-in reads as corrected, and counts to the removal", async () => {
      const lena = await f.staff({ key: "lena_counted", name: "Lena Fox", capabilities: ["prepare"] });
      await addCheckIn(f, lena.personId);
      await removeNow(f, admin.client, lena.personId);
      const [row] = await checkInsOf(f, lena.personId);
      const today = (await one(f, "select (now() at time zone 'America/New_York')::date::text as d")).d;
      const day = await rpc(sc.client, "vitally_schedule_day", { p_date: today });
      const item = day.checkIns.find((c) => c.volunteerId === lena.personId);
      assert.ok(item, "on the Schedule");
      assert.equal(item.flags.corrected, true);
      assert.equal(item.correctedByName, "Ines Dalton");
      const week = await rpc(sc.client, "vitally_hours_this_week", {});
      const entry = week.hours.find((h) => h.volunteerId === lena.personId);
      assert.ok(entry, "in this week's hours");
      assert.equal(entry.minutes, Math.floor((row.checked_out_at - row.checked_in_at) / 60000));
    });

    await t.test("same instant: the check-out is after the check-in", async () => {
      const sam = await f.staff({ key: "sam_same_instant", name: "Sam Ortiz", capabilities: ["prepare"] });
      const revision = await profileRevision(f, sam.personId);
      await f.sql("begin");
      try {
        await f.sql(
          `insert into public.check_ins(workspace_id,season,person_id,check_in_date,checked_in_at)
            select w.id,w.current_season,$2,(now() at time zone 'America/New_York')::date,now()
            from public.workspaces w where w.id=$1`,
          [f.workspaceId, sam.personId],
        );
        await f.sql("select set_config('request.jwt.claims',$1,true)", [
          JSON.stringify({ sub: sc.userId, role: "authenticated" }),
        ]);
        await f.sql("set local role authenticated");
        await f.sql("select public.vitally_remove_from_roster($1,$2,$3)", [randomUUID(), sam.personId, revision]);
        await f.sql("reset role");
        const row = await one(
          f,
          `select checked_in_at,checked_out_at,check_in_date::text as day,
            (checked_out_at at time zone 'America/New_York')::date::text as out_day
            from public.check_ins where workspace_id=$1 and person_id=$2`,
          [f.workspaceId, sam.personId],
        );
        assert.ok(row.checked_out_at > row.checked_in_at, "after the check-in");
        assert.equal(row.out_day, row.day);
      } finally {
        await f.sql("rollback");
      }
    });

    await t.test("a replay returns its stored result after the volunteer gained the Admin role (#300)", async () => {
      const rowan = await f.staff({ key: "rowan_replay", name: "Rowan Pike", capabilities: ["prepare"] });
      const { email } = await profileOf(f, rowan.personId);
      const { data, revision, actionId } = await removeNow(f, admin.client, rowan.personId);
      await rpc(sc.client, "vitally_save_volunteer", {
        p_action_id: randomUUID(),
        p_volunteer_id: rowan.personId,
        p_expected_revision: data.revision,
        p_volunteer: volunteer(email, { roles: ["admin"], certificates: ["vsc", "itqr"] }),
      });
      const entry = await currentEntry(f, rowan.personId);
      assert.deepEqual(entry.roles, ["admin"]);
      const again = await remove(admin.client, { actionId, volunteerId: rowan.personId, revision });
      assert.equal(again.error, null, failure(again.error));
      assert.deepEqual(again.data, data);
      assert.deepEqual(await currentEntry(f, rowan.personId), entry);
      assert.equal((await removalsOf(f, rowan.personId)).length, 1);
    });
  } finally {
    await f.close();
  }
});

test("earlier seasons and case history are kept", async () => {
  const f = await createDatabaseFixture();
  try {
    const season = await seasonOf(f);
    const preparerId = f.preparerId;
    await f.sql(
      "insert into public.roster_entries(workspace_id,person_id,season,roles,is_new) values($1,$2,$3,'{}',false)",
      [f.workspaceId, preparerId, season - 1],
    );
    await f.sql(
      `insert into public.certificates(workspace_id,person_id,season,certificate,status,confirmed_at,confirmed_by_person_id)
        values($1,$2,$3,'vsc','confirmed',now(),$4)`,
      [f.workspaceId, preparerId, season - 1, f.siteCoordinatorId],
    );
    const caseId = await closedCase(f);
    const pastRows = async () => ({
      entries: (
        await f.sql(
          "select to_jsonb(r.*) as row from public.roster_entries r where r.workspace_id=$1 and r.person_id=$2 and r.season=$3",
          [f.workspaceId, preparerId, season - 1],
        )
      ).rows.map((r) => r.row),
      certificates: (
        await f.sql(
          "select to_jsonb(c.*) as row from public.certificates c where c.workspace_id=$1 and c.person_id=$2 and c.season=$3",
          [f.workspaceId, preparerId, season - 1],
        )
      ).rows.map((r) => r.row),
      case: (await one(f, "select to_jsonb(c.*) as row from public.cases c where c.id=$1", [caseId])).row,
    });
    const before = await pastRows();
    assert.equal(before.entries.length, 1);
    assert.equal(before.certificates.length, 1);
    assert.equal(before.case.stage, "closed");
    assert.equal(before.case.preparer_id, preparerId);
    await removeNow(f, f.siteCoordinator, preparerId);
    assert.equal(await currentEntry(f, preparerId), null);
    assert.deepEqual(await pastRows(), before);
  } finally {
    await f.close();
  }
});

// PR #273 review (Zeye): the volunteer's own writes take no workspace lock.
// They hold FOR SHARE on their own membership (require_membership), then lock
// their profile (and, for a send, the entry). Remove deactivates that
// membership, so it locks it right after the workspace lock and before the
// profile. These pin both timings for both of the volunteer's writes; without
// that lock each ends in a deadlock (40P01).
test("removal and the volunteer's own writes never deadlock", async (t) => {
  const f = await createDatabaseFixture();
  const DEADLOCK = "40P01";
  const sc = f.siteCoordinator;
  // Waits until a session running `fn` is blocked on a lock.
  const waitingOn = async (fn) => {
    for (let i = 0; i < 100; i += 1) {
      const { w } = await one(
        f,
        `select exists(select 1 from pg_stat_activity where wait_event_type='Lock' and query ilike $1
          and pid<>pg_backend_pid()) as w`,
        [`%${fn}%`],
      );
      if (w) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  };
  // The volunteer's own profile, as My profile sends it, with a new phone.
  const profilePayload = async (personId, phone) => {
    const profile = await profileOf(f, personId);
    const person = await personOf(f, personId);
    return {
      name: person.name,
      phone,
      works: profile.works,
      languages: profile.languages ?? [],
      otherLanguage: profile.other_language ?? null,
      usualDays: profile.usual_days ?? [],
    };
  };
  const sentAt = async (personId) =>
    (
      await one(
        f,
        `select r.form_13615_sent_at from public.roster_entries r join public.workspaces w
          on w.id=r.workspace_id and w.current_season=r.season where r.workspace_id=$1 and r.person_id=$2`,
        [f.workspaceId, personId],
      )
    )?.form_13615_sent_at ?? null;
  // Each write as SQL (inside the volunteer's own open transaction) and as an
  // RPC (through their signed-in client), with what shows it landed.
  const writes = [
    {
      name: "the volunteer's profile save",
      fn: "vitally_save_my_profile",
      sql: async (personId) => ({
        text: "select public.vitally_save_my_profile($1,$2,$3::jsonb) as answer",
        values: [randomUUID(), await profileRevision(f, personId), JSON.stringify(await profilePayload(personId, "555-0142"))],
      }),
      rpc: async (member) =>
        member.client.rpc("vitally_save_my_profile", {
          p_action_id: randomUUID(),
          p_expected_revision: await profileRevision(f, member.personId),
          p_profile: await profilePayload(member.personId, "555-0143"),
        }),
      landed: async (personId) => ["555-0142", "555-0143"].includes((await profileOf(f, personId)).phone),
    },
    {
      name: "the volunteer's mark sent",
      fn: "vitally_mark_upload_sent",
      sql: async () => ({
        text: "select public.vitally_mark_upload_sent($1,'form13615') as answer",
        values: [randomUUID()],
      }),
      rpc: async (member) =>
        member.client.rpc("vitally_mark_upload_sent", { p_action_id: randomUUID(), p_document: "form13615" }),
      landed: async (personId) => (await sentAt(personId)) != null,
    },
  ];
  let n = 0;
  try {
    for (const write of writes) {
      // (a) The volunteer's write has its membership. Remove comes in and
      // waits on it holding no profile lock, so the write takes the profile
      // and commits. Remove then answers CONFLICT (the write raised the
      // profile revision), never a deadlock.
      await t.test(`${write.name} holds its membership, then Remove: Remove waits, then CONFLICT`, async () => {
        n += 1;
        const member = await f.staff({ key: `race_a${n}`, name: `Vic Ardent ${n}`, capabilities: ["prepare"] });
        const volunteer = await openDatabase({ kind: "test" });
        let open = false;
        try {
          const revision = await profileRevision(f, member.personId);
          const { text, values } = await write.sql(member.personId);
          await volunteer.query("begin");
          open = true;
          // As require_membership does at the start of the write.
          await volunteer.query(
            "select 1 from public.memberships where workspace_id=$1 and user_id=$2 and active for share",
            [f.workspaceId, member.userId],
          );
          const removal = remove(sc, { volunteerId: member.personId, revision }).then((answer) => answer);
          assert.equal(await waitingOn("vitally_remove_from_roster"), true, "Remove waits");
          // The rest of the volunteer's write, in the same transaction.
          await volunteer.query("select set_config('request.jwt.claims',$1,true)", [
            JSON.stringify({ sub: member.userId, role: "authenticated" }),
          ]);
          await volunteer.query("set local role authenticated");
          const answer = await volunteer.query(text, values).then(
            (result) => ({ data: result.rows[0].answer, error: null }),
            (error) => ({ data: null, error }),
          );
          await volunteer.query(answer.error ? "rollback" : "commit");
          open = false;
          const { data, error } = await removal;
          assert.notEqual(answer.error?.code, DEADLOCK, `the write: ${answer.error?.message}`);
          assert.notEqual(error?.code, DEADLOCK, `Remove: ${failure(error)}`);
          assert.equal(answer.error, null, `the write lands: ${answer.error?.message}`);
          assert.equal(await write.landed(member.personId), true, "the write landed");
          assert.deepEqual(refusal(error), { code: CONFLICT, message: "CONFLICT" }, failure(error));
          assert.equal(data, null);
          assert.ok(await currentEntry(f, member.personId), "still on the roster");
        } finally {
          if (open) await volunteer.query("rollback");
          await volunteer.end();
        }
      });

      // (b) Remove has the membership and is held up at the profile (another
      // connection holds it). The volunteer's write then waits on its own
      // membership, holding nothing Remove needs. Remove lands, the
      // membership is inactive, and the write is refused, never a deadlock.
      await t.test(`Remove holds the membership, then ${write.name}: the write waits, then is refused`, async () => {
        n += 1;
        const member = await f.staff({ key: `race_b${n}`, name: `Vic Bellamy ${n}`, capabilities: ["prepare"] });
        const blocker = await openDatabase({ kind: "test" });
        let open = false;
        try {
          const revision = await profileRevision(f, member.personId);
          await blocker.query("begin");
          open = true;
          await blocker.query(
            "select 1 from public.volunteer_profiles where workspace_id=$1 and person_id=$2 for update",
            [f.workspaceId, member.personId],
          );
          const removal = remove(sc, { volunteerId: member.personId, revision }).then((answer) => answer);
          assert.equal(await waitingOn("vitally_remove_from_roster"), true, "Remove waits on the profile");
          const pending = write.rpc(member).then((answer) => answer);
          assert.equal(await waitingOn(write.fn), true, "the write waits");
          await blocker.query("commit");
          open = false;
          const { data, error } = await removal;
          const answer = await pending;
          assert.notEqual(error?.code, DEADLOCK, `Remove: ${failure(error)}`);
          assert.notEqual(answer.error?.code, DEADLOCK, `the write: ${failure(answer.error)}`);
          assert.equal(error, null, `Remove lands: ${failure(error)}`);
          assert.equal(data.accountDeactivated, true);
          assert.deepEqual(refusal(answer.error), { code: FORBIDDEN, message: "FORBIDDEN" }, failure(answer.error));
          assert.equal(await write.landed(member.personId), false, "the write did not land");
          assert.equal(await currentEntry(f, member.personId), null);
          assert.equal((await membershipOf(f, member.userId)).active, false);
        } finally {
          if (open) await blocker.query("rollback");
          await blocker.end();
        }
      });
    }
  } finally {
    await f.close();
  }
});
