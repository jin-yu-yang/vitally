import {
  languageLabel,
  clientLanguages,
  languageFilterLabels,
  languageSummary,
  speaksLanguage,
  stepsFor,
  substepsFor,
  findSubstep,
  substepTitleOf,
  leadOf,
  substepQuestions,
  isVisible,
  missingToSubmit,
  MATERIALS_ITEMS,
} from "./intake-catalogue.mjs";
import { renderQuestion, formatAnswer, invalidAnswers, visibleSubsteps } from "./intake-form.mjs";
import { cardsFor, CARD_SUBSTEPS } from "./document-cards.mjs";
import { docCard, variantOf } from "./intake-views.mjs";
import { saveStatus, conflictForm } from "./client-views.mjs";
import {
  esc,
  icon,
  button,
  caseButton,
  stageBadge,
  textarea,
  clientNumberLabel,
  clientNumberTag,
  formatTime,
  languageCell,
  loadingLine,
  unloadedLine,
  emptyState,
  emptyLine,
  fieldId,
  confirmBody,
} from "./ui.mjs";
import {
  adminEligibility,
  taskContacts,
  followupForms,
  openFollowups,
  openFollowupCount,
  remindedNote,
  waitingKinds,
} from "./admin-views.mjs";
import { returnedToSigning, latestFixNote, holdKind, BEFORE_FILING_NOTICE_REASONS } from "./domain.mjs";
import {
  when,
  explain,
  detailRow,
  UNKNOWN_PERSON,
  stageWork,
  isAvailableWork,
  boardFilters,
  NO_LINKED_VOLUNTEER,
  materialsCard,
  staffEligibility,
} from "./staff-views.mjs";

// Sam's office screens that are not one case: the Follow-ups queue. Pure
// functions of records and one persona, exactly like `admin-views.mjs` — no
// state, no store, no timers, no DOM — and the same four conventions hold:
//
//   * workflow buttons carry `data-case-action` with a name from CASE_ACTIONS;
//   * assistance controls carry `data-assistance-action` with `data-item-id`;
//   * navigation, filters and dialogs carry `data-action`;
//   * a person who may not do something sees the reason, not a missing button.
//
// Nothing here sends a message: a reminder is recorded, never sent. Imports go
// one way only, from here into `admin-views.mjs`, never back.

export const QUEUE_KINDS = Object.freeze([
  ["intake", "Intake checks"],
  ["screening", "Screening"],
  ["documents", "Waiting for documents"],
  ["hold", "Hold"],
  ["withdrawn", "Withdrawn"],
  ["signing", "Signing"],
  ["efiling", "E-filing"],
  ["result", "Filing result"],
  ["rejected", "Rejected"],
  ["call", "Call the client"],
  ["help", "Help request"],
  ["unclaimed", "Unclaimed work"],
]);
const KIND_VALUES = Object.freeze(QUEUE_KINDS.map(([value]) => value));
const KIND_LABELS = Object.freeze(Object.fromEntries(QUEUE_KINDS));
const KIND_ICONS = Object.freeze({
  intake: "shield",
  screening: "clock",
  documents: "file",
  hold: "phone",
  withdrawn: "close",
  signing: "file",
  efiling: "check",
  result: "clock",
  rejected: "help",
  call: "phone",
  help: "help",
  unclaimed: "user",
});

const calendarDay = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
export function waitingDays(value, now = Date.now()) {
  const at = new Date(value ?? "");
  if (Number.isNaN(at.getTime())) return null;
  return Math.max(0, Math.round((calendarDay(new Date(now)) - calendarDay(at)) / 86_400_000));
}
export const waitingLabel = (days) =>
  days === null || days === undefined ? "—" : days === 0 ? "Today" : days === 1 ? "1 day" : `${days} days`;
// Amber at three days, red at five (the design's rule). The words carry the
// same fact, so the color is never the only signal.
const waitingTone = (days) => (days >= 5 ? "late" : days >= 3 ? "aging" : "");

// A Hold row, a Withdrawn row and a Rejected row are never coloured.
const NEVER_COLOURED = Object.freeze(["rejected", "hold", "withdrawn"]);
const rowTone = (row) =>
  NEVER_COLOURED.includes(row.kind) ? "" : waitingTone(row.days);

// The open withdrawal notice follow-ups of a case: a full record carries the
// follow-ups themselves, a list row only the count its summary attaches.
const isOpenNotice = (task) => task?.status === "open" && task?.purpose === "withdrawal_notice";
export const openWithdrawalNotices = (record) =>
  Array.isArray(record?.followups)
    ? record.followups.filter(isOpenNotice).length
    : Number(record?.openWithdrawalNotices ?? 0);
// The stored text of the case's first open notice: from the follow-ups, or the list summary.
const noticeReason = (record) =>
  Array.isArray(record?.followups)
    ? (record.followups.find(isOpenNotice)?.reason ?? null)
    : (record?.withdrawalNoticeReason ?? null);
// The tasks that are calls to the client: the notice is the office's own job.
const callTasks = (record) => Math.max(0, openFollowupCount(record) - openWithdrawalNotices(record));

export function followupQueue(cases = [], assistance = [], now = Date.now()) {
  const records = Array.isArray(cases) ? cases : [];
  const rows = [];
  for (const record of records) {
    // A sent application waits here until an admin opens it, which starts
    // screening; the stage, not the intake checks, says it is still new.
    if (record?.stage === "received")
      rows.push({ kind: "intake", record, item: null, draft: false, since: record.updatedAt });
    else if (record?.stage === "draft" && record?.ownerUserId === null)
      rows.push({ kind: "intake", record, item: null, draft: true, since: record.updatedAt });
    else if (record?.stage === "screening")
      rows.push({ kind: "screening", record, item: null, draft: false, since: record.updatedAt });
    else if (record?.stage === "awaiting_documents")
      rows.push({ kind: "documents", record, item: null, draft: false, since: record.updatedAt });
    else if (record?.stage === "on_hold")
      rows.push({ kind: "hold", record, item: null, draft: false, since: record.updatedAt });
    else if (record?.stage === "review_approved")
      rows.push({ kind: "signing", record, item: null, draft: false, since: record.updatedAt });
    else if (record?.stage === "ready_to_efile")
      rows.push({ kind: "efiling", record, item: null, draft: false, since: record.updatedAt });
    else if (record?.stage === "efiled")
      rows.push({ kind: "result", record, item: null, draft: false, since: record.updatedAt });
    else if (record?.stage === "rejected") {
      if (waitingKinds(record).length)
        rows.push({ kind: "result", record, item: null, draft: false, since: record.updatedAt });
      rows.push({ kind: "rejected", record, item: null, draft: false, since: record.updatedAt });
    }
    if (isAvailableWork(record))
      rows.push({ kind: "unclaimed", record, item: null, draft: false, since: record.updatedAt });
    if (callTasks(record))
      rows.push({ kind: "call", record, item: null, draft: false, since: record.updatedAt });
    if (openWithdrawalNotices(record))
      rows.push({ kind: "withdrawn", record, item: null, draft: false, since: record.updatedAt });
  }
  for (const item of Array.isArray(assistance) ? assistance : [])
    if (item?.status === "open" || item?.status === "assigned")
      rows.push({
        kind: "help",
        record: records.find((record) => record?.id === item?.caseId) ?? null,
        item,
        draft: false,
        since: item.createdAt,
      });
  return rows
    .map(({ since, ...row }) => ({ ...row, days: waitingDays(since, now) }))
    .sort(
      (a, b) =>
        (b.days ?? -1) - (a.days ?? -1) ||
        KIND_VALUES.indexOf(a.kind) - KIND_VALUES.indexOf(b.kind) ||
        String(a.record?.reference ?? "").localeCompare(String(b.record?.reference ?? "")),
    );
}

export function officeFilters(filters) {
  const kind = String(filters?.officeKind ?? "");
  return {
    kind: KIND_VALUES.includes(kind) ? kind : "all",
    language: boardFilters(filters).language,
  };
}

// A row's languages (design D6): the case's answers, or for a help request
// with no case, the request's own language text (a label maps to its code).
const rowLanguages = (row) => {
  const fromCase = clientLanguages(row.record?.answers);
  return fromCase.length ? fromCase : clientLanguages({ language: row.item?.language });
};
const inLanguage = (row, chosen) => speaksLanguage(rowLanguages(row), chosen.language);

export function queueCounts(rows, chosen) {
  const inScope = rows.filter((row) => inLanguage(row, chosen));
  return Object.fromEntries([
    ["all", inScope.length],
    ...KIND_VALUES.map((kind) => [kind, inScope.filter((row) => row.kind === kind).length]),
  ]);
}

// ---------------------------------------------------------------------------
// The Follow-ups page
// ---------------------------------------------------------------------------

const WAITS = Object.freeze({ federal: "the IRS's answer", state: "Pennsylvania's answer" });

// What a Filing result row is waiting for: an e-filed return's answer. A paper
// return is never waited for. A case filed on paper before that rule, with
// nothing e-filed, has no answer to wait for.
function resultText(record) {
  const waiting = waitingKinds(record);
  if (waiting.length === 2) return "Waiting for the IRS and Pennsylvania.";
  if (waiting.length === 1) return `Waiting for ${WAITS[waiting[0]]}.`;
  return "No e-filed return is waiting for an answer.";
}

function needed(row) {
  const { kind, record, item } = row;
  if (kind === "result") return esc(resultText(record));
  if (kind === "rejected") {
    const note = latestFixNote(record);
    return `${esc("Rejected: contact the client to fix and sign again.")}${when(note, `<small>${esc(note)}</small>`)}`;
  }
  if (kind === "intake")
    return esc(
      row.draft
        ? "The office started this one and has not sent it yet. Finish the answers and send it."
        : "New application: open it to start screening.",
    );
  if (kind === "screening") return esc("Finish screening.");
  if (kind === "documents") return esc("Waiting for the client's documents.");
  if (kind === "hold")
    return esc(
      holdKind(record) === "signing"
        ? "Can't reach the client to sign."
        : "Can't reach the client about documents.",
    );
  if (kind === "withdrawn")
    return esc(
      // An admin's close before filing stores its own sentence (withdrawn, or any other
      // reason from a signing hold). The client's own notice names the volunteer:
      // reviewer_id is set on a closed case with that notice only when the client
      // withdrew at Review in progress.
      BEFORE_FILING_NOTICE_REASONS.includes(noticeReason(record))
        ? noticeReason(record)
        : `The client withdrew; tell ${record.reviewerName ?? record.preparerName ?? "the volunteer"} to stop work.`,
    );
  if (kind === "signing")
    return esc(
      // A list row carries only the reviewer's call status, never the reviews.
      returnedToSigning(record)
        ? "Waiting for the client to sign again."
        : record.reviewContactStatus !== "completed"
          ? "Waiting for the reviewer's call with the client."
          : record.goOverOpen
            ? "Waiting for the office to go over the return with the client."
            : "Waiting for the client to sign.",
    );
  if (kind === "efiling") return esc("Ready to e-file.");
  if (kind === "unclaimed") return `${esc(stageWork(record.stage).work)}${remindedNote(record)}`;
  if (kind === "call") {
    const n = callTasks(record);
    const owed = record?.followupAssigneeNames ?? [];
    return `${esc(n)} open ${n === 1 ? "task" : "tasks"}${when(owed.length, ` · waiting on ${esc(owed.join(", "))}`)}`;
  }
  return `${esc(item?.title)}${when(item?.assigneeName, `<small>Helper: ${esc(item.assigneeName)}</small>`)}`;
}

function rowAction(row, person, ui) {
  const busy = ui.busy ? "disabled" : "";
  const { kind, record, item } = row;
  const id = esc(record?.id ?? "");
  if (kind === "intake" || kind === "screening")
    return button(
      `${icon("arrow")} ${row.draft ? "Finish and send" : "Open"}`,
      "open-case",
      "primary",
      `data-case-id="${id}"`,
    );
  if (kind === "documents" || kind === "hold") {
    // List rows: each button opens the case in place, then its confirmation.
    const rights = adminEligibility({ caseRecord: record }, person);
    const attrs = `data-case-id="${id}" ${busy}`;
    if (kind === "documents")
      return rights.putOnHold.allowed
        ? button(`${icon("clock")} Put on hold…`, "open-put-on-hold", "primary", attrs)
        : explain(rights.putOnHold);
    return `${
      rights.resumeFromHold.allowed
        ? button(`${icon("phone")} Got in touch…`, "open-resume-from-hold", "primary", attrs)
        : explain(rights.resumeFromHold)
    }${
      rights.closeCase.allowed
        ? button(`${icon("close")} Close…`, "open-close-case", "secondary", attrs)
        : explain(rights.closeCase)
    }`;
  }
  if (kind === "withdrawn") {
    // The notice is resolved in the Log contact drawer, which holds the
    // follow-up's Resolve form.
    return button(`${icon("check")} Resolve`, "open-log-call", "primary", `data-case-id="${id}" ${busy}`);
  }
  if (kind === "signing" || kind === "efiling") {
    // The rows are list rows: the marks open the case in place, then their
    // confirmation (app.mjs), so nothing here sends or changes anything.
    const rights = adminEligibility({ caseRecord: record }, person);
    const [decision, action, label] =
      kind === "signing"
        ? [rights.markReadyToEfile, "open-mark-ready-to-efile", "Mark ready to e-file…"]
        : [rights.markEfiled, "open-mark-efiled", "Mark e-filed…"];
    return decision.allowed
      ? button(`${icon("check")} ${label}`, action, "primary", `data-case-id="${id}" ${busy}`)
      : explain(decision);
  }
  if (kind === "result" || kind === "rejected") {
    const rights = adminEligibility({ caseRecord: record }, person);
    const [decision, action, label] =
      kind === "result"
        ? [rights.recordFilingResult, "open-record-filing-result", "Record filing result…"]
        : [rights.returnToSigning, "open-return-to-signing", "Return to signing…"];
    return decision.allowed
      ? button(`${icon("check")} ${label}`, action, "primary", `data-case-id="${id}" ${busy}`)
      : explain(decision);
  }
  if (kind === "unclaimed") {
    const rights = adminEligibility({ caseRecord: record }, person);
    return rights.remind.allowed
      ? caseButton(`${icon("clock")} Send a reminder`, "REMIND", "secondary", `data-case-id="${id}" ${busy}`)
      : explain(rights.remind);
  }
  if (kind === "call")
    return button(`${icon("phone")} Log contact`, "open-log-call", "primary", `data-case-id="${id}" ${busy}`);
  const rights = adminEligibility({ item }, person);
  if (item?.status === "open")
    return rights.claimAssistance.allowed
      ? `<button type="button" class="btn primary" data-assistance-action="CLAIM" data-item-id="${esc(item.id)}" ${busy}>${icon("user")} Take this request</button>`
      : explain(rights.claimAssistance);
  return rights.resolveAssistance.allowed
    ? button(`${icon("check")} Record as resolved`, "open-resolve-help", "secondary", `data-item-id="${esc(item.id)}" ${busy}`)
    : explain(rights.resolveAssistance);
}

function queueRow(row, person, ui) {
  const { kind, record, item } = row;
  // A help request can name a case this window's list doesn't hold; say so
  // rather than claiming there is no case.
  const client = record
    ? `${clientNumberTag(record)}<button class="board-reference" data-action="open-case" data-case-id="${esc(record.id)}">${esc(record.reference ?? "This case")}</button>${stageBadge(record.stage, "en", { record })}`
    : item?.caseId
      ? '<span class="muted">A case in this workspace</span>'
      : '<span class="muted">No case yet</span>';
  return `<tr class="queue-row" data-kind="${kind}"><td><span class="kind-pill ${kind}">${icon(KIND_ICONS[kind])} ${esc(KIND_LABELS[kind])}</span></td><th scope="row">${client}</th><td class="queue-needed">${needed(row)}</td><td>${languageCell(languageSummary(rowLanguages(row)))}</td><td>${esc(item?.contactPreference || "—")}</td><td class="queue-waiting ${rowTone(row)}">${esc(waitingLabel(row.days))}</td><td class="queue-action">${rowAction(row, person, ui)}</td></tr>`;
}

/**
 * The office queue: everything waiting on the office in one table, most urgent
 * first. Resolved help requests leave it on purpose; it lists work still to do.
 *
 * @param {object[]} cases      decorated Cases (`decorateStaffCase`)
 * @param {object[]} assistance `listAssistance()`, decorated with helper names
 * @param {object}   ui         `{person, filters, busy, now}`
 */
export function renderFollowups(cases = [], assistance = [], ui = {}) {
  const view = ui ?? {};
  if (view.list === "loading" || view.list === "failed")
    return `<section class="panel office-queue" aria-labelledby="office-queue-title"><div class="section-head"><div><h2 id="office-queue-title" tabindex="-1">Office queue</h2></div></div>${
      view.list === "loading" ? loadingLine("Loading cases…") : unloadedLine("The cases couldn't load.")
    }</section>`;
  const person = view.person ?? null;
  const chosen = officeFilters(view.filters);
  const rows = followupQueue(cases, assistance, view.now ?? Date.now());
  const counts = queueCounts(rows, chosen);
  const scoped = rows.filter((row) => inLanguage(row, chosen));
  const over3 = scoped.filter((row) => (row.days ?? 0) >= 3).length;
  const shown = scoped.filter((row) => chosen.kind === "all" || row.kind === chosen.kind);
  const languages = languageFilterLabels(rows.map(rowLanguages));

  const toggles = `<div class="board-filters"><div class="filter-group" role="group" aria-label="Task type">${[
    ["all", "All"],
    ...QUEUE_KINDS,
  ]
    .map(([value, label]) =>
      button(
        `${esc(label)} <span class="tab-count">${esc(counts[value])}</span>`,
        "set-board-filter",
        chosen.kind === value ? "chip selected" : "chip",
        `data-filter="officeKind" data-value="${value}" aria-pressed="${chosen.kind === value}"`,
      ),
    )
    .join("")}</div></div>`;

  const chips = `<div class="board-filters"><div class="filter-group" role="group" aria-label="Language">${[
    ["all", "Any language"],
    ...languages.map((value) => [value, value]),
  ]
    .map(([value, label]) =>
      button(
        esc(label),
        "set-board-filter",
        chosen.language === value ? "chip selected" : "chip",
        `data-filter="language" data-value="${esc(value)}" aria-pressed="${chosen.language === value}"`,
      ),
    )
    .join("")}</div></div>`;

  const kindOn = chosen.kind !== "all";
  const languageOn = chosen.language !== "all";
  // Each button undoes one filter. `clear-board-filters` would also wipe the
  // volunteer board's saved choices, so it is never used here.
  const empty = emptyState({
    icon: "check",
    text: kindOn || languageOn ? "Nothing here matches these filters." : "Nothing is waiting on the office right now.",
    actions: [
      when(kindOn, button("Show every task", "set-board-filter", "secondary", 'data-filter="officeKind" data-value="all"')),
      when(languageOn, button("Show all languages", "set-board-filter", "secondary", 'data-filter="language" data-value="all"')),
    ],
  });

  const table = `<div class="board-table-wrap"><table class="board-table queue-table"><thead><tr><th scope="col">Task</th><th scope="col">Client</th><th scope="col">What's needed</th><th scope="col">Language</th><th scope="col">Contact preference</th><th scope="col">Waiting</th><th scope="col"><span class="sr-only">Action</span></th></tr></thead><tbody>${shown
    .map((row) => queueRow(row, person, view))
    .join("")}</tbody></table></div>`;

  // The season-end close: for an admin, disabled (with its reason) when no
  // case is waiting for a signature.
  const waitingSignature = unsignedCases(cases).length;
  const seasonEnd = isAdminPerson(person)
    ? `<div class="season-end">${button(
        "Close unsigned cases…",
        "open-close-unsigned",
        "secondary",
        waitingSignature ? "" : 'disabled aria-describedby="close-unsigned-none"',
      )}${when(
        !waitingSignature,
        `<span class="muted small" id="close-unsigned-none">No case is waiting for a signature.</span>`,
      )}</div>`
    : "";

  return `<section class="panel office-queue" aria-labelledby="office-queue-title"><div class="section-head"><div><h2 id="office-queue-title" tabindex="-1">Office queue</h2> <span class="muted small">most urgent first</span></div><span class="muted small">${esc(counts.all)} open · ${esc(over3)} over 3 days</span></div>${seasonEnd}${toggles}${chips}${when(
    !person,
    `<p class="staff-reason" role="note">${icon("user")} ${esc(NO_LINKED_VOLUNTEER)} Until then this queue is read-only.</p>`,
  )}${shown.length ? table : empty}<p class="field-note board-note">Waiting turns amber at 3 days and red at 5. This queue shows workflow only: no taxpayer names, no addresses and no document contents.</p></section>`;
}

// ---------------------------------------------------------------------------
// Season end: close the cases that are still waiting for a signature
// ---------------------------------------------------------------------------

const isAdminPerson = (person) => Array.isArray(person?.capabilities) && person.capabilities.includes("admin");

/**
 * The cases the season-end close may take: Ready to exit, or on Hold from
 * Ready to exit. Oldest first, so the longest wait is at the top.
 */
export function unsignedCases(cases = []) {
  return cases
    .filter(
      (record) =>
        record?.stage === "review_approved" ||
        (record?.stage === "on_hold" && record?.holdOrigin === "review_approved"),
    )
    .sort((a, b) => String(a.updatedAt ?? "").localeCompare(String(b.updatedAt ?? "")));
}

/**
 * What the dialog lists, as one string: the case ids and revisions. When it
 * changes under an open dialog, the admin has not confirmed the new list.
 */
export const closeUnsignedListKey = (cases = []) =>
  unsignedCases(cases)
    .map((record) => `${record.id}:${record.revision}`)
    .join("|");

// "0 days", "1 day", "N days"; a missing date is a dash.
const unsignedWaiting = (days) => (days === null || days === undefined ? "—" : `${days} ${days === 1 ? "day" : "days"}`);

/** The dialog's heading, kept in step with the ticks. */
export const closeUnsignedHeading = (ticked, total) =>
  `Close ${ticked === total ? total : `${ticked} of ${total}`} ${
    total === 1 ? "case that is" : "cases that are"
  } waiting for a signature, as Dismissed?`;

const unsignedName = (record) =>
  [record?.answers?.tp_first_name, record?.answers?.tp_last_name]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(" ") || "—";

/**
 * The season-end confirmation. `state.cases` is the loaded list; `unticked`
 * names cases to draw unticked. The confirm button is drawn disabled: the page
 * script opens it once a case and the box are both ticked.
 */
export function closeUnsignedDialogBody(state = {}) {
  const list = unsignedCases(state.cases ?? []);
  const unticked = new Set(state.unticked ?? []);
  const ticked = list.filter((record) => !unticked.has(record.id)).length;
  const rows = list
    .map((record) => {
      const id = `close-unsigned-${esc(record.id)}`;
      const where = record.stage === "on_hold" ? "Hold" : "Ready to exit";
      return `<tr><td><input type="checkbox" id="${id}" name="caseId" value="${esc(record.id)}" data-revision="${esc(
        record.revision,
      )}" aria-label="Close ${esc(record.reference)}"${unticked.has(record.id) ? "" : " checked"}></td><th scope="row"><label for="${id}">${esc(
        record.reference,
      )}</label></th><td>${esc(unsignedName(record))}</td><td>${where}</td><td>${esc(
        unsignedWaiting(waitingDays(record.updatedAt, state.now ?? Date.now())),
      )}</td></tr>`;
    })
    .join("");
  const table = list.length
    ? `<div class="board-table-wrap"><table class="board-table"><thead><tr><th scope="col"><span class="sr-only">Close</span></th><th scope="col">Case</th><th scope="col">Client</th><th scope="col">Now</th><th scope="col">Waiting</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : `<p class="muted">No case is waiting for a signature.</p>`;
  return confirmBody({
    lead: list.length
      ? `<span id="close-unsigned-heading">${esc(closeUnsignedHeading(ticked, list.length))}</span>`
      : "",
    form: {
      attrs: 'class="staff-form" id="close-unsigned-form"',
      fields: `${table}<label class="checkbox-row" for="${fieldId("confirmed", "close-unsigned")}"><input type="checkbox" id="${fieldId(
        "confirmed",
        "close-unsigned",
      )}" name="confirmed" value="true" required><span>${esc(
        "These clients didn't come back to sign. None of these returns will be transmitted in TaxSlayer.",
      )}</span></label>`,
    },
    confirm: `<button type="submit" class="btn primary full" id="close-unsigned-submit" disabled>${icon("check")} Close as Dismissed</button>`,
    keep: "Keep them open",
  });
}

// ---------------------------------------------------------------------------
// The two drawers: Log contact, and Resolve a help request
// ---------------------------------------------------------------------------

// The one announcement of a failure while a drawer is open (pitfall 8): the
// page banner steps aside, so its two controls live here instead — in every
// branch of both drawers, or a failure would be announced nowhere.
const drawerError = (ui) =>
  ui?.error
    ? `<div class="notice error" role="alert" id="drawer-error">${icon("help")}<div><h3>${esc(
        ui.error.code === "CONFLICT" ? "This case changed while you were working" : "That did not go through",
      )}</h3><p>${esc(ui.error.message)}</p><div class="conflict-choices">${when(
        ui.retryable,
        button("Try again", "retry-action", "secondary"),
      )}${button("Dismiss", "dismiss-error", "text")}</div></div></div>`
    : "";

/**
 * The Log contact drawer: every open follow-up task on one case, each with its
 * contacts so far and the same two forms the case page's Follow-up tab uses.
 * (Its name and dialog key, `log-call`, are internal and stay.)
 *
 * @param {object} args `{record, person, ui, caseId}` — `record` is the loaded
 *   case, decorated (`decorateStaffCase`); `caseId` is the case the drawer was
 *   opened for, so a different or missing case is never shown in its place.
 */
export function logCallDrawerBody({ record, person, ui = {}, caseId } = {}) {
  if (!record || record.id !== caseId)
    return `${drawerError(ui)}<p>This case could not be opened. Close this and try again.</p>${button("Close", "close-dialog", "secondary")}`;
  const tasks = openFollowups(record);
  const head = `<div class="drawer-case">${esc(clientNumberLabel(record))} · ${esc(record.reference)} ${stageBadge(record.stage, "en", { record })}${button("Open the case", "open-case", "text", `data-case-id="${esc(record.id)}"`)}</div>`;
  if (!tasks.length)
    return `${head}${drawerError(ui)}${emptyLine("No open follow-up is left on this case.")}${button("Close", "close-dialog", "secondary")}`;
  return `${head}${drawerError(ui)}${tasks
    .map(
      (task) =>
        `<section class="drawer-task"><h3>${esc(task.reason)}</h3>${detailRow("Assigned to", task.assigneeName ?? UNKNOWN_PERSON)}<h4>Contacts so far</h4>${taskContacts(record, task)}${followupForms(record, task, person, ui)}</section>`,
    )
    .join("")}`;
}

/**
 * The Resolve a help request drawer: one assigned request, resolved with a
 * note, exactly as the office's old assistance card resolved it.
 *
 * @param {object} args `{item, person, ui}` — `item` decorated with its helper.
 */
export function resolveHelpDrawerBody({ item, person, ui = {} } = {}) {
  if (!item || item.status !== "assigned")
    return `${drawerError(ui)}<p>This request is no longer open.</p>${button("Close", "close-dialog", "secondary")}`;
  const busy = ui?.busy ? "disabled" : "";
  const rights = adminEligibility({ item }, person);
  const resolve = rights.resolveAssistance.allowed
    ? `<form class="staff-form">${textarea(
        "What you helped with",
        "note",
        "",
        'required maxlength="1000" rows="3"',
        `assist-${item.id}`,
      )}<button type="submit" class="btn primary" data-assistance-action="RESOLVE" data-item-id="${esc(
        item.id,
      )}" ${busy}>${icon("check")} Record this as resolved</button></form>`
    : explain(rights.resolveAssistance);
  return `<h3>${esc(item.title)}</h3>${drawerError(ui)}${detailRow("Language", languageLabel(item.language))}${detailRow(
    "Contact preference",
    item.contactPreference,
  )}<p class="field-note">Helping a client with their own forms is separate from preparing a return: resolving a request changes nothing about the case's intake, stage or preparer.</p>${resolve}`;
}

// ---------------------------------------------------------------------------
// The Add a case page (spec 2026-09-30 §4.2, as revised by
// 2026-10-04 §10): each step a heading, one accordion per visible question
// sub-step under it, and one Documents accordion. The page draws from the
// controller's draft; `app.mjs` reads it back with the renderer's own readers.
// ---------------------------------------------------------------------------

const STEPS_V2 = stepsFor(2);
const SUBSTEPS_V2 = substepsFor(2);
// The client's numbering: "Before you start" is unnumbered, then 1–9.
const NUMBERED_V2 = STEPS_V2.filter((step) => step.id !== "before").map((step) => step.id);
const stepHeading = (step) => {
  const n = NUMBERED_V2.indexOf(step.id) + 1;
  return n > 0 ? `${n}. ${step.title?.en ?? ""}` : (step.title?.en ?? "");
};
const dashedId = (id) => String(id).replace(/\./g, "-");
const inVariant = (text, variant) => text?.[variant]?.en ?? text?.general?.en ?? "";
const SUMMARY_LIMIT = 140;

/**
 * The parts of a version-2 office draft (its visible question sub-steps, in
 * catalogue order), each with whether it counts: it holds a required visible
 * unanswered question or an invalid answer. Shared with `app.mjs`, which
 * repaints the count and the statuses in place while the office types.
 */
export function addCaseParts(draft = {}) {
  const answers = draft ?? {};
  const missing = missingToSubmit(2, answers).map((id) => id.replace(/\[.*$/, ""));
  return visibleSubsteps(answers, [])
    .filter((id) => findSubstep(id)?.kind === "questions")
    .map((id) => {
      const ids = new Set(findSubstep(id).questions);
      return { id, needs: missing.some((missed) => ids.has(missed)) || invalidAnswers(id, answers).length > 0 };
    });
}

/** The bottom bar's count of parts that still need answers. */
export function addCaseCountText(parts) {
  const n = parts.filter((part) => part.needs).length;
  return n === 0 ? "Every part is answered" : n === 1 ? "1 part still needs answers" : `${n} parts still need answers`;
}

/** A part's status, as the header button shows it open or closed. */
export const addCasePartStatus = (needs) =>
  needs ? { className: "is-needs", text: "Needs answers" } : { className: "is-none", text: "" };

// Send is off only until the box is ticked, and while anything is in flight
// (decision 2026-09-30, option a): missing answers never turn it off.
export const addCaseSendOff = ({ confirmed, busy, officeSaving }) => !confirmed || Boolean(busy) || Boolean(officeSaving);

const statusSpan = (id, needs) => {
  const status = addCasePartStatus(needs);
  return `<span id="add-sub-${esc(dashedId(id))}-status" class="add-sub-status ${status.className}">${esc(status.text)}</span>`;
};

// One accordion: its header button (title and status, open or closed), then
// its summary when closed or its body when open. The body element is always
// there, so the button's aria-controls names a real element.
function accordion(id, title, { open, needs, summary = "", body = "" }) {
  const key = esc(dashedId(id));
  const toggle = `<h3 class="add-sub-head"><button type="button" class="add-sub-toggle" data-action="toggle-add-substep" data-substep="${esc(id)}" id="add-sub-${key}-toggle" aria-expanded="${open}" aria-controls="add-sub-${key}-body">${icon("expand")}<span class="add-sub-title">${esc(title)}</span>${statusSpan(id, needs)}</button></h3>`;
  return `<div class="add-sub" data-substep="${esc(id)}">${toggle}${open ? "" : summary}<div id="add-sub-${key}-body" class="add-sub-body"${open ? "" : " hidden"}>${open ? body : ""}</div></div>`;
}

// A closed part: the answers it holds, on one line.
function partSummary(id, answers, variant) {
  const text = substepQuestions(id)
    .filter((question) => isVisible(question, answers))
    .map((question) => formatAnswer(question, answers[question.id], { variant, lang: "en", answers }))
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map((value) => String(value).replace(/\s*\n\s*/g, ", "))
    .join(" · ");
  const line = !text ? "Nothing entered yet" : text.length > SUMMARY_LIMIT ? `${text.slice(0, SUMMARY_LIMIT - 1)}…` : text;
  return `<p class="add-sub-summary">${esc(line)}</p>`;
}

// An open part: its lead line, then its visible questions grouped by heading
// as on the client form. Section intros speak to the client, so they stay off.
function partBody(id, view) {
  const { answers, variant } = view;
  const groups = [];
  for (const question of substepQuestions(id)) {
    if (question.heading || !groups.length) groups.push({ heading: question.heading ?? null, questions: [] });
    groups.at(-1).questions.push(question);
  }
  const lead = leadOf(findSubstep(id), { variant, lang: "en", answers });
  return `${lead ? `<p class="q-lead">${esc(lead)}</p>` : ""}${groups
    .map((group) => ({ ...group, questions: group.questions.filter((question) => isVisible(question, answers)) }))
    .filter((group) => group.questions.length)
    .map(
      (group) =>
        `<div class="q-card">${group.heading ? `<h4 class="q-heading">${esc(inVariant(group.heading, variant))}</h4>` : ""}${group.questions
          .map((question) =>
            renderQuestion(question, answers[question.id], {
              scope: "office",
              variant,
              lang: "en",
              answers,
              showMissing: view.showMissing,
              revealed: view.revealed,
            }),
          )
          .join("")}</div>`,
    )
    .join("")}`;
}

// The Documents accordion: every card in full, whatever the service (spec
// 2026-10-04 §6.7), under the staff checklist's sub-step titles. The marks
// need a case to land on, so they wait for the first save.
function documentsBody(view) {
  const cards = cardsFor(view.answers, view.savedCase?.documentCards ?? []);
  // A conflict holds them too, as on the client's own cards.
  const off = view.busy || view.officeSaving || view.conflict || !view.savedCase ? " disabled" : "";
  const groups = CARD_SUBSTEPS.map((name) => {
    const mine = cards.filter((card) => card.substep === name);
    if (!mine.length) return "";
    const title = findSubstep(`documents.${name}`)?.title?.general?.en ?? name;
    return `<h4 class="add-docs-title">${esc(title)}</h4><div class="doc-list">${mine
      .map((card) => docCard(card, { links: false, off, office: true, answers: view.answers }))
      .join("")}</div>`;
  }).join("");
  return `${when(!view.savedCase, '<p class="field-note">Save the draft first to mark documents.</p>')}${groups}`;
}

function addStep(step, view) {
  let parts;
  if (step.id === "documents")
    parts = accordion("documents", step.title?.en ?? "Documents", {
      open: view.open.has("documents"),
      needs: false,
      body: view.open.has("documents") ? documentsBody(view) : "",
    });
  else
    parts = view.parts
      .filter((part) => findSubstep(part.id).step.id === step.id)
      .map((part) => {
        const open = view.open.has(part.id);
        return accordion(part.id, substepTitleOf(findSubstep(part.id), { variant: view.variant, answers: view.answers }), {
          open,
          needs: part.needs,
          summary: open ? "" : partSummary(part.id, view.answers, view.variant),
          body: open ? partBody(part.id, view) : "",
        });
      })
      .join("");
  if (!parts) return "";
  return `<section class="add-step" data-step-id="${esc(step.id)}" aria-labelledby="add-step-${esc(step.id)}-title"><h2 id="add-step-${esc(step.id)}-title">${esc(stepHeading(step))}</h2>${parts}</section>`;
}

// Before the first save there is no case to record materials on: the same
// eleven items, shown and disabled.
function materialsBeforeSave() {
  const boxes = MATERIALS_ITEMS.map(
    (item) =>
      `<label class="checkbox-row small" for="field-materials-${esc(item.id)}"><input type="checkbox" id="field-materials-${esc(item.id)}" name="received" value="${esc(item.id)}" disabled><span>${esc(item.label.en)}</span></label>`,
  ).join("");
  return `<section class="panel materials-card" aria-labelledby="materials-title"><div class="section-head"><h2 id="materials-title">Materials received</h2></div><fieldset class="check-group"><legend>Materials received</legend>${boxes}</fieldset><p class="staff-reason" role="note">${icon("lock")} Save the draft first to record materials.</p></section>`;
}

// Who started the case: the earliest event's actor, named from the roster.
function createdBy(record, people) {
  const first = [...(record.internalHistory ?? [])]
    .filter(Boolean)
    .sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")))[0];
  const id = first?.actorPersonId;
  return (id && (people ?? []).find((person) => person?.id === id)?.name) || "The office";
}

/**
 * The version-2 Add a case page: a new office draft (no case yet) or a saved
 * version-2 office draft. The frame in `views.mjs` holds the page's heading.
 *
 * @param {object} ui `{ person, busy, officeSaving, draftAnswers, savedCase,
 *   openAddSubsteps, openPanels, addCaseShowMissing, revealed, dirty,
 *   saveState, conflict, error, retryable, people, demoTools }`, `demoTools`
 *   (the demo-tools switch) adds the Fill fictional details pill, `savedCase` decorated
 *   (`decorateStaffCase`)
 */
export function renderAddCaseV2(ui = {}) {
  const view = ui ?? {};
  const person = view.person ?? null;
  const off = view.busy ? "disabled" : "";
  // The fill button is a demo tool: only a window with the switch on carries it.
  const pill = !view.demoTools
    ? ""
    : `<p class="fiction-pill">${icon("spark")} Fictional data only · ${button("Fill fictional details", "fill-assisted-intake", "text", off)}</p>`;
  const rights = adminEligibility({}, person);
  if (!rights.assistedIntake.allowed) return `${pill}${explain(rights.assistedIntake)}`;
  const record = view.savedCase ?? null;
  const answers = view.draftAnswers ?? {};
  const page = {
    answers,
    savedCase: record,
    busy: Boolean(view.busy),
    officeSaving: Boolean(view.officeSaving),
    conflict: Boolean(view.conflict),
    variant: variantOf(answers),
    parts: addCaseParts(answers),
    open: new Set(Array.isArray(view.openAddSubsteps) ? view.openAddSubsteps : []),
    showMissing: Boolean(view.addCaseShowMissing),
    revealed: new Set(view.revealed ?? []),
  };
  const confirmed = (view.openPanels ?? []).includes("confirmed");
  const saving = page.busy || page.officeSaving;
  const reference = record?.reference ?? null;

  // The page's own two ways out carry ids, so closing the leave dialog puts
  // the keyboard back on the one that opened it, not on the sidebar's twin.
  const breadcrumb = `<nav aria-label="Breadcrumb" class="breadcrumb"><ol><li>${button("Work board", "open-board", "inline", 'id="add-case-to-board"')}</li><li aria-current="page">Add a case</li></ol></nav>`;
  const meta = `<div class="application-meta"><span>Application ID: ${reference ? esc(reference) : "assigned when you save"}</span><span>Draft · ${saveStatus(view)}</span></div>`;
  const form = `<form id="add-case-v2-form" class="add-case-steps" novalidate>${STEPS_V2.filter((step) => step.id !== "review")
    .map((step) => addStep(step, page))
    .join("")}</form>`;
  const info = `<section class="panel" aria-labelledby="add-case-info-title"><h2 id="add-case-info-title">Case info</h2>${detailRow(
    "Application ID",
    reference ?? "Assigned when you save",
  )}${detailRow("Stage", "Draft")}${detailRow("Created by", record ? createdBy(record, view.people) : (person?.name ?? ""))}${detailRow(
    "Created at",
    record ? formatTime(record.createdAt) : "When you save",
  )}</section>`;
  const materials = record
    ? materialsCard(record, staffEligibility(record, person), { busy: saving })
    : materialsBeforeSave();
  const side = `<aside class="add-case-side">${info}${materials}</aside>`;
  const bar = `<div class="add-case-bar">${button("Cancel", "open-board", "text", 'id="add-case-cancel"')}<p id="add-case-count" class="add-case-count" tabindex="-1">${esc(
    addCaseCountText(page.parts),
  )}</p>${button("Save draft", "save-office-draft", "secondary", saving ? "disabled" : "")}<div class="add-case-confirm"><label class="checkbox-row" for="field-confirmed"><input type="checkbox" id="field-confirmed" name="confirmed" ${
    confirmed ? "checked" : ""
  }><span>I have checked these answers with the client</span></label><p class="field-note">This confirms the answers on screen. It is not a signature on a tax or consent form.</p></div>${button(
    "Send to the office",
    "send-office-draft",
    "primary",
    `id="add-case-send"${addCaseSendOff({ confirmed, busy: page.busy, officeSaving: page.officeSaving }) ? " disabled" : ""}`,
  )}</div>`;
  // Another window saved this draft under unsaved edits: the shared choice,
  // whose two buttons the client's form already wires (reconcile-*).
  return `<div class="add-case-v2">${breadcrumb}${meta}${conflictForm(view)}${pill}<div class="add-case-layout">${form}${side}</div>${bar}</div>`;
}
