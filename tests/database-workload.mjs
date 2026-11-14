import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createDatabaseFixture,
  applyArgs,
  rejected,
  PREPARER,
  REVIEWER,
} from "./support/database-fixture.mjs";
import { createAppError } from "../src/errors.mjs";

// OpenSpec change add-volunteer-workload (design D5 and D7), migration 046: an
// admin assigns or reassigns a case's preparer or reviewer with ASSIGN_CASE
// {slot, personId, expectedHolderId}. Spec: volunteer-workload, "An admin assigns or reassigns a
// case's preparer or reviewer"; and volunteer-clearance, "Staff assign work
// only to a cleared person" (the scenario "Assigning a reviewer whose role is
// narrower than the ceiling" is the `ceiling wider than roles` case below).
// The file shares one fixture; every staff member it adds has a person key of
// its own, since `add_staff_member` refuses changed values for an existing key.
// Every query is scoped to the fixture's own workspace.

const FINDINGS = "Recheck the fictional mileage entry.";
const RESOLUTION = "Corrected and rechecked in external software.";
// The claim functions' client lines (003 act_claim_preparation, 006 act_claim_review).
const PREPARING_LINE = "A volunteer has started preparing your return.";
const REVIEWING_LINE = "An independent reviewer is checking your return.";
const COORDINATOR_CAPABILITIES = Object.freeze(["admin", "followup", "assist", "receive_documents"]);

// The current season's roles of one person, as tests/database-clearance.mjs sets them.
const setCurrentRoles = (f, personId, roles) =>
  f.sql(
    `update public.roster_entries r set roles=$3::text[] from public.workspaces w
      where w.id=r.workspace_id and r.season=w.current_season and r.workspace_id=$1 and r.person_id=$2`,
    [f.workspaceId, personId, roles],
  );

// The refusal checks' helpers, for one fixture. Every query is scoped to
// the fixture's workspace.
const helpers = (f) => {
  const revisionOf = async (caseId) =>
    Number(
      (
        await f.sql("select revision from public.cases where workspace_id=$1 and id=$2", [
          f.workspaceId,
          caseId,
        ])
      ).rows[0].revision,
    );
  // Everything an assignment could write for one case: the case's slots,
  // stage and revision, its preparation participants and its reviews.
  const caseState = async (caseId) => ({
    case: (
      await f.sql(
        "select stage,preparer_id,reviewer_id,revision from public.cases where workspace_id=$1 and id=$2",
        [f.workspaceId, caseId],
      )
    ).rows,
    participants: (
      await f.sql(
        "select person_id from public.preparation_participants where workspace_id=$1 and case_id=$2 order by person_id",
        [f.workspaceId, caseId],
      )
    ).rows,
    reviews: (
      await f.sql(
        "select to_jsonb(r.*) as record from public.reviews r where r.workspace_id=$1 and r.case_id=$2 order by r.id",
        [f.workspaceId, caseId],
      )
    ).rows,
  });
  // The slot's holder now, as an admin's open drawer would have it.
  const holderOf = async (caseId, slot) =>
    (
      await f.sql(
        `select ${slot === "reviewer" ? "reviewer_id" : "preparer_id"} as holder from public.cases
          where workspace_id=$1 and id=$2`,
        [f.workspaceId, caseId],
      )
    ).rows[0].holder;
  // The payload with `expectedHolderId` set to the slot's holder now, unless
  // it already names one (or `raw` sends it exactly as given).
  const withHolder = async (caseId, payload, raw) =>
    raw || "expectedHolderId" in payload
      ? payload
      : { ...payload, expectedHolderId: await holderOf(caseId, payload.slot) };
  // One ASSIGN_CASE sent straight to the RPC, so the action id is known.
  // Resolves with the mapped error, or null when it was accepted.
  const send = async (client, caseId, payload, { revision, raw } = {}) => {
    const args = applyArgs({
      caseId,
      revision: revision ?? (await revisionOf(caseId)),
      type: "ASSIGN_CASE",
      payload: await withHolder(caseId, payload, raw),
    });
    const { error } = await client.rpc("vitally_apply_action", args);
    return { actionId: args.p_action_id, error: error ? createAppError(error) : null };
  };
  // A refusal with `code` that writes nothing and stores no receipt.
  const refused = async (code, client, caseId, payload, options) => {
    const before = await caseState(caseId);
    const { actionId, error } = await send(client, caseId, payload, options);
    assert.ok(error, `ASSIGN_CASE ${JSON.stringify(payload)} was accepted`);
    assert.ok(
      rejected(code)(error),
      `expected ${code}, got ${error.code} (${error.cause?.code} ${error.cause?.message})`,
    );
    assert.deepEqual(await caseState(caseId), before, "the case is unchanged");
    assert.equal(await f.receiptsFor(actionId), 0, "no receipt is stored");
  };
  return { revisionOf, holderOf, withHolder, caseState, send, refused };
};

test("ASSIGN_CASE refusals against real Supabase", async (t) => {
  const f = await createDatabaseFixture();
  try {
    const { revisionOf, refused } = helpers(f);
    const RAW = { raw: true };

    await t.test("non-admin caller → FORBIDDEN", async () => {
      const caseId = await f.readyCase();
      await refused("FORBIDDEN", f.reviewer, caseId, { slot: "preparer", personId: f.preparerId });
    });

    await t.test("unknown person → FORBIDDEN", async () => {
      const caseId = await f.readyCase();
      await refused("FORBIDDEN", f.siteCoordinator, caseId, { slot: "preparer", personId: randomUUID() });
      // A person of another workspace is not in this one.
      await refused("FORBIDDEN", f.siteCoordinator, caseId, { slot: "preparer", personId: f.foreignStaffId });
    });

    await t.test("bad payload → VALIDATION", async () => {
      const caseId = await f.readyCase();
      for (const payload of [
        { slot: "helper", personId: f.preparerId },
        { slot: "preparer" },
        { slot: "preparer", personId: f.preparerId, note: "x" },
        { slot: "preparer", personId: "not-a-uuid" },
        { slot: "preparer", personId: f.preparerId, expectedHolderId: "not-a-uuid" },
        { slot: "preparer", personId: f.preparerId, expectedHolderId: 5 },
        {},
      ])
        await refused("VALIDATION", f.siteCoordinator, caseId, payload, RAW);
      // Without expectedHolderId: the key is required, null for an empty slot.
      await refused("VALIDATION", f.siteCoordinator, caseId, { slot: "preparer", personId: f.preparerId }, RAW);
    });

    await t.test("not allowed at this stage → INVALID_TRANSITION", async () => {
      const { caseId: received } = await f.submittedClientCase();
      await refused("INVALID_TRANSITION", f.siteCoordinator, received, {
        slot: "preparer",
        personId: f.preparerId,
      });

      // A cleared preparer who is not the case's preparer, so the stage is the
      // only reason for the refusal (the spec's scenario "After approval").
      const penn = await f.staff({ key: "penn_prep", name: "Penn Aldana", capabilities: ["prepare"] });
      const approved = await f.approvedCase();
      await refused("INVALID_TRANSITION", f.siteCoordinator, approved, {
        slot: "preparer",
        personId: penn.personId,
      });

      const preparing = await f.readyCase();
      await f.act(f.preparer, preparing, "CLAIM_PREPARATION", {});
      await refused("INVALID_TRANSITION", f.siteCoordinator, preparing, {
        slot: "reviewer",
        personId: f.reviewerId,
      });

      const corrections = await f.preparedCase();
      await f.act(f.reviewer, corrections, "CLAIM_REVIEW", {});
      await f.act(f.reviewer, corrections, "REQUEST_CORRECTIONS", { findings: FINDINGS });
      await refused("INVALID_TRANSITION", f.siteCoordinator, corrections, {
        slot: "reviewer",
        personId: f.reviewerId,
      });
    });

    await t.test("same holder again → INVALID_TRANSITION", async () => {
      const caseId = await f.readyCase();
      await f.act(f.preparer, caseId, "CLAIM_PREPARATION", {});
      await refused("INVALID_TRANSITION", f.siteCoordinator, caseId, {
        slot: "preparer",
        personId: f.preparerId,
      });
    });

    await t.test("uncleared assignee → INELIGIBLE", async () => {
      const una = await f.staff({
        key: "una_prep",
        name: "Una Prell",
        capabilities: ["prepare"],
        cleared: false,
      });
      const caseId = await f.readyCase();
      await refused("INELIGIBLE", f.siteCoordinator, caseId, { slot: "preparer", personId: una.personId });
    });

    // The volunteer-clearance scenario "Assigning a reviewer whose role is
    // narrower than the ceiling": the ceiling holds `review`, the role does not.
    await t.test("ceiling wider than roles → INELIGIBLE", async () => {
      const wren = await f.staff({
        key: "wren_ceiling",
        name: "Wren Okafor",
        capabilities: ["prepare", "review"],
      });
      await setCurrentRoles(f, wren.personId, ["preparer"]);
      const caseId = await f.preparedCase();
      await refused("INELIGIBLE", f.siteCoordinator, caseId, { slot: "reviewer", personId: wren.personId });
    });

    await t.test("participant as reviewer → SELF_REVIEW", async () => {
      const dana = await f.staff({
        key: "dana_holt",
        name: "Dana Holt",
        capabilities: ["prepare", "review"],
      });
      const caseId = await f.readyCase();
      await f.act(dana.client, caseId, "CLAIM_PREPARATION", {});
      await f.act(dana.client, caseId, "SUBMIT_REVIEW", { questionnaire: PREPARER });
      await refused("SELF_REVIEW", f.siteCoordinator, caseId, { slot: "reviewer", personId: dana.personId });
    });

    await t.test("current reviewer as preparer → SELF_REVIEW", async () => {
      const casey = await f.staff({
        key: "casey_marsh",
        name: "Casey Marsh",
        capabilities: ["prepare", "review"],
      });
      const caseId = await f.preparedCase();
      await f.act(casey.client, caseId, "CLAIM_REVIEW", {});
      await refused("SELF_REVIEW", f.siteCoordinator, caseId, { slot: "preparer", personId: casey.personId });
    });

    await t.test("uncleared caller → NOT_CLEARED", async () => {
      const caseId = await f.readyCase();
      await setCurrentRoles(f, f.siteCoordinatorId, []);
      try {
        await refused("NOT_CLEARED", f.siteCoordinator, caseId, { slot: "preparer", personId: f.preparerId });
      } finally {
        await f.clearStaff(f.siteCoordinatorId, [...COORDINATOR_CAPABILITIES]);
      }
    });

    // The review finding on PR #195: an Assign drawer opened on an empty slot,
    // and a volunteer claims the case before the admin presses Choose. The
    // admin's press names the holder it saw (none), so it is refused whatever
    // revision it carries, and the claimant keeps the case.
    await t.test("claimed while the drawer is open → CONFLICT", async () => {
      const noor = await f.staff({ key: "noor_bassi", name: "Noor Bassi", capabilities: ["prepare", "review"] });
      const ready = await f.readyCase();
      const seen = await revisionOf(ready);
      await f.act(f.preparer, ready, "CLAIM_PREPARATION", {});
      const assignSeen = { slot: "preparer", personId: noor.personId, expectedHolderId: null };
      // The revision the drawer opened with: the pipeline's revision check.
      await refused("CONFLICT", f.siteCoordinator, ready, assignSeen, { revision: seen });
      // The current revision, as a caller re-reading the case would send: the
      // handler's holder check.
      await refused("CONFLICT", f.siteCoordinator, ready, assignSeen);

      // The reviewer slot the same way.
      const prepared = await f.preparedCase();
      await f.act(f.reviewer, prepared, "CLAIM_REVIEW", {});
      await refused("CONFLICT", f.siteCoordinator, prepared, {
        slot: "reviewer",
        personId: noor.personId,
        expectedHolderId: null,
      });

      // A Reassign that names someone other than the holder.
      await refused("CONFLICT", f.siteCoordinator, ready, {
        slot: "preparer",
        personId: noor.personId,
        expectedHolderId: f.reviewerId,
      });
    });

    await t.test("stale revision → CONFLICT", async () => {
      const caseId = await f.readyCase();
      await refused(
        "CONFLICT",
        f.siteCoordinator,
        caseId,
        { slot: "preparer", personId: f.preparerId },
        { revision: (await revisionOf(caseId)) - 1 },
      );
    });
  } finally {
    await f.close();
  }
});

// Spec: volunteer-workload, "Assigning an empty slot has the effects of the
// person's own claim", "A reassignment hands over the work in progress" and
// "Every assignment is in the case history" (design D5, D6).
test("ASSIGN_CASE effects against real Supabase", async (t) => {
  const f = await createDatabaseFixture();
  try {
    const { revisionOf, refused, caseState, withHolder } = helpers(f);
    const assign = async (caseId, slot, personId) =>
      f.act(f.siteCoordinator, caseId, "ASSIGN_CASE", await withHolder(caseId, { slot, personId }));
    const caseRow = async (caseId) =>
      (
        await f.sql(
          "select stage,preparer_id,reviewer_id,preparation_version from public.cases where workspace_id=$1 and id=$2",
          [f.workspaceId, caseId],
        )
      ).rows[0];
    const participants = async (caseId) =>
      (
        await f.sql(
          "select person_id from public.preparation_participants where workspace_id=$1 and case_id=$2",
          [f.workspaceId, caseId],
        )
      ).rows
        .map((row) => row.person_id)
        .sort();
    const reviews = async (caseId) =>
      (
        await f.sql(
          `select id,status,reviewer_person_id,preparation_version,created_at from public.reviews
            where workspace_id=$1 and case_id=$2 order by created_at,id`,
          [f.workspaceId, caseId],
        )
      ).rows;
    const assignEvents = async (caseId) =>
      (
        await f.sql(
          `select actor_person_id,detail from public.case_events
            where workspace_id=$1 and case_id=$2 and action='ASSIGN_CASE' order by created_at,id`,
          [f.workspaceId, caseId],
        )
      ).rows;

    const jordan = await f.staff({ key: "jordan_park", name: "Jordan Park", capabilities: ["prepare"] });
    const riley = await f.staff({ key: "riley_quinn", name: "Riley Quinn", capabilities: ["review"] });

    await t.test("assign preparer", async () => {
      const caseId = await f.readyCase();
      await assign(caseId, "preparer", f.preparerId);
      const row = await caseRow(caseId);
      assert.equal(row.stage, "preparing");
      assert.equal(row.preparer_id, f.preparerId);
      assert.deepEqual(await participants(caseId), [f.preparerId]);
      assert.equal((await f.clientMessages(caseId)).at(-1), PREPARING_LINE);
      assert.deepEqual(await assignEvents(caseId), [
        {
          actor_person_id: f.siteCoordinatorId,
          detail: { slot: "preparer", personId: f.preparerId, previousPersonId: null },
        },
      ]);
    });

    await t.test("assign reviewer", async () => {
      const caseId = await f.preparedCase();
      await assign(caseId, "reviewer", f.reviewerId);
      const row = await caseRow(caseId);
      assert.equal(row.stage, "reviewing");
      assert.equal(row.reviewer_id, f.reviewerId);
      const rows = await reviews(caseId);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].status, "active");
      assert.equal(rows[0].reviewer_person_id, f.reviewerId);
      assert.equal(Number(rows[0].preparation_version), Number(row.preparation_version));
      assert.equal((await f.clientMessages(caseId)).at(-1), REVIEWING_LINE);
      assert.deepEqual(await assignEvents(caseId), [
        {
          actor_person_id: f.siteCoordinatorId,
          detail: { slot: "reviewer", personId: f.reviewerId, previousPersonId: null },
        },
      ]);
    });

    await t.test("reassign preparer during corrections", async () => {
      const caseId = await f.preparedCase();
      await f.act(f.reviewer, caseId, "CLAIM_REVIEW", {});
      await f.act(f.reviewer, caseId, "REQUEST_CORRECTIONS", { findings: FINDINGS });
      const messagesBefore = await f.clientMessages(caseId);
      await assign(caseId, "preparer", jordan.personId);
      const row = await caseRow(caseId);
      assert.equal(row.stage, "corrections_required");
      assert.equal(row.preparer_id, jordan.personId);
      assert.deepEqual(await participants(caseId), [f.preparerId, jordan.personId].sort());
      assert.deepEqual(await f.clientMessages(caseId), messagesBefore, "no client line");
      assert.deepEqual(await assignEvents(caseId), [
        {
          actor_person_id: f.siteCoordinatorId,
          detail: { slot: "preparer", personId: jordan.personId, previousPersonId: f.preparerId },
        },
      ]);
      await f.act(jordan.client, caseId, "RESUBMIT_REVIEW", { questionnaire: PREPARER, resolution: RESOLUTION });
      assert.equal((await caseRow(caseId)).stage, "review_ready");
    });

    // A preparer handover during review keeps the stage and the review: the
    // new preparer becomes a participant, and the active review is untouched.
    await t.test("reassign preparer at reviewing", async () => {
      const caseId = await f.preparedCase();
      await f.act(f.reviewer, caseId, "CLAIM_REVIEW", {});
      const reviewsBefore = await reviews(caseId);
      const messagesBefore = await f.clientMessages(caseId);
      await assign(caseId, "preparer", jordan.personId);
      const row = await caseRow(caseId);
      assert.equal(row.stage, "reviewing");
      assert.equal(row.preparer_id, jordan.personId);
      assert.equal(row.reviewer_id, f.reviewerId);
      assert.deepEqual(await participants(caseId), [f.preparerId, jordan.personId].sort());
      assert.deepEqual(await reviews(caseId), reviewsBefore, "the active review is untouched");
      assert.deepEqual(await f.clientMessages(caseId), messagesBefore, "no client line");
      assert.deepEqual(await assignEvents(caseId), [
        {
          actor_person_id: f.siteCoordinatorId,
          detail: { slot: "preparer", personId: jordan.personId, previousPersonId: f.preparerId },
        },
      ]);
    });

    await t.test("reassign preparer at review_ready", async () => {
      const caseId = await f.preparedCase();
      const messagesBefore = await f.clientMessages(caseId);
      await assign(caseId, "preparer", jordan.personId);
      const row = await caseRow(caseId);
      assert.equal(row.stage, "review_ready");
      assert.equal(row.preparer_id, jordan.personId);
      assert.equal(row.reviewer_id, null);
      assert.deepEqual(await participants(caseId), [f.preparerId, jordan.personId].sort());
      assert.deepEqual(await reviews(caseId), [], "no review is opened");
      assert.deepEqual(await f.clientMessages(caseId), messagesBefore, "no client line");
    });

    // An identical ASSIGN_CASE resent with the same action id returns the
    // stored receipt and writes nothing more.
    await t.test("replay returns the stored receipt", async () => {
      const caseId = await f.readyCase();
      const args = applyArgs({
        caseId,
        revision: await revisionOf(caseId),
        type: "ASSIGN_CASE",
        payload: { slot: "preparer", personId: f.preparerId, expectedHolderId: null },
      });
      const first = await f.siteCoordinator.rpc("vitally_apply_action", args);
      assert.equal(first.error, null);
      const after = await caseState(caseId);
      const events = await assignEvents(caseId);
      const messages = await f.clientMessages(caseId);
      const replay = await f.siteCoordinator.rpc("vitally_apply_action", args);
      assert.equal(replay.error, null);
      assert.deepEqual(replay.data, first.data, "the stored receipt");
      assert.deepEqual(await caseState(caseId), after, "nothing more is written");
      assert.deepEqual(await assignEvents(caseId), events, "no second event");
      assert.deepEqual(await f.clientMessages(caseId), messages, "no second client line");
      assert.equal(await f.receiptsFor(args.p_action_id), 1, "one receipt");
    });

    // A case at reviewing whose active review f.reviewer claimed and the admin
    // then handed to Riley Quinn, with the case's reviews as they were before.
    const handedToRiley = async () => {
      const caseId = await f.preparedCase();
      await f.act(f.reviewer, caseId, "CLAIM_REVIEW", {});
      const before = await reviews(caseId);
      await assign(caseId, "reviewer", riley.personId);
      return { caseId, before };
    };

    await t.test("reassign reviewer mid-review", async () => {
      const { caseId, before } = await handedToRiley();
      const active = before.filter((review) => review.status === "active");
      assert.equal(active.length, 1);
      const after = await reviews(caseId);
      assert.equal(after.length, before.length, "no new review");
      const handed = after.find((review) => review.id === active[0].id);
      assert.ok(handed, "the same review");
      assert.equal(handed.status, "active");
      assert.equal(handed.reviewer_person_id, riley.personId);
      assert.equal(new Date(handed.created_at).getTime(), new Date(active[0].created_at).getTime());
      assert.equal(Number(handed.preparation_version), Number(active[0].preparation_version));
      const row = await caseRow(caseId);
      assert.equal(row.stage, "reviewing");
      assert.equal(row.reviewer_id, riley.personId);
      assert.deepEqual(await assignEvents(caseId), [
        {
          actor_person_id: f.siteCoordinatorId,
          detail: { slot: "reviewer", personId: riley.personId, previousPersonId: f.reviewerId },
        },
      ]);
      await f.act(riley.client, caseId, "APPROVE_REVIEW", { questionnaire: REVIEWER });
      assert.equal((await caseRow(caseId)).stage, "review_approved");
    });

    // The spec's "The previous reviewer's stale screen": sent straight to the
    // RPC at the current revision, as an already open screen would.
    await t.test("old reviewer refused", async () => {
      const { caseId } = await handedToRiley();
      const args = applyArgs({
        caseId,
        revision: await revisionOf(caseId),
        type: "APPROVE_REVIEW",
        payload: { questionnaire: REVIEWER },
      });
      const { error } = await f.reviewer.rpc("vitally_apply_action", args);
      assert.ok(error, "the previous reviewer's approval was accepted");
      const mapped = createAppError(error);
      assert.ok(rejected("FORBIDDEN")(mapped), `expected FORBIDDEN, got ${mapped.code}`);
      assert.equal(await f.receiptsFor(args.p_action_id), 0, "no receipt is stored");
      assert.equal((await caseRow(caseId)).stage, "reviewing");
      const questionnaires = await f.sql(
        "select count(*)::int as n from public.reviewer_questionnaires where workspace_id=$1 and case_id=$2",
        [f.workspaceId, caseId],
      );
      assert.equal(questionnaires.rows[0].n, 0, "no reviewer questionnaire");
    });

    await t.test("former preparer never reviewer", async () => {
      const kim = await f.staff({
        key: "kim_sato_former",
        name: "Kim Sato",
        capabilities: ["prepare", "review"],
      });
      const caseId = await f.readyCase();
      await f.act(kim.client, caseId, "CLAIM_PREPARATION", {});
      await assign(caseId, "preparer", jordan.personId);
      await f.act(jordan.client, caseId, "SUBMIT_REVIEW", { questionnaire: PREPARER });
      assert.equal((await caseRow(caseId)).stage, "review_ready");
      await refused("SELF_REVIEW", f.siteCoordinator, caseId, { slot: "reviewer", personId: kim.personId });
    });
  } finally {
    await f.close();
  }
});
