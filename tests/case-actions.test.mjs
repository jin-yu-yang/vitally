import test from "node:test";
import assert from "node:assert/strict";
import {
  payloadFor,
  PAYLOAD_ACTIONS,
  SAMPLE_DOCUMENT_FILENAME,
  CONTACT_OUTCOMES,
  FOLLOWUP_RESOLUTION_OUTCOMES,
  screeningCheckKeys,
} from "../src/case-actions.mjs";
import { CASE_ACTIONS, CLOSING_REASONS } from "../src/contracts.mjs";
import { MATERIALS_ITEMS } from "../src/intake-catalogue.mjs";

// The payload rules are a pure function, so these tests are the payload table
// of `contracts-excerpt.md` read back out of the code.

const invalid = (error) => error.code === "VALIDATION";

const PREPARER_FORM = {
  confirmedBy: "client",
  confirmedMethod: "phone",
  shadedPartsCompleted: "yes",
  stateForgivenessSet: "yes",
  readyForReviewOn: "2026-10-16",
};
const PREPARER_QUESTIONNAIRE = {
  confirmedBy: "client",
  confirmedMethod: "phone",
  shadedPartsCompleted: true,
  stateForgivenessSet: true,
  readyForReviewOn: "2026-10-16",
};
const REVIEWER_FORM = {
  completedOn: "2026-10-17",
  paForgiveness: "eligible",
  wentOver: "no",
  signMethod: "portal",
};
const REVIEWER_QUESTIONNAIRE = {
  completedOn: "2026-10-17",
  paForgiveness: "eligible",
  wentOver: false,
  signMethod: "portal",
  exitForm: { federal: null, state: null, local: [] },
};

test("every action builds exactly the payload the contract names", () => {
  const cases = [
    ["SUBMIT", {}, {}, { confirmed: true }],
    [
      "VERIFY_INTAKE",
      { service: "drop_off" },
      // Three ticked checkboxes, exactly as a form reports them.
      { phone: "true", documents: "true", in_scope: "true" },
      { checks: { phone: true, documents: true, in_scope: true } },
    ],
    ["CLAIM_PREPARATION", {}, {}, {}],
    [
      "SUBMIT_REVIEW",
      {},
      PREPARER_FORM,
      { questionnaire: PREPARER_QUESTIONNAIRE },
    ],
    ["CLAIM_REVIEW", {}, {}, {}],
    [
      "APPROVE_REVIEW",
      { service: "online" },
      REVIEWER_FORM,
      { questionnaire: REVIEWER_QUESTIONNAIRE },
    ],
    ["REMIND", {}, {}, {}],
    [
      "REQUEST_DOCUMENT",
      {},
      { title: " Mileage record ", message: " Please add the sample. " },
      { title: "Mileage record", message: "Please add the sample." },
    ],
    [
      "RESPOND_DOCUMENT",
      { requestId: "req-1" },
      {},
      { requestId: "req-1", filename: SAMPLE_DOCUMENT_FILENAME },
    ],
    [
      "RECORD_DOCUMENT_RESPONSE",
      { requestId: "req-1" },
      {},
      { requestId: "req-1", filename: SAMPLE_DOCUMENT_FILENAME },
    ],
    ["VERIFY_DOCUMENT", { requestId: "req-1" }, {}, { requestId: "req-1" }],
    [
      "ESCALATE_CONTACT",
      { requestId: "req-1" },
      { reason: "No response in a week" },
      { requestId: "req-1", reason: "No response in a week" },
    ],
    [
      "RESOLVE_FOLLOWUP",
      { followupId: "task-1" },
      { outcome: "reached", note: "Spoke with the client" },
      { followupId: "task-1", outcome: "reached", note: "Spoke with the client" },
    ],
    [
      "REQUEST_CORRECTIONS",
      {},
      { findings: "Check the household size" },
      { findings: "Check the household size" },
    ],
    [
      "RESUBMIT_REVIEW",
      {},
      { ...PREPARER_FORM, resolution: "Household size corrected" },
      { questionnaire: PREPARER_QUESTIONNAIRE, resolution: "Household size corrected" },
    ],
    [
      "RECORD_REVIEW_CONTACT",
      {},
      { outcome: "reached", note: "Explained the next step" },
      { outcome: "reached", note: "Explained the next step" },
    ],
    [
      "CLOSE_CASE",
      {},
      { "close-reason": "duplicate", confirmed: "true" },
      { confirmed: true, reason: "duplicate" },
    ],
    [
      "CLOSE_CASE",
      {},
      { "close-reason": "other", "close-note": " Moved away ", confirmed: "true" },
      { confirmed: true, reason: "other", note: "Moved away" },
    ],
    [
      "PUT_ON_HOLD",
      {},
      { "hold-note": " Called twice ", confirmed: "true" },
      { confirmed: true, note: "Called twice" },
    ],
    ["PUT_ON_HOLD", {}, { confirmed: "true" }, { confirmed: true }],
    ["RESUME_FROM_HOLD", {}, { confirmed: "true" }, { confirmed: true }],
    ["WITHDRAW", {}, { "withdraw-confirmed": "on" }, { confirmed: true }],
    [
      "REQUEST_DOCUMENTS_AT_INTAKE",
      {},
      {
        "request-title-1": " Photo ID ",
        "request-message-1": " Please upload it ",
        "request-title-2": "",
        "request-message-2": "  ",
        "request-title-3": "W-2",
        "request-message-3": "From your employer",
      },
      {
        requests: [
          { title: "Photo ID", message: "Please upload it" },
          { title: "W-2", message: "From your employer" },
        ],
      },
    ],
    ["START_SCREENING", {}, {}, {}],
    ["MARK_READY_TO_EFILE", {}, { confirmed: "true" }, { confirmed: true }],
    [
      "MARK_EFILED",
      {},
      { confirmed: "true", "filing-combination": "efile_and_paper" },
      { confirmed: true, methods: { federal: "efile", state: "paper" } },
    ],
    [
      "RECORD_FILING_RESULT",
      {},
      { "result-federal": "accepted", "date-federal": "2026-10-20" },
      { confirmed: true, results: { federal: { result: "accepted", date: "2026-10-20" } } },
    ],
    ["RETURN_TO_SIGNING", {}, { confirmed: "true" }, { confirmed: true }],
    [
      "UPDATE_CONTACT",
      {},
      { bestContactTime: ["weekday_morning", "weekend"], bestContactNote: " After 5pm " },
      { bestContactTime: ["weekday_morning", "weekend"], bestContactNote: "After 5pm" },
    ],
    [
      "RECORD_MATERIALS",
      {},
      { received: ["photo_id", "w2"] },
      { received: ["photo_id", "w2"] },
    ],
    [
      "ASSIGN_CASE",
      {},
      { slot: "preparer", personId: "person-alex" },
      { slot: "preparer", personId: "person-alex" },
    ],
  ];
  for (const [type, dataset, values, payload] of cases)
    assert.deepEqual(payloadFor(type, dataset, values), { type, payload }, type);
  // Every action in the table is covered, and the table is every action this
  // module claims to build.
  assert.deepEqual(
    [...new Set(cases.map(([type]) => type))].toSorted(),
    [...PAYLOAD_ACTIONS].toSorted(),
  );
});

test("the claim buttons send an empty payload and no dataset leaks into it", () => {
  assert.deepEqual(payloadFor("CLAIM_REVIEW", {}, {}), {
    type: "CLAIM_REVIEW",
    payload: {},
  });
  // A dataset carries the case id and whatever else the markup needed; none of
  // it may become an action payload field.
  assert.deepEqual(
    payloadFor(
      "CLAIM_REVIEW",
      { caseId: "case-a", personId: "morgan", requestId: "req-1" },
      { findings: "ignored" },
    ),
    { type: "CLAIM_REVIEW", payload: {} },
  );
  assert.deepEqual(payloadFor("CLAIM_PREPARATION", { caseId: "case-a" }, {}), {
    type: "CLAIM_PREPARATION",
    payload: {},
  });
});

test("ASSIGN_CASE is a case action with slot and personId", () => {
  assert.ok(CASE_ACTIONS.includes("ASSIGN_CASE"));
  assert.ok(PAYLOAD_ACTIONS.includes("ASSIGN_CASE"));
  // Only the two named fields travel; a dataset's other keys do not.
  assert.deepEqual(
    payloadFor("ASSIGN_CASE", { caseId: "case-a" }, { slot: "reviewer", personId: "person-sam", extra: 1 }),
    { type: "ASSIGN_CASE", payload: { slot: "reviewer", personId: "person-sam" } },
  );
});

test("an unknown type is a local validation failure, never a request", () => {
  for (const type of [
    "BOGUS",
    "claim_review",
    "CLAIM REVIEW",
    "",
    null,
    undefined,
    // An inherited property name is not an action either.
    "toString",
    "constructor",
  ])
    assert.throws(() => payloadFor(type, {}, {}), invalid, String(type));
  // SAVE_ANSWERS is a real action, but not one a form builds: the controller
  // owns the draft and the revision the edits started from.
  assert.ok(CASE_ACTIONS.includes("SAVE_ANSWERS"));
  assert.ok(!PAYLOAD_ACTIONS.includes("SAVE_ANSWERS"));
  assert.throws(() => payloadFor("SAVE_ANSWERS", {}, {}), invalid);
  // SAVE_PREPARER_FIELDS neither: the page reads the uploaded copy, and the
  // controller sends it with the latest revision (change add-preparer-13614c-fields).
  assert.ok(CASE_ACTIONS.includes("SAVE_PREPARER_FIELDS"));
  assert.ok(!PAYLOAD_ACTIONS.includes("SAVE_PREPARER_FIELDS"));
  assert.throws(() => payloadFor("SAVE_PREPARER_FIELDS", {}, {}), invalid);
});

test("a missing required field refuses before anything is sent", () => {
  const missing = [
    ["REQUEST_DOCUMENT", {}, { message: "Only a message" }],
    ["REQUEST_DOCUMENT", {}, { title: "Only a title" }],
    ["REQUEST_DOCUMENT", {}, { title: "   ", message: "   " }],
    ["RESPOND_DOCUMENT", {}, {}],
    ["RECORD_DOCUMENT_RESPONSE", {}, {}],
    ["VERIFY_DOCUMENT", {}, {}],
    ["VERIFY_DOCUMENT", { requestId: "  " }, {}],
    ["ESCALATE_CONTACT", { requestId: "req-1" }, {}],
    ["ESCALATE_CONTACT", {}, { reason: "No response" }],
    ["RESOLVE_FOLLOWUP", { followupId: "task-1" }, { note: "A note" }],
    ["RESOLVE_FOLLOWUP", {}, { outcome: "reached", note: "A note" }],
    ["RESOLVE_FOLLOWUP", { followupId: "task-1" }, { outcome: "reached" }],
    ["REQUEST_CORRECTIONS", {}, {}],
    ["REQUEST_CORRECTIONS", {}, { findings: "\n\t " }],
    ["RESUBMIT_REVIEW", {}, {}],
    ["RESUBMIT_REVIEW", {}, { resolution: "Fixed" }],
    ["RESUBMIT_REVIEW", {}, { ...PREPARER_FORM }],
    ["SUBMIT_REVIEW", {}, {}],
    ["APPROVE_REVIEW", {}, {}],
    ["APPROVE_REVIEW", { service: "drop_off" }, { ...REVIEWER_FORM, signMethod: "in_person" }],
    ["RECORD_REVIEW_CONTACT", {}, { note: "A note" }],
    ["RECORD_REVIEW_CONTACT", {}, { outcome: "reached" }],
    ["CLOSE_CASE", {}, {}],
    ["CLOSE_CASE", {}, { "close-reason": "duplicate" }],
    ["CLOSE_CASE", {}, { "close-reason": "bogus", confirmed: "true" }],
    ["CLOSE_CASE", {}, { "close-reason": "other", confirmed: "true" }],
    ["CLOSE_CASE", {}, { confirmed: "true" }],
    ["PUT_ON_HOLD", {}, {}],
    ["RESUME_FROM_HOLD", {}, {}],
    ["WITHDRAW", {}, {}],
    ["WITHDRAW", {}, { "withdraw-confirmed": "no" }],
    ["REQUEST_DOCUMENTS_AT_INTAKE", {}, {}],
    ["REQUEST_DOCUMENTS_AT_INTAKE", {}, { "request-title-1": "ID", "request-message-1": " " }],
    // Two of the three checks is not a screening.
    ["VERIFY_INTAKE", { service: "drop_off" }, {}],
    ["VERIFY_INTAKE", { service: "drop_off" }, { phone: "true", documents: "true" }],
    [
      "VERIFY_INTAKE",
      { service: "drop_off" },
      { phone: "true", documents: "true", in_scope: "false" },
    ],
    // An online case also needs identity.
    [
      "VERIFY_INTAKE",
      { service: "online" },
      { phone: "true", documents: "true", in_scope: "true" },
    ],
  ];
  for (const [type, dataset, values] of missing)
    assert.throws(
      () => payloadFor(type, dataset, values),
      invalid,
      `${type} ${JSON.stringify(values)}`,
    );
});

test("an outcome outside its own list is refused", () => {
  for (const value of ["", "resolved", "REACHED", "maybe", null])
    assert.throws(
      () =>
        payloadFor("RECORD_REVIEW_CONTACT", {}, {
          outcome: value,
          note: "A note",
        }),
      invalid,
      String(value),
    );
  // The review conversation accepts all four; resolving accepts only two.
  for (const value of CONTACT_OUTCOMES) {
    assert.equal(
      payloadFor("RECORD_REVIEW_CONTACT", {}, { outcome: value, note: "n" }).payload
        .outcome,
      value,
    );
    const resolving = () =>
      payloadFor("RESOLVE_FOLLOWUP", { followupId: "t" }, { outcome: value, note: "n" });
    if (FOLLOWUP_RESOLUTION_OUTCOMES.includes(value))
      assert.equal(resolving().payload.outcome, value);
    else assert.throws(resolving, invalid, value);
  }
});

test("a form value never overrides the file name or the confirmation flag", () => {
  assert.equal(
    payloadFor(
      "RESPOND_DOCUMENT",
      { requestId: "req-1" },
      { filename: "real-taxpayer-w2.pdf" },
    ).payload.filename,
    SAMPLE_DOCUMENT_FILENAME,
  );
  assert.deepEqual(payloadFor("SUBMIT", {}, { confirmed: "false" }).payload, {
    confirmed: true,
  });
  // Closing needs the confirmation, and the flag that leaves is always the
  // literal `true` the contract names: a form can withhold it, never redefine
  // it as something else.
  assert.throws(
    () => payloadFor("CLOSE_CASE", {}, { "close-reason": "duplicate", confirmed: "no" }),
    invalid,
  );
  const closure = payloadFor("CLOSE_CASE", {}, {
    "close-reason": "duplicate",
    confirmed: "on",
  }).payload;
  assert.deepEqual(Object.keys(closure).toSorted(), ["confirmed", "reason"]);
  assert.equal(closure.confirmed, true);
  // The same for the screening checks: a "no" checkbox value is not a tick, and
  // no extra field can join the keys the database accepts.
  assert.throws(
    () =>
      payloadFor("VERIFY_INTAKE", { service: "online" }, {
        phone: "true",
        documents: "true",
        in_scope: "true",
        identity: "no",
      }),
    invalid,
  );
  assert.deepEqual(
    payloadFor("VERIFY_INTAKE", { service: "drop_off" }, {
      phone: "true",
      documents: "true",
      in_scope: "true",
      smuggled: "true",
    }).payload,
    { checks: { phone: true, documents: true, in_scope: true } },
  );
});

test("a related id may come from the dataset or from a hidden field", () => {
  assert.equal(
    payloadFor("VERIFY_DOCUMENT", { requestId: "from-dataset" }, {
      requestId: "from-form",
    }).payload.requestId,
    "from-dataset",
    "the control that was pressed wins",
  );
  assert.equal(
    payloadFor("ESCALATE_CONTACT", {}, {
      requestId: "from-form",
      reason: "No response",
    }).payload.requestId,
    "from-form",
  );
});

// Part 4a, Task 4: the two version-2 contact and materials actions.
test("UPDATE_CONTACT sends only the keys the form carries, checked like the catalogue", () => {
  // One key alone, and a single ticked checkbox arrives as a string.
  assert.deepEqual(payloadFor("UPDATE_CONTACT", {}, { bestContactTime: "weekend" }), {
    type: "UPDATE_CONTACT",
    payload: { bestContactTime: ["weekend"] },
  });
  assert.deepEqual(payloadFor("UPDATE_CONTACT", {}, { bestContactNote: "Text first" }).payload, {
    bestContactNote: "Text first",
  });
  // A blank note and an empty list clear the field.
  assert.deepEqual(
    payloadFor("UPDATE_CONTACT", {}, { bestContactNote: "   ", bestContactTime: [] }).payload,
    { bestContactNote: null, bestContactTime: null },
  );
  // A phone, a snake_case key or a dataset value never joins the payload.
  assert.deepEqual(
    payloadFor(
      "UPDATE_CONTACT",
      { phone: "2155550111", caseId: "case-a" },
      { bestContactNote: "Hi", phone: "2155550111", tp_phone: "2155550111", best_contact_note: "x" },
    ).payload,
    { bestContactNote: "Hi" },
  );
  for (const values of [
    {},
    { phone: "2155550111" },
    { bestContactTime: ["bogus"] },
    { bestContactTime: ["weekend", "weekend"] },
    { bestContactNote: "x".repeat(201) },
  ])
    assert.throws(() => payloadFor("UPDATE_CONTACT", {}, values), invalid, JSON.stringify(values));
  assert.equal(
    payloadFor("UPDATE_CONTACT", {}, { bestContactNote: "x".repeat(200) }).payload.bestContactNote
      .length,
    200,
  );
});

test("RECORD_MATERIALS sends the whole set received, from the catalogue's list", () => {
  // No ticked box is the empty set: nothing received.
  assert.deepEqual(payloadFor("RECORD_MATERIALS", {}, {}), {
    type: "RECORD_MATERIALS",
    payload: { received: [] },
  });
  assert.deepEqual(payloadFor("RECORD_MATERIALS", {}, { received: "w2" }).payload, {
    received: ["w2"],
  });
  // A repeated item is sent once.
  assert.deepEqual(
    payloadFor("RECORD_MATERIALS", {}, { received: ["w2", "photo_id", "w2"] }).payload,
    { received: ["w2", "photo_id"] },
  );
  for (const received of [["passport"], ["W2"], [""], [1]])
    assert.throws(
      () => payloadFor("RECORD_MATERIALS", {}, { received }),
      invalid,
      JSON.stringify(received),
    );
  assert.deepEqual(
    payloadFor("RECORD_MATERIALS", {}, { received: MATERIALS_ITEMS.map((item) => item.id) })
      .payload.received,
    MATERIALS_ITEMS.map((item) => item.id),
  );
  assert.ok(CASE_ACTIONS.includes("UPDATE_CONTACT"));
  assert.ok(CASE_ACTIONS.includes("RECORD_MATERIALS"));
});

// The contact log replaced the follow-up attempt (OpenSpec change
// add-contact-log, design D12): no screen sends RECORD_CONTACT any more.
test("RECORD_CONTACT is no longer a case action the browser can build", () => {
  assert.ok(!CASE_ACTIONS.includes("RECORD_CONTACT"));
  assert.throws(
    () => payloadFor("RECORD_CONTACT", { followupId: "t" }, { outcome: "reached", note: "n" }),
    invalid,
  );
});

test("the 8879 and e-file actions need their own confirmation sentence", () => {
  assert.deepEqual(payloadFor("START_SCREENING", {}, {}), { type: "START_SCREENING", payload: {} });
  for (const type of ["START_SCREENING", "MARK_READY_TO_EFILE", "MARK_EFILED"])
    assert.ok(PAYLOAD_ACTIONS.includes(type), type);
  const sentences = {
    MARK_READY_TO_EFILE: "Confirm that the client signed Form 8879, or the return will be given to the client on paper.",
    MARK_EFILED: "Confirm how each return was filed.",
  };
  for (const [type, message] of Object.entries(sentences)) {
    assert.throws(() => payloadFor(type, {}, {}), (error) => error.code === "VALIDATION" && error.message === message, type);
    assert.throws(() => payloadFor(type, {}, { confirmed: "no" }), (error) => error.message === message, type);
  }
  // Closing keeps its own sentence.
  assert.throws(() => payloadFor("CLOSE_CASE", {}, { "close-reason": "duplicate" }), (error) => error.message === "Confirm that you want to close this case.");
});

test("hold and closing builders refuse with their own sentences", () => {
  refused("CLOSE_CASE", { confirmed: "true" }, "Choose a reason.");
  refused("CLOSE_CASE", { "close-reason": "nope", confirmed: "true" }, "Choose a reason.");
  refused("CLOSE_CASE", { "close-reason": "other", "close-note": "  ", confirmed: "true" }, "Add a note for Other.");
  refused("REQUEST_DOCUMENTS_AT_INTAKE", {}, "Ask for at least one document.");
  refused("REQUEST_DOCUMENTS_AT_INTAKE", { "request-title-1": " ", "request-message-1": " " }, "Ask for at least one document.");
  // A message with no title is refused, not dropped; N counts from 1.
  refused("REQUEST_DOCUMENTS_AT_INTAKE", { "request-title-1": " ", "request-message-1": "x" }, "Add a title for document 1.");
  refused(
    "REQUEST_DOCUMENTS_AT_INTAKE",
    { "request-title-1": "ID", "request-message-1": "x", "request-title-3": "", "request-message-3": "Please send it" },
    "Add a title for document 3.",
  );
  for (const type of ["PUT_ON_HOLD", "RESUME_FROM_HOLD", "WITHDRAW"])
    assert.ok(PAYLOAD_ACTIONS.includes(type), type);
  assert.deepEqual(CLOSING_REASONS, ["out_of_scope", "no_need_to_file", "duplicate", "dismissed", "withdrawn", "other"]);
});

const refused = (type, values, message) =>
  assert.throws(
    () => payloadFor(type, {}, values),
    (error) => error.code === "VALIDATION" && error.message === message,
    `${type} ${JSON.stringify(values)}`,
  );

test("MARK_EFILED carries the methods: one combination on a first filing, or the returns being filed again", () => {
  const sure = { confirmed: "true" };
  for (const [combination, methods] of [
    ["both_efile", { federal: "efile", state: "efile" }],
    ["efile_and_paper", { federal: "efile", state: "paper" }],
    ["paper_and_efile", { federal: "paper", state: "efile" }],
    ["both_paper", { federal: "paper", state: "paper" }],
  ])
    assert.deepEqual(
      payloadFor("MARK_EFILED", {}, { ...sure, "filing-combination": combination }).payload,
      { confirmed: true, methods },
      combination,
    );
  // A second filing sends exactly the returns the dialog offered.
  assert.deepEqual(
    payloadFor("MARK_EFILED", {}, { ...sure, "method-state": "paper" }).payload,
    { confirmed: true, methods: { state: "paper" } },
  );
  assert.deepEqual(
    payloadFor("MARK_EFILED", {}, { ...sure, "method-federal": "efile", "method-state": "efile" }).payload,
    { confirmed: true, methods: { federal: "efile", state: "efile" } },
  );
  refused("MARK_EFILED", sure, "Choose how each return was filed.");
  refused("MARK_EFILED", { ...sure, "filing-combination": "carrier_pigeon" }, "Choose how each return was filed.");
  refused("MARK_EFILED", { ...sure, "method-federal": "fax" }, "Choose how each return was filed.");
  refused("MARK_EFILED", { "filing-combination": "both_efile" }, "Confirm how each return was filed.");
});

test("RECORD_FILING_RESULT builds the results of the returns answered", () => {
  assert.deepEqual(
    payloadFor("RECORD_FILING_RESULT", {}, {
      "result-federal": "accepted",
      "date-federal": " 2026-10-20 ",
      "code-federal": "ignored on an accepted return",
      "result-state": "rejected",
      "date-state": "2026-10-21",
      "code-state": " PA-123 ",
      "fix-note": " Corrected the SSN. ",
    }).payload,
    {
      confirmed: true,
      results: {
        federal: { result: "accepted", date: "2026-10-20" },
        state: { result: "rejected", date: "2026-10-21", code: "PA-123" },
      },
      fixNote: "Corrected the SSN.",
    },
  );
  // A return left on "no answer yet" is not sent; a blank note is not sent.
  assert.deepEqual(
    payloadFor("RECORD_FILING_RESULT", {}, {
      "result-federal": "",
      "result-state": "accepted",
      "date-state": "2026-10-22",
      "fix-note": "  ",
    }).payload,
    { confirmed: true, results: { state: { result: "accepted", date: "2026-10-22" } } },
  );
  // PCDC records no answer for a paper return: "mailed" is not a result any more.
  refused("RECORD_FILING_RESULT", { "result-state": "mailed", "date-state": "2026-10-22" }, "Record a result for at least one return.");
  refused("RECORD_FILING_RESULT", { "result-federal": "rejected", "date-federal": "2026-10-20" }, "A reject code is required.");
  refused("RECORD_FILING_RESULT", { "result-federal": "rejected", "date-federal": "2026-10-20", "code-federal": "  " }, "A reject code is required.");
  refused("RECORD_FILING_RESULT", { "result-state": "accepted" }, "A date is required.");
  refused("RECORD_FILING_RESULT", { "result-state": "accepted", "date-state": " " }, "A date is required.");
  refused("RECORD_FILING_RESULT", { "result-state": "lost", "date-state": "2026-10-20" }, "Record a result for at least one return.");
  refused("RECORD_FILING_RESULT", {}, "Record a result for at least one return.");
});

test("RECORD_FILING_RESULT keeps a fix note for a rejection", () => {
  const accepted = { "result-federal": "accepted", "date-federal": "2026-10-20", "fix-note": "Fictional note." };
  // At E-filed with nothing rejected, a note has nothing to attach to.
  assert.throws(
    () => payloadFor("RECORD_FILING_RESULT", { stage: "efiled" }, accepted),
    (error) => error.message === "A fix note goes with a rejection.",
  );
  assert.throws(
    () => payloadFor("RECORD_FILING_RESULT", {}, accepted),
    (error) => error.message === "A fix note goes with a rejection.",
  );
  // Rejected in the move, or already at Rejected: the note goes.
  assert.equal(
    payloadFor("RECORD_FILING_RESULT", { stage: "efiled" }, {
      ...accepted,
      "result-federal": "rejected",
      "code-federal": "C1",
    }).payload.fixNote,
    "Fictional note.",
  );
  assert.equal(payloadFor("RECORD_FILING_RESULT", { stage: "rejected" }, accepted).payload.fixNote, "Fictional note.");
  // A blank note is no note.
  assert.equal(
    payloadFor("RECORD_FILING_RESULT", { stage: "efiled" }, { ...accepted, "fix-note": "  " }).payload.fixNote,
    undefined,
  );
});

test("RETURN_TO_SIGNING needs the fix confirmed", () => {
  assert.deepEqual(payloadFor("RETURN_TO_SIGNING", {}, { confirmed: "on" }), {
    type: "RETURN_TO_SIGNING",
    payload: { confirmed: true },
  });
  refused("RETURN_TO_SIGNING", {}, "Confirm that the fix is done.");
  refused("RETURN_TO_SIGNING", { confirmed: "no" }, "Confirm that the fix is done.");
});

test("screeningCheckKeys by service", () => {
  assert.deepEqual(screeningCheckKeys("drop_off"), ["phone", "documents", "in_scope"]);
  assert.deepEqual(screeningCheckKeys("same_day"), ["phone", "documents", "in_scope"]);
  assert.deepEqual(screeningCheckKeys("online"), ["phone", "documents", "in_scope", "identity"]);
  assert.ok(Object.isFrozen(screeningCheckKeys("online")));
});

test("screeningCheckKeys: unknown service", () => {
  assert.deepEqual(screeningCheckKeys(undefined), ["phone", "documents", "in_scope"]);
  assert.deepEqual(screeningCheckKeys("x"), ["phone", "documents", "in_scope"]);
});

test("drops identity unless online", () => {
  const all = { phone: "true", documents: "true", in_scope: "true", identity: "true", interview: "true" };
  assert.deepEqual(payloadFor("VERIFY_INTAKE", { service: "drop_off" }, all).payload, {
    checks: { phone: true, documents: true, in_scope: true },
  });
  assert.deepEqual(payloadFor("VERIFY_INTAKE", {}, all).payload, {
    checks: { phone: true, documents: true, in_scope: true },
  });
  assert.deepEqual(payloadFor("VERIFY_INTAKE", { service: "online" }, all).payload, {
    checks: { phone: true, documents: true, in_scope: true, identity: true },
  });
});

test("VERIFY_INTAKE needs every shown check", () => {
  assert.throws(
    () =>
      payloadFor("VERIFY_INTAKE", { service: "online" }, {
        phone: "true",
        documents: "true",
        in_scope: "true",
      }),
    (error) => error.code === "VALIDATION" && error.message === "Tick every check before recording them.",
  );
});
