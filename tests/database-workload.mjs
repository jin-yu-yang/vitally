import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createDatabaseFixture,
  applyArgs,
  rejected,
  PREPARER,
} from "./support/database-fixture.mjs";
import { createAppError } from "../src/errors.mjs";

// OpenSpec change add-volunteer-workload (design D5 and D7), migration 046: an
// admin assigns or reassigns a case's preparer or reviewer with ASSIGN_CASE
// {slot, personId}. Spec: volunteer-workload, "An admin assigns or reassigns a
// case's preparer or reviewer"; and volunteer-clearance, "Staff assign work
// only to a cleared person" (the scenario "Assigning a reviewer whose role is
// narrower than the ceiling" is the `ceiling wider than roles` case below).
// The file shares one fixture; every staff member it adds has a person key of
// its own, since `add_staff_member` refuses changed values for an existing key.
// Every query is scoped to the fixture's own workspace.

const FINDINGS = "Recheck the fictional mileage entry.";
const COORDINATOR_CAPABILITIES = Object.freeze(["admin", "followup", "assist", "receive_documents"]);

// The current season's roles of one person, as tests/database-clearance.mjs sets them.
const setCurrentRoles = (f, personId, roles) =>
  f.sql(
    `update public.roster_entries r set roles=$3::text[] from public.workspaces w
      where w.id=r.workspace_id and r.season=w.current_season and r.workspace_id=$1 and r.person_id=$2`,
    [f.workspaceId, personId, roles],
  );

test("ASSIGN_CASE refusals against real Supabase", async (t) => {
  const f = await createDatabaseFixture();
  try {
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
    // One ASSIGN_CASE sent straight to the RPC, so the action id is known.
    // Resolves with the mapped error, or null when it was accepted.
    const send = async (client, caseId, payload, { revision } = {}) => {
      const args = applyArgs({
        caseId,
        revision: revision ?? (await revisionOf(caseId)),
        type: "ASSIGN_CASE",
        payload,
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
        {},
      ])
        await refused("VALIDATION", f.siteCoordinator, caseId, payload);
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
