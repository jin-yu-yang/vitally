import {
  esc,
  icon,
  button,
  caseButton,
  caseSubmit,
  textarea,
  select,
  input,
  fieldId,
  formatTime,
  confirmBody,
  emptyLine,
} from "./ui.mjs";
import {
  FOLLOWUP_RESOLUTION_OUTCOMES,
  SCREENING_CHECK_LABELS,
  screeningCheckKeys,
  SAMPLE_DOCUMENT_FILENAME,
} from "./case-actions.mjs";
import {
  when,
  named,
  explain,
  detailRow,
  problemNotice,
  caseHeader,
  caseTabs,
  caseDetails,
  exitFormPanel,
  intakeAnswersTab,
  documentsPanel,
  documentChecklist,
  historyPanel,
  staffEligibility,
  isAvailableWork,
  REQUEST_STATUS,
  FOLLOWUP_STATUS,
  CONTACT_OUTCOME_LABELS,
  NO_LINKED_VOLUNTEER,
  UNKNOWN_PERSON,
  contactsPanel,
  logContactForm,
  taskContacts,
  filingPanel,
} from "./staff-views.mjs";
import {
  waitingReturns,
  returnedToSigning,
  returnState,
  holdKind,
  CLOSING_REASON_NAMES,
} from "./domain.mjs";
import { CLOSING_REASONS } from "./contracts.mjs";
import { nowInput } from "./contact-log.mjs";
import { demoFillButton } from "./demo-fill.mjs";

// The task's own list lives beside the Contacts tab, in staff-views.mjs, and
// the office drawer takes it from here as it always took the attempt list.
export { taskContacts };

// Sam's side of the workspace: the office board and the office view of one
// case. Pure functions, exactly like `staff-views.mjs` — no state, no store, no
// timers, no DOM — and the same four conventions hold:
//
//   * workflow buttons carry `data-case-action` with a name from CASE_ACTIONS
//     and any related id in `data-request-id` / `data-followup-id`;
//   * assistance controls carry `data-assistance-action="CLAIM"|"RESOLVE"` with
//     `data-item-id`. Assistance is **not** a case action: it has its own RPC,
//     its own revision and its own list, so it has its own attribute and the
//     wiring layer validates it against its own vocabulary;
//   * navigation, filters and dialogs carry `data-action`;
//   * a person who may not do something sees the reason, not a missing button.
//     `adminEligibility` is the one place those rules live (Ruling R53).
//
// Every section that also exists on the preparer/reviewer screens is imported
// from `staff-views.mjs` rather than written again, so one case cannot describe
// itself two ways (Ruling R55).
//
// Nothing here claims a signature or a filing, or sends a message. The screening
// checks record what a volunteer confirmed, including a real identity check for
// an online client; a reminder records a nudge and sends nothing, and closure
// closes ViTally's own workflow only.

export const OFFICE_NOTE =
  "ViTally records office work only. It sends no email, no letter and no text message.";

// ---------------------------------------------------------------------------
// Eligibility (Ruling R53) — one implementation, asked by the board and by the
// case workspace, so the two can never disagree about who may act.
// ---------------------------------------------------------------------------

const allowed = { allowed: true, reason: "" };
const refused = (reason) => ({ allowed: false, reason });

// A capability is a step-4 check in the database's order (contracts §"validation
// order"): the persona and what it is allowed to do at all come first, then the
// case's stage, then the target record's own state and who holds it. These
// refusals are in that order for the same reason the preparer's are — so the
// browser and the server refuse for the same reason, in the same sequence.
const NEEDS = Object.freeze({
  admin: "Needs office administrator access.",
  followup: "Needs office follow-up access.",
  receive_documents: "Needs office document-receipt access.",
  assist: "Needs client assistance access.",
});

const DOCUMENT_STAGES = Object.freeze(["preparing", "corrections_required", "awaiting_documents"]);
// The stages the office can ask the client for documents from, or add to.
const ASK_STAGES = Object.freeze(["screening", "preparation_ready", "awaiting_documents"]);
// The stages `vitally_private.act_close_case` accepts, plus the assisted draft
// nobody owns. Ready to exit and Ready to e-file are closable with the reason
// Withdrawn only (closeCase below); a filed and a closed case are absent.
const CLOSABLE_STAGES = Object.freeze([
  "received",
  "screening",
  "awaiting_documents",
  "on_hold",
  "preparation_ready",
  "preparing",
  "review_ready",
  "reviewing",
  "corrections_required",
  "rejected",
]);

// A case e-filed before filing methods existed has none on file and is treated
// as both returns e-filed (spec: "Admins record each return's filing result").
const unrecordedMethods = (record) =>
  record?.stage === "efiled" && !record?.federalMethod && !record?.stateMethod;

export const methodOf = (record, kind) =>
  record?.[`${kind}Method`] ?? (unrecordedMethods(record) ? "efile" : null);

// The returns filed and not yet answered, federal first.
export const waitingKinds = (record) =>
  unrecordedMethods(record)
    ? ["federal", "state"].filter((kind) => !record?.[`${kind}Result`])
    : waitingReturns(record);

const WAIT_FOR = Object.freeze({ federal: "the IRS's", state: "Pennsylvania's" });

/**
 * What one office persona may do, on one case and on the related records the
 * screen is showing. Every answer is `{allowed, reason}`: a refusal carries the
 * sentence to show, because an absent button explains nothing.
 *
 * @param {object} targets `{caseRecord, followup, request, item}` — whichever
 *   the caller is about to render. Each is optional; a decision about a target
 *   that was not supplied refuses rather than guessing.
 * @param {{id:string,name:string,capabilities:string[]}|null} person
 */
export function adminEligibility({ caseRecord, followup, request, item } = {}, person) {
  const record = caseRecord ?? {};
  const stage = record.stage;
  const id = person?.id ?? null;
  const capabilities = Array.isArray(person?.capabilities) ? person.capabilities : [];
  const has = (capability) => capabilities.includes(capability);

  // Persona first, then the capability: both are refused before any target is
  // inspected, so an ineligible persona learns nothing about the record.
  const gate = (capability) => {
    if (!id) return refused(NO_LINKED_VOLUNTEER);
    if (!has(capability)) return refused(NEEDS[capability]);
    return null;
  };

  const verifyIntake = () => {
    const stopped = gate("admin");
    if (stopped) return stopped;
    if (stage === "draft")
      return refused("The client has not sent this application yet.");
    if (stage !== "screening")
      return refused(
        stage === "received"
          ? "Screening starts when an admin opens the case."
          : record.intakeVerified
            ? "The screening checks are already recorded."
            : "The intake checks are recorded during screening, before preparation.",
      );
    return allowed;
  };

  const remind = () => {
    const stopped = gate("admin");
    if (stopped) return stopped;
    if (!isAvailableWork(record))
      return refused("A reminder is only for work nobody has claimed yet.");
    return allowed;
  };

  const closeCase = () => {
    const stopped = gate("admin");
    if (stopped) return stopped;
    if (stage === "closed") return refused("This case is already closed.");
    // Before filing only a withdrawal closes a case (the dialog offers just that reason).
    if (["review_approved", "ready_to_efile"].includes(stage)) return allowed;
    if (stage === "efiled") return refused("An approved case is not closed from here.");
    if (stage === "draft" && record.ownerUserId)
      return refused("A client's own draft is theirs to finish or leave.");
    if (stage !== "draft" && !CLOSABLE_STAGES.includes(stage))
      return refused("This case cannot be closed at this stage.");
    return allowed;
  };

  // At Waiting for documents, or a Hold that came from it, more can be asked.
  const documentsHold = stage === "on_hold" && holdKind(record) === "documents";

  const requestDocuments = () => {
    const stopped = gate("admin");
    if (stopped) return stopped;
    if (!ASK_STAGES.includes(stage) && !documentsHold)
      return refused("Documents are asked for during screening or before preparation is claimed.");
    return allowed;
  };

  const putOnHold = () => {
    const stopped = gate("admin");
    if (stopped) return stopped;
    if (stage === "on_hold") return refused("This case is already on hold.");
    if (stage !== "awaiting_documents" && stage !== "review_approved")
      return refused("A case is put on hold while it waits for documents or for the client to sign.");
    return allowed;
  };

  const resumeFromHold = () => {
    const stopped = gate("admin");
    if (stopped) return stopped;
    return stage === "on_hold" ? allowed : refused("Only a case on hold can be resumed.");
  };

  const markReadyToEfile = () => {
    const stopped = gate("admin");
    if (stopped) return stopped;
    if (stage !== "review_approved")
      return refused("This is recorded once the reviewer has approved the return.");
    // After a rejection the reviewer's conversation and the office's go-over
    // were done the first time; the client only signs again.
    if (returnedToSigning(record)) return allowed;
    // The reviewer's call with the client comes first, as the database checks.
    // A full case carries its reviews; a list row carries only reviewContactStatus.
    const call =
      record.reviewContactStatus ??
      (record.reviews ?? []).findLast((review) => review?.status === "approved")
        ?.clientContactStatus;
    if (call !== "completed")
      return refused("The reviewer still needs to record the conversation with the client.");
    // D13: then the office's go-over with the client, until that task is resolved.
    const goOverOpen =
      record.goOverOpen ??
      (record.followups ?? []).some(
        (f) => f?.purpose === "go_over_return" && f?.status === "open",
      );
    return goOverOpen
      ? refused("The office still needs to go over the return with the client.")
      : allowed;
  };

  const markEfiled = () => {
    const stopped = gate("admin");
    if (stopped) return stopped;
    return stage === "ready_to_efile"
      ? allowed
      : refused("This is recorded once the client has signed.");
  };

  const recordFilingResult = () => {
    const stopped = gate("admin");
    if (stopped) return stopped;
    if (stage === "efiled") return allowed;
    if (stage === "rejected")
      return waitingKinds(record).length
        ? allowed
        : refused("Every return already has its answer.");
    return refused("This is recorded once the return is e-filed.");
  };

  const returnToSigning = () => {
    const stopped = gate("admin");
    if (stopped) return stopped;
    if (stage !== "rejected")
      return refused("This is offered once a return has been rejected.");
    const waiting = waitingKinds(record);
    if (!waiting.length) return allowed;
    return refused(
      `Waiting for ${WAIT_FOR[waiting[0]]} answer before the return can go back to signing.`,
    );
  };

  // Starting an assisted application needs no case at all.
  const assistedIntake = () => gate("admin") ?? allowed;

  // The office contacts a client about one task. The assignment is the
  // server's (`ESCALATE_CONTACT` reads the workspace default), so there is no
  // assignee selector anywhere and no way to take a task from someone else.
  const followupWork = () => {
    const stopped = gate("followup");
    if (stopped) return stopped;
    if (!followup) return refused("This task is no longer on screen.");
    if (followup.assigneeId !== id)
      return refused("The office assigned this task to someone else.");
    if (followup.status !== "open")
      return refused(
        followup.status === "cancelled"
          ? "This task was cancelled when the case closed."
          : "This task is already resolved.",
      );
    return allowed;
  };

  const recordDocumentResponse = () => {
    const stopped = gate("receive_documents");
    if (stopped) return stopped;
    if (record.ownerUserId)
      return refused("This client has their own account, so they send it themselves.");
    if (!DOCUMENT_STAGES.includes(stage) && !documentsHold)
      return refused("A document is recorded while the case is being prepared.");
    if (!request) return refused("This request is no longer on screen.");
    if (request.status !== "open")
      return refused("This request is not waiting for a document.");
    return allowed;
  };

  const claimAssistance = () => {
    const stopped = gate("assist");
    if (stopped) return stopped;
    if (!item) return refused("This request is no longer on screen.");
    if (item.status !== "open")
      return refused(
        item.status === "assigned"
          ? "Someone is already helping with this request."
          : "This request is already resolved.",
      );
    return allowed;
  };

  const resolveAssistance = () => {
    const stopped = gate("assist");
    if (stopped) return stopped;
    if (!item) return refused("This request is no longer on screen.");
    // Ruling R23: the status decides first, and only then who is holding it.
    if (item.status !== "assigned")
      return refused(
        item.status === "open"
          ? "Claim this request before resolving it."
          : "This request is already resolved.",
      );
    if (item.assigneeId !== id)
      return refused("Only the helper holding this request resolves it.");
    return allowed;
  };

  const contact = followupWork();
  return {
    personId: id,
    isAdmin: has("admin"),
    canFollowup: has("followup"),
    canReceiveDocuments: has("receive_documents"),
    canAssist: has("assist"),
    verifyIntake: verifyIntake(),
    remind: remind(),
    closeCase: closeCase(),
    requestDocuments: requestDocuments(),
    putOnHold: putOnHold(),
    resumeFromHold: resumeFromHold(),
    markReadyToEfile: markReadyToEfile(),
    markEfiled: markEfiled(),
    recordFilingResult: recordFilingResult(),
    returnToSigning: returnToSigning(),
    assistedIntake: assistedIntake(),
    // One rule, two actions: the database checks the same capability, the same
    // assignment and the same open status for both.
    recordContact: contact,
    resolveFollowup: contact,
    recordDocumentResponse: recordDocumentResponse(),
    claimAssistance: claimAssistance(),
    resolveAssistance: resolveAssistance(),
  };
}

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

const outcomeOptions = (values) =>
  values.map((value) => [value, named(CONTACT_OUTCOME_LABELS, value, value)]);

export const openFollowups = (record) =>
  (record?.followups ?? []).filter((task) => task?.status === "open");

// A board row is a scalar Case and carries no follow-up records at all, so the
// count comes from the summary the presenter list attaches instead (Ruling
// R56). An opened case carries the records themselves and is counted from
// them, which is always the more exact of the two.
export const openFollowupCount = (record) =>
  Array.isArray(record?.followups)
    ? openFollowups(record).length
    : Number(record?.openFollowups ?? 0);

const requestById = (record, requestId) =>
  (record?.requests ?? []).find((entry) => entry?.id === requestId) ?? null;

// How this case started. A staff-entered case has no client account at all, and
// that is exactly how the database says so: `cases_origin_owner` (migration
// 001) allows a null owner only for an assisted case (040 dropped the sample origin). The Case the
// store maps carries no `origin` column, so the owner is what the browser
// reads — and only an explicit `null` means it, because a record that simply
// does not carry the field says nothing about who owns the case.
const assisted = (record) => record?.ownerUserId === null;
const clientOwned = (record) => Boolean(record?.ownerUserId);

const originRows = (record) =>
  `${detailRow(
    "How it started",
    assisted(record)
      ? "Assisted (staff-entered)"
      : clientOwned(record)
        ? "The client's own application"
        : "Not recorded on this record",
  )}${detailRow(
    "Client account",
    assisted(record)
      ? "No client account"
      : clientOwned(record)
        ? "The client signs in for themselves"
        : "Not recorded on this record",
  )}`;

// A reminder is recorded, never sent. The sentence appears exactly when a
// reminder really landed, because `lastRemindedAt` is what an accepted REMIND
// writes — so it can never announce a refused one.
export const remindedNote = (record) =>
  when(
    record?.lastRemindedAt,
    `<p class="staff-reason" role="status">${icon("clock")} Reminder recorded. No external message sent. Last reminded ${esc(
      formatTime(record?.lastRemindedAt),
    )}${when(record?.lastRemindedByName, ` by ${esc(record?.lastRemindedByName)}`)}.</p>`,
  );

// ---------------------------------------------------------------------------
// The office view of one case
// ---------------------------------------------------------------------------

function intakeChecksPanel(record, rights, ui) {
  const ticked = (key) => (ui.openPanels ?? []).includes(`intake-check-${key}`);
  const keys = screeningCheckKeys(record.answers?.service);
  const all = keys.every(ticked);
  const body = rights.verifyIntake.allowed
    ? `<form class="staff-form">${keys.map(
        (key) =>
          `<label class="checkbox-row small" for="${fieldId(key, "intake")}"><input type="checkbox" id="${fieldId(
            key,
            "intake",
          )}" name="${key}" value="true" ${ticked(key) ? "checked" : ""} data-action="toggle-intake-check" data-check="${key}"><span>${esc(
            SCREENING_CHECK_LABELS[key],
          )}</span></label>`,
      ).join("")}${caseSubmit(
        `${icon("shield")} Record the screening checks`,
        "VERIFY_INTAKE",
        "primary",
        `data-service="${esc(record.answers?.service ?? "")}" ${!all || ui.busy ? "disabled" : ""}`,
      )}${when(
        !all,
        '<p class="field-note">Tick every check before recording them.</p>',
      )}</form>${when(
        !ticked("documents") && rights.requestDocuments.allowed,
        `<p class="field-note">If the basic documents are not all here, ask the client for them.</p>${button(
          `${icon("file")} Ask for documents…`,
          "open-request-documents",
          "secondary",
          ui.busy ? "disabled" : "",
        )}`,
      )}`
    : explain(rights.verifyIntake);
  return `<section class="panel" aria-labelledby="checks-title"><div class="section-head"><h2 id="checks-title">Screening checks</h2><span class="badge ${
    record.intakeVerified ? "green" : "blue"
  }"><i></i>${record.intakeVerified ? "Recorded" : "Not recorded yet"}</span></div>${body}</section>`;
}

// An office draft is entered on the Add a case page, not here.
function continueInAddCase(record, rights) {
  const head = '<div class="section-head"><h2 id="assisted-case-title">The answers the office entered</h2></div>';
  return `<section class="panel" aria-labelledby="assisted-case-title">${head}${
    rights.assistedIntake.allowed
      ? `<p class="field-note">${esc("This walk-in client's answers are entered in Add a case.")}</p>${button(
          `${icon("arrow")} Continue in Add a case`,
          "continue-add-case",
          "primary",
          `data-case-id="${esc(record.id)}"`,
        )}`
      : explain(rights.assistedIntake)
  }</section>`;
}

function receiptPanel(record, person, ui) {
  const busy = ui.busy ? "disabled" : "";
  const requests = record.requests ?? [];
  const open = requests.filter((request) => request?.status === "open");
  const recorded = (record.documents ?? []).filter(
    (document) => document?.source === "staff_recorded",
  );
  const rights = adminEligibility(
    { caseRecord: record, request: open[0] ?? null },
    person,
  );
  const body = open.length
    ? open
        .map((request) => {
          const each = adminEligibility({ caseRecord: record, request }, person);
          return `<div class="request-card"><div class="section-head"><h3>${esc(
            request?.title,
          )}</h3><span class="badge blue"><i></i>${esc(
            named(REQUEST_STATUS, request?.status, "Requested"),
          )}</span></div><p>${esc(request?.message)}</p>${
            each.recordDocumentResponse.allowed
              ? caseButton(
                  `${icon("file")} Record sample document received`,
                  "RECORD_DOCUMENT_RESPONSE",
                  "primary",
                  `data-request-id="${esc(request.id)}" ${busy}`,
                )
              : explain(each.recordDocumentResponse)
          }</div>`;
        })
        .join("")
    : `${emptyLine("No document request on this case is waiting for a response.")}${when(
        !rights.recordDocumentResponse.allowed && requests.length,
        explain(rights.recordDocumentResponse),
      )}`;
  return `<section class="panel" aria-labelledby="receipt-title"><div class="section-head"><h2 id="receipt-title">Documents the office took in</h2></div><p class="field-note">Requesting a document and verifying one are the preparer's work, shown above; this is the office's own step. The office records a document it received in person for a client with no account. It is marked <strong>staff-recorded</strong> and stays <strong>awaiting preparer verification</strong>: taking delivery is not verifying, and it never changes the preparer. The one fictional file this demo accepts is <code>${esc(
    SAMPLE_DOCUMENT_FILENAME,
  )}</code>.</p>${when(
    recorded.length,
    `<ul class="document-list">${recorded
      .map(
        (document) =>
          `<li>${icon("file")} ${esc(document.filename)} <small>staff-recorded · ${esc(
            named(
              REQUEST_STATUS,
              requestById(record, document.requestId)?.status,
              "Requested",
            ),
          )} · ${esc(formatTime(document.createdAt))}</small></li>`,
      )
      .join("")}</ul>`,
  )}${body}</section>`;
}

// The two forms an assignee uses on an open task: the shared Log contact form,
// linked to the task, then Resolve. Shared by the case page's Follow-up tab
// and the office queue's Log contact drawer, so the two can never ask for
// different things; the Contacts tab draws the same form, unlinked.
export function followupForms(record, task, person, ui = {}) {
  const busy = ui.busy ? "disabled" : "";
  const rights = adminEligibility({ caseRecord: record, followup: task }, person);
  if (!rights.recordContact.allowed) return explain(rights.recordContact);
  const resolveScope = `resolve-${task?.id ?? "task"}`;
  const hidden = `<input type="hidden" name="followupId" value="${esc(task?.id ?? "")}">`;
  return `${logContactForm(record, person, ui, {
    followupId: task?.id ?? null,
    purpose: task?.purpose ?? null,
  })}<p class="field-note">Logging a contact never resolves the task, even when you reached the client. Resolving it is the separate step below.</p><form class="staff-form"><h4>Resolve this task</h4>${hidden}${select(
        "How it ended",
        "outcome",
        "",
        outcomeOptions(FOLLOWUP_RESOLUTION_OUTCOMES),
        "required",
        resolveScope,
      )}${textarea(
        "What the office concluded",
        "note",
        "",
        'required maxlength="1000" rows="2"',
        resolveScope,
      )}${caseSubmit(
        `${icon("check")} Resolve this task`,
        "RESOLVE_FOLLOWUP",
        "primary",
        `data-followup-id="${esc(task?.id ?? "")}" ${busy}`,
      )}<p class="field-note">Resolving closes the office's contact task only. It does not verify a document, change the preparer, or close the case.</p></form>`;
}

const GO_OVER_TITLE = "Go over the return with the client";

function followupTask(record, task, person, ui) {
  // A go-over task has no request (design D5): never look one up for it.
  const goOver = task?.purpose === "go_over_return";
  const request = goOver ? null : requestById(record, task?.requestId);
  const answered = when(
    task?.status === "open" && request?.status === "awaiting_verification",
    `<p class="field-note" role="status">${icon(
      "file",
    )} The client responded; awaiting preparer verification. Resolving this task does not verify the document.</p>`,
  );
  return `<li><div class="section-head"><h3>${esc(
    goOver ? GO_OVER_TITLE : (request?.title ?? "Contact the client"),
  )}</h3><span class="badge ${task?.status === "open" ? "amber" : "green"}"><i></i>${esc(
    named(FOLLOWUP_STATUS, task?.status, "Task"),
  )}</span></div><p>${esc(task?.reason)}</p>${detailRow(
    "Assigned to",
    task?.assigneeName ?? (task?.assigneeId ? UNKNOWN_PERSON : "Nobody"),
  )}${detailRow(
    "Raised",
    task?.createdAt ? formatTime(task.createdAt) : "—",
  )}${answered}<h4>Contacts so far</h4>${taskContacts(record, task)}${when(
    task?.resolutionNote,
    `<p class="field-note">${icon("check")} ${esc(
      named(CONTACT_OUTCOME_LABELS, task?.resolutionOutcome, "Resolved"),
    )} — ${esc(task.resolutionNote)}</p>`,
  )}${when(task?.status === "open", followupForms(record, task, person, ui))}</li>`;
}

function adminFollowupPanel(record, person, ui) {
  const tasks = record.followups ?? [];
  return `<section class="panel" aria-labelledby="office-followup-title"><div class="section-head"><h2 id="office-followup-title">Follow-up with the client</h2><span class="muted small">${esc(
    tasks.length,
  )} ${tasks.length === 1 ? "task" : "tasks"}</span></div><p class="field-note">The office raises a task when a preparer asks it to contact a client. ViTally assigns it; there is no way to hand it to someone else here.</p>${
    tasks.length
      ? `<ul class="followup-list">${tasks
          .map((task) => followupTask(record, task, person, ui))
          .join("")}</ul>`
      : emptyLine("No office follow-up has been raised on this case.")
  }</section>`;
}

function officeActionsPanel(record, rights, ui) {
  const busy = ui.busy ? "disabled" : "";
  return `<section class="panel" aria-labelledby="office-actions-title"><div class="section-head"><h2 id="office-actions-title">Office decisions</h2></div><h3>Reminder</h3><p class="field-note">${esc(
    OFFICE_NOTE,
  )} A reminder records a nudge so the next volunteer sees this case is waiting.</p>${remindedNote(
    record,
  )}${
    rights.remind.allowed
      ? caseButton(`${icon("clock")} Send a reminder`, "REMIND", "secondary", busy)
      : explain(rights.remind)
  }${when(
    rights.requestDocuments.allowed,
    `<h3>Documents</h3><p class="field-note">Ask the client for up to five documents. The case waits for them and the client is told.</p>${button(
      `${icon("file")} Ask for documents…`,
      "open-request-documents",
      "secondary",
      busy,
    )}`,
  )}${when(
    rights.putOnHold.allowed,
    `<h3>Hold</h3><p class="field-note">Put the case on hold while the office tries to reach the client. The client is told.</p>${button(
      `${icon("clock")} Put on hold…`,
      "open-put-on-hold",
      "secondary",
      busy,
    )}`,
  )}${when(
    rights.resumeFromHold.allowed,
    `<h3>Hold</h3><p class="field-note">${esc(
      holdKind(record) === "signing"
        ? "The office could not reach the client to sign."
        : "The office could not reach the client about documents.",
    )} Record when the office gets in touch.</p>${button(
      `${icon("phone")} Got in touch…`,
      "open-resume-from-hold",
      "primary",
      busy,
    )}`,
  )}${when(
    record.stage === "review_approved",
    `<h3>Signing</h3><p class="field-note">Record that the client signed. The client is told.</p>${
      rights.markReadyToEfile.allowed
        ? button(
            `${icon("check")} Mark ready to e-file…`,
            "open-mark-ready-to-efile",
            "primary",
            busy,
          )
        : explain(rights.markReadyToEfile)
    }`,
  )}${when(
    record.stage === "ready_to_efile",
    `<h3>E-file</h3><p class="field-note">Record that the return was e-filed. The client is told.</p>${
      rights.markEfiled.allowed
        ? button(`${icon("check")} Mark e-filed…`, "open-mark-efiled", "primary", busy)
        : explain(rights.markEfiled)
    }`,
  )}${when(
    record.stage === "efiled" ||
      (record.stage === "rejected" && rights.recordFilingResult.allowed),
    `<h3>Filing result</h3><p class="field-note">Record what the IRS or Pennsylvania answered for an e-filed return. This can't be undone.</p>${
      rights.recordFilingResult.allowed
        ? button(
            `${icon("check")} Record filing result…`,
            "open-record-filing-result",
            "primary",
            busy,
          )
        : explain(rights.recordFilingResult)
    }`,
  )}${when(
    record.stage === "rejected",
    `<h3>Return to signing</h3><p class="field-note">When the fix is done, the case goes back to Ready to exit for the client to sign again. The client is told.</p>${
      rights.returnToSigning.allowed
        ? button(
            `${icon("check")} Return to signing…`,
            "open-return-to-signing",
            "primary",
            busy,
          )
        : explain(rights.returnToSigning)
    }`,
  )}<h3>Close this case</h3><p class="field-note">Closing cancels the pending document requests and office tasks <strong>in ViTally</strong>. It does not cancel, withdraw or amend any return filed elsewhere, and it changes nothing at any tax authority.</p>${
    rights.closeCase.allowed
      ? button(
          `${icon("close")} Close this case…`,
          "open-close-case",
          "secondary",
          busy,
        )
      : explain(rights.closeCase)
  }</section>`;
}

/**
 * The close-case dialog's body. It lives here, with the rest of the office
 * screens, and `views.mjs` only places it in the shared modal frame.
 */
export function closeCaseDialogBody(state = {}) {
  const record = state.savedCase ?? {};
  // Before filing, the database accepts only the reason Withdrawn.
  const beforeFiling = ["review_approved", "ready_to_efile"].includes(record.stage);
  const reasons = beforeFiling ? ["withdrawn"] : CLOSING_REASONS;
  return confirmBody({
    lead: `Closing <strong>${esc(
      record.reference ?? "this case",
    )}</strong> for <strong>${esc(
      clientName(record),
    )}</strong> ends the office's work on it in ViTally. Its open document requests and office tasks are cancelled; their titles, reasons, notes and received documents stay exactly as they are.`,
    note: {
      icon: "shield",
      html: "This does not cancel, withdraw or amend any return filed elsewhere, and it changes nothing at any tax authority. The client is told the office closed the application, in words that fit the reason. They never see your note.",
    },
    form: {
      fields: `<fieldset class="close-reasons"><legend>Why the office is closing this case</legend>${
        beforeFiling
          ? '<p class="field-note">Before filing, a case can only be closed because the client withdrew.</p>'
          : ""
      }${reasons.map(
        (reason) => choice("close-reason", reason, CLOSING_REASON_NAMES[reason], "", "close"),
      ).join("")}</fieldset>${textarea(
        "Note for staff (required for Other)",
        "close-note",
        "",
        'maxlength="1000" rows="3"',
        "close",
      )}<label class="checkbox-row" for="${fieldId(
        "confirmed",
        "close",
      )}"><input type="checkbox" id="${fieldId(
        "confirmed",
        "close",
      )}" name="confirmed" value="true" required><span>I understand this closes the case for everyone.</span></label>`,
    },
    confirm: caseSubmit(
      `${icon("close")} Close this case`,
      "CLOSE_CASE",
      "primary full",
      state.busy ? "disabled" : "",
    ),
    keep: "Keep it open",
  });
}

const clientName = (record) =>
  [record?.answers?.tp_first_name, record?.answers?.tp_last_name]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(" ") || "this client";

/** The signing confirmation: the client is told it was signed. */
export function markReadyToEfileDialogBody(state = {}) {
  const record = state.savedCase ?? {};
  return confirmBody({
    before: demoFillButton(state.demoTools === true),
    lead: `Mark <strong>${esc(record.reference ?? "this case")}</strong> for <strong>${esc(
      clientName(record),
    )}</strong> as ready to e-file?`,
    note: {
      icon: "shield",
      html: `${
        returnedToSigning(record)
          ? "This is the client's second signing: the return was corrected after a rejection. "
          : ""
      }The client will be told PCDC recorded that their return is ready. This can't be undone.`,
    },
    form: {
      fields: `<label class="checkbox-row" for="${fieldId(
        "confirmed",
        "ready-efile",
      )}"><input type="checkbox" id="${fieldId(
        "confirmed",
        "ready-efile",
      )}" name="confirmed" value="true" required><span>The client signed Form 8879, or the return will be given to the client on paper.</span></label>`,
    },
    confirm: caseSubmit(
      `${icon("check")} Mark ready to e-file`,
      "MARK_READY_TO_EFILE",
      "primary full",
      state.busy ? "disabled" : "",
    ),
    keep: "Keep it as it is",
  });
}

// What the client is told when Mark e-filed lands (the migration's
// `efiled_line`, and the history table of the case-lifecycle spec). The dialog
// lists the line beside each choice, so the choice and its words are read together.
const FILED_LINES = Object.freeze({
  both_efile: "PCDC e-filed your return.",
  efile_and_paper:
    "PCDC e-filed your federal return and gave your Pennsylvania return on paper to you or the person you sent. If it isn't signed yet, sign it, then mail it yourself. A reply can take about 3 months after you mail it.",
  paper_and_efile:
    "PCDC gave your federal return on paper to you or the person you sent, and e-filed your Pennsylvania return. If the federal return isn't signed yet, sign it, then mail it yourself. A reply can take about 3 months after you mail it.",
  both_paper:
    "PCDC gave your returns on paper to you or the person you sent. If they aren't signed yet, sign them, then mail them yourself. A reply can take about 3 months after you mail them.",
  federal: Object.freeze({
    efile: "PCDC e-filed your federal return.",
    paper:
      "PCDC gave your federal return on paper to you or the person you sent. If it isn't signed yet, sign it, then mail it yourself. A reply can take about 3 months after you mail it.",
  }),
  state: Object.freeze({
    efile: "PCDC e-filed your Pennsylvania return.",
    paper:
      "PCDC gave your Pennsylvania return on paper to you or the person you sent. If it isn't signed yet, sign it, then mail it yourself. A reply can take about 3 months after you mail it.",
  }),
});

const RESULT_WORDS = Object.freeze({ accepted: "accepted", given_to_client: "on paper, given to the client" });
const ON_PAPER = "On paper (given to the client to mail)";

// One radio with the line the client will be told under it.
const choice = (name, value, label, line, scope) =>
  `<label class="checkbox-row" for="${fieldId(`${name}-${value}`, scope)}"><input type="radio" id="${fieldId(
    `${name}-${value}`,
    scope,
  )}" name="${name}" value="${value}" required><span>${esc(label)}${
    line ? `<br><small class="muted">The client will be told: ${esc(line)}</small>` : ""
  }</span></label>`;

// A first filing picks one of the four combinations. Filing again offers only
// the returns that were rejected, each e-filed or on paper, and lists every
// accepted return, and every return given to the client, as already done.
function efiledChoices(record) {
  const rejected = ["federal", "state"].filter((kind) => returnState(record, kind) === "rejected");
  if (!rejected.length)
    return [
      choice("filing-combination", "both_efile", "Both returns e-filed", FILED_LINES.both_efile, "efiled"),
      choice(
        "filing-combination",
        "efile_and_paper",
        "Federal e-filed, Pennsylvania on paper (given to the client to mail)",
        FILED_LINES.efile_and_paper,
        "efiled",
      ),
      choice(
        "filing-combination",
        "paper_and_efile",
        "Federal on paper (given to the client to mail), Pennsylvania e-filed",
        FILED_LINES.paper_and_efile,
        "efiled",
      ),
      choice(
        "filing-combination",
        "both_paper",
        "Both returns on paper (given to the client to mail)",
        FILED_LINES.both_paper,
        "efiled",
      ),
    ].join("");
  const done = ["federal", "state"]
    .filter((kind) => !rejected.includes(kind))
    .map((kind) => {
      const word = RESULT_WORDS[returnState(record, kind)] ?? "answered";
      return `<p class="field-note">${icon("check")} ${esc(
        kind === "federal" ? "Federal return" : "Pennsylvania return",
      )}: ${word}. Nothing to file again.</p>`;
    })
    .join("");
  const groups = rejected
    .map((kind) => {
      const title = kind === "federal" ? "Federal return" : "Pennsylvania return";
      const lines = rejected.length === 1;
      return `<fieldset class="filing-choice"><legend>${title} (rejected): how was it filed this time?</legend>${choice(
        `method-${kind}`,
        "efile",
        "E-filed",
        lines ? FILED_LINES[kind].efile : "",
        "efiled",
      )}${choice(`method-${kind}`, "paper", ON_PAPER, lines ? FILED_LINES[kind].paper : "", "efiled")}</fieldset>`;
    })
    .join("");
  const both =
    rejected.length === 2
      ? `<p class="field-note">The client will be told: ${esc(FILED_LINES.both_efile)} (both e-filed), ${esc(
          FILED_LINES.efile_and_paper,
        )} (federal e-filed, Pennsylvania on paper), ${esc(
          FILED_LINES.paper_and_efile,
        )} (federal on paper, Pennsylvania e-filed) or ${esc(FILED_LINES.both_paper)} (both on paper).</p>`
      : "";
  return `${done}${groups}${both}`;
}

/** The e-filed confirmation: how each return was filed, and what the client is told. */
export function markEfiledDialogBody(state = {}) {
  const record = state.savedCase ?? {};
  return confirmBody({
    before: demoFillButton(state.demoTools === true),
    lead: `Mark <strong>${esc(record.reference ?? "this case")}</strong> for <strong>${esc(
      clientName(record),
    )}</strong> as e-filed?`,
    note: {
      icon: "shield",
      html: "The client will be told how their return was filed, in the words beside your choice. This can't be undone.",
    },
    form: {
      fields: `${efiledChoices(record)}<label class="checkbox-row" for="${fieldId(
        "confirmed",
        "efiled",
      )}"><input type="checkbox" id="${fieldId(
        "confirmed",
        "efiled",
      )}" name="confirmed" value="true" required><span>Each return was e-filed, or given to the client on paper, as chosen above.</span></label>`,
    },
    confirm: caseSubmit(
      `${icon("check")} Mark e-filed`,
      "MARK_EFILED",
      "primary full",
      state.busy ? "disabled" : "",
    ),
    keep: "Keep it as it is",
  });
}

// One waiting e-filed return's answer: accepted or rejected, the date and, for
// a rejection, the code. A paper return has none: it was given to the client.
function resultFields(kind) {
  const options = [
    ["accepted", "Accepted"],
    ["rejected", "Rejected"],
  ];
  const title = kind === "federal" ? "Federal return" : "Pennsylvania return";
  const id = fieldId(`result-${kind}`, "filing");
  return `<fieldset class="filing-return"><legend>${title} (e-filed)</legend><label class="field" for="${id}"><span>Answer</span><select id="${id}" name="result-${kind}"><option value="">No answer yet</option>${options
    .map(([value, text]) => `<option value="${value}">${text}</option>`)
    .join("")}</select></label>${input(
    "Date of the answer",
    `date-${kind}`,
    "",
    "date",
    `max="${nowInput().slice(0, 10)}"`, // PCDC's today: no answer is dated later
    "filing",
  )}${input("Reject code (only if rejected)", `code-${kind}`, "", "text", 'maxlength="40"', "filing")}</fieldset>`;
}

/** The filing-result confirmation: what each waiting return is recorded as. */
export function recordFilingResultDialogBody(state = {}) {
  const record = state.savedCase ?? {};
  return confirmBody({
    before: demoFillButton(state.demoTools === true),
    lead: `Record the filing result for <strong>${esc(
      record.reference ?? "this case",
    )}</strong> for <strong>${esc(clientName(record))}</strong>?`,
    note: {
      icon: "shield",
      html: "Each e-filed return is recorded as accepted or rejected, with its date. A return left on No answer yet stays as it is. A rejection moves the case to Rejected at once. This can't be undone.",
    },
    form: {
      fields: `${waitingKinds(record)
        .map((kind) => resultFields(kind))
        .join("")}${textarea(
        "Fix note (only when a return is rejected): what needs fixing in TaxSlayer",
        "fix-note",
        "",
        'maxlength="1000" rows="3"',
        "filing",
      )}<label class="checkbox-row" for="${fieldId(
        "confirmed",
        "filing-result",
      )}"><input type="checkbox" id="${fieldId(
        "confirmed",
        "filing-result",
      )}" name="confirmed" value="true" required><span>These results are correct.</span></label>`,
    },
    confirm: caseSubmit(
      `${icon("check")} Record the result`,
      "RECORD_FILING_RESULT",
      "primary full",
      `data-stage="${esc(record.stage ?? "")}" ${state.busy ? "disabled" : ""}`,
    ),
    keep: "Keep it as it is",
  });
}

/** The return-to-signing confirmation: the client is told to sign again. */
export function returnToSigningDialogBody(state = {}) {
  const record = state.savedCase ?? {};
  return confirmBody({
    before: demoFillButton(state.demoTools === true),
    lead: `Return <strong>${esc(record.reference ?? "this case")}</strong> for <strong>${esc(
      clientName(record),
    )}</strong> to signing?`,
    note: {
      icon: "shield",
      html: "The client will be told: PCDC corrected your return. You need to sign it again. This can't be undone.",
    },
    form: {
      fields: `<label class="checkbox-row" for="${fieldId(
        "confirmed",
        "return-to-signing",
      )}"><input type="checkbox" id="${fieldId(
        "confirmed",
        "return-to-signing",
      )}" name="confirmed" value="true" required><span>The fix is done.</span></label>`,
    },
    confirm: caseSubmit(
      `${icon("check")} Return to signing`,
      "RETURN_TO_SIGNING",
      "primary full",
      state.busy ? "disabled" : "",
    ),
    keep: "Keep it as it is",
  });
}

const confirmRow = (name, scope, text) =>
  `<label class="checkbox-row" for="${fieldId(name, scope)}"><input type="checkbox" id="${fieldId(
    name,
    scope,
  )}" name="${name}" value="true" required><span>${esc(text)}</span></label>`;

/** Ask for documents: one to five requests, each a title and a message. */
export function requestDocumentsDialogBody(state = {}) {
  const record = state.savedCase ?? {};
  const rows = [1, 2, 3, 4, 5]
    .map(
      (n) =>
        `<fieldset class="request-row"><legend>Document ${n}${n === 1 ? "" : " (optional)"}</legend>${input(
          "Short title",
          `request-title-${n}`,
          "",
          "text",
          `${n === 1 ? "required " : ""}maxlength="120"`,
          "ask",
        )}${textarea(
          "What the client should send",
          `request-message-${n}`,
          "",
          'maxlength="2000" rows="2"',
          "ask",
        )}</fieldset>`,
    )
    .join("");
  return confirmBody({
    lead: `Ask <strong>${esc(clientName(record))}</strong> for documents on <strong>${esc(
      record.reference ?? "this case",
    )}</strong>?`,
    note: {
      icon: "shield",
      html: "The client sees each title and message and sends the documents themselves. The case waits at Waiting for documents until you verify every one. The client is told which documents PCDC asked for.",
    },
    form: { fields: rows },
    confirm: caseSubmit(
      `${icon("file")} Ask for these documents`,
      "REQUEST_DOCUMENTS_AT_INTAKE",
      "primary full",
      state.busy ? "disabled" : "",
    ),
    keep: "Keep it as it is",
  });
}

/** Put on hold: the office could not reach the client. The note is staff-only. */
export function putOnHoldDialogBody(state = {}) {
  const record = state.savedCase ?? {};
  return confirmBody({
    lead: `Put <strong>${esc(record.reference ?? "this case")}</strong> for <strong>${esc(
      clientName(record),
    )}</strong> on hold?`,
    note: {
      icon: "shield",
      html: "Use this when the office cannot reach the client. The client is told PCDC is trying to reach them. Your note stays with staff.",
    },
    form: {
      fields: `${textarea(
        "Note for staff (optional)",
        "hold-note",
        "",
        'maxlength="1000" rows="3"',
        "hold",
      )}${confirmRow("confirmed", "hold", "I understand the case goes on hold.")}`,
    },
    confirm: caseSubmit(
      `${icon("clock")} Put on hold`,
      "PUT_ON_HOLD",
      "primary full",
      state.busy ? "disabled" : "",
    ),
    keep: "Keep it as it is",
  });
}

/** Got in touch: the case returns to the stage the hold came from. */
export function resumeFromHoldDialogBody(state = {}) {
  const record = state.savedCase ?? {};
  return confirmBody({
    lead: `Record that the office got in touch with <strong>${esc(
      clientName(record),
    )}</strong> about <strong>${esc(record.reference ?? "this case")}</strong>?`,
    note: {
      icon: "shield",
      html: "The case goes back to the stage it was on before the hold. The client is told PCDC is working on their application again.",
    },
    form: {
      fields: confirmRow("confirmed", "resume", "The office got in touch with the client."),
    },
    confirm: caseSubmit(
      `${icon("phone")} Got in touch`,
      "RESUME_FROM_HOLD",
      "primary full",
      state.busy ? "disabled" : "",
    ),
    keep: "Keep it on hold",
  });
}

/**
 * One case, as the office sees it: what the client answered, the screening
 * checks, documents taken in at the desk, the contact tasks, and the two
 * office decisions, alongside the preparer and reviewer tabs, read-only, in
 * the same tabbed case page the preparer and reviewer use.
 *
 * @param {object} caseRecord a decorated staff Case (`decorateStaffCase`)
 * @param {object} ui `{person, busy, error, retryable, draftAnswers, openPanels, caseTab}`
 */
export function renderAdminCase(caseRecord, ui = {}) {
  const record = caseRecord ?? {};
  const view = ui ?? {};
  const person = view.person ?? null;
  const rights = adminEligibility({ caseRecord: record }, person);
  // The preparer's own rules still decide the preparation sections; an office
  // persona is refused there, in the preparer screen's own words.
  const staffRights = staffEligibility(record, person);
  const draftForOffice = record.stage === "draft" && assisted(record);
  const origin = `<section class="panel" aria-labelledby="origin-title"><div class="section-head"><h2 id="origin-title">How this case reached the office</h2></div>${originRows(
    record,
  )}<p class="field-note">${esc(OFFICE_NOTE)}</p></section>`;
  const openFollowups = (record.followups ?? []).filter((task) => task?.status === "open").length;
  const panels = [
    [
      "overview",
      "Overview",
      [
        origin,
        intakeChecksPanel(record, rights, view),
        draftForOffice ? continueInAddCase(record, rights) : "",
        receiptPanel(record, person, view),
        officeActionsPanel(record, rights, view),
        exitFormPanel(record),
        filingPanel(record),
        caseDetails(record),
      ].join(""),
    ],
    [
      "intake",
      "Intake answers",
      // An office draft is entered in Add a case, so its tab reads like any
      // case's.
      intakeAnswersTab(record, staffRights, view, person),
    ],
    [
      "documents",
      "Documents",
      `${documentChecklist(record, staffRights, view)}${documentsPanel(record, staffRights, view)}`,
    ],
    ["followup", "Follow-up", adminFollowupPanel(record, person, view)],
    ["contacts", "Contacts", contactsPanel(record, person, view)],
    ["history", "History", historyPanel(record, Array.isArray(record.internalHistory))],
  ];
  return [
    problemNotice(view),
    caseHeader(record, person, view.principal),
    caseTabs(panels, view.caseTab, {
      documents: (record.requests ?? []).length,
      followup: openFollowups,
      contacts: (record.contacts ?? []).length,
    }),
  ].join("");
}
