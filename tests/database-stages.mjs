import test from "node:test";
import assert from "node:assert/strict";
import {
  createDatabaseFixture,
  applyArgs,
  rejected,
} from "./support/database-fixture.mjs";

// Migration 032: the main chain's three new stages (screening, ready_to_efile,
// efiled) and the three admin-only actions that move a case into them.
const SCREENING_LINE =
  "PCDC started reviewing your application. We may call you.";
const SIGNED_LINE =
  "PCDC recorded that your return is ready. PCDC will take the next step.";
const EFILED_LINE = "PCDC e-filed your return.";
const CALL_NOTE = "Told the fictional client the return is ready.";
const CLOSURE = {
  reason: "other",
  note: "The fictional client asked us to stop.",
  confirmed: true,
};
const CONFIRMED = { confirmed: true };
const EFILED = { confirmed: true, methods: { federal: "efile", state: "efile" } };

test("the main chain's new stages against real Supabase", async (t) => {
  const f = await createDatabaseFixture();
  try {
    const stageOf = async (caseId) => (await f.readStaffCase(caseId)).stage;

    await t.test(
      "an admin starts screening; the history tells the client",
      async () => {
        const { caseId } = await f.submittedClientCase();
        assert.equal(await stageOf(caseId), "received");
        await f.act(f.siteCoordinator, caseId, "START_SCREENING", {});
        assert.equal(await stageOf(caseId), "screening");
        assert.ok((await f.clientMessages(caseId)).includes(SCREENING_LINE));
        const staff = await f.readStaffCase(caseId);
        assert.equal(staff.internalHistory.at(-1).action, "START_SCREENING");
        assert.equal(staff.internalHistory.at(-1).actorPersonId, f.siteCoordinatorId);
        assert.deepEqual(staff.internalHistory.at(-1).detail, {});
      },
    );

    await t.test("START_SCREENING refusals, in check order", async () => {
      const { caseId } = await f.submittedClientCase();
      for (const personId of [f.alex, f.morgan, null])
        await assert.rejects(
          () => f.actAsPersona(f.presenter, caseId, personId, "START_SCREENING", {}),
          rejected("FORBIDDEN"),
        );
      // The client cannot start the office's screening either.
      await assert.rejects(
        () => f.act(f.applicantA, caseId, "START_SCREENING", {}),
        rejected("FORBIDDEN"),
      );
      await assert.rejects(
        () => f.act(f.siteCoordinator, caseId, "START_SCREENING", { x: 1 }),
        rejected("VALIDATION"),
      );
      await f.act(f.siteCoordinator, caseId, "START_SCREENING", {});
      await assert.rejects(
        () => f.act(f.siteCoordinator, caseId, "START_SCREENING", {}),
        rejected("INVALID_TRANSITION"),
      );
    });

    await t.test("VERIFY_INTAKE waits for screening", async () => {
      const { caseId } = await f.submittedClientCase();
      await assert.rejects(
        () =>
          f.act(f.siteCoordinator, caseId, "VERIFY_INTAKE", {
            checks: f.intakeChecks,
          }),
        rejected("INVALID_TRANSITION"),
      );
      assert.equal(await stageOf(caseId), "received");
      // Positive control: the same checks succeed once screening has started.
      await f.act(f.siteCoordinator, caseId, "START_SCREENING", {});
      await f.act(f.siteCoordinator, caseId, "VERIFY_INTAKE", {
        checks: f.intakeChecks,
      });
      assert.equal(await stageOf(caseId), "preparation_ready");
    });

    await t.test(
      "an office case lands in screening with a client number",
      async () => {
        const created = await f.draftCase(f.siteCoordinator, {
          mode: "assisted",
        });
        await f.act(f.siteCoordinator, created.caseId, "SUBMIT", {
          confirmed: true,
        });
        assert.equal(await stageOf(created.caseId), "screening");
        const [row] = (
          await f.sql("select client_number from public.cases where id=$1", [
            created.caseId,
          ])
        ).rows;
        assert.ok(Number(row.client_number) > 0, "a client number is assigned");
        assert.ok(
          (await f.clientMessages(created.caseId)).includes(SCREENING_LINE),
        );
        // It has already been screened, so the office goes straight to the checks.
        await assert.rejects(
          () => f.act(f.siteCoordinator, created.caseId, "START_SCREENING", {}),
          rejected("INVALID_TRANSITION"),
        );
        await f.act(f.siteCoordinator, created.caseId, "VERIFY_INTAKE", {
          checks: f.intakeChecks,
        });
        assert.equal(await stageOf(created.caseId), "preparation_ready");
      },
    );

    await t.test(
      "a client case still lands in received with the old line",
      async () => {
        const { caseId } = await f.submittedClientCase();
        assert.equal(await stageOf(caseId), "received");
        const messages = await f.clientMessages(caseId);
        assert.ok(
          messages.includes(
            "Application received. A volunteer will check your information and documents.",
          ),
        );
        assert.ok(!messages.includes(SCREENING_LINE));
      },
    );

    await t.test("signing and e-filing, admin only, confirmed only", async () => {
      const caseId = await f.approvedCase();
      await assert.rejects(
        () => f.act(f.siteCoordinator, caseId, "MARK_EFILED", EFILED),
        rejected("INVALID_TRANSITION"),
      );
      for (const personId of [f.alex, f.morgan, null])
        await assert.rejects(
          () =>
            f.actAsPersona(f.presenter, caseId, personId, "MARK_READY_TO_EFILE", CONFIRMED),
          rejected("FORBIDDEN"),
        );
      for (const payload of [
        {},
        { confirmed: false },
        { confirmed: "true" },
        { confirmed: true, x: 1 },
      ])
        await assert.rejects(
          () => f.act(f.siteCoordinator, caseId, "MARK_READY_TO_EFILE", payload),
          rejected("VALIDATION"),
        );
      await f.act(f.siteCoordinator, caseId, "MARK_READY_TO_EFILE", CONFIRMED);
      assert.equal(await stageOf(caseId), "ready_to_efile");
      assert.ok((await f.clientMessages(caseId)).includes(SIGNED_LINE));
      for (const personId of [f.alex, f.morgan, null])
        await assert.rejects(
          () => f.actAsPersona(f.presenter, caseId, personId, "MARK_EFILED", EFILED),
          rejected("FORBIDDEN"),
        );
      await assert.rejects(
        () => f.act(f.siteCoordinator, caseId, "MARK_EFILED", {}),
        rejected("VALIDATION"),
      );
      await f.act(f.siteCoordinator, caseId, "MARK_EFILED", EFILED);
      assert.equal(await stageOf(caseId), "efiled");
      assert.ok((await f.clientMessages(caseId)).includes(EFILED_LINE));
      await assert.rejects(
        () => f.act(f.siteCoordinator, caseId, "MARK_EFILED", EFILED),
        rejected("INVALID_TRANSITION"),
      );
      await assert.rejects(
        () =>
          f.act(f.siteCoordinator, caseId, "MARK_READY_TO_EFILE", CONFIRMED),
        rejected("INVALID_TRANSITION"),
      );
    });

    await t.test("ready to e-file waits for the reviewer's call", async () => {
      const caseId = await f.legacyApprovedCase();
      await assert.rejects(
        () =>
          f.act(f.siteCoordinator, caseId, "MARK_READY_TO_EFILE", CONFIRMED),
        rejected("INVALID_TRANSITION"),
      );
      assert.equal(await stageOf(caseId), "review_approved");
      await f.act(f.reviewer, caseId, "RECORD_REVIEW_CONTACT", {
        outcome: "reached",
        note: CALL_NOTE,
      });
      await f.act(f.siteCoordinator, caseId, "MARK_READY_TO_EFILE", CONFIRMED);
      assert.equal(await stageOf(caseId), "ready_to_efile");
    });

    await t.test("ready to e-file waits for the office's go-over", async () => {
      const caseId = await f.approvedCase({ wentOver: false });
      const { revision } = await f.readStaffCase(caseId);
      await assert.rejects(
        () =>
          f.act(f.siteCoordinator, caseId, "MARK_READY_TO_EFILE", CONFIRMED),
        rejected("INVALID_TRANSITION"),
      );
      assert.equal(await stageOf(caseId), "review_approved");
      assert.equal((await f.readStaffCase(caseId)).revision, revision); // nothing recorded, no client line
    });
    for (const outcome of ["reached", "no_further_contact"])
      await t.test(
        `the wait ends when the go-over is resolved: ${outcome}`,
        async () => {
          const caseId = await f.approvedCase({ wentOver: false });
          const [task] = (
            await f.sql(
              "select id, assignee_person_id from public.admin_followups where case_id=$1 and purpose='go_over_return' and status='open'",
              [caseId],
            )
          ).rows;
          await f.act(f.siteCoordinator, caseId, "RESOLVE_FOLLOWUP", {
            followupId: task.id,
            outcome,
            note: "Fictional: went over the return by phone.",
          });
          await f.act(f.siteCoordinator, caseId, "MARK_READY_TO_EFILE", CONFIRMED);
          assert.equal(await stageOf(caseId), "ready_to_efile");
        },
      );
    await t.test("a yes approval is not held up", async () => {
      const caseId = await f.approvedCase();
      await f.act(f.siteCoordinator, caseId, "MARK_READY_TO_EFILE", CONFIRMED);
      assert.equal(await stageOf(caseId), "ready_to_efile");
    });

    await t.test(
      "closing: allowed during screening, refused after review",
      async () => {
        const { caseId: screening } = await f.submittedClientCase();
        await f.act(f.siteCoordinator, screening, "START_SCREENING", {});
        await f.act(f.siteCoordinator, screening, "CLOSE_CASE", CLOSURE);
        assert.equal(await stageOf(screening), "closed");

        const caseId = await f.approvedCase();
        await assert.rejects(
          () => f.act(f.siteCoordinator, caseId, "CLOSE_CASE", CLOSURE),
          rejected("INVALID_TRANSITION"),
        );
        await f.act(f.siteCoordinator, caseId, "MARK_READY_TO_EFILE", CONFIRMED);
        await assert.rejects(
          () => f.act(f.siteCoordinator, caseId, "CLOSE_CASE", CLOSURE),
          rejected("INVALID_TRANSITION"),
        );
        await f.act(f.siteCoordinator, caseId, "MARK_EFILED", EFILED);
        await assert.rejects(
          () => f.act(f.siteCoordinator, caseId, "CLOSE_CASE", CLOSURE),
          rejected("INVALID_TRANSITION"),
        );
        assert.equal(await stageOf(caseId), "efiled");
      },
    );

    await t.test("a rejected action commits nothing", async () => {
      const caseId = await f.legacyApprovedCase();
      const { revision } = await f.readStaffCase(caseId);
      const before = await f.stateSnapshot();
      const history = await f.clientMessages(caseId);
      // Refused for the stage (MARK_EFILED) and for the missing call
      // (MARK_READY_TO_EFILE): both are INVALID_TRANSITION, VT004.
      for (const type of ["MARK_EFILED", "MARK_READY_TO_EFILE"]) {
        const actionId = crypto.randomUUID();
        const { error } = await f.siteCoordinator.rpc(
          "vitally_apply_action",
          applyArgs({
            actionId,
            caseId,
            revision,
            type,
            payload: type === "MARK_EFILED" ? EFILED : CONFIRMED,
          }),
        );
        assert.equal(error?.code, "VT004", type);
        assert.equal(await f.receiptsFor(actionId), 0, `${type} receipt`);
      }
      assert.deepEqual(await f.stateSnapshot(), before);
      assert.equal((await f.readStaffCase(caseId)).revision, revision);
      assert.deepEqual(await f.clientMessages(caseId), history);
    });
  } finally {
    await f.close();
  }
});
