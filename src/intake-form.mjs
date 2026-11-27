// The shared version-2 intake renderer (docs/superpowers/specs/2026-09-30-intake-screens-design.md §2).
// It is pure: it reads no controller state, and screens pass in what it needs.
// Catalogue rules (visibility, answered, value checks, the missing list) come
// from intake-catalogue.mjs and are never re-implemented here. Only
// describeControl, readField and readForm touch the DOM, and they are thin
// wrappers over valuesFromControls, which holds every reading rule.
import { esc, button } from "./ui.mjs";
import {
  CATALOGUE, stepsFor, findQuestion, wording, isVisible, isAnswered, spouseShown,
  checkValue, missingToSubmit, substepsFor, findSubstep, substepQuestions, memberNameParts,
} from "./intake-catalogue.mjs";
import { sourceText, localeOf, isLang } from "./language.mjs";
import { t, sentence } from "./client-text.mjs";

const TEXT_LIKE = new Set(["text", "longtext", "signature", "email", "phone", "zip", "year", "number", "date"]);
const TEXT_LIMIT = 200; // checkValue's limit for text and signature
const LONGTEXT_LIMIT = 5000;
const COUNT_FROM = LONGTEXT_LIMIT - 500; // the count shows within 500 of the limit
const SELECT_OVER = 6; // a choice with more options than this is a <select>
const MEMBER_LIMIT = 10;
const NONE = "none"; // "No one": clears the other options of a multi or who
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Every text function here takes `lang` (default "en"); with "en" its output is
// today's English, byte for byte. Staff screens call them without it.
const num = (n, lang) => Number(n).toLocaleString(localeOf(lang));

/**
 * The date boxes in the reading order of the language: month, day, year in
 * English; year, month, day (年 / 月 / 日) in Chinese. Ids stay base-<part>.
 */
export function datePartsFor(lang = "en") {
  const box = (part, size) => ({ part, label: t(`date.${part}`, {}, lang), hint: t(`date.${part}_hint`, {}, lang), size });
  const [year, month, day] = [box("year", 4), box("month", 2), box("day", 2)];
  return isLang(lang) && lang !== "en" ? [year, month, day] : [month, day, year];
}

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const asSet = (value) => (value instanceof Set ? value : new Set(Array.isArray(value) ? value : []));
const everySubstepQuestions = () =>
  substepsFor(2).filter((substep) => substep.kind === "questions").flatMap((substep) => substepQuestions(substep.id));
// A sub-step id's questions, or every sub-step's when null.
const questionsOf = (substepId) =>
  substepId === null || substepId === undefined ? everySubstepQuestions() : substepQuestions(substepId);

// ---------------------------------------------------------------------------
// Options, tips and rich text
// ---------------------------------------------------------------------------

const optionLabel = (option, { variant = "general", lang = "en" } = {}) => {
  const l = option?.label;
  return sourceText({ en: l?.[variant]?.en ?? l?.general?.en ?? option?.value ?? "", zh: l?.[variant]?.zh ?? l?.general?.zh }, lang);
};

// Every option a question can hold: its own, or fixedOptions for yesno (its own
// values, labelled from the fixed list) and who.
function allOptions(question) {
  if (question.type === "who") return CATALOGUE.fixedOptions.who.options;
  if (question.type === "yesno")
    return (question.options ?? []).map(
      (option) => CATALOGUE.fixedOptions.yesno.options.find((fixed) => fixed.value === option.value) ?? option,
    );
  return question.options ?? [];
}

// For a client who isn't married, a "who" question asks about the client alone
// (design D8): "me" reads as Yes and "none" as No, with the yes/no labels, as
// radio buttons. The saved answer is still ["me"] or ["none"].
const ALONE = { me: "yes", none: "no" };
const askedAlone = (question, answers) => question?.type === "who" && !spouseShown(answers);
const asAloneOption = (option) => {
  const yesno = CATALOGUE.fixedOptions.yesno.options.find((fixed) => fixed.value === ALONE[option.value]);
  return yesno ? { value: option.value, label: yesno.label } : option;
};

// The options rendered now: who's "My spouse" only while married; Yes/No when asked alone.
const shownOptions = (question, answers) =>
  askedAlone(question, answers)
    ? allOptions(question).filter((option) => option.value !== "spouse").map(asAloneOption)
    : allOptions(question);

const labelOf = (question, value, options) => {
  let option = question ? allOptions(question).find((o) => o.value === value) : undefined;
  // Only with the application's answers: catalogue-level labels stay Me / No one.
  if (option && options?.answers && askedAlone(question, options.answers)) option = asAloneOption(option);
  return option ? optionLabel(option, options) : String(value);
};

/** Intros and tips: escape, then **bold**, "- " lists and blank-line paragraphs. */
export function renderRichText(text) {
  const inline = (line) => esc(line).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  const blocks = String(text ?? "").replace(/\r\n?/g, "\n").split(/\n[ \t]*\n/);
  return blocks
    .map((block) => {
      let html = "";
      let lines = [];
      let items = [];
      const flushLines = () => {
        if (lines.length) html += `<p>${lines.map(inline).join("<br>")}</p>`;
        lines = [];
      };
      const flushItems = () => {
        if (items.length) html += `<ul>${items.map((item) => `<li>${inline(item)}</li>`).join("")}</ul>`;
        items = [];
      };
      for (const line of block.split("\n")) {
        if (line.trim() === "") continue;
        const item = /^\s*- (.*)$/.exec(line);
        if (item) {
          flushLines();
          items.push(item[1]);
        } else {
          flushItems();
          lines.push(line);
        }
      }
      flushLines();
      flushItems();
      return html;
    })
    .join("");
}

// A tip with a condition renders only while it holds. Upload tips are text only.
// Each tip is converted on its own, before the tips are joined.
const tipsOf = (question, { variant, lang, answers }) =>
  (question.tips?.[variant] ?? question.tips?.general ?? [])
    .filter((tip) => isVisible(tip, answers))
    .map((tip) => sourceText({ en: tip.en ?? "", zh: tip.zh }, lang))
    .filter((tip) => tip !== "");

// ---------------------------------------------------------------------------
// Checks shared by the note, the rail, the chip and the save
// ---------------------------------------------------------------------------

/**
 * The value as the server would receive it: text-like values trimmed; for a
 * household, sub-fields trimmed, unanswered sub-fields omitted and members
 * with no answers dropped. Everything else as is. The draft is never trimmed.
 */
export function sendable(question, value) {
  if (!question) return value;
  if (question.type === "group") {
    if (!Array.isArray(value)) return value;
    const fields = new Map((question.fields ?? []).map((field) => [field.id, field]));
    return value
      .map((member) => {
        if (!isPlainObject(member)) return member;
        const out = {};
        for (const [key, item] of Object.entries(member)) {
          const sent = sendable(fields.get(key), item);
          if (isAnswered(sent)) out[key] = sent;
        }
        return out;
      })
      // A card holding nothing but its hidden member id is empty.
      .filter((member) => !(isPlainObject(member) && Object.keys(member).every((key) => key === "member_id")));
  }
  return TEXT_LIKE.has(question.type) && typeof value === "string" ? value.trim() : value;
}

/**
 * checkValue's reason in the screen language. checkValue stays English (the
 * database mirrors it); fixed reasons go through SENTENCES, the two built with
 * numbers through text keys. English returns the reason as it is. `question`
 * is the one checked: for a household, a sub-field's reason is named by the
 * sub-field's wording (its id when the household or the sub-field is unknown).
 */
export function invalidText(reason, lang = "en", question = null) {
  if (typeof reason !== "string" || !isLang(lang) || lang === "en") return reason;
  let m;
  if ((m = /^Use at most (\d+) characters\.$/.exec(reason))) return t("invalid.too_long", { limit: num(m[1], lang) }, lang);
  if ((m = /^Enter a number from (\d+) to (\d+)\.$/.exec(reason)))
    return t("invalid.number_range", { min: num(m[1], lang), max: num(m[2], lang) }, lang);
  // Years print as written: no digit grouping (1900, not 1,900).
  if ((m = /^Enter a year from (\d{4}) to (\d{4})\.$/.exec(reason)))
    return t("invalid.year_range", { min: m[1], max: m[2] }, lang);
  if ((m = /^Unknown field (.+)\.$/.exec(reason))) return t("invalid.unknown_field", { field: m[1] }, lang);
  // checkGroup's "<sub-field id>: <reason>": the sub-field's wording, and the reason translated.
  if ((m = /^(\w+): (.+)$/.exec(reason))) {
    const field = question?.type === "group" ? (question.fields ?? []).find((f) => f.id === m[1]) : null;
    const name = (field && wording(field, { lang })) || m[1];
    return t("invalid.member_field", { field: name, reason: invalidText(m[2], lang) }, lang);
  }
  return sentence(reason, lang);
}

/** The note's text and class. For a household sub-field, `question` is the sub-field. */
export function noteState(question, value, { showMissing = false, showInvalid = false, lang = "en" } = {}) {
  const sent = sendable(question, value);
  if (showInvalid) {
    const reason = checkValue(question, sent);
    if (reason) return { text: invalidText(reason, lang, question), className: "is-invalid" };
  }
  if (showMissing && question?.required && !isAnswered(sent)) return { text: t("note.needs_answer", {}, lang), className: "is-missing" };
  return { text: "", className: "" };
}

/**
 * Ids of visible questions in the sub-step `substepId` (or every sub-step when
 * null) whose sendable value fails checkValue, in catalogue order. A household
 * member's sub-field is "hh[<n>].<sub>", n being the member's index in the draft.
 */
export function invalidAnswers(substepId, answers = {}) {
  const draft = answers ?? {};
  const out = [];
  for (const question of questionsOf(substepId)) {
    if (!isVisible(question, draft)) continue;
    const value = draft[question.id];
    if (question.type === "group") {
      if (!Array.isArray(value)) continue;
      value.forEach((member, n) => {
        if (!isPlainObject(member)) return;
        for (const field of question.fields ?? [])
          if (checkValue(field, sendable(field, member[field.id]))) out.push(`${question.id}[${n}].${field.id}`);
      });
      continue;
    }
    if (checkValue(question, sendable(question, value))) out.push(question.id);
  }
  return out;
}

/** "4,612 of 5,000 characters" within 500 of the limit, otherwise "". */
export const countText = (value, lang = "en") => {
  const length = typeof value === "string" ? value.length : 0;
  return length > COUNT_FROM ? t("count.long", { length: num(length, lang), limit: num(LONGTEXT_LIMIT, lang) }, lang) : "";
};

// ---------------------------------------------------------------------------
// Sub-steps: visibility, the hidden-sub-step fallback and status marks
// (docs/superpowers/specs/2026-10-04-intake-redesign-design.md §2 and §3)
// ---------------------------------------------------------------------------

/**
 * The review step's alerts: every missing required answer, then every invalid
 * one, from the draft alone (it holds the contact fields). 9.1 lists them, and
 * while there is one, 9.1's Continue waits and 9.2 and 9.3 are hidden
 * (openspec change gate-review-and-redesign-summary, design D1, D2).
 */
export const reviewAlerts = (answers) => [
  ...missingToSubmit(2, answers ?? {}).map((id) => ({ id, kind: "missing" })),
  ...invalidAnswers(null, answers ?? {}).map((id) => ({ id, kind: "invalid" })),
];

const isSameDay = (answers) => answers?.service === "same_day";

// `gate` is visibleSubsteps' one reading of the review gate: `clean` with no
// alerts, `earned` once Continue on 9.2 has added the visit to review.submit.
function substepVisible(substep, answers, cards, gate) {
  switch (substep.kind) {
    case "review":
      if (substep.id === "review.check") return true;
      return gate.clean && (substep.id === "review.summary" || gate.earned);
    case "documents":
      if (substep.cards === "bring") return isSameDay(answers);
      if (isSameDay(answers)) return false;
      if (substep.cards === "other") return true;
      return (cards ?? []).some((card) => card.substep === substep.cards);
    default:
      return substepQuestions(substep.id).some((question) => isVisible(question, answers ?? {}));
  }
}

/**
 * Ids of the visible sub-steps, in catalogue order. `cards` is cardsFor's
 * output; `visited` (an array or Set of sub-step ids, none when missing)
 * decides the review gate's 9.3.
 */
export function visibleSubsteps(answers, cards, visited = []) {
  const draft = answers ?? {};
  const gate = { clean: reviewAlerts(draft).length === 0, earned: asSet(visited).has("review.submit") };
  return substepsFor(2).filter((substep) => substepVisible(substep, draft, cards, gate)).map((substep) => substep.id);
}

// The Form 14446 gate (openspec change add-form-14446-consent, design D2):
// until the client ticks 0.4, no sub-step after "Before you start" is
// reached or shown. Not built with show-ifs: hidden questions would make an
// unconsented form look complete.
const GATE = "before.virtual";

/** Consented to the virtual process: 0.4's box (`vc_agree`) is ticked. */
export const consented = (answers) => Array.isArray(answers?.vc_agree) && answers.vc_agree.includes("yes");

/**
 * Where a place in the form lands now: `id` while visible; when hidden, the
 * next visible sub-step after it in catalogue order, or the last visible one
 * (so a gated 9.2 or 9.3 lands on 9.1); an id the catalogue doesn't have (or
 * null) goes to the first visible one. Until the client consents (0.4), every
 * place after "Before you start" lands on 0.4.
 */
export function resolveSubstep(id, answers, cards, visited = []) {
  const place = findSubstep(id);
  if (place && place.step.id !== "before" && !consented(answers)) return GATE;
  const visible = visibleSubsteps(answers, cards, visited);
  const all = substepsFor(2).map((substep) => substep.id);
  const at = all.indexOf(id);
  if (at < 0) return visible[0] ?? null;
  if (visible.includes(id)) return id;
  const visibleSet = new Set(visible);
  return all.slice(at + 1).find((other) => visibleSet.has(other)) ?? visible[visible.length - 1] ?? null;
}

/** The visible sub-step `delta` (+1 or -1) from the resolved `id`, or null at either end. */
export function adjacentSubstep(id, answers, cards, delta, visited = []) {
  const visible = visibleSubsteps(answers, cards, visited);
  const at = visible.indexOf(resolveSubstep(id, answers, cards, visited));
  return at < 0 ? null : visible[at + delta] ?? null;
}

const MARKS = { needs: "status.needs", docs: "status.docs", done: "status.done", none: null };
const markIn = (key, lang = "en") => ({ key, text: MARKS[key] ? t(MARKS[key], {}, lang) : "" });

/**
 * The rail mark of one sub-step (spec §3.3). `visited` is an array or Set of
 * sub-step ids, `revealed` a Set of answer ids, `cards` cardsFor's output,
 * `lang` the language of the mark's text.
 * Missing and invalid come from the draft alone. An invalid answer counts only
 * once revealed, so typing never flips the mark. A visit is required for Done.
 */
export function substepStatus(id, { answers = {}, visited = [], revealed = new Set(), cards = [], lang = "en" } = {}) {
  const mark = (key) => markIn(key, lang);
  const substep = findSubstep(id);
  if (!substep) return mark("none");
  const draft = answers ?? {};
  const wasVisited = asSet(visited).has(id);
  switch (substep.kind) {
    case "review": {
      if (id === "review.submit") return mark("none");
      if (id === "review.summary") return mark(wasVisited ? "done" : "none");
      const clean = reviewAlerts(draft).length === 0;
      return mark(wasVisited && clean ? "done" : "none");
    }
    case "documents": {
      if (!wasVisited) return mark("none");
      if (substep.cards === "bring") return mark("done");
      // The optional "other" card never makes a sub-step Needs documents.
      const owing = (cards ?? []).some((card) => card.substep === substep.cards && card.group === "needed" && card.status === "not_done");
      return mark(owing ? "docs" : "done");
    }
    default: {
      const ids = new Set(substep.questions);
      const missing = missingToSubmit(2, draft).filter((missed) => ids.has(missed.replace(/\[.*$/, "")));
      const shown = asSet(revealed);
      const shownInvalid = invalidAnswers(id, draft).filter((invalid) => shown.has(invalid));
      if ((wasVisited && missing.length > 0) || shownInvalid.length > 0) return mark("needs");
      return mark(wasVisited && missing.length === 0 ? "done" : "none");
    }
  }
}

/** A step's mark over its visible sub-steps: needs > docs > done when all are > none. */
export function stepRollup(stepId, ctx = {}) {
  const mark = (key) => markIn(key, ctx.lang);
  // The review step ends with the Submit page, which is never marked (it
  // stays blank until the application is submitted), so the step itself is
  // never Done, whichever of its pages the gate shows (gate-review-and-redesign-summary).
  if (stepId === "review") return mark("none");
  const visible = new Set(visibleSubsteps(ctx.answers, ctx.cards, ctx.visited));
  const keys = substepsFor(2)
    .filter((substep) => substep.step.id === stepId && visible.has(substep.id))
    .map((substep) => substepStatus(substep.id, ctx).key);
  if (keys.includes("needs")) return mark("needs");
  if (keys.includes("docs")) return mark("docs");
  return mark(keys.length > 0 && keys.every((key) => key === "done") ? "done" : "none");
}

/**
 * Resume (spec §3.1): the first visible sub-step whose mark isn't Done, or
 * review.check when every sub-step before the submit page is. review.submit is
 * never Done by design, so it is not asked.
 */
export function firstUnfinishedSubstep(answers, cards, visited, revealed) {
  const ctx = { answers, visited, revealed, cards };
  return (
    visibleSubsteps(answers, cards, visited).find((id) => id !== "review.submit" && substepStatus(id, ctx).key !== "done") ?? "review.check"
  );
}

/** A new household member id: 32 lowercase hex characters. */
export function newMemberId(random = globalThis.crypto) {
  return [...random.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** A number's range hint: "0 to 12", "1 or more", or "" without a range. */
export const rangeText = (question, lang = "en") =>
  question.min === undefined && question.max === undefined
    ? ""
    : question.max === undefined
      ? t("range.or_more", { min: num(question.min, lang) }, lang)
      : t("range.between", { min: num(question.min ?? 0, lang), max: num(question.max, lang) }, lang);

// The taxpayer's own fields carry an autocomplete token, so a phone or browser
// can offer what the client saved there (issue 147). Only in the client's own
// intake (scope "client"): the office's forms hold someone else's answers.
// The spouse, household members, signatures and identity numbers get none, so
// the client's own details are never offered for another person.
export const CLIENT_AUTOFILL = Object.freeze({
  tp_first_name: "given-name",
  tp_middle_name: "additional-name",
  tp_last_name: "family-name",
  tp_dob: Object.freeze({ month: "bday-month", day: "bday-day", year: "bday-year" }),
  tp_job_title: "organization-title",
  tp_phone: "tel",
  email: "email",
  addr_street: "address-line1",
  addr_apt: "address-line2",
  addr_city: "address-level2",
  addr_state: "address-level1",
  addr_zip: "postal-code",
});

// One question's markup. `base` is its id (field-<scope>-<id>), `data` the
// data-* attributes every control carries, and `wrapQ` the wrapper's data-q
// (null inside a household card, so closest("[data-q]") finds the group).
function renderField(question, value, ctx) {
  const { base, data, wrapQ, variant, lang, answers, autofill = null } = ctx;
  const type = question.type;
  const ac = (part) => {
    const token = part ? autofill?.[part] : typeof autofill === "string" ? autofill : null;
    return token ? ` autocomplete="${token}"` : "";
  };
  const note = noteState(question, value, { showMissing: ctx.showMissing, showInvalid: ctx.showInvalid, lang });
  const tips = tipsOf(question, { variant, lang, answers });
  const noteId = `${base}-note`;
  const tipsId = `${base}-tips`;
  const countId = `${base}-count`;
  const describedBy = [tips.length ? tipsId : null, noteId, type === "longtext" ? countId : null].filter(Boolean).join(" ");
  const control = `${data} data-control aria-describedby="${describedBy}"`;
  const text = typeof value === "string" ? value : "";
  const title = esc(wording(question, { variant, lang, answers }));
  const wrap = wrapQ ? ` data-q="${esc(wrapQ)}"` : "";
  const cls = `q q-${esc(type)}`;
  const tipsHtml = tips.length
    ? `<div class="q-tips" id="${tipsId}">${tips.map((tip) => `<div class="q-tip">${renderRichText(tip)}</div>`).join("")}</div>`
    : "";
  const noteHtml = `<p id="${noteId}" class="q-note${note.className ? ` ${note.className}` : ""}" aria-live="polite">${esc(note.text)}</p>`;

  const single = (input, extra = "") =>
    `<div class="${cls}"${wrap}><label for="${base}" class="q-label">${title}${extra}</label>${input}${tipsHtml}${
      type === "longtext" ? `<p id="${countId}" class="q-count">${esc(countText(value, lang))}</p>` : ""
    }${noteHtml}</div>`;
  const group = (inner) =>
    `<fieldset class="${cls}"${wrap}><legend class="q-label">${title}</legend>${inner}${tipsHtml}${noteHtml}</fieldset>`;
  const options = shownOptions(question, answers);

  switch (type) {
    case "longtext":
      return single(`<textarea id="${base}" ${control} class="q-input" maxlength="${LONGTEXT_LIMIT}" rows="5">${esc(text)}</textarea>`);
    case "email":
    case "phone": {
      const inputType = type === "email" ? "email" : "tel";
      return single(`<input id="${base}" ${control} class="q-input" type="${inputType}"${ac()} value="${esc(text)}">`);
    }
    case "zip":
    case "year":
    case "number": {
      const range = rangeText(question, lang);
      return single(
        `<input id="${base}" ${control} class="q-input" type="text" inputmode="numeric"${ac()} value="${esc(text)}">`,
        range ? ` <span class="q-range">${esc(range)}</span>` : "",
      );
    }
    case "date": {
      // Split at the first two "-" only, so a partial date ("-04-12", "1961--12") goes back into its boxes.
      const [year, month, day] = /^([^-]*)-([^-]*)-(.*)$/.exec(text)?.slice(1) ?? [text, "", ""];
      const parts = { year, month, day };
      return group(
        `<div class="q-date">${datePartsFor(lang).map(
          ({ part, label, hint, size }) =>
            `<label for="${base}-${part}" class="q-date-part is-${part}"><span>${esc(label)}</span><input id="${base}-${part}" ${control} data-date-part="${part}" class="q-input" type="text" inputmode="numeric"${ac(part)} maxlength="${size}" placeholder="${esc(hint)}" value="${esc(parts[part])}"></label>`,
        ).join("")}</div>`,
      );
    }
    case "choice":
    case "yesno": {
      if (type === "choice" && options.length > SELECT_OVER)
        return single(
          `<select id="${base}" ${control} class="q-input"${ac()}><option value="">${esc(t("form.select_option", {}, lang))}</option>${options
            .map(
              (option) =>
                `<option value="${esc(option.value)}"${option.value === value ? " selected" : ""}>${esc(optionLabel(option, { variant, lang }))}</option>`,
            )
            .join("")}</select>`,
        );
      return group(
        `<div class="q-options${type === "yesno" ? " q-segmented" : ""}">${options
          .map((option) => {
            const id = `${base}-${esc(option.value)}`;
            return `<label for="${id}" class="q-option"><input id="${id}" ${control} type="radio" name="${base}" value="${esc(option.value)}"${option.value === value ? " checked" : ""}><span>${esc(optionLabel(option, { variant, lang }))}</span></label>`;
          })
          .join("")}</div>`,
      );
    }
    case "multi":
    case "who": {
      const picked = Array.isArray(value) ? value : [];
      if (askedAlone(question, answers))
        return group(
          `<div class="q-options q-segmented">${options
            .map((option) => {
              const id = `${base}-${esc(option.value)}`;
              return `<label for="${id}" class="q-option"><input id="${id}" ${control} type="radio" name="${base}" value="${esc(option.value)}"${picked.includes(option.value) ? " checked" : ""}><span>${esc(optionLabel(option, { variant, lang }))}</span></label>`;
            })
            .join("")}</div>`,
        );
      return group(
        `<div class="q-options q-chips">${options
          .map((option) => {
            const id = `${base}-${esc(option.value)}`;
            return `<label for="${id}" class="q-option q-chip"><input id="${id}" ${control} type="checkbox" value="${esc(option.value)}"${picked.includes(option.value) ? " checked" : ""}><span>${esc(optionLabel(option, { variant, lang }))}</span></label>`;
          })
          .join("")}</div>`,
      );
    }
    default: // text, signature
      return single(
        `<input id="${base}" ${control} class="q-input${type === "signature" ? " q-signature" : ""}" type="text"${type === "signature" ? "" : ac()} maxlength="${question.maxlength ?? TEXT_LIMIT}" value="${esc(text)}">`,
      );
  }
}

// The household: one card per member, each sub-question rendered by the same
// renderField with scope <scope>-hh-<n>; every control carries data-q="hh".
function renderGroup(question, value, { scope, variant, lang, answers, showMissing, revealed }) {
  const qid = esc(question.id);
  const base = `field-${esc(scope)}-${qid}`;
  const members = Array.isArray(value) ? value : [];
  const note = noteState(question, value, { showMissing, showInvalid: revealed.has(question.id), lang });
  const noteId = `${base}-note`;
  const tips = tipsOf(question, { variant, lang, answers });
  const cards = members
    .map((member, n) => {
      const memberBase = `${base}-${n}`;
      const answersOf = isPlainObject(member) ? member : {};
      // The member's id is a hidden control: no label, no note, no tab stop.
      const hiddenId = (question.fields ?? []).some((field) => field.type === "id")
        ? `<input type="hidden" data-control data-q="${qid}" data-member="${n}" data-sub="member_id" value="${esc(answersOf.member_id ?? "")}">`
        : "";
      const subs = (question.fields ?? [])
        .filter((field) => field.type !== "id")
        .map((field) =>
          renderField(field, answersOf[field.id], {
            base: `${memberBase}-${esc(field.id)}`,
            data: `data-q="${qid}" data-member="${n}" data-sub="${esc(field.id)}"`,
            wrapQ: null,
            variant,
            lang,
            answers,
            showMissing,
            showInvalid: revealed.has(`${question.id}[${n}].${field.id}`),
          }),
        )
        .join("");
      return `<div class="hh-card" role="group" aria-labelledby="${memberBase}-title">${hiddenId}<div class="hh-card-head"><h3 class="hh-card-title" id="${memberBase}-title">${esc(t("member.person", { n: n + 1 }, lang))}</h3>${button(
        esc(t("member.remove", {}, lang)),
        "remove-member",
        "secondary",
        `data-member="${n}" aria-label="${esc(t("member.remove_label", { n: n + 1 }, lang))}"`,
      )}</div>${subs}</div>`;
    })
    .join("");
  const add =
    members.length < MEMBER_LIMIT ? button(esc(t("member.add", {}, lang)), "add-member", "secondary", `aria-describedby="${noteId}"`) : "";
  const tipsId = `${base}-tips`;
  const describedBy = [tips.length ? tipsId : null, noteId].filter(Boolean).join(" ");
  return `<fieldset class="q q-group" data-q="${qid}" aria-describedby="${describedBy}"><legend class="q-label">${esc(wording(question, { variant, lang, answers }))}</legend>${
    tips.length ? `<div class="q-tips" id="${tipsId}">${tips.map((tip) => `<div class="q-tip">${renderRichText(tip)}</div>`).join("")}</div>` : ""
  }<div class="hh-cards">${cards}</div>${add}<p id="${noteId}" class="q-note${note.className ? ` ${note.className}` : ""}" aria-live="polite">${esc(note.text)}</p></fieldset>`;
}

/**
 * The HTML for one question. `answers` is the draft (contact fields included)
 * for conditions; the note shows an error when `revealed` has the question's
 * id, or "hh[<n>].<sub>" for a member's sub-field.
 */
export function renderQuestion(
  question,
  value,
  { variant = "general", lang = "en", scope = "client", answers = {}, showMissing = false, revealed = new Set() } = {},
) {
  const shown = asSet(revealed);
  const ctx = { variant, lang, answers: answers ?? {}, showMissing };
  if (question.type === "group") return renderGroup(question, value, { ...ctx, scope, revealed: shown });
  return renderField(question, value, {
    ...ctx,
    base: `field-${esc(scope)}-${esc(question.id)}`,
    data: `data-q="${esc(question.id)}"`,
    wrapQ: question.id,
    showInvalid: shown.has(question.id),
    autofill: scope === "client" ? (CLIENT_AUTOFILL[question.id] ?? null) : null,
  });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

// One question's (or one member sub-field's) value from its descriptors.
function readOne(list, changed) {
  if (list.some((d) => d.part)) {
    const part = (name) => String(list.find((d) => d.part === name)?.value ?? "").replace(/\D/g, "");
    const [year, month, day] = [part("year"), part("month"), part("day")];
    return [year, month, day].every((p) => p.trim() === "") ? null : `${year}-${month}-${day}`;
  }
  const type = list[0].type;
  if (type === "radio") return list.find((d) => d.checked)?.value ?? null;
  if (type === "checkbox") {
    let picked = list.filter((d) => d.checked).map((d) => d.value);
    if (changed && picked.includes(NONE))
      picked = changed.value === NONE ? [NONE] : picked.filter((v) => v !== NONE);
    return picked.length ? picked : null;
  }
  const value = list[0].value ?? "";
  return String(value).trim() === "" ? null : value;
}

function readMembers(list, keepEmptyMembers) {
  const members = new Map();
  for (const d of list) {
    const n = Number(d.member);
    if (!Number.isInteger(n) || n < 0) continue;
    if (!members.has(n)) members.set(n, new Map());
    if (!d.sub) continue;
    const subs = members.get(n);
    if (!subs.has(d.sub)) subs.set(d.sub, []);
    subs.get(d.sub).push(d);
  }
  const result = [];
  for (const n of [...members.keys()].sort((a, b) => a - b)) {
    const member = {};
    for (const [sub, descriptors] of members.get(n)) {
      const value = readOne(descriptors);
      if (isAnswered(value)) member[sub] = value;
    }
    // A card with only its hidden id is empty: kept (id and all) while editing, dropped otherwise.
    if (keepEmptyMembers || Object.keys(member).some((key) => key !== "member_id")) result.push(member);
  }
  return result.length ? result : null;
}

/**
 * Reads control descriptors ({ q, member?, sub?, part?, type, value, checked })
 * into { [id]: value }, one key per question in the list. Values are exactly
 * what is in the box: an empty (or all-space) field reads null, and nothing is
 * trimmed. `changed` ({ q, value }, the checkbox option just ticked) applies
 * the "No one" rule. `keepEmptyMembers` keeps a household card with no answers
 * as {}.
 */
export function valuesFromControls(descriptors, { changed, keepEmptyMembers = false } = {}) {
  const byQuestion = new Map();
  for (const d of descriptors ?? []) {
    if (!d?.q) continue;
    if (!byQuestion.has(d.q)) byQuestion.set(d.q, []);
    byQuestion.get(d.q).push(d);
  }
  const out = {};
  for (const [id, list] of byQuestion) {
    const household = list.some((d) => d.member !== undefined && d.member !== null && d.member !== "");
    out[id] = household ? readMembers(list, keepEmptyMembers) : readOne(list, changed?.q === id ? changed : undefined);
    // An unmarried client's "who" question is a pair of radio buttons; its answer is still a list.
    if (typeof out[id] === "string" && findQuestion(2, id)?.type === "who") out[id] = [out[id]];
  }
  return out;
}

/** DOM: a control's descriptor, from its data-* attributes, value and checked state. */
export function describeControl(element) {
  const data = element.dataset ?? {};
  const descriptor = { q: data.q, type: element.type, value: element.value, checked: Boolean(element.checked) };
  if (data.member !== undefined) descriptor.member = Number(data.member);
  if (data.sub !== undefined) descriptor.sub = data.sub;
  if (data.datePart !== undefined) descriptor.part = data.datePart;
  return descriptor;
}

/**
 * DOM: the value of the element's question (in the household, the whole
 * group), with a just-ticked checkbox as `changed` and empty cards kept.
 */
export function readField(element) {
  const id = element?.dataset?.q;
  if (!id) return {};
  const wrapper = element.parentElement?.closest("[data-q]");
  const holder = wrapper && wrapper.dataset.q === id ? wrapper : (element.form ?? element.ownerDocument);
  const controls = [...holder.querySelectorAll("[data-control]")].filter((el) => el.dataset.q === id);
  const changed = element.type === "checkbox" && element.checked ? { q: id, value: element.value } : undefined;
  return valuesFromControls(controls.map(describeControl), { changed, keepEmptyMembers: true });
}

/** DOM: every rendered question of the form; empty household cards dropped. */
export function readForm(formElement) {
  const controls = [...formElement.querySelectorAll("[data-control]")].filter((el) => el.dataset.q);
  return valuesFromControls(controls.map(describeControl));
}

/** Field by field; keys absent from the patch are kept, null sets null. Never mutates. */
export const mergeIntoDraft = (draft, patch) => ({ ...(draft ?? {}), ...(patch ?? {}) });

// ---------------------------------------------------------------------------
// Redraw decisions (spec §2.4 rule 3)
// ---------------------------------------------------------------------------

const DRIVERS = (() => {
  const fields = new Set();
  const add = (conditions) => {
    for (const condition of conditions ?? [])
      if (condition.op === "any") for (const group of condition.groups ?? []) add(group);
      else fields.add(condition.field);
  };
  const visit = (question) => {
    add(question.showIf);
    for (const tips of Object.values(question.tips ?? {})) for (const tip of tips ?? []) add(tip.showIf);
    for (const field of question.fields ?? []) visit(field);
  };
  for (const step of stepsFor(2)) for (const section of step.sections) for (const question of section.questions) visit(question);
  add(CATALOGUE.fixedOptions?.who?.spouseShowIf);
  return fields;
})();

/** Whether a question, household, tip or who-spouse condition names this field. */
export const drivesVisibility = (id) => DRIVERS.has(id);

/** Top-level ids in the sub-step that isVisible passes; the household is "hh". */
export const visibleIds = (substepId, answers) =>
  new Set(questionsOf(substepId).filter((question) => isVisible(question, answers ?? {})).map((question) => question.id));

/** The ids on the page differ from the ids the draft makes visible. */
export function needsRedraw(renderedIds, substepId, answers) {
  const visible = visibleIds(substepId, answers);
  const rendered = new Set(renderedIds ?? []);
  return rendered.size !== visible.size || [...visible].some((id) => !rendered.has(id));
}

// ---------------------------------------------------------------------------
// Saving (spec §2.5)
// ---------------------------------------------------------------------------

function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every((key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key]));
  }
  return false;
}

// Unanswered is one state: null, a missing key, "" and [] are equal.
const sameValue = (a, b) => (!isAnswered(a) && !isAnswered(b)) || deepEqual(a, b);

/**
 * The save request's answers, every field's sendable value (null clears
 * included), without each top-level field whose sendable value fails
 * checkValue (hh withheld whole if any member fails).
 */
export function withholdInvalid(draft, version) {
  const out = {};
  for (const [id, value] of Object.entries(draft ?? {})) {
    const question = findQuestion(2, id);
    if (!question) {
      out[id] = value;
      continue;
    }
    const sent = sendable(question, value);
    if (checkValue(question, sent) === null) out[id] = sent;
  }
  return out;
}

/** The ids withholdInvalid leaves out. */
export function withheldFields(draft, version) {
  const sent = withholdInvalid(draft, version);
  return Object.keys(draft ?? {}).filter((id) => !Object.hasOwn(sent, id));
}

/** Whether a save would change the server: some sent field differs from its value. */
export function sendableDiffers(draft, server, version) {
  const sent = withholdInvalid(draft ?? {}, version);
  return Object.entries(sent).some(([id, value]) => !sameValue(value, server?.[id]));
}

/**
 * The draft after a refresh: the server's answers, except that each field of
 * the previous draft that can't be sent (withheld) or differs only in spaces
 * keeps the previous draft's value.
 */
export function keepLocalOnly(previousDraft, server, version) {
  const next = { ...(server ?? {}) };
  const withheld = new Set(withheldFields(previousDraft, 2));
  for (const [id, value] of Object.entries(previousDraft ?? {})) {
    const question = findQuestion(2, id);
    if (withheld.has(id) || sameValue(question ? sendable(question, value) : value, next[id])) next[id] = value;
  }
  return next;
}

// ---------------------------------------------------------------------------
// Read-only text (spec §2.3)
// ---------------------------------------------------------------------------

/**
 * An answer date: "Apr 12, 1961" in English, "1961年4月12日" in Chinese. Split,
 * never new Date(…), which shifts a date by the time zone. A partial or
 * impossible-month date comes back as it is, in every language.
 */
export function formatDate(value, lang = "en") {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  if (!month) return value;
  return isLang(lang) && lang !== "en" ? `${m[1]}年${Number(m[2])}月${Number(m[3])}日` : `${month} ${Number(m[3])}, ${m[1]}`;
}

function formatPhone(value) {
  const digits = value.replace(/\D/g, "");
  return digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : value;
}

function memberLine(question, member, options) {
  const field = (id) => (question.fields ?? []).find((f) => f.id === id);
  const name = memberNameParts(member).join(" ");
  const parts = [name];
  if (isAnswered(member.relationship)) parts.push(labelOf(field("relationship"), member.relationship, options));
  const lang = options.lang;
  if (isAnswered(member.dob)) parts.push(t("member.born", { date: formatDate(member.dob, lang) }, lang));
  // n only picks "month" or "months": exactly "1" is one, as before.
  if (isAnswered(member.months_lived))
    parts.push(t("member.months", { n: member.months_lived === "1" ? 1 : 2, count: member.months_lived }, lang));
  return parts.filter(isAnswered).join(" · ");
}

/** The read-only text of an answer, or null when unanswered. */
export function formatAnswer(question, value, { variant = "general", lang = "en", answers } = {}) {
  if (!question) return null;
  const sent = sendable(question, value);
  if (!isAnswered(sent)) return null;
  const options = { variant, lang, answers };
  switch (question.type) {
    case "date":
      return typeof sent === "string" ? formatDate(sent, lang) : String(sent);
    case "phone":
      return typeof sent === "string" ? formatPhone(sent) : String(sent);
    case "choice":
    case "yesno":
      return labelOf(question, sent, options);
    case "multi":
    case "who":
      return (Array.isArray(sent) ? sent : [sent]).map((item) => labelOf(question, item, options)).join(t("form.list_separator", {}, lang));
    case "group": {
      const lines = (Array.isArray(sent) ? sent : [])
        .filter(isPlainObject)
        .map((member) => memberLine(question, member, options))
        .filter((line) => line !== "");
      return lines.length ? lines.join("\n") : null;
    }
    default:
      return String(sent);
  }
}
