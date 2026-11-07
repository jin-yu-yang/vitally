import test from "node:test";
import assert from "node:assert/strict";
import {
  createDatabaseFixture,
  applyArgs,
  rejected,
  SAMPLE_CONTACT,
  screeningChecks,
} from "./support/database-fixture.mjs";
import {
  PRIVATE_SETUP_DENIALS,
  PRIVATE_SETUP_FUNCTIONS,
  RPC_SIGNATURES,
} from "./support/rpc-signatures.mjs";
import { REFERENCE_PATTERN } from "../src/contracts.mjs";
import { makeSampleAnswers } from "../src/sample-data.mjs";
// The denial Task 2 already asserts for anonymous table and function access.
const ANONYMOUS_DENIAL = "42501";
const caseRow = async (f, caseId) =>
  (await f.sql("select * from public.cases where id=$1", [caseId])).rows[0];
const revisionOf = async (f, caseId) =>
  Number((await caseRow(f, caseId)).revision);
const actions = async (f, table, caseId) =>
  (
    await f.sql(
      `select action from public.${table} where case_id=$1 order by created_at,id`,
      [caseId],
    )
  ).rows.map((row) => row.action);
const participantsOf = async (f, caseId) =>
  Number(
    (
      await f.sql(
        "select count(*) as count from public.preparation_participants where case_id=$1",
        [caseId],
      )
    ).rows[0].count,
  );
const draftCase = (f) => f.draftCase(f.applicantA);

test("case actions apply the shared check order against real Supabase", async (t) => {
  const f = await createDatabaseFixture();
  try {
    await t.test(
      "one case is saved, submitted, verified and claimed through public actions",
      async () => {
        const created = await f.createCase(f.applicantA, crypto.randomUUID(), {
          answers: {},
        });
        const saved = await f.act(
          f.applicantA,
          created.caseId,
          "SAVE_ANSWERS",
          { answers: makeSampleAnswers() },
        );
        assert.deepEqual(saved, {
          actionId: saved.actionId,
          caseId: created.caseId,
          reference: created.reference,
          revision: 2,
        });
        const patched = await f.act(
          f.applicantA,
          created.caseId,
          "SAVE_ANSWERS",
          { answers: { addr_city: "Pittsburgh" } },
        );
        assert.equal(patched.revision, 3);
        const draft = await caseRow(f, created.caseId);
        assert.equal(draft.stage, "draft");
        assert.equal(draft.answers.addr_city, "Pittsburgh");
        assert.equal(
          draft.answers.tp_first_name,
          makeSampleAnswers().tp_first_name,
        );
        // A private draft produces internal history only.
        assert.deepEqual(await actions(f, "client_events", created.caseId), []);
        assert.deepEqual(await actions(f, "case_events", created.caseId), [
          "SAVE_ANSWERS",
          "SAVE_ANSWERS",
        ]);
        const [first] = (
          await f.sql(
            "select * from public.case_events where case_id=$1 order by created_at,id",
            [created.caseId],
          )
        ).rows;
        assert.equal(first.actor_user_id, f.applicantAUserId);
        assert.equal(first.actor_person_id, null);
        assert.deepEqual(first.detail, {
          fields: Object.keys(makeSampleAnswers()).sort(),
        });
        const submitted = await f.act(
          f.applicantA,
          created.caseId,
          "SUBMIT",
          { confirmed: true },
        );
        assert.equal(submitted.revision, 4);
        assert.equal((await caseRow(f, created.caseId)).stage, "received");
        // Receipt is not verification: the intake checks are their own action.
        assert.equal(
          (await caseRow(f, created.caseId)).intake_verified,
          false,
        );
        const screening = await f.act(
          f.siteCoordinator,
          created.caseId,
          "START_SCREENING",
          {},
        );
        assert.equal(screening.revision, 5);
        assert.equal(
          (await f.readStaffCase(created.caseId)).stage,
          "screening",
        );
        const verified = await f.act(
          f.siteCoordinator,
          created.caseId,
          "VERIFY_INTAKE",
          { checks: f.intakeChecks },
        );
        assert.equal(verified.revision, 6);
        assert.equal(
          (await f.readStaffCase(created.caseId)).stage,
          "preparation_ready",
        );
        const claimed = await f.act(
          f.preparer,
          created.caseId,
          "CLAIM_PREPARATION",
          {},
        );
        assert.equal(claimed.revision, 7);
        const staff = await f.readStaffCase(created.caseId);
        assert.equal(staff.id, created.caseId);
        assert.equal(staff.reference, created.reference);
        assert.equal(staff.workspaceId, f.workspaceId);
        assert.equal(staff.ownerUserId, f.applicantAUserId);
        assert.equal(staff.stage, "preparing");
        assert.equal(staff.revision, 7);
        assert.equal(staff.preparationVersion, 0);
        assert.equal(staff.intakeVerified, true);
        assert.equal(staff.preparerId, f.preparerId);
        assert.equal(staff.reviewerId, null);
        assert.deepEqual(staff.participants, [f.preparerId]);
        assert.deepEqual(staff.requests, []);
        assert.deepEqual(staff.documents, []);
        assert.deepEqual(staff.followups, []);
        assert.deepEqual(
          staff.history.map((entry) => entry.action),
          ["SUBMIT", "START_SCREENING", "VERIFY_INTAKE", "CLAIM_PREPARATION"],
        );
        assert.deepEqual(
          staff.internalHistory.map((entry) => entry.action),
          [
            "SAVE_ANSWERS",
            "SAVE_ANSWERS",
            "SUBMIT",
            "START_SCREENING",
            "VERIFY_INTAKE",
            "CLAIM_PREPARATION",
          ],
        );
        // Client progress is plain language with no actor or internal detail.
        for (const entry of staff.history) {
          assert.ok(entry.message.length > 0);
          assert.equal(entry.actorUserId, undefined);
          assert.equal(entry.detail, undefined);
        }
        const intake = staff.internalHistory.find(
          (entry) => entry.action === "VERIFY_INTAKE",
        );
        assert.equal(intake.actorPersonId, f.siteCoordinatorId);
        assert.deepEqual(intake.detail, {
          checks: { ...f.intakeChecks },
        });
        assert.deepEqual(
          staff.internalHistory.find(
            (entry) => entry.action === "CLAIM_PREPARATION",
          ).detail,
          { preparerPersonId: f.preparerId },
        );
        const { data: ownProgress } = await f.applicantA
          .from("client_events")
          .select("*")
          .eq("case_id", created.caseId);
        assert.equal(ownProgress.length, 4);
        assert.deepEqual(
          await f.applicantA
            .from("case_events")
            .select("*")
            .eq("case_id", created.caseId)
            .then((response) => response.data),
          [],
        );
      },
    );
    await t.test(
      "two simultaneous claims at one revision leave a single winner",
      async () => {
        const caseId = await f.readyCase();
        const { revision } = await f.readStaffCase(caseId);
        const attempts = [crypto.randomUUID(), crypto.randomUUID()];
        const results = await Promise.all(
          attempts.map((actionId) =>
            f.preparer.rpc(
              "vitally_apply_action",
              applyArgs({
                actionId,
                caseId,
                revision,
                type: "CLAIM_PREPARATION",
              }),
            ),
          ),
        );
        const won = results.filter((result) => !result.error);
        const lost = results.filter((result) => result.error);
        assert.equal(won.length, 1);
        assert.equal(lost.length, 1);
        assert.equal(lost[0].error.code, "VT003");
        assert.equal(won[0].data.revision, revision + 1);
        assert.deepEqual(
          (
            await f.sql(
              "select person_id from public.preparation_participants where case_id=$1",
              [caseId],
            )
          ).rows,
          [{ person_id: f.preparerId }],
        );
        assert.deepEqual(await actions(f, "case_events", caseId), [
          "SAVE_ANSWERS",
          "SUBMIT",
          "START_SCREENING",
          "VERIFY_INTAKE",
          "CLAIM_PREPARATION",
        ]);
        assert.equal(
          await f.receiptsFor(attempts[results.indexOf(lost[0])]),
          0,
        );
        assert.equal((await caseRow(f, caseId)).stage, "preparing");
      },
    );
    await t.test(
      "an identical envelope replays one receipt; a changed one is a validation error",
      async () => {
        const caseId = await f.readyCase();
        const { revision } = await f.readStaffCase(caseId);
        const args = applyArgs({
          caseId,
          revision,
          personId: f.alex,
          type: "CLAIM_PREPARATION",
        });
        const first = await f.presenter.rpc("vitally_apply_action", args);
        assert.equal(first.error, null);
        const replay = await f.presenter.rpc("vitally_apply_action", args);
        assert.equal(replay.error, null);
        assert.deepEqual(replay.data, first.data);
        for (const changed of [
          { ...args, p_payload: { note: "different" } },
          { ...args, p_expected_revision: revision + 1 },
          { ...args, p_person_id: f.sam },
          { ...args, p_type: "SAVE_ANSWERS", p_payload: { answers: {} } },
        ]) {
          const response = await f.presenter.rpc(
            "vitally_apply_action",
            changed,
          );
          assert.equal(response.error.code, "VT007");
        }
        assert.equal(await participantsOf(f, caseId), 1);
        assert.deepEqual(await actions(f, "case_events", caseId), [
          "SAVE_ANSWERS",
          "SUBMIT",
          "START_SCREENING",
          "VERIFY_INTAKE",
          "CLAIM_PREPARATION",
        ]);
        assert.equal(await revisionOf(f, caseId), revision + 1);
      },
    );
    await t.test(
      "an accepted replay re-checks current membership and operation authority",
      async () => {
        const submitted = await draftCase(f);
        const caseId = submitted.caseId;
        await f.act(f.applicantA, caseId, "SUBMIT", { confirmed: true });
        await f.act(f.siteCoordinator, caseId, "START_SCREENING", {});
        const verify = applyArgs({
          caseId,
          revision: 4,
          personId: f.sam,
          type: "VERIFY_INTAKE",
          payload: { checks: f.intakeChecks },
        });
        const accepted = await f.presenter.rpc("vitally_apply_action", verify);
        assert.equal(accepted.error, null);
        const replay = await f.presenter.rpc("vitally_apply_action", verify);
        assert.equal(replay.error, null);
        assert.deepEqual(replay.data, accepted.data);
        const receipt = async () =>
          (
            await f.sql(
              "select * from public.action_receipts where action_id=$1",
              [verify.p_action_id],
            )
          ).rows;
        const stored = await receipt();
        const revision = await revisionOf(f, caseId);
        // The capability the action needed is re-checked on every replay.
        await f.sql(
          "update public.people set capabilities=$1 where id=$2",
          [["assist", "followup", "receive_documents"], f.sam],
        );
        try {
          const stripped = await f.presenter.rpc(
            "vitally_apply_action",
            verify,
          );
          assert.equal(stripped.error.code, "VT001");
        } finally {
          await f.sql("update public.people set capabilities=$1 where id=$2", [
            ["admin", "assist", "followup", "receive_documents"],
            f.sam,
          ]);
        }
        // So is the membership the caller acts under.
        await f.sql(
          "update public.memberships set active=false where workspace_id=$1 and user_id=$2",
          [f.workspaceId, f.presenterUserId],
        );
        try {
          const revoked = await f.presenter.rpc(
            "vitally_apply_action",
            verify,
          );
          assert.equal(revoked.error.code, "VT001");
        } finally {
          await f.sql(
            "update public.memberships set active=true where workspace_id=$1 and user_id=$2",
            [f.workspaceId, f.presenterUserId],
          );
        }
        // Neither rejection touched the stored receipt or the case.
        assert.deepEqual(await receipt(), stored);
        assert.equal(await revisionOf(f, caseId), revision);
        // Restored authority replays the same receipt again.
        const restored = await f.presenter.rpc("vitally_apply_action", verify);
        assert.equal(restored.error, null);
        assert.deepEqual(restored.data, accepted.data);
        // The applicant's own accepted envelope follows the same rule.
        const own = await draftCase(f);
        const save = applyArgs({
          caseId: own.caseId,
          revision: 2,
          type: "SAVE_ANSWERS",
          payload: { answers: { addr_city: "Pittsburgh" } },
        });
        assert.equal(
          (await f.applicantA.rpc("vitally_apply_action", save)).error,
          null,
        );
        await f.sql(
          "update public.memberships set active=false where workspace_id=$1 and user_id=$2",
          [f.workspaceId, f.applicantAUserId],
        );
        try {
          const revoked = await f.applicantA.rpc("vitally_apply_action", save);
          assert.equal(revoked.error.code, "VT001");
        } finally {
          await f.sql(
            "update public.memberships set active=true where workspace_id=$1 and user_id=$2",
            [f.workspaceId, f.applicantAUserId],
          );
        }
      },
    );
    await t.test(
      "an accepted replay returns its receipt without reaching the target",
      async () => {
        const created = await draftCase(f);
        const save = applyArgs({
          caseId: created.caseId,
          revision: 2,
          type: "SAVE_ANSWERS",
          payload: { answers: { addr_city: "Pittsburgh" } },
        });
        const accepted = await f.applicantA.rpc("vitally_apply_action", save);
        assert.equal(accepted.error, null);
        // A seed re-run deletes cases; receipts are historical scalars
        // with no foreign key, so an identical replay must still answer.
        await f.sql("delete from public.cases where id=$1", [created.caseId]);
        const replay = await f.applicantA.rpc("vitally_apply_action", save);
        assert.equal(replay.error, null);
        assert.deepEqual(replay.data, accepted.data);
        // A new action id against the deleted case is NOT_FOUND, as usual.
        const fresh = await f.applicantA.rpc(
          "vitally_apply_action",
          applyArgs({
            caseId: created.caseId,
            revision: 3,
            type: "SAVE_ANSWERS",
            payload: { answers: { addr_city: "Pittsburgh" } },
          }),
        );
        assert.equal(fresh.error.code, "VT002");
      },
    );
    await t.test(
      "absent, other-owner and invisible cases are the same NOT_FOUND",
      async () => {
        const caseId = await f.readyCase();
        const { reference } = await f.readStaffCase(caseId);
        const spec = {
          revision: 1,
          type: "SAVE_ANSWERS",
          payload: { answers: { addr_city: "Pittsburgh" } },
        };
        const attempts = [crypto.randomUUID(), crypto.randomUUID()];
        const other = await f.applicantB.rpc(
          "vitally_apply_action",
          applyArgs({ ...spec, caseId, actionId: attempts[0] }),
        );
        const absent = await f.applicantB.rpc(
          "vitally_apply_action",
          applyArgs({
            ...spec,
            caseId: crypto.randomUUID(),
            actionId: attempts[1],
          }),
        );
        assert.equal(other.error.code, "VT002");
        assert.deepEqual(other.error, absent.error);
        assert.ok(!JSON.stringify(other.error).includes(reference));
        assert.ok(!JSON.stringify(other.error).includes(caseId));
        const outsider = await f.outsider.rpc(
          "vitally_apply_action",
          applyArgs({ ...spec, caseId }),
        );
        assert.equal(outsider.error.code, "VT002");
        // A presenter cannot reach a private client draft either.
        const draft = await draftCase(f);
        const hidden = await f.presenter.rpc(
          "vitally_apply_action",
          applyArgs({
            ...spec,
            // f.draftCase's SAVE_ANSWERS puts the draft at revision 2, so the
            // probe is current and tests visibility, not staleness.
            revision: 2,
            caseId: draft.caseId,
            personId: f.sam,
          }),
        );
        assert.equal(hidden.error.code, "VT002");
        await assert.rejects(
          () =>
            f.act(f.applicantB, caseId, "SAVE_ANSWERS", {
              answers: { addr_city: "Pittsburgh" },
            }),
          rejected("NOT_FOUND"),
        );
        await assert.rejects(
          () =>
            f.act(f.applicantA, crypto.randomUUID(), "SAVE_ANSWERS", {
              answers: { addr_city: "Pittsburgh" },
            }),
          rejected("NOT_FOUND"),
        );
        for (const actionId of attempts)
          assert.equal(await f.receiptsFor(actionId), 0);
        // Membership is checked before any target, so an unapproved caller
        // cannot tell an absent case from one they may not see.
        const unapproved = await f.unapproved.rpc(
          "vitally_apply_action",
          applyArgs({ ...spec, caseId }),
        );
        assert.equal(unapproved.error.code, "VT001");
      },
    );
    await t.test(
      "forged staff identity, missing capability and foreign people are forbidden",
      async () => {
        const draft = await draftCase(f);
        const forged = await f.applicantA.rpc(
          "vitally_apply_action",
          applyArgs({
            caseId: draft.caseId,
            revision: 2,
            personId: f.sam,
            type: "SAVE_ANSWERS",
            payload: { answers: { addr_city: "Pittsburgh" } },
          }),
        );
        assert.equal(forged.error.code, "VT001");
        assert.equal(await revisionOf(f, draft.caseId), 2);
        const received = (await f.submittedClientCase()).caseId;
        for (const personId of [f.alex, f.morgan, null, f.foreignPeople.sam])
          await assert.rejects(
            () =>
              f.actAsPersona(f.presenter, received, personId, "VERIFY_INTAKE", {
                checks: f.intakeChecks,
              }),
            rejected("FORBIDDEN"),
          );
        await assert.rejects(
          () =>
            f.act(f.applicantA, received, "VERIFY_INTAKE", {
              checks: f.intakeChecks,
            }),
          rejected("FORBIDDEN"),
        );
        // Positive control: the same action succeeds for an admin-capable person.
        await f.actAsPersona(f.presenter, received, f.sam, "START_SCREENING", {});
        await f.actAsPersona(f.presenter, received, f.sam, "VERIFY_INTAKE", {
          checks: f.intakeChecks,
        });
        // Step 4 lets any same-workspace person attempt a claim; step 7 does not.
        for (const personId of [f.sam, f.morgan])
          await assert.rejects(
            () => f.actAsPersona(f.presenter, received, personId, "CLAIM_PREPARATION", {}),
            rejected("INELIGIBLE"),
          );
        assert.equal((await caseRow(f, received)).stage, "preparation_ready");
        assert.equal(await participantsOf(f, received), 0);
        await f.actAsPersona(f.presenter, received, f.alex, "CLAIM_PREPARATION", {});
        assert.equal((await caseRow(f, received)).preparer_id, f.alex);
      },
    );
    await t.test(
      "an admin presenter owns an assisted intake, never a client's own case",
      async () => {
        const assisted = await f.createCaseAsPersona(f.presenter, crypto.randomUUID(), {
          mode: "assisted",
          personId: f.sam,
          answers: {},
        });
        // Alex cannot assist without the admin capability, and a presenter
        // acting with no person at all is making a client's request.
        for (const personId of [f.alex, f.morgan, null])
          await assert.rejects(
            () =>
              f.actAsPersona(f.presenter, assisted.caseId, personId, "SAVE_ANSWERS", {
                answers: makeSampleAnswers(),
              }),
            rejected("FORBIDDEN"),
          );
        await assert.rejects(
          () =>
            f.act(f.applicantA, assisted.caseId, "SAVE_ANSWERS", {
              answers: makeSampleAnswers(),
            }),
          rejected("NOT_FOUND"),
        );
        const saved = await f.actAsPersona(
          f.presenter,
          assisted.caseId,
          f.sam,
          "SAVE_ANSWERS",
          { answers: makeSampleAnswers() },
        );
        assert.equal(saved.revision, 2);
        await f.actAsPersona(f.presenter, assisted.caseId, f.sam, "SUBMIT", {
          confirmed: true,
        });
        const staff = await f.readStaffCase(assisted.caseId);
        // The office has already screened a client it entered itself.
        assert.equal(staff.stage, "screening");
        assert.equal(staff.ownerUserId, null);
        assert.deepEqual(
          staff.internalHistory.map((entry) => [
            entry.action,
            entry.actorPersonId,
          ]),
          [
            ["SAVE_ANSWERS", f.sam],
            ["SUBMIT", f.sam],
          ],
        );
        // A client-owned case stays the client's to answer, at any stage.
        const owned = (await f.submittedClientCase()).caseId;
        await assert.rejects(
          () =>
            f.actAsPersona(f.presenter, owned, f.sam, "SAVE_ANSWERS", {
              answers: { addr_city: "Pittsburgh" },
            }),
          rejected("FORBIDDEN"),
        );
      },
    );
    await t.test(
      "revision conflicts precede stage, and stage precedes qualification",
      async () => {
        const caseId = await f.readyCase();
        const ready = await f.readStaffCase(caseId);
        // Authority answers before the revision: the owner forging a staff
        // person at a stale revision is still FORBIDDEN, not a conflict.
        const forged = await f.applicantA.rpc(
          "vitally_apply_action",
          applyArgs({
            caseId,
            revision: ready.revision - 1,
            personId: f.sam,
            type: "SUBMIT",
            payload: { confirmed: true },
          }),
        );
        assert.equal(forged.error.code, "VT001");
        // Sam would be INELIGIBLE at step 7, but a stale revision stops at step 5.
        const stale = await f.presenter.rpc(
          "vitally_apply_action",
          applyArgs({
            caseId,
            revision: ready.revision - 1,
            personId: f.sam,
            type: "CLAIM_PREPARATION",
          }),
        );
        assert.equal(stale.error.code, "VT003");
        await f.actAsPersona(f.presenter, caseId, f.alex, "CLAIM_PREPARATION", {});
        // At the old revision the same attempt still conflicts first.
        const old = await f.presenter.rpc(
          "vitally_apply_action",
          applyArgs({
            caseId,
            revision: ready.revision,
            personId: f.alex,
            type: "CLAIM_PREPARATION",
          }),
        );
        assert.equal(old.error.code, "VT003");
        // At a fresh revision the wrong stage answers before qualification.
        for (const personId of [f.alex, f.sam])
          await assert.rejects(
            () => f.actAsPersona(f.presenter, caseId, personId, "CLAIM_PREPARATION", {}),
            rejected("INVALID_TRANSITION"),
          );
        for (const [type, payload] of [
          ["SAVE_ANSWERS", { answers: { addr_city: "Pittsburgh" } }],
          ["SUBMIT", { confirmed: true }],
        ])
          await assert.rejects(
            () => f.act(f.applicantA, caseId, type, payload),
            rejected("INVALID_TRANSITION"),
          );
        await assert.rejects(
          () =>
            f.actAsPersona(f.presenter, caseId, f.sam, "VERIFY_INTAKE", {
              checks: f.intakeChecks,
            }),
          rejected("INVALID_TRANSITION"),
        );
      },
    );
    await t.test(
      "payload whitelists and the server-side submit check reject unsupported answers",
      async () => {
        const draft = await f.createCase(f.applicantA, crypto.randomUUID(), {
          answers: {},
        });
        const caseId = draft.caseId;
        for (const payload of [
          { answers: { notAnAnswer: "x" } },
          { answers: { owner_user_id: f.applicantBUserId } },
          { answers: { addr_city: 42 } },
          { answers: { addr_city: "x".repeat(201) } },
          { answers: {}, extra: true },
          { notAnswers: {} },
          {},
          { answers: "Pittsburgh" },
        ])
          await assert.rejects(
            () => f.act(f.applicantA, caseId, "SAVE_ANSWERS", payload),
            rejected("VALIDATION"),
          );
        // Unknown actions never reach a handler. Every action in CASE_ACTIONS
        // is implemented now: REQUEST_DOCUMENT moved to
        // tests/database-documents.mjs with 004 and CLAIM_REVIEW to
        // tests/database-review.mjs with 006, where a client attempt is
        // FORBIDDEN rather than a validation error.
        for (const type of ["BOGUS", "claim_review", "CLAIM REVIEW"])
          await assert.rejects(
            () => f.act(f.applicantA, caseId, type, {}),
            rejected("VALIDATION"),
          );
        assert.equal(await revisionOf(f, caseId), 1);
        // SUBMIT re-checks the saved answers; an empty draft cannot submit.
        await assert.rejects(
          () => f.act(f.applicantA, caseId, "SUBMIT", { confirmed: true }),
          rejected("VALIDATION"),
        );
        for (const payload of [
          { confirmed: false },
          {},
          { confirmed: true, extra: 1 },
        ])
          await assert.rejects(
            () => f.act(f.applicantA, caseId, "SUBMIT", payload),
            rejected("VALIDATION"),
          );
        // Version 2 has no screening: SUBMIT refuses a required, visible field
        // that is missing, whether it is cleared with null or an empty value,
        // and a contact field counts from case_contacts.
        for (const patch of [
          { tp_first_name: null },
          { addr_city: "" },
          { marital_status: null },
          { service: null },
          { hh: null },
          { tp_phone: null },
        ]) {
          await f.act(f.applicantA, caseId, "SAVE_ANSWERS", {
            answers: makeSampleAnswers(),
          });
          await f.act(f.applicantA, caseId, "SAVE_ANSWERS", {
            answers: patch,
          });
          await assert.rejects(
            () =>
              f.act(f.applicantA, caseId, "SUBMIT", { confirmed: true }),
            rejected("VALIDATION"),
          );
          assert.equal((await caseRow(f, caseId)).stage, "draft");
        }
        // Positive control: complete, supported answers do submit.
        await f.act(f.applicantA, caseId, "SAVE_ANSWERS", {
          answers: makeSampleAnswers(),
        });
        await f.act(f.applicantA, caseId, "SUBMIT", { confirmed: true });
        assert.equal((await caseRow(f, caseId)).stage, "received");
        for (const payload of [
          {},
          { checks: { phone: true, documents: true } },
          { checks: { ...f.intakeChecks, documents: false } },
          { checks: { ...f.intakeChecks, extra: true } },
          { checks: f.intakeChecks, extra: 1 },
        ])
          await assert.rejects(
            () => f.act(f.siteCoordinator, caseId, "VERIFY_INTAKE", payload),
            rejected("VALIDATION"),
          );
        await f.act(f.siteCoordinator, caseId, "START_SCREENING", {});
        await f.act(f.siteCoordinator, caseId, "VERIFY_INTAKE", {
          checks: f.intakeChecks,
        });
        await assert.rejects(
          () =>
            f.act(f.preparer, caseId, "CLAIM_PREPARATION", {
              force: true,
            }),
          rejected("VALIDATION"),
        );
        await f.act(f.preparer, caseId, "CLAIM_PREPARATION", {});
        assert.equal((await caseRow(f, caseId)).stage, "preparing");
      },
    );
    await t.test(
      "rejected actions commit no receipt, event or mutation",
      async () => {
        const caseId = await f.readyCase();
        const { revision } = await f.readStaffCase(caseId);
        const before = await f.stateSnapshot();
        const attempts = [
          [
            f.presenter,
            { caseId, revision, personId: f.sam, type: "CLAIM_PREPARATION" },
            "VT006",
          ],
          [
            f.presenter,
            {
              caseId,
              revision: revision - 1,
              personId: f.alex,
              type: "CLAIM_PREPARATION",
            },
            "VT003",
          ],
          [
            f.applicantA,
            {
              caseId,
              revision,
              type: "SAVE_ANSWERS",
              payload: { answers: { addr_city: "Pittsburgh" } },
            },
            "VT004",
          ],
          [
            f.applicantB,
            {
              caseId,
              revision,
              type: "SUBMIT",
              payload: { confirmed: true },
            },
            "VT002",
          ],
          [
            f.applicantA,
            {
              caseId,
              revision,
              personId: f.sam,
              type: "SUBMIT",
              payload: { confirmed: true },
            },
            "VT001",
          ],
          [
            f.applicantA,
            {
              caseId,
              revision,
              type: "SAVE_ANSWERS",
              payload: { answers: { notAnAnswer: "x" } },
            },
            "VT007",
          ],
        ];
        for (const [client, spec, code] of attempts) {
          const actionId = crypto.randomUUID();
          const { error } = await client.rpc(
            "vitally_apply_action",
            applyArgs({ ...spec, actionId }),
          );
          assert.equal(error?.code, code);
          assert.equal(await f.receiptsFor(actionId), 0);
        }
        assert.deepEqual(await f.stateSnapshot(), before);
      },
    );
  } finally {
    await f.close();
  }
});

test("installed entry points deny anonymous callers and serve members", async (t) => {
  const f = await createDatabaseFixture();
  try {
    await t.test(
      "the signature inventory matches the functions the database exposes",
      async () => {
        const installed = (
          await f.sql(
            "select p.proname||'('||array_to_string(array(select format_type(t,null) from unnest(p.proargtypes) t),',')||')' as signature,p.proname as name,has_function_privilege('anon',p.oid,'EXECUTE') as anon,has_function_privilege('authenticated',p.oid,'EXECUTE') as browser from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'vitally\\_%' order by p.proname",
          )
        ).rows;
        assert.deepEqual(
          installed.map((row) => row.signature),
          [...RPC_SIGNATURES]
            .map((entry) => entry.signature)
            .sort((a, b) => a.localeCompare(b)),
        );
        for (const row of installed) {
          assert.equal(row.anon, false, `${row.name} anon EXECUTE`);
          assert.equal(row.browser, true, `${row.name} authenticated EXECUTE`);
        }
        // Every implementation helper stays private, definer-run and unreachable.
        const helpers = (
          await f.sql(
            "select p.proname as name,p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE') as anon,has_function_privilege('authenticated',p.oid,'EXECUTE') as browser,has_function_privilege('service_role',p.oid,'EXECUTE') as service from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='vitally_private' order by p.proname",
          )
        ).rows;
        assert.ok(helpers.length >= 14, "private helpers are installed");
        for (const helper of helpers) {
          assert.equal(helper.prosecdef, true, `${helper.name} definer`);
          assert.ok(
            helper.proconfig.includes('search_path=""'),
            `${helper.name} search path`,
          );
          assert.deepEqual(
            { anon: helper.anon, browser: helper.browser, service: helper.service },
            { anon: false, browser: false, service: false },
            `${helper.name} client EXECUTE`,
          );
        }
      },
    );
    await t.test(
      "each entry point rejects the anonymous client and accepts a member",
      async () => {
        for (const entry of RPC_SIGNATURES) {
          const draft = await draftCase(f);
          const seeded = await f.seedAssistance();
          // Real targets built through the public actions: a case in review
          // for the contact log, and an approved case for the season close.
          const contactCaseId = await f.preparedCase();
          const exitCaseId = await f.approvedCase();
          const [exitCase] = (
            await f.sql("select revision from public.cases where id=$1", [exitCaseId])
          ).rows;
          const context = {
            exitCaseId,
            exitCaseRevision: Number(exitCase.revision),
            draftCaseId: draft.caseId,
            draftRevision: 2,
            assistanceItemId: seeded.itemId,
            assistanceRevision: 1,
            assistPersonId: f.sam,
            contactCaseId,
            contactEntry: SAMPLE_CONTACT(),
          };
          // An entry for the edit entry point to correct.
          context.contactId = (
            await f.logContactAsPersona(f.presenter, contactCaseId, f.sam, context.contactEntry)
          ).contactId;
          const before = await f.stateSnapshot();
          const denied = await f.anonymous.rpc(entry.name, entry.args(context));
          assert.ok(denied.error, `${entry.name} anonymous call must fail`);
          assert.equal(
            denied.error.code,
            ANONYMOUS_DENIAL,
            `${entry.name} anonymous denial code`,
          );
          assert.deepEqual(await f.stateSnapshot(), before);
          const allowed = await entry
            .authorized(f)
            .rpc(entry.name, entry.args(context));
          assert.equal(
            allowed.error,
            null,
            `${entry.name} member call must succeed`,
          );
          // Each entry answers with its own receipt shape and nothing more.
          assert.deepEqual(
            Object.keys(allowed.data).sort(),
            [...entry.receiptKeys].sort(),
            `${entry.name} receipt keys`,
          );
          if (entry.receiptKeys.includes("reference"))
            assert.match(allowed.data.reference, REFERENCE_PATTERN);
        }
      },
    );
    await t.test(
      "the private roster functions cannot be called by the anonymous client or a presenter",
      async () => {
        // A staff member with `followup`, so moving the default to them is a
        // request the function itself would accept from the roster command.
        const dana = await f.staff({ key: "dana", name: "Dana Fox", capabilities: ["followup"] });
        const context = {
          workspaceId: f.workspaceId,
          userId: f.unapprovedUserId,
          personKey: "dana",
        };
        const installed = (
          await f.sql(
            "select p.proname||'('||array_to_string(array(select format_type(t,null) from unnest(p.proargtypes) t),',')||')' as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='vitally_private' and p.proname = any($1)",
            [PRIVATE_SETUP_FUNCTIONS.map((entry) => entry.name)],
          )
        ).rows.map((row) => row.signature);
        assert.deepEqual(
          installed.sort(),
          PRIVATE_SETUP_FUNCTIONS.map((entry) => entry.signature).sort(),
        );
        const state = async () =>
          (
            await f.sql(
              `select (select default_followup_person_id from public.workspaces where id=$1) as default_id,
                (select count(*) from public.people where workspace_id=$1) as people,
                (select count(*) from public.memberships where user_id=$2) as memberships`,
              [f.workspaceId, f.unapprovedUserId],
            )
          ).rows[0];
        const before = await state();
        assert.equal(before.default_id, f.siteCoordinatorId);
        for (const entry of PRIVATE_SETUP_FUNCTIONS)
          for (const [who, client] of [
            ["anonymous", f.anonymous],
            ["presenter", f.presenter],
          ])
            for (const target of [client, client.schema("vitally_private")]) {
              const { error } = await target.rpc(entry.name, entry.args(context));
              assert.ok(
                PRIVATE_SETUP_DENIALS.includes(error?.code),
                `${entry.name} as ${who}: ${error?.code}`,
              );
            }
        assert.deepEqual(await state(), before);
        assert.notEqual(before.default_id, dana.personId);
      },
    );
  } finally {
    await f.close();
  }
});

// Screening checks (design D2, D6): the set follows the case's service.
const setService = (f, caseId, service) =>
  f.sql("update public.cases set answers=answers||$2::jsonb where id=$1", [
    caseId,
    JSON.stringify({ service }),
  ]);
const screeningCase = async (f, service) => {
  const created = await draftCase(f);
  await f.act(f.applicantA, created.caseId, "SAVE_ANSWERS", {
    answers: makeSampleAnswers(),
  });
  if (service !== "drop_off") await setService(f, created.caseId, service);
  await f.act(f.applicantA, created.caseId, "SUBMIT", { confirmed: true });
  await f.act(f.siteCoordinator, created.caseId, "START_SCREENING", {});
  return created.caseId;
};
const refusedAndUnchanged = async (f, caseId, payload) => {
  const before = await revisionOf(f, caseId);
  await assert.rejects(
    () => f.act(f.siteCoordinator, caseId, "VERIFY_INTAKE", payload),
    rejected("VALIDATION"),
  );
  assert.equal((await caseRow(f, caseId)).stage, "screening");
  assert.equal(await revisionOf(f, caseId), before);
};

test("screening checks: the set follows the service", async () => {
  const f = await createDatabaseFixture();
  try {
    const dropOff = await screeningCase(f, "drop_off");
    await f.act(f.siteCoordinator, dropOff, "VERIFY_INTAKE", {
      checks: screeningChecks("drop_off"),
    });
    const row = await caseRow(f, dropOff);
    assert.equal(row.stage, "preparation_ready");
    assert.equal(row.intake_verified, true);
    const staff = await f.readStaffCase(dropOff);
    const event = staff.internalHistory.find((e) => e.action === "VERIFY_INTAKE");
    assert.deepEqual(event.detail, {
      checks: { phone: true, documents: true, in_scope: true },
    });
    assert.ok(!("simulated" in event.detail));
    const message = (
      await f.sql(
        "select message from public.client_events where case_id=$1 and action='VERIFY_INTAKE'",
        [dropOff],
      )
    ).rows[0].message;
    assert.equal(
      message,
      "PCDC finished screening your application. A volunteer will start preparing your return next.",
    );
    const online = await screeningCase(f, "online");
    await refusedAndUnchanged(f, online, { checks: screeningChecks("drop_off") });
    await f.act(f.siteCoordinator, online, "VERIFY_INTAKE", {
      checks: screeningChecks("online"),
    });
    assert.equal((await caseRow(f, online)).stage, "preparation_ready");
  } finally {
    await f.close();
  }
});

test("an online case records the identity check with the other three", async () => {
  const f = await createDatabaseFixture();
  try {
    // The client flow: the client saves an online answer and submits.
    const { caseId } = await draftCase(f);
    await f.act(f.applicantA, caseId, "SAVE_ANSWERS", {
      answers: { ...makeSampleAnswers(), service: "online" },
    });
    await f.act(f.applicantA, caseId, "SUBMIT", { confirmed: true });
    await f.act(f.siteCoordinator, caseId, "START_SCREENING", {});
    const checks = { phone: true, documents: true, in_scope: true, identity: true };
    await f.act(f.siteCoordinator, caseId, "VERIFY_INTAKE", { checks });
    const stored = (
      await f.sql(
        "select c.answers->>'service' as service, e.detail from public.case_events e join public.cases c on c.id=e.case_id where e.case_id=$1 and e.action='VERIFY_INTAKE'",
        [caseId],
      )
    ).rows;
    assert.equal(stored.length, 1);
    assert.equal(stored[0].service, "online");
    assert.deepEqual(stored[0].detail.checks, checks);
    assert.ok(!("simulated" in stored[0].detail));
  } finally {
    await f.close();
  }
});

test("old four-key payload refused", async () => {
  const f = await createDatabaseFixture();
  try {
    const caseId = await screeningCase(f, "drop_off");
    await refusedAndUnchanged(f, caseId, {
      checks: { interview: true, identity: true, documents: true, consent: true },
    });
  } finally {
    await f.close();
  }
});

test("identity refused without online service", async () => {
  const f = await createDatabaseFixture();
  try {
    const dropOff = await screeningCase(f, "drop_off");
    await refusedAndUnchanged(f, dropOff, { checks: screeningChecks("online") });
    const noService = await screeningCase(f, "drop_off");
    await f.sql("update public.cases set answers=answers-'service' where id=$1", [noService]);
    await refusedAndUnchanged(f, noService, { checks: screeningChecks("online") });
    // Positive control: without a service answer the three checks do record.
    await f.act(f.siteCoordinator, noService, "VERIFY_INTAKE", {
      checks: screeningChecks("drop_off"),
    });
    assert.equal((await caseRow(f, noService)).stage, "preparation_ready");
  } finally {
    await f.close();
  }
});

test("missing, extra or false checks refused", async () => {
  const f = await createDatabaseFixture();
  try {
    const caseId = await screeningCase(f, "drop_off");
    const good = screeningChecks("drop_off");
    const { in_scope: _omitted, ...missing } = good;
    for (const checks of [
      missing,
      { ...good, note: "x" },
      { ...good, documents: false },
    ])
      await refusedAndUnchanged(f, caseId, { checks });
    await refusedAndUnchanged(f, caseId, { checks: good, extra: 1 });
  } finally {
    await f.close();
  }
});
