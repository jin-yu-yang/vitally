import test from "node:test";
import assert from "node:assert/strict";
import {
  renderAdminCase,
  closeCaseDialogBody,
  markReadyToEfileDialogBody,
  markEfiledDialogBody,
  recordFilingResultDialogBody,
  returnToSigningDialogBody,
  requestDocumentsDialogBody,
  putOnHoldDialogBody,
  resumeFromHoldDialogBody,
  adminEligibility,
} from "../src/admin-views.mjs";
import { decorateStaffCase, renderStaffCase } from "../src/staff-views.mjs";
import { makeSampleAnswers } from "../src/sample-data.mjs";
import { CONTACT_FIELDS } from "../src/intake-catalogue.mjs";
import { staffScreen, dialog } from "../src/views.mjs";
import { payloadFor } from "../src/case-actions.mjs";
import { describeStage } from "../src/domain.mjs";
import { nowInput } from "../src/contact-log.mjs";

// The admin screens are pure functions of records and one persona, so these
// tests read the HTML string itself. No DOM library, and nothing here may reach
// a store.

// ---------------------------------------------------------------------------
// The task brief's test, verbatim.
// ---------------------------------------------------------------------------
test('admin task and preparation have distinct owners', () => {
  const html = renderAdminCase({stage:'preparing',preparerId:'alex',
    preparerName:'Alex',followups:[{assigneeName:'Sam',status:'open'}],
    requests:[],history:[],answers:{language:'Mandarin'}}, {});
  assert.match(html, /Preparation[^]*Alex/);
  assert.match(html, /Follow-up[^]*Sam/);
});

// ---------------------------------------------------------------------------

const ALEX = { id: "alex", name: "Alex", capabilities: ["prepare"] };
const MORGAN = { id: "morgan", name: "Morgan", capabilities: ["review"] };
// Task 4's `extendTestWorkspace` can add a capability to an existing person;
// holding `followup` is still not holding the task.
const MORGAN_FOLLOWUP = {
  id: "morgan",
  name: "Morgan",
  capabilities: ["review", "followup"],
};
const SAM = {
  id: "sam",
  name: "Sam",
  capabilities: ["admin", "assist", "followup", "receive_documents"],
};
const PEOPLE = [ALEX, MORGAN, SAM];

const officeCase = (overrides = {}) =>
  decorateStaffCase(
    {
      id: "case-a",
      reference: "VT-AB2C-DE3F",
      workspaceId: "w1",
      ownerUserId: null,
      stage: "preparing",
      revision: 5,
      preparationVersion: 0,
      answers: { service: "Drop-off", language: "Cantonese", firstName: "Mei" },
      intakeVerified: true,
      preparerId: "alex",
      reviewerId: null,
      lastRemindedAt: null,
      lastRemindedByPersonId: null,
      createdAt: "2026-09-10T15:00:00.000Z",
      updatedAt: "2026-09-12T16:30:00.000Z",
      participants: ["alex"],
      requests: [],
      documents: [],
      followups: [],
      reviews: [],
      history: [],
      internalHistory: [],
      ...overrides,
    },
    PEOPLE,
  );

const boardCase = (overrides = {}) =>
  decorateStaffCase(
    {
      id: "case-1",
      reference: "VT-AAAA-1111",
      ownerUserId: "owner-1",
      stage: "preparation_ready",
      revision: 3,
      preparationVersion: 0,
      answers: { service: "Drop-off", language: "English" },
      intakeVerified: true,
      preparerId: null,
      reviewerId: null,
      lastRemindedAt: null,
      updatedAt: "2026-09-12T16:30:00.000Z",
      ...overrides,
    },
    PEOPLE,
  );

const item = (overrides = {}) => ({
  id: "item-1",
  caseId: null,
  title: "Client needs help completing intake forms",
  status: "open",
  revision: 1,
  assigneeId: null,
  assigneeName: null,
  resolutionNote: null,
  language: "Mandarin",
  contactPreference: "Prefers calls from the main office",
  createdAt: "2026-09-12T10:00:00.000Z",
  ...overrides,
});

const openTask = (overrides = {}) => ({
  id: "task-1",
  requestId: "req-1",
  assigneeId: "sam",
  status: "open",
  reason: "No answer on the number we have.",
  resolutionOutcome: null,
  resolutionNote: null,
  createdAt: "2026-09-12T11:00:00.000Z",
  ...overrides,
});

// A contact log entry, as the store maps it, with its one version.
const contactEntry = (overrides = {}) => {
  const entry = {
    direction: "outgoing",
    contactedAt: "2026-09-12T16:00:00.000Z",
    withWhom: "client",
    otherName: null,
    method: "phone",
    purpose: "request_documents",
    outcome: "no_answer",
    note: "Rang twice, no voicemail.",
    ...overrides,
  };
  return {
    id: "contact-1",
    caseId: "case-a",
    followupId: "task-1",
    revision: 1,
    loggedAt: entry.contactedAt,
    editedAt: null,
    loggedByPersonId: "sam",
    versions: [{ version: 1, createdAt: entry.contactedAt, editedByPersonId: "sam", ...entry }],
    ...entry,
    ...overrides,
  };
};

// The shared Log contact form, linked to one task.
const linkedForm = (taskId) =>
  new RegExp(`<form class="staff-form contact-form" data-case-id="case-a" data-followup-id="${taskId}">`);

const openRequest = (overrides = {}) => ({
  id: "req-1",
  title: "Mileage record",
  message: "Please bring the fictional sample.",
  status: "open",
  createdAt: "2026-09-11T09:00:00.000Z",
  ...overrides,
});

const caseActions = (html) => [
  ...html.matchAll(/data-case-action="([A-Z_]+)"/g),
].map((match) => match[1]);

// ---------------------------------------------------------------------------
// Intake checks
// ---------------------------------------------------------------------------

const LABELS = {
  phone: "The client can be reached at the phone number on the application.",
  documents:
    "The basic documents are present (photo ID, Social Security or ITIN cards, the income documents on the list).",
  in_scope: "The return is within VITA scope.",
  identity:
    "Identity confirmed: the client's face matches their photo ID (in person or on video), checked by a certified volunteer.",
};
const screeningPanel = (html) => {
  const start = html.indexOf('<section class="panel" aria-labelledby="checks-title">');
  return html.slice(start, html.indexOf("</section>", start));
};
const onlineCase = (overrides = {}) =>
  officeCase({
    stage: "screening",
    intakeVerified: false,
    answers: { service: "online", language: "Cantonese", firstName: "Mei" },
    ...overrides,
  });

test("screening checks panel: drop-off shows three", () => {
  const arrived = officeCase({ stage: "screening", intakeVerified: false });
  const none = renderAdminCase(arrived, { person: SAM });
  assert.match(none, /data-case-action="VERIFY_INTAKE"/);
  const panel = screeningPanel(none);
  assert.match(panel, /<h2 id="checks-title">Screening checks<\/h2>/);
  for (const key of ["phone", "documents", "in_scope"]) {
    assert.match(panel, new RegExp(`id="field-intake-${key}"`));
    assert.match(panel, new RegExp(`name="${key}" value="true"`));
    assert.ok(panel.includes(`<span>${LABELS[key].replace("'", "&#39;")}</span>`) || panel.includes(`<span>${LABELS[key]}</span>`), key);
  }
  assert.doesNotMatch(panel, /field-intake-identity/);
  assert.match(panel, /Record the screening checks/);
  // The payload the form's ticked boxes build is exactly the contract's.
  assert.deepEqual(
    payloadFor("VERIFY_INTAKE", { service: "drop_off" }, {
      phone: "true",
      documents: "true",
      in_scope: "true",
    }).payload,
    { checks: { phone: true, documents: true, in_scope: true } },
  );
  // At every other stage it is explained rather than offered.
  const already = renderAdminCase(officeCase(), { person: SAM });
  assert.doesNotMatch(already, /data-case-action="VERIFY_INTAKE"/);
  assert.match(already, /The screening checks are already recorded\./);
  const draft = renderAdminCase(officeCase({ stage: "draft", intakeVerified: false }), {
    person: SAM,
  });
  assert.match(draft, /The client has not sent this application yet\./);
  // A request that has not been opened yet waits for screening.
  const waiting = renderAdminCase(officeCase({ stage: "received", intakeVerified: false }), {
    person: SAM,
  });
  assert.doesNotMatch(waiting, /data-case-action="VERIFY_INTAKE"/);
  assert.match(waiting, /Screening starts when an admin opens the case\./);
  // And it is an office action: a preparer sees the reason, not the form.
  const forAlex = renderAdminCase(arrived, { person: ALEX });
  assert.doesNotMatch(forAlex, /data-case-action="VERIFY_INTAKE"/);
  assert.match(forAlex, /Needs office administrator access\./);
});

// ---------------------------------------------------------------------------
// Follow-up
// ---------------------------------------------------------------------------

test("screening checks panel: online shows identity", () => {
  const panel = screeningPanel(renderAdminCase(onlineCase(), { person: SAM }));
  for (const key of ["phone", "documents", "in_scope", "identity"])
    assert.match(panel, new RegExp(`id="field-intake-${key}"`));
  assert.ok(panel.includes("Identity confirmed: the client&#39;s face matches") || panel.includes("Identity confirmed: the client's face matches"));
  assert.match(panel, /data-case-action="VERIFY_INTAKE"[^>]*data-service="online"/);
});

test("the button waits for every shown check", () => {
  const two = renderAdminCase(officeCase({ stage: "screening", intakeVerified: false }), {
    person: SAM,
    openPanels: ["intake-check-phone", "intake-check-documents"],
  });
  assert.match(screeningPanel(two), /data-case-action="VERIFY_INTAKE"[^>]*disabled/);
  assert.match(screeningPanel(two), /Tick every check before recording them\./);
  const three = renderAdminCase(officeCase({ stage: "screening", intakeVerified: false }), {
    person: SAM,
    openPanels: ["intake-check-phone", "intake-check-documents", "intake-check-in_scope"],
  });
  assert.doesNotMatch(screeningPanel(three), /data-case-action="VERIFY_INTAKE"[^>]*disabled/);
  assert.doesNotMatch(screeningPanel(three), /Tick every check/);
  assert.equal((screeningPanel(three).match(/checked/g) ?? []).length, 3);
  // An online case still waits for identity.
  const online = renderAdminCase(onlineCase(), {
    person: SAM,
    openPanels: ["intake-check-phone", "intake-check-documents", "intake-check-in_scope"],
  });
  assert.match(screeningPanel(online), /data-case-action="VERIFY_INTAKE"[^>]*disabled/);
});

test("no simulated wording in the panel", () => {
  for (const record of [
    officeCase({ stage: "screening", intakeVerified: false }),
    onlineCase(),
    officeCase(),
  ])
    assert.doesNotMatch(screeningPanel(renderAdminCase(record, { person: SAM })), /simulat/i);
});

test("each open task has the shared form and Resolve", () => {
  const record = officeCase({
    requests: [openRequest()],
    followups: [openTask()],
    contacts: [contactEntry()],
  });
  const html = renderAdminCase(record, { person: SAM, now: Date.parse("2026-09-12T17:00:00.000Z") });
  const followup = html.slice(html.indexOf('id="case-panel-followup"'), html.indexOf('id="case-panel-contacts"'));
  assert.match(followup, linkedForm("task-1"));
  assert.match(followup, /<h4>Log contact<\/h4>/);
  assert.match(followup, /id="field-contact-task-task-1-note"/);
  assert.doesNotMatch(html, /RECORD_CONTACT/);
  assert.match(followup, /data-case-action="RESOLVE_FOLLOWUP" data-followup-id="task-1"/);
  // The request the task is about, its reason and the assignee the server chose.
  assert.match(html, /<h3>Mileage record<\/h3>/);
  assert.match(html, /No answer on the number we have\./);
  assert.match(html, /<span>Assigned to<\/span><strong>Sam<\/strong>/);
  // "Resolve this task" is as it was: two outcomes, per-task ids.
  const resolveForm = html.slice(html.indexOf('id="field-resolve-task-1-outcome"'));
  const resolveOptions = [...resolveForm.matchAll(/<option value="([a-z_]+)"/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(resolveOptions.slice(0, 2), ["reached", "no_further_contact"]);
  assert.ok(!resolveOptions.includes("no_answer"));
  assert.ok(!resolveOptions.includes("closure_requested"));
  assert.match(html, /<h4>Resolve this task<\/h4>/);
  assert.match(html, /does not verify a document, change the preparer, or close the case/);
  // The log form comes before Resolve.
  assert.ok(followup.indexOf("contact-form") < followup.indexOf("Resolve this task"));
  // There is no way to hand the task to somebody else.
  assert.doesNotMatch(html, /name="assignee/i);
  assert.match(html, /no way to hand it to someone else/i);

  // Both directions of the rule (Ruling R53).
  const forAlex = renderAdminCase(record, { person: ALEX });
  assert.doesNotMatch(forAlex, linkedForm("task-1"));
  assert.doesNotMatch(forAlex, /data-case-action="RESOLVE_FOLLOWUP"/);
  assert.match(forAlex, /Needs office follow-up access\./);
  // Holding the capability is still not holding the task.
  const forMorgan = renderAdminCase(record, { person: MORGAN_FOLLOWUP });
  assert.doesNotMatch(forMorgan, linkedForm("task-1"));
  assert.match(forMorgan, /The office assigned this task to someone else\./);
  assert.doesNotMatch(forMorgan, /Needs office follow-up access\./);
});

test("the task lists its linked contacts", () => {
  const record = officeCase({
    requests: [openRequest()],
    followups: [openTask()],
    contacts: [contactEntry(), contactEntry({ id: "contact-2", followupId: null, note: "Not about the task." })],
  });
  const html = renderAdminCase(record, { person: SAM });
  const followup = html.slice(html.indexOf('id="case-panel-followup"'), html.indexOf('id="case-panel-contacts"'));
  assert.match(followup, /<h4>Contacts so far<\/h4><ul class="contact-task-list"><li>9\/12\/2026 12:00 PM — Sam → client, phone — Request documents — No answer\. Note: Rang twice, no voicemail\.<\/li><\/ul>/);
  assert.doesNotMatch(followup, /Not about the task/);
  const none = renderAdminCase(officeCase({ requests: [openRequest()], followups: [openTask()] }), { person: SAM });
  assert.match(none, /<h4>Contacts so far<\/h4><p class="muted">No contact has been logged on this task yet\.<\/p>/);
});

test("the office case has the Contacts tab with its count", () => {
  const html = renderAdminCase(
    officeCase({ contacts: [contactEntry({ followupId: null }), contactEntry({ id: "contact-2", followupId: null })] }),
    { person: SAM },
  );
  const order = [...html.matchAll(/role="tab" id="case-tab-([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ["overview", "intake", "documents", "followup", "contacts", "history"]);
  assert.match(html, /data-value="contacts">Contacts <span class="tab-count">2<\/span><\/button>/);
  assert.match(html, /<h2 id="contacts-title">Contacts<\/h2>/);
  assert.match(html, /<form class="staff-form contact-form" data-case-id="case-a">/);
  // Sam is an admin: he may edit the entries he did not log too.
  assert.match(html, /data-action="toggle-contact-edit" data-contact-id="contact-2"/);
});

test("two open tasks get four forms that cannot be confused", () => {
  const record = officeCase({
    requests: [
      openRequest(),
      openRequest({ id: "req-2", title: "Bank letter", status: "open" }),
    ],
    followups: [openTask(), openTask({ id: "task-2", requestId: "req-2" })],
  });
  const html = renderAdminCase(record, { person: SAM });
  // Task 7's cursor fix resolves a focused field by **id**, so two tasks on one
  // page must never share one: a namesake would take the cursor, and the rest
  // of the sentence would be typed into, and sent for, the other task.
  for (const id of [
    "field-contact-task-task-1-direction-outgoing",
    "field-contact-task-task-1-contactedAt",
    "field-contact-task-task-1-note",
    "field-resolve-task-1-outcome",
    "field-resolve-task-1-note",
    "field-contact-task-task-2-direction-outgoing",
    "field-contact-task-task-2-contactedAt",
    "field-contact-task-task-2-note",
    "field-resolve-task-2-outcome",
    "field-resolve-task-2-note",
  ]) {
    assert.equal(
      (html.match(new RegExp(`id="${id}"`, "g")) ?? []).length,
      1,
      id,
    );
    assert.match(html, new RegExp(`<label class="(field|seg)" for="${id}">`));
  }
  // Each form names its own task: the log form on itself, Resolve on its
  // button and in its hidden field.
  for (const taskId of ["task-1", "task-2"]) {
    assert.match(html, linkedForm(taskId));
    assert.match(html, new RegExp(`data-case-action="RESOLVE_FOLLOWUP" data-followup-id="${taskId}"`));
  }
  assert.equal(
    (html.match(/<input type="hidden" name="followupId" value="task-2">/g) ?? [])
      .length,
    1,
    "one hidden id, on the second task's Resolve form",
  );
});

test("a resolved task keeps its history and offers no further action", () => {
  const record = officeCase({
    requests: [openRequest()],
    followups: [
      openTask({
        status: "resolved",
        resolutionOutcome: "reached",
        resolutionNote: "Spoke to the client; they will bring it in.",
      }),
    ],
  });
  const html = renderAdminCase(record, { person: SAM });
  assert.doesNotMatch(html, linkedForm("task-1"));
  assert.doesNotMatch(html, /data-case-action="RESOLVE_FOLLOWUP"/);
  assert.match(html, /Spoke with the client — Spoke to the client; they will bring it in\./);
  assert.match(html, /Resolved/);
});

test("a client response arriving while the task is open is shown beside it", () => {
  const record = officeCase({
    requests: [openRequest({ status: "awaiting_verification" })],
    followups: [openTask()],
  });
  const html = renderAdminCase(record, { person: SAM });
  assert.match(html, /The client responded; awaiting preparer verification\./);
  assert.match(html, /Resolving this task does not verify the document\./);
  // The task is still open and still both steps.
  assert.match(html, linkedForm("task-1"));
  assert.match(html, /data-case-action="RESOLVE_FOLLOWUP"/);
  // While the request is still open there is nothing to say about a response.
  const waiting = renderAdminCase(
    officeCase({ requests: [openRequest()], followups: [openTask()] }),
    { person: SAM },
  );
  assert.doesNotMatch(waiting, /The client responded/);
});

// ---------------------------------------------------------------------------
// The staff receipt
// ---------------------------------------------------------------------------

test("the office records a document only for a client with no account", () => {
  const record = officeCase({ requests: [openRequest()] });
  const html = renderAdminCase(record, { person: SAM });
  assert.match(
    html,
    /data-case-action="RECORD_DOCUMENT_RESPONSE" data-request-id="req-1"/,
  );
  assert.match(html, /Record sample document received/);
  assert.match(html, /staff-recorded/);
  assert.match(html, /awaiting preparer verification/);
  assert.match(html, /taking delivery is not verifying, and it never changes the preparer/);
  assert.match(html, /demo-mileage-record-2025\.pdf/);

  // A client who has their own account sends it themselves.
  const owned = renderAdminCase(
    officeCase({ ownerUserId: "owner-1", requests: [openRequest()] }),
    { person: SAM },
  );
  assert.doesNotMatch(owned, /data-case-action="RECORD_DOCUMENT_RESPONSE"/);
  assert.match(owned, /This client has their own account, so they send it themselves\./);

  // A settled request takes no second receipt.
  const settled = renderAdminCase(
    officeCase({ requests: [openRequest({ status: "awaiting_verification" })] }),
    { person: SAM },
  );
  assert.doesNotMatch(settled, /data-case-action="RECORD_DOCUMENT_RESPONSE"/);

  // Nor does a case outside the preparation window.
  const early = renderAdminCase(
    officeCase({ stage: "received", requests: [openRequest()] }),
    { person: SAM },
  );
  assert.doesNotMatch(early, /data-case-action="RECORD_DOCUMENT_RESPONSE"/);
  assert.match(early, /A document is recorded while the case is being prepared\./);

  // And the receipt capability is its own: a reviewer is refused by name.
  const forMorgan = renderAdminCase(record, { person: MORGAN });
  assert.doesNotMatch(forMorgan, /data-case-action="RECORD_DOCUMENT_RESPONSE"/);
  assert.match(forMorgan, /Needs office document-receipt access\./);

  // What was taken in is labelled, and its request still says it is unverified.
  const recorded = renderAdminCase(
    officeCase({
      requests: [openRequest({ status: "awaiting_verification" })],
      documents: [
        {
          id: "doc-1",
          requestId: "req-1",
          filename: "demo-mileage-record-2025.pdf",
          source: "staff_recorded",
          createdAt: "2026-09-12T13:00:00.000Z",
        },
      ],
    }),
    { person: SAM },
  );
  assert.match(
    recorded,
    /demo-mileage-record-2025\.pdf <small>staff-recorded · Received, not verified yet/,
  );
});

// ---------------------------------------------------------------------------
// Closure
// ---------------------------------------------------------------------------

test("closure is offered before approval only, and is confirmed in a dialog", () => {
  const html = renderAdminCase(officeCase(), { person: SAM });
  assert.match(html, /data-action="open-close-case"/);
  // The control opens a dialog; it is never itself a workflow action.
  assert.ok(!caseActions(html).includes("CLOSE_CASE"));
  assert.match(html, /in ViTally<\/strong>. It does not cancel, withdraw or amend/);

  for (const [stage, reason] of [
    ["efiled", /An approved case is not closed from here\./],
    ["closed", /This case is already closed\./],
  ]) {
    const late = renderAdminCase(officeCase({ stage }), { person: SAM });
    assert.doesNotMatch(late, /data-action="open-close-case"/);
    assert.match(late, reason);
  }
  // A client's own draft is theirs.
  const clientDraft = renderAdminCase(
    officeCase({ stage: "draft", ownerUserId: "owner-1" }),
    { person: SAM },
  );
  assert.doesNotMatch(clientDraft, /data-action="open-close-case"/);
  assert.match(clientDraft, /A client&#39;s own draft is theirs to finish or leave\./);
  // An office draft nobody owns can be closed, as the database allows.
  const officeDraft = renderAdminCase(officeCase({ stage: "draft" }), { person: SAM });
  assert.match(officeDraft, /data-action="open-close-case"/);
  // Only the office may close.
  const forAlex = renderAdminCase(officeCase(), { person: ALEX });
  assert.doesNotMatch(forAlex, /data-action="open-close-case"/);
  assert.match(forAlex, /Needs office administrator access\./);
});

test("the close dialog asks for a reason and an explicit confirmation", () => {
  const html = closeCaseDialogBody({ savedCase: officeCase() });
  assert.match(html, /data-case-action="CLOSE_CASE"/);
  // The six reasons are one choice, and the note is a text box.
  assert.deepEqual(
    [...html.matchAll(/<input type="radio" id="[^"]+" name="close-reason" value="([a-z_]+)" required>/g)].map((m) => m[1]),
    ["out_of_scope", "no_need_to_file", "duplicate", "dismissed", "withdrawn", "other"],
  );
  assert.match(html, /<span>Dismissed \(client unreachable\)<\/span>/);
  assert.match(html, /<textarea id="field-close-close-note" name="close-note" maxlength="1000"/);
  assert.doesNotMatch(html, /name="reason"/);
  assert.match(
    html,
    /<input type="checkbox" id="field-close-confirmed" name="confirmed" value="true" required>/,
  );
  assert.match(html, /does not cancel, withdraw or amend any return filed elsewhere/);
  assert.match(html, /cancelled/);
  assert.match(html, /data-action="close-dialog"/);
  // The confirmation is what the payload needs; a reason alone is refused.
  assert.throws(
    () => payloadFor("CLOSE_CASE", {}, { "close-reason": "duplicate" }),
    (error) => error.code === "VALIDATION",
  );
  assert.deepEqual(
    payloadFor("CLOSE_CASE", {}, { "close-reason": "duplicate", confirmed: "true" })
      .payload,
    { reason: "duplicate", confirmed: true },
  );
});

// ---------------------------------------------------------------------------
// Screening, Form 8879 and e-filing
// ---------------------------------------------------------------------------

const CALLED = [
  { id: "r1", status: "approved", clientContactStatus: "completed", preparationVersion: 1 },
];
const WAITING = [
  { id: "r1", status: "approved", clientContactStatus: "pending", preparationVersion: 1 },
];

test("the intake checks wait for screening; the e-file marks wait for their stages", () => {
  const sam = { id: "p-sam", name: "Sam", capabilities: ["admin"] };
  const called = [{ status: "approved", clientContactStatus: "completed" }];
  const at = (stage, reviews = called, followups = []) =>
    adminEligibility({ caseRecord: { stage, ownerUserId: "u1", reviews, followups } }, sam);
  assert.equal(at("screening").verifyIntake.allowed, true);
  assert.equal(at("received").verifyIntake.allowed, false);
  assert.equal(at("review_approved").markReadyToEfile.allowed, true);
  assert.equal(at("ready_to_efile").markReadyToEfile.allowed, false);
  assert.equal(at("ready_to_efile").markEfiled.allowed, true);
  assert.equal(at("efiled").markEfiled.allowed, false);
  assert.equal(at("review_approved").markEfiled.allowed, false);
  // A list row has no reviews, only the summary a later task adds.
  const listRow = (status) =>
    adminEligibility(
      { caseRecord: { stage: "review_approved", ownerUserId: "u1", reviewContactStatus: status } },
      sam,
    ).markReadyToEfile.allowed;
  assert.equal(listRow("completed"), true);
  assert.equal(listRow("pending"), false);
  const waiting = at("review_approved", [
    { status: "approved", clientContactStatus: "pending" },
  ]).markReadyToEfile;
  assert.equal(waiting.allowed, false);
  assert.equal(
    waiting.reason,
    "The reviewer still needs to record the conversation with the client.",
  );
  // No review at all is not a completed call.
  assert.equal(at("review_approved", []).markReadyToEfile.allowed, false);
  // The latest approved review decides, not an earlier one.
  assert.equal(
    at("review_approved", [
      { status: "approved", clientContactStatus: "completed" },
      { status: "approved", clientContactStatus: "pending" },
    ]).markReadyToEfile.allowed,
    false,
  );
  // D13: then the office's go-over, until that task is resolved, whatever the outcome.
  const GO_OVER = "The office still needs to go over the return with the client.";
  const withTask = (task) => at("review_approved", called, [task]).markReadyToEfile;
  assert.equal(withTask({ purpose: "go_over_return", status: "open" }).reason, GO_OVER);
  assert.equal(withTask({ purpose: "request_documents", status: "open" }).allowed, true);
  for (const resolutionOutcome of ["reached", "no_further_contact"])
    assert.equal(
      withTask({ purpose: "go_over_return", status: "resolved", resolutionOutcome }).allowed,
      true,
      resolutionOutcome,
    );
  const overRow = (goOverOpen) =>
    adminEligibility(
      { caseRecord: { stage: "review_approved", ownerUserId: "u1", reviewContactStatus: "completed", goOverOpen } },
      sam,
    ).markReadyToEfile;
  assert.equal(overRow(true).reason, GO_OVER);
  assert.equal(overRow(false).allowed, true);
  // The reviewer's call stays first: a legacy pending call still gives its own sentence.
  assert.equal(
    at("review_approved", [{ status: "approved", clientContactStatus: "pending" }], [
      { purpose: "go_over_return", status: "open" },
    ]).markReadyToEfile.reason,
    "The reviewer still needs to record the conversation with the client.",
  );
  assert.equal(at("screening").closeCase.allowed, true);
  // Before filing a case can be closed (as withdrawn only); after filing it cannot.
  for (const stage of ["review_approved", "ready_to_efile"]) assert.equal(at(stage).closeCase.allowed, true, stage);
  {
    const refusal = at("efiled").closeCase;
    assert.equal(refusal.allowed, false);
    assert.equal(refusal.reason, "An approved case is not closed from here.");
  }
  const alex = { id: "p-alex", name: "Alex", capabilities: ["prepare"] };
  assert.equal(
    adminEligibility({ caseRecord: { stage: "review_approved", reviews: called } }, alex)
      .markReadyToEfile.allowed,
    false,
  );
  assert.equal(
    adminEligibility({ caseRecord: { stage: "ready_to_efile" } }, alex).markEfiled.allowed,
    false,
  );
  assert.equal(
    adminEligibility({ caseRecord: { stage: "ready_to_efile" } }, null).markEfiled.allowed,
    false,
  );
});

test("the admin page: the intake form at screening, the marks at their stages", () => {
  const received = renderAdminCase(officeCase({ stage: "received", intakeVerified: false }), {
    person: SAM,
  });
  assert.ok(!caseActions(received).includes("VERIFY_INTAKE"));
  assert.match(received, /Screening starts when an admin opens the case\./);
  const screening = renderAdminCase(officeCase({ stage: "screening", intakeVerified: false }), {
    person: SAM,
  });
  assert.ok(caseActions(screening).includes("VERIFY_INTAKE"));

  const approved = renderAdminCase(officeCase({ stage: "review_approved", reviews: CALLED }), {
    person: SAM,
  });
  assert.match(
    approved,
    /<button[^>]*data-action="open-mark-ready-to-efile"[^>]*>[^]*?Mark ready to e-file…<\/button>/,
  );
  assert.doesNotMatch(approved, /data-action="open-mark-efiled"/);
  // The control opens a dialog; it is never itself a workflow action.
  assert.ok(!caseActions(approved).some((action) => action.startsWith("MARK_")));

  const signed = renderAdminCase(officeCase({ stage: "ready_to_efile", reviews: CALLED }), {
    person: SAM,
  });
  assert.match(
    signed,
    /<button[^>]*data-action="open-mark-efiled"[^>]*>[^]*?Mark e-filed…<\/button>/,
  );
  assert.doesNotMatch(signed, /data-action="open-mark-ready-to-efile"/);

  const pending = renderAdminCase(officeCase({ stage: "review_approved", reviews: WAITING }), {
    person: SAM,
  });
  assert.doesNotMatch(pending, /data-action="open-mark-ready-to-efile"/);
  assert.match(pending, /The reviewer still needs to record the conversation with the client\./);

  const filed = renderAdminCase(officeCase({ stage: "efiled", reviews: CALLED }), { person: SAM });
  assert.doesNotMatch(filed, /data-action="open-mark-/);
  // Only an admin is offered either mark.
  for (const person of [ALEX, MORGAN]) {
    const html = renderAdminCase(officeCase({ stage: "review_approved", reviews: CALLED }), {
      person,
    });
    assert.doesNotMatch(html, /data-action="open-mark-/);
    assert.match(html, /Needs office administrator access\./);
  }
});

test("a volunteer's case page never offers the e-file marks", () => {
  for (const stage of ["review_approved", "ready_to_efile"]) {
    for (const person of [ALEX, MORGAN]) {
      const html = renderStaffCase(officeCase({ stage, reviews: CALLED }), person);
      assert.doesNotMatch(html, /open-mark-ready-to-efile/, `${stage} ${person.name}`);
      assert.doesNotMatch(html, /open-mark-efiled/, `${stage} ${person.name}`);
      assert.doesNotMatch(html, /MARK_/, `${stage} ${person.name}`);
    }
  }
});

test("the e-file dialogs name the client and the application", () => {
  const state = {
    busy: false,
    savedCase: {
      reference: "VT-AAAA-BBBB",
      answers: { tp_first_name: "Mei", tp_last_name: "Chen" },
    },
  };
  const ready = markReadyToEfileDialogBody(state);
  assert.match(ready, /Mei Chen/);
  assert.match(ready, /VT-AAAA-BBBB/);
  assert.match(ready, /data-case-action="MARK_READY_TO_EFILE"/);
  assert.match(ready, /name="confirmed" value="true" required/);
  assert.match(ready, /<span>The client signed Form 8879, or the return will be given to the client on paper\.<\/span>/);
  const filed = markEfiledDialogBody(state);
  assert.match(filed, /data-case-action="MARK_EFILED"/);
  assert.match(filed, /The client will be told how their return was filed/);
  assert.match(filed, /<span>Each return was e-filed, or given to the client on paper, as chosen above\.<\/span>/);
  assert.match(
    markEfiledDialogBody({ savedCase: { reference: "VT-X", answers: {} } }),
    /this client/,
  );
  assert.match(markReadyToEfileDialogBody({}), /this case<\/strong> for <strong>this client/);
  assert.match(
    markEfiledDialogBody({ busy: true, savedCase: state.savedCase }),
    /data-case-action="MARK_EFILED" disabled/,
  );
  // Keeping it as it is sends nothing: the keep control is confirmBody's close
  // control and carries no case action.
  for (const html of [ready, filed]) {
    assert.match(html, /Keep it as it is/);
    assert.match(html, /data-action="close-dialog"/);
    assert.equal((html.match(/data-case-action=/g) ?? []).length, 1, "only the confirm button sends");
  }
});

// ---------------------------------------------------------------------------
// Refusals, escaping, and what nobody may do
// ---------------------------------------------------------------------------

test("a window with no persona is offered nothing at all", () => {
  const record = officeCase({
    requests: [openRequest()],
    followups: [openTask()],
  });
  const html = renderAdminCase(record, {});
  assert.deepEqual(caseActions(html), []);
  assert.doesNotMatch(html, /data-assistance-action/);
  assert.doesNotMatch(html, /data-action="open-close-case"/);
  assert.match(html, /This account isn(?:'|&#39;)t linked to a volunteer yet\. Ask your site coordinator\./);
});

test("a persona without the office roles gets explanations, not office actions", () => {
  const record = officeCase({
    stage: "received",
    intakeVerified: false,
    preparerId: null,
    participants: [],
    requests: [openRequest()],
    followups: [openTask()],
  });
  const html = renderAdminCase(record, { person: MORGAN });
  for (const type of [
    "VERIFY_INTAKE",
    "REMIND",
    "CLOSE_CASE",
    "RESOLVE_FOLLOWUP",
    "RECORD_DOCUMENT_RESPONSE",
    "SAVE_ANSWERS",
  ])
    assert.ok(!caseActions(html).includes(type), type);
  assert.doesNotMatch(html, /data-assistance-action/);
  assert.doesNotMatch(html, linkedForm("task-1"));
  assert.match(html, /Needs office administrator access\./);
  assert.match(html, /Needs office follow-up access\./);
  assert.match(html, /Needs office document-receipt access\./);
});

test("notes, reasons and titles are escaped wherever they are shown", () => {
  const nasty = '<script>alert("x")</script>';
  const record = officeCase({
    requests: [openRequest({ title: nasty, message: nasty })],
    followups: [
      openTask({
        reason: nasty,
        status: "resolved",
        resolutionOutcome: "reached",
        resolutionNote: nasty,
      }),
    ],
    contacts: [contactEntry({ note: nasty, withWhom: "other", otherName: nasty })],
    documents: [
      {
        id: "doc-1",
        requestId: "req-1",
        filename: nasty,
        source: "staff_recorded",
        createdAt: "2026-09-12T13:00:00.000Z",
      },
    ],
  });
  const html = renderAdminCase(record, { person: SAM });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(closeCaseDialogBody({ savedCase: officeCase({ reference: nasty }) }), /<script>/);
});

// ---------------------------------------------------------------------------
// The eligibility helper on its own
// ---------------------------------------------------------------------------

test("adminEligibility answers about a target it was not given", () => {
  const none = adminEligibility({}, SAM);
  assert.equal(none.recordContact.allowed, false);
  assert.equal(none.recordContact.reason, "This task is no longer on screen.");
  assert.equal(none.claimAssistance.allowed, false);
  assert.equal(none.resolveAssistance.allowed, false);
  // Starting an assisted application needs no case at all.
  assert.equal(none.assistedIntake.allowed, true);
  // Every refusal carries a sentence; none is ever empty.
  for (const [name, decision] of Object.entries(adminEligibility({}, ALEX)))
    if (decision && typeof decision === "object" && decision.allowed === false)
      assert.ok(decision.reason.length > 10, name);
  // Recording an attempt and resolving are one rule, so they never disagree.
  const task = openTask();
  const rights = adminEligibility(
    { caseRecord: officeCase(), followup: task },
    SAM,
  );
  assert.deepEqual(rights.recordContact, rights.resolveFollowup);
  assert.equal(rights.recordContact.allowed, true);
});

// ---------------------------------------------------------------------------
// Routing: which workspace a staff member gets (Ruling R55)
// ---------------------------------------------------------------------------

test("the staff member's own person decides which workspace they are in", () => {
  const state = {
    principal: { userId: "p1", workspaceId: "w1", access: "staff", personId: "sam" },
    people: PEOPLE,
    cases: [boardCase()],
    assistance: [item({ assigneeId: "sam", status: "assigned" })],
    savedCase: null,
    screen: "staff",
    boardFilters: {},
    openPanels: [],
    draftAnswers: {},
    busy: false,
    error: null,
    retryable: false,
  };
  const office = staffScreen(state);
  assert.match(office, />OFFICE</);
  assert.match(office, /Office queue<\/h2>/);
  assert.match(office, /data-kind="help"/);
  // The helper is named, not shown as an id.
  assert.match(office, /Helper: Sam/);
  assert.doesNotMatch(office, /Work board<\/h2>/);

  // Anyone else keeps the preparation and review board.
  const preparer = staffScreen({ ...state, principal: { ...state.principal, personId: "alex" } });
  assert.match(preparer, /VOLUNTEER WORKSPACE/);
  assert.match(preparer, /Work board<\/h2>/);
  assert.doesNotMatch(preparer, /Office queue/);

  // The same rule on one case.
  const onCase = {
    ...state,
    screen: "staff-case",
    savedCase: officeCase({ stage: "screening", intakeVerified: false }),
  };
  assert.match(staffScreen(onCase), /data-case-action="VERIFY_INTAKE"/);
  assert.doesNotMatch(
    staffScreen({ ...onCase, principal: { ...onCase.principal, personId: "alex" } }),
    /data-case-action="VERIFY_INTAKE"/,
  );
  // And with no person on the account at all, the preparation board, read-only.
  const none = staffScreen({ ...state, principal: { ...state.principal, personId: null } });
  assert.match(none, /Work board<\/h2>/);
  assert.deepEqual(caseActions(none), []);
});

test("the close-case dialog is reachable from the shared modal frame", () => {
  const html = dialog({ dialog: "close-case", savedCase: officeCase(), busy: false });
  assert.match(html, /role="dialog" aria-modal="true"/);
  assert.match(html, /Close this case\?/);
  assert.match(html, /data-case-action="CLOSE_CASE"/);
  assert.equal(dialog({ dialog: null }), "");
});

test("the office case page uses the same header and five tabs", () => {
  const html = renderAdminCase(officeCase(), { person: SAM, caseTab: "followup" });
  assert.match(html, /<h2 id="case-title" tabindex="-1">/);
  assert.match(html, /<ol class="lifecycle"/);
  assert.match(html, /id="case-tab-followup" aria-controls="case-panel-followup" aria-selected="true"/);
  assert.match(html, /id="case-panel-overview"[^>]*hidden>[\s\S]*How this case reached the office[\s\S]*Screening checks[\s\S]*Case details/);
  // "Stage" used to appear twice on Overview: once in the origin section and
  // once in Case details. Only the Case details row is left.
  assert.equal((html.match(/<span>Stage<\/span>/g) ?? []).length, 1);
  assert.match(html, /id="case-panel-documents"[^>]*hidden>[\s\S]*<h2 id="documents-title">Documents<\/h2>/);
  assert.match(html, /id="case-panel-history"[^>]*hidden>[\s\S]*History/);
});

test("the office pool and the add-a-case page route by the staff member's person, and the sidebar follows", () => {
  const state = {
    principal: { userId: "p1", workspaceId: "w1", access: "staff", personId: "sam" },
    people: PEOPLE,
    cases: [boardCase()],
    assistance: [],
    savedCase: null,
    screen: "office-cases",
    boardFilters: {},
    openPanels: [],
    draftAnswers: {},
    busy: false,
    error: null,
    retryable: false,
  };
  const navItem = (html, label) =>
    html.match(new RegExp(`<button[^>]*>[^<]*(?:<svg.*?</svg>)?\\s*${label}</button>`))?.[0] ?? "";

  const pool = staffScreen(state);
  assert.match(pool, /Case pool/);
  assert.match(pool, /<h2 id="pool-title">All cases<\/h2>/);
  assert.match(navItem(pool, "All cases"), /aria-current="page"/);
  assert.doesNotMatch(navItem(pool, "Follow-ups"), /aria-current/);
  assert.match(navItem(pool, "Follow-ups"), /data-action="open-board"/);

  // A volunteer whose window was left on the pool gets the work board.
  const volunteer = staffScreen({ ...state, principal: { ...state.principal, personId: "alex" } });
  assert.match(volunteer, /Work board<\/h2>/);
  assert.doesNotMatch(volunteer, /Case pool/);
  assert.match(navItem(volunteer, "Work board"), /aria-current="page"/);
  assert.doesNotMatch(volunteer, /All cases/);

  const adding = staffScreen({ ...state, screen: "office-add-case" });
  assert.match(adding, /Add a case<\/h1>/);
  assert.doesNotMatch(adding, /aria-current="page"/);
});

test("the staff sidebar nav holds nothing but its buttons", () => {
  const state = {
    principal: { userId: "p1", workspaceId: "w1", access: "staff", personId: "sam" },
    people: PEOPLE, cases: [], assistance: [],
    savedCase: null, screen: "staff", boardFilters: {}, openPanels: [],
    draftAnswers: {}, busy: false, error: null, retryable: false,
  };
  for (const personId of ["sam", "alex"]) {
    const html = staffScreen({ ...state, principal: { ...state.principal, personId: personId } });
    const nav = html.match(/<nav class="sidebar-nav"[^>]*>(.*?)<\/nav>/s)[1];
    assert.equal(nav.replace(/<button[^>]*>.*?<\/button>/gs, "").trim(), "", personId);
  }
});

test("the volunteer board searches client numbers in the workspace's current season", () => {
  const state = {
    principal: { userId: "p1", workspaceId: "w1", access: "staff", personId: "alex" },
    people: PEOPLE,
    workspace: { currentSeason: 2025 },
    cases: [
      boardCase({ id: "case-now", reference: "VT-NOWW-2025", clientNumber: 93, season: 2025 }),
      boardCase({ id: "case-then", reference: "VT-THEN-2024", clientNumber: 93, season: 2024 }),
    ],
    assistance: [],
    savedCase: null,
    screen: "staff",
    boardFilters: { search: "093" },
    openPanels: [],
    draftAnswers: {},
    busy: false,
    error: null,
    retryable: false,
  };
  const html = staffScreen(state);
  assert.match(html, /Search results<\/h2>/);
  assert.match(html, /VT-NOWW-2025/);
  assert.doesNotMatch(html, /VT-THEN-2024/);
});

// ---------------------------------------------------------------------------
// Part 4c, Task 1: the answers, contact and materials cards on the office page.
// ---------------------------------------------------------------------------

const intakeTab = (html) =>
  html.match(
    /<div role="tabpanel" id="case-panel-intake"[^>]*>([\s\S]*?)<div role="tabpanel" id="case-panel-documents"/,
  )[1];

test("a submitted version-2 case shows the answers, the contact card and the materials card on the office page", () => {
  const sample = makeSampleAnswers({ seed: 2 });
  const answers = Object.fromEntries(
    Object.entries(sample).filter(([id]) => !Object.hasOwn(CONTACT_FIELDS, id)),
  );
  const record = officeCase({
    stage: "received",
    intakeVersion: 2,
    answers,
    contact: { phone: sample.tp_phone, bestContactTime: ["weekend"], bestContactNote: null },
    materials: [{ item: "photo_id", receivedAt: "2026-09-14T15:00:00.000Z", recordedByPersonId: "sam" }],
  });
  const tab = intakeTab(renderAdminCase(record, { person: SAM }));
  const at = (text) => tab.indexOf(text);
  assert.ok(at("Wording used: Standard") >= 0);
  assert.ok(at("Wording used") < at('class="panel contact-card"'));
  assert.ok(at('class="panel contact-card"') < at('class="panel materials-card"'));
  assert.match(tab, /<span class="phone-mask" id="contact-phone" tabindex="0">/);
  assert.match(tab, /<span class="phone-full">\(215\) 555-01\d\d<\/span>/);
  assert.doesNotMatch(tab.replace(/<svg[\s\S]*?<\/svg>/g, ""), /="[^"]*555-01/, "no attribute carries the number");
  assert.match(tab, /Weekends/);
  assert.match(tab, /data-action="toggle-edit-contact"/);
  assert.match(tab, /Recorded by Sam ·/);
  assert.match(tab, /data-case-action="RECORD_MATERIALS"/);
  // The form opens from the panel list the page is given.
  const open = intakeTab(renderAdminCase(record, { person: SAM, openPanels: ["edit-contact"] }));
  assert.match(open, /id="contact-form"/);
});

// ---------------------------------------------------------------------------
// Part 4c, Task 2: the document checklist on the office page.
// ---------------------------------------------------------------------------

test("the office page's Documents tab starts with the checklist for a submitted version-2 case", () => {
  const sample = makeSampleAnswers({ seed: 2 });
  const answers = Object.fromEntries(
    Object.entries(sample).filter(([id]) => !Object.hasOwn(CONTACT_FIELDS, id)),
  );
  const record = officeCase({
    stage: "received",
    intakeVersion: 2,
    answers,
    contact: { phone: sample.tp_phone, bestContactTime: [], bestContactNote: null },
    materials: [],
    documentCards: [],
  });
  const html = renderAdminCase(record, { person: SAM });
  const tab = html.match(
    /id="case-panel-documents"[^>]*>([\s\S]*?)<div role="tabpanel" id="case-panel-followup"/,
  )[1];
  assert.ok(tab.startsWith('<section class="panel doc-checklist"'));
  assert.ok(tab.indexOf("doc-checklist") < tab.indexOf('id="documents-title"'));
  assert.match(tab, /data-action="mark-card"/, "Sam works every case: the marks show");
  // Alex does not prepare this one: the office page offers him no marks.
  const forAlex = renderAdminCase({ ...record, preparerId: "someone-else" }, { person: ALEX });
  assert.doesNotMatch(forAlex, /data-action="mark-card"/);
});

// ---------------------------------------------------------------------------
// Part 4c, Task 4: an office draft continues in Add a case.
// ---------------------------------------------------------------------------

test("an office draft continues in Add a case, and a client's own case is read-only", () => {
  const record = officeCase({
    stage: "draft",
    intakeVerified: false,
    intakeVersion: 2,
    answers: { tp_first_name: "Mei" },
    contact: null,
    materials: [],
    documentCards: [],
  });
  const html = renderAdminCase(record, { person: SAM });
  const overview = html.match(/id="case-panel-overview"[^>]*>([\s\S]*?)<div role="tabpanel" id="case-panel-intake"/)[1];
  assert.match(overview, /<span>How it started<\/span><strong>Assisted \(staff-entered\)/);
  assert.match(overview, /<span>Client account<\/span><strong>No client account/);
  assert.match(overview, /This walk-in client&#39;s answers are entered in Add a case\./);
  assert.match(overview, /<button type="button" class="btn primary" data-action="continue-add-case" data-case-id="case-a"[^>]*>[\s\S]*?Continue in Add a case<\/button>/);
  assert.doesNotMatch(html, /assisted-answers-form/);
  assert.doesNotMatch(html, /data-case-action="SAVE_ANSWERS"/);
  // The Intake answers tab holds the answers, contact and materials cards.
  const tab = intakeTab(html);
  assert.match(tab, /Wording used/);
  assert.match(tab, /class="panel contact-card"/);
  assert.match(tab, /class="panel materials-card"/);
  assert.doesNotMatch(tab, /filling in this walk-in client/);
  // Somebody without the office right is told why, with no way in.
  const forAlex = renderAdminCase(record, { person: ALEX });
  assert.doesNotMatch(forAlex, /data-action="continue-add-case"/);

  // A client's own case is never edited here: the summary is read-only.
  const owned = renderAdminCase(officeCase({ ownerUserId: "owner-1", intakeVersion: 2 }), { person: SAM });
  assert.doesNotMatch(owned, /data-case-action="SAVE_ANSWERS"/);
  assert.doesNotMatch(owned, /continue-add-case/);
  assert.match(owned, /<span>How it started<\/span><strong>The client&#39;s own application/);
  assert.match(owned, /What the client told us/);
});

test("follow-up with no request renders", () => {
  const goOver = openTask({
    id: "task-go",
    purpose: "go_over_return",
    requestId: null,
    reason: "Go over the return with the client: the reviewer did not.",
  });
  const html = renderAdminCase(officeCase({ requests: [openRequest()], followups: [goOver] }), { person: SAM });
  const followup = html.slice(html.indexOf('id="case-panel-followup"'), html.indexOf('id="case-panel-contacts"'));
  assert.match(followup, /<h3>Go over the return with the client<\/h3>/);
  assert.match(followup, /Go over the return with the client: the reviewer did not\./);
  assert.doesNotMatch(followup, /Contact the client|awaiting preparer verification/);
  assert.match(followup, linkedForm("task-go"));
  assert.match(followup, /<h4>Resolve this task<\/h4>/);
  assert.match(followup, /name="purpose" value="go_over_return" required checked/);
});

test("a task's Log contact form starts with its purpose; the Contacts tab chooses none", () => {
  const record = officeCase({
    requests: [openRequest()],
    followups: [openTask({ id: "task-d", purpose: "request_documents" })],
  });
  const html = renderAdminCase(record, { person: SAM });
  const followup = html.slice(html.indexOf('id="case-panel-followup"'), html.indexOf('id="case-panel-contacts"'));
  assert.match(followup, /name="purpose" value="request_documents" required checked/);
  const contacts = html.slice(html.indexOf('id="case-panel-contacts"'));
  assert.doesNotMatch(contacts, /name="purpose"[^>]* checked/);
});

// ---------------------------------------------------------------------------
// After E-filed (change add-post-efiling-stages)
// ---------------------------------------------------------------------------
const BOTH_EFILED = { federalMethod: "efile", stateMethod: "efile" };
const rejectedFederal = (over = {}) =>
  officeCase({
    stage: "rejected",
    ...BOTH_EFILED,
    federalResult: "rejected",
    stateResult: "accepted",
    reviews: CALLED,
    ...over,
  });

test("at E-filed an admin is offered Record filing result…; volunteers see none of the new buttons", () => {
  const filed = officeCase({ stage: "efiled", ...BOTH_EFILED, reviews: CALLED });
  const html = renderAdminCase(filed, { person: SAM });
  assert.match(
    html,
    /<button[^>]*data-action="open-record-filing-result"[^>]*>[^]*?Record filing result…<\/button>/,
  );
  assert.doesNotMatch(html, /open-return-to-signing/);
  for (const person of [ALEX, MORGAN]) {
    const other = renderAdminCase(filed, { person });
    assert.doesNotMatch(other, /open-record-filing-result|open-return-to-signing/);
    const staff = renderStaffCase(filed, person);
    assert.doesNotMatch(staff, /open-record-filing-result|open-return-to-signing/);
  }
  // A case e-filed before methods existed is offered it too.
  const old = renderAdminCase(officeCase({ stage: "efiled", reviews: CALLED }), { person: SAM });
  assert.match(old, /open-record-filing-result/);
  // Nothing leaves Accepted.
  const accepted = renderAdminCase(
    officeCase({ stage: "accepted", ...BOTH_EFILED, federalResult: "accepted", stateResult: "accepted" }),
    { person: SAM },
  );
  assert.doesNotMatch(accepted, /open-record-filing-result|open-return-to-signing|open-close-case/);
});

test("at Rejected: Return to signing… and Close, or the wait", () => {
  const done = renderAdminCase(rejectedFederal(), { person: SAM });
  assert.match(done, /data-action="open-return-to-signing"[^>]*>[^]*?Return to signing…<\/button>/);
  assert.match(done, /data-action="open-close-case"/);
  assert.doesNotMatch(done, /open-record-filing-result/);
  assert.doesNotMatch(done, /answer before the return can go back to signing/);

  const waiting = renderAdminCase(rejectedFederal({ stateResult: null }), { person: SAM });
  assert.doesNotMatch(waiting, /data-action="open-return-to-signing"/);
  assert.match(
    waiting,
    /Waiting for Pennsylvania(&#39;|')s answer before the return can go back to signing\./,
  );
  assert.match(waiting, /open-record-filing-result/);
  const irs = renderAdminCase(
    rejectedFederal({ federalResult: null, stateResult: "rejected" }),
    { person: SAM },
  );
  assert.match(irs, /Waiting for the IRS(&#39;|')s answer before the return can go back to signing\./);
  for (const person of [ALEX, MORGAN])
    assert.doesNotMatch(renderAdminCase(rejectedFederal(), { person }), /open-return-to-signing/);
});

test("the eligibility of the new office moves", () => {
  const sam = (record) => adminEligibility({ caseRecord: record }, SAM);
  const answered = { ...BOTH_EFILED, federalResult: "rejected", stateResult: "accepted" };
  const waitingState = { ...BOTH_EFILED, federalResult: "rejected" };
  assert.equal(sam({ stage: "efiled", ...BOTH_EFILED }).recordFilingResult.allowed, true);
  assert.equal(sam({ stage: "ready_to_efile" }).recordFilingResult.allowed, false);
  assert.equal(sam({ stage: "rejected", ...answered }).recordFilingResult.allowed, false);
  assert.equal(sam({ stage: "rejected", ...waitingState }).recordFilingResult.allowed, true);
  assert.equal(sam({ stage: "rejected", ...answered }).returnToSigning.allowed, true);
  assert.equal(sam({ stage: "rejected", ...waitingState }).returnToSigning.allowed, false);
  assert.equal(sam({ stage: "efiled", ...BOTH_EFILED }).returnToSigning.allowed, false);
  assert.equal(sam({ stage: "rejected", ...answered }).closeCase.allowed, true);
  // Back at signing, Mark ready to e-file is offered without the reviewer's call or the go-over.
  assert.equal(
    sam({ stage: "review_approved", ...answered, reviews: WAITING, goOverOpen: true }).markReadyToEfile.allowed,
    true,
  );
  assert.equal(
    adminEligibility({ caseRecord: { stage: "efiled", ...BOTH_EFILED } }, ALEX).recordFilingResult.allowed,
    false,
  );
});

test("a case returned to signing says this is the client's second signing", () => {
  const record = officeCase({
    stage: "review_approved",
    ...BOTH_EFILED,
    federalResult: "rejected",
    stateResult: "accepted",
    reviews: CALLED,
  });
  const html = renderAdminCase(record, { person: SAM });
  assert.match(html, /data-action="open-mark-ready-to-efile"/);
  assert.match(markReadyToEfileDialogBody({ savedCase: record }), /second signing/);
  assert.doesNotMatch(
    markReadyToEfileDialogBody({ savedCase: officeCase({ stage: "review_approved" }) }),
    /second signing/,
  );
});

const radios = (html, name) =>
  [...html.matchAll(new RegExp(`<input[^>]*type="radio"[^>]*name="${name}"[^>]*value="([a-z_]+)"`, "g"))].map(
    (m) => m[1],
  );

test("Mark e-filed offers four choices on a first filing, each with what the client is told", () => {
  const html = markEfiledDialogBody({
    savedCase: officeCase({ stage: "ready_to_efile", answers: { tp_first_name: "Mei", tp_last_name: "Chen" } }),
  });
  assert.deepEqual(radios(html, "filing-combination"), ["both_efile", "efile_and_paper", "paper_and_efile", "both_paper"]);
  assert.match(html, /Both returns e-filed/);
  assert.match(html, /Federal e-filed, Pennsylvania on paper \(given to the client to mail\)/);
  assert.match(html, /Federal on paper \(given to the client to mail\), Pennsylvania e-filed/);
  assert.match(html, /Both returns on paper \(given to the client to mail\)/);
  assert.match(html, /PCDC e-filed your return\./);
  assert.match(html, /PCDC e-filed your federal return and gave your Pennsylvania return on paper to you or the person you sent\. If it isn(&#39;|')t signed yet, sign it, then mail it yourself\. A reply can take about 3 months after you mail it\./);
  assert.match(html, /PCDC gave your federal return on paper to you or the person you sent, and e-filed your Pennsylvania return\./);
  assert.match(html, /PCDC gave your returns on paper to you or the person you sent\./);
  assert.doesNotMatch(html, /mailed your/);
  assert.match(html, /data-case-action="MARK_EFILED"/);
  assert.match(html, /name="confirmed" value="true" required/);
  assert.doesNotMatch(html, /name="method-federal"|name="method-state"/);
});

test("Mark e-filed after a rejection offers only the rejected return, and lists the accepted one as done", () => {
  const record = officeCase({
    stage: "ready_to_efile",
    ...BOTH_EFILED,
    federalResult: "accepted",
    stateResult: "rejected",
    answers: { tp_first_name: "Mei", tp_last_name: "Chen" },
  });
  const html = markEfiledDialogBody({ savedCase: record });
  assert.deepEqual(radios(html, "method-state"), ["efile", "paper"]);
  assert.deepEqual(radios(html, "method-federal"), []);
  assert.doesNotMatch(html, /filing-combination/);
  assert.match(html, /Federal return[^]*?accepted/i);
  assert.match(html, /PCDC e-filed your Pennsylvania return\./);
  assert.match(html, /On paper \(given to the client to mail\)/);
  assert.match(html, /PCDC gave your Pennsylvania return on paper to you or the person you sent\./);
  assert.doesNotMatch(html, /mailed your/);
  // Both rejected: both choices, with the combination lines.
  const both = markEfiledDialogBody({
    savedCase: officeCase({ stage: "ready_to_efile", ...BOTH_EFILED, federalResult: "rejected", stateResult: "rejected" }),
  });
  assert.deepEqual(radios(both, "method-federal"), ["efile", "paper"]);
  assert.deepEqual(radios(both, "method-state"), ["efile", "paper"]);
  assert.match(both, /PCDC e-filed your return\./);
});

test("the Record filing result dialog names the client and the application, and builds its payload", () => {
  const record = officeCase({
    stage: "efiled",
    ...BOTH_EFILED,
    reference: "VT-AAAA-BBBB",
    answers: { tp_first_name: "Mei", tp_last_name: "Chen" },
  });
  const html = recordFilingResultDialogBody({ savedCase: record });
  assert.match(html, /Mei Chen/);
  assert.match(html, /VT-AAAA-BBBB/);
  assert.match(html, /data-case-action="RECORD_FILING_RESULT"/);
  assert.match(html, /name="confirmed" value="true" required/);
  for (const field of ["result-federal", "date-federal", "code-federal", "result-state", "date-state", "code-state", "fix-note"])
    assert.match(html, new RegExp(`name="${field}"`), field);
  // No answer is dated after PCDC's today, and the submit control carries the stage.
  const today = nowInput().slice(0, 10);
  assert.equal(html.match(new RegExp(`name="date-(federal|state)" type="date"[^>]*max="${today}"`, "g")).length, 2);
  assert.match(html, /data-case-action="RECORD_FILING_RESULT"[^>]*data-stage="efiled"/);
  // A paper return has no answer to record: no fieldset, no mailing words.
  const paper = recordFilingResultDialogBody({
    savedCase: officeCase({ stage: "efiled", federalMethod: "efile", stateMethod: "paper" }),
  });
  assert.match(paper, /name="result-federal"/);
  assert.doesNotMatch(paper, /name="result-state"|name="date-state"|name="code-state"/);
  assert.doesNotMatch(html + paper, /mailed|Date mailed|value="mailed"/i);
  assert.match(html, /Fix note \(only when a return is rejected\): what needs fixing in TaxSlayer/);
  const stuck = recordFilingResultDialogBody({
    savedCase: officeCase({ stage: "efiled", federalMethod: "paper", stateMethod: "paper" }),
  });
  assert.doesNotMatch(stuck, /name="result-|mailed/i);
  // At Rejected, only the returns still waiting are offered.
  const waiting = recordFilingResultDialogBody({ savedCase: rejectedFederal({ stateResult: null }) });
  assert.match(waiting, /name="result-state"/);
  assert.doesNotMatch(waiting, /name="result-federal"/);
  const built = payloadFor("RECORD_FILING_RESULT", {}, {
    confirmed: "true",
    "result-federal": "rejected",
    "date-federal": "2026-10-05",
    "code-federal": "IND-031-04",
    "fix-note": "Preparer to fix",
  });
  assert.deepEqual(built.payload, {
    confirmed: true,
    results: { federal: { result: "rejected", date: "2026-10-05", code: "IND-031-04" } },
    fixNote: "Preparer to fix",
  });
});

test("the Return to signing dialog names the client and reads 'The fix is done.'", () => {
  const html = returnToSigningDialogBody({
    savedCase: { reference: "VT-AAAA-BBBB", answers: { tp_first_name: "Mei", tp_last_name: "Chen" } },
  });
  assert.match(html, /Mei Chen/);
  assert.match(html, /VT-AAAA-BBBB/);
  assert.match(html, /<span>The fix is done\.<\/span>/);
  assert.match(html, /data-case-action="RETURN_TO_SIGNING"/);
  assert.match(html, /name="confirmed" value="true" required/);
  assert.match(returnToSigningDialogBody({}), /this client/);
});

// ---------------------------------------------------------------------------
// Hold and closing (change add-hold-and-closing)
// ---------------------------------------------------------------------------

const MEI = { tp_first_name: "Mei", tp_last_name: "Chen" };
const page = (overrides, person = SAM) =>
  renderAdminCase(officeCase({ answers: { service: "Drop-off", language: "Cantonese", ...MEI }, ...overrides }), { person });
const opens = (html) => [...html.matchAll(/data-action="(open-[a-z-]+)"/g)].map((m) => m[1]);

test("the office panel offers Ask for documents… at Screening and Pending intake / filing", () => {
  for (const stage of ["screening", "preparation_ready"])
    assert.ok(opens(page({ stage, preparerId: null })).includes("open-request-documents"), stage);
  // More can be asked while the case waits, or sits on a documents Hold.
  assert.ok(opens(page({ stage: "awaiting_documents", documentsOrigin: "screening" })).includes("open-request-documents"));
  assert.ok(
    opens(page({ stage: "on_hold", holdOrigin: "awaiting_documents", documentsOrigin: "screening" })).includes("open-request-documents"),
  );
  for (const stage of ["received", "preparing", "review_approved", "efiled"])
    assert.ok(!opens(page({ stage })).includes("open-request-documents"), stage);
});

test("the office panel offers Put on hold… at Waiting for documents and Ready to exit", () => {
  const withDocs = page({ stage: "awaiting_documents", documentsOrigin: "screening" });
  assert.ok(opens(withDocs).includes("open-put-on-hold"));
  assert.match(withDocs, /Put on hold…/);
  assert.ok(opens(page({ stage: "review_approved" })).includes("open-put-on-hold"));
  for (const stage of ["screening", "preparing", "on_hold", "ready_to_efile"])
    assert.ok(!opens(page({ stage, holdOrigin: "review_approved" })).includes("open-put-on-hold"), stage);
});

test("the office panel offers Got in touch… at a Hold, and Close… from it", () => {
  for (const hold of [
    { holdOrigin: "review_approved" },
    { holdOrigin: "awaiting_documents", documentsOrigin: "screening" },
  ]) {
    const html = page({ stage: "on_hold", ...hold });
    assert.ok(opens(html).includes("open-resume-from-hold"));
    assert.match(html, /Got in touch…/);
    assert.ok(opens(html).includes("open-close-case"), "Close… from a Hold, whatever it came from");
  }
  assert.ok(!opens(page({ stage: "preparing" })).includes("open-resume-from-hold"));
  assert.match(page({ stage: "on_hold", holdOrigin: "review_approved" }), /could not reach the client to sign\./);
  assert.doesNotMatch(page({ stage: "on_hold", holdOrigin: "review_approved" }), /could not reach the client to sign Form/);
});

test("volunteers see none of the intake-and-hold buttons", () => {
  for (const person of [ALEX, MORGAN]) {
    for (const overrides of [
      { stage: "screening" },
      { stage: "awaiting_documents", documentsOrigin: "screening" },
      { stage: "review_approved" },
      { stage: "on_hold", holdOrigin: "review_approved" },
    ]) {
      const html = page(overrides, person);
      for (const name of ["open-request-documents", "open-put-on-hold", "open-resume-from-hold"])
        assert.ok(!opens(html).includes(name), `${person.name} ${overrides.stage} ${name}`);
    }
  }
  const rights = adminEligibility({ caseRecord: { stage: "screening" } }, ALEX);
  assert.equal(rights.requestDocuments.allowed, false);
  assert.equal(rights.putOnHold.allowed, false);
  assert.equal(rights.resumeFromHold.allowed, false);
});

test("the screening checks panel offers Ask for documents… until the documents box is ticked", () => {
  const record = officeCase({ stage: "screening", intakeVerified: false, answers: { service: "Drop-off", ...MEI } });
  const panel = (openPanels) => {
    const html = renderAdminCase(record, { person: SAM, openPanels });
    const checks = html.slice(html.indexOf('id="checks-title"'), html.indexOf('id="receipt-title"'));
    return checks;
  };
  assert.match(panel([]), /data-action="open-request-documents"/);
  assert.doesNotMatch(panel(["intake-check-documents"]), /open-request-documents/);
  // Only during screening, and only for an admin.
  const later = renderAdminCase(officeCase({ stage: "preparation_ready" }), { person: SAM });
  assert.doesNotMatch(later.slice(later.indexOf('id="checks-title"'), later.indexOf('id="receipt-title"')), /open-request-documents/);
  const volunteer = renderAdminCase(record, { person: ALEX });
  assert.doesNotMatch(volunteer, /open-request-documents/);
});

test("an admin records and verifies documents at Waiting for documents and at a documents Hold", () => {
  const request = { id: "r1", title: "Photo ID", message: "Send a photo", status: "open", createdAt: "2026-10-01T12:00:00Z" };
  const docs = { stage: "awaiting_documents", documentsOrigin: "screening", ownerUserId: null, requests: [request] };
  assert.match(page(docs), /data-case-action="RECORD_DOCUMENT_RESPONSE"/);
  const received = { ...docs, requests: [{ ...request, status: "awaiting_verification" }] };
  assert.match(page(received), /data-case-action="VERIFY_DOCUMENT"/);
  const hold = { ...received, stage: "on_hold", holdOrigin: "awaiting_documents" };
  assert.match(page(hold), /data-case-action="VERIFY_DOCUMENT"/);
  assert.match(page({ ...hold, requests: [request] }), /data-case-action="RECORD_DOCUMENT_RESPONSE"/);
  // A signing hold has no document work, and a volunteer cannot verify at intake.
  assert.doesNotMatch(page({ ...received, stage: "on_hold", holdOrigin: "review_approved" }), /VERIFY_DOCUMENT/);
  assert.doesNotMatch(page(received, ALEX), /VERIFY_DOCUMENT/);
});

test("the close dialog's choices reach the CLOSE_CASE payload", () => {
  const html = closeCaseDialogBody({ savedCase: officeCase({ answers: MEI }) });
  assert.match(html, /<strong>VT-AB2C-DE3F<\/strong> for <strong>Mei Chen<\/strong>/);
  assert.deepEqual(
    payloadFor("CLOSE_CASE", {}, { "close-reason": "other", "close-note": "Client chose another preparer", confirmed: "true" }).payload,
    { confirmed: true, reason: "other", note: "Client chose another preparer" },
  );
  assert.throws(() => payloadFor("CLOSE_CASE", {}, { "close-reason": "other", confirmed: "true" }), (e) => e.code === "VALIDATION");
  // An older close: stages the office closes now include the two chase stages.
  for (const stage of ["awaiting_documents", "on_hold"])
    assert.equal(adminEligibility({ caseRecord: { stage } }, SAM).closeCase.allowed, true, stage);
});

test("before filing the close dialog offers only Withdrawn, with a note saying why", () => {
  const radios = (html) => [...html.matchAll(/name="close-reason" value="([a-z_]+)"/g)].map((m) => m[1]);
  const NOTE = "Before filing, a case can only be closed because the client withdrew.";
  for (const savedCase of [
    officeCase({ stage: "review_approved" }),
    officeCase({ stage: "ready_to_efile" }),
  ]) {
    const html = closeCaseDialogBody({ savedCase });
    assert.deepEqual(radios(html), ["withdrawn"], savedCase.stage);
    assert.match(html, new RegExp(NOTE.replaceAll(".", "\\.")));
  }
  // A Hold from signing, and every earlier stage, keeps all six reasons and no note.
  for (const savedCase of [officeCase({ stage: "on_hold", holdOrigin: "review_approved" }), officeCase()]) {
    const html = closeCaseDialogBody({ savedCase });
    assert.equal(radios(html).length, 6);
    assert.doesNotMatch(html, /only be closed because the client withdrew/);
  }
  // Close… is offered on the case page at both stages.
  for (const stage of ["review_approved", "ready_to_efile"])
    assert.ok(opens(page({ stage })).includes("open-close-case"), stage);
});

test("the three new dialogs name the client and the application, with the shared confirmation body", () => {
  const savedCase = { reference: "VT-TEST-0009", answers: MEI };
  const ask = requestDocumentsDialogBody({ savedCase });
  assert.match(ask, /<strong>Mei Chen<\/strong>[\s\S]*<strong>VT-TEST-0009<\/strong>/);
  for (let n = 1; n <= 5; n += 1) {
    assert.match(ask, new RegExp(`name="request-title-${n}"`));
    assert.match(ask, new RegExp(`name="request-message-${n}"`));
  }
  assert.match(ask, /data-case-action="REQUEST_DOCUMENTS_AT_INTAKE"/);
  assert.match(ask, /data-action="close-dialog"/);
  assert.deepEqual(
    payloadFor("REQUEST_DOCUMENTS_AT_INTAKE", {}, {
      "request-title-1": "W-2", "request-message-1": "Send every W-2",
      "request-title-2": "", "request-message-2": "",
      "request-title-3": "Photo ID", "request-message-3": "Front and back",
    }).payload,
    { requests: [{ title: "W-2", message: "Send every W-2" }, { title: "Photo ID", message: "Front and back" }] },
  );
  const hold = putOnHoldDialogBody({ savedCase });
  assert.match(hold, /<strong>VT-TEST-0009<\/strong> for <strong>Mei Chen<\/strong>/);
  assert.match(hold, /<textarea id="field-hold-hold-note" name="hold-note" maxlength="1000"/);
  assert.match(hold, /name="confirmed" value="true" required/);
  assert.match(hold, /data-case-action="PUT_ON_HOLD"/);
  assert.deepEqual(
    payloadFor("PUT_ON_HOLD", {}, { "hold-note": " no answer ", confirmed: "true" }).payload,
    { confirmed: true, note: "no answer" },
  );
  const back = resumeFromHoldDialogBody({ savedCase });
  assert.match(back, /<strong>Mei Chen<\/strong>[\s\S]*<strong>VT-TEST-0009<\/strong>/);
  assert.match(back, /data-case-action="RESUME_FROM_HOLD"/);
  assert.match(back, /name="confirmed" value="true" required/);
  assert.match(requestDocumentsDialogBody({}), /this client/);
  // What staff typed is escaped when it is shown back (a dialog only holds empty boxes,
  // but the client name and reference are data).
  assert.match(putOnHoldDialogBody({ savedCase: { reference: "<b>x</b>", answers: {} } }), /&lt;b&gt;x&lt;\/b&gt;/);
});

test("the shared frame places the two new dialogs", () => {
  const savedCase = { reference: "VT-X", answers: {}, stage: "efiled" };
  assert.match(dialog({ dialog: "record-filing-result", savedCase }), /Record the filing result\?/);
  assert.match(dialog({ dialog: "return-to-signing", savedCase }), /Return to signing\?/);
});

test("the signing panel is headed Signing, with neutral wording", () => {
  const before = page({ stage: "review_approved", reviews: CALLED });
  assert.match(before, /<h3>Signing<\/h3><p class="field-note">Record that the client signed\./);
  assert.doesNotMatch(before, /<h3>Form 8879<\/h3>/);
  const rights = (record) => adminEligibility({ caseRecord: record }, SAM);
  assert.equal(rights({ stage: "preparing" }).markEfiled.reason, "This is recorded once the client has signed.");
  assert.equal(rights({ stage: "ready_to_efile" }).markEfiled.allowed, true);
});

test("Return to signing is never held back by a paper return, and stays refused while an e-filed return waits", () => {
  const sam = (record) => adminEligibility({ caseRecord: record }, SAM);
  const paper = { stage: "rejected", federalMethod: "efile", stateMethod: "paper", federalResult: "rejected" };
  assert.equal(sam(paper).returnToSigning.allowed, true);
  const stuck = { stage: "rejected", federalMethod: "paper", stateMethod: "efile", stateResult: "rejected" };
  assert.equal(sam(stuck).returnToSigning.allowed, true);
  const waiting = { stage: "rejected", federalMethod: "efile", stateMethod: "efile", federalResult: "rejected" };
  assert.match(sam(waiting).returnToSigning.reason, /^Waiting for Pennsylvania's answer/);
});

test("the office's Ready to exit case offers the Exit Form from the reviewer's questionnaire", () => {
  const approved = officeCase({
    stage: "review_approved",
    preparationVersion: 1,
    reviewerId: "morgan",
    reviews: [{ id: "review-1", preparationVersion: 1, status: "approved", reviewerId: "morgan" }],
    reviewerQuestionnaires: [{ id: "rq-1", reviewId: "review-1", exitForm: { federal: null, state: null, local: [] } }],
  });
  const html = renderAdminCase(approved, { person: SAM });
  assert.match(html, /<h2 id="exit-form-title">Exit Form<\/h2>/);
  assert.match(html, /data-action="view-exit-form" data-review="review-1">Download Exit Form</);

  const before = renderAdminCase(officeCase(), { person: SAM });
  assert.doesNotMatch(before, /exit-form-title|view-exit-form/);
});

test("the office's Exit Form panel uses the latest approval and stays after filing", () => {
  const approved = officeCase({
    stage: "efiled",
    preparationVersion: 2,
    reviewerId: "morgan",
    reviews: [
      { id: "review-1", preparationVersion: 1, status: "approved", reviewerId: "morgan" },
      { id: "review-2", preparationVersion: 2, status: "approved", reviewerId: "morgan" },
    ],
    reviewerQuestionnaires: [
      { id: "rq-1", reviewId: "review-1", exitForm: { federal: null, state: null, local: [] } },
      { id: "rq-2", reviewId: "review-2", exitForm: { federal: null, state: null, local: [] } },
    ],
  });
  const html = renderAdminCase(approved, { person: SAM });
  assert.match(html, /<h2 id="exit-form-title">Exit Form<\/h2>/);
  assert.equal((html.match(/data-action="view-exit-form"/g) ?? []).length, 1);
  assert.match(html, /data-action="view-exit-form" data-review="review-2">/);
});

test("the office's Exit Form panel needs a reviewer questionnaire, and uses the latest approval that has one", () => {
  const exitForm = { federal: null, state: null, local: [] };
  const none = officeCase({
    stage: "review_approved",
    preparationVersion: 1,
    reviewerId: "morgan",
    reviews: [{ id: "review-1", preparationVersion: 1, status: "approved", reviewerId: "morgan" }],
    reviewerQuestionnaires: [],
  });
  assert.doesNotMatch(renderAdminCase(none, { person: SAM }), /exit-form-title|view-exit-form/);

  const later = officeCase({
    stage: "review_approved",
    preparationVersion: 2,
    reviewerId: "morgan",
    reviews: [
      { id: "review-1", preparationVersion: 1, status: "approved", reviewerId: "morgan" },
      { id: "review-2", preparationVersion: 2, status: "approved", reviewerId: "morgan" },
    ],
    reviewerQuestionnaires: [{ id: "rq-1", reviewId: "review-1", exitForm }],
  });
  const html = renderAdminCase(later, { person: SAM });
  assert.equal((html.match(/data-action="view-exit-form"/g) ?? []).length, 1);
  assert.match(html, /data-action="view-exit-form" data-review="review-1">/);
});
