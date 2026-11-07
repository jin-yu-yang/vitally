import {
  esc,
  icon,
  button,
  caseButton,
  caseSubmit,
  confirmBody,
  input,
  stageBadge,
  formatTime,
  fieldId,
  officeContact,
  formatClientNumber,
  loadingLine,
  unloadedLine,
  emptyState,
  emptyLine,
} from "./ui.mjs";
import { describeStage, holdKind, canWithdraw, mustContactToWithdraw } from "./domain.mjs";
import { invalidAnswers, formatAnswer, sendable } from "./intake-form.mjs";
import {
  stepsFor,
  questionsFor,
  wording,
  isAnswered,
  serviceLabel,
  clientLanguages,
  languageNames,
} from "./intake-catalogue.mjs";
import {
  intakeFormV2,
  submittedV2,
  progressDocumentsV2,
  serverAnswersV2,
  variantOf,
} from "./intake-views.mjs";
import { viewLang } from "./language.mjs";
import { t, sentence, historyLine } from "./client-text.mjs";

// Every client screen, as pure functions of one controller snapshot. No state,
// no store, no timers, no DOM: each returns an HTML string, and everything that
// came from a person or from the database is escaped on the way out.
//
// Two conventions hold throughout:
//   * workflow buttons carry `data-case-action` with a name from CASE_ACTIONS;
//   * navigation, dialogs and prototype helpers carry `data-action`, and are
//     never translated into a database action.
// Stage words are never written here — they come from `describeStage`.
//
// Every screen speaks `viewLang(state)` (spec 2026-10-05 §2, §3): its words
// come from client-text.mjs, finished English sentences (errors, sign-in,
// history) go through `sentence`, and what a person typed is shown as typed.
// Without a language everything is the English it always was.

const when = (condition, html) => (condition ? html : "");

const row = (label, value) =>
  `<div class="detail-row"><span>${esc(label)}</span><strong>${esc(value || "—")}</strong></div>`;

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

// Identical for every visitor. It names no roster, no account and no delivery
// channel, so reading it tells nobody whether an address is known here.
const troubleshooting = (lang) =>
  `<div class="support-note">${icon("help")}<div><strong>${esc(t("signin.no_code", {}, lang))}</strong><p>${esc(t("signin.no_code_body", {}, lang))}</p><p>${esc(t("signin.still_stuck", {}, lang))}</p>${officeContact()}${button(esc(t("signin.get_help", {}, lang)), "open-help", "inline")}</div></div>`;

function emailStep(state, lang) {
  return `<form id="email-form" class="panel access-panel">${input(
    t("signin.email", {}, lang),
    "email",
    state.authEmail,
    "email",
    `required autocomplete="email" placeholder="${esc(t("signin.email_placeholder", {}, lang))}" maxlength="254"`,
  )}<p class="field-note">${esc(t("signin.email_note", {}, lang))}</p>${authFailure(state, lang)}<button class="btn primary full" type="submit">${esc(t("signin.send", {}, lang))} ${icon("arrow")}</button></form>`;
}

// The countdown and the Resend label use the keys app.mjs patches in place
// every second, so the first draw and the live update agree.
function codeStep(state, lang) {
  const waiting = Number(state.resendSeconds) > 0;
  // The code is rendered from state, never blank. A re-render can arrive at any
  // moment — the countdown, a connection change, a realtime notification — and
  // a half-typed code must survive all of them, or the field is silently empty
  // when the person presses Verify and the required attribute stops the form
  // with nothing on screen to explain it.
  const seconds = esc(state.resendSeconds);
  return `<form id="code-form" class="panel access-panel">${input(
    t("signin.code", {}, lang),
    "code",
    state.authCode,
    "text",
    `required inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="${esc(t("signin.code_placeholder", {}, lang))}"`,
  )}<p class="field-note">${when(state.authEmail, t("signin.as", { email: `<strong>${esc(state.authEmail)}</strong>` }, lang))}${esc(t("signin.code_note", {}, lang))}</p>${authFailure(state, lang)}<button class="btn primary full" type="submit">${esc(t("signin.verify", {}, lang))} ${icon("arrow")}</button><div class="resend-row"><span>${esc(t("signin.didnt_receive", {}, lang))}</span>${button(
    waiting ? t("signin.resend_in", { n: seconds }, lang) : t("signin.resend", {}, lang),
    "resend-code",
    "inline",
    waiting ? "disabled" : "",
  )}<span class="cooldown" role="status" data-role="resend-countdown">${when(waiting, t("signin.countdown", { n: seconds }, lang))}</span></div>${button(esc(t("signin.other_email", {}, lang)), "back-to-email", "text")}</form>`;
}

function authFailure(state, lang = "en") {
  if (!state.authError) return "";
  return `<p class="error" role="alert">${esc(sentence(state.authError.message, lang))}</p>`;
}

export function accessScreen(state) {
  const lang = viewLang(state);
  const onCode = state.authStep === "code";
  return `<main id="main" class="narrow" tabindex="-1"><div class="center-icon">${icon(onCode ? "lock" : "mail")}</div><div class="page-intro centered"><span class="overline">${esc(t(onCode ? "signin.check_inbox" : "signin.welcome", {}, lang))}</span><h1>${esc(t(onCode ? "signin.enter_code" : "signin.title", {}, lang))}</h1><p>${
    onCode
      ? `${esc(sentence(state.authMessage, lang))}`
      : esc(t("signin.intro", {}, lang))
  }</p></div>${onCode ? codeStep(state, lang) : emailStep(state, lang)}${troubleshooting(lang)}<p class="footnote">${esc(t("signin.footnote", {}, lang))}</p></main>`;
}

// ---------------------------------------------------------------------------
// My applications
// ---------------------------------------------------------------------------

function applicationRow(entry, updatedAt, lang = "en") {
  return `<button class="application-row" data-action="open-case" data-case-id="${esc(entry.id)}"><span class="application-id"><span class="application-reference">${esc(entry.reference)}</span>${when(entry.clientNumber != null, `<span class="application-number">${esc(formatClientNumber(entry.clientNumber))}</span>`)}</span><span class="application-stage">${stageBadge(entry.stage, lang, { audience: "client", record: entry })}</span><span class="application-when">${updatedAt ? esc(t("apps.updated", { when: updatedAt }, lang)) : esc(t("apps.no_updates", {}, lang))}</span>${icon("chevron")}</button>`;
}

export function applicationsScreen(state) {
  const lang = viewLang(state);
  const say = (key) => esc(t(key, {}, lang));
  const query = String(state.lookup ?? "").trim().toUpperCase();
  // The lookup searches this account's own applications and nothing else: an
  // unknown reference says only that it is not one of yours.
  const shown = query
    ? state.cases.filter((entry) =>
        String(entry.reference ?? "").toUpperCase().includes(query),
      )
    : state.cases;
  const updatedFor = (entry) =>
    state.savedCase?.id === entry.id
      ? formatTime(state.savedCase.history?.at(-1)?.createdAt, lang)
      : "";
  const listState = state.lists?.cases ?? "ready";
  const loaded = shown.length
    ? `<div class="application-list">${shown.map((entry) => applicationRow(entry, updatedFor(entry), lang)).join("")}</div>`
    : query
      ? `<div class="notice amber" role="status">${icon("help")}<div><h3>${say("apps.not_found")}</h3><p>${say("apps.not_found_body")}</p></div></div>`
      : emptyState({ icon: "folder", title: say("apps.empty"), text: say("apps.empty_body"), className: "panel" });
  const list =
    listState === "loading"
      ? loadingLine(t("apps.loading", {}, lang))
      : listState === "failed"
        ? unloadedLine(t("apps.unloaded", {}, lang))
        : loaded;
  return `<main id="main" class="narrow" tabindex="-1"><div class="page-intro"><span class="overline">${say("apps.overline")}</span><h1>${say("apps.title")}</h1><p>${say("apps.intro")}</p></div><form id="lookup-form" class="lookup-form">${input(
    t("id.application", {}, lang),
    "lookup",
    state.lookup,
    "text",
    `autocomplete="off" placeholder="${say("apps.lookup_placeholder")}"`,
  )}<button class="btn secondary" type="submit">${icon("search")} ${say("apps.find")}</button>${when(query, button(say("apps.show_all"), "clear-lookup", "text"))}</form>${list}<div class="start-row">${button(`${icon("file")} ${say("apps.start")}`, "start-application", "primary full")}<p class="field-note">${say("apps.start_note")}</p></div></main>`;
}

// ---------------------------------------------------------------------------
// The generated reference card
// ---------------------------------------------------------------------------

export function referenceScreen(state) {
  const record = state.savedCase;
  if (!record) return applicationsScreen(state);
  const lang = viewLang(state);
  const say = (key) => esc(t(key, {}, lang));
  return `<main id="main" class="narrow" tabindex="-1"><div class="center-icon success">${icon("check")}</div><div class="page-intro centered"><span class="overline">${say("ref.overline")}</span><h1>${say("ref.title_1")}<br>${say("ref.title_2")}</h1><p>${say("ref.intro_1")}<br>${say("ref.intro_2")}</p></div><div class="reference-card"><span>ViTally <small>${say("ref.card_org")}</small></span><p>${say("ref.your_id")}</p><strong>${esc(record.reference)}</strong><div class="reference-bottom">${say("ref.tax_year")} <span>${say("ref.keep")}</span></div></div><div class="card-tools">${button(`${icon("copy")} ${say("ref.copy")}`, "copy-reference", "secondary")}${button(`${icon("print")} ${say("ref.print")}`, "print-reference", "secondary")}</div>${button(`${say("ref.continue")} ${icon("arrow")}`, "continue-intake", "primary full")}<p class="footnote">${say("ref.footnote")}</p></main>`;
}

// ---------------------------------------------------------------------------
// Save state and conflict reconciliation
// ---------------------------------------------------------------------------

// The errors a version-2 form shows: invalid answers of visible questions whose
// ids are in the revealed list, the same ids the notes show (spec §2.5).
function shownErrors(state) {
  const revealed = new Set(state.revealed ?? []);
  if (!revealed.size) return 0;
  return invalidAnswers(null, state.draftAnswers ?? {}).filter((id) => revealed.has(id)).length;
}

// The chip and the conflict panel follow the client's language on a form
// with a case; the office's Add a case before its first save is a staff
// screen, in English.
const formLang = (state) => (state?.savedCase ? viewLang(state) : "en");

export function saveStatus(state) {
  const lang = formLang(state);
  const say = (key) => esc(t(key, {}, lang));
  if (state.saveState === "saving")
    return `<span class="save-chip saving" role="status">${icon("refresh")} ${say("save.saving")}</span>`;
  // On a case, after Saving, Failed and Unsaved and before Saved.
  if (
    state.savedCase &&
    state.saveState !== "failed" &&
    state.saveState !== "unsaved" &&
    !state.dirty
  ) {
    const count = shownErrors(state);
    if (count > 0)
      return `<span class="save-chip checking" role="status">${icon("help")} ${esc(t("save.checking", { n: count }, lang))}</span>`;
  }
  if (state.saveState === "saved")
    return `<span class="save-chip saved" role="status">${icon("check")} ${say("save.saved")}</span>`;
  if (state.saveState === "failed")
    return `<span class="save-chip failed" role="alert">${icon("help")} ${say("save.not_saved")} ${esc(sentence(state.error?.message ?? "Please try again.", lang))} ${when(state.retryable, button(say("frame.try_again"), "retry-action", "inline"))}</span>`;
  if (state.saveState === "unsaved" || state.dirty)
    return `<span class="save-chip unsaved" role="status">${icon("clock")} ${say("save.unsaved")}</span>`;
  return `<span class="save-chip" role="status">${icon("check")} ${say("save.up_to_date")}</span>`;
}

// A deliberate choice between two sets of answers. It shows only what actually
// differs, and neither button saves: reconciliation picks a new edit base, and
// the save that follows still goes through the database revision check.
//
// Every catalogue field, the four contact fields included, compared by what a
// save would send (spec §3.3). Unanswered is one state, so a null in the draft
// and a missing key on the server are the same answer.
export function conflictForm(state) {
  if (!state.conflict) return "";
  const server = serverAnswersV2(state.savedCase);
  const mine = state.draftAnswers ?? {};
  const variant = variantOf(mine);
  const lang = formLang(state);
  const shown = (question, value) =>
    esc(formatAnswer(question, value, { variant, lang, answers: mine }) ?? "—").replace(/\n/g, "<br>");
  const rows = allQuestionsV2()
    .filter((question) => !sameAnswer(sendable(question, mine[question.id]), sendable(question, server[question.id])))
    .map(
      (question) =>
        `<tr><th scope="row">${esc(wording(question, { variant, lang, answers: mine }))}</th><td>${shown(question, mine[question.id])}</td><td>${shown(question, server[question.id])}</td></tr>`,
    )
    .join("");
  return conflictPanel(state, lang, rows);
}

function conflictPanel(state, lang, rows) {
  const say = (key) => esc(t(key, {}, lang));
  return `<section class="panel conflict-panel" aria-labelledby="conflict-title"><div class="section-head"><h2 id="conflict-title">${say("conflict.title")}</h2></div><p>${esc(t("conflict.body", { server: state.conflict.serverRevision, base: state.conflict.baseRevision }, lang))}</p><table class="conflict-table"><thead><tr><th scope="col">${say("conflict.question")}</th><th scope="col">${say("conflict.yours")}</th><th scope="col">${say("conflict.office")}</th></tr></thead><tbody>${rows}</tbody></table><div class="conflict-choices">${button(say("conflict.keep_mine"), "reconcile-mine", "primary")}${button(say("conflict.use_office"), "reconcile-server", "secondary")}</div><p class="field-note">${say("conflict.note")}</p></section>`;
}

// ---------------------------------------------------------------------------
// Catalogue helpers
// ---------------------------------------------------------------------------

const STEPS_V2 = stepsFor(2);
const allQuestionsV2 = () => STEPS_V2.flatMap((step) => questionsFor(2, step));

// Deep equality over strings, arrays and plain objects (key order ignored).
function sameAnswer(a, b) {
  if (!isAnswered(a) && !isAnswered(b)) return true;
  const canonical = (value) =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
        : value;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

// ---------------------------------------------------------------------------
// Intake
// ---------------------------------------------------------------------------

// The fictional-data tools above the form, in the client's language.
const fictionTools = (lang = "en") => {
  const say = (key) => esc(t(key, {}, lang));
  return `<div class="fiction-tools"><span class="demo-fiction">${say("fiction.only")}</span>${button(`${icon("spark")} ${say("fiction.fill")}`, "fill-fictional", "demo")}${button(`${icon("refresh")} ${say("fiction.another")}`, "regenerate-fictional", "demo subtle")}</div>`;
};

// The sub-step form lives in intake-views.mjs (spec 2026-10-04 §2–§6); this
// file passes it the chrome it shares with the office's Add a case.
export function intakeScreen(state) {
  const record = state.savedCase;
  if (!record) return applicationsScreen(state);
  return record.stage === "draft"
    ? intakeFormV2(state, { saveStatus, conflictForm, fictionalTools: state.demoTools === true ? fictionTools(viewLang(state)) : "" })
    : submittedV2(state);
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export const PROGRESS_STEPS = Object.freeze([
  ["progress.step.intake", ["draft", "received", "screening"]],
  ["progress.step.preparation", ["preparation_ready", "preparing", "corrections_required"]],
  ["progress.step.review", ["review_ready", "reviewing"]],
  ["progress.step.signing", ["review_approved"]],
  ["progress.step.filing", ["ready_to_efile", "efiled", "rejected"]],
]);

const REVIEW_STAGES = Object.freeze([
  "review_ready",
  "reviewing",
  "corrections_required",
  "review_approved",
  "ready_to_efile",
  "efiled",
  "rejected",
  "accepted",
]);

// Waiting for documents belongs to Intake, and a Hold sits where it came from:
// a documents Hold at Intake, a Hold from Ready to exit at Signing. A Hold with
// no origin has no step, like a closed case.
const STEP_BY_STAGE = Object.freeze({ awaiting_documents: "progress.step.intake" });
const STEP_BY_HOLD = Object.freeze({
  documents: "progress.step.intake",
  signing: "progress.step.signing",
});

function stepIndex(record) {
  const stage = record.stage;
  if (stage === "accepted") return PROGRESS_STEPS.length;
  const key = stage === "on_hold" ? STEP_BY_HOLD[holdKind(record)] : STEP_BY_STAGE[stage];
  if (key) return PROGRESS_STEPS.findIndex(([label]) => label === key);
  return PROGRESS_STEPS.findIndex(([, stages]) => stages.includes(stage));
}

function progressTrack(record, lang = "en") {
  // An accepted case has finished every step, so none is current.
  const current = stepIndex(record);
  // A closed case has no current step: its notice says what happened instead.
  if (current < 0) return "";
  return `<div class="progress-steps">${PROGRESS_STEPS.map(([label], index) => {
    const status = index < current ? "done" : index === current ? "current" : "";
    const state = index < current ? "progress.step.done" : index === current ? "progress.step.current" : "progress.step.waiting";
    return `<div class="${status}"><span>${index < current ? icon("check") : index + 1}</span><small>${esc(t(label, {}, lang))}</small><em class="sr-only">${esc(t(state, {}, lang))}</em></div>`;
  }).join("")}</div>`;
}

// One card per open request, so every id inside it is scoped to that request:
// two open requests would otherwise render the same checkbox id twice and both
// labels would toggle the first box.
// The office's title and message are shown as typed, with no lang attribute
// (spec §3.4). In Chinese a label says whose words they are; English shows
// them bare, as it always has.
function documentRequest(request, state, lang = "en") {
  const say = (key) => esc(t(key, {}, lang));
  const failed = state.openPanels.includes("upload-failed");
  const simulate = state.openPanels.includes("upload-failure");
  const simulateId = fieldId("simulate-upload-failure", request.id);
  const label = (key) => (lang === "en" ? "" : `<span class="request-label">${say(key)}</span>`);
  return `<div class="action-card"><div class="action-label">${icon("clock")} ${say("progress.action_needed")}</div>${label("progress.request_title")}<h2>${esc(request.title)}</h2>${label("progress.request_message")}<p>${esc(request.message)}</p><div class="upload-zone has-file">${icon("file")}<strong>demo-mileage-record-2025.pdf</strong><span>${say("progress.sample_note")}</span></div><label class="checkbox-row small" for="${simulateId}"><input type="checkbox" id="${simulateId}" ${simulate ? "checked" : ""} data-action="toggle-upload-failure" data-request-id="${esc(request.id)}"><span>${say("progress.simulate_failure")}</span></label>${when(failed, `<p class="error" role="alert">${say("progress.upload_failed")}</p>`)}${caseButton(
    `${say("progress.send_sample")} ${icon("arrow")}`,
    "RESPOND_DOCUMENT",
    "primary",
    `data-request-id="${esc(request.id)}" ${state.busy ? "disabled" : ""}`,
  )}<small class="block">${say("progress.checks_first")}</small></div>`;
}

function reviewProgress(record, lang = "en") {
  const stage = record.stage;
  if (!REVIEW_STAGES.includes(stage)) return "";
  const described = describeStage(stage, lang, record);
  return `<section class="panel review-panel"><div class="section-head"><h2>${esc(t("progress.review", {}, lang))}</h2>${stageBadge(stage, lang, { audience: "client", record })}</div><p>${esc(described.clientMessage)}</p><p class="field-note">${esc(t("progress.review_note", {}, lang))}</p></section>`;
}

// The Withdraw button where the client may withdraw, the contact line where
// they must ask the office (mustContactToWithdraw), and nothing at Draft, E-filed,
// Accepted, Closed or a Hold with no origin.
function withdrawSection(record, lang = "en") {
  const say = (key) => esc(t(key, {}, lang));
  if (canWithdraw(record))
    return `<div class="withdraw-card">${button(say("withdraw.button"), "open-withdraw", "text")}</div>`;
  if (mustContactToWithdraw(record))
    return `<p class="field-note withdraw-contact">${say("withdraw.contact")}</p>`;
  return "";
}

/**
 * The Withdraw dialog's body: one box to tick, then the confirm control. The
 * box's name is the one the WITHDRAW builder reads (`withdraw-confirmed`).
 */
export function withdrawDialogBody(state = {}) {
  const lang = viewLang(state);
  const say = (key) => esc(t(key, {}, lang));
  const id = fieldId("withdraw-confirmed", "withdraw");
  return confirmBody({
    lead: say("withdraw.body"),
    form: {
      fields: `<label class="checkbox-row" for="${id}"><input type="checkbox" id="${id}" name="withdraw-confirmed" value="true" required><span>${say("withdraw.box")}</span></label>`,
    },
    confirm: caseSubmit(say("withdraw.button"), "WITHDRAW", "primary full", state.busy ? "disabled" : ""),
    keep: say("withdraw.keep"),
  });
}

export function progressScreen(state) {
  const record = state.savedCase;
  if (!record) return applicationsScreen(state);
  const lang = viewLang(state);
  const say = (key) => esc(t(key, {}, lang));
  const described = describeStage(record.stage, lang, record);
  const answers = record.answers ?? {};
  const open = (record.requests ?? []).filter(
    (request) => request.status === "open",
  );
  const documents = record.documents ?? [];
  const history = [...(record.history ?? [])].reverse();
  const firstName = answers.tp_first_name;
  return `<main id="main" class="dashboard" tabindex="-1"><div class="page-intro dashboard-intro"><div><span class="overline">${say("progress.overline")}</span><h1>${firstName ? esc(t("progress.hello", { name: firstName }, lang)) : say("progress.title")}</h1><p>${say("progress.intro")}</p></div><div class="id-pill">${icon("folder")}<div><small>${say("id.application_caps")}</small><strong>${esc(record.reference)}</strong></div>${when(record.clientNumber != null, `<div><small>${say("id.client_number_caps")}</small><strong>${esc(formatClientNumber(record.clientNumber))}</strong></div>`)}</div></div><div class="progress-grid"><section><div class="panel status-panel"><div class="section-head"><h2>${say("progress.your_progress")}</h2>${stageBadge(record.stage, lang, { audience: "client", record })}</div>${progressTrack(record, lang)}<p class="status-explanation">${esc(described.clientMessage)}</p></div>${progressDocumentsV2(state, lang)}${
    open.length
      ? open.map((request) => documentRequest(request, state, lang)).join("")
      : `<div class="next-card">${icon("shield")}<div><h3>${say("progress.all_set")}</h3><p>${say("progress.all_set_body")}</p></div></div>`
  }${when(
    documents.length,
    `<section class="panel sent-panel"><div class="section-head"><h2>${say("progress.sent")}</h2></div>${documents
      .map(
        (document) =>
          `<div class="document-row">${icon("file")}<div><strong>${esc(document.filename)}</strong><small>${say("progress.sent_waiting")}</small></div><span class="document-check pending">${icon("clock")}</span></div>`,
      )
      .join("")}</section>`,
  )}${reviewProgress(record, lang)}<section class="panel history-panel"><div class="section-head"><h2>${say("progress.history")}</h2><span class="muted small">${say("progress.history_note")}</span></div>${
    history.length
      ? `<div class="timeline">${history
          .map(
            (entry) =>
              `<div class="timeline-item"><span class="timeline-dot"></span><div><p>${esc(historyLine(entry.message, lang))}</p><small>${esc(formatTime(entry.createdAt, lang))}</small></div></div>`,
          )
          .join("")}</div>`
      : emptyLine(say("progress.history_empty"))
  }</section></section><aside class="right-column"><div class="panel summary-panel"><span class="overline">${say("progress.glance")}</span><h3>${say("progress.details")}</h3>${row(t("progress.tax_year", {}, lang), "2025")}${row(t("progress.service", {}, lang), serviceLabel(answers.service, lang))}${row(t("progress.language", {}, lang), languageNames(clientLanguages(answers), { lang, separator: t("form.list_separator", {}, lang) }))}${row(t("id.application", {}, lang), record.reference)}<div class="gentle-note">${icon("lock")} ${say("progress.private")}</div></div><div class="help-card"><span class="help-card-icon">${icon("help")}</span><h3>${say("progress.here")}</h3><p>${say("progress.questions")}</p>${officeContact()}${button(say("progress.contact"), "open-help", "secondary")}</div>${withdrawSection(record, lang)}${button(say("progress.back"), "open-applications", "text")}</aside></div></main>`;
}

// ---------------------------------------------------------------------------
// The one entry point the app renders through
// ---------------------------------------------------------------------------

export function clientScreen(state) {
  if (state.screen === "reference") return referenceScreen(state);
  if (state.screen === "intake") return intakeScreen(state);
  if (state.screen === "progress") return progressScreen(state);
  return applicationsScreen(state);
}
