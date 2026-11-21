import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabaseFixture } from "./support/database-fixture.mjs";

// OpenSpec change add-start-next-season (design D1-D4), migration 055 §4 and
// §5: a site coordinator starts the next season with one call. It is refused
// for anyone else, for a stale season or a wrong typed year, and with counts
// while work is unfinished. A start moves the season by one, keeps site
// coordinators, deactivates every other staff account, puts the starter alone
// on the new roster, recomputes the capability mirror and records the start.
// A rollover is one-way, so each scenario has its own fixture. Cases are
// finished before the season moves, since a past-season case is read-only
// (055 §1).

const one = async (f, text, values) => (await f.sql(text, values)).rows[0];
const seasonOf = async (f) =>
  Number((await one(f, "select current_season from public.workspaces where id=$1", [f.workspaceId])).current_season);
const start = (client, { actionId = randomUUID(), expected, typed }) =>
  client.rpc("vitally_start_next_season", {
    p_action_id: actionId,
    p_expected_season: expected,
    p_typed_year: typed,
  });
const refusal = (error) => error && { code: error.code, message: error.message };
const failure = (error) => `${error?.code} ${error?.message} ${error?.details}`;

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
const stageOf = async (f, caseId) =>
  (await one(f, "select stage from public.cases where id=$1 and workspace_id=$2", [caseId, f.workspaceId])).stage;
const helpItem = async (f, { caseId = null, assignee = null } = {}) =>
  (
    await one(
      f,
      `insert into public.assistance_items(workspace_id,case_id,title,status,revision,assignee_person_id,language,contact_preference)
       values($1,$2,$3,$4,1,$5,$6,$7) returning id`,
      [
        f.workspaceId,
        caseId,
        f.sampleAssistance.title,
        assignee ? "assigned" : "open",
        assignee,
        f.sampleAssistance.language,
        f.sampleAssistance.contactPreference,
      ],
    )
  ).id;
const accountOf = (f, userId) =>
  one(f, "select to_jsonb(a.*) as row from public.accounts a where a.workspace_id=$1 and a.user_id=$2", [
    f.workspaceId,
    userId,
  ]).then((r) => r?.row ?? null);
const membershipOf = (f, userId) =>
  one(f, "select to_jsonb(m.*) as row from public.memberships m where m.workspace_id=$1 and m.user_id=$2", [
    f.workspaceId,
    userId,
  ]).then((r) => r?.row ?? null);
// The staff accounts a start deactivates: invited or active, not a site
// coordinator's (Ruling R2: read from this fixture, never hard-coded).
const resettableCount = async (f) =>
  (
    await one(
      f,
      `select count(*)::int as n from public.accounts a
        join public.memberships m on m.workspace_id=a.workspace_id and m.user_id=a.user_id
        where a.workspace_id=$1 and m.access='staff' and a.status in ('invited','active') and not a.is_site_coordinator`,
      [f.workspaceId],
    )
  ).n;
const seasonRows = async (f, table, season) =>
  (
    await f.sql(
      `select to_jsonb(t.*) as row from public.${table} t where t.workspace_id=$1 and t.season=$2 order by to_jsonb(t.*)::text`,
      [f.workspaceId, season],
    )
  ).rows.map((r) => r.row);
const startsOf = async (f) =>
  (
    await f.sql(
      `select from_season,to_season,started_by_person_id,default_followup_from,default_followup_to,deactivated_count
        from public.season_starts where workspace_id=$1 order by started_at`,
      [f.workspaceId],
    )
  ).rows;
const setDefaultFollowup = (f, personKey) =>
  f.sql("select vitally_private.set_default_followup($1,$2)", [f.workspaceId, personKey]);
const defaultFollowupOf = async (f) =>
  (await one(f, "select default_followup_person_id as id from public.workspaces where id=$1", [f.workspaceId])).id;

test("starting the next season is refused", async (t) => {
  const f = await createDatabaseFixture();
  try {
    // Unfinished work of every kind, plus what doesn't count: an Accepted
    // case, a Closed case, a help request with no case, and a draft. First the older-season
    // case: a case's season is fixed once it is numbered (010), so it is left
    // at Rejected and the workspace's season moves on by SQL. Clearance is per
    // season (045), so the staff are cleared for the new one too.
    const rejectedCase = await f.approvedCase();
    await f.act(f.siteCoordinator, rejectedCase, "MARK_READY_TO_EFILE", { confirmed: true });
    await f.act(f.siteCoordinator, rejectedCase, "MARK_EFILED", {
      confirmed: true,
      methods: { federal: "efile", state: "efile" },
    });
    const day = (await one(f, "select (now() at time zone 'America/New_York')::date::text as d")).d;
    await f.act(f.siteCoordinator, rejectedCase, "RECORD_FILING_RESULT", {
      confirmed: true,
      results: { federal: { result: "rejected", date: day, code: "C1" } },
    });
    await f.sql("update public.workspaces set current_season=current_season+1 where id=$1", [f.workspaceId]);
    for (const member of f.setup.staff) {
      const { id } = await one(f, "select id from public.people where workspace_id=$1 and person_key=$2", [
        f.workspaceId,
        member.personKey,
      ]);
      await f.clearStaff(id, member.capabilities, f.workspaceId, { siteCoordinator: member.siteCoordinator });
    }
    const season = await seasonOf(f);
    assert.equal(
      Number((await one(f, "select season from public.cases where id=$1 and workspace_id=$2", [rejectedCase, f.workspaceId])).season),
      season - 1,
    );
    const readyToEfile = await f.approvedCase();
    await f.act(f.siteCoordinator, readyToEfile, "MARK_READY_TO_EFILE", { confirmed: true });
    const efiled = await f.approvedCase();
    await f.act(f.siteCoordinator, efiled, "MARK_READY_TO_EFILE", { confirmed: true });
    await f.act(f.siteCoordinator, efiled, "MARK_EFILED", {
      confirmed: true,
      methods: { federal: "efile", state: "efile" },
    });
    const accepted = await acceptedCase(f);
    const closed = await f.approvedCase();
    await f.act(f.siteCoordinator, closed, "MARK_READY_TO_EFILE", { confirmed: true });
    await f.act(f.siteCoordinator, closed, "MARK_EFILED", {
      confirmed: true,
      methods: { federal: "efile", state: "efile" },
    });
    await f.act(f.siteCoordinator, closed, "RECORD_FILING_RESULT", {
      confirmed: true,
      results: { federal: { result: "rejected", date: day, code: "C1" } },
    });
    await f.act(f.siteCoordinator, closed, "CLOSE_CASE", { confirmed: true, reason: "dismissed" });
    await f.sql(
      `insert into public.admin_followups(workspace_id,case_id,request_id,purpose,assignee_person_id,status,reason,created_by_person_id)
       values($1,$2,null,'go_over_return',$3,'open','Fictional: go over the return with the client.',$3)`,
      [f.workspaceId, accepted, f.siteCoordinatorId],
    );
    await helpItem(f, { assignee: f.siteCoordinatorId });
    await helpItem(f, { caseId: accepted });
    await helpItem(f);
    const { caseId: draft } = await f.draftCase(f.applicantB);
    assert.deepEqual(
      {
        readyToEfile: await stageOf(f, readyToEfile),
        efiled: await stageOf(f, efiled),
        rejected: await stageOf(f, rejectedCase),
        accepted: await stageOf(f, accepted),
        closed: await stageOf(f, closed),
        draft: await stageOf(f, draft),
      },
      {
        readyToEfile: "ready_to_efile",
        efiled: "efiled",
        rejected: "rejected",
        accepted: "accepted",
        closed: "closed",
        draft: "draft",
      },
    );
    const admin = await f.staff({ key: "ines_admin", name: "Ines Dalton", capabilities: ["admin", "followup"] });
    const before = await f.stateSnapshot();
    const unchanged = async () => {
      assert.equal(await seasonOf(f), season);
      assert.equal(await startsOf(f).then((rows) => rows.length), 0);
      assert.deepEqual(await f.stateSnapshot(), before);
    };

    await t.test("an admin who isn't a site coordinator is FORBIDDEN, with no receipt", async () => {
      const actionId = randomUUID();
      const { data, error } = await start(admin.client, { actionId, expected: season, typed: season + 1 });
      assert.equal(data, null);
      assert.deepEqual(refusal(error), { code: "VT001", message: "FORBIDDEN" });
      assert.equal(await f.receiptsFor(actionId), 0);
      await unchanged();
    });

    await t.test("the wrong typed year is VALIDATION", async () => {
      for (const typed of [season + 2, season])
        assert.deepEqual(
          refusal((await start(f.siteCoordinator, { expected: season, typed })).error),
          { code: "VT007", message: "VALIDATION" },
          String(typed),
        );
      await unchanged();
    });

    await t.test("a stale expected season is CONFLICT", async () => {
      const { error } = await start(f.siteCoordinator, { expected: season - 1, typed: season });
      assert.deepEqual(refusal(error), { code: "VT003", message: "CONFLICT" });
      await unchanged();
    });

    await t.test("SEASON_NOT_FINISHED counts each kind", async () => {
      const { data, error } = await start(f.siteCoordinator, { expected: season, typed: season + 1 });
      assert.equal(data, null);
      assert.deepEqual(refusal(error), { code: "VT004", message: "SEASON_NOT_FINISHED" });
      assert.deepEqual(JSON.parse(error.details), {
        openCases: 3,
        openFollowups: 1,
        claimedHelp: 1,
        unclaimedHelpOnCases: 1,
      });
      await unchanged();
    });
  } finally {
    await f.close();
  }
});

test("a start moves the season and resets staff", async (t) => {
  const f = await createDatabaseFixture();
  try {
    const season = await seasonOf(f);
    const sc = { client: f.siteCoordinator, userId: f.siteCoordinatorUserId, personId: f.siteCoordinatorId };
    const sc2 = await f.staff({
      key: "morgan_sc",
      name: "Morgan Hale",
      capabilities: ["admin", "followup"],
      siteCoordinator: true,
    });
    const admin = await f.staff({ key: "ines_admin", name: "Ines Dalton", capabilities: ["admin", "followup"] });
    await setDefaultFollowup(f, "ines_admin");
    assert.equal(await defaultFollowupOf(f), admin.personId);
    const preparer = { userId: f.preparerUserId, personId: f.preparerId };
    const invited = await f.staff({ key: "ivo_invited", name: "Ivo Marsh", capabilities: ["prepare"] });
    await f.sql("update public.accounts set status='invited' where workspace_id=$1 and user_id=$2", [
      f.workspaceId,
      invited.userId,
    ]);
    const gone = await f.staff({ key: "dov_gone", name: "Dov Pryce", capabilities: ["prepare"] });
    await f.sql("update public.memberships set active=false where workspace_id=$1 and user_id=$2", [
      f.workspaceId,
      gone.userId,
    ]);
    await f.sql(
      "update public.accounts set status='deactivated',deactivated_at=now() where workspace_id=$1 and user_id=$2",
      [f.workspaceId, gone.userId],
    );
    // Every case finished: one Accepted case, prepared and reviewed by the
    // fixture's Preparer and Reviewer, who still have active accounts.
    const accepted = await acceptedCase(f);
    assert.equal(await stageOf(f, accepted), "accepted");

    // A client's draft from the old season: it has no season yet, so it
    // submits into the new one after the start.
    const { caseId: draft } = await f.draftCase(f.applicantB);

    const kept = [sc.userId, sc2.userId, f.applicantAUserId, gone.userId];
    const keptBefore = {};
    for (const userId of kept)
      keptBefore[userId] = { account: await accountOf(f, userId), membership: await membershipOf(f, userId) };
    const oldEntries = await seasonRows(f, "roster_entries", season);
    const oldCertificates = await seasonRows(f, "certificates", season);
    const expectedCount = await resettableCount(f);
    assert.ok(expectedCount >= 3, `the Admin, the Preparer and the invited volunteer at least (${expectedCount})`);
    for (const { userId } of [admin, preparer, invited])
      assert.ok(["invited", "active"].includes((await accountOf(f, userId)).status));

    const actionId = randomUUID();
    const first = await start(sc.client, { actionId, expected: season, typed: season + 1 });
    assert.equal(first.error, null, failure(first.error));

    await t.test("the season moves and staff are reset", async () => {
      assert.deepEqual(first.data, {
        actionId,
        season: season + 1,
        deactivated: expectedCount,
        defaultFollowupMoved: true,
      });
      assert.equal(await seasonOf(f), season + 1);
      // The starter alone is on the new roster, with no roles.
      const entries = (
        await f.sql(
          `select person_id,roles,is_new,photo_id_checked_at,added_by_person_id from public.roster_entries
            where workspace_id=$1 and season=$2`,
          [f.workspaceId, season + 1],
        )
      ).rows;
      assert.deepEqual(entries, [
        { person_id: sc.personId, roles: [], is_new: false, photo_id_checked_at: null, added_by_person_id: sc.personId },
      ]);
      assert.deepEqual(await seasonRows(f, "certificates", season + 1), []);
      assert.deepEqual(await seasonRows(f, "roster_entries", season), oldEntries);
      assert.deepEqual(await seasonRows(f, "certificates", season), oldCertificates);
      // Site coordinators, the client and the already-deactivated account.
      for (const userId of kept)
        assert.deepEqual(
          { account: await accountOf(f, userId), membership: await membershipOf(f, userId) },
          keptBefore[userId],
          userId,
        );
      // The Admin, the Preparer and the invited volunteer, and nobody left.
      for (const [name, { userId }] of Object.entries({ admin, preparer, invited })) {
        assert.equal((await accountOf(f, userId)).status, "deactivated", name);
        assert.equal((await membershipOf(f, userId)).active, false, name);
      }
      assert.equal(await resettableCount(f), 0);
      // The mirror: nobody has a role in the new season yet.
      const people = (
        await f.sql(
          `select id,capabilities,vitally_private.mirror_capabilities(workspace_id,id,user_id) as mirror
            from public.people where workspace_id=$1`,
          [f.workspaceId],
        )
      ).rows;
      for (const person of people) {
        assert.deepEqual(person.capabilities, person.mirror, person.id);
        assert.deepEqual(person.capabilities, [], person.id);
      }
      assert.equal(await defaultFollowupOf(f), sc.personId);
      assert.deepEqual(await startsOf(f), [
        {
          from_season: season,
          to_season: season + 1,
          started_by_person_id: sc.personId,
          default_followup_from: admin.personId,
          default_followup_to: sc.personId,
          deactivated_count: expectedCount,
        },
      ]);
    });

    await t.test("a retry returns the receipt, not CONFLICT", async () => {
      const again = await start(sc.client, { actionId, expected: season, typed: season + 1 });
      assert.equal(again.error, null, failure(again.error));
      assert.deepEqual(again.data, first.data);
      assert.equal(await seasonOf(f), season + 1);
      assert.equal((await startsOf(f)).length, 1);
    });

    await t.test("a draft from before the start submits as the new season's client 1", async () => {
      assert.equal(await stageOf(f, draft), "draft");
      await f.act(f.applicantB, draft, "SUBMIT", { confirmed: true });
      const row = await one(f, "select client_number,season from public.cases where id=$1 and workspace_id=$2", [
        draft,
        f.workspaceId,
      ]);
      assert.deepEqual({ clientNumber: Number(row.client_number), season: Number(row.season) }, {
        clientNumber: 1,
        season: season + 1,
      });
    });

    await t.test("signed-in users can't reach season_starts", async () => {
      const read = await sc.client.from("season_starts").select();
      assert.ok(read.error !== null || read.data.length === 0, "no rows");
      const write = await sc.client.from("season_starts").insert({
        workspace_id: f.workspaceId,
        from_season: season + 1,
        to_season: season + 2,
        started_by_person_id: sc.personId,
        deactivated_count: 0,
      });
      assert.notEqual(write.error, null);
      assert.equal((await startsOf(f)).length, 1);
    });
  } finally {
    await f.close();
  }
});

test("a site coordinator default follow-up person is kept", async () => {
  const f = await createDatabaseFixture();
  try {
    const season = await seasonOf(f);
    const sc2 = await f.staff({
      key: "morgan_sc",
      name: "Morgan Hale",
      capabilities: ["admin", "followup"],
      siteCoordinator: true,
    });
    await setDefaultFollowup(f, "morgan_sc");
    const { data, error } = await start(f.siteCoordinator, { expected: season, typed: season + 1 });
    assert.equal(error, null, failure(error));
    assert.equal(data.defaultFollowupMoved, false);
    assert.equal(await defaultFollowupOf(f), sc2.personId);
    assert.equal((await accountOf(f, sc2.userId)).status, "active");
    const rows = await startsOf(f);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].default_followup_from, null);
    assert.equal(rows[0].default_followup_to, null);
  } finally {
    await f.close();
  }
});
