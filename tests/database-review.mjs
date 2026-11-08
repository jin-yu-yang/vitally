import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createDatabaseFixture,
  applyArgs,
  rejected,
  SAMPLE_CONTACT,
  PREPARER,
  REVIEWER,
} from "./support/database-fixture.mjs";
import { initializeWorkspace } from "../tools/admin/workspace-setup.mjs";
const FINDINGS = "Recheck the fictional mileage entry.";
const RESOLUTION = "Corrected and rechecked in external software.";
const CONTACT_NOTE = "Told the client the fictional return is ready to discuss.";
const ESCALATION_REASON = "No response to the document request.";
const CLOSURE_REASON = "The client asked us to stop and file elsewhere.";
// A review never touches money: no client message may drift into these.
const MONEY_WORDS = [
  "refund",
  "bank",
  "routing",
  "deposit",
  "account number",
  "$",
];
// One valid payload per review action, so a sweep can ask for each of them.
const REVIEW_PAYLOADS = Object.freeze({
  SUBMIT_REVIEW: { questionnaire: PREPARER },
  CLAIM_REVIEW: {},
  REQUEST_CORRECTIONS: { findings: FINDINGS },
  RESUBMIT_REVIEW: { questionnaire: PREPARER, resolution: RESOLUTION },
  APPROVE_REVIEW: { questionnaire: REVIEWER },
  RECORD_REVIEW_CONTACT: { outcome: "reached", note: CONTACT_NOTE },
});
// The account each action would belong to on a case the Preparer prepared
// and the Reviewer reviews, so a stage rejection is never really an authority rejection.
const entitled = (f, type) =>
  type === "SUBMIT_REVIEW" || type === "RESUBMIT_REVIEW" ? f.preparer : f.reviewer;
// Every review action this stage does not allow, asked by its entitled person.
async function refusedByStage(f, caseId, allowed) {
  for (const [type, payload] of Object.entries(REVIEW_PAYLOADS)) {
    if (allowed.includes(type)) continue;
    await assert.rejects(
      () => f.act(entitled(f, type), caseId, type, payload),
      rejected("INVALID_TRANSITION"),
      `${type} must not run on this stage`,
    );
  }
}
// A prepared case one reviewer already holds: stage reviewing, one active review.
async function reviewingCase(f, reviewer = f.reviewer) {
  const caseId = await f.preparedCase();
  await f.act(reviewer, caseId, "CLAIM_REVIEW", {});
  return caseId;
}
// The same case after one correction cycle: stage corrections_required.
async function correctedCase(f, reviewer = f.reviewer) {
  const caseId = await reviewingCase(f, reviewer);
  await f.act(reviewer, caseId, "REQUEST_CORRECTIONS", {
    findings: FINDINGS,
  });
  return caseId;
}
// The latest entry for one action: a repeatable action (a contact attempt)
// appends a new row each time.
const detailOf = (staff, action) =>
  staff.internalHistory.findLast((entry) => entry.action === action).detail;
const messageOf = (staff, action) =>
  staff.history.findLast((entry) => entry.action === action).message;
// No client-readable message repeats internal text or invents a money field.
function assertPlainClientMessage(message) {
  assert.ok(message.length > 0);
  assert.ok(!message.includes(FINDINGS), "findings must stay internal");
  assert.ok(!message.includes(RESOLUTION), "resolutions must stay internal");
  assert.ok(!message.includes(CONTACT_NOTE), "contact notes must stay internal");
  for (const word of MONEY_WORDS)
    assert.ok(
      !message.toLowerCase().includes(word),
      `client copy must not mention ${word}`,
    );
}

test("independent review corrects, re-reviews and approves a prepared case", async (t) => {
  const f = await createDatabaseFixture();
  try {
    // Test-only staff: Drew prepares and also holds `review`, so self-review
    // is proved to be blocked by participation rather than by a missing
    // qualification; Casey prepares without reviewing, and Riley reviews
    // without preparing.
    const drew = await f.staff({ key: "drew", name: "Drew Hayes", capabilities: ["prepare", "review"] });
    const casey = await f.staff({ key: "casey", name: "Casey", capabilities: ["prepare"] });
    const riley = await f.staff({ key: "riley", name: "Riley", capabilities: ["review"] });
    await t.test(
      "a capable preparer still cannot review their own case",
      async () => {
        const id = await f.readyCase();
        await f.act(drew.client, id, "CLAIM_PREPARATION", {});
        await f.act(drew.client, id, "SUBMIT_REVIEW", { questionnaire: PREPARER });
        await assert.rejects(
          f.act(drew.client, id, "CLAIM_REVIEW", {}),
          (error) => error.code === "SELF_REVIEW",
        );
        await assert.rejects(
          f.act(f.siteCoordinator, id, "CLAIM_REVIEW", {}),
          (error) => error.code === "INELIGIBLE",
        );
        await f.act(f.reviewer, id, "CLAIM_REVIEW", {});
        await f.act(f.reviewer, id, "REQUEST_CORRECTIONS", {
          findings: "Recheck the fictional mileage entry.",
        });
        await assert.rejects(
          f.act(f.reviewer, id, "APPROVE_REVIEW", { questionnaire: REVIEWER }),
          (error) => error.code === "INVALID_TRANSITION",
        );
        await f.act(drew.client, id, "RESUBMIT_REVIEW", {
          questionnaire: PREPARER,
          resolution: "Corrected and rechecked in external software.",
        });
        await assert.rejects(
          f.act(f.siteCoordinator, id, "CLAIM_REVIEW", {}),
          (error) => error.code === "INELIGIBLE",
        );
        await f.act(f.reviewer, id, "CLAIM_REVIEW", {});
        await f.act(f.reviewer, id, "APPROVE_REVIEW", { questionnaire: REVIEWER });
        const c = await f.readStaffCase(id);
        assert.equal(c.stage, "review_approved");
        assert.equal(c.preparationVersion, 2);
        assert.equal(c.reviews.length, 2);
        // Each attempt is its own immutable row, in order.
        assert.deepEqual(
          c.reviews.map((review) => review.status),
          ["corrections_requested", "approved"],
        );
        assert.deepEqual(
          c.reviews.map((review) => review.preparationVersion),
          [1, 2],
        );
        assert.deepEqual(
          c.reviews.map((review) => review.reviewerId),
          [f.reviewerId, f.reviewerId],
        );
        assert.equal(c.reviews[0].findings, FINDINGS);
        assert.equal(c.reviews[0].resolution, RESOLUTION);
        assert.ok(c.reviews[0].decidedAt);
        assert.equal(c.reviews[0].clientContactStatus, null);
        assert.equal(c.reviews[1].findings, null);
        assert.equal(c.reviews[1].resolution, null);
        assert.ok(c.reviews[1].decidedAt);
        // Approval with a Yes questionnaire settles the contact step (D10).
        assert.equal(c.reviews[1].clientContactStatus, "completed");
        assert.equal(c.reviews[1].clientContactOutcome, "reached");
        assert.equal(c.reviews[1].clientContactNote, null);
        assert.ok(c.reviews[1].clientContactedAt);
        // Preparation is untouched by every review decision, and the approving
        // reviewer stays on the case.
        assert.equal(c.reviewerId, f.reviewerId);
        assert.equal(c.preparerId, drew.personId);
        assert.deepEqual(c.participants, [drew.personId]);
        assert.equal(c.intakeVerified, true);
        assert.deepEqual(
          c.internalHistory.map((entry) => entry.action),
          [
            "SAVE_ANSWERS",
            "SUBMIT",
            "START_SCREENING",
            "VERIFY_INTAKE",
            "CLAIM_PREPARATION",
            "SUBMIT_REVIEW",
            "CLAIM_REVIEW",
            "REQUEST_CORRECTIONS",
            "RESUBMIT_REVIEW",
            "CLAIM_REVIEW",
            "APPROVE_REVIEW",
          ],
        );
        // Internal details carry ids and versions; the findings live on the
        // presenter-only review row.
        for (const entry of c.internalHistory.filter((event) =>
          event.action.includes("REVIEW"),
        ))
          assert.ok(
            !JSON.stringify(entry.detail).includes(FINDINGS),
            `${entry.action} detail must not carry findings`,
          );
        assert.deepEqual(detailOf(c, "SUBMIT_REVIEW"), {
          preparationVersion: 1,
        });
        assert.deepEqual(detailOf(c, "REQUEST_CORRECTIONS"), {
          reviewId: c.reviews[0].id,
          preparationVersion: 1,
        });
        assert.deepEqual(detailOf(c, "RESUBMIT_REVIEW"), {
          reviewId: c.reviews[0].id,
          preparationVersion: 2,
        });
        assert.deepEqual(detailOf(c, "APPROVE_REVIEW"), {
          reviewId: c.reviews[1].id,
          preparationVersion: 2,
        });
        assert.deepEqual(
          c.internalHistory
            .filter((entry) => entry.action === "CLAIM_REVIEW")
            .map((entry) => entry.detail),
          [
            { reviewId: c.reviews[0].id, reviewerPersonId: f.reviewerId },
            { reviewId: c.reviews[1].id, reviewerPersonId: f.reviewerId },
          ],
        );
        // The client is told milestones in plain language, never findings.
        assert.deepEqual(
          c.history.map((entry) => entry.action),
          [
            "SUBMIT",
            "START_SCREENING",
            "VERIFY_INTAKE",
            "CLAIM_PREPARATION",
            "SUBMIT_REVIEW",
            "CLAIM_REVIEW",
            "REQUEST_CORRECTIONS",
            "RESUBMIT_REVIEW",
            "CLAIM_REVIEW",
            "APPROVE_REVIEW",
          ],
        );
        for (const entry of c.history) assertPlainClientMessage(entry.message);
        assert.match(
          messageOf(c, "SUBMIT_REVIEW"),
          /independent reviewer will check it next/,
        );
        assert.match(
          messageOf(c, "REQUEST_CORRECTIONS"),
          /No action is needed from you right now/,
        );
        assert.match(
          messageOf(c, "APPROVE_REVIEW"),
          /A volunteer will contact you soon to sign and file\./,
        );
      },
    );
    await t.test(
      "a clean review approves at once, and a second reviewer may take the redo",
      async () => {
        const direct = await f.preparedCase();
        await f.act(f.reviewer, direct, "CLAIM_REVIEW", {});
        let staff = await f.readStaffCase(direct);
        assert.equal(staff.stage, "reviewing");
        assert.equal(staff.reviewerId, f.reviewerId);
        assert.equal(staff.reviews.length, 1);
        assert.equal(staff.reviews[0].status, "active");
        assert.equal(staff.reviews[0].preparationVersion, 1);
        assert.equal(staff.reviews[0].decidedAt, null);
        await f.act(f.reviewer, direct, "APPROVE_REVIEW", { questionnaire: REVIEWER });
        staff = await f.readStaffCase(direct);
        assert.equal(staff.stage, "review_approved");
        assert.equal(staff.preparationVersion, 1);
        assert.equal(staff.reviews.length, 1);
        assert.equal(staff.reviews[0].status, "approved");
        assert.equal(staff.reviews[0].clientContactStatus, "completed");
        assert.equal(staff.reviewerId, f.reviewerId);
        // A different reviewer may take the resubmitted version.
        const redo = await correctedCase(f, f.reviewer);
        await f.act(f.preparer, redo, "RESUBMIT_REVIEW", {
          questionnaire: PREPARER,
          resolution: RESOLUTION,
        });
        staff = await f.readStaffCase(redo);
        assert.equal(staff.stage, "review_ready");
        assert.equal(staff.reviewerId, null);
        assert.equal(staff.preparationVersion, 2);
        await f.act(riley.client, redo, "CLAIM_REVIEW", {});
        await f.act(riley.client, redo, "APPROVE_REVIEW", { questionnaire: REVIEWER });
        staff = await f.readStaffCase(redo);
        assert.equal(staff.stage, "review_approved");
        assert.equal(staff.reviewerId, riley.personId);
        assert.deepEqual(
          staff.reviews.map((review) => [
            review.reviewerId,
            review.status,
            review.preparationVersion,
          ]),
          [
            [f.reviewerId, "corrections_requested", 1],
            [riley.personId, "approved", 2],
          ],
        );
        assert.equal(staff.reviews[0].findings, FINDINGS);
        assert.equal(staff.reviews[0].resolution, RESOLUTION);
        assert.equal(staff.preparerId, f.preparerId);
        assert.deepEqual(staff.participants, [f.preparerId]);
      },
    );
    await t.test(
      "stage, revision, participation, qualification and assignment answer in order",
      async () => {
        // A fresh review_ready case: only a claim belongs here.
        const ready = await f.preparedCase();
        await refusedByStage(f, ready, ["CLAIM_REVIEW"]);
        // Participation answers before qualification: Casey prepared this one
        // and holds `prepare` only, so the refusal is SELF_REVIEW, not INELIGIBLE.
        const caseyCase = await f.readyCase();
        await f.act(casey.client, caseyCase, "CLAIM_PREPARATION", {});
        await f.act(casey.client, caseyCase, "SUBMIT_REVIEW", { questionnaire: PREPARER });
        await assert.rejects(
          () => f.act(casey.client, caseyCase, "CLAIM_REVIEW", {}),
          rejected("SELF_REVIEW"),
        );
        // While one reviewer holds the case, nothing else is allowed here.
        const held = await reviewingCase(f, f.reviewer);
        await refusedByStage(f, held, [
          "REQUEST_CORRECTIONS",
          "APPROVE_REVIEW",
        ]);
        // Qualification precedes assignment: Sam is refused for the capability
        // they lack, Riley for the assignment they do not hold.
        for (const type of ["REQUEST_CORRECTIONS", "APPROVE_REVIEW"]) {
          await assert.rejects(
            () =>
              f.act(f.siteCoordinator, held, type, REVIEW_PAYLOADS[type]),
            rejected("INELIGIBLE"),
            `${type} without the review capability`,
          );
          await assert.rejects(
            () => f.act(riley.client, held, type, REVIEW_PAYLOADS[type]),
            rejected("FORBIDDEN"),
            `${type} by another reviewer`,
          );
          await assert.rejects(
            () => f.act(f.preparer, held, type, REVIEW_PAYLOADS[type]),
            rejected("SELF_REVIEW"),
            `${type} by the preparer`,
          );
        }
        // The revision answers before the stage: the same envelope is a
        // CONFLICT at a stale revision and an INVALID_TRANSITION at the latest.
        const stale = (await f.readStaffCase(held)).revision;
        await f.act(f.reviewer, held, "REQUEST_CORRECTIONS", {
          findings: FINDINGS,
        });
        const { error: conflict } = await f.reviewer.rpc(
          "vitally_apply_action",
          applyArgs({
            caseId: held,
            revision: stale,
            type: "APPROVE_REVIEW",
            payload: { questionnaire: REVIEWER },
          }),
        );
        assert.equal(conflict?.code, "VT003");
        await assert.rejects(
          () => f.act(f.reviewer, held, "APPROVE_REVIEW", { questionnaire: REVIEWER }),
          rejected("INVALID_TRANSITION"),
        );
        // Corrections leave preparation alone and hand the case back.
        const corrected = await f.readStaffCase(held);
        assert.equal(corrected.stage, "corrections_required");
        assert.equal(corrected.reviewerId, null);
        assert.equal(corrected.preparerId, f.preparerId);
        assert.deepEqual(corrected.participants, [f.preparerId]);
        assert.equal(corrected.preparationVersion, 1);
        await refusedByStage(f, held, ["RESUBMIT_REVIEW"]);
        // The answered attempt stays as history, and version 2 needs a claim
        // of its own: nothing carries the old attempt forward.
        await f.act(f.preparer, held, "RESUBMIT_REVIEW", {
          questionnaire: PREPARER,
          resolution: RESOLUTION,
        });
        const resubmitted = await f.readStaffCase(held);
        assert.equal(resubmitted.preparationVersion, 2);
        assert.deepEqual(
          resubmitted.reviews.map((review) => review.status),
          ["corrections_requested"],
        );
        // An attempt opened against an older version decides nothing, even in
        // its own reviewer's hands. The stage rules keep the two in step, so
        // the mismatch is forced through the privileged connection.
        await f.act(riley.client, held, "CLAIM_REVIEW", {});
        await f.sql(
          "update public.cases set preparation_version=preparation_version+1 where id=$1",
          [held],
        );
        try {
          for (const type of ["APPROVE_REVIEW", "REQUEST_CORRECTIONS"])
            await assert.rejects(
              () =>
                f.act(riley.client, held, type, REVIEW_PAYLOADS[type]),
              rejected("INVALID_TRANSITION"),
              `${type} at a stale preparation version`,
            );
        } finally {
          await f.sql(
            "update public.cases set preparation_version=preparation_version-1 where id=$1",
            [held],
          );
        }
        await f.act(riley.client, held, "APPROVE_REVIEW", { questionnaire: REVIEWER });
        assert.equal((await f.readStaffCase(held)).stage, "review_approved");
      },
    );
    await t.test(
      "two reviewers claiming one version leave a single active review",
      async () => {
        const caseId = await f.preparedCase();
        const revision = (await f.readStaffCase(caseId)).revision;
        const ids = [crypto.randomUUID(), crypto.randomUUID()];
        const results = await Promise.all(
          [f.reviewer, riley.client].map((client, index) =>
            client.rpc(
              "vitally_apply_action",
              applyArgs({
                actionId: ids[index],
                caseId,
                revision,
                type: "CLAIM_REVIEW",
                payload: {},
              }),
            ),
          ),
        );
        const winners = results.filter((result) => !result.error);
        const losers = results.filter((result) => result.error);
        assert.equal(winners.length, 1);
        assert.equal(losers.length, 1);
        assert.equal(losers[0].error.code, "VT003");
        const staff = await f.readStaffCase(caseId);
        assert.equal(staff.stage, "reviewing");
        assert.equal(staff.reviews.length, 1);
        assert.equal(staff.reviews[0].status, "active");
        assert.equal(staff.reviews[0].reviewerId, staff.reviewerId);
        assert.ok([f.reviewerId, riley.personId].includes(staff.reviewerId));
        assert.equal(winners[0].data.revision, revision + 1);
        assert.equal(await f.receiptsFor(ids[results.indexOf(losers[0])]), 0);
      },
    );
    await t.test(
      "a legacy review contact is recorded by the assigned reviewer without banking fields",
      async () => {
        // Contact belongs to an approved review only.
        const reviewing = await reviewingCase(f, f.reviewer);
        await assert.rejects(
          () =>
            f.act(
              f.reviewer,
              reviewing,
              "RECORD_REVIEW_CONTACT",
              REVIEW_PAYLOADS.RECORD_REVIEW_CONTACT,
            ),
          rejected("INVALID_TRANSITION"),
        );
        const caseId = await f.legacyApprovedCase();
        const approved = await f.readStaffCase(caseId);
        const clientEvents = approved.history.length;
        // A rejected payload records nothing.
        for (const payload of [
          { outcome: "resolved", note: CONTACT_NOTE },
          { outcome: "reached" },
          { outcome: "reached", note: "   " },
          { outcome: "reached", note: "x".repeat(1001) },
          { outcome: "reached", note: CONTACT_NOTE, extra: true },
          { note: CONTACT_NOTE },
          {},
        ])
          await assert.rejects(
            () =>
              f.act(
                f.reviewer,
                caseId,
                "RECORD_REVIEW_CONTACT",
                payload,
              ),
            rejected("VALIDATION"),
            JSON.stringify(payload),
          );
        // Qualification precedes assignment here too.
        await assert.rejects(
          () =>
            f.act(
              f.siteCoordinator,
              caseId,
              "RECORD_REVIEW_CONTACT",
              REVIEW_PAYLOADS.RECORD_REVIEW_CONTACT,
            ),
          rejected("INELIGIBLE"),
        );
        await assert.rejects(
          () =>
            f.act(
              riley.client,
              caseId,
              "RECORD_REVIEW_CONTACT",
              REVIEW_PAYLOADS.RECORD_REVIEW_CONTACT,
            ),
          rejected("FORBIDDEN"),
        );
        // An unanswered attempt is repeatable and keeps the task pending.
        for (const attempt of [
          "First fictional call, no answer.",
          "Second fictional call, no answer either.",
        ]) {
          await f.act(f.reviewer, caseId, "RECORD_REVIEW_CONTACT", {
            outcome: "no_answer",
            note: attempt,
          });
          const pending = await f.readStaffCase(caseId);
          assert.equal(pending.reviews[0].clientContactStatus, "pending");
          assert.equal(pending.reviews[0].clientContactOutcome, "no_answer");
          assert.equal(pending.reviews[0].clientContactNote, attempt);
          assert.equal(pending.reviews[0].clientContactedAt, null);
          assert.equal(pending.stage, "review_approved");
          // Nothing is said to the client until the conversation happened.
          assert.equal(pending.history.length, clientEvents);
        }
        await f.act(f.reviewer, caseId, "RECORD_REVIEW_CONTACT", {
          outcome: "reached",
          note: CONTACT_NOTE,
        });
        const done = await f.readStaffCase(caseId);
        assert.equal(done.reviews[0].clientContactStatus, "completed");
        assert.equal(done.reviews[0].clientContactOutcome, "reached");
        assert.equal(done.reviews[0].clientContactNote, CONTACT_NOTE);
        assert.ok(done.reviews[0].clientContactedAt);
        assert.equal(done.reviews[0].status, "approved");
        assert.equal(done.stage, "review_approved");
        assert.equal(done.history.length, clientEvents + 1);
        assertPlainClientMessage(messageOf(done, "RECORD_REVIEW_CONTACT"));
        assert.match(messageOf(done, "RECORD_REVIEW_CONTACT"), /volunteer spoke/);
        assert.deepEqual(detailOf(done, "RECORD_REVIEW_CONTACT"), {
          reviewId: done.reviews[0].id,
          outcome: "reached",
        });
        // A completed conversation is not repeated — and only the reviewer
        // holding the case is told so. Everybody else answers exactly as they
        // did while it was pending, so the error code discloses nothing about
        // whether the client has been spoken to.
        for (const outcome of ["no_answer", "reached", "closure_requested"])
          await assert.rejects(
            () =>
              f.act(f.reviewer, caseId, "RECORD_REVIEW_CONTACT", {
                outcome,
                note: CONTACT_NOTE,
              }),
            rejected("INVALID_TRANSITION"),
          );
        await assert.rejects(
          () =>
            f.act(
              f.siteCoordinator,
              caseId,
              "RECORD_REVIEW_CONTACT",
              REVIEW_PAYLOADS.RECORD_REVIEW_CONTACT,
            ),
          rejected("INELIGIBLE"),
        );
        await assert.rejects(
          () =>
            f.act(
              riley.client,
              caseId,
              "RECORD_REVIEW_CONTACT",
              REVIEW_PAYLOADS.RECORD_REVIEW_CONTACT,
            ),
          rejected("FORBIDDEN"),
        );
        await assert.rejects(
          () =>
            f.act(
              f.preparer,
              caseId,
              "RECORD_REVIEW_CONTACT",
              REVIEW_PAYLOADS.RECORD_REVIEW_CONTACT,
            ),
          rejected("SELF_REVIEW"),
        );
        // A request to close stays a contact record: closure is its own action.
        const closing = await f.legacyApprovedCase();
        await f.act(f.reviewer, closing, "RECORD_REVIEW_CONTACT", {
          outcome: "closure_requested",
          note: "The client asked about closing the fictional case.",
        });
        const asked = await f.readStaffCase(closing);
        assert.equal(asked.stage, "review_approved");
        assert.equal(asked.reviews[0].clientContactStatus, "pending");
        assert.equal(asked.reviews[0].clientContactOutcome, "closure_requested");
        // no_further_contact completes the task without another call.
        await f.act(f.reviewer, closing, "RECORD_REVIEW_CONTACT", {
          outcome: "no_further_contact",
          note: "Recorded the fictional client's wish to stop here.",
        });
        const stopped = await f.readStaffCase(closing);
        assert.equal(stopped.reviews[0].clientContactStatus, "completed");
        assert.ok(stopped.reviews[0].clientContactedAt);
      },
    );
    await t.test(
      "clients read progress, never review attempts or their findings",
      async () => {
        const caseId = await correctedCase(f, f.reviewer);
        const reviews = await f.applicantA.from("reviews").select("*");
        assert.equal(reviews.error, null, "reviews must not error for a client");
        assert.deepEqual(reviews.data, [], "reviews must be empty for a client");
        const events = await f.applicantA
          .from("client_events")
          .select("*")
          .eq("case_id", caseId);
        assert.equal(events.error, null);
        assert.ok(events.data.length > 0);
        for (const event of events.data) assertPlainClientMessage(event.message);
        // Internal history stays presenter-only.
        const internal = await f.applicantA
          .from("case_events")
          .select("*")
          .eq("case_id", caseId);
        assert.equal(internal.error, null);
        assert.deepEqual(internal.data, []);
        // Every review action is a presenter action on a staff person.
        const revision = (await f.readStaffCase(caseId)).revision;
        for (const [type, payload] of Object.entries(REVIEW_PAYLOADS)) {
          await assert.rejects(
            () => f.act(f.applicantA, caseId, type, payload),
            rejected("FORBIDDEN"),
            `${type} with no staff person`,
          );
          await assert.rejects(
            () => f.actAsPersona(f.applicantA, caseId, f.morgan, type, payload),
            rejected("FORBIDDEN"),
            `${type} with a forged staff person`,
          );
          // Another client's attempt never reaches the case at all.
          const { error } = await f.applicantB.rpc(
            "vitally_apply_action",
            applyArgs({
              caseId,
              revision,
              personId: f.morgan,
              type,
              payload,
            }),
          );
          assert.equal(error?.code, "VT002", `${type} by another client`);
        }
        const staff = await f.readStaffCase(caseId);
        assert.equal(staff.stage, "corrections_required");
        assert.equal(staff.reviews[0].findings, FINDINGS);
      },
    );
    await t.test(
      "rejected review actions commit no receipt, review or mutation",
      async () => {
        const caseId = await reviewingCase(f, f.reviewer);
        const revision = (await f.readStaffCase(caseId)).revision;
        const before = await f.stateSnapshot();
        const attempts = [
          [
            riley.client,
            { caseId, revision, type: "APPROVE_REVIEW", payload: { questionnaire: REVIEWER } },
            "VT001",
          ],
          [
            f.applicantB,
            { caseId, revision, personId: f.morgan, type: "APPROVE_REVIEW", payload: { questionnaire: REVIEWER } },
            "VT002",
          ],
          [
            f.reviewer,
            {
              caseId,
              revision: revision - 1,
              type: "APPROVE_REVIEW",
              payload: { questionnaire: REVIEWER },
            },
            "VT003",
          ],
          [
            f.reviewer,
            { caseId, revision, type: "CLAIM_REVIEW" },
            "VT004",
          ],
          [
            f.preparer,
            { caseId, revision, type: "APPROVE_REVIEW", payload: { questionnaire: REVIEWER } },
            "VT005",
          ],
          [
            f.siteCoordinator,
            { caseId, revision, type: "APPROVE_REVIEW", payload: { questionnaire: REVIEWER } },
            "VT006",
          ],
          [
            f.reviewer,
            {
              caseId,
              revision,
              type: "REQUEST_CORRECTIONS",
              payload: { findings: "   " },
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
          assert.equal(error?.code, code, spec.type);
          assert.equal(await f.receiptsFor(actionId), 0);
        }
        assert.deepEqual(await f.stateSnapshot(), before);
        // An accepted claim replays to its own receipt and one review row.
        const fresh = await f.preparedCase();
        const envelope = applyArgs({
          caseId: fresh,
          revision: (await f.readStaffCase(fresh)).revision,
          type: "CLAIM_REVIEW",
          payload: {},
        });
        const first = await f.reviewer.rpc("vitally_apply_action", envelope);
        const replay = await f.reviewer.rpc("vitally_apply_action", envelope);
        assert.equal(first.error, null);
        assert.equal(replay.error, null);
        assert.deepEqual(replay.data, first.data);
        const staff = await f.readStaffCase(fresh);
        assert.equal(staff.reviews.length, 1);
        assert.equal(staff.revision, first.data.revision);
        assert.equal(
          staff.internalHistory.filter(
            (entry) => entry.action === "CLAIM_REVIEW",
          ).length,
          1,
        );
      },
    );
    await t.test(
      "the normal initializer stays refused on the enriched workspace",
      async () => {
        await f.enrich({ addPeople: [{ key: "probe", name: "Probe", capabilities: ["review"] }] });
        const before = await f.snapshot();
        await f.withSetupLock(() =>
          assert.rejects(
            () => initializeWorkspace(f.setup),
            rejected("VALIDATION"),
          ),
        );
        assert.deepEqual(await f.snapshot(), before);
      },
    );
  } finally {
    await f.close();
  }
});

test("review submission waits for documents, not for office contact", async (t) => {
  const f = await createDatabaseFixture();
  try {
    await t.test(
      "an open follow-up never blocks a preparer whose documents are verified",
      async () => {
        const caseId = await f.readyCase();
        await f.act(f.preparer, caseId, "CLAIM_PREPARATION", {});
        await f.act(
          f.preparer,
          caseId,
          "REQUEST_DOCUMENT",
          f.sampleRequest,
        );
        await f.act(f.preparer, caseId, "ESCALATE_CONTACT", {
          reason: ESCALATION_REASON,
        });
        await f.act(f.applicantA, caseId, "RESPOND_DOCUMENT", {
          filename: f.sampleFilename,
        });
        await f.act(f.preparer, caseId, "VERIFY_DOCUMENT", {});
        const held = await f.readStaffCase(caseId);
        // The office task is deliberately left open.
        assert.equal(held.followups.length, 1);
        assert.equal(held.followups[0].status, "open");
        await f.act(f.preparer, caseId, "SUBMIT_REVIEW", { questionnaire: PREPARER });
        const staff = await f.readStaffCase(caseId);
        assert.equal(staff.stage, "review_ready");
        assert.equal(staff.preparationVersion, 1);
        assert.equal(staff.preparerId, f.preparerId);
        assert.equal(staff.reviewerId, null);
        assert.deepEqual(staff.participants, [f.preparerId]);
        assert.equal(staff.requests[0].status, "verified");
        assert.deepEqual(staff.reviews, []);
        // The same task, still open, still Sam's.
        assert.equal(staff.followups.length, 1);
        assert.equal(staff.followups[0].id, held.followups[0].id);
        assert.equal(staff.followups[0].status, "open");
        assert.equal(staff.followups[0].assigneeId, f.siteCoordinatorId);
        assert.equal(staff.followups[0].reason, ESCALATION_REASON);
        assert.deepEqual(detailOf(staff, "SUBMIT_REVIEW"), {
          preparationVersion: 1,
        });
        assertPlainClientMessage(messageOf(staff, "SUBMIT_REVIEW"));
        // Sam still owns the open task after the hand-off.
        await f.logContact(
          f.siteCoordinator,
          caseId,
          {
            ...SAMPLE_CONTACT(),
            outcome: "reached",
            note: "Reached the fictional client about the office question.",
          },
          staff.followups[0].id,
        );
        const contacted = await f.readStaffCase(caseId);
        assert.equal(contacted.stage, "review_ready");
        const contacts = await f.sql(
          "select count(*)::int as n from public.contact_log where followup_id=$1",
          [staff.followups[0].id],
        );
        assert.equal(contacts.rows[0].n, 1);
      },
    );
    await t.test(
      "an unverified document blocks the preparer, after the qualification",
      async () => {
        const caseId = await f.readyCase();
        await f.act(f.preparer, caseId, "CLAIM_PREPARATION", {});
        await f.act(
          f.preparer,
          caseId,
          "REQUEST_DOCUMENT",
          f.sampleRequest,
        );
        // Readiness answers last (contract step 7, Rulings R21 and R31): only
        // this case's preparer is told a document is still open; everybody
        // else is refused for the qualification or the assignment they lack.
        await assert.rejects(
          () => f.act(f.preparer, caseId, "SUBMIT_REVIEW", { questionnaire: PREPARER }),
          rejected("INVALID_TRANSITION"),
        );
        for (const client of [f.siteCoordinator, f.reviewer])
          await assert.rejects(
            () => f.act(client, caseId, "SUBMIT_REVIEW", { questionnaire: PREPARER }),
            rejected("INELIGIBLE"),
          );
        await f.act(f.applicantA, caseId, "RESPOND_DOCUMENT", {
          filename: f.sampleFilename,
        });
        // A received but unverified document is still a blocker.
        await assert.rejects(
          () => f.act(f.preparer, caseId, "SUBMIT_REVIEW", { questionnaire: PREPARER }),
          rejected("INVALID_TRANSITION"),
        );
        await f.act(f.preparer, caseId, "VERIFY_DOCUMENT", {});
        // With nothing blocking, the unqualified callers answer the same way
        // as before: the blocker never changed what they are told.
        for (const client of [f.siteCoordinator, f.reviewer])
          await assert.rejects(
            () => f.act(client, caseId, "SUBMIT_REVIEW", { questionnaire: PREPARER }),
            rejected("INELIGIBLE"),
          );
        // An unverified intake could never reach this stage, and is refused
        // too — again only once the caller is this case's preparer.
        await f.sql("update public.cases set intake_verified=false where id=$1", [
          caseId,
        ]);
        try {
          await assert.rejects(
            () => f.act(f.preparer, caseId, "SUBMIT_REVIEW", { questionnaire: PREPARER }),
            rejected("INVALID_TRANSITION"),
          );
          for (const client of [f.siteCoordinator, f.reviewer])
            await assert.rejects(
              () => f.act(client, caseId, "SUBMIT_REVIEW", { questionnaire: PREPARER }),
              rejected("INELIGIBLE"),
            );
        } finally {
          await f.sql(
            "update public.cases set intake_verified=true where id=$1",
            [caseId],
          );
        }
        // Payload shapes, then the positive control.
        for (const payload of [{ confirmed: true }, { resolution: RESOLUTION }])
          await assert.rejects(
            () => f.act(f.preparer, caseId, "SUBMIT_REVIEW", payload),
            rejected("VALIDATION"),
          );
        await f.act(f.preparer, caseId, "SUBMIT_REVIEW", { questionnaire: PREPARER });
        assert.equal((await f.readStaffCase(caseId)).stage, "review_ready");
      },
    );
    await t.test(
      "a resubmission needs its own verified documents and a resolution",
      async () => {
        const caseId = await f.preparedCase();
        await f.act(f.reviewer, caseId, "CLAIM_REVIEW", {});
        await f.act(f.reviewer, caseId, "REQUEST_CORRECTIONS", {
          findings: FINDINGS,
        });
        // Documents may be requested again while corrections are required.
        await f.act(
          f.preparer,
          caseId,
          "REQUEST_DOCUMENT",
          f.sampleRequest,
        );
        await assert.rejects(
          () =>
            f.act(f.preparer, caseId, "RESUBMIT_REVIEW", {
              questionnaire: PREPARER,
              resolution: RESOLUTION,
            }),
          rejected("INVALID_TRANSITION"),
        );
        // The second hand-off orders its checks the same way: the blocker is
        // the preparer's to see, and nobody else's.
        for (const client of [f.reviewer, f.siteCoordinator])
          await assert.rejects(
            () =>
              f.act(client, caseId, "RESUBMIT_REVIEW", {
                questionnaire: PREPARER,
                resolution: RESOLUTION,
              }),
            rejected("INELIGIBLE"),
          );
        await f.act(f.applicantA, caseId, "RESPOND_DOCUMENT", {
          filename: f.sampleFilename,
        });
        await f.act(f.preparer, caseId, "VERIFY_DOCUMENT", {});
        for (const payload of [
          {},
          { questionnaire: PREPARER },
          { questionnaire: PREPARER, resolution: "   " },
          { questionnaire: PREPARER, resolution: "x".repeat(2001) },
          { questionnaire: PREPARER, resolution: RESOLUTION, extra: 1 },
          { resolution: RESOLUTION },
          { findings: RESOLUTION },
        ])
          await assert.rejects(
            () => f.act(f.preparer, caseId, "RESUBMIT_REVIEW", payload),
            rejected("VALIDATION"),
            JSON.stringify(payload),
          );
        // Only the case's own preparer answers a correction request.
        for (const client of [f.reviewer, f.siteCoordinator])
          await assert.rejects(
            () =>
              f.act(client, caseId, "RESUBMIT_REVIEW", {
                questionnaire: PREPARER,
                resolution: RESOLUTION,
              }),
            rejected("INELIGIBLE"),
          );
        // A review left active while the case went back for corrections cannot
        // be reached by the stage rules, so the defensive supersede is seeded
        // through the privileged connection rather than a product action.
        const stranded = (
          await f.sql(
            "insert into public.reviews(workspace_id,case_id,preparation_version,reviewer_person_id,status) values($1,$2,1,$3,'active') returning id",
            [f.workspaceId, caseId, f.reviewerId],
          )
        ).rows[0].id;
        await f.act(f.preparer, caseId, "RESUBMIT_REVIEW", {
          questionnaire: PREPARER,
          resolution: RESOLUTION,
        });
        const staff = await f.readStaffCase(caseId);
        assert.equal(staff.stage, "review_ready");
        assert.equal(staff.preparationVersion, 2);
        assert.equal(staff.reviews[0].resolution, RESOLUTION);
        assert.equal(staff.reviews[0].status, "corrections_requested");
        assert.equal(staff.requests[0].status, "verified");
        assert.equal(
          staff.reviews.find((review) => review.id === stranded).status,
          "superseded",
        );
      },
    );
    await t.test(
      "reminders and closure answer the review stages the workflow reaches",
      async () => {
        // A review_ready case nobody has claimed takes a reminder.
        const waiting = await f.preparedCase();
        await f.act(f.siteCoordinator, waiting, "REMIND", {});
        let staff = await f.readStaffCase(waiting);
        assert.ok(staff.lastRemindedAt);
        assert.equal(staff.lastRemindedByPersonId, f.siteCoordinatorId);
        assert.equal(staff.stage, "review_ready");
        // Work already in a reviewer's hands is not waiting for anybody.
        await f.act(f.reviewer, waiting, "CLAIM_REVIEW", {});
        await assert.rejects(
          () => f.act(f.siteCoordinator, waiting, "REMIND", {}),
          rejected("INVALID_TRANSITION"),
        );
        // Closure from reviewing keeps the review history and its reviewer.
        await f.act(f.siteCoordinator, waiting, "CLOSE_CASE", {
          reason: "other", note: CLOSURE_REASON,
          confirmed: true,
        });
        staff = await f.readStaffCase(waiting);
        assert.equal(staff.stage, "closed");
        assert.equal(staff.reviewerId, f.reviewerId);
        assert.equal(staff.reviews.length, 1);
        assert.equal(staff.reviews[0].status, "active");
        assert.equal(staff.reviews[0].preparationVersion, 1);
        // Closure from review_ready cancels nothing and creates no review.
        const readyCaseId = await f.preparedCase();
        await f.act(f.siteCoordinator, readyCaseId, "CLOSE_CASE", {
          reason: "other", note: CLOSURE_REASON,
          confirmed: true,
        });
        staff = await f.readStaffCase(readyCaseId);
        assert.equal(staff.stage, "closed");
        assert.deepEqual(staff.reviews, []);
        assert.equal(staff.preparerId, f.preparerId);
        // Closure from corrections_required cancels the open request.
        const correcting = await f.preparedCase();
        await f.act(f.reviewer, correcting, "CLAIM_REVIEW", {});
        await f.act(f.reviewer, correcting, "REQUEST_CORRECTIONS", {
          findings: FINDINGS,
        });
        await f.act(
          f.preparer,
          correcting,
          "REQUEST_DOCUMENT",
          f.sampleRequest,
        );
        await f.act(f.siteCoordinator, correcting, "CLOSE_CASE", {
          reason: "other", note: CLOSURE_REASON,
          confirmed: true,
        });
        staff = await f.readStaffCase(correcting);
        assert.equal(staff.stage, "closed");
        assert.equal(staff.requests[0].status, "cancelled");
        assert.equal(staff.reviews[0].status, "corrections_requested");
        assert.equal(staff.reviews[0].findings, FINDINGS);
        // An approved return is never closed by the office.
        const approved = await f.preparedCase();
        await f.act(f.reviewer, approved, "CLAIM_REVIEW", {});
        await f.act(f.reviewer, approved, "APPROVE_REVIEW", { questionnaire: REVIEWER });
        await assert.rejects(
          () =>
            f.act(f.siteCoordinator, approved, "CLOSE_CASE", {
              reason: "other", note: CLOSURE_REASON,
              confirmed: true,
            }),
          rejected("INVALID_TRANSITION"),
        );
        assert.equal((await f.readStaffCase(approved)).stage, "review_approved");
        // A closed case takes no review action at all.
        for (const [type, payload] of Object.entries(REVIEW_PAYLOADS))
          await assert.rejects(
            () =>
              f.act(entitled(f, type), correcting, type, payload),
            rejected("INVALID_TRANSITION"),
            `${type} after closure`,
          );
      },
    );
  } finally {
    await f.close();
  }
});

test("a reassigned case excludes its former preparer from review", async (t) => {
  const f = await createDatabaseFixture();
  try {
    // Test-only staff: Drew prepares and also holds `review`; Casey prepares only.
    const drew = await f.staff({ key: "drew", name: "Drew Hayes", capabilities: ["prepare", "review"] });
    const casey = await f.staff({ key: "casey", name: "Casey", capabilities: ["prepare"] });
    // A case Drew started and Casey now prepares, with both participants kept.
    const reassigned = async () => {
      const caseId = await f.readyCase();
      await f.act(drew.client, caseId, "CLAIM_PREPARATION", {});
      await f.reassignPreparer(caseId, drew.personId, casey.personId);
      return caseId;
    };
    await t.test(
      "the current preparer hands the case to review; the former one cannot review it",
      async () => {
        const caseId = await reassigned();
        const moved = await f.readStaffCase(caseId);
        assert.equal(moved.preparerId, casey.personId);
        assert.deepEqual([...moved.participants].sort(), [drew.personId, casey.personId].sort());
        // Only the current preparer submits.
        await assert.rejects(
          () => f.act(drew.client, caseId, "SUBMIT_REVIEW", { questionnaire: PREPARER }),
          rejected("FORBIDDEN"),
        );
        await f.act(casey.client, caseId, "SUBMIT_REVIEW", { questionnaire: PREPARER });
        assert.equal((await f.readStaffCase(caseId)).stage, "review_ready");
        // Drew holds `review` and never prepared the *current* version, but the
        // participation record is permanent, so the claim is a self-review.
        await assert.rejects(
          () => f.act(drew.client, caseId, "CLAIM_REVIEW", {}),
          rejected("SELF_REVIEW"),
        );
        await f.act(f.reviewer, caseId, "CLAIM_REVIEW", {});
        // Independence is checked before assignment, so Drew sees SELF_REVIEW
        // rather than the FORBIDDEN another reviewer would see.
        await assert.rejects(
          () => f.act(drew.client, caseId, "APPROVE_REVIEW", { questionnaire: REVIEWER }),
          rejected("SELF_REVIEW"),
        );
        await assert.rejects(
          () =>
            f.act(drew.client, caseId, "REQUEST_CORRECTIONS", {
              findings: FINDINGS,
            }),
          rejected("SELF_REVIEW"),
        );
        await f.act(f.reviewer, caseId, "APPROVE_REVIEW", { questionnaire: REVIEWER });
        const staff = await f.readStaffCase(caseId);
        assert.equal(staff.stage, "review_approved");
        assert.equal(staff.reviews[0].reviewerId, f.reviewerId);
        assert.equal(staff.preparerId, casey.personId);
      },
    );
    await t.test(
      "document work needs the current preparer and their participation",
      async () => {
        const caseId = await reassigned();
        // Participation without the current assignment is not enough.
        await assert.rejects(
          () =>
            f.act(drew.client, caseId, "REQUEST_DOCUMENT", f.sampleRequest),
          rejected("FORBIDDEN"),
        );
        await f.act(
          casey.client,
          caseId,
          "REQUEST_DOCUMENT",
          f.sampleRequest,
        );
        const requestId = (await f.readStaffCase(caseId)).requests[0].id;
        await assert.rejects(
          () =>
            f.act(drew.client, caseId, "ESCALATE_CONTACT", {
              requestId,
              reason: ESCALATION_REASON,
            }),
          rejected("FORBIDDEN"),
        );
        await f.act(f.applicantA, caseId, "RESPOND_DOCUMENT", {
          filename: f.sampleFilename,
        });
        await assert.rejects(
          () =>
            f.act(drew.client, caseId, "VERIFY_DOCUMENT", { requestId }),
          rejected("FORBIDDEN"),
        );
        await f.act(casey.client, caseId, "VERIFY_DOCUMENT", {
          requestId,
        });
        assert.equal(
          (await f.readStaffCase(caseId)).requests[0].status,
          "verified",
        );
      },
    );
    await t.test(
      "the current assignment alone is not participation either",
      async () => {
        const caseId = await f.readyCase();
        await f.act(drew.client, caseId, "CLAIM_PREPARATION", {});
        // Half of a reassignment: Casey is the current preparer with no
        // participation record. No product action can write this state.
        await f.sql("update public.cases set preparer_id=$2 where id=$1", [
          caseId,
          casey.personId,
        ]);
        for (const [type, payload] of [
          ["REQUEST_DOCUMENT", f.sampleRequest],
          ["SUBMIT_REVIEW", { questionnaire: PREPARER }],
        ])
          await assert.rejects(
            () => f.act(casey.client, caseId, type, payload),
            rejected("FORBIDDEN"),
            type,
          );
        await f.sql(
          "insert into public.preparation_participants(workspace_id,case_id,person_id) values($1,$2,$3)",
          [f.workspaceId, caseId, casey.personId],
        );
        await f.act(
          casey.client,
          caseId,
          "REQUEST_DOCUMENT",
          f.sampleRequest,
        );
        assert.equal((await f.readStaffCase(caseId)).requests.length, 1);
      },
    );
  } finally {
    await f.close();
  }
});

// Migration 033: the questionnaire tables, the follow-up purpose and the
// signing plan (OpenSpec change add-preparer-and-reviewer-questionnaires).
const EXIT_FORM = { federal: null, state: null, local: [] };
const insertPreparer = (f, caseId, overrides = {}) => {
  const row = {
    workspace_id: f.workspaceId,
    case_id: caseId,
    preparation_version: 2, // the handler already stored version 1
    submitted_by_person_id: f.preparerId,
    confirmed_by: "client",
    confirmed_by_name: null,
    confirmed_method: "phone",
    shaded_parts_completed: true,
    state_forgiveness_set: true,
    ready_for_review_on: "2026-02-10",
    ...overrides,
  };
  const keys = Object.keys(row);
  return f.sql(
    `insert into public.preparer_questionnaires(${keys.join(",")}) values(${keys.map((_, i) => `$${i + 1}`).join(",")}) returning id`,
    keys.map((key) => row[key]),
  );
};
const insertReviewer = (f, caseId, reviewId, overrides = {}) => {
  const row = {
    workspace_id: f.workspaceId,
    case_id: caseId,
    review_id: reviewId,
    answered_by_person_id: f.reviewerId,
    completed_on: "2026-02-11",
    pa_forgiveness: "eligible",
    went_over: false,
    went_over_on: null,
    went_over_how: null,
    sign_method: "portal",
    sign_appointment_at: null,
    exit_form: JSON.stringify(EXIT_FORM),
    remarks: null,
    ...overrides,
  };
  const keys = Object.keys(row);
  return f.sql(
    `insert into public.reviewer_questionnaires(${keys.join(",")}) values(${keys.map((_, i) => `$${i + 1}`).join(",")}) returning id`,
    keys.map((key) => row[key]),
  );
};
const claimedReview = async (f) => {
  const caseId = await f.preparedCase();
  await f.act(f.reviewer, caseId, "CLAIM_REVIEW", {});
  const [review] = (
    await f.sql("select id from public.reviews where case_id=$1", [caseId])
  ).rows;
  return { caseId, reviewId: review.id };
};

test("questionnaire tables are staff-only", async () => {
  const f = await createDatabaseFixture();
  try {
    const { caseId, reviewId } = await claimedReview(f);
    await insertReviewer(f, caseId, reviewId);
    for (const table of ["preparer_questionnaires", "reviewer_questionnaires"]) {
      const applicant = await f.applicantA.from(table).select("*").eq("case_id", caseId);
      assert.equal(applicant.error, null, table);
      assert.deepEqual(applicant.data, [], table);
      const staff = await f.presenter.from(table).select("*").eq("case_id", caseId);
      assert.equal(staff.error, null, table);
      assert.equal(staff.data.length, 1, table);
      for (const client of [f.applicantA, f.presenter])
        assert.ok(
          (await client.from(table).insert({ workspace_id: f.workspaceId, case_id: caseId })).error,
          `${table} insert`,
        );
    }
  } finally {
    await f.close();
  }
});

test("questionnaire table checks", async () => {
  const f = await createDatabaseFixture();
  try {
    const { caseId, reviewId } = await claimedReview(f);
    await assert.rejects(() => insertPreparer(f, caseId, { confirmed_by: "other", confirmed_by_name: null }));
    await assert.rejects(() => insertPreparer(f, caseId, { confirmed_by: "client", confirmed_by_name: "Pat" }));
    await assert.rejects(() => insertPreparer(f, caseId, { shaded_parts_completed: false }));
    await assert.rejects(() => insertPreparer(f, caseId, { state_forgiveness_set: false }));
    await assert.rejects(() => insertPreparer(f, caseId, { preparation_version: 0 }));
    await insertPreparer(f, caseId, { confirmed_by: "other", confirmed_by_name: "Pat Rivera" });
    await assert.rejects(() => insertPreparer(f, caseId), "one row per version");
    await assert.rejects(() => insertReviewer(f, caseId, reviewId, { went_over: true, went_over_on: null }));
    await assert.rejects(() => insertReviewer(f, caseId, reviewId, { went_over: false, went_over_on: "2026-02-11" }));
    await assert.rejects(() => insertReviewer(f, caseId, reviewId, { went_over: false, went_over_how: "phone" }));
    await assert.rejects(() =>
      insertReviewer(f, caseId, reviewId, { sign_method: "in_person", sign_appointment_at: "2026-02-12 10:00:30" }),
    );
    await assert.rejects(() => insertReviewer(f, caseId, randomUUID()), "review must exist");
    await assert.rejects(() => insertReviewer(f, caseId, reviewId, { exit_form: null }));
    await insertReviewer(f, caseId, reviewId, {
      went_over: true,
      went_over_on: "2026-02-11",
      went_over_how: "phone",
      sign_method: "in_person",
      sign_appointment_at: "2026-02-12 10:00:00",
    });
    await assert.rejects(() => insertReviewer(f, caseId, reviewId), "one row per review");
  } finally {
    await f.close();
  }
});

test("follow-ups have a purpose", async () => {
  const f = await createDatabaseFixture();
  try {
    const caseId = await f.readyCase();
    await f.act(f.preparer, caseId, "CLAIM_PREPARATION", {});
    await f.act(f.preparer, caseId, "REQUEST_DOCUMENT", f.sampleRequest);
    await f.act(f.preparer, caseId, "ESCALATE_CONTACT", { reason: ESCALATION_REASON });
    const [existing] = (
      await f.sql("select purpose, request_id from public.admin_followups where case_id=$1", [caseId])
    ).rows;
    assert.equal(existing.purpose, "request_documents");
    assert.ok(existing.request_id);
    const insert = (purpose, requestId) =>
      f.sql(
        "insert into public.admin_followups(workspace_id,case_id,request_id,purpose,assignee_person_id,reason,created_by_person_id) values($1,$2,$3,$4,$5,'Reason.',$5)",
        [f.workspaceId, caseId, requestId, purpose, f.siteCoordinatorId],
      );
    await assert.rejects(() => insert("go_over_return", existing.request_id));
    await assert.rejects(() => insert("request_documents", null));
    await assert.rejects(() => insert("other", existing.request_id));
    await insert("go_over_return", null);
  } finally {
    await f.close();
  }
});

test("the signing plan is the client's to read", async () => {
  const f = await createDatabaseFixture();
  try {
    const caseId = await f.preparedCase();
    const set = (plan, at) =>
      f.sql("update public.cases set signing_plan=$2, signing_appointment_at=$3 where id=$1", [caseId, plan, at]);
    const [before] = (
      await f.sql("select signing_plan, signing_appointment_at from public.cases where id=$1", [caseId])
    ).rows;
    assert.deepEqual(before, { signing_plan: null, signing_appointment_at: null });
    await assert.rejects(() => set("appointment", null));
    await assert.rejects(() => set("portal", "2026-02-12 10:00:00"));
    await assert.rejects(() => set("later", null));
    await set("appointment", "2026-02-12 10:00:00");
    const own = await f.applicantA
      .from("cases")
      .select("signing_plan, signing_appointment_at")
      .eq("id", caseId);
    assert.equal(own.error, null);
    assert.equal(own.data.length, 1);
    assert.equal(own.data[0].signing_plan, "appointment");
    assert.equal(own.data[0].signing_appointment_at, "2026-02-12T10:00:00");
    await set("portal", null);
  } finally {
    await f.close();
  }
});

// Validation of the two questionnaires (design D3, D4). Each bad payload is
// refused as VALIDATION and leaves the stage and revision alone.
const without = (object, key) => {
  const copy = { ...object };
  delete copy[key];
  return copy;
};
const exit = (parts) => ({
  ...REVIEWER,
  exitForm: { federal: null, state: null, local: [], ...parts },
});
const sit = { type: "SIT", method: "paper", result: "none" };
const BAD_PREPARER = {
  "missing method": without(PREPARER, "confirmedMethod"),
  "unticked shaded": { ...PREPARER, shadedPartsCompleted: false },
  "unticked forgiveness": { ...PREPARER, stateForgivenessSet: false },
  "other without name": { ...PREPARER, confirmedBy: "other" },
  "name without other": { ...PREPARER, confirmedByName: "Pat Example" },
  "whitespace other name": { ...PREPARER, confirmedBy: "other", confirmedByName: "   " },
  "impossible date": { ...PREPARER, readyForReviewOn: "2026-02-30" },
  "extra key": { ...PREPARER, note: "x" },
};
const BAD_REVIEWER = {
  "yes without date": without({ ...REVIEWER, wentOver: true }, "wentOverOn"),
  "no with date": { ...REVIEWER, wentOver: false },
  "no with how": { ...without(REVIEWER, "wentOverOn"), wentOver: false },
  "appointment seconds": {
    ...REVIEWER,
    signMethod: "in_person",
    signAppointmentAt: "2026-11-02T14:30:15",
  },
  "whitespace remarks refused": { ...REVIEWER, remarks: "   " },
  "refund without amount": exit({
    federal: { method: "efile", result: "refund", refundBy: "check" },
  }),
  "none with amount": exit({
    federal: { method: "paper", result: "none", amount: "1" },
  }),
  "debit without date": exit({
    state: { method: "efile", result: "owe", amount: "45.50", oweBy: "direct_debit" },
  }),
  "amount three decimals": exit({
    federal: { method: "efile", result: "owe", amount: "1.005", oweBy: "mail_check" },
  }),
  "duplicate local": exit({ local: [sit, sit] }),
  "unknown local type": exit({ local: [{ ...sit, type: "XYZ" }] }),
  "banking detail": exit({
    federal: {
      method: "efile",
      result: "refund",
      amount: "10",
      refundBy: "direct_deposit",
      accountNumber: "000123",
    },
  }),
  "routing number": exit({
    federal: {
      method: "efile",
      result: "refund",
      amount: "10",
      refundBy: "direct_deposit",
      routingNumber: "000000000",
    },
  }),
  "old empty payload": null,
};
const GOOD_REVIEWER = {
  "no groups": REVIEWER,
  "NPT owe by mail check plus BIRT paper none": exit({
    local: [
      { type: "NPT", method: "efile", result: "owe", amount: "120.00", oweBy: "mail_check" },
      { type: "BIRT", method: "paper", result: "none" },
    ],
  }),
  "amount zero": exit({
    federal: { method: "efile", result: "refund", amount: "0", refundBy: "check" },
  }),
  "amount maximum": exit({
    state: { method: "paper", result: "owe", amount: "999999.99", oweBy: "mail_check" },
  }),
  "debit with date": exit({
    state: {
      method: "efile",
      result: "owe",
      amount: "45.50",
      oweBy: "direct_debit",
      debitOn: "2026-04-15",
    },
  }),
  "in person with appointment": {
    ...REVIEWER,
    signMethod: "in_person",
    signAppointmentAt: "2026-11-02T14:30",
    remarks: "Fictional remark.",
  },
  "went over no, without how": {
    ...without(without(REVIEWER, "wentOverOn"), "wentOverHow"),
    wentOver: false,
  },
};

test("questionnaire payloads are validated by the database", async (t) => {
  const f = await createDatabaseFixture();
  try {
    const unchanged = async (caseId, run) => {
      const before = await f.readStaffCase(caseId);
      await run();
      const after = await f.readStaffCase(caseId);
      assert.equal(after.stage, before.stage);
      assert.equal(after.revision, before.revision);
    };
    await t.test("the preparer questionnaire", async () => {
      const caseId = await f.readyCase();
      await f.act(f.preparer, caseId, "CLAIM_PREPARATION", {});
      for (const [name, questionnaire] of [
        ...Object.entries(BAD_PREPARER),
        ["old empty payload", null],
      ])
        await unchanged(caseId, () =>
          assert.rejects(
            () =>
              f.act(
                f.preparer,
                caseId,
                "SUBMIT_REVIEW",
                questionnaire === null ? {} : { questionnaire },
              ),
            rejected("VALIDATION"),
            name,
          ),
        );
      await f.act(f.preparer, caseId, "SUBMIT_REVIEW", {
        questionnaire: { ...PREPARER, confirmedBy: "other", confirmedByName: "Pat Example" },
      });
    });
    await t.test("the reviewer questionnaire", async () => {
      const caseId = await reviewingCase(f, f.reviewer);
      for (const [name, questionnaire] of Object.entries(BAD_REVIEWER))
        await unchanged(caseId, () =>
          assert.rejects(
            () =>
              f.act(
                f.reviewer,
                caseId,
                "APPROVE_REVIEW",
                questionnaire === null ? {} : { questionnaire },
              ),
            rejected("VALIDATION"),
            name,
          ),
        );
      // Cases like these pass the payload check (the handler is Task 4's), so
      // ask check_payload itself.
      for (const [name, questionnaire] of Object.entries(GOOD_REVIEWER))
        await f.sql(
          "select vitally_private.check_payload('APPROVE_REVIEW',$1::jsonb)",
          [JSON.stringify({ questionnaire })],
        ).catch((error) => assert.fail(`${name}: ${error.message}`));
    });
    await t.test("a resubmission needs both a questionnaire and a resolution", async () => {
      const caseId = await correctedCase(f, f.reviewer);
      for (const payload of [
        { resolution: RESOLUTION },
        { questionnaire: PREPARER },
        { questionnaire: { ...PREPARER, shadedPartsCompleted: false }, resolution: RESOLUTION },
      ])
        await unchanged(caseId, () =>
          assert.rejects(
            () => f.act(f.preparer, caseId, "RESUBMIT_REVIEW", payload),
            rejected("VALIDATION"),
          ),
        );
    });
    await t.test("the 032 branches survived the copy", async () => {
      for (const [type, payload] of [
        ["START_SCREENING", {}],
        ["MARK_READY_TO_EFILE", { confirmed: true }],
        ["MARK_EFILED", { confirmed: true, methods: { federal: "efile", state: "efile" } }],
      ])
        await f.sql("select vitally_private.check_payload($1,$2::jsonb)", [
          type,
          JSON.stringify(payload),
        ]);
      for (const [type, payload] of [
        ["START_SCREENING", { x: 1 }],
        ["MARK_READY_TO_EFILE", {}],
      ])
        await assert.rejects(
          () =>
            f.sql("select vitally_private.check_payload($1,$2::jsonb)", [
              type,
              JSON.stringify(payload),
            ]),
          rejected("VALIDATION"),
        );
    });
  } finally {
    await f.close();
  }
});

// The handlers store the answers (design D5, D6, D10, D11, D12).
const setService = (f, caseId, service) =>
  f.sql("update public.cases set answers=answers||$2::jsonb where id=$1", [
    caseId,
    JSON.stringify({ service }),
  ]);
const rowsFor = async (f, table, caseId) =>
  (await f.sql(`select * from public.${table} where case_id=$1 order by created_at`, [caseId])).rows;
const goOver = async (f, caseId) =>
  (await f.sql("select * from public.admin_followups where case_id=$1 and purpose='go_over_return'", [caseId])).rows;
const NO = { ...without(without(REVIEWER, "wentOverOn"), "wentOverHow"), wentOver: false };
const plan = async (f, caseId) =>
  (await f.sql("select signing_plan, to_char(signing_appointment_at,'YYYY-MM-DD\"T\"HH24:MI') as signing_appointment_at from public.cases where id=$1", [caseId])).rows[0];
const dayBefore = (year) => `${year - 1}-12-31`;
const defaultFollowup = async (f) =>
  (await f.sql("select default_followup_person_id d from public.workspaces where id=$1", [f.workspaceId])).rows[0].d;

test("the three handlers store the answers", async (t) => {
  const f = await createDatabaseFixture();
  try {
    const season = async (caseId) =>
      Number(
        (
          await f.sql(
            "select coalesce(c.season,w.current_season) as s from public.cases c join public.workspaces w on w.id=c.workspace_id where c.id=$1",
            [caseId],
          )
        ).rows[0].s,
      );
    const receiptCount = async (caseId) =>
      (await f.sql("select count(*)::int n from public.action_receipts where workspace_id=$1", [f.workspaceId])).rows[0].n;
    await t.test("a valid submit stores one questionnaire at the new version", async () => {
      const caseId = await f.readyCase();
      await f.act(f.preparer, caseId, "CLAIM_PREPARATION", {});
      await f.act(f.preparer, caseId, "SUBMIT_REVIEW", { questionnaire: PREPARER });
      const rows = await rowsFor(f, "preparer_questionnaires", caseId);
      assert.equal(rows.length, 1);
      assert.equal(Number(rows[0].preparation_version), 1);
      assert.equal(rows[0].confirmed_method, "phone");
      assert.equal(rows[0].confirmed_by, "client");
      assert.equal(rows[0].submitted_by_person_id, f.preparerId);
    });
    await t.test("resubmit keeps both submissions", async () => {
      const caseId = await correctedCase(f, f.reviewer);
      await f.act(f.preparer, caseId, "RESUBMIT_REVIEW", {
        questionnaire: { ...PREPARER, confirmedBy: "other", confirmedByName: "  Pat Example ", confirmedMethod: "video" },
        resolution: RESOLUTION,
      });
      const rows = await rowsFor(f, "preparer_questionnaires", caseId);
      assert.deepEqual(rows.map((r) => Number(r.preparation_version)), [1, 2]);
      assert.equal(rows[0].confirmed_method, "phone");
      assert.equal(rows[1].confirmed_method, "video");
      assert.equal(rows[1].confirmed_by_name, "Pat Example");
    });
    await t.test("a refused submit changes nothing", async () => {
      const caseId = await f.readyCase();
      await f.act(f.preparer, caseId, "CLAIM_PREPARATION", {});
      const before = await f.readStaffCase(caseId);
      const receipts = await receiptCount(caseId);
      const early = dayBefore(await season(caseId));
      await assert.rejects(
        () => f.act(f.preparer, caseId, "SUBMIT_REVIEW", { questionnaire: { ...PREPARER, readyForReviewOn: early } }),
        rejected("VALIDATION"),
      );
      const after = await f.readStaffCase(caseId);
      assert.equal(after.stage, "preparing");
      assert.equal(after.revision, before.revision);
      assert.equal(after.preparationVersion, before.preparationVersion);
      assert.equal(await receiptCount(caseId), receipts);
      assert.equal((await rowsFor(f, "preparer_questionnaires", caseId)).length, 0);
    });
    await t.test("ready date before the season is refused", async () => {
      const caseId = await correctedCase(f, f.reviewer);
      const early = { ...PREPARER, readyForReviewOn: dayBefore(await season(caseId)) };
      await assert.rejects(
        () => f.act(f.preparer, caseId, "RESUBMIT_REVIEW", { questionnaire: early, resolution: RESOLUTION }),
        rejected("VALIDATION"),
      );
      const reviewing = await reviewingCase(f, f.reviewer);
      const before = dayBefore(await season(reviewing));
      for (const key of ["completedOn", "wentOverOn"])
        await assert.rejects(
          () => f.act(f.reviewer, reviewing, "APPROVE_REVIEW", { questionnaire: { ...REVIEWER, [key]: before } }),
          rejected("VALIDATION"),
          key,
        );
      assert.equal((await rowsFor(f, "reviewer_questionnaires", reviewing)).length, 0);
    });
    await t.test("drop-off in person needs an appointment", async () => {
      const caseId = await reviewingCase(f, f.reviewer);
      await setService(f, caseId, "drop_off");
      await assert.rejects(
        () => f.act(f.reviewer, caseId, "APPROVE_REVIEW", { questionnaire: { ...REVIEWER, signMethod: "in_person" } }),
        rejected("VALIDATION"),
      );
      assert.equal((await f.readStaffCase(caseId)).stage, "reviewing");
    });
    await t.test("same-day in person refuses an appointment, and accepts none", async () => {
      const caseId = await reviewingCase(f, f.reviewer);
      await setService(f, caseId, "same_day");
      await assert.rejects(
        () =>
          f.act(f.reviewer, caseId, "APPROVE_REVIEW", {
            questionnaire: { ...REVIEWER, signMethod: "in_person", signAppointmentAt: "2026-11-02T14:30" },
          }),
        rejected("VALIDATION"),
      );
      await f.act(f.reviewer, caseId, "APPROVE_REVIEW", { questionnaire: { ...REVIEWER, signMethod: "in_person" } });
      assert.equal((await rowsFor(f, "reviewer_questionnaires", caseId))[0].sign_appointment_at, null);
    });
    await t.test("online may sign in person", async () => {
      const caseId = await reviewingCase(f, f.reviewer);
      await setService(f, caseId, "online");
      await f.act(f.reviewer, caseId, "APPROVE_REVIEW", {
        questionnaire: { ...REVIEWER, signMethod: "in_person", signAppointmentAt: "2026-11-02T14:30" },
      });
      assert.equal((await plan(f, caseId)).signing_plan, "appointment");
    });
    await t.test("a portal signing refuses an appointment", async () => {
      const caseId = await reviewingCase(f, f.reviewer);
      await assert.rejects(
        () =>
          f.act(f.reviewer, caseId, "APPROVE_REVIEW", {
            questionnaire: { ...REVIEWER, signMethod: "portal", signAppointmentAt: "2026-11-02T14:30" },
          }),
        rejected("VALIDATION"),
      );
    });
    await t.test("approval with no opens one go-over follow-up", async () => {
      const caseId = await reviewingCase(f, f.reviewer);
      await f.act(f.reviewer, caseId, "APPROVE_REVIEW", { questionnaire: NO });
      const tasks = await goOver(f, caseId);
      assert.equal(tasks.length, 1);
      assert.equal(tasks[0].request_id, null);
      assert.equal(tasks[0].status, "open");
      assert.equal(tasks[0].reason, "Go over the return with the client: the reviewer did not.");
      assert.equal(tasks[0].created_by_person_id, f.reviewerId);
      assert.equal(tasks[0].assignee_person_id, await defaultFollowup(f));
      assert.equal((await rowsFor(f, "reviewer_questionnaires", caseId))[0].went_over, false);
    });
    await t.test("approval with yes opens none", async () => {
      const caseId = await f.approvedCase();
      assert.equal((await goOver(f, caseId)).length, 0);
    });
    await t.test("no office person refuses the approval", async () => {
      const caseId = await reviewingCase(f, f.reviewer);
      const original = await defaultFollowup(f);
      await f.sql("update public.workspaces set default_followup_person_id=null where id=$1", [f.workspaceId]);
      try {
        await assert.rejects(
          () => f.act(f.reviewer, caseId, "APPROVE_REVIEW", { questionnaire: NO }),
          rejected("VALIDATION"),
        );
      } finally {
        await f.sql("update public.workspaces set default_followup_person_id=$2 where id=$1", [f.workspaceId, original]);
      }
      const staff = await f.readStaffCase(caseId);
      assert.equal(staff.stage, "reviewing");
      assert.equal(staff.reviews[0].status, "active");
      assert.equal((await rowsFor(f, "reviewer_questionnaires", caseId)).length, 0);
      assert.equal((await goOver(f, caseId)).length, 0);
    });
    await t.test("another volunteer cannot submit", async () => {
      const caseId = await f.readyCase();
      await f.act(f.preparer, caseId, "CLAIM_PREPARATION", {});
      const dana = await f.staff({ key: "dana", name: "Dana", capabilities: ["prepare"] });
      await assert.rejects(
        () => f.act(dana.client, caseId, "SUBMIT_REVIEW", { questionnaire: PREPARER }),
        rejected("FORBIDDEN"),
      );
      assert.equal((await rowsFor(f, "preparer_questionnaires", caseId)).length, 0);
    });
    await t.test("the office works a go-over follow-up", async () => {
      const caseId = await reviewingCase(f, f.reviewer);
      await f.act(f.reviewer, caseId, "APPROVE_REVIEW", { questionnaire: NO });
      const [task] = await goOver(f, caseId);
      const before = (await f.readStaffCase(caseId)).stage;
      const { contactId } = await f.logContact(f.siteCoordinator, caseId, SAMPLE_CONTACT(), task.id);
      const [logged] = (await f.sql("select followup_id, outcome from public.contact_log where id=$1", [contactId])).rows;
      assert.equal(logged.followup_id, task.id);
      assert.equal(logged.outcome, "reached");
      await assert.rejects(
        () => f.logContact(f.preparer, caseId, SAMPLE_CONTACT(), task.id),
        rejected("FORBIDDEN"),
      );
      await f.act(f.siteCoordinator, caseId, "RESOLVE_FOLLOWUP", {
        followupId: task.id,
        outcome: "reached",
        note: "Went over the fictional return.",
      });
      assert.equal((await goOver(f, caseId))[0].status, "resolved");
      assert.equal((await f.readStaffCase(caseId)).stage, before);
    });
    await t.test("yes completes the review-contact step", async () => {
      const caseId = await f.approvedCase();
      const [r] = (await f.sql("select * from public.reviews where case_id=$1 and status='approved'", [caseId])).rows;
      assert.equal(r.client_contact_status, "completed");
      assert.equal(r.client_contact_outcome, "reached");
      assert.ok(r.client_contacted_at);
    });
    await t.test("no completes it with no outcome", async () => {
      const caseId = await reviewingCase(f, f.reviewer);
      await f.act(f.reviewer, caseId, "APPROVE_REVIEW", { questionnaire: NO });
      const [r] = (await f.sql("select * from public.reviews where case_id=$1 and status='approved'", [caseId])).rows;
      assert.equal(r.client_contact_status, "completed");
      assert.equal(r.client_contact_outcome, null);
      assert.ok(r.client_contacted_at);
      assert.equal((await goOver(f, caseId)).length, 1);
    });
    await t.test("yes meets the ready-to-e-file gate", async () => {
      const caseId = await f.approvedCase();
      await f.act(f.siteCoordinator, caseId, "MARK_READY_TO_EFILE", { confirmed: true });
      assert.equal((await f.readStaffCase(caseId)).stage, "ready_to_efile");
    });
    await t.test("recording a conversation after a questionnaire approval is refused", async () => {
      const caseId = await f.approvedCase();
      await assert.rejects(
        () => f.act(f.reviewer, caseId, "RECORD_REVIEW_CONTACT", REVIEW_PAYLOADS.RECORD_REVIEW_CONTACT),
        rejected("INVALID_TRANSITION"),
      );
    });
    await t.test("a legacy pending approval can still be recorded", async () => {
      const caseId = await f.legacyApprovedCase();
      assert.equal((await rowsFor(f, "reviewer_questionnaires", caseId)).length, 0);
      await f.act(f.reviewer, caseId, "RECORD_REVIEW_CONTACT", REVIEW_PAYLOADS.RECORD_REVIEW_CONTACT);
      const [r] = (await f.sql("select client_contact_status s from public.reviews where case_id=$1", [caseId])).rows;
      assert.equal(r.s, "completed");
    });
    await t.test("the signing plan follows the answers", async () => {
      const approve = async (service, questionnaire) => {
        const caseId = await reviewingCase(f, f.reviewer);
        await setService(f, caseId, service);
        await f.act(f.reviewer, caseId, "APPROVE_REVIEW", { questionnaire });
        return plan(f, caseId);
      };
      const appt = await approve("drop_off", { ...REVIEWER, signMethod: "in_person", signAppointmentAt: "2026-11-02T14:30" });
      assert.equal(appt.signing_plan, "appointment");
      assert.equal(appt.signing_appointment_at, "2026-11-02T14:30");
      const same = await approve("same_day", { ...REVIEWER, signMethod: "in_person" });
      assert.deepEqual(same, { signing_plan: "same_day", signing_appointment_at: null });
      const portal = await approve("online", REVIEWER);
      assert.deepEqual(portal, { signing_plan: "portal", signing_appointment_at: null });
      const first = await approve("online", NO);
      assert.deepEqual(first, { signing_plan: "go_over_first", signing_appointment_at: null });
    });
    await t.test("after the go-over is resolved the client sees the signing variant", async () => {
      // A "no" approval reads go_over_first until the office resolves its
      // go-over task, with either outcome; then the reviewer's signing method.
      const resolveGoOver = async (service, questionnaire, outcome) => {
        const caseId = await reviewingCase(f, f.reviewer);
        await setService(f, caseId, service);
        await f.act(f.reviewer, caseId, "APPROVE_REVIEW", { questionnaire });
        assert.equal((await plan(f, caseId)).signing_plan, "go_over_first");
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
        return plan(f, caseId);
      };
      assert.deepEqual(await resolveGoOver("online", NO, "reached"), {
        signing_plan: "portal",
        signing_appointment_at: null,
      });
      assert.deepEqual(
        await resolveGoOver("drop_off", { ...NO, signMethod: "in_person", signAppointmentAt: "2026-11-02T14:30" }, "no_further_contact"),
        { signing_plan: "appointment", signing_appointment_at: "2026-11-02T14:30" },
      );
      assert.deepEqual(await resolveGoOver("same_day", { ...NO, signMethod: "in_person" }, "reached"), {
        signing_plan: "same_day",
        signing_appointment_at: null,
      });
    });
    await t.test("a go-over resolved during a hold still switches the plan", async () => {
      // Issue #171. A Hold from Ready to exit leaves the go-over task open.
      // Resolving it while the case is on hold switches the plan too, so after
      // Got in touch the client reads the reviewer's signing variant.
      const caseId = await reviewingCase(f, f.reviewer);
      await setService(f, caseId, "online");
      await f.act(f.reviewer, caseId, "APPROVE_REVIEW", { questionnaire: NO });
      const [task] = await goOver(f, caseId);
      await f.act(f.siteCoordinator, caseId, "PUT_ON_HOLD", { confirmed: true });
      assert.equal((await f.readStaffCase(caseId)).stage, "on_hold");
      // Any other task resolved during the hold leaves the plan alone. The
      // inserted notice stands in for any purpose but go_over_return.
      const [other] = (
        await f.sql(
          "insert into public.admin_followups(workspace_id,case_id,purpose,assignee_person_id,reason,created_by_person_id) values($1,$2,'withdrawal_notice',$3,'Fictional notice.',$3) returning id",
          [f.workspaceId, caseId, f.siteCoordinatorId],
        )
      ).rows;
      await f.act(f.siteCoordinator, caseId, "RESOLVE_FOLLOWUP", {
        followupId: other.id,
        outcome: "reached",
        note: "Fictional: another task.",
      });
      assert.deepEqual(await plan(f, caseId), { signing_plan: "go_over_first", signing_appointment_at: null });
      await f.act(f.siteCoordinator, caseId, "RESOLVE_FOLLOWUP", {
        followupId: task.id,
        outcome: "reached",
        note: "Fictional: went over the return by phone.",
      });
      assert.deepEqual(await plan(f, caseId), { signing_plan: "portal", signing_appointment_at: null });
      await f.act(f.siteCoordinator, caseId, "RESUME_FROM_HOLD", { confirmed: true });
      assert.equal((await f.readStaffCase(caseId)).stage, "review_approved");
      assert.deepEqual(await plan(f, caseId), { signing_plan: "portal", signing_appointment_at: null });
      await f.act(f.siteCoordinator, caseId, "MARK_READY_TO_EFILE", { confirmed: true });
      assert.equal((await f.readStaffCase(caseId)).stage, "ready_to_efile");
    });
    await t.test("another follow-up holder resolves the go-over (042)", async () => {
      const jo = await f.staff({ key: "jo", name: "Jo Rivera", capabilities: ["admin", "followup"] });
      const caseId = await reviewingCase(f, f.reviewer);
      await setService(f, caseId, "online");
      await f.act(f.reviewer, caseId, "APPROVE_REVIEW", { questionnaire: NO });
      const [task] = await goOver(f, caseId);
      assert.notEqual(task.assignee_person_id, jo.personId);
      await f.logContact(jo.client, caseId, SAMPLE_CONTACT(), task.id);
      await f.act(jo.client, caseId, "RESOLVE_FOLLOWUP", {
        followupId: task.id,
        outcome: "reached",
        note: "Fictional: went over the return by phone.",
      });
      assert.deepEqual(await plan(f, caseId), { signing_plan: "portal", signing_appointment_at: null });
      await f.act(f.siteCoordinator, caseId, "MARK_READY_TO_EFILE", { confirmed: true });
      assert.equal((await f.readStaffCase(caseId)).stage, "ready_to_efile");
    });
    await t.test("client messages carry no answer", async () => {
      const q = {
        ...REVIEWER,
        remarks: "Fictional remark about the refund.",
        exitForm: { federal: { method: "efile", result: "refund", amount: "123.45", refundBy: "check" }, state: null, local: [] },
      };
      const caseId = await reviewingCase(f, f.reviewer);
      await f.act(f.reviewer, caseId, "APPROVE_REVIEW", { questionnaire: q });
      for (const m of await f.clientMessages(caseId)) {
        assertPlainClientMessage(m);
        assert.ok(!m.includes("123.45") && !m.includes("remark"));
      }
      const events = await f.sql("select detail::text d from public.case_events where case_id=$1", [caseId]);
      for (const e of events.rows) assert.ok(!e.d.includes("123.45"), "no amount in history");
    });
  } finally {
    await f.close();
  }
});
