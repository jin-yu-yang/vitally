// The version-2 client screens (docs/superpowers/specs/2026-10-04-intake-redesign-design.md
// §2–§6): the rail tree, the sub-step pages, the Documents step, Review &
// submit, the read-only answers after Submit and the progress page's open
// documents. Pure functions of one controller snapshot, like client-views.mjs:
// no store, no timers, no DOM, and everything from a person or the database is
// escaped on the way out.
//
// Rules are never re-implemented here: visibility, marks and the place in the
// form come from intake-form.mjs, the catalogue from intake-catalogue.mjs and
// the cards from document-cards.mjs. This module imports nothing from
// client-views.mjs; the save chip, the conflict panel and the fictional tools
// are passed in as `chrome`.
import { esc, icon, button, caseButton, officeContact } from "./ui.mjs";
import { describeStage } from "./domain.mjs";
import {
  renderQuestion,
  renderRichText,
  formatAnswer,
  reviewAlerts,
  visibleSubsteps,
  resolveSubstep,
  consented,
  substepStatus,
  stepRollup,
} from "./intake-form.mjs";
import {
  CONTACT_FIELDS,
  stepsFor,
  substepsFor,
  findSubstep,
  substepOfQuestion,
  substepQuestions,
  findQuestion,
  wording,
  leadOf,
  introOf,
  isVisible,
  substepTitleOf,
  isAnswered,
  spouseShown,
  visibleAnswers,
} from "./intake-catalogue.mjs";
import { cardsFor } from "./document-cards.mjs";
import { uploadControls } from "./document-upload.mjs";
import { sourceText, viewLang } from "./language.mjs";
import { t } from "./client-text.mjs";

const when = (condition, html) => (condition ? html : "");

const STEPS = stepsFor(2);
const SUBSTEPS = substepsFor(2);
// The client sees Steps 1–9: "Before you start" is shown unnumbered.
const NUMBERED = STEPS.filter((step) => step.id !== "before").map((step) => step.id);
const stepNumber = (stepId) => {
  const at = NUMBERED.indexOf(stepId);
  return at < 0 ? null : at + 1;
};
const dashed = (id) => String(id).replace(/\./g, "-");
const topId = (id) => String(id).replace(/\[.*$/, "");
// Catalogue text in the screen's language, through sourceText (spec
// 2026-10-05 §3): a variant's pair, else the general one.
const localized = (text, variant, lang = "en") =>
  sourceText({ en: text?.[variant]?.en ?? text?.general?.en ?? "", zh: text?.[variant]?.zh ?? text?.general?.zh }, lang);
const stepTitle = (step, lang = "en") => sourceText({ en: step?.title?.en ?? "", zh: step?.title?.zh }, lang);
const substepTitle = (substep, variant, lang = "en", answers) => substepTitleOf(substep, { variant, lang, answers });
const stepLabel = (step, lang = "en") => {
  const n = stepNumber(step.id);
  return n ? `${t("rail.step", { n }, lang)}${stepTitle(step, lang)}` : stepTitle(step, lang);
};
// Card text on the client's screens: English verbatim, Chinese through sourceText.
const cardText = (pair, lang = "en") => (lang === "en" ? (pair?.en ?? "") : sourceText(pair, lang));
const isSameDay = (answers) => answers?.service === "same_day";
const isDocuments = (id) => findSubstep(id)?.step.id === "documents";

export const variantOf = (answers) => (answers?.form_version === "senior" ? "senior" : "general");

/**
 * The server's side of a version-2 case: its answers plus the contact record's
 * four fields (a null contact, or a null inside it, is empty).
 */
export function serverAnswersV2(record) {
  const result = { ...(record?.answers ?? {}) };
  for (const [id, key] of Object.entries(CONTACT_FIELDS)) {
    const value = record?.contact?.[key];
    if (value !== undefined && value !== null) result[id] = value;
  }
  return result;
}

// A section's intro shows on the first sub-step holding its questions, unless
// that sub-step has a lead line (spec §2.1).
const SECTION_OF = new Map(
  STEPS.flatMap((step) => step.sections.flatMap((section) => section.questions.map((question) => [question.id, section]))),
);
const FIRST_SUBSTEP_OF = new Map();
for (const substep of SUBSTEPS)
  for (const id of substep.questions) {
    const section = SECTION_OF.get(id);
    if (section && !FIRST_SUBSTEP_OF.has(section)) FIRST_SUBSTEP_OF.set(section, substep.id);
  }

// Sub-step order, for the alerts list.
const ORDER_OF = new Map(SUBSTEPS.flatMap((substep) => substep.questions).map((id, index) => [id, index]));

// ---------------------------------------------------------------------------
// The view of the draft form
// ---------------------------------------------------------------------------

function formView(state) {
  const record = state.savedCase;
  const answers = state.draftAnswers ?? {};
  const cards = cardsFor(answers, record?.documentCards ?? []);
  const visited = Array.isArray(state.visitedSubsteps) ? state.visitedSubsteps : [];
  const revealed = new Set(state.revealed ?? []);
  const visible = visibleSubsteps(answers, cards, visited);
  const current = resolveSubstep(state.formSubstep, answers, cards, visited) ?? visible[0];
  const substep = findSubstep(current);
  const inStep = visible.filter((id) => findSubstep(id).step.id === substep.step.id);
  const lang = viewLang(state);
  return {
    state,
    lang,
    record,
    answers,
    cards,
    visited,
    revealed,
    visible,
    current,
    substep,
    // The Form 14446 gate: steps 1-9 show locked until 0.4 is ticked.
    locked: !consented(answers),
    variant: variantOf(answers),
    openPanels: Array.isArray(state.openPanels) ? state.openPanels : [],
    marks: { answers, visited, revealed, cards },
    // While an action is in flight the controller ignores a sub-step change
    // or a card mark (one write at a time), so the page offers none: every
    // control that moves the form or marks a card carries this attribute.
    off: offWhileBusy(state),
    within: t("intake.within", { n: inStep.indexOf(current) + 1, total: inStep.length }, lang),
  };
}

// ---------------------------------------------------------------------------
// The rail tree (spec §3.2, §3.3)
// ---------------------------------------------------------------------------

// The attribute for a control that would send while an action is in flight.
const offWhileBusy = (state) => (state?.busy ? " disabled" : "");

// Each mark is one fixed span, so typing can restyle it in place (className
// and textContent only); its icon is drawn by CSS keyed on the span's class.
const markSpan = (id, status) =>
  `<span id="${esc(id)}" class="rail-status is-${esc(status.key)}">${esc(status.text)}</span>`;

function railStep(step, view) {
  const visible = new Set(view.visible);
  const subs = SUBSTEPS.filter((substep) => substep.step.id === step.id && visible.has(substep.id));
  if (!subs.length) return "";
  const panels = view.openPanels;
  const isCurrent = view.substep.step.id === step.id;
  // Expanded when not shut, and either opened or the current step.
  const expanded = !panels.includes(`rail-shut:${step.id}`) && (panels.includes(`rail-open:${step.id}`) || isCurrent);
  const lang = view.lang;
  const marks = { ...view.marks, lang };
  const statuses = new Map(subs.map((substep) => [substep.id, substepStatus(substep.id, marks)]));
  const target = subs.find((substep) => statuses.get(substep.id).key !== "done") ?? subs[0];
  const n = stepNumber(step.id);
  const title = stepTitle(step, lang);
  const id = esc(step.id);
  // Locked (the 14446 gate): no link, but data-substep stays on every span,
  // since the app compares the listed sub-steps with the draft's visible ones.
  const locked = view.locked && step.id !== "before";
  const lockedMark = `<span class="rail-status is-locked">${esc(t("rail.locked", {}, lang))}</span>`;
  const items = subs
    .map((substep) => {
      const here = substep.id === view.current;
      if (locked)
        return `<li><span class="rail-sublink is-locked" data-substep="${esc(substep.id)}" aria-disabled="true"><span class="rail-subtitle">${esc(substepTitle(substep, view.variant, lang, view.answers))}</span>${lockedMark}</span></li>`;
      return `<li><button type="button" class="rail-sublink" data-action="go-substep" data-substep="${esc(substep.id)}"${here ? ' aria-current="step"' : ""}${view.off}><span class="rail-subtitle">${esc(substepTitle(substep, view.variant, lang, view.answers))}</span>${here ? `<small class="rail-here">${esc(t("rail.here", {}, lang))}</small>` : ""}${markSpan(`rail-sub-${dashed(substep.id)}-status`, statuses.get(substep.id))}</button></li>`;
    })
    .join("");
  const headInner = `${n ? `<span class="rail-step-num" aria-hidden="true">${n}</span>` : ""}<span class="rail-step-body"><span class="rail-step-title">${n ? `<span class="sr-only">${esc(t("rail.step", { n }, lang))}</span>` : ""}${esc(title)}</span>${locked ? lockedMark : markSpan(`rail-step-${step.id}-status`, stepRollup(step.id, marks))}</span>`;
  const link = locked
    ? `<span class="rail-link is-locked" data-substep="${esc(target.id)}" aria-disabled="true">${headInner}</span>`
    : `<button type="button" class="rail-link" data-action="go-substep" data-substep="${esc(target.id)}"${view.off}>${headInner}</button>`;
  return `<li class="rail-step${isCurrent ? " is-current" : ""}" data-step-id="${id}"><div class="rail-step-head"><button type="button" class="rail-toggle" data-action="toggle-rail-step" data-step-id="${id}" aria-expanded="${expanded}" aria-controls="rail-subs-${id}">${icon("expand")}<span class="sr-only">${esc(t("rail.toggle", { title }, lang))}</span></button>${link}</div><ol id="rail-subs-${id}" class="rail-subs"${expanded ? "" : " hidden"}>${items}</ol></li>`;
}

function rail(view) {
  const open = view.openPanels.includes("rail-all");
  const position = view.visible.indexOf(view.current) + 1;
  const count = view.visible.length;
  const say = (key, params) => esc(t(key, params, view.lang));
  // The phone bar shows at ≤800px only (CSS); the tree folds behind it there.
  return `<div class="rail-phone"><span>${esc(stepTitle(view.substep.step, view.lang))} · ${esc(view.within)}</span><button type="button" class="btn secondary" data-action="toggle-panel" data-panel="rail-all" aria-expanded="${open}" aria-controls="rail-tree">${say("rail.all_steps")}</button></div><nav class="rail-nav" aria-label="${say("rail.nav")}"><ol id="rail-tree" class="rail-tree${open ? " is-open" : ""}">${STEPS.map((step) => railStep(step, view)).join("")}</ol></nav><div class="rail-progress"><progress class="rail-bar" max="${count}" value="${position}" aria-hidden="true"></progress><p>${say("rail.part", { n: position, total: count })}</p></div>`;
}

// ---------------------------------------------------------------------------
// The page: header, questions and actions (spec §3.4)
// ---------------------------------------------------------------------------

function header(view) {
  const step = view.substep.step;
  const n = stepNumber(step.id);
  const lang = view.lang;
  // English overlines are capitals; Chinese has none.
  const name = lang === "en" ? stepTitle(step).toUpperCase() : stepTitle(step, lang);
  const overline = n ? t("intake.step_overline", { n, total: NUMBERED.length, name }, lang) : name;
  return `<div class="page-intro"><span class="overline">${esc(overline)}</span><h1>${esc(substepTitle(view.substep, view.variant, lang, view.answers))}</h1><p class="substep-count">${esc(view.within)}</p></div>`;
}

// The sub-step's visible questions in its order, one card per heading group.
// A heading starts a new group; a group with no visible question is left out.
function questionsBody(view) {
  const { substep, answers, variant, lang } = view;
  const questions = substepQuestions(substep.id);
  const groups = [];
  for (const question of questions) {
    if (question.heading || !groups.length) groups.push({ heading: question.heading ?? null, questions: [] });
    groups.at(-1).questions.push(question);
  }
  const showMissing = view.visited.includes(view.current);
  const cards = groups
    .map((group) => ({ ...group, questions: group.questions.filter((question) => isVisible(question, answers)) }))
    .filter((group) => group.questions.length)
    .map(
      (group) =>
        `<div class="q-card">${group.heading ? `<h2 class="q-heading">${esc(localized(group.heading, variant, lang))}</h2>` : ""}${group.questions
          .map((question) =>
            renderQuestion(question, answers[question.id], {
              variant,
              lang,
              scope: "client",
              answers,
              showMissing,
              revealed: view.revealed,
            }),
          )
          .join("")}</div>`,
    )
    .join("");
  const extra =
    substep.id === "before.ready"
      ? `<p class="q-intro-extra">${esc(t(isSameDay(answers) ? "intake.will_bring" : "intake.will_upload", {}, lang))}</p>`
      : "";
  const details = substep.id === "about.sign" ? signDetails(answers, lang) : "";
  const lead = leadOf(substep, { variant, lang, answers });
  let intro = "";
  if (lead) intro = `<p class="q-lead">${esc(lead)}</p>`;
  else {
    const section = SECTION_OF.get(questions[0]?.id);
    const text = section && FIRST_SUBSTEP_OF.get(section) === substep.id ? introOf(section, { variant, lang, answers }) : "";
    if (text) intro = `<div class="q-intro">${renderRichText(text)}${extra}</div>`;
  }
  if (extra && !intro.includes(extra)) intro += extra;
  return `<div class="q-section">${intro}${details}${cards}</div>`;
}

// What Form 14446 will print, read-only, above its signature boxes (change
// add-form-14446-consent, design D3): the client's details and, while a joint
// return is possible (J), the spouse's. Formatted as the summary formats them.
function signDetails(answers, lang) {
  // Read what the draft reads (visibleAnswers), so a hidden or stale answer
  // never shows here: a late spouse has no phone or email rows at all.
  const visible = visibleAnswers(2, answers);
  const shown = (id) => (isAnswered(visible[id]) ? formatAnswer(findQuestion(2, id), visible[id], { lang, answers: visible }) : "");
  const asked = (id) => isVisible(findQuestion(2, id), answers);
  const signer = (label, [first, middle, last, dob, phone, email]) => {
    const rows = [
      [t("sign.name", {}, lang), [visible[first], visible[middle], visible[last]].filter(isAnswered).join(" ")],
      [t("sign.dob", {}, lang), shown(dob)],
      ...(asked(phone) ? [[t("sign.phone", {}, lang), shown(phone)]] : []),
      ...(asked(email) ? [[t("sign.email", {}, lang), isAnswered(visible[email]) ? String(visible[email]).trim() : ""]] : []),
    ];
    return `<div class="sign-signer"><h2 class="q-heading">${esc(label)}</h2><dl>${rows
      .map(([dt, dd]) => `<dt>${esc(dt)}</dt><dd>${esc(dd || t("sign.none", {}, lang))}</dd>`)
      .join("")}</dl></div>`;
  };
  const spouseLabel = answers.marital_status === "widowed" ? "sign.late_spouse" : "sign.spouse";
  return `<div class="sign-details">${signer(t("sign.you", {}, lang), ["tp_first_name", "tp_middle_name", "tp_last_name", "tp_dob", "tp_phone", "email"])}${when(
    spouseShown(answers),
    signer(t(spouseLabel, {}, lang), ["sp_first_name", "sp_middle_name", "sp_last_name", "sp_dob", "sp_phone", "vc_sp_email"]),
  )}</div>`;
}

function actions(view, alerts) {
  const { state, visible, current } = view;
  const say = (key) => esc(t(key, {}, view.lang));
  const off = Boolean(state.conflict || state.busy);
  // 0.4's Continue waits for the consent, and the line says why (add-form-14446-consent).
  const gated = current === "before.virtual" && view.locked;
  let primary;
  if (current === "review.submit") {
    const confirmed = view.openPanels.includes("confirmed");
    primary = caseButton(
      `${say("intake.submit")} ${icon("arrow")}`,
      "SUBMIT",
      "primary",
      alerts.length > 0 || !confirmed || off ? "disabled" : "",
    );
  } else if (state.returnToSummary && !gated) {
    primary = `<button type="button" class="btn primary" data-action="back-to-summary"${off ? " disabled" : ""}>${say("intake.back_to_summary")}</button>`;
  } else {
    // 9.1's Continue waits for the alerts, and the line says why
    // (openspec change gate-review-and-redesign-summary, design D4).
    const blocked = (current === "review.check" && alerts.length > 0) || gated;
    const blockedId = gated ? "consent-blocked" : "continue-blocked";
    const blockedKey = gated ? "consent.blocked" : "review.continue_blocked";
    primary = `${when(blocked, `<p id="${blockedId}" class="form-blocked">${say(blockedKey)}</p>`)}<button type="submit" class="btn primary"${blocked ? ` aria-describedby="${blockedId}"` : ""}${off || blocked ? " disabled" : ""}>${say("intake.continue")} ${icon("arrow")}</button>`;
  }
  return `<div class="form-actions"><div>${when(visible[0] !== current, button(`${icon("back")} ${say("intake.back")}`, "back-step", "text", view.off.trim()))}</div>${primary}</div>`;
}

// ---------------------------------------------------------------------------
// Document cards (spec §6.4–§6.6)
// ---------------------------------------------------------------------------

const STATUS = Object.freeze({
  not_done: { word: "Not done", key: "doc.status.not_done", icon: "upload" },
  later: { word: "Later", key: "doc.status.later", icon: "clock" },
  none: { word: "Don't have", key: "doc.status.none", icon: "close" },
  sent: { word: "Uploaded · to check", key: "doc.status.sent", icon: "clock" },
  received: { word: "Received by PCDC", key: "doc.status.received", icon: "check" },
  verified: { word: "Verified by PCDC", key: "doc.status.verified", icon: "check" },
});
const statusOf = (card) => STATUS[card.status] ?? STATUS.not_done;
const statusWord = (card, lang = "en") => (lang === "en" ? statusOf(card).word : t(statusOf(card).key, {}, lang));
const markButton = (slot, status, text, off = "") =>
  button(esc(text), "mark-card", "secondary", `data-slot="${esc(slot)}" data-status="${status}"${off}`);

// The words on a card: the client's own (4b2), or the office's, which marks
// for the client in front of it (Add a case). The office's reason line names
// the question that asked for the card, never the client's "You said…".
// The client's words are text keys (the English is the same); the office's
// are English, like every staff screen.
const CARD_WORDS = Object.freeze({
  client: {
    later: "doc.later",
    none: "doc.none",
  },
  office: {
    later: "Later",
    none: "Don't have",
  },
});

// One card. `links` is false where the answers are locked (the progress page),
// so the why line is plain text there. The optional "other" card has the
// upload buttons but no marks and no status (ruling R1). `off` is
// `offWhileBusy`: the marks and the why link wait for an action in flight.
// `office` puts the card in the office's words (Add a case), which are always
// English: a hint or owner line with an `office` version shows that one;
// otherwise `lang` is the client's language (spec 2026-10-05 §3).
// Card text reaches the screen through sourceText.
export function docCard(card, { links = true, off = "", office = false, lang = "en", answers, uploadLink = null, record = null } = {}) {
  const id = `doc-${esc(dashed(card.slotId))}`;
  const optional = card.group === "optional";
  const language = office ? "en" : lang;
  const say = (key) => t(key, {}, language);
  const text = (pair) => cardText(pair, language);
  const shown = (pair) => (office && pair?.office ? pair.office : text(pair));
  const words = office ? CARD_WORDS.office : Object.fromEntries(Object.entries(CARD_WORDS.client).map(([k, key]) => [k, say(key)]));
  const target = links && card.ask ? substepOfQuestion(card.ask) : null;
  const whyText = text(card.why);
  const asked = office && card.ask ? wording(findQuestion(2, card.ask), { variant: "general", lang: "en", answers }) : "";
  const why = office
    ? asked
      ? `<p class="doc-why">Asked by: ${esc(asked)}</p>`
      : ""
    : whyText
      ? `<p class="doc-why">${target ? `<button type="button" class="inline" data-action="go-substep" data-substep="${esc(target)}"${off}>${esc(whyText)}</button>` : esc(whyText)}</p>`
      : "";
  const hintText = card.hint?.en ? shown(card.hint) : "";
  const hint = hintText ? `<p class="doc-hint">${esc(hintText)}</p>` : "";
  const sent = ["sent", "received", "verified"].includes(card.status);
  // Only staff's received / verified is final for the client. A "sent" they
  // reported by mistake can still be changed to Later, Don't have or not done.
  const confirmed = ["received", "verified"].includes(card.status);
  const upload = office || card.status === "verified" || card.status === "received" ? "" : uploadControls({
    url: uploadLink, record, lang: language, sent,
    off,
    action: `data-action="mark-card" data-slot="${esc(card.slotId)}" data-status="sent"`,
  });
  const status = statusOf(card);
  const marks = optional && card.status === "not_done"
    ? ""
    : `<div class="doc-marks">${confirmed || optional ? "" : markButton(card.slotId, "later", words.later, off)}${confirmed || optional ? "" : markButton(card.slotId, "none", words.none, off)}${when(card.status !== "not_done" && !confirmed, markButton(card.slotId, "not_done", say("doc.mark_not_done"), off))}</div><p class="doc-status is-${esc(card.status)}" id="${id}-status" tabindex="-1">${icon(status.icon)}<span class="sr-only">${esc(say("doc.status"))}</span>${esc(statusWord(card, language))}</p>`;
  return `<article class="doc-card" id="${id}" data-slot="${esc(card.slotId)}" tabindex="-1"><h3>${esc(text(card.label))}</h3><p class="doc-owner">${esc(shown(card.ownerLine))}</p>${why}${hint}${upload}${marks}</article>`;
}

// Same-day: a printable checklist, Needed first and then Maybe needed, with no
// buttons and no statuses. The optional card is neither, so it is left out.
function bringList(cards, lang = "en") {
  const text = (pair) => cardText(pair, lang);
  const items = [...cards.filter((card) => card.group === "needed"), ...cards.filter((card) => card.group === "maybe")];
  return `<ul class="bring-list">${items
    .map((card) => {
      const maybe = card.group === "maybe";
      return `<li class="bring-item${maybe ? " is-maybe" : ""}"><strong>${esc(text(card.label))}</strong><span class="doc-owner">${esc(text(card.ownerLine))}</span>${card.hint?.en ? `<span class="doc-hint">${esc(text(card.hint))}</span>` : ""}${maybe ? `<small class="bring-maybe">${esc(t("doc.maybe", {}, lang))}</small>` : ""}</li>`;
    })
    .join("")}</ul>`;
}

function documentsBody(view) {
  const { substep, cards, lang } = view;
  if (substep.cards === "bring") return bringList(cards, lang);
  const mine = cards.filter((card) => card.substep === substep.cards);
  const main = mine.filter((card) => card.group !== "maybe");
  const maybe = mine.filter((card) => card.group === "maybe");
  const one = (card) => docCard(card, { off: view.off, lang, uploadLink: view.state.clientDocumentsUrl, record: view.record });
  if (!maybe.length) return `<div class="doc-list">${main.map(one).join("")}</div>`;
  const panel = `maybe:${substep.id}`;
  const open = view.openPanels.includes(panel);
  const listId = `doc-maybe-${esc(dashed(substep.id))}`;
  return `<div class="doc-list">${main.map(one).join("")}</div><div class="doc-maybe"><button type="button" class="doc-maybe-toggle" data-action="toggle-panel" data-panel="${esc(panel)}" aria-expanded="${open}" aria-controls="${listId}">${esc(t("doc.maybe_count", { n: maybe.length }, lang))}</button><div id="${listId}" class="doc-list"${open ? "" : " hidden"}>${open ? maybe.map(one).join("") : ""}</div></div>`;
}

// ---------------------------------------------------------------------------
// Review & submit (spec §5)
// ---------------------------------------------------------------------------

// The words an alert lists an id under: its question's wording, or for a
// household sub-field "Person <n+1>: <sub-question wording>".
function itemLabel(id, variant, lang = "en", answers) {
  const options = { variant, lang, answers };
  const member = /^([^[]+)\[(\d+)\]\.(.+)$/.exec(id);
  if (member) {
    const field = (findQuestion(2, member[1])?.fields ?? []).find((f) => f.id === member[3]);
    return t("alert.member", { n: Number(member[2]) + 1, field: wording(field, options) || member[3] }, lang);
  }
  return wording(findQuestion(2, id), options) || id;
}

// Sub-step order: the question, then the member, then the sub-field.
function itemOrder(id) {
  const top = topId(id);
  const member = /\[(\d+)\]\.(.+)$/.exec(id);
  const subs = findQuestion(2, top)?.fields ?? [];
  return [ORDER_OF.get(top) ?? -1, member ? Number(member[1]) : -1, member ? subs.findIndex((f) => f.id === member[2]) : -1];
}
const byOrder = (a, b) => {
  const [x, y] = [itemOrder(a.id), itemOrder(b.id)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

// Alerts block 9.1's Continue and Submit: every missing required answer and
// every invalid one, from the draft alone (reviewAlerts, design D2).
function alertsOf(answers) {
  return reviewAlerts(answers).map((item) => ({
    ...item,
    flag: item.kind === "missing" ? "alert.missing" : "alert.invalid",
    substep: substepOfQuestion(topId(item.id)),
  }));
}

// Warnings never block: Needed cards Not done or Later, and the open Maybe
// needed cards as one line. None for same-day.
function warningsOf(view) {
  if (isSameDay(view.answers)) return { needed: [], maybe: [] };
  const open = (card) => card.status === "not_done" || card.status === "later";
  return {
    needed: view.cards.filter((card) => card.group === "needed" && open(card)),
    maybe: view.cards.filter((card) => card.group === "maybe" && open(card)),
  };
}

function checkBody(view, alerts) {
  const { lang } = view;
  const say = (key, params) => esc(t(key, params, lang));
  const warnings = warningsOf(view);
  let body = "";
  if (alerts.length) {
    const groups = STEPS.map((step) => ({
      step,
      items: alerts.filter((item) => findSubstep(item.substep)?.step.id === step.id).sort(byOrder),
    })).filter((group) => group.items.length);
    body += `<div class="alerts-block"><h3>${say("review.fix_first")}</h3>${groups
      .map(
        ({ step, items }) =>
          `<div class="alerts-step"><h4>${esc(stepLabel(step, lang))}</h4><ul>${items
            .map(
              (item) =>
                `<li><button type="button" class="alert-item is-${item.kind}" data-action="go-substep" data-substep="${esc(item.substep)}"${view.off}><span class="alert-q">${esc(itemLabel(item.id, view.variant, lang, view.answers))}</span><span class="alert-flag">${say(item.flag)}</span>${icon("chevron")}</button></li>`,
            )
            .join("")}</ul></div>`,
      )
      .join("")}</div>`;
  }
  if (warnings.needed.length || warnings.maybe.length) {
    const firstDocuments = view.visible.find(isDocuments);
    const n = warnings.maybe.length;
    body += `<div class="warnings-block"><h3>${say("review.can_submit")}</h3><ul>${warnings.needed
      .map(
        (card) =>
          `<li class="warning-item"><span class="warning-doc"><strong>${esc(cardText(card.label, lang))}</strong><small>${esc(cardText(card.ownerLine, lang))} · ${esc(statusWord(card, lang))}</small></span><button type="button" class="btn secondary" data-action="go-substep" data-substep="documents.${esc(card.substep)}" data-focus="doc-${esc(dashed(card.slotId))}"${view.off}>${say("review.upload_now")}</button></li>`,
      )
      .join("")}${when(
      n && firstDocuments,
      `<li class="warning-maybe"><button type="button" class="inline" data-action="go-substep" data-substep="${esc(firstDocuments)}"${view.off}>${say("review.more_maybe", { n })}</button></li>`,
    )}</ul></div>`;
  }
  if (!body) body = `<p class="alerts-empty">${say("review.empty")}</p>`;
  return `<div class="review-intro"><p>${say("review.intro")}</p><p>${say("review.free")}</p></div><section class="alerts-panel" aria-labelledby="alerts-title"><h2 id="alerts-title" tabindex="-1">${say("review.alerts_title")}</h2>${body}</section>`;
}

const row = (label, value) =>
  `<div class="detail-row"><span>${esc(label)}</span><strong>${esc(value).replace(/\n/g, "<br>")}</strong></div>`;

// One summary section (design D7): the step's heading is its toggle, and its
// body is hidden while `summary-shut:<step id>` is in openPanels. The toggle's id lets any
// redraw put the keyboard back on it (ui.mjs restores by id first). Print shows every body
// (styles.css), so folding changes only the screen.
function summarySection(stepId, title, inner, { panels = [], lang = "en", extraClass = "" } = {}) {
  const shut = panels.includes(`summary-shut:${stepId}`);
  const id = esc(stepId);
  return `<section class="summary-step${extraClass}"><h2 class="summary-step-head"><button type="button" id="summary-toggle-${id}" class="summary-toggle" data-action="toggle-panel" data-panel="summary-shut:${id}" aria-expanded="${!shut}" aria-controls="summary-body-${id}" aria-label="${esc(t("summary.toggle", { section: title }, lang))}">${icon("expand")}<span>${esc(title)}</span></button></h2><div id="summary-body-${id}" class="summary-body"${shut ? " hidden" : ""}>${inner}</div></section>`;
}

// Every visible answer, grouped by step and sub-step, through formatAnswer.
// With `change`, each sub-step is listed with its Change link even when
// nothing in it is answered yet; without, only what has answers. `off` is
// `offWhileBusy` for the Change links.
function answerSteps(answers, variant, { change, off = "", lang = "en", panels = [] }) {
  const visible = new Set(visibleSubsteps(answers, []));
  const options = { variant, lang, answers };
  const [stepClass, subClass] = change ? ["summary-step", "summary-sub"] : ["answer-step", "answer-sub"];
  return STEPS.map((step) => {
    const subs = SUBSTEPS.filter((substep) => substep.step.id === step.id && substep.kind === "questions" && visible.has(substep.id))
      .map((substep) => {
        const rows = substepQuestions(substep.id)
          .filter((question) => isVisible(question, answers))
          .map((question) => [question, formatAnswer(question, answers[question.id], options)])
          .filter(([, text]) => text !== null)
          .map(([question, text]) => row(wording(question, options), text))
          .join("");
        const title = esc(substepTitle(substep, variant, lang, answers));
        if (!change) return rows ? `<div class="${subClass}"><h3>${title}</h3>${rows}</div>` : "";
        return `<div class="${subClass}"><div class="summary-sub-head"><h3>${title}</h3><button type="button" class="inline" data-action="change-substep" data-substep="${esc(substep.id)}"${off}>${esc(t("summary.change", {}, lang))}</button></div>${rows || `<p class="summary-none">${esc(t("summary.none", {}, lang))}</p>`}</div>`;
      })
      .join("");
    if (!subs) return "";
    return change
      ? summarySection(step.id, stepTitle(step, lang), subs, { panels, lang })
      : `<section class="${stepClass}"><h2>${esc(stepTitle(step, lang))}</h2>${subs}</section>`;
  }).join("");
}

// The cards and their status, so the printout shows what is still to come.
function documentsSummary(view) {
  const { lang } = view;
  const step = STEPS.find((candidate) => candidate.id === "documents");
  if (isSameDay(view.answers))
    return summarySection("documents", t("doc.bring", {}, lang), bringList(view.cards, lang), { panels: view.openPanels, lang, extraClass: " summary-documents" });
  const subs = view.visible
    .filter(isDocuments)
    .map((id) => {
      const substep = findSubstep(id);
      const cards = view.cards.filter((card) => card.substep === substep.cards && card.group !== "optional");
      if (!cards.length) return "";
      const rows = cards
        .map((card) =>
          row(
            `${cardText(card.label, lang)} · ${cardText(card.ownerLine, lang)}${card.group === "maybe" ? ` · ${t("doc.maybe", {}, lang)}` : ""}`,
            statusWord(card, lang),
          ),
        )
        .join("");
      return `<div class="summary-sub"><div class="summary-sub-head"><h3>${esc(substepTitle(substep, view.variant, lang, view.answers))}</h3><button type="button" class="inline" data-action="change-substep" data-substep="${esc(id)}"${view.off}>${esc(t("summary.change", {}, lang))}</button></div>${rows}</div>`;
    })
    .join("");
  return subs ? summarySection("documents", stepTitle(step, lang), subs, { panels: view.openPanels, lang, extraClass: " summary-documents" }) : "";
}

// Today's long date for the printout: "October 5, 2026", or 2026年10月5日 in Chinese.
const formatToday = (date, lang = "en") =>
  lang === "en"
    ? date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;

// The draft Form 14446 (add-form-14446-consent, design D5): PCDC has only an
// English and a 繁體 copy, so there is no 简体 button. The screen language's
// form comes first (a Chinese screen gets 繁體), the other is an inline button.
function draft14446Buttons(lang) {
  const english = lang === "en";
  const first = english ? "en" : "zh-t";
  const other = english
    ? button(esc(t("draft.form_zh_t", {}, lang)), "view-draft", "inline", 'data-draft="14446" data-form="zh-t" lang="zh-Hant"')
    : button(esc(t("draft.form_en", {}, lang)), "view-draft", "inline", 'data-draft="14446" data-form="en"');
  // A Chinese screen opens the 繁體 form, so the button says so in the screen's script.
  const name = english ? t("draft14446.view", {}, lang) : `${t("draft14446.view", {}, lang)}（${t("draft.form_zh_t", {}, lang)}）`;
  return `${button(`${icon("file")} ${esc(name)}`, "view-draft", "secondary", `data-draft="14446" data-form="${first}"`)}<span class="draft-languages">${other}</span>`;
}

// The summary page (gate-review-and-redesign-summary, design D6-D8): the
// intro, then Print and the draft Form 14446, then Expand all and Collapse all,
// then the printed block. Only `.summary-print` prints, every section open.
function summaryBody(view, today) {
  const { lang } = view;
  const say = (key, params) => t(key, params, lang);
  const intro = `<div class="summary-intro">${renderRichText(say("summary.intro_all"))}${renderRichText(say("summary.intro_change", { change: say("summary.change") }))}${renderRichText(say("summary.intro_tools"))}</div>`;
  const tools = `<div class="summary-tools">${button(`${icon("print")} ${esc(say("doc.print"))}`, "print-summary", "secondary")}${draft14446Buttons(lang)}<p id="draft-ready" class="draft-ready" aria-live="polite"></p></div>`;
  const fold = `<div class="summary-fold"><button type="button" id="summary-expand-all" class="btn text" data-action="summary-expand-all">${esc(say("summary.expand_all"))}</button><button type="button" id="summary-collapse-all" class="btn text" data-action="summary-collapse-all">${esc(say("summary.collapse_all"))}</button></div>`;
  const printed = `<div class="summary-print"><div class="summary-meta">${row(say("id.application"), view.record?.reference)}${row(say("summary.date"), formatToday(today, lang))}</div>${answerSteps(view.answers, view.variant, { change: true, off: view.off, lang, panels: view.openPanels })}${documentsSummary(view)}</div>`;
  return intro + tools + fold + printed;
}

function submitBody(view) {
  const say = (key) => esc(t(key, {}, view.lang));
  const confirmed = view.openPanels.includes("confirmed");
  return `<label class="checkbox-row" for="field-confirmed"><input type="checkbox" id="field-confirmed" name="confirmed" ${confirmed ? "checked" : ""}><span>${say("submit.confirm")}</span></label><p class="field-note">${say("submit.note")}</p>`;
}

// ---------------------------------------------------------------------------
// The screens
// ---------------------------------------------------------------------------

/**
 * The version-2 draft form. `chrome` is `{ saveStatus, conflictForm,
 * fictionalTools }` from client-views.mjs, plus an optional `today` (a Date)
 * for the summary's printed date.
 */
export function intakeFormV2(state, chrome = {}) {
  const view = formView(state);
  const alerts = alertsOf(view.answers);
  const today = chrome.today instanceof Date && !Number.isNaN(chrome.today.getTime()) ? chrome.today : new Date();
  const kind = view.substep.kind;
  const body =
    kind === "documents"
      ? documentsBody(view)
      : view.current === "review.check"
        ? checkBody(view, alerts)
        : view.current === "review.summary"
          ? summaryBody(view, today)
          : view.current === "review.submit"
            ? submitBody(view)
            : questionsBody(view);
  const reference = view.record?.reference;
  const say = (key) => esc(t(key, {}, view.lang));
  return `<main id="main" class="workspace intake-v2" tabindex="-1"><aside class="intake-sidebar"><div class="sidebar-top"><span class="overline">${say("intake.overline")}</span><h2>${say("intake.sidebar_1")}<br>${say("intake.sidebar_2")}</h2>${rail(view)}</div><div class="sidebar-help">${icon("help")}<h3>${say("intake.help_title")}</h3><p>${say("intake.help_body")}</p>${officeContact()}</div></aside><section class="form-workspace"><div class="application-meta"><span>${esc(reference)}</span>${chrome.saveStatus ? chrome.saveStatus(state) : ""}</div>${chrome.conflictForm ? chrome.conflictForm(state) : ""}${header(view)}${chrome.fictionalTools ?? ""}<form id="intake-v2-form" novalidate data-substep="${esc(view.current)}">${body}${actions(view, alerts)}</form></section></main>`;
}

/** After submission: read-only, grouped by step and sub-step (contact fields from record.contact). */
export function submittedV2(state) {
  const record = state.savedCase;
  const answers = serverAnswersV2(record);
  const lang = viewLang(state);
  const say = (key) => esc(t(key, {}, lang));
  return `<main id="main" class="narrow" tabindex="-1"><div class="page-intro"><span class="overline">${esc(record.reference)}</span><h1>${say("submitted.title")}</h1><p>${esc(describeStage(record.stage, lang).clientMessage)}</p></div><div class="panel answers-v2">${answerSteps(answers, variantOf(answers), { change: false, lang })}</div><p class="field-note">${say("submitted.note")}</p>${button(`${say("submitted.progress")} ${icon("arrow")}`, "open-progress", "primary full")}</main>`;
}

/**
 * The progress page's documents (spec §5.4): the Needed cards still Not done
 * or Later, with their marks, or for same-day the printable "Bring these to
 * your visit" list. Empty when there is nothing open, or once the case is
 * closed (the server refuses card marks then).
 */
export function progressDocumentsV2(state, lang = "en") {
  const record = state.savedCase;
  if (!record || record.stage === "closed") return "";
  const answers = serverAnswersV2(record);
  const cards = cardsFor(answers, record.documentCards ?? []);
  const say = (key) => esc(t(key, {}, lang));
  const head = (title) =>
    `<div class="section-head"><h2 id="open-documents-title">${title}</h2></div>`;
  if (isSameDay(answers))
    return `<section class="panel open-documents" aria-labelledby="open-documents-title"><div class="summary-print">${head(say("doc.bring"))}${row(t("id.application", {}, lang), record.reference)}${bringList(cards, lang)}</div><div class="summary-tools">${button(`${icon("print")} ${say("doc.print")}`, "print-summary", "secondary")}</div></section>`;
  const open = cards.filter((card) => card.group === "needed" && card.status !== "none" && card.status !== "verified" && card.status !== "received");
  if (!open.length) return "";
  return `<section class="panel open-documents" aria-labelledby="open-documents-title">${head(say("doc.open"))}<p class="field-note">${say("doc.open_note")}</p><div class="doc-list">${open.map((card) => docCard(card, { links: false, off: offWhileBusy(state), lang, uploadLink: state.clientDocumentsUrl, record })).join("")}</div></section>`;
}
