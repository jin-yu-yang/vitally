import {
  clientLanguages,
  languageOptions,
  languageSummary,
  speaksLanguage,
  serviceLabel,
  CONTACT_FIELDS,
  MATERIALS_ITEMS,
  canSeeContact,
  stepsFor,
  substepsFor,
  substepQuestions,
  findQuestion,
  wording,
  isVisible,
  findSubstep,
  substepTitleOf,
} from "./intake-catalogue.mjs";
import { formatAnswer, sendable } from "./intake-form.mjs";
import { cardsFor, CARD_SUBSTEPS } from "./document-cards.mjs";
import { serverAnswersV2, variantOf } from "./intake-views.mjs";
import {
  esc,
  icon,
  button,
  fieldId,
  caseButton,
  caseSubmit,
  input,
  textarea,
  select,
  stageBadge,
  formatTime,
  relativeDay,
  formatClientNumber,
  clientNumberLabel,
  clientNumberTag,
  languageCell,
  loadingLine,
  unloadedLine,
  confirmBody,
  emptyState,
  emptyLine,
} from "./ui.mjs";
import {
  describeStage,
  phaseTab,
  BOARD_TABS,
  returnedToSigning,
  holdKind,
  CLOSING_REASON_NAMES,
} from "./domain.mjs";
import { CONTACT_OUTCOMES } from "./case-actions.mjs";
import { shadedLabel, reviewRows, PREVIEW_WARNING } from "./shaded-fields.mjs";
import { SHADED_EDITOR, SHADED_UPLOAD } from "./contracts.mjs";
import {
  CONFIRMED_BY,
  CONFIRMED_METHODS,
  WENT_OVER_HOW,
  SIGN_METHODS,
  PA_FORGIVENESS,
  FILING_METHODS,
  RESULTS,
  REFUND_BY,
  OWE_BY,
  LOCAL_TYPES,
  todayIso,
  signDefault,
  goOverPrefill,
  changedAnswers,
} from "./questionnaires.mjs";
import { demoFillButton } from "./demo-fill.mjs";
import {
  CONTACT_DIRECTIONS,
  CONTACT_WITH,
  CONTACT_METHODS,
  CONTACT_PURPOSES,
  VOICE_OUTCOMES,
  WRITTEN_OUTCOMES,
  outcomesFor,
  contactTime,
  contactSummary,
  nyLocalInput,
  nowInput,
} from "./contact-log.mjs";

// The two staff screens for preparers and reviewers — the work board and the
// selected case — as pure functions. No state, no store, no timers, no DOM:
// each returns an HTML string, and every value that came from a person or from
// the database is escaped on the way out.
//
// Four conventions hold throughout:
//
//   * workflow buttons carry `data-case-action` with a name from CASE_ACTIONS,
//     and any related id in `data-request-id` / `data-followup-id`; forms put
//     that attribute on their submit button and name their fields after the
//     payload keys (`src/case-actions.mjs` turns the two into a payload);
//   * navigation and filters carry `data-action` and never become an action;
//   * stage words come from `describeStage` and names from `decorateStaffCase`
//     — this file invents neither;
//   * a person who may not do something sees the reason, not a missing button.
//     `staffEligibility` is the one place those rules live, so the board and
//     the case workspace can never disagree about who may act.
//
// There is no amount, refund, bank or routing field anywhere in this demo, so
// none is ever rendered: ViTally records the workflow, and the return itself
// lives in the tax software.
//
// The section renderers a second staff screen needs — the header, the answers
// summary, the requests/documents list and the history — are **exported** (the
// office workspace in `admin-views.mjs` imports them, Ruling R55). They are
// shared, not copied: one case can never describe itself two ways depending on
// which volunteer is looking at it. The same goes for the small vocabularies
// below and for `explain`, so a refusal reads the same on every screen.

export const when = (condition, html) => (condition ? html : "");
export const UNKNOWN_PERSON = "Unknown person";

// ---------------------------------------------------------------------------
// Vocabularies (stage words are never redefined here — see describeStage)
// ---------------------------------------------------------------------------

// What staff do next at each stage, and which technical qualification that work
// needs. This is the *staff* half of the stage table; the label and the client
// sentence stay in `describeStage`, which is the only place they exist.
const STAGE_WORK = Object.freeze({
  draft: { work: "Nothing yet. The client has not sent this application.", needs: null },
  received: { work: "The office starts screening when an admin opens the case.", needs: null },
  screening: { work: "The office is screening this application.", needs: null },
  awaiting_documents: { work: "The office is waiting for the client's documents.", needs: null },
  on_hold: { work: "The office is trying to reach the client.", needs: null },
  preparation_ready: {
    work: "Waiting for a preparer to claim it.",
    needs: "prepare",
  },
  preparing: {
    work: "Preparation in the tax software, document requests, then the hand-off to review.",
    needs: "prepare",
  },
  review_ready: {
    work: "Waiting for an independent reviewer to claim it.",
    needs: "review",
  },
  reviewing: {
    work: "The reviewer approves the work or asks for corrections.",
    needs: "review",
  },
  corrections_required: {
    work: "The preparer records the corrections and sends it back to review.",
    needs: "prepare",
  },
  review_approved: {
    work: "The reviewer records the conversation with the client; the office records the client's signature.",
    needs: "review",
  },
  ready_to_efile: { work: "The office e-files the return.", needs: null },
  efiled: { work: "The office records the answers from the IRS and Pennsylvania.", needs: null },
  rejected: {
    work: "A return was rejected. The site coordinator fixes it in TaxSlayer, and the office contacts the client.",
    needs: null,
  },
  accepted: {
    work: "The returns are accepted or given to the client on paper. Nothing more is needed here.",
    needs: null,
  },
  closed: { work: "Closed. Nothing further is recorded here.", needs: null },
});
const UNKNOWN_WORK = Object.freeze({ work: "Waiting on the office.", needs: null });
// A case sent back from Rejected is at the same stage as a freshly approved
// one, but the reviewer's conversation with the client is long done.
const RETURNED_TO_SIGNING_WORK = "The client signs again. The office then marks it ready to e-file.";
export const stageWork = (stage) =>
  Object.hasOwn(STAGE_WORK, stage ?? "") ? STAGE_WORK[stage] : UNKNOWN_WORK;

export const REQUEST_STATUS = Object.freeze({
  open: "Waiting for the client",
  awaiting_verification: "Received, not verified yet",
  verified: "Verified",
  cancelled: "Cancelled",
});

const REVIEW_STATUS = Object.freeze({
  active: "Open review",
  corrections_requested: "Corrections requested",
  approved: "Approved",
  superseded: "Superseded by a newer version",
});

export const FOLLOWUP_STATUS = Object.freeze({
  open: "Open with the office",
  resolved: "Resolved",
});

export const CONTACT_OUTCOME_LABELS = Object.freeze({
  no_answer: "No answer",
  reached: "Spoke with the client",
  no_further_contact: "Client wants no further contact",
  closure_requested: "Client asked to close the case",
});

export const named = (table, key, fallback = "—") =>
  Object.hasOwn(table, key ?? "") ? table[key] : fallback;

// The manual milestone wording, in one place: ViTally never prepares, signs or
// files anything — it records that a person did that work elsewhere.
const TAXSLAYER_NOTE =
  "ViTally records the milestone only. The return itself is prepared by hand in TaxSlayer.";

// ---------------------------------------------------------------------------
// Names (Ruling R49)
// ---------------------------------------------------------------------------

/**
 * Attach the display names a staff screen needs to one case record. The store
 * stays name-free — it returns person ids — so this is where ids become names,
 * once, before any renderer sees the record.
 *
 * An id with no matching person becomes "Unknown person" rather than an id on
 * screen. Sections the record does not carry (a board row has no follow-ups or
 * reviews) are not invented; only the names are added.
 *
 * @param {object} caseRecord a Case from the store
 * @param {Array<{id:string,name:string}>} people `listPeople()`
 */
export function decorateStaffCase(caseRecord, people = []) {
  if (!caseRecord) return caseRecord;
  const roster = Array.isArray(people) ? people : [];
  const nameOf = (id) =>
    id ? (roster.find((person) => person?.id === id)?.name ?? UNKNOWN_PERSON) : null;
  const decorated = {
    ...caseRecord,
    preparerName: nameOf(caseRecord.preparerId),
    reviewerName: nameOf(caseRecord.reviewerId),
    lastRemindedByName: nameOf(caseRecord.lastRemindedByPersonId),
    participantNames: (caseRecord.participants ?? []).map(
      (id) => nameOf(id) ?? UNKNOWN_PERSON,
    ),
  };
  // A board row carries the people who owe a call rather than the tasks
  // themselves (Ruling R56), and they get names here like everybody else.
  if (Array.isArray(caseRecord.followupAssigneeIds))
    decorated.followupAssigneeNames = caseRecord.followupAssigneeIds.map(
      (id) => nameOf(id) ?? UNKNOWN_PERSON,
    );
  if (Array.isArray(caseRecord.followups))
    decorated.followups = caseRecord.followups.map((followup) => ({
      ...followup,
      assigneeName: nameOf(followup?.assigneeId),
    }));
  if (Array.isArray(caseRecord.contacts))
    decorated.contacts = caseRecord.contacts.map((contact) => ({
      ...contact,
      loggedByName: nameOf(contact?.loggedByPersonId) ?? UNKNOWN_PERSON,
      versions: (contact?.versions ?? []).map((version) => ({
        ...version,
        editedByName: nameOf(version?.editedByPersonId) ?? UNKNOWN_PERSON,
      })),
    }));
  if (Array.isArray(caseRecord.reviews))
    decorated.reviews = caseRecord.reviews.map((review) => ({
      ...review,
      reviewerName: nameOf(review?.reviewerId),
    }));
  if (Array.isArray(caseRecord.materials))
    decorated.materials = caseRecord.materials.map((entry) => ({
      ...entry,
      recordedByName: nameOf(entry?.recordedByPersonId),
    }));
  if (Array.isArray(caseRecord.filingAttempts))
    decorated.filingAttempts = caseRecord.filingAttempts.map((attempt) => ({
      ...attempt,
      notes: (attempt?.notes ?? []).map((note) => ({
        ...note,
        recordedByName: nameOf(note?.recordedBy) ?? UNKNOWN_PERSON,
      })),
    }));
  if (Array.isArray(caseRecord.internalHistory))
    decorated.internalHistory = caseRecord.internalHistory.map((entry) => ({
      ...entry,
      actorName: nameOf(entry?.actorPersonId),
    }));
  return decorated;
}

// ---------------------------------------------------------------------------
// Eligibility — the one implementation the board and the case workspace share
// ---------------------------------------------------------------------------

const PREPARATION_WORK_STAGES = Object.freeze(["preparing", "corrections_required"]);
const UNSETTLED_REQUEST_STATUSES = Object.freeze(["open", "awaiting_verification"]);

export const NO_LINKED_VOLUNTEER = "This account isn't linked to a volunteer yet. Ask your site coordinator.";

export const CONTACT_NOT_SHOWN =
  "Contact details are shown to the office, and to the preparer and reviewer once the case is claimed.";
const MATERIALS_NOT_RECORDED =
  "Materials are recorded by the office, and by the preparer and reviewer once the case is claimed.";

const CARDS_NOT_MARKED =
  "Documents are marked by the office, and by the preparer and reviewer once the case is claimed.";

const allowed = { allowed: true, reason: "" };
const refused = (reason) => ({ allowed: false, reason });

/**
 * Who may do what on one case. Every answer is `{allowed, reason}`: a refusal
 * carries the sentence to show, because an absent button explains nothing.
 *
 * The order mirrors the database's check order (contracts §"validation order"):
 * stage, then participation, then the technical qualification, then the
 * assignment — so the browser and the server refuse for the same reason.
 *
 * Participation is read from `participants` when the record carries it. A board
 * row is a scalar Case and does not, so the current preparer is taken as the
 * known participant there; the database is the authority either way and answers
 * SELF_REVIEW to anything this cannot see.
 */
export function staffEligibility(caseRecord, person) {
  const record = caseRecord ?? {};
  const stage = record.stage;
  const id = person?.id ?? null;
  const capabilities = Array.isArray(person?.capabilities) ? person.capabilities : [];
  const canPrepare = capabilities.includes("prepare");
  const canReview = capabilities.includes("review");
  const participantIds = Array.isArray(record.participants)
    ? record.participants
    : record.preparerId
      ? [record.preparerId]
      : [];
  const participant = Boolean(id) && participantIds.includes(id);
  const isPreparer = Boolean(id) && record.preparerId === id;
  const isReviewer = Boolean(id) && record.reviewerId === id;
  const preparationAvailable = stage === "preparation_ready" && !record.preparerId;
  const reviewAvailable = stage === "review_ready" && !record.reviewerId;

  const claimPreparation = () => {
    if (!id) return refused(NO_LINKED_VOLUNTEER);
    if (stage !== "preparation_ready")
      return refused("This case is not waiting to be claimed for preparation.");
    if (record.preparerId)
      return refused("Another volunteer has already claimed preparation.");
    if (!canPrepare) return refused("Needs preparation eligibility.");
    return allowed;
  };

  const claimReview = () => {
    if (!id) return refused(NO_LINKED_VOLUNTEER);
    if (stage !== "review_ready")
      return refused("This case is not waiting for an independent reviewer.");
    if (record.reviewerId)
      return refused("Another volunteer has already claimed the review.");
    if (participant)
      return refused("You prepared this case, so you cannot review it.");
    if (!canReview) return refused("Needs review eligibility.");
    return allowed;
  };

  // Document work and both hand-offs: the case's current preparer, with the
  // participation the claim created.
  const preparationWork = () => {
    if (!id) return refused(NO_LINKED_VOLUNTEER);
    if (!PREPARATION_WORK_STAGES.includes(stage))
      return refused("Preparation work happens while this case is being prepared.");
    if (!canPrepare) return refused("Needs preparation eligibility.");
    if (!isPreparer)
      return refused(
        record.preparerId
          ? "Only this case's current preparer can do this work."
          : "Nobody has claimed preparation yet.",
      );
    return allowed;
  };

  const reviewDecision = () => {
    if (!id) return refused(NO_LINKED_VOLUNTEER);
    if (stage !== "reviewing")
      return refused("No review is open on this case right now.");
    if (participant)
      return refused("You prepared this case, so you cannot review it.");
    if (!canReview) return refused("Needs review eligibility.");
    if (!isReviewer)
      return refused("Only the assigned reviewer records a review decision.");
    return allowed;
  };

  const reviewContact = () => {
    if (!id) return refused(NO_LINKED_VOLUNTEER);
    if (stage !== "review_approved")
      return refused("The client conversation is recorded after the review is approved.");
    if (participant)
      return refused("You prepared this case, so you cannot review it.");
    if (!canReview) return refused("Needs review eligibility.");
    if (!isReviewer)
      return refused("Only the reviewer who approved this case records the conversation.");
    return allowed;
  };

  // Contact details and materials follow the database's works_on_case: office
  // staff on any case, a volunteer only as its preparer or reviewer.
  const seesContact = canSeeContact(record, person);
  const editContact = () => (seesContact ? allowed : refused(CONTACT_NOT_SHOWN));
  const recordMaterials = () => (seesContact ? allowed : refused(MATERIALS_NOT_RECORDED));

  // Document marks and moves (migration 018): the same people who see contact
  // details, on an open case. One rule under the two action names.
  const documentWork = () => {
    if (!seesContact) return refused(CARDS_NOT_MARKED);
    if (stage === "closed") return refused("This case is closed.");
    return allowed;
  };

  // The office verifies the documents it asked for at intake (Waiting for
  // documents, and a Hold that came from it); the preparer's loop is unchanged.
  const verifyIntakeDocument = () => {
    if (!id) return refused(NO_LINKED_VOLUNTEER);
    if (stage !== "awaiting_documents" && !(stage === "on_hold" && holdKind(record) === "documents"))
      return refused("Preparation work happens while this case is being prepared.");
    if (!capabilities.includes("admin")) return refused("Needs office administrator access.");
    return allowed;
  };

  return {
    personId: id,
    canPrepare,
    canReview,
    participant,
    isPreparer,
    isReviewer,
    preparationAvailable,
    reviewAvailable,
    claimPreparation: claimPreparation(),
    claimReview: claimReview(),
    preparationWork: preparationWork(),
    // The 13614-C shaded section (change add-preparer-13614c-fields, D4): the
    // same rule as the preparer's other work, as the database's
    // require_case_preparer and its two stages.
    shadedSection: preparationWork(),
    verifyIntakeDocument: verifyIntakeDocument(),
    reviewDecision: reviewDecision(),
    reviewContact: reviewContact(),
    seesContact,
    editContact: editContact(),
    recordMaterials: recordMaterials(),
    markDocumentCard: documentWork(),
    moveDocumentCard: documentWork(),
  };
}

/** Work nobody has taken: the two states a claim button exists for. */
export const isAvailableWork = (record) =>
  (record?.stage === "preparation_ready" && !record?.preparerId) ||
  (record?.stage === "review_ready" && !record?.reviewerId);

const unsettledRequests = (record) =>
  (record?.requests ?? []).filter((request) =>
    UNSETTLED_REQUEST_STATUSES.includes(request?.status),
  );

const openFollowupFor = (record, requestId) =>
  (record?.followups ?? []).find(
    (followup) =>
      requestId != null && followup?.requestId === requestId && followup?.status === "open",
  );

// A refusal, said plainly, where the button would have been.
export const explain = (decision, extra = "") =>
  `<p class="staff-reason" role="note">${icon("lock")} ${esc(decision.reason)}${when(extra, ` ${esc(extra)}`)}</p>`;

// ---------------------------------------------------------------------------
// The work board
// ---------------------------------------------------------------------------

export const DEFAULT_BOARD_FILTERS = Object.freeze({
  status: "available",
  assignment: "anyone",
  language: "all",
  service: "all",
  search: "",
});

const TAB_VALUES = Object.freeze(BOARD_TABS.map(([value]) => value));
const SCOPE_VALUES = Object.freeze(["anyone", "mine"]);

const mine = (record, personId) =>
  Boolean(personId) &&
  (record?.preparerId === personId || record?.reviewerId === personId);

// The board's choices with its own defaults filled in. A value saved by an
// older version of the board (`in_progress`, `unassigned`…) falls back to the
// default rather than hiding every case.
export function boardFilters(filters) {
  const chosen = { ...DEFAULT_BOARD_FILTERS, ...(filters ?? {}) };
  if (!TAB_VALUES.includes(chosen.status)) chosen.status = DEFAULT_BOARD_FILTERS.status;
  if (!SCOPE_VALUES.includes(chosen.assignment))
    chosen.assignment = DEFAULT_BOARD_FILTERS.assignment;
  chosen.search = String(chosen.search ?? "").trim();
  return chosen;
}

// Answers store codes ("drop_off"); they are compared, shown and grouped by
// their label, so a saved filter value, already a label, still matches. A
// client matches a language when they speak it, preferred or other.
const inLanguageAndService = (record, chosen) =>
  speaksLanguage(clientLanguages(record?.answers), chosen.language) &&
  (chosen.service === "all" || serviceLabel(record?.answers?.service ?? "") === serviceLabel(chosen.service));

// A query of digits (optionally after one "#") is a client number, matched
// exactly and only in the current season once the workspace has told us which
// that is (part 7 adds season changes). Anything else is an Application ID.
const CLIENT_NUMBER_QUERY = /^#?(\d+)$/;
export function matchesBoardSearch(record, search, currentSeason = null) {
  const query = String(search ?? "").trim();
  const number = CLIENT_NUMBER_QUERY.exec(query);
  if (number)
    return (
      record?.clientNumber === Number(number[1]) &&
      (currentSeason == null || record?.season === currentSeason)
    );
  return String(record?.reference ?? "").toUpperCase().includes(query.toUpperCase());
}

const onTab = (record, chosen, personId) =>
  phaseTab(record) === chosen.status &&
  (chosen.status === "available" || chosen.assignment === "anyone" || mine(record, personId));

/**
 * The records one set of choices leaves on screen. A search looks across every
 * stage, tab or no tab, so a volunteer can reopen a submitted, approved or
 * closed case by its Application ID.
 */
export function filterCases(cases = [], filters, person = null, currentSeason = null) {
  const chosen = boardFilters(filters);
  const personId = person?.id ?? null;
  const narrowed = cases.filter((record) => inLanguageAndService(record, chosen));
  return chosen.search
    ? narrowed.filter((record) => matchesBoardSearch(record, chosen.search, currentSeason))
    : narrowed.filter((record) => onTab(record, chosen, personId));
}

/** How many cases each tab would show with the other choices as they are. */
export function boardCounts(cases = [], filters, person = null, currentSeason = null) {
  const chosen = boardFilters(filters);
  return Object.fromEntries(
    TAB_VALUES.map((tab) => [
      tab,
      filterCases(cases, { ...chosen, status: tab, search: "" }, person, currentSeason).length,
    ]),
  );
}

const FILTER_GROUP_LABELS = Object.freeze({
  status: "Status",
  assignment: "Whose cases",
  language: "Language",
  service: "Service",
});

const filterChips = (name, options, current) =>
  `<div class="filter-group" role="group" aria-label="${esc(named(FILTER_GROUP_LABELS, name, "Filter"))}">${options
    .map(([value, label]) =>
      button(
        esc(label),
        "set-board-filter",
        current === value ? "chip selected" : "chip",
        `data-filter="${esc(name)}" data-value="${esc(value)}" aria-pressed="${current === value}"`,
      ),
    )
    .join("")}</div>`;

// Service comes from the records themselves, so a workspace with one service
// does not show filters for services nobody asked for. Languages use
// `languageOptions`.
const valueOptions = (cases, key, allLabel, labelOf) => [
  ["all", allLabel],
  ...[
    ...new Set(
      cases
        .map((record) => String(labelOf(record?.answers?.[key] ?? "")).trim())
        .filter(Boolean),
    ),
  ]
    .sort()
    .map((value) => [value, value]),
];

const SCOPES = Object.freeze([
  ["anyone", "Everyone"],
  ["mine", "Mine"],
]);
const EMPTY_TAB = Object.freeze({
  available: "Nothing to claim right now. New work appears here once the office has checked its intake.",
  preparation: "Nothing is waiting for preparation.",
  review: "Nothing is waiting for review.",
});

// A tab is a filter button: the same hook as every other board choice, with
// its count inside so a screen reader hears both.
function boardTabs(chosen, counts) {
  return `<div class="board-tabs" role="group" aria-label="Board tab">${BOARD_TABS.map(
    ([value, label]) => {
      const on = !chosen.search && chosen.status === value;
      return button(
        `${esc(label)} <span class="tab-count">${esc(counts[value])}</span>`,
        "set-board-filter",
        on ? "tab selected" : "tab",
        `data-filter="status" data-value="${value}" aria-pressed="${on}"`,
      );
    },
  ).join("")}</div>`;
}

function searchForm(chosen, ui = {}) {
  const value = ui.searchDraft !== undefined ? ui.searchDraft : chosen.search;
  return `<form id="board-search-form" class="board-search" role="search"><label class="sr-only" for="field-board-search">Find a client # or Application ID</label><input id="field-board-search" name="boardSearch" type="search" value="${esc(value)}" placeholder="Find a client # or Application ID" autocomplete="off"><button id="board-search-submit" class="btn secondary" type="submit">${icon("search")} Find</button>${when(
    chosen.search,
    button("Clear search", "set-board-filter", "text", 'data-filter="search" data-value=""'),
  )}</form>`;
}

const who = (id, name, personId) =>
  !id
    ? `<span class="unassigned">Unassigned</span>`
    : id === personId
      ? `<strong class="you">You</strong>`
      : esc(name ?? UNKNOWN_PERSON);

function boardRow(record, person, ui) {
  const rights = staffEligibility(record, person);
  const busy = ui.busy ? "disabled" : "";
  const id = esc(record.id);
  const actions = [];
  if (rights.claimPreparation.allowed)
    actions.push(caseButton(`${icon("play")} Claim`, "CLAIM_PREPARATION", "primary", `data-case-id="${id}" ${busy}`));
  else if (record?.stage === "preparation_ready") actions.push(explain(rights.claimPreparation));
  if (rights.claimReview.allowed)
    actions.push(caseButton(`${icon("check")} Claim review`, "CLAIM_REVIEW", "primary", `data-case-id="${id}" ${busy}`));
  else if (record?.stage === "review_ready") actions.push(explain(rights.claimReview));
  if (!rights.claimPreparation.allowed && !rights.claimReview.allowed)
    actions.push(button("Open", "open-case", "secondary", `data-case-id="${id}"`));
  const own = mine(record, person?.id);
  return `<tr class="board-row${own ? " own" : ""}"><th scope="row">${clientNumberTag(record)}<button class="board-reference" data-action="open-case" data-case-id="${id}">${esc(record.reference)}</button></th><td>${stageBadge(record.stage, "en", { record })}</td><td>${listPhone(record, person, "board-phone")}</td><td>${languageCell(languageSummary(clientLanguages(record?.answers)))}</td><td>${esc(serviceLabel(record?.answers?.service) || "—")}</td><td>${who(record.preparerId, record.preparerName, person?.id)}</td><td>${who(record.reviewerId, record.reviewerName, person?.id)}</td><td class="board-updated">${esc(record.updatedAt ? relativeDay(record.updatedAt, ui.now ?? Date.now()) : "No updates yet")}</td><td class="board-actions"><div class="board-row-actions">${actions.join("")}</div></td></tr>`;
}

// Your own rows first, otherwise in the order the store returned them.
const yoursFirst = (records, personId) =>
  [...records].sort((a, b) => Number(mine(b, personId)) - Number(mine(a, personId)));

/**
 * The volunteer work board: three tabs (spec 2026-09-28, section 5), a search
 * that reaches every stage, and one table of the cases the choices leave.
 *
 * @param {object[]} cases  decorated Cases (see `decorateStaffCase`)
 * @param {object[]} people `listPeople()`, used to resolve `ui.personId`
 * @param {object}   ui     `{person|personId, filters, busy, now, searchDraft}`
 */
export function renderStaffBoard(cases = [], people = [], ui = {}) {
  if (ui.list === "loading" || ui.list === "failed")
    return `<section class="panel staff-board" aria-labelledby="board-title"><div class="section-head"><h2 id="board-title">Work board</h2></div>${
      ui.list === "loading" ? loadingLine("Loading cases…") : unloadedLine("The cases couldn't load.")
    }</section>`;
  const roster = Array.isArray(people) ? people : [];
  const person = ui.person ?? roster.find((entry) => entry?.id === ui.personId) ?? null;
  const chosen = boardFilters(ui.filters);
  const shown = yoursFirst(filterCases(cases, chosen, person, ui.currentSeason ?? null), person?.id ?? null);
  const counts = boardCounts(cases, chosen, person, ui.currentSeason ?? null);
  const total = cases.length;
  const narrowed = chosen.language !== "all" || chosen.service !== "all";
  const emptyText = chosen.search
    ? `No case matches “${esc(chosen.search)}”.`
    : narrowed
      ? "Nothing on this tab matches these filters."
      : chosen.status !== "available" && chosen.assignment === "mine"
        ? `Nothing of yours is ${chosen.status === "preparation" ? "waiting for preparation" : "waiting for review"}.`
        : EMPTY_TAB[chosen.status];
  const body = shown.length
    ? `<div class="board-table-wrap"><table class="board-table"><thead><tr><th scope="col">Client</th><th scope="col">Stage</th><th scope="col">Phone</th><th scope="col">Language</th><th scope="col">Service</th><th scope="col">Preparer</th><th scope="col">Reviewer</th><th scope="col">Updated</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${shown
        .map((record) => boardRow(record, person, ui))
        .join("")}</tbody></table></div>`
    : emptyState({
        icon: "folder",
        text: emptyText,
        actions: [when(narrowed || chosen.search, button("Clear filters", "clear-board-filters", "secondary"))],
      });
  return `<section class="panel staff-board" aria-labelledby="board-title"><div class="section-head"><h2 id="board-title">${chosen.search ? "Search results" : "Work board"}</h2><span class="muted small" role="status">Showing ${esc(shown.length)} of ${esc(total)} ${total === 1 ? "case" : "cases"}</span></div>${searchForm(chosen, ui)}${boardTabs(chosen, counts)}<div class="board-filters">${when(
    !chosen.search && chosen.status !== "available",
    filterChips("assignment", SCOPES, chosen.assignment),
  )}${filterChips("language", languageOptions(cases, "Any language"), chosen.language)}${filterChips(
    "service",
    valueOptions(cases, "service", "Any service", serviceLabel),
    chosen.service,
  )}</div>${when(
    !person,
    `<p class="staff-reason" role="note">${icon("user")} ${esc(NO_LINKED_VOLUNTEER)} Until then this board is read-only.</p>`,
  )}${body}<p class="field-note board-note">${icon("lock")} This board shows workflow only: no taxpayer names, no addresses and no document contents. Submitted, approved and closed cases are not on these tabs; find one by its Application ID. Phone numbers stay masked: on cases you work on, hover over or tab to a number to see it.</p></section>`;
}

// ---------------------------------------------------------------------------
// The selected case
// ---------------------------------------------------------------------------

export const detailRow = (label, value) =>
  `<div class="detail-row"><span>${esc(label)}</span><strong>${esc(value || "—")}</strong></div>`;

// A row whose value is already HTML (built from escaped parts), such as a
// masked phone. `detailRow` keeps escaping its value.
export const htmlRow = (label, html) =>
  `<div class="detail-row"><span>${esc(label)}</span><strong>${html}</strong></div>`;

// A client phone on a staff screen (D5, DESIGN.md §8): always masked first.
// `allowed` is `canSeeContact`, the only rule. An allowed viewer reveals the
// number on hover or focus (CSS only); it is a text node, never an attribute,
// so screen readers read it. Anyone else gets the last four digits and a lock,
// and the full number never reaches the page. `id` (allowed only) lets a
// redraw put focus back, so a revealed number stays revealed. An empty phone
// reads "Not given", the contact card's wording; the answers panel never
// passes one here (its unanswered path says "Not answered").
export const PHONE_LOCKED = "Claim this case to see the full number";
const PHONE_QUESTION = findQuestion(2, "tp_phone");

export function phoneMask(value, allowed, id = "") {
  const full = formatAnswer(PHONE_QUESTION, value ?? "");
  if (!full) return esc("Not given");
  const digits = String(value).replace(/\D/g, "");
  const last = digits.length >= 4 ? digits.slice(-4) : "";
  const dots = `<span class="phone-dots" aria-hidden="true">(•••) •••-${last || "••••"}</span>`;
  if (!allowed) {
    const said = `${last ? `Ends in ${last}. ` : ""}${PHONE_LOCKED}.`;
    return `<span class="phone-mask is-locked" title="${esc(PHONE_LOCKED)}">${dots}<span class="sr-only">${esc(said)}</span>${icon("lock")}</span>`;
  }
  return `<span class="phone-mask"${id ? ` id="${esc(id)}"` : ""} tabindex="0">${dots}<span class="phone-full">${esc(full)}</span>${icon("eye")}</span>`;
}

// A client phone in a list: the work board and the case pool (D5). The case
// page's mask and its one rule, with a per-row id so a redraw puts focus back
// on a revealed number. An empty phone is "—" like any other empty list cell,
// not the contact card's "Not given".
export function listPhone(record, person, prefix) {
  if (!String(record?.phone ?? "").trim()) return "—";
  return phoneMask(record.phone, canSeeContact(record, person), `${prefix}-${record.id}`);
}

// A refused or interrupted action, said beside the work it belongs to rather
// than only in the page-wide banner — with the same two controls, so nothing is
// lost by announcing it here instead.
export function problemNotice(ui) {
  // The shaded section states its own failures in its panel: an upload's
  // beside the control, an editor that couldn't be opened above its tools.
  if (!ui?.error || ui.error.place === SHADED_UPLOAD || ui.error.place === SHADED_EDITOR) return "";
  return `<div class="notice error" role="alert">${icon("help")}<div><h3>${esc(
    ui.error.code === "CONFLICT"
      ? "This case changed while you were working"
      : "That step did not go through",
  )}</h3><p>${esc(ui.error.message)}</p><div class="conflict-choices">${when(
    ui.retryable,
    button("Try again", "retry-action", "inline"),
  )}${button("Dismiss", "dismiss-error", "inline")}</div></div></div>`;
}

// ---------------------------------------------------------------------------
// The case page frame (spec 2026-09-28, section 6)
// ---------------------------------------------------------------------------

export const CASE_TABS = Object.freeze([
  ["overview", "Overview"],
  ["intake", "Intake answers"],
  ["documents", "Documents"],
  ["followup", "Follow-up"],
  ["contacts", "Contacts"],
  ["history", "History"],
]);

/**
 * The case page's tabs, following the ARIA tab pattern (spec section 9).
 * Every panel is rendered and the inactive ones are `hidden`, so each control
 * keeps its id and hook wherever it lives. The wiring layer handles the keys.
 *
 * @param {Array<[string, string, string]>} panels `[key, label, html]`
 * @param {string} active the key to show; an unknown key shows the first
 * @param {Record<string, number>} counts optional count per key
 */
export function caseTabs(panels, active = "overview", counts = {}) {
  const current = panels.some(([key]) => key === active) ? active : panels[0][0];
  const tabs = panels
    .map(([key, label]) => {
      const on = key === current;
      const count = counts[key] ? ` <span class="tab-count">${esc(counts[key])}</span>` : "";
      return `<button type="button" role="tab" id="case-tab-${key}" aria-controls="case-panel-${key}" aria-selected="${on}" tabindex="${on ? 0 : -1}" class="case-tab${on ? " selected" : ""}" data-action="set-case-tab" data-value="${key}">${esc(label)}${count}</button>`;
    })
    .join("");
  const bodies = panels
    .map(
      ([key, , html]) =>
        `<div role="tabpanel" id="case-panel-${key}" aria-labelledby="case-tab-${key}" class="case-panel" tabindex="0"${key === current ? "" : " hidden"}>${html}</div>`,
    )
    .join("");
  return `<div class="case-tabs" role="tablist" aria-label="Case sections">${tabs}</div>${bodies}`;
}

// The main path through the stages after the client sends the application
// (a draft is not on it). Corrections are a loop back into preparation, so
// they show on the preparation step, marked as amendment. Accepted is the end
// of the path; Closed is drawn after it only for a closed case.
const LIFECYCLE = Object.freeze([
  "received",
  "screening",
  "preparation_ready",
  "preparing",
  "review_ready",
  "reviewing",
  "review_approved",
  "ready_to_efile",
  "efiled",
  "accepted",
]);

// The record, so that E-filed and Accepted carry the filing method's staff
// name. A bare stage name still works (a list row, a test).
export function lifecycleBar(subject) {
  const record = typeof subject === "string" ? { stage: subject } : (subject ?? {});
  const stage = record.stage;
  // Corrections loop back into preparation; a rejection loops back into
  // filing. Each shows on the step it returns to, marked as amendment.
  const correcting = stage === "corrections_required";
  const rejected = stage === "rejected";
  // Waiting for documents shows on the stage it was asked from; a Hold shows on
  // the stage it came from (Ready to exit, or the stage the documents were asked from).
  const held = stage === "awaiting_documents" || stage === "on_hold";
  const heldOn = !held
    ? null
    : stage === "awaiting_documents" || record.holdOrigin === "awaiting_documents"
      ? (record.documentsOrigin ?? null)
      : (record.holdOrigin ?? null);
  const amendStep = correcting ? "preparing" : rejected ? "efiled" : heldOn;
  const amendStage = correcting ? "corrections_required" : rejected ? "rejected" : stage;
  const closed = stage === "closed";
  const accepted = stage === "accepted";
  const steps = closed ? [...LIFECYCLE, "closed"] : LIFECYCLE;
  const at = steps.indexOf(amendStep ?? stage);
  return `<ol class="lifecycle" aria-label="Where this case is">${steps.map((step, index) => {
    // A case can be closed from any stage and nothing records which, so the
    // steps before Closed are neutral (neither done nor still to come); the
    // History tab shows the path it took. An accepted case has finished every
    // step, so none is current.
    const state = closed
      ? step === "closed" ? "current" : "neutral"
      : accepted
        ? "done"
        : at < 0 ? "todo" : index === at ? "current" : index < at ? "done" : "todo";
    const amend = !closed && amendStep !== null && step === amendStep;
    const label = describeStage(amend ? amendStage : step, "en", record).label;
    return `<li class="lifecycle-step ${state}${amend ? " amend" : ""}"${state === "current" ? ' aria-current="step"' : ""}><span class="lifecycle-dot"></span><span class="lifecycle-label">${esc(label)}</span></li>`;
  }).join("")}</ol>`;
}

const namePill = (role, id, name, personId) =>
  `<span class="name-pill"><small>${role}</small> ${who(id, name, personId)}</span>`;

// Who this window is: only a staff screen shows the case header, and a staff
// account is its own person, so it reads "Signed in as" (add-staff-identity,
// D9), or says the account has no volunteer behind it yet.
const whoThisWindowIs = (person, principal) => {
  const name = person?.name ?? principal?.personName;
  return name ? `Signed in as ${name}.` : NO_LINKED_VOLUNTEER;
};

export function caseHeader(record, person, principal = null) {
  return `<section class="panel staff-header" aria-labelledby="case-title"><div class="case-title-row"><h2 id="case-title" tabindex="-1">${esc(record.reference ?? "This case")}</h2><div class="case-client-number">${esc(record.clientNumber == null ? clientNumberLabel(record) : `Client ${formatClientNumber(record.clientNumber)}`)}</div>${stageBadge(record.stage, "en", { record })}<span class="case-people">${namePill("Preparer", record.preparerId, record.preparerName, person?.id)}${namePill("Reviewer", record.reviewerId, record.reviewerName, person?.id)}</span></div>${lifecycleBar(record)}<p class="field-note">${esc(
    whoThisWindowIs(person, principal),
  )}</p></section>`;
}

/** The facts the old header listed, kept as rows the story and office read. */
export function caseDetails(record) {
  const described = describeStage(record.stage, "en", record);
  return `<section class="panel case-details" aria-labelledby="details-title"><div class="section-head"><h2 id="details-title">Case details</h2></div>${detailRow("Stage", described.label)}${detailRow(
    "Preparation version",
    record.preparationVersion ? `Version ${record.preparationVersion}` : "Not prepared yet",
  )}${detailRow("Intake checks", record.intakeVerified ? "Recorded" : "Not recorded yet")}${detailRow(
    "Preparer",
    record.preparerName ?? (record.preparerId ? UNKNOWN_PERSON : "Unassigned"),
  )}${detailRow(
    "Reviewer",
    record.reviewerName ?? (record.reviewerId ? UNKNOWN_PERSON : "Unassigned"),
  )}${when(
    Array.isArray(record.participantNames),
    detailRow("Prepared by (all versions)", record.participantNames?.join(", ") || "Nobody yet"),
  )}${detailRow(
    "Last reminded",
    record.lastRemindedAt
      ? `${formatTime(record.lastRemindedAt)}${record.lastRemindedByName ? ` by ${record.lastRemindedByName}` : ""}`
      : "Not reminded yet",
  )}${detailRow("Updated", record.updatedAt ? formatTime(record.updatedAt) : "No updates yet")}</section>`;
}

// ---------------------------------------------------------------------------
// The Filing panel (change add-post-efiling-stages): every staff member who can
// open a case reads each filing's returns and its fix notes. A client record
// carries no `filingAttempts` at all, so the key is always read with a default.
// ---------------------------------------------------------------------------

const FILED_STAGES = Object.freeze(["efiled", "rejected", "accepted"]);
const RETURN_NAMES = Object.freeze({ federal: "Federal return", state: "Pennsylvania return" });
const METHOD_NAMES = Object.freeze({ efile: "E-filed", paper: "Paper" });
const RESULT_NAMES = Object.freeze({ accepted: "Accepted", rejected: "Rejected", given_to_client: "Given to the client" });

function filingReturnRow(entry) {
  const method = METHOD_NAMES[entry.method] ?? "—";
  // A paper return is given to the client at Mark e-filed: it has no answer and no date,
  // and one filed before that rule, with no result, reads the same.
  const paper = entry.method === "paper";
  const answer = paper
    ? RESULT_NAMES.given_to_client
    : entry.result
      ? RESULT_NAMES[entry.result]
      : "Waiting for an answer";
  const parts = [method, answer];
  if (entry.answeredOn && !paper) parts.push(entry.answeredOn);
  if (entry.rejectCode) parts.push(`Reject code ${entry.rejectCode}`);
  return detailRow(RETURN_NAMES[entry.returnKind] ?? "Return", parts.join(" · "));
}

// With no recorded attempts (a list-shaped record, or a case e-filed before
// filing methods existed), the returns come from the case itself.
function currentReturns(record) {
  const staged = record.stage === "efiled" && !record.federalMethod && !record.stateMethod;
  return ["federal", "state"]
    .map((kind) => {
      const method = record[`${kind}Method`] ?? (staged ? "efile" : null);
      if (!method) return null;
      const result = record[`${kind}Result`] ?? null;
      return { returnKind: kind, method, result, answeredOn: null, rejectCode: null };
    })
    .filter(Boolean);
}

export function filingPanel(record) {
  const attempts = record?.filingAttempts ?? [];
  if (!attempts.length && !FILED_STAGES.includes(record?.stage)) return "";
  const shown = attempts.length
    ? attempts
    : [{ attempt: 1, filedAt: null, returns: currentReturns(record), notes: [] }];
  const body = shown
    .map((filing) => {
      const notes = (filing.notes ?? [])
        .map(
          (entry) =>
            `<li class="fix-note"><p>${esc(entry.note)}</p><small class="muted">${esc(
              entry.recordedByName ?? UNKNOWN_PERSON,
            )}${entry.recordedAt ? ` · ${esc(formatTime(entry.recordedAt))}` : ""}</small></li>`,
        )
        .join("");
      return `<div class="filing-attempt"><h3>Filing ${esc(filing.attempt)}${
        filing.filedAt ? ` <small class="muted">filed ${esc(formatTime(filing.filedAt))}</small>` : ""
      }</h3>${(filing.returns ?? []).map(filingReturnRow).join("")}${when(
        notes,
        `<h4>Fix notes</h4><ul class="fix-notes">${notes}</ul>`,
      )}</div>`;
    })
    .join("");
  return `<section class="panel filing-panel" aria-labelledby="filing-title"><div class="section-head"><h2 id="filing-title">Filing</h2></div>${body}</section>`;
}

// The answers, read by step and sub-step.
export function answersPanel(record, { person } = {}) {
  return answersPanelV2(record, { showContact: canSeeContact(record, person) });
}

const CONTACT_QUESTION_IDS = new Set(Object.keys(CONTACT_FIELDS));
// The phones show masked to anyone (D5); best time and the note only to
// viewers who may see contact details.
const PHONE_QUESTION_IDS = new Set(["tp_phone", "sp_phone"]);
const NOT_SURE = "not_sure";
const withoutQuestionMark = (text) => text.replace(/\s*\?\s*$/, "");
const answerRow = (label, value, className = "", flag = "") =>
  `<div class="detail-row${className ? ` ${className}` : ""}"><span>${esc(label)}</span><strong>${esc(value)}${flag}</strong></div>`;
const notSureFlag = (text = "Not sure") =>
  `<span class="not-sure-flag">${icon("help")} ${esc(text)}</span>`;

// The rows of one question, and how many of its answers are "Not sure".
function answerRows(question, value, options) {
  if (question.type === "group") {
    const members = (Array.isArray(sendable(question, value)) ? sendable(question, value) : []).filter(
      (member) => member && typeof member === "object" && !Array.isArray(member),
    );
    const rows = [];
    let notSure = 0;
    for (const member of members) {
      const line = formatAnswer(question, [member], options);
      if (line === null) continue;
      const unsure = (question.fields ?? []).filter((field) => member[field.id] === NOT_SURE);
      notSure += unsure.length;
      rows.push(
        unsure.length
          ? answerRow(
              wording(question, options),
              line,
              "is-not-sure",
              notSureFlag(
                `Not sure: ${unsure.map((field) => withoutQuestionMark(wording(field, options))).join(", ")}`,
              ),
            )
          : answerRow(wording(question, options), line),
      );
    }
    if (rows.length) return { rows, notSure };
  }
  const text = formatAnswer(question, value, options);
  if (text === null) return { rows: [], notSure: 0, unanswered: true };
  return value === NOT_SURE
    ? { rows: [answerRow(wording(question, options), text, "is-not-sure", notSureFlag())], notSure: 1 }
    : { rows: [answerRow(wording(question, options), text)], notSure: 0 };
}

/**
 * A version-2 case's answers, read by step and sub-step (spec 2026-10-04 §10).
 * The contact questions show only when `showContact` (D5). Nothing here is
 * editable. "Not sure" is flagged with the words and an icon, and counted.
 */
export function answersPanelV2(record, { showContact = false } = {}) {
  const answers = serverAnswersV2(record);
  const variant = variantOf(answers);
  const options = { variant, lang: "en", answers };
  const substeps = substepsFor(2).filter((substep) => substep.kind === "questions");
  let notSure = 0;
  const steps = stepsFor(2)
    .map((step) => {
      const subs = substeps
        .filter((substep) => substep.step.id === step.id)
        .map((substep) => {
          const rows = substepQuestions(substep.id)
            .filter((question) => isVisible(question, answers))
            .filter((question) => showContact || PHONE_QUESTION_IDS.has(question.id) || !CONTACT_QUESTION_IDS.has(question.id))
            .flatMap((question) => {
              if (PHONE_QUESTION_IDS.has(question.id) && formatAnswer(question, answers[question.id]) !== null)
                return [
                  htmlRow(wording(question, options), phoneMask(answers[question.id], showContact, `answers-${question.id}`)),
                ];
              const read = answerRows(question, answers[question.id], options);
              notSure += read.notSure;
              if (read.unanswered)
                return question.required ? [answerRow(wording(question, options), "Not answered", "is-missing")] : [];
              return read.rows;
            });
          return rows.length
            ? `<div class="answers-sub"><h4>${esc(substepTitleOf(substep, { answers }))}</h4>${rows.join("")}</div>`
            : "";
        })
        .join("");
      return subs ? `<section class="answers-step"><h3>${esc(step.title?.en ?? "")}</h3>${subs}</section>` : "";
    })
    .join("");
  const count = notSure
    ? `<p class="not-sure-count">${icon("help")} ${notSure} ${notSure === 1 ? "answer is" : "answers are"} "Not sure". Ask about them at the interview.</p>`
    : "";
  return `<section class="panel answers-v2" aria-labelledby="answers-title"><div class="section-head"><h2 id="answers-title">What the client told us</h2></div><p class="wording-used">Wording used: ${variant === "senior" ? "Senior" : "Standard"}</p>${count}${steps}</section>`;
}

// ---------------------------------------------------------------------------
// The contact card and the materials card (Intake answers tab)
// ---------------------------------------------------------------------------

const tickBox = ({ id, name, value, label, checked, disabled, note = "" }) =>
  `<label class="checkbox-row small" for="${id}"><input type="checkbox" id="${id}" name="${name}" value="${esc(value)}"${checked ? " checked" : ""}${disabled ? " disabled" : ""}><span>${esc(label)}${note}</span></label>`;

/**
 * The contact details of a version-2 case. Phones are read-only; staff edit the
 * best time and the note only. `rights` is `staffEligibility(record, person)`
 * and `ui` is `{ busy, openPanels }`.
 */
export function contactCard(record, rights, ui = {}) {
  const head = '<div class="section-head"><h2 id="contact-title">Contact details</h2></div>';
  const contact = record?.contact ?? {};
  const seen = Boolean(rights?.seesContact);
  const phones = `${htmlRow("Phone", phoneMask(contact.phone, seen, "contact-phone"))}${htmlRow(
    "Spouse phone",
    phoneMask(contact.spousePhone, seen, "contact-spouse-phone"),
  )}`;
  if (!seen)
    return `<section class="panel contact-card" aria-labelledby="contact-title">${head}${phones}<p class="muted">${esc(CONTACT_NOT_SHOWN)}</p></section>`;
  const shown = (id, value) => formatAnswer(findQuestion(2, id), value) ?? "Not given";
  const open = (ui.openPanels ?? []).includes("edit-contact");
  const canEdit = Boolean(rights.editContact?.allowed);
  const times = findQuestion(2, "best_contact_time");
  const ticked = Array.isArray(contact.bestContactTime) ? contact.bestContactTime : [];
  const form = `<form id="contact-form" class="staff-form"><fieldset class="check-group"><legend>Best time to reach</legend>${times.options
    .map((option) =>
      tickBox({
        id: `field-contact-${option.value}`,
        name: "bestContactTime",
        value: option.value,
        label: option.label?.general?.en ?? option.value,
        checked: ticked.includes(option.value),
      }),
    )
    .join("")}</fieldset>${textarea(
    "Note",
    "bestContactNote",
    contact.bestContactNote ?? "",
    'maxlength="200" rows="2"',
    "contact",
  )}${caseSubmit("Save best time", "UPDATE_CONTACT", "primary", ui.busy ? "disabled" : "")}${button(
    "Cancel",
    "toggle-edit-contact",
    "secondary",
    'aria-expanded="true"',
  )}</form>`;
  return `<section class="panel contact-card" aria-labelledby="contact-title">${head}${phones}${detailRow(
    "Best time to reach",
    shown("best_contact_time", contact.bestContactTime),
  )}${detailRow("Note", shown("best_contact_note", contact.bestContactNote))}${when(
    canEdit && !open,
    button("Edit best time", "toggle-edit-contact", "secondary", 'aria-expanded="false"'),
  )}${when(canEdit && open, form)}</section>`;
}

/** The eleven materials, ticked once received. Everyone reads; `recordMaterials` saves. */
export function materialsCard(record, rights, ui = {}) {
  const may = Boolean(rights?.recordMaterials?.allowed);
  const received = new Map((record?.materials ?? []).map((entry) => [entry?.item, entry]));
  const boxes = MATERIALS_ITEMS.map((item) => {
    const entry = received.get(item.id);
    const note = entry
      ? ` <small class="material-recorded">Recorded${entry.recordedByName ? ` by ${esc(entry.recordedByName)}` : ""} · ${esc(formatTime(entry.receivedAt))}</small>`
      : "";
    return tickBox({
      id: `field-materials-${item.id}`,
      name: "received",
      value: item.id,
      label: item.label.en,
      checked: Boolean(entry),
      disabled: !may,
      note,
    });
  }).join("");
  return `<section class="panel materials-card" aria-labelledby="materials-title"><div class="section-head"><h2 id="materials-title">Materials received</h2></div><form id="materials-form" class="staff-form"><fieldset class="check-group"><legend>Materials received</legend>${boxes}</fieldset>${
    may
      ? caseSubmit("Save materials", "RECORD_MATERIALS", "primary", ui.busy ? "disabled" : "")
      : explain(rights?.recordMaterials ?? refused(MATERIALS_NOT_RECORDED))
  }</form></section>`;
}

// The draft 13614-C in three languages and the draft Form 14446 in English
// and 繁體 (spec 2026-10-04 §7.4; add-form-14446-consent). They reuse 4b2's
// `view-draft` wiring, which builds from the case's answers and contact fields.
const draftTools = () =>
  `<div class="summary-tools">${button("View Draft 13614-C", "view-draft", "secondary", 'data-form="en"')}${button(
    "简体中文版",
    "view-draft",
    "secondary",
    'data-form="zh-s" lang="zh-Hans"',
  )}${button("繁體中文版", "view-draft", "secondary", 'data-form="zh-t" lang="zh-Hant"')}${button(
    "View Draft Form 14446",
    "view-draft",
    "secondary",
    'data-draft="14446" data-form="en"',
  )}${button("繁體中文版", "view-draft", "secondary", 'data-draft="14446" data-form="zh-t" lang="zh-Hant"')}<p id="draft-ready" class="draft-ready" aria-live="polite"></p></div>`;

// The 13614-C shaded section (change add-preparer-13614c-fields, D7, D8):
// "Fill the shaded section" (the editor) with the download / upload tools
// always beside it, for the case's preparer while the case is being prepared,
// and why not otherwise. An upload's error and its "Saved" are said here,
// beside the control, and an editor that couldn't be opened is said here with
// Try again. The error is shown whoever's page this is, so it is never lost
// behind a refusal.
const EDITOR_BROWSERS =
  "The editor works in Chrome and Edge 125 or later, Firefox ESR or later, and Safari 18 or later. In any other browser, download the copy and upload it.";

const DOWNLOAD_NOTE = "Open it in Chrome or the free Adobe Acrobat Reader, not macOS Preview.";

export function shadedPanel(record, rights, ui = {}) {
  const decision = rights?.shadedSection ?? refused(NO_LINKED_VOLUNTEER);
  const error = ui?.error?.place === SHADED_UPLOAD ? ui.error : null;
  const editorError = ui?.error?.place === SHADED_EDITOR ? ui.error : null;
  const editorNotice = editorError
    ? `<div class="notice error" role="alert" id="shaded-editor-error">${icon("help")}<div><h3>The editor did not open</h3><p>${esc(
        editorError.message,
      )}</p><div class="conflict-choices">${when(ui.retryable, button("Try again", "retry-action", "inline"))}${button(
        "Dismiss",
        "dismiss-error",
        "inline",
      )}</div></div></div>`
    : "";
  const row = (record?.preparerShadedFields ?? [])[0] ?? null;
  const filled = Object.keys(row?.fields ?? {}).length;
  const summary = row ? `${filled} ${filled === 1 ? "field" : "fields"} filled` : "Nothing saved yet";
  const notice = error
    ? `<div class="notice error" role="alert" id="shaded-upload-error">${icon("help")}<div><h3>${
        // A download that failed (DRAFT) is not a save that failed.
        error.code === "DRAFT" ? "The copy was not downloaded" : "The filled copy was not saved"
      }</h3><p>${esc(
        error.message,
      )}</p><div class="conflict-choices">${button("Dismiss", "dismiss-error", "inline")}</div></div></div>`
    : "";
  const saved =
    !error && !editorError && ui?.shadedStatus?.caseId != null && ui.shadedStatus.caseId === record?.id
      ? esc(ui.shadedStatus.text)
      : "";
  const busy = ui?.busy ? "disabled" : "";
  const held = ui?.shadedReview;
  const reviewing = decision.allowed && held != null && held.caseId === record?.id;
  const rows = reviewing ? reviewRows(held.values) : [];
  const reviewBox = reviewing
    ? `<div class="shaded-review" role="region" aria-labelledby="shaded-review-title"><h3 id="shaded-review-title" tabindex="-1">Check what was read from this copy</h3><p>${rows.length} filled ${
        rows.length === 1 ? "field" : "fields"
      }:</p><ul>${rows
        .map(
          (r) =>
            `<li><span class="shaded-review-label">${esc(r.label)}:</span> <span class="shaded-review-value">${esc(r.value)}</span></li>`,
        )
        .join("")}</ul>${when(held.preview, `<p class="shaded-review-warning">${esc(PREVIEW_WARNING)}</p>`)}<div class="conflict-choices">${button(
        "Save these values",
        "confirm-shaded-review",
        "primary",
        busy,
      )}${button("Cancel", "cancel-shaded-review", "secondary", busy)}</div></div>`
    : "";
  const tools = decision.allowed
    ? `<div class="summary-tools shaded-tools">${button(
        `${icon("file")} Fill the shaded section`,
        "open-shaded-editor",
        "primary",
        busy,
      )}${button(
        `${icon("file")} Download to fill elsewhere`,
        "download-shaded-copy",
        "secondary",
        busy,
      )}<p class="field-note shaded-download-note">${esc(DOWNLOAD_NOTE)}</p>${
        reviewing
          ? reviewBox
          : `<label class="shaded-upload" for="shaded-upload">${icon("upload")} Upload the filled copy</label><input type="file" id="shaded-upload" accept="application/pdf" data-action="upload-shaded-copy"${
              error ? ' aria-describedby="shaded-upload-error"' : ""
            }${busy ? " disabled" : ""}><p id="shaded-status" class="draft-ready" role="status">${saved}</p>`
      }</div><p class="field-note shaded-browsers">${esc(EDITOR_BROWSERS)}</p>`
    : explain(decision);
  return `<section class="panel shaded-panel" aria-labelledby="shaded-title"><div class="section-head"><h2 id="shaded-title">Shaded section of the 13614-C</h2><span class="muted small">${esc(
    summary,
  )}</span></div><p class="field-note">The parts marked "To be completed by certified volunteer". Fill them here on the form, or download the copy, fill only the shaded fields in a PDF program, and upload it here. The file stays in this browser.</p>${editorNotice}${notice}${tools}</section>`;
}

// What the Intake answers tab holds, shared with the office page. The draft
// prints the client's phones, so its buttons follow the contact rule.
export function intakeAnswersTab(record, rights, ui = {}, person = null) {
  return `${answersPanel(record, { person })}${when(canSeeContact(record, person), draftTools())}${shadedPanel(record, rights, ui)}${contactCard(record, rights, ui)}${materialsCard(record, rights, ui)}`;
}

// ---------------------------------------------------------------------------
// The document checklist (Documents tab)
// ---------------------------------------------------------------------------

const dashedSlot = (slot) => String(slot).replace(/\./g, "-");
const CARD_STATUS = Object.freeze({
  not_done: { word: "Not done", icon: "upload" },
  later: { word: "Later", icon: "clock" },
  none: { word: "Don't have", icon: "close" },
});

function groupMark(card) {
  if (card.group === "optional") return { word: "Optional", icon: "file", className: "is-optional" };
  if (card.group === "needed")
    return {
      word: card.baseGroup === "maybe" ? "Needed (moved up by the office)" : "Needed",
      icon: "pin",
      className: "is-needed",
    };
  return { word: "Maybe needed", icon: "help", className: "is-maybe" };
}

function checklistRow(card, { variant, markable, movable, off, answers }) {
  const id = `doc-${esc(dashedSlot(card.slotId))}`;
  const slot = esc(card.slotId);
  const group = groupMark(card);
  const optional = card.group === "optional";
  const asked = card.ask ? wording(findQuestion(2, card.ask), { variant, answers }) : "";
  const why = asked ? `<p class="doc-why">Asked by: ${esc(asked)}</p>` : "";
  const status = CARD_STATUS[card.status] ?? CARD_STATUS.not_done;
  const statusLine = optional
    ? ""
    : `<p class="doc-status is-${esc(card.status)}" id="${id}-status" tabindex="-1">${icon(status.icon)}<span class="sr-only">Status: </span>${esc(status.word)}</p>`;
  const mark = (value, text) =>
    button(esc(text), "mark-card", "secondary", `data-slot="${slot}" data-status="${value}"${off}`);
  const marks =
    markable && !optional
      ? `${mark("later", "Later")}${mark("none", "Don't have")}${when(card.status !== "not_done", mark("not_done", "Mark as not done"))}`
      : "";
  const move =
    movable && card.baseGroup === "maybe"
      ? card.group === "maybe"
        ? button("Move to Needed", "move-card", "secondary", `data-slot="${slot}" data-group="needed"${off}`)
        : button("Move to Maybe needed", "move-card", "secondary", `data-slot="${slot}" data-group="maybe"${off}`)
      : "";
  return `<article class="doc-row" id="${id}" data-slot="${slot}" tabindex="-1"><div class="doc-row-head"><strong class="doc-label">${esc(card.label?.en)}</strong><span class="doc-group ${group.className}">${icon(group.icon)} ${esc(group.word)}</span></div><p class="doc-owner">${esc(card.ownerLine?.office ?? card.ownerLine?.en)}</p>${why}${statusLine}${when(marks || move, `<div class="doc-marks">${marks}${move}</div>`)}</article>`;
}

/**
 * The client's document cards, as the office reads them: every card in full,
 * whatever the service, grouped by sub-step. `rights` is
 * `staffEligibility(record, person)`; a refusal is said once at the top.
 */
export function documentChecklist(record, rights, ui = {}) {
  const answers = serverAnswersV2(record);
  const cards = cardsFor(answers, record.documentCards ?? []);
  const variant = variantOf(answers);
  const markable = Boolean(rights?.markDocumentCard?.allowed);
  const movable = Boolean(rights?.moveDocumentCard?.allowed);
  const off = ui?.busy ? " disabled" : "";
  const reasons = [
    ...new Set(
      [rights?.markDocumentCard, rights?.moveDocumentCard]
        .filter((decision) => decision && !decision.allowed && decision.reason)
        .map((decision) => decision.reason),
    ),
  ];
  const groups = CARD_SUBSTEPS.map((name) => {
    const mine = cards.filter((card) => card.substep === name);
    if (!mine.length) return "";
    const title = findSubstep(`documents.${name}`)?.title?.general?.en ?? name;
    return `<h3>${esc(title)}</h3><div class="doc-rows">${mine.map((card) => checklistRow(card, { variant, markable, movable, off, answers })).join("")}</div>`;
  }).join("");
  return `<section class="panel doc-checklist" aria-labelledby="doc-checklist-title"><div class="section-head"><h2 id="doc-checklist-title">Document checklist</h2></div><p class="field-note">From the client's answers. Same-day clients bring these to the visit.</p>${reasons
    .map((reason) => explain({ reason }))
    .join("")}${groups}</section>`;
}

function requestCard(record, request, rights, ui) {
  const busy = ui.busy ? "disabled" : "";
  const documents = (record.documents ?? []).filter(
    (document) => document?.requestId === request?.id,
  );
  const followup = openFollowupFor(record, request?.id);
  const scope = request?.id ?? "request";
  const verify = when(
    request?.status === "awaiting_verification",
    rights.preparationWork.allowed || rights.verifyIntakeDocument?.allowed
      ? caseButton(
          `${icon("check")} Verify this document`,
          "VERIFY_DOCUMENT",
          "primary",
          `data-request-id="${esc(request.id)}" ${busy}`,
        )
      : explain(rights.preparationWork),
  );
  const escalate = when(
    request?.status === "open" && !followup,
    rights.preparationWork.allowed
      ? `<form class="staff-form"><input type="hidden" name="requestId" value="${esc(request.id)}">${textarea(
          "Why the office should call the client",
          "reason",
          "",
          'required maxlength="1000" rows="2"',
          scope,
        )}${caseSubmit(
          `${icon("phone")} Ask the office to contact the client`,
          "ESCALATE_CONTACT",
          "secondary",
          `data-request-id="${esc(request.id)}" ${busy}`,
        )}</form>`
      : "",
  );
  return `<div class="request-card"><div class="section-head"><h3>${esc(request?.title)}</h3><span class="badge ${request?.status === "verified" ? "green" : request?.status === "awaiting_verification" ? "amber" : "blue"}"><i></i>${esc(named(REQUEST_STATUS, request?.status, "Requested"))}</span></div><p>${esc(request?.message)}</p><p class="field-note">Requested ${esc(formatTime(request?.createdAt))}</p>${when(
    documents.length,
    `<ul class="document-list">${documents
      .map(
        (document) =>
          `<li>${icon("file")} ${esc(document.filename)} <small>${esc(
            document.source === "client" ? "sent by the client" : "recorded by the office",
          )} · ${esc(formatTime(document.createdAt))}</small></li>`,
      )
      .join("")}</ul>`,
  )}${when(
    Boolean(followup),
    `<p class="field-note">${icon("clock")} The office is already contacting the client about this request.</p>`,
  )}${verify}${escalate}</div>`;
}

export function documentsPanel(record, rights, ui) {
  const requests = record.requests ?? [];
  const busy = ui.busy ? "disabled" : "";
  const form = rights.preparationWork.allowed
    ? `<form class="staff-form"><h3>Request a document</h3>${input(
        "Short title",
        "title",
        "",
        "text",
        'required maxlength="120" placeholder="Mileage record"',
        "request",
      )}${textarea(
        "What the client should send",
        "message",
        "",
        'required maxlength="2000" rows="3"',
        "request",
      )}${caseSubmit(
        `${icon("file")} Request this document`,
        "REQUEST_DOCUMENT",
        "primary",
        busy,
      )}<p class="field-note">The client sees the title and this message. A response never verifies itself — you verify it here.</p></form>`
    : explain(rights.preparationWork);
  return `<section class="panel" aria-labelledby="documents-title"><div class="section-head"><h2 id="documents-title">Documents</h2><span class="muted small">${esc(requests.length)} requested, ${esc(unsettledRequests(record).length)} not settled</span></div>${
    requests.length
      ? requests.map((request) => requestCard(record, request, rights, ui)).join("")
      : emptyLine("No documents have been requested on this case.")
  }${form}</section>`;
}

function preparationBlockers(record) {
  const blockers = [];
  if (!record.intakeVerified)
    blockers.push("The office has not recorded the intake checks yet.");
  const unsettled = unsettledRequests(record);
  if (unsettled.length)
    blockers.push(
      `${unsettled.length} document ${unsettled.length === 1 ? "request is" : "requests are"} still open or unverified.`,
    );
  return blockers;
}

/**
 * The one thing to do next on this case, for the persona this window acts as,
 * built from the same eligibility rules the database enforces. When there is
 * nothing to do, it says who the case is waiting on and, where an action was
 * refused, why.
 */
export function nextStep(record, rights, ui = {}) {
  const busy = ui.busy ? "disabled" : "";
  const blockers = preparationBlockers(record);
  const blocked = when(
    blockers.length,
    `<ul class="blocker-list">${blockers.map((line) => `<li>${icon("clock")} ${esc(line)}</li>`).join("")}</ul>`,
  );
  const approved = (record.reviews ?? []).findLast((review) => review?.status === "approved");
  const corrections = (record.reviews ?? []).findLast(
    (review) => review?.status === "corrections_requested",
  );
  let body = "";
  switch (record.stage) {
    case "preparation_ready":
      body = rights.claimPreparation.allowed
        ? caseButton(`${icon("play")} Claim preparation`, "CLAIM_PREPARATION", "primary", busy)
        : explain(rights.claimPreparation);
      break;
    case "preparing":
      body = rights.preparationWork.allowed
        ? `${blocked}<form class="staff-form q-form">${demoFillButton(ui.demoTools === true)}${preparerForm(record, null, ui)}${caseSubmit(
            `${icon("check")} Record that preparation is complete in TaxSlayer`,
            "SUBMIT_REVIEW",
            "primary",
            blockers.length || ui.busy ? "disabled" : "",
          )}</form>`
        : explain(rights.preparationWork);
      break;
    case "corrections_required":
      body = `${when(
        Boolean(corrections),
        `<div class="notice amber" role="note">${icon("help")}<div><h3>Corrections the reviewer asked for</h3><p>${esc(corrections?.findings)}</p><small>${esc(corrections?.reviewerName ?? "")} · version ${esc(corrections?.preparationVersion)} · ${esc(formatTime(corrections?.decidedAt))}</small></div></div>`,
      )}${
        rights.preparationWork.allowed
          ? `${blocked}<form class="staff-form q-form">${demoFillButton(ui.demoTools === true)}${textarea(
              "What you corrected in TaxSlayer",
              "resolution",
              "",
              'required maxlength="2000" rows="3"',
              "resubmit",
            )}${preparerForm(record, latestBy(record.preparerQuestionnaires, "preparationVersion"), ui)}${caseSubmit(
              `${icon("check")} Record that the corrections are complete in TaxSlayer`,
              "RESUBMIT_REVIEW",
              "primary",
              blockers.length || ui.busy ? "disabled" : "",
            )}</form>`
          : explain(rights.preparationWork)
      }`;
      break;
    case "review_ready":
      body = rights.claimReview.allowed
        ? caseButton(`${icon("check")} Claim review`, "CLAIM_REVIEW", "primary", busy)
        : explain(rights.claimReview);
      break;
    case "reviewing": {
      const version = Number(record.preparationVersion) || 0;
      const questionnaires = record.preparerQuestionnaires ?? [];
      const current = questionnaires.find((q) => Number(q?.preparationVersion) === version) ?? null;
      const previous = latestBy(
        questionnaires.filter((q) => Number(q?.preparationVersion) < version),
        "preparationVersion",
      );
      body = rights.reviewDecision.allowed
        ? `${when(version > 1, submissionComparison(previous, current, version))}<form class="staff-form q-form">${demoFillButton(ui.demoTools === true)}${reviewerForm(
            record,
            ui,
          )}<div class="next-step-actions">${caseSubmit(
            `${icon("check")} Approve this review`,
            "APPROVE_REVIEW",
            "primary",
            `data-service="${esc(record.answers?.service ?? "")}" ${busy}`,
          )}${button(
            `${icon("back")} Ask the preparer for corrections`,
            "open-request-corrections",
            "secondary",
            busy,
          )}</div></form><p class="field-note">Approving records the result of the external review; it is not signing or filing, and it is not an acceptance by any tax authority.</p>`
        : explain(rights.reviewDecision);
      break;
    }
    case "review_approved": {
      const line = contactStepLine(approved, reviewerQuestionnaireOf(record, approved));
      body = line
        ? `<p class="muted">${esc(line)}</p>`
        : approved?.clientContactStatus === "pending"
          ? rights.reviewContact.allowed
            ? `<form class="staff-form">${demoFillButton(ui.demoTools === true)}${select(
                "What happened",
                "outcome",
                "",
                CONTACT_OUTCOMES.map((value) => [value, CONTACT_OUTCOME_LABELS[value]]),
                "required",
                "contact",
              )}${textarea(
                "Note for the office",
                "note",
                "",
                'required maxlength="1000" rows="2"',
                "contact",
              )}${caseSubmit(
                `${icon("phone")} Record this conversation`,
                "RECORD_REVIEW_CONTACT",
                "primary",
                busy,
              )}<p class="field-note">Recording an attempt never closes the case. Closure is the office's own step.</p></form>`
            : explain(rights.reviewContact)
          : `<p class="muted">The client conversation for this review is recorded. Nothing further is needed here.</p>`;
      break;
    }
    default:
      body = "";
  }
  return `<section class="panel next-step" aria-labelledby="next-step-title"><div class="section-head"><h2 id="next-step-title" tabindex="-1">Your next step</h2></div><p class="next-step-waiting">${esc(
    returnedToSigning(record) ? RETURNED_TO_SIGNING_WORK : stageWork(record.stage).work,
  )}</p>${body}</section>`;
}

// The preparation milestones, not the stage sentence or blockers "Your next
// step" already shows: which version is current and who has prepared it.
function preparationPanel(record) {
  return `<section class="panel" aria-labelledby="preparation-title"><div class="section-head"><h2 id="preparation-title">Preparation milestones</h2></div><p class="field-note">${esc(TAXSLAYER_NOTE)} Nothing here signs or files a return.</p>${detailRow(
    "Preparation version",
    record.preparationVersion ? `Version ${record.preparationVersion}` : "Not prepared yet",
  )}${when(
    Array.isArray(record.participantNames),
    detailRow("Prepared by (all versions)", record.participantNames?.join(", ") || "Nobody yet"),
  )}</section>`;
}

// ---------------------------------------------------------------------------
// The preparer and reviewer questionnaires (design D7, D9, D10)
// ---------------------------------------------------------------------------

const optionLabel = (list, value) => list.find(([v]) => v === value)?.[1] ?? "";
const NO_QUESTIONNAIRE = "No questionnaire was recorded for this version.";

// A stored calendar date ("2026-10-16") as staff read dates: "10/16/2026".
// Split, never new Date(…), which shifts a date by the time zone.
const staffDate = (value) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ""));
  return m ? `${m[2]}/${m[3]}/${m[1]}` : String(value ?? "");
};

// The row with the highest `key`, or null.
const latestBy = (rows, key) =>
  (rows ?? []).reduce((best, row) => (!best || Number(row?.[key]) > Number(best[key]) ? row : best), null);

const reviewerQuestionnaireOf = (record, attempt) =>
  attempt ? ((record.reviewerQuestionnaires ?? []).find((q) => q?.reviewId === attempt.id) ?? null) : null;

const radio = (scope, name, value, label, checked) => {
  const id = `field-${scope}-${name}-${value}`;
  return `<label class="checkbox-row small" for="${esc(id)}"><input type="radio" id="${esc(id)}" name="${esc(name)}" value="${esc(value)}"${checked ? " checked" : ""}><span>${esc(label)}</span></label>`;
};

const radios = (legend, scope, name, options, chosen) =>
  `<fieldset class="check-group"><legend>${esc(legend)}</legend>${options
    .map(([value, label]) => radio(scope, name, value, label, chosen === value))
    .join("")}</fieldset>`;

/**
 * The preparer questionnaire's fields, without a form or a button around
 * them. `previous` is the latest earlier submission (a resubmit starts from
 * it, with the TaxSlayer date reset to today) or null for a blank form.
 */
function preparerForm(record, previous, ui = {}) {
  const scope = "prep";
  const was = previous ?? {};
  return `${radios("Who confirmed the intake information with the preparer?", scope, "confirmedBy", CONFIRMED_BY, was.confirmedBy)}${input(
    "Name, if someone else confirmed it",
    "confirmedByName",
    was.confirmedBy === "other" ? (was.confirmedByName ?? "") : "",
    "text",
    'maxlength="120"',
    scope,
  )}${radios("How did they confirm it?", scope, "confirmedMethod", CONFIRMED_METHODS, was.confirmedMethod)}${tickBox({
    id: fieldId("shadedPartsCompleted", scope),
    name: "shadedPartsCompleted",
    value: "yes",
    label: "I have completed the shaded parts of the 13614-C.",
    checked: was.shadedPartsCompleted === true,
  })}${tickBox({
    id: fieldId("stateForgivenessSet", scope),
    name: "stateForgivenessSet",
    value: "yes",
    label: "Filing – PA State return: State Forgiveness set to Y.",
    checked: was.stateForgivenessSet === true,
  })}${input(
    "Date the return was marked ready to review in TaxSlayer (TSO)",
    "readyForReviewOn",
    todayIso(ui.now ?? Date.now()),
    "date",
    "",
    scope,
  )}`;
}

// One Exit Form entry as a collapsible group, closed until opened. A group the
// volunteer typed in is reopened after a redraw by app.mjs (groupsToOpen).
// Only the fields the chosen Result needs are shown (#108): the amount for a
// refund or an amount owed, the refund's or the payment's method to match, and
// the debit date only for a direct debit. Showing and hiding is CSS alone
// (q-exit-when-*); the payload builder (questionnaires.mjs, group) drops whatever
// the Result does not use.
function exitGroup(title, prefix) {
  const scope = "rev";
  return `<details class="q-exit-group" data-exit-group="${esc(prefix)}"><summary>${esc(title)}</summary><div class="q-exit-group-body">${radios(
    "How it was filed",
    scope,
    `${prefix}.method`,
    FILING_METHODS,
    "",
  )}${radios("Result", scope, `${prefix}.result`, RESULTS, "")}<div class="q-exit-when-amount">${input(
    "Amount",
    `${prefix}.amount`,
    "",
    "text",
    'inputmode="decimal" maxlength="9" placeholder="0.00"',
    scope,
  )}</div><div class="q-exit-when-refund">${radios(
    "How the refund is paid",
    scope,
    `${prefix}.refundBy`,
    REFUND_BY,
    "",
  )}</div><div class="q-exit-when-owe">${radios(
    "How the amount owed is paid",
    scope,
    `${prefix}.oweBy`,
    OWE_BY,
    "",
  )}</div><div class="q-exit-when-debit">${input(
    "Debit date",
    `${prefix}.debitOn`,
    "",
    "date",
    "",
    scope,
  )}</div><button type="button" class="btn secondary" data-action="clear-exit-group" data-group="${esc(prefix)}">Clear this section</button></div></details>`;
}

/**
 * The reviewer questionnaire's fields, ending where the Approve button goes.
 * Going over the return starts from the contact log (D9) and the signing
 * choice from the client's service (D6).
 */
function reviewerForm(record, ui = {}) {
  const scope = "rev";
  const service = record.answers?.service;
  const prefill = goOverPrefill(record.contacts) ?? {};
  const appointment =
    service === "same_day"
      ? ""
      : `<div class="q-when-in-person">${input(
          "Appointment to sign (date and time)",
          "signAppointmentAt",
          "",
          "datetime-local",
          "",
          scope,
        )}</div>`;
  return `<h3>Before you approve</h3>${input(
    "Date the return was marked completed in TaxSlayer (TSO)",
    "completedOn",
    todayIso(ui.now ?? Date.now()),
    "date",
    "",
    scope,
  )}${radios("PA forgiveness (Schedule SP)", scope, "paForgiveness", PA_FORGIVENESS, "")}${radios(
    "Did you go over the return with the taxpayer/spouse?",
    scope,
    "wentOver",
    [
      ["yes", "Yes"],
      ["no", "No"],
    ],
    prefill.wentOver ?? "",
  )}<div class="q-when-yes">${input(
    "Date you went over it",
    "wentOverOn",
    prefill.wentOverOn ?? "",
    "date",
    "",
    scope,
  )}${radios("How", scope, "wentOverHow", WENT_OVER_HOW, prefill.wentOverHow ?? "")}</div>${radios(
    "How will the client sign Form 8879?",
    scope,
    "signMethod",
    SIGN_METHODS,
    signDefault(service),
  )}${appointment}<h4>Exit Form (optional)</h4>${exitGroup("Federal", "federal")}${exitGroup("State", "state")}${LOCAL_TYPES.map(
    ([type, label]) => exitGroup(`Local: ${label}`, `local.${type}`),
  ).join("")}${textarea("Remarks (optional)", "remarks", "", 'maxlength="2000" rows="3"', scope)}`;
}

const yesNo = (value) => (value ? "Yes" : "No");

// [keys the row compares, label, text]
function preparerRows(q) {
  const who = optionLabel(CONFIRMED_BY, q.confirmedBy);
  return [
    [
      ["confirmedBy", "confirmedByName"],
      "Confirmed the intake",
      q.confirmedBy === "other" && q.confirmedByName ? `${who}: ${q.confirmedByName}` : who,
    ],
    [["confirmedMethod"], "How it was confirmed", optionLabel(CONFIRMED_METHODS, q.confirmedMethod)],
    [["shadedPartsCompleted"], "Shaded parts of the 13614-C completed", yesNo(q.shadedPartsCompleted)],
    [["stateForgivenessSet"], "State Forgiveness set to Y", yesNo(q.stateForgivenessSet)],
    [["readyForReviewOn"], "Ready for review in TaxSlayer on", staffDate(q.readyForReviewOn)],
  ];
}

function preparerAnswers(q) {
  if (!q) return emptyLine(NO_QUESTIONNAIRE);
  return preparerRows(q)
    .map(([, label, text]) => detailRow(label, text))
    .join("");
}

// "E-file, refund 120.00 by direct deposit"
function exitLine(group) {
  if (!group) return "";
  const parts = [optionLabel(FILING_METHODS, group.method)];
  if (group.result === "none") parts.push("no refund or amount owed");
  else if (group.result === "refund")
    parts.push(`refund ${group.amount} by ${optionLabel(REFUND_BY, group.refundBy).toLowerCase()}`);
  else {
    const how = optionLabel(OWE_BY, group.oweBy).toLowerCase();
    parts.push(`owes ${group.amount} by ${how}${group.debitOn ? ` on ${staffDate(group.debitOn)}` : ""}`);
  }
  return parts.join(", ");
}

function reviewerAnswers(q) {
  if (!q) return emptyLine(NO_QUESTIONNAIRE);
  const exit = q.exitForm ?? {};
  const entries = [
    ["Federal", exitLine(exit.federal)],
    ["State", exitLine(exit.state)],
    ...(exit.local ?? []).map((entry) => [`Local: ${entry.type}`, exitLine(entry)]),
  ].filter(([, line]) => line);
  return `${detailRow("Completed in TaxSlayer on", staffDate(q.completedOn))}${detailRow(
    "PA forgiveness",
    optionLabel(PA_FORGIVENESS, q.paForgiveness),
  )}${detailRow(
    "Went over the return with the client",
    q.wentOver
      ? `Yes, on ${staffDate(q.wentOverOn)}${q.wentOverHow ? ` (${optionLabel(WENT_OVER_HOW, q.wentOverHow).toLowerCase()})` : ""}`
      : "No",
  )}${detailRow(
    "Form 8879 signing",
    `${optionLabel(SIGN_METHODS, q.signMethod)}${q.signAppointmentAt ? `, appointment ${staffDate(String(q.signAppointmentAt).slice(0, 10))} ${String(q.signAppointmentAt).slice(11, 16)}` : ""}`,
  )}${
    entries.length
      ? entries.map(([label, line]) => detailRow(`Exit Form, ${label}`, line)).join("")
      : detailRow("Exit Form", "Nothing recorded")
  }${when(q.remarks, detailRow("Remarks", q.remarks))}`;
}

/** The previous and current preparer submissions side by side; a changed answer is marked. */
function submissionComparison(previous, current, version) {
  const changed = previous && current ? changedAnswers(previous, current) : new Set();
  const left = previous ? preparerRows(previous) : null;
  const right = current ? preparerRows(current) : null;
  const rows = (right ?? left ?? []).map(([keys, label], index) => {
    const mark = keys.some((key) => changed.has(key)) ? ' <mark class="q-changed">Changed</mark>' : "";
    return `<tr><th scope="row">${esc(label)}</th><td>${esc(left?.[index]?.[2] ?? "—")}</td><td>${esc(right?.[index]?.[2] ?? "—")}${mark}</td></tr>`;
  });
  const missing = (q, word) =>
    q ? "" : `<p class="field-note">${esc(`${word} submission: ${NO_QUESTIONNAIRE}`)}</p>`;
  return `<div class="q-compare"><h3>The preparer's answers, previous and current</h3>${missing(previous, "Previous")}${missing(current, "Current")}${
    rows.length
      ? `<table><thead><tr><th scope="col">Answer</th><th scope="col">Previous submission</th><th scope="col">Version ${esc(version)}</th></tr></thead><tbody>${rows.join("")}</tbody></table>`
      : ""
  }</div>`;
}

/**
 * The review-contact step's line once the approval carries a questionnaire
 * (D10), or null for an approval from before the questionnaires.
 */
function contactStepLine(attempt, questionnaire) {
  if (!attempt || !questionnaire) return null;
  return questionnaire.wentOver
    ? `The reviewer went over the return with the client on ${staffDate(questionnaire.wentOverOn)}.`
    : "The office will go over the return with the client.";
}

// Download Exit Form: the client's hand-out, filled from this approval's
// questionnaire (src/exit-form.mjs). Only an approval that has one offers it.
const exitFormTool = (record, attempt) =>
  reviewerQuestionnaireOf(record, attempt)
    ? `<div class="summary-tools">${button("Download Exit Form", "view-exit-form", "secondary", `data-review="${esc(attempt.id)}"`)}</div>`
    : "";

/**
 * The office's Exit Form panel: the button for the latest approval that has
 * a reviewer questionnaire. Nothing before there is one.
 */
export function exitFormPanel(record) {
  const approved = [...(record?.reviews ?? [])]
    .reverse()
    .find((attempt) => attempt?.status === "approved" && reviewerQuestionnaireOf(record, attempt));
  if (!approved) return "";
  return `<section class="panel" aria-labelledby="exit-form-title"><div class="section-head"><h2 id="exit-form-title">Exit Form</h2></div><p class="field-note">PCDC's hand-out for the client, filled from the reviewer's answers for version ${esc(approved.preparationVersion)}. Print it for the client when they sign.</p>${exitFormTool(record, approved)}</section>`;
}

function reviewAttempts(record) {
  const attempts = record.reviews ?? [];
  const preparerFor = (attempt) =>
    (record.preparerQuestionnaires ?? []).find(
      (q) => Number(q?.preparationVersion) === Number(attempt?.preparationVersion),
    ) ?? null;
  if (!attempts.length)
    return emptyLine("No review attempt has been opened on this case yet.");
  return `<ol class="review-list">${attempts
    .map(
      (attempt) =>
        `<li class="review-attempt"><div class="section-head"><h3>Version ${esc(attempt?.preparationVersion)}</h3><span class="badge ${attempt?.status === "approved" ? "green" : attempt?.status === "corrections_requested" ? "amber" : "teal"}"><i></i>${esc(named(REVIEW_STATUS, attempt?.status, "Review"))}</span></div>${detailRow(
          "Reviewer",
          attempt?.reviewerName ?? (attempt?.reviewerId ? UNKNOWN_PERSON : "Unassigned"),
        )}${when(attempt?.findings, detailRow("Corrections asked for", attempt?.findings))}${when(
          attempt?.resolution,
          detailRow("What the preparer corrected", attempt?.resolution),
        )}${when(
          attempt?.clientContactStatus || reviewerQuestionnaireOf(record, attempt),
          detailRow(
            "Client conversation",
            contactStepLine(attempt, reviewerQuestionnaireOf(record, attempt)) ??
              (attempt?.clientContactStatus === "completed"
                ? `${named(CONTACT_OUTCOME_LABELS, attempt?.clientContactOutcome, "Recorded")} · ${formatTime(attempt?.clientContactedAt)}`
                : "Still to record"),
          ),
        )}${when(
          attempt?.clientContactNote,
          detailRow("Conversation note", attempt?.clientContactNote),
        )}<h4>Preparer's answers</h4>${preparerAnswers(preparerFor(attempt))}${when(
          attempt?.status === "approved",
          `<h4>Reviewer's answers</h4>${reviewerAnswers(reviewerQuestionnaireOf(record, attempt))}${exitFormTool(record, attempt)}`,
        )}<small>Opened ${esc(formatTime(attempt?.createdAt))}${when(attempt?.decidedAt, ` · decided ${esc(formatTime(attempt?.decidedAt))}`)}</small></li>`,
    )
    .join("")}</ol>`;
}

// Every review attempt on this case. The decision is in "Your next step".
function reviewPanel(record) {
  return `<section class="panel" aria-labelledby="review-title"><div class="section-head"><h2 id="review-title">Independent review</h2></div><p class="field-note">A reviewer never reviews a case they prepared, at any version.</p>${reviewAttempts(record)}</section>`;
}

/**
 * The Request corrections dialog: the form REQUEST_CORRECTIONS is built from.
 * A refused send is repeated here, because the page's own notice sits behind
 * the dialog (aria-modal), so that notice may not be read. This one carries
 * role="alert" and is tied to the textarea with aria-describedby. With the
 * dialog open it is the only copy, so it carries the banner's controls: Try
 * again (when the press can be re-sent) and Dismiss.
 */
export function correctionsDialogBody(state = {}) {
  const refused = state.error
    ? `<div class="notice error" role="alert" id="corrections-error">${icon("help")}<div><h3>${esc(
        state.error.code === "CONFLICT" ? "This case changed while you were working" : "That did not go through",
      )}</h3><p>${esc(state.error.message)}</p><div class="conflict-choices">${when(
        state.retryable,
        button("Try again", "retry-action", "secondary"),
      )}${button("Dismiss", "dismiss-error", "text")}</div></div></div>`
    : "";
  return confirmBody({
    before: refused,
    lead: "Tell the preparer what to correct in TaxSlayer. The client never sees these words.",
    form: {
      fields: textarea(
        "Corrections to send back to the preparer",
        "findings",
        "",
        `required maxlength="2000" rows="4"${state.error ? ' aria-describedby="corrections-error"' : ""}`,
        "corrections",
      ),
    },
    confirm: caseSubmit(
      `${icon("back")} Send back for corrections`,
      "REQUEST_CORRECTIONS",
      "primary full",
      state.busy ? "disabled" : "",
    ),
    keep: "Keep reviewing",
  });
}

function followupPanel(record) {
  const followups = record.followups ?? [];
  return `<section class="panel" aria-labelledby="followup-title"><div class="section-head"><h2 id="followup-title">Office follow-up</h2><span class="muted small">${esc(followups.length)} ${followups.length === 1 ? "task" : "tasks"}</span></div>${
    followups.length
      ? `<ul class="followup-list">${followups
          .map(
            (followup) =>
              `<li><div class="section-head"><h3>${esc(named(FOLLOWUP_STATUS, followup?.status, "Task"))}</h3><span class="muted small">${esc(followup?.assigneeName ?? UNKNOWN_PERSON)}</span></div><p>${esc(followup?.reason)}</p><h4>Contacts so far</h4>${taskContacts(record, followup)}${when(
                followup?.resolutionNote,
                `<p class="field-note">Resolved: ${esc(followup.resolutionNote)}</p>`,
              )}</li>`,
          )
          .join("")}</ul>`
      : emptyLine("No office follow-up has been raised on this case.")
  }<p class="field-note">Contacts for an office task are logged on the office screens. Any other contact goes in the Contacts tab.</p></section>`;
}

// ---------------------------------------------------------------------------
// The contact log (OpenSpec change add-contact-log, design D8 and D9)
// ---------------------------------------------------------------------------

// The logger edits their own entry, and an admin edits anyone's. Without a
// persona there is nobody to compare, so nobody may edit.
export const mayEditContact = (contact, person) =>
  Boolean(person?.id) &&
  (person.id === contact?.loggedByPersonId || Boolean(person?.capabilities?.includes("admin")));

// Which outcome group a method and direction show: "voice", "written", or
// null (in person, and every incoming contact, is "reached" with no choice).
// app.mjs asks the same question when a radio changes, so the first draw and
// the page after a change agree.
export function outcomeGroup(method, direction) {
  const outcomes = outcomesFor(method, direction);
  if (!outcomes.length) return null;
  return outcomes === VOICE_OUTCOMES ? "voice" : "written";
}

// The one line of an entry, or of an earlier version, which keeps the entry's
// logger: an edit never changes who logged it.
const lineOf = (record, entry, loggedByName = entry?.loggedByName) =>
  contactSummary({ ...entry, loggedByName }, { answers: record?.answers ?? {} });
const byContactTime = (a, b) =>
  Date.parse(a?.contactedAt) - Date.parse(b?.contactedAt) ||
  Date.parse(a?.loggedAt) - Date.parse(b?.loggedAt);

// One button group: a fieldset of real radios, each label drawn as a segment.
// The radios stay in the tab order and the accessibility tree; only the dot
// is hidden (styles.css, .seg).
function segGroup(legend, name, options, chosen, scope, attrs = "") {
  return `<fieldset class="seg-group"${attrs}><legend>${esc(legend)}</legend><div class="seg-options">${options
    .map(([key, label]) => {
      const id = fieldId(`${name}-${key}`, scope);
      return `<label class="seg" for="${id}"><input type="radio" id="${id}" name="${name}" value="${esc(key)}" required${chosen === key ? " checked" : ""}><span>${esc(label)}</span></label>`;
    })
    .join("")}</div></fieldset>`;
}

/**
 * The only Log contact form (design D8), in the Contacts tab, inside each open
 * task on the case page's Follow-up tab, and in the office drawer. Given
 * `contact`, the same form edits that entry, prefilled. Field ids are scoped
 * per form, so a draft survives a redraw and two forms never share an id.
 * Both outcome groups are drawn; the one the method does not use is hidden
 * and disabled, so it is neither required nor sent.
 *
 * @param {object} record the decorated staff case
 * @param {object|null} person the persona
 * @param {object} ui `{busy, now}`
 * `purpose` preselects a purpose on a new entry (the task's own); an edit keeps its entry's.
 * @param {{followupId?: string|null, contact?: object|null, purpose?: string|null}} options
 */
export function logContactForm(
  record,
  person,
  ui = {},
  { followupId = null, contact = null, purpose = null } = {},
) {
  const view = ui ?? {};
  const scope = contact
    ? `contact-edit-${contact.id}`
    : followupId
      ? `contact-task-${followupId}`
      : "contact-new";
  const direction = contact?.direction ?? "outgoing";
  const method = contact?.method ?? "phone";
  const shown = outcomeGroup(method, direction);
  const withWhom = contact?.withWhom ?? null;
  const busy = view.busy ? " disabled" : "";
  const outcomes = (key, name, options) =>
    segGroup(
      "Outcome",
      name,
      options,
      shown === key ? (contact?.outcome ?? null) : null,
      scope,
      ` data-outcome-group="${key}"${shown === key ? "" : " hidden disabled"}`,
    );
  const attrs = `data-case-id="${esc(record?.id ?? "")}"${
    followupId ? ` data-followup-id="${esc(followupId)}"` : ""
  }${contact ? ` data-contact-id="${esc(contact.id)}" aria-label="Edit this contact"` : ""}`;
  const heading = contact ? "" : followupId ? "<h4>Log contact</h4>" : "<h3>Log contact</h3>";
  const time = contact ? nyLocalInput(contact.contactedAt) : nowInput(view.now ?? Date.now());
  const nameId = fieldId("otherName", scope);
  // An id, so the keyboard finds the button again after the redraw a press makes.
  const submitId = fieldId("submit", scope);
  const buttons = contact
    ? `<div class="contact-form-actions"><button type="submit" class="btn primary" id="${submitId}"${busy}>Save changes</button>${button(
        "Cancel",
        "toggle-contact-edit",
        "secondary",
        `data-contact-id="${esc(contact.id)}"`,
      )}</div>`
    : `<button type="submit" class="btn primary" id="${submitId}"${busy}>Log contact</button>`;
  return `<form class="staff-form contact-form" ${attrs}>${heading}${segGroup(
    "Direction",
    "direction",
    CONTACT_DIRECTIONS,
    direction,
    scope,
  )}${segGroup("Method", "method", CONTACT_METHODS, method, scope)}${segGroup(
    "Purpose",
    "purpose",
    CONTACT_PURPOSES,
    contact ? (contact.purpose ?? null) : purpose,
    scope,
  )}${outcomes("voice", "outcomeVoice", VOICE_OUTCOMES)}${outcomes(
    "written",
    "outcomeWritten",
    WRITTEN_OUTCOMES,
  )}${segGroup("With", "withWhom", CONTACT_WITH, withWhom, scope)}<label class="field" for="${nameId}" data-other-name${
    withWhom === "other" ? "" : " hidden"
  }><span>Name</span><input id="${nameId}" name="otherName" type="text" value="${esc(
    contact?.otherName ?? "",
  )}" maxlength="80"></label>${input(
    "Contact time",
    "contactedAt",
    time,
    "datetime-local",
    "required",
    scope,
  )}${textarea("Note", "note", contact?.note ?? "", 'maxlength="1000" rows="2"', scope)}${buttons}</form>`;
}

// One entry in the Contacts tab: its line, Copy, Edit for the logger or an
// admin, "edited", its task, and its earlier versions, read-only. The edit
// form is drawn only for a persona who may edit, so a persona chosen while
// somebody else's form was open never sees it (Review Focus 3).
function contactItem(record, contact, person, view) {
  const id = esc(contact?.id ?? "");
  const editable = mayEditContact(contact, person);
  const editing = editable && (view.openPanels ?? []).includes(`contact-edit:${contact?.id}`);
  const task = contact?.followupId
    ? (record.followups ?? []).find((followup) => followup?.id === contact.followupId)
    : null;
  const earlier = [...(contact?.versions ?? [])]
    .filter((version) => Number(version?.version) < Number(contact?.revision))
    .sort((a, b) => Number(a.version) - Number(b.version));
  const meta = [
    when(contact?.followupId, `<span>For the follow-up: ${esc(task?.reason ?? "an office task")}</span>`),
    when(contact?.editedAt, `<span>edited ${esc(contactTime(contact.editedAt))}</span>`),
  ].join("");
  return `<li id="contact-${id}" class="contact-entry" tabindex="-1"><p class="contact-line" id="contact-${id}-line">${esc(
    lineOf(record, contact),
  )}</p>${when(meta, `<p class="contact-meta">${meta}</p>`)}<div class="contact-actions">${button(
    "Copy",
    "copy-contact",
    "secondary",
    `data-contact-id="${id}" aria-describedby="contact-${id}-line"`,
  )}${when(
    editable,
    button("Edit", "toggle-contact-edit", "text", `data-contact-id="${id}" aria-expanded="${editing}"`),
  )}</div>${when(editing, logContactForm(record, person, view, { contact }))}${when(
    earlier.length,
    `<details class="contact-versions"><summary>Earlier versions (${earlier.length})</summary><ol>${earlier
      .map(
        (version) =>
          `<li>${esc(lineOf(record, version, contact.loggedByName))}<small>Saved ${esc(
            contactTime(version.createdAt),
          )} · ${esc(version.editedByName ?? UNKNOWN_PERSON)}</small></li>`,
      )
      .join("")}</ol></details>`,
  )}</li>`;
}

/**
 * The Contacts tab (design D9): Copy all, the Log contact form, then the
 * entries, newest contact time first (then newest logged).
 *
 * @param {object} record the decorated staff case
 * @param {object|null} person the persona
 * @param {object} ui `{busy, now, openPanels}`
 */
export function contactsPanel(record, person, ui = {}) {
  const view = ui ?? {};
  const contacts = [...(record?.contacts ?? [])].sort((a, b) => byContactTime(b, a));
  return `<section class="panel contacts-panel" aria-labelledby="contacts-title"><div class="section-head"><h2 id="contacts-title">Contacts</h2>${when(
    contacts.length,
    button("Copy all", "copy-all-contacts", "secondary"),
  )}</div>${
    person ? logContactForm(record, person, view) : explain({ allowed: false, reason: NO_LINKED_VOLUNTEER })
  }${
    contacts.length
      ? `<ol class="contact-list">${contacts.map((contact) => contactItem(record, contact, person, view)).join("")}</ol>`
      : emptyLine("No contacts logged yet.")
  }</section>`;
}

// The lines of the entries linked to one task, oldest first (design D8).
export function taskContacts(record, task) {
  const linked = (record?.contacts ?? [])
    .filter((contact) => task?.id && contact?.followupId === task.id)
    .sort(byContactTime);
  if (!linked.length) return emptyLine("No contact has been logged on this task yet.");
  return `<ul class="contact-task-list">${linked
    .map((contact) => `<li>${esc(lineOf(record, contact))}</li>`)
    .join("")}</ul>`;
}

// One plain sentence per recorded action (spec section 6). The actor is added
// when the event names one; an action this table does not know still reads
// as words, never as a code.
export const EVENT_SENTENCES = Object.freeze({
  SAVE_ANSWERS: "saved the intake answers",
  SUBMIT: "submitted the application",
  START_SCREENING: "started screening",
  VERIFY_INTAKE: "recorded the screening checks",
  CLAIM_PREPARATION: "claimed preparation",
  REQUEST_DOCUMENT: "asked the client for a document",
  RESPOND_DOCUMENT: "sent a requested document",
  RECORD_DOCUMENT_RESPONSE: "recorded a document the office took in",
  VERIFY_DOCUMENT: "verified a document",
  ESCALATE_CONTACT: "asked the office to contact the client",
  // No longer sent (the contact log replaced it), but earlier attempts are
  // still in the history and keep their wording.
  RECORD_CONTACT: "recorded a call attempt",
  RESOLVE_FOLLOWUP: "resolved the office follow-up",
  SUBMIT_REVIEW: "recorded that preparation is complete",
  CLAIM_REVIEW: "claimed the review",
  REQUEST_CORRECTIONS: "asked the preparer for corrections",
  RESUBMIT_REVIEW: "recorded that the corrections are complete",
  APPROVE_REVIEW: "approved the review",
  RECORD_REVIEW_CONTACT: "recorded the conversation with the client",
  MARK_READY_TO_EFILE: "recorded the client's signature",
  MARK_EFILED: "recorded that the return was e-filed",
  RECORD_FILING_RESULT: "recorded the filing result",
  RETURN_TO_SIGNING: "returned the case to signing",
  REMIND: "recorded a reminder for the client",
  REQUEST_DOCUMENTS_AT_INTAKE: "asked for documents",
  PUT_ON_HOLD: "put the case on hold",
  RESUME_FROM_HOLD: "recorded that the office got in touch",
  // The client acts, so the event has no staff actor and this is the whole sentence.
  WITHDRAW: "the client withdrew the application",
  CLOSE_CASE: "closed the case",
  UPDATE_CONTACT: "updated the best time to reach",
  RECORD_MATERIALS: "recorded the materials received",
  SET_DOCUMENT_CARD: "updated a document's status",
  SET_DOCUMENT_GROUP: "changed whether a document is needed",
  SAVE_PREPARER_FIELDS: "saved the shaded section",
});

export function historySentence(entry) {
  const code = String(entry?.action ?? "");
  // `??` and `||` cannot be mixed without parentheses.
  const seasonEnd = code === "CLOSE_CASE" && entry?.detail?.seasonEnd === true;
  const words = seasonEnd
    ? `closed the case at season end${
        Object.hasOwn(CLOSING_REASON_NAMES, entry.detail.reason ?? "")
          ? ` · ${CLOSING_REASON_NAMES[entry.detail.reason].split(" (")[0]}`
          : ""
      }`
    : (EVENT_SENTENCES[code] ?? code.toLowerCase().replaceAll("_", " ").trim()) ||
      "recorded a change";
  // A shaded save names the fields it changed, by label, never their values.
  const changed =
    code === "SAVE_PREPARER_FIELDS" && Array.isArray(entry?.detail?.changed)
      ? ` · ${entry.detail.changed.length ? entry.detail.changed.map(shadedLabel).join(", ") : "no fields changed"}`
      : "";
  const sentence = `${entry?.actorName ? `${entry.actorName} ${words}` : words}${changed}`;
  // A close or a hold carries staff context: the reason's name and the note, as typed.
  const reason =
    code === "CLOSE_CASE" && !seasonEnd && Object.hasOwn(CLOSING_REASON_NAMES, entry?.detail?.reason ?? "")
      ? ` Reason: ${CLOSING_REASON_NAMES[entry.detail.reason]}.`
      : "";
  const note =
    (code === "CLOSE_CASE" || code === "PUT_ON_HOLD") &&
    typeof entry?.detail?.note === "string" &&
    entry.detail.note
      ? ` Note: ${entry.detail.note}`
      : "";
  const assigned =
    code === "SUBMIT" && typeof entry?.detail?.clientNumber === "number"
      ? ` Client ${formatClientNumber(entry.detail.clientNumber)} assigned.`
      : "";
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.${assigned}${reason}${note}`;
}

export function historyPanel(record, staffShaped) {
  const internal = [...(record.internalHistory ?? [])].reverse();
  const client = [...(record.history ?? [])].reverse();
  return `<section class="panel history-panel" aria-labelledby="history-title"><div class="section-head"><h2 id="history-title">History</h2></div>${when(
    staffShaped,
    `<h3>Internal history — staff only</h3>${
      internal.length
        ? `<div class="timeline" data-role="internal-history">${internal
            .map(
              (entry) =>
                `<div class="timeline-item"><span class="timeline-dot"></span><div><p>${esc(historySentence(entry))}</p><small>${esc(formatTime(entry?.createdAt))}</small></div></div>`,
            )
            .join("")}</div>`
        : emptyLine("Nothing has been recorded on this case yet.")
    }`,
  )}<h3>What the client sees</h3>${
    client.length
      ? `<div class="timeline" data-role="client-history">${client
          .map(
            (entry) =>
              `<div class="timeline-item"><span class="timeline-dot"></span><div><p>${esc(entry?.message)}</p><small>${esc(formatTime(entry?.createdAt))}</small></div></div>`,
          )
          .join("")}</div>`
      : emptyLine("The client has seen no updates yet.", 'data-role="client-history"')
  }<p class="field-note">Findings, resolutions and office notes stay in the internal list. The client list is the plain-language progress the client reads.</p></section>`;
}

/**
 * One case: a header, then five tabs (spec section 6). Overview holds the next
 * step and the facts; the other tabs hold the rest. Every panel is rendered, so
 * each control keeps its hook whichever tab is showing.
 *
 * @param {object} caseRecord a decorated staff Case (`decorateStaffCase`)
 * @param {{id:string,name:string,capabilities:string[]}|null} person the persona
 * @param {object} ui `{busy, error, retryable, caseTab}` from the controller snapshot
 */
export function renderStaffCase(caseRecord, person, ui = {}) {
  const record = caseRecord ?? {};
  const view = ui ?? {};
  const rights = staffEligibility(record, person);
  // A record with no staff sections is an applicant's Case, or a list row: it
  // cannot be acted on, and no workflow control is offered for it.
  const staffShaped = Array.isArray(record.participants) && Array.isArray(record.reviews);
  const notLoaded = `<section class="panel"><div class="section-head"><h2>Staff sections are not loaded</h2></div><p class="muted">This record holds no participation, review or internal history, so no case action is offered here. Open the case from the work board to do the work.</p></section>`;
  const elsewhere = '<p class="muted">Open the case from the work board to see this.</p>';
  const panels = [
    [
      "overview",
      "Overview",
      staffShaped
        ? `${nextStep(record, rights, view)}${filingPanel(record)}${caseDetails(record)}${preparationPanel(record)}${reviewPanel(record)}`
        : `${caseDetails(record)}${notLoaded}`,
    ],
    [
      "intake",
      "Intake answers",
      // An applicant's record or a board row carries no materials and offers
      // no action: it keeps the answers alone.
      staffShaped ? intakeAnswersTab(record, rights, view, person) : answersPanel(record, { person }),
    ],
    [
      "documents",
      "Documents",
      staffShaped ? `${documentChecklist(record, rights, view)}${documentsPanel(record, rights, view)}` : elsewhere,
    ],
    ["followup", "Follow-up", staffShaped ? followupPanel(record) : elsewhere],
    ["contacts", "Contacts", staffShaped ? contactsPanel(record, person, view) : elsewhere],
    ["history", "History", historyPanel(record, staffShaped)],
  ];
  return [
    problemNotice(view),
    caseHeader(record, person, view.principal),
    caseTabs(panels, view.caseTab, {
      documents: (record.requests ?? []).length,
      contacts: (record.contacts ?? []).length,
    }),
  ].join("");
}
