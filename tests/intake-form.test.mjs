import test from "node:test";
import assert from "node:assert/strict";
import {
  CATALOGUE, stepsFor, findQuestion, wording, checkValue, substepsFor, substepQuestions, isMemberId, isVisible, isAnswered, missingToSubmit,
} from "../src/intake-catalogue.mjs";
import { cardsFor } from "../src/document-cards.mjs";
import { esc } from "../src/ui.mjs";
import {
  renderQuestion, CLIENT_AUTOFILL, valuesFromControls, mergeIntoDraft, drivesVisibility, visibleIds,
  needsRedraw, noteState, invalidAnswers, sendable, withholdInvalid, withheldFields,
  sendableDiffers, keepLocalOnly, countText, renderRichText, formatAnswer,
  visibleSubsteps, resolveSubstep, consented, adjacentSubstep, reviewAlerts, substepStatus, stepRollup,
  firstUnfinishedSubstep, newMemberId, datePartsFor, formatDate, rangeText, invalidText,
} from "../src/intake-form.mjs";
import { setHantMap } from "../src/hant.mjs";
import HANT_MAP from "../src/zh-hant.mjs";
import { INTAKE_VALUE_CASES } from "./support/intake-value-cases.mjs";
import { readFileSync } from "node:fs";

// Part 4b, Task 2 (docs/superpowers/specs/2026-09-30-intake-screens-design.md §2).

const q = (id) => findQuestion(2, id);
const HH = q("hh");
const sub = (id) => HH.fields.find((f) => f.id === id);
const client = (question, value, options = {}) => renderQuestion(question, value, { scope: "client", ...options });
const ALL = stepsFor(2).flatMap((s) => s.sections.flatMap((x) => x.questions));
const label = (option, variant = "general") => option.label[variant].en;
const yesnoLabel = (value) => label(CATALOGUE.fixedOptions.yesno.options.find((o) => o.value === value));
const whoLabel = (value) => label(CATALOGUE.fixedOptions.who.options.find((o) => o.value === value));

// Undo esc() for attribute values and text read back from the HTML.
const unescape = (text) =>
  text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}(?:="([^"]*)")?(?=[\\s>]|$)`).exec(tag);
  return m ? unescape(m[1] ?? "") : undefined;
};

// Builds control descriptors from rendered HTML, as describeControl would from
// the DOM: data-* attributes, the type, the value and the checked state.
function descriptorsFrom(html) {
  const out = [];
  const re = /<input\b([^>]*)>|<(select|textarea)\b([^>]*)>([\s\S]*?)<\/\2>/g;
  for (const m of html.matchAll(re)) {
    const tag = m[2] ?? "input";
    const attrs = m[1] ?? m[3];
    const body = m[4] ?? "";
    if (attr(attrs, "data-control") === undefined) continue;
    const d = { q: attr(attrs, "data-q") };
    if (attr(attrs, "data-member") !== undefined) d.member = attr(attrs, "data-member");
    if (attr(attrs, "data-sub") !== undefined) d.sub = attr(attrs, "data-sub");
    if (attr(attrs, "data-date-part") !== undefined) d.part = attr(attrs, "data-date-part");
    if (tag === "input") {
      d.type = attr(attrs, "type") ?? "text";
      d.value = attr(attrs, "value") ?? "";
      d.checked = attr(attrs, "checked") !== undefined;
    } else if (tag === "select") {
      d.type = "select-one";
      const selected = [...body.matchAll(/<option\b([^>]*)>/g)].find((o) => attr(o[1], "selected") !== undefined);
      d.value = selected ? attr(selected[1], "value") : "";
      d.checked = false;
    } else {
      d.type = "textarea";
      d.value = unescape(body);
      d.checked = false;
    }
    out.push(d);
  }
  return out;
}
const roundTrip = (question, value, options = {}) =>
  valuesFromControls(descriptorsFrom(client(question, value, options)))[question.id];

const text = (qid, value) => ({ q: qid, type: "text", value, checked: false });
const box = (qid, choice, checked, type = "checkbox") => ({ q: qid, type, value: choice, checked });

// "About you": every visible required question answered.
const STEP2 = {
  tp_first_name: "Mei", tp_last_name: "Lin", tp_dob: "1961-04-12", tp_job_title: "Cook",
  tp_phone: "2155550100", addr_street: "10 Race St", addr_city: "Philadelphia",
  addr_state: "PA", addr_zip: "19107",
};

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

test("every type renders its data-q, its label or legend, its wording and every option", () => {
  const picks = [
    "tp_first_name", "gcf_tp_signature", "additional_notes", "email", "tp_phone", "addr_zip",
    "spouse_death_year", "inc_wages_job_count", "tp_dob", "marital_status", "inc_wages",
    "married_last_day", "best_contact_time", "us_citizen", "hh",
  ];
  const types = new Set();
  for (const id of picks) {
    const question = q(id);
    types.add(question.type);
    const html = client(question, null, { answers: { marital_status: "married" } });
    assert.ok(html.includes(`data-q="${id}"`), id);
    assert.ok(html.includes(`<label for="field-client-${id}"`) || html.includes("<legend"), id);
    assert.ok(html.includes(esc(wording(question))), id);
    if (["choice", "yesno", "multi", "who"].includes(question.type)) {
      const options =
        question.type === "who" ? CATALOGUE.fixedOptions.who.options
          : question.type === "yesno" ? question.options.map((o) => CATALOGUE.fixedOptions.yesno.options.find((y) => y.value === o.value))
            : question.options;
      for (const option of options) assert.ok(html.includes(`>${esc(label(option))}<`), `${id} ${option.value}`);
    }
  }
  for (const type of ["text", "signature", "longtext", "email", "phone", "zip", "year", "number", "date", "choice", "yesno", "multi", "who", "group"])
    assert.ok(types.has(type), type);
  // A choice with more than six options (the member's relationship) is a <select>.
  const relationship = sub("relationship");
  assert.ok(relationship.options.length > 6);
  const select = renderQuestion(relationship, null, { scope: "client" });
  assert.match(select, /<select\b/);
  assert.ok(select.includes(`<label for="field-client-relationship"`));
  for (const option of relationship.options) assert.ok(select.includes(`>${label(option)}<`), option.value);
  // Six or fewer: radio cards, not a select.
  assert.doesNotMatch(client(q("marital_status"), null), /<select\b/);
  assert.match(client(q("marital_status"), null), /type="radio"/);
  // yesno: "I'm not sure" only when the question lists it.
  assert.ok(client(q("inc_wages"), null).includes("value=\"not_sure\""));
  assert.ok(!client(q("married_last_day"), null).includes("value=\"not_sure\""));
  assert.ok(client(q("inc_wages"), null).includes(esc(yesnoLabel("not_sure"))));
});

test("who shows My spouse only while married", () => {
  const who = q("us_citizen");
  assert.ok(!client(who, null).includes(whoLabel("spouse")));
  assert.ok(!client(who, null, { answers: { marital_status: "never_married" } }).includes(whoLabel("spouse")));
  assert.ok(client(who, null, { answers: { marital_status: "married" } }).includes(whoLabel("spouse")));
  const married = client(who, null, { answers: { marital_status: "married" } });
  assert.ok(married.includes(whoLabel("me")) && married.includes(whoLabel("none")));
});

test("a ranged number inside a household card: its range as text, no min or max", () => {
  const html = client(HH, [{ member_id: "0123456789abcdef0123456789abcdef", first_name: "Ming" }], { answers: { has_household_members: "yes" } });
  const months = sub("months_lived");
  const tag = /<input\b[^>]*id="field-client-hh-0-months_lived"[^>]*>/.exec(html)?.[0];
  assert.ok(tag, "months_lived input");
  assert.match(tag, /inputmode="numeric"/);
  assert.match(tag, /data-q="hh"/);
  assert.match(tag, /data-member="0"/);
  assert.match(tag, /data-sub="months_lived"/);
  assert.ok(html.includes(`${months.min} to ${months.max}`));
  assert.ok(html.includes("0 to 12"));
  assert.doesNotMatch(html, /\s(min|max)=/);
  assert.ok(html.includes('data-action="add-member"'));
  assert.ok(html.includes('data-action="remove-member"') && html.includes('data-member="0"'));
  // A sub-question's wrapper never carries its own data-q.
  assert.deepEqual([...new Set([...html.matchAll(/data-q="([^"]*)"/g)].map((m) => m[1]))], ["hh"]);
});

test("longtext: 5000 limit and a count container; countText near the limit", () => {
  const html = client(q("additional_notes"), "hello");
  assert.match(html, /<textarea\b[^>]*maxlength="5000"/);
  assert.match(html, /<p id="field-client-additional_notes-count" class="q-count">/);
  assert.doesNotMatch(/<p id="field-client-additional_notes-count"[^>]*>/.exec(html)[0], /aria-live/);
  assert.match(/<textarea\b[^>]*>/.exec(html)[0], /aria-describedby="[^"]*field-client-additional_notes-count/);
  assert.equal(countText("a".repeat(4500)), "");
  assert.equal(countText("a".repeat(4612)), "4,612 of 5,000 characters");
  assert.ok(client(q("additional_notes"), "a".repeat(4612)).includes("4,612 of 5,000 characters"));
});

test("no control is required, min, max or pattern; every radio and checkbox id is unique", () => {
  const answers = { marital_status: "married", has_household_members: "yes" };
  const members = [{ member_id: "0123456789abcdef0123456789abcdef", first_name: "Ming" }, { member_id: "fedcba9876543210fedcba9876543210", first_name: "Bo" }];
  const page = ALL.map((question) => client(question, question.id === "hh" ? members : null, { answers })).join("");
  const controls = [...page.matchAll(/<(input|select|textarea)\b[^>]*>/g)].map((m) => m[0]);
  assert.ok(controls.length > 100);
  for (const tag of controls) {
    assert.doesNotMatch(tag, /\s(required|min|max|pattern)(?=[\s=>])/, tag);
    assert.match(tag, /\sdata-control(?=[\s=>])/, tag);
  }
  const ids = [...page.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, "every id on the page is unique");
  const optionIds = controls.filter((tag) => /type="(radio|checkbox)"/.test(tag)).map((tag) => attr(tag, "id"));
  assert.ok(optionIds.every(Boolean));
  assert.equal(new Set(optionIds).size, optionIds.length);
  assert.ok(optionIds.includes("field-client-inc_wages-yes"));
  assert.ok(optionIds.includes("field-client-hh-1-us_citizen-no"));
  // Radios of one question share a name; members' names differ.
  const radioNames = (html, id) => new Set([...html.matchAll(/<input\b[^>]*type="radio"[^>]*>/g)].filter((m) => m[0].includes(`id="${id}`)).map((m) => attr(m[0], "name")));
  assert.equal(radioNames(page, "field-client-inc_wages-").size, 1);
  assert.notDeepEqual(radioNames(page, "field-client-hh-0-us_citizen-"), radioNames(page, "field-client-hh-1-us_citizen-"));
  // A date's three boxes.
  const dob = client(q("tp_dob"), "1961-04-12");
  for (const part of ["month", "day", "year"]) assert.ok(dob.includes(`data-date-part="${part}"`), part);
});

test("renderRichText: escape, bold, lists and paragraphs", () => {
  const html = renderRichText("**W-2** & <b>\n- one\n- two");
  assert.ok(html.includes("<strong>W-2</strong> &amp; &lt;b&gt;"));
  const list = /<ul>([\s\S]*?)<\/ul>/.exec(html);
  assert.ok(list);
  assert.equal([...list[1].matchAll(/<li>/g)].length, 2);
  assert.ok(list[1].includes("<li>one</li>") && list[1].includes("<li>two</li>"));
  const paragraphs = renderRichText("First.\n\nSecond.");
  assert.equal([...paragraphs.matchAll(/<p>/g)].length, 2);
  // Tips render through it, under their question.
  assert.ok(client(q("inc_wages"), null).includes("<strong>W-2</strong>"));
});

test("tips: a tip with a condition renders only while it holds", () => {
  const refund = q("refund_method");
  const tip = refund.tips.general[0].en;
  assert.ok(client(refund, "direct_deposit", { answers: { refund_method: "direct_deposit" } }).includes(tip));
  assert.ok(!client(refund, "check", { answers: { refund_method: "check" } }).includes(tip));
  assert.ok(!client(refund, null).includes(tip));
});

test("drivesVisibility: conditions of questions, tips and who's spouse", () => {
  assert.equal(drivesVisibility("marital_status"), true);
  assert.equal(drivesVisibility("gcf_sp_signature"), true);
  assert.equal(drivesVisibility("vc_tp_signature"), true);
  assert.equal(drivesVisibility("vc_sp_signature"), true);
  assert.equal(drivesVisibility("spouse_death_year"), true);
  assert.equal(drivesVisibility("refund_method"), true);
  assert.equal(drivesVisibility("gcf_tp_signature"), false);
  assert.equal(drivesVisibility("tp_first_name"), false);
  const textLike = new Set(["text", "longtext", "signature", "email", "phone", "zip", "year", "number", "date"]);
  const drivers = [...ALL, ...HH.fields].filter((x) => textLike.has(x.type) && drivesVisibility(x.id)).map((x) => x.id);
  assert.deepEqual(drivers, ["spouse_death_year", "vc_tp_signature", "vc_sp_signature", "gcf_sp_signature"]);
});

test("visibleIds and needsRedraw: the ids a sub-step shows now against the ids on the page", () => {
  assert.ok(visibleIds("about.marital", {}).has("marital_status"));
  assert.ok(!visibleIds("about.marital", {}).has("married_last_day"));
  assert.ok(visibleIds("about.marital", { marital_status: "married" }).has("married_last_day"));
  // A sub-step never lists another sub-step's question.
  assert.ok(!visibleIds("about.you", {}).has("marital_status"));
  assert.equal(visibleIds("about.spouse", { marital_status: "never_married" }).size, 0);
  assert.ok(visibleIds("about.spouse", { marital_status: "married" }).has("sp_first_name"));
  // null is every sub-step.
  assert.ok(visibleIds(null, {}).has("tp_first_name") && visibleIds(null, {}).has("service"));
  // needsRedraw: a missing or extra id redraws; a hidden driver's value does not.
  const rendered = new Set(visibleIds("about.spouse", { marital_status: "never_married" }));
  assert.equal(needsRedraw(rendered, "about.spouse", { marital_status: "married" }), true);
  const spouse = visibleIds("about.spouse", { marital_status: "married" });
  assert.equal(needsRedraw(spouse, "about.spouse", { marital_status: "married" }), false);
  assert.equal(needsRedraw(spouse, "about.spouse", { marital_status: "never_married" }), true);
  assert.equal(needsRedraw([...spouse].slice(1), "about.spouse", { marital_status: "married" }), true);
  assert.equal(needsRedraw(new Set(visibleIds("household.members", { has_household_members: "yes" })), "household.members", { has_household_members: "yes" }), false);
  assert.equal(needsRedraw(new Set(["has_household_members"]), "household.members", { has_household_members: "yes" }), true);
  assert.equal(needsRedraw(new Set(["has_household_members"]), "household.members", { has_household_members: "no" }), false);
});

test("every question has its note container, referenced by its controls", () => {
  const answers = { marital_status: "married", has_household_members: "yes" };
  for (const question of ALL) {
    for (const value of [null, question.type === "group" ? [{ member_id: "0123456789abcdef0123456789abcdef", first_name: "Ming" }] : null]) {
      for (const showMissing of [false, true]) {
        const html = client(question, value, { answers, showMissing });
        const note = new RegExp(`<p id="field-client-${question.id}-note" class="q-note[^"]*" aria-live="polite">`);
        assert.match(html, note, question.id);
        if (question.type === "group") continue;
        const controls = [...html.matchAll(/<(input|select|textarea)\b[^>]*>/g)].map((m) => m[0]);
        assert.ok(controls.length > 0, question.id);
        for (const tag of controls) assert.ok(attr(tag, "aria-describedby").split(" ").includes(`field-client-${question.id}-note`), question.id);
      }
    }
  }
  const hh = client(HH, [{ member_id: "0123456789abcdef0123456789abcdef", first_name: "Ming" }], { answers });
  assert.match(hh, /<p id="field-client-hh-0-first_name-note" class="q-note[^"]*" aria-live="polite">/);
  assert.match(/<input\b[^>]*id="field-client-hh-0-first_name"[^>]*>/.exec(hh)[0], /aria-describedby="field-client-hh-0-first_name-note"/);
});

test("noteState: invalid outranks missing; only when shown", () => {
  const email = q("email");
  const first = q("tp_first_name");
  assert.deepEqual(noteState(first, null, { showMissing: true, showInvalid: false }), { text: "Needs an answer", className: "is-missing" });
  assert.deepEqual(noteState(first, "  ", { showMissing: true, showInvalid: true }), { text: "Needs an answer", className: "is-missing" });
  assert.deepEqual(noteState(email, "a@", { showMissing: true, showInvalid: true }), { text: "Enter a valid email address.", className: "is-invalid" });
  assert.deepEqual(noteState(email, "a@", { showMissing: true, showInvalid: false }), { text: "", className: "" });
  assert.deepEqual(noteState(first, "Mei", { showMissing: true, showInvalid: true }), { text: "", className: "" });
  assert.deepEqual(noteState(email, null, { showMissing: true, showInvalid: true }), { text: "", className: "" });
  // Checked through sendable: a padded ZIP is valid.
  assert.deepEqual(noteState(q("addr_zip"), " 12345 ", { showMissing: true, showInvalid: true }), { text: "", className: "" });
  // The rendered note carries the same text and class.
  assert.ok(client(first, null, { showMissing: true }).includes('<p id="field-client-tp_first_name-note" class="q-note is-missing" aria-live="polite">Needs an answer</p>'));
  assert.ok(client(email, "a@", { revealed: new Set(["email"]) }).includes('<p id="field-client-email-note" class="q-note is-invalid" aria-live="polite">Enter a valid email address.</p>'));
  assert.ok(client(email, "a@", { showMissing: true }).includes('<p id="field-client-email-note" class="q-note" aria-live="polite"></p>'));
});

test("invalidAnswers: visible questions of a sub-step, catalogue order, through sendable", () => {
  const answers = { tp_dob: "2025-02-30", email: "a@", addr_zip: " 12345 " };
  assert.deepEqual(invalidAnswers("about.you", answers), ["tp_dob", "email"]);
  assert.deepEqual(invalidAnswers("about.address", answers), []);
  assert.deepEqual(invalidAnswers("about.address", { addr_zip: "1234" }), ["addr_zip"]);
  assert.deepEqual(invalidAnswers(null, answers), ["tp_dob", "email"]);
  // A hidden question is never checked.
  assert.deepEqual(invalidAnswers("about.spouse", { marital_status: "never_married", sp_dob: "2025-02-30" }), []);
  assert.deepEqual(invalidAnswers("about.spouse", { marital_status: "married", sp_dob: "2025-02-30" }), ["sp_dob"]);
  assert.deepEqual(invalidAnswers(null, { ...answers, marital_status: "married", sp_dob: "2025-02-30" }), ["tp_dob", "email", "sp_dob"]);
  // Documents, review and unknown sub-steps hold no questions.
  for (const id of ["documents.identity", "review.check", "nowhere.at_all"]) assert.deepEqual(invalidAnswers(id, answers), []);
});

test("household errors belong to the member's sub-field", () => {
  const id = "0123456789abcdef0123456789abcdef";
  const other = "fedcba9876543210fedcba9876543210";
  const answers = {
    has_household_members: "yes",
    hh: [{ member_id: id, first_name: "Ming" }, { member_id: other, first_name: "Bo", dob: "2025-02-30" }],
  };
  assert.deepEqual(invalidAnswers("household.members", answers), ["hh[1].dob"]);
  assert.deepEqual(invalidAnswers("about.you", answers), []);
  // The member's own sub-field note shows the reason, the group note stays quiet.
  const html = client(HH, answers.hh, { answers, revealed: new Set(["hh[1].dob"]) });
  assert.ok(html.includes('<p id="field-client-hh-1-dob-note" class="q-note is-invalid" aria-live="polite">Enter a real date as YYYY-MM-DD.</p>'));
  assert.ok(html.includes('<p id="field-client-hh-note" class="q-note" aria-live="polite"></p>'));
  assert.ok(html.includes('<p id="field-client-hh-0-dob-note" class="q-note" aria-live="polite"></p>'));
});

// ---------------------------------------------------------------------------
// Sub-steps (intake redesign 4b2, Task 5)
// ---------------------------------------------------------------------------

const NO_CARDS = cardsFor({});
const ids = (list) => list.map((x) => x.id);
// Valid answers to every visible required question, found by filling until nothing is left.
function fillAll() {
  const valueFor = (question, n) => {
    switch (question.type) {
      case "email": return "mei@example.com";
      case "phone": return "2155550100";
      case "zip": return "19107";
      case "year": return "2020";
      case "date": return "1961-04-12";
      case "number": return String(question.min ?? 1);
      case "choice": case "yesno": return question.options[0].value;
      case "multi": return [question.options[0].value];
      case "who": return ["me"];
      case "id": return newMemberId({ getRandomValues: (bytes) => bytes.fill(n + 1) });
      default: return "Mei";
    }
  };
  const answers = {};
  for (let pass = 0; pass < 20; pass++) {
    for (const question of ALL) {
      if (!isVisible(question, answers) || !question.required || isAnswered(answers[question.id])) continue;
      answers[question.id] = question.type === "group"
        ? [Object.fromEntries(question.fields.filter((f) => f.required || f.type === "id").map((f) => [f.id, valueFor(f, 0)]))]
        : valueFor(question, 0);
    }
  }
  assert.deepEqual(missingToSubmit(2, answers), []);
  assert.deepEqual(invalidAnswers(null, answers), []);
  return answers;
}
const ctx = (answers, extra = {}) => ({ answers, visited: [], revealed: new Set(), cards: cardsFor(answers), ...extra });

test("visibleSubsteps: questions by visibility, documents by service and cards, review by the gate", () => {
  const none = visibleSubsteps({}, NO_CARDS);
  const all = ids(substepsFor(2));
  assert.deepEqual(none, all.filter((id) => none.includes(id)), "catalogue order");
  assert.ok(!none.includes("about.spouse") && !none.includes("documents.bring"));
  assert.deepEqual(none.slice(-1), ["review.check"], "with alerts, the review step is 9.1 alone");
  assert.ok(none.includes("before.ready") && none.includes("documents.identity") && none.includes("documents.other"));
  // The other four documents sub-steps need a card of their own.
  assert.ok(!none.includes("documents.income") && !none.includes("documents.expenses") && !none.includes("documents.events"));
  const withWages = { inc_wages: "yes" };
  assert.ok(visibleSubsteps(withWages, cardsFor(withWages)).includes("documents.income"));
  // The spouse sub-step follows the marital status.
  assert.ok(visibleSubsteps({ marital_status: "married" }, NO_CARDS).includes("about.spouse"));
  assert.ok(!visibleSubsteps({ marital_status: "never_married" }, NO_CARDS).includes("about.spouse"));
  // Same-day: the documents step is only documents.bring.
  const sameDay = { service: "same_day", inc_wages: "yes" };
  const docs = visibleSubsteps(sameDay, cardsFor(sameDay)).filter((id) => id.startsWith("documents."));
  assert.deepEqual(docs, ["documents.bring"]);
  // A questions sub-step is visible when any of its questions is, whatever the others do.
  assert.ok(visibleSubsteps({}, NO_CARDS).includes("household.members"));
  assert.ok(substepQuestions("household.members").some((question) => question.id === "hh" && question.showIf.length > 0));
});

// The Form 14446 gate sends every place after step 0 to 0.4 until 0.4 is ticked, so the
// places below are tried with the consent given (add-form-14446-consent).
const OPEN = { vc_agree: ["yes"] };

test("resolveSubstep: visible stays; hidden goes to the next visible, else the last; unknown goes first", () => {
  const cards = NO_CARDS;
  assert.equal(resolveSubstep("about.you", OPEN, cards), "about.you");
  // 1.5 (about.sign) always shows, so it is the next visible one after the hidden spouse sub-step.
  assert.equal(resolveSubstep("about.spouse", { ...OPEN, marital_status: "never_married" }, cards), "about.sign");
  assert.equal(resolveSubstep("documents.bring", OPEN, cards), "documents.identity");
  assert.equal(resolveSubstep("nowhere.at_all", {}, cards), "before.ready");
  assert.equal(resolveSubstep(null, {}, cards), "before.ready");
  assert.equal(resolveSubstep(undefined, {}, cards), "before.ready");
  // A client left on documents.identity when the service becomes same-day: the next visible
  // sub-step after it, which skips the rest of the documents step.
  const sameDay = { ...OPEN, service: "same_day" };
  assert.equal(resolveSubstep("documents.identity", sameDay, cardsFor(sameDay)), "notes.anything");
  // With nothing visible after it, the last visible one: with alerts, a hidden review.submit lands on review.check.
  assert.equal(resolveSubstep("review.submit", OPEN, NO_CARDS), "review.check");
});

test("adjacentSubstep: the visible neighbour of the resolved place, null at either end", () => {
  assert.equal(adjacentSubstep("about.irs", OPEN, NO_CARDS, 1), "household.members");
  assert.equal(adjacentSubstep("household.members", OPEN, NO_CARDS, -1), "about.irs");
  assert.equal(adjacentSubstep("before.ready", OPEN, NO_CARDS, -1), null);
  assert.equal(adjacentSubstep("review.submit", OPEN, NO_CARDS, 1), null);
  // From a hidden sub-step the neighbour is taken from where it resolves to.
  assert.equal(adjacentSubstep("about.spouse", { ...OPEN, marital_status: "never_married" }, NO_CARDS, -1), "about.marital");
  assert.equal(adjacentSubstep("about.spouse", { ...OPEN, marital_status: "married" }, NO_CARDS, -1), "about.marital");
  assert.equal(adjacentSubstep("about.spouse", { ...OPEN, marital_status: "never_married" }, NO_CARDS, 1), "about.situation");
  assert.equal(adjacentSubstep("nowhere.at_all", {}, NO_CARDS, 1), visibleSubsteps({}, NO_CARDS)[1]);
});

test("reviewAlerts: the missing answers, then the invalid ones, from the draft alone", () => {
  const everything = fillAll();
  assert.deepEqual(reviewAlerts(everything), []);
  const { addr_city, ...noCity } = everything;
  assert.deepEqual(reviewAlerts({ ...noCity, email: "a@" }), [
    { id: "addr_city", kind: "missing" },
    { id: "email", kind: "invalid" },
  ]);
  assert.deepEqual(reviewAlerts(null), reviewAlerts({}));
});

test("the review gate: 9.1 always, 9.2 with no alerts, 9.3 once Continue on 9.2 has earned it", () => {
  const everything = fillAll();
  const cards = cardsFor(everything);
  const review = (answers, visited) =>
    visibleSubsteps(answers, cardsFor(answers), visited).filter((id) => id.startsWith("review."));
  assert.deepEqual(review(everything), ["review.check", "review.summary"]);
  assert.deepEqual(review(everything, ["review.summary"]), ["review.check", "review.summary"], "a visit to 9.2 earns nothing");
  assert.deepEqual(review(everything, ["review.submit"]), ["review.check", "review.summary", "review.submit"]);
  assert.deepEqual(review(everything, new Set(["review.submit"])), ["review.check", "review.summary", "review.submit"]);
  // Open documents never block: every Needed card here is still Not done.
  assert.ok(cards.some((card) => card.group === "needed" && card.status === "not_done"));
  // Any alert hides both, earned or not.
  const { addr_city, ...noCity } = everything;
  assert.deepEqual(review(noCity, ["review.submit"]), ["review.check"]);
  assert.deepEqual(review({ ...everything, email: "a@" }, ["review.submit"]), ["review.check"]);
  // A hidden 9.2 or 9.3 lands on 9.1; an unearned 9.3 on 9.2.
  assert.equal(resolveSubstep("review.submit", noCity, cardsFor(noCity), ["review.submit"]), "review.check");
  assert.equal(resolveSubstep("review.summary", noCity, cardsFor(noCity), ["review.submit"]), "review.check");
  assert.equal(resolveSubstep("review.submit", everything, cards), "review.summary");
  assert.equal(resolveSubstep("review.submit", everything, cards, ["review.submit"]), "review.submit");
  // Continue from 9.1 goes nowhere while an alert exists; from 9.2 only once earned.
  assert.equal(adjacentSubstep("review.check", noCity, cardsFor(noCity), 1), null);
  assert.equal(adjacentSubstep("review.check", everything, cards, 1), "review.summary");
  assert.equal(adjacentSubstep("review.summary", everything, cards, 1), null);
  assert.equal(adjacentSubstep("review.summary", everything, cards, 1, ["review.submit"]), "review.submit");
  assert.equal(adjacentSubstep("review.submit", everything, cards, -1, ["review.submit"]), "review.summary");
});

test("substepStatus: blank until visited; Done needs a visit; Needs answers; a revealed invalid answer counts unvisited", () => {
  const empty = ctx({});
  assert.deepEqual(substepStatus("before.ready", empty), { key: "none", text: "" });
  assert.deepEqual(substepStatus("before.ready", { ...empty, visited: ["before.ready"] }), { key: "done", text: "Done" });
  assert.deepEqual(substepStatus("before.ready", { ...empty, visited: new Set(["before.ready"]) }), { key: "done", text: "Done" });
  // Visited with a required answer missing.
  const missingFirst = ctx({ ...STEP2, tp_first_name: null }, { visited: ["about.you"] });
  assert.deepEqual(substepStatus("about.you", missingFirst), { key: "needs", text: "Needs answers" });
  assert.deepEqual(substepStatus("about.you", ctx(STEP2, { visited: ["about.you"] })), { key: "done", text: "Done" });
  // Complete but not visited: blank. Missing but not visited: blank.
  assert.deepEqual(substepStatus("about.you", ctx(STEP2)), { key: "none", text: "" });
  assert.deepEqual(substepStatus("about.you", ctx({ ...STEP2, tp_first_name: null })), { key: "none", text: "" });
  // A revealed invalid email counts even unvisited (4b's rule kept); an unrevealed one doesn't.
  const badEmail = { ...STEP2, email: "a@" };
  assert.deepEqual(substepStatus("about.you", ctx(badEmail, { revealed: new Set(["email"]) })), { key: "needs", text: "Needs answers" });
  assert.deepEqual(substepStatus("about.you", ctx(badEmail, { visited: ["about.you"] })), { key: "done", text: "Done" });
  // Missing comes from the draft, whether or not it is in the sub-step's own questions.
  assert.deepEqual(substepStatus("about.address", ctx({ ...STEP2, addr_zip: null }, { visited: ["about.you", "about.address"] })), { key: "needs", text: "Needs answers" });
  // A household member's missing sub-field belongs to the household sub-step.
  const id = "0123456789abcdef0123456789abcdef";
  const hh = { has_household_members: "yes", hh: [{ member_id: id, first_name: "Ming" }] };
  assert.ok(missingToSubmit(2, hh).some((m) => m.startsWith("hh[0].")));
  assert.equal(substepStatus("household.members", ctx(hh, { visited: ["household.members"] })).key, "needs");
  // An unknown id has no mark.
  assert.deepEqual(substepStatus("nowhere.at_all", empty), { key: "none", text: "" });
});

test("substepStatus: documents sub-steps follow their Needed cards", () => {
  const notDone = ctx({}, { visited: ["documents.identity"] });
  assert.ok(notDone.cards.some((c) => c.slotId === "photo_id.tp" && c.status === "not_done"));
  assert.deepEqual(substepStatus("documents.identity", notDone), { key: "docs", text: "Needs documents" });
  assert.deepEqual(substepStatus("documents.identity", ctx({})), { key: "none", text: "" });
  // Later and Don't have both clear it, but only when every Needed card is dealt with.
  const state = (status) => ["photo_id.tp", "ssn.tp"].map((slotId) => ({ slotId, status }));
  assert.deepEqual(substepStatus("documents.identity", { ...notDone, cards: cardsFor({}, state("later")) }), { key: "done", text: "Done" });
  assert.deepEqual(substepStatus("documents.identity", { ...notDone, cards: cardsFor({}, state("none")) }), { key: "done", text: "Done" });
  assert.equal(substepStatus("documents.identity", { ...notDone, cards: cardsFor({}, [{ slotId: "photo_id.tp", status: "later" }]) }).key, "docs");
  // A Maybe card never counts.
  const maybe = { inc_wages: "not_sure" };
  const maybeCards = cardsFor(maybe);
  assert.ok(maybeCards.some((c) => c.substep === "income" && c.group === "maybe"));
  assert.equal(substepStatus("documents.income", { answers: maybe, cards: maybeCards, visited: ["documents.income"] }).key, "done");
  // The optional Other card never makes a sub-step Needs documents (ruling R1).
  assert.ok(notDone.cards.some((c) => c.substep === "other" && c.group === "optional" && c.status === "not_done"));
  assert.deepEqual(substepStatus("documents.other", { ...notDone, visited: ["documents.other"] }), { key: "done", text: "Done" });
  // The same-day sheet has no statuses: Done once visited.
  const sameDay = { service: "same_day" };
  assert.deepEqual(substepStatus("documents.bring", ctx(sameDay)), { key: "none", text: "" });
  assert.deepEqual(substepStatus("documents.bring", ctx(sameDay, { visited: ["documents.bring"] })), { key: "done", text: "Done" });
});

test("substepStatus: the review sub-steps", () => {
  const complete = { ...STEP2 };
  assert.deepEqual(substepStatus("review.summary", ctx(complete)), { key: "none", text: "" });
  assert.deepEqual(substepStatus("review.summary", ctx(complete, { visited: ["review.summary"] })), { key: "done", text: "Done" });
  // review.check: Done only when visited with nothing missing and nothing invalid.
  assert.equal(substepStatus("review.check", ctx({}, { visited: ["review.check"] })).key, "none");
  assert.equal(substepStatus("review.check", ctx({ ...complete }, { visited: ["review.check"] })).key, "none"); // the rest of the form is still blank
  const everything = fillAll();
  assert.deepEqual(substepStatus("review.check", ctx(everything, { visited: ["review.check"] })), { key: "done", text: "Done" });
  assert.equal(substepStatus("review.check", ctx(everything)).key, "none");
  assert.equal(substepStatus("review.check", ctx({ ...everything, email: "a@" }, { visited: ["review.check"] })).key, "none");
  // review.submit is never marked.
  assert.deepEqual(substepStatus("review.submit", ctx(everything, { visited: ["review.submit"] })), { key: "none", text: "" });
});

test("substepStatus: refund.consent isn't Done while a required signature is missing", () => {
  const status = (answers) =>
    substepStatus("refund.consent", { answers, visited: ["refund.consent"], cards: cardsFor(answers) }).key;
  assert.equal(status({ gcf_consent: "yes" }), "needs");
  assert.equal(status({ gcf_consent: "yes", marital_status: "married", gcf_tp_signature: "Mei Lin" }), "needs");
  assert.equal(
    status({ gcf_consent: "yes", marital_status: "married", gcf_tp_signature: "Mei Lin", gcf_sp_signature: "Wei Lin" }),
    "done",
  );
  assert.equal(status({ gcf_consent: "yes", marital_status: "never_married", gcf_tp_signature: "Mei Lin" }), "done");
  assert.equal(status({ gcf_consent: "no" }), "done");
  assert.equal(status({}), "done");
});

test("stepRollup: needs, then docs, then done only when all are done", () => {
  const visited = ["about.you", "about.address", "about.marital", "about.situation", "about.irs"];
  const answers = { ...STEP2 };
  // about.you is complete; about.marital is visited with its required answer missing.
  assert.deepEqual(stepRollup("about", ctx(answers, { visited })), { key: "needs", text: "Needs answers" });
  assert.deepEqual(stepRollup("about", ctx(answers)), { key: "none", text: "" });
  // Done only when every visible sub-step is Done.
  const consented = { service: "online", language: "english", vc_agree: ["yes"] };
  const oneDone = stepRollup("before", ctx(consented, { visited: ["before.ready", "before.service"] }));
  assert.deepEqual(oneDone, { key: "none", text: "" });
  assert.deepEqual(
    stepRollup("before", ctx(consented, { visited: ["before.ready", "before.service", "before.language", "before.virtual"] })),
    { key: "done", text: "Done" },
  );
  // Documents: a Needed card still Not done reads Needs documents when nothing needs answers.
  assert.deepEqual(stepRollup("documents", ctx({}, { visited: ["documents.identity", "documents.other"] })), { key: "docs", text: "Needs documents" });
  const later = cardsFor({}, ["photo_id.tp", "ssn.tp"].map((slotId) => ({ slotId, status: "later" })));
  assert.deepEqual(stepRollup("documents", ctx({}, { visited: ["documents.identity", "documents.other"], cards: later })), { key: "done", text: "Done" });
  // Only visible sub-steps count: the hidden spouse sub-step can't hold a step back.
  const never = { ...STEP2, marital_status: "never_married" };
  assert.equal(visibleSubsteps(never, cardsFor(never)).includes("about.spouse"), false);
  assert.equal(stepRollup("nowhere", ctx({})).key, "none");
  // The review step is never Done (its Submit page stays blank until submission),
  // whether or not the gate has shown 9.3.
  const everything = fillAll();
  assert.equal(stepRollup("review", ctx(everything, { visited: ["review.check", "review.summary"] })).key, "none");
  assert.equal(stepRollup("review", ctx(everything, { visited: ["review.check", "review.summary", "review.submit"] })).key, "none");
});

test("firstUnfinishedSubstep: resume at the first visible sub-step that isn't Done", () => {
  const { cards } = ctx({});
  assert.equal(firstUnfinishedSubstep({}, cards, [], new Set()), "before.ready");
  const answers = { service: "online", language: "english", vc_agree: ["yes"], ...STEP2 };
  const visited = ["before.ready", "before.service", "before.language", "before.virtual", "about.you"];
  assert.equal(firstUnfinishedSubstep(answers, cardsFor(answers), visited, new Set()), "about.address");
  // A visited sub-step with something missing is where the client resumes.
  assert.equal(firstUnfinishedSubstep({ ...answers, tp_job_title: null }, cardsFor(answers), visited, new Set()), "about.you");
  // Everything Done: review.check.
  const everything = fillAll();
  const all = visibleSubsteps(everything, cardsFor(everything));
  const laterAll = cardsFor(everything, cardsFor(everything).map((card) => ({ slotId: card.slotId, status: "later" })));
  assert.equal(firstUnfinishedSubstep(everything, laterAll, all, new Set()), "review.check");
  assert.equal(firstUnfinishedSubstep(everything, laterAll, all.filter((id) => !id.startsWith("review.")), new Set()), "review.check");
  // 9.1 visited and clean: the summary is next.
  assert.equal(
    firstUnfinishedSubstep(everything, laterAll, [...all.filter((id) => !id.startsWith("review.")), "review.check"], new Set()),
    "review.summary",
  );
  // Visited review.check and summary leave review.submit, which is never Done: still review.check.
  assert.equal(firstUnfinishedSubstep(everything, laterAll, all, new Set(["email"])), "review.check");
});

test("newMemberId: 32 lowercase hex characters from 16 random bytes", () => {
  assert.equal(newMemberId({ getRandomValues: (bytes) => bytes.fill(171) }), "ab".repeat(16));
  assert.equal(newMemberId({ getRandomValues: (bytes) => bytes.fill(5) }), "05".repeat(16));
  const real = newMemberId();
  assert.ok(isMemberId(real));
  assert.notEqual(newMemberId(), real);
});

test("a household card renders its member_id as a hidden control and nothing else for it", () => {
  const id = "0123456789abcdef0123456789abcdef";
  const members = [{ member_id: id, first_name: "A" }];
  const html = client(HH, members, { answers: { has_household_members: "yes" } });
  assert.ok(html.includes(`<input type="hidden" data-control data-q="hh" data-member="0" data-sub="member_id" value="${id}">`));
  // No label, no note, no visible text box for it; the id's wording appears nowhere.
  assert.ok(!html.includes("hh-0-member_id"));
  assert.ok(!html.includes("Person id"));
  assert.equal([...html.matchAll(/data-sub="member_id"/g)].length, 1);
  // Read back with the other sub-fields.
  assert.deepEqual(roundTrip(HH, members, { answers: { has_household_members: "yes" } }), members);
  const two = [{ member_id: id, first_name: "A" }, { member_id: "fedcba9876543210fedcba9876543210", last_name: "B" }];
  assert.deepEqual(roundTrip(HH, two), two);
  assert.deepEqual(valuesFromControls([{ q: "hh", member: "0", sub: "member_id", type: "hidden", value: id, checked: false }], { keepEmptyMembers: true }), { hh: [{ member_id: id }] });
  // A card holding only its id is empty: dropped unless empty cards are kept, and then the id stays.
  assert.deepEqual(valuesFromControls([{ q: "hh", member: "0", sub: "member_id", type: "hidden", value: id, checked: false }]), { hh: null });
});

test("sendable drops a household card holding only its member_id", () => {
  const id = "0123456789abcdef0123456789abcdef";
  assert.deepEqual(sendable(HH, [{ member_id: id }]), []);
  assert.deepEqual(sendable(HH, [{ member_id: id, first_name: " A " }]), [{ member_id: id, first_name: "A" }]);
  assert.deepEqual(sendable(HH, [{ member_id: id }, { member_id: "fedcba9876543210fedcba9876543210", first_name: "Bo" }]), [{ member_id: "fedcba9876543210fedcba9876543210", first_name: "Bo" }]);
  // A card with a name but no id is kept, and the group note says why (Each person needs an id.).
  assert.deepEqual(sendable(HH, [{ first_name: "A" }]), [{ first_name: "A" }]);
  assert.deepEqual(noteState(HH, [{ first_name: "A" }], { showInvalid: true }), { text: "Each person needs an id.", className: "is-invalid" });
  assert.deepEqual(noteState(HH, [{ member_id: "0123456789abcdef0123456789abcdef" }], { showInvalid: true }), { text: "", className: "" });
});

test("date parts: each is stripped of non-digits, and a stored value splits at its first two dashes", () => {
  const part = (name, value) => ({ q: "tp_dob", part: name, type: "text", value, checked: false });
  assert.deepEqual(valuesFromControls([part("month", "0-4"), part("day", "12"), part("year", "1961")]), { tp_dob: "1961-04-12" });
  assert.deepEqual(valuesFromControls([part("month", " 4/"), part("day", "1 2"), part("year", "19a61")]), { tp_dob: "1961-4-12" });
  const boxes = (value) => Object.fromEntries(descriptorsFrom(client(q("tp_dob"), value)).map((d) => [d.part, d.value]));
  assert.deepEqual(boxes("1961--12"), { month: "", day: "12", year: "1961" });
  assert.deepEqual(boxes("1961-04-12"), { month: "04", day: "12", year: "1961" });
  assert.deepEqual(boxes("-04-12"), { month: "04", day: "12", year: "" });
  // Never more than three parts: the rest stays in the day box.
  assert.deepEqual(boxes("1961-04-12-7"), { month: "04", day: "12-7", year: "1961" });
});

test("the household fieldset points at its note and its tips", () => {
  const members = Array.from({ length: 10 }, (_, n) => ({ member_id: newMemberId({ getRandomValues: (b) => b.fill(n + 1) }), first_name: `P${n}` }));
  const withTips = { ...HH, tips: { general: [{ en: "Include everyone who lives with you." }] } };
  const html = client(withTips, members, { answers: { has_household_members: "yes" } });
  assert.ok(!html.includes('data-action="add-member"'), "10 members: no Add a person");
  const fieldset = /<fieldset\b[^>]*data-q="hh"[^>]*>/.exec(html)[0];
  const describedBy = attr(fieldset, "aria-describedby").split(" ");
  assert.ok(describedBy.includes("field-client-hh-note") && describedBy.includes("field-client-hh-tips"));
  assert.match(html, /<div class="q-tips" id="field-client-hh-tips">/);
  assert.match(html, /<p id="field-client-hh-note" class="q-note/);
  // Without tips the fieldset names its note only.
  const plain = /<fieldset\b[^>]*data-q="hh"[^>]*>/.exec(client(HH, members.slice(0, 1)))[0];
  assert.equal(attr(plain, "aria-describedby"), "field-client-hh-note");
});

test("email with an inner space is invalid in the browser (spec §2.5)", () => {
  assert.equal(checkValue(q("email"), "mei lin@example.com"), "Enter a valid email address.");
});

test("the senior variant renders the senior wording", () => {
  const question = q("tp_first_name");
  assert.notEqual(question.wording.senior.en, question.wording.general.en);
  const senior = client(question, null, { variant: "senior" });
  assert.ok(senior.includes(question.wording.senior.en));
  assert.ok(!senior.includes(question.wording.general.en));
  assert.ok(client(question, null).includes(question.wording.general.en));
});

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

test("No one clears the others, and another option clears No one", () => {
  const both = [box("us_citizen", "me", true), box("us_citizen", "spouse", false), box("us_citizen", "none", true)];
  assert.deepEqual(valuesFromControls(both, { changed: { q: "us_citizen", value: "none" } }), { us_citizen: ["none"] });
  assert.deepEqual(valuesFromControls(both, { changed: { q: "us_citizen", value: "me" } }), { us_citizen: ["me"] });
  assert.deepEqual(valuesFromControls(both), { us_citizen: ["me", "none"] });
  // A change to another question leaves this one as checked.
  assert.deepEqual(valuesFromControls(both, { changed: { q: "disabled", value: "me" } }), { us_citizen: ["me", "none"] });
});

test("round trip: render with a value, read the controls back", () => {
  assert.equal(roundTrip(q("tp_dob"), "1961-04-12"), "1961-04-12");
  assert.deepEqual(roundTrip(q("us_citizen"), ["me", "spouse"], { answers: { marital_status: "married" } }), ["me", "spouse"]);
  assert.deepEqual(roundTrip(q("best_contact_time"), ["weekday_evening", "weekend"]), ["weekday_evening", "weekend"]);
  assert.equal(roundTrip(q("inc_wages"), "not_sure"), "not_sure");
  assert.equal(roundTrip(q("marital_status"), "married"), "married");
  assert.equal(roundTrip(q("additional_notes"), "Line one\n<Line & two>"), "Line one\n<Line & two>");
  assert.equal(roundTrip(q("tp_first_name"), `O'Brien "Mei"`), `O'Brien "Mei"`);
  const members = [
    {
      member_id: "0123456789abcdef0123456789abcdef", first_name: "Xiao Ming", last_name: "Wang", dob: "2015-03-14", relationship: "son_daughter",
      months_lived: "12", married: "single", us_citizen: "yes", resident_na: "yes",
      fulltime_student: "no", disabled: "no", ippin: "not_sure",
    },
    { member_id: "fedcba9876543210fedcba9876543210", first_name: "Bo" },
  ];
  assert.deepEqual(roundTrip(HH, members, { answers: { has_household_members: "yes" } }), members);
  // Empty values.
  assert.equal(roundTrip(q("tp_first_name"), null), null);
  assert.equal(roundTrip(q("tp_first_name"), ""), null);
  assert.equal(roundTrip(q("inc_wages"), null), null);
  assert.equal(roundTrip(q("tp_dob"), null), null);
});

test("reading keeps the box's text exactly", () => {
  assert.deepEqual(valuesFromControls([text("tp_first_name", "hello ")]), { tp_first_name: "hello " });
  assert.deepEqual(valuesFromControls([text("addr_zip", " 12345 ")]), { addr_zip: " 12345 " });
  assert.deepEqual(valuesFromControls([text("tp_first_name", "   ")]), { tp_first_name: null });
  assert.deepEqual(valuesFromControls([text("tp_first_name", "")]), { tp_first_name: null });
});

test("dates: all empty is null, a partial date is kept, an impossible date is read", () => {
  const date = (month, day, year) => [
    { q: "tp_dob", part: "month", type: "text", value: month, checked: false },
    { q: "tp_dob", part: "day", type: "text", value: day, checked: false },
    { q: "tp_dob", part: "year", type: "text", value: year, checked: false },
  ];
  assert.deepEqual(valuesFromControls(date("", "", "")), { tp_dob: null });
  assert.deepEqual(valuesFromControls(date("04", "12", "")), { tp_dob: "-04-12" });
  assert.deepEqual(valuesFromControls(date("02", "30", "2025")), { tp_dob: "2025-02-30" });
  assert.deepEqual(valuesFromControls(date("", "12", "1961")), { tp_dob: "1961--12" });
  // A partial date goes back into its boxes after a redraw.
  const partial = client(q("tp_dob"), "-04-12");
  const boxes = Object.fromEntries(descriptorsFrom(partial).map((d) => [d.part, d.value]));
  assert.deepEqual(boxes, { month: "04", day: "12", year: "" });
  assert.equal(roundTrip(q("tp_dob"), "-04-12"), "-04-12");
  assert.equal(roundTrip(q("tp_dob"), "1961--12"), "1961--12");
  // Invalid, so withheld.
  assert.equal(typeof checkValue(q("tp_dob"), "-04-12"), "string");
  assert.deepEqual(withholdInvalid({ tp_dob: "-04-12", tp_first_name: "Mei" }, 2), { tp_first_name: "Mei" });
});

test("an empty household card is kept by readField and dropped otherwise", () => {
  const card = (member, sub, value) => ({ q: "hh", member, sub, type: "text", value, checked: false });
  const descriptors = [
    card("0", "first_name", "Ming"), card("0", "last_name", ""),
    card("1", "first_name", ""), card("1", "last_name", "  "),
    { q: "hh", member: "1", sub: "us_citizen", type: "radio", value: "yes", checked: false },
  ];
  assert.deepEqual(valuesFromControls(descriptors, { keepEmptyMembers: true }), { hh: [{ first_name: "Ming" }, {}] });
  assert.deepEqual(valuesFromControls(descriptors), { hh: [{ first_name: "Ming" }] });
  assert.deepEqual(sendable(HH, [{ first_name: "Ming" }, {}]), [{ first_name: "Ming" }]);
  assert.deepEqual(sendable(HH, [{ first_name: " Ming ", last_name: "  " }]), [{ first_name: "Ming" }]);
});

test("mergeIntoDraft keeps absent keys, sets null and never mutates", () => {
  const draft = Object.freeze({ tp_first_name: "Mei", email: "mei@example.com", hh: Object.freeze([{ member_id: "0123456789abcdef0123456789abcdef", first_name: "Ming" }]) });
  const next = mergeIntoDraft(draft, { email: null, hh: [{ member_id: "fedcba9876543210fedcba9876543210", first_name: "Bo" }] });
  assert.deepEqual(next, { tp_first_name: "Mei", email: null, hh: [{ member_id: "fedcba9876543210fedcba9876543210", first_name: "Bo" }] });
  assert.notEqual(next, draft);
  assert.equal(draft.email, "mei@example.com");
});

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

test("withholdInvalid removes only invalid fields, trimmed", () => {
  const draft = { email: "a@", tp_first_name: "Mei", tp_middle_name: null, addr_zip: "12345" };
  const copy = structuredClone(draft);
  assert.deepEqual(withholdInvalid(draft, 2), { tp_first_name: "Mei", tp_middle_name: null, addr_zip: "12345" });
  assert.deepEqual(draft, copy);
  assert.deepEqual(withheldFields(draft, 2), ["email"]);
  assert.deepEqual(withholdInvalid({ addr_zip: " 19107 ", tp_first_name: "Mei " }, 2), { addr_zip: "19107", tp_first_name: "Mei" });
  const household = { has_household_members: "yes", hh: [{ member_id: "0123456789abcdef0123456789abcdef", first_name: "Bo", dob: "2025-02-30" }] };
  const sent = withholdInvalid(household, 2);
  assert.equal("hh" in sent, false);
  assert.equal(sent.has_household_members, "yes");
  assert.deepEqual(withheldFields(household, 2), ["hh"]);
});

test("sendableDiffers: only what a save would change", () => {
  const server = { tp_first_name: "Mei", email: "mei@example.com", addr_zip: "19107" };
  assert.equal(sendableDiffers({ ...server }, server, 2), false);
  assert.equal(sendableDiffers({ ...server, tp_first_name: "Mei " }, server, 2), false);
  assert.equal(sendableDiffers({ ...server, email: "a@" }, server, 2), false);
  assert.equal(sendableDiffers({ ...server, tp_first_name: "Ming" }, server, 2), true);
  assert.equal(sendableDiffers({ ...server, tp_middle_name: null, best_contact_time: [] }, server, 2), false);
  assert.equal(sendableDiffers({ ...server, email: null }, server, 2), true);
  assert.equal(sendableDiffers({ ...server, hh: [{ member_id: "0123456789abcdef0123456789abcdef", first_name: "Ming" }, {}] }, { ...server, hh: [{ member_id: "0123456789abcdef0123456789abcdef", first_name: "Ming" }] }, 2), false);
  assert.equal(sendableDiffers({ ...server, hh: [{ member_id: "fedcba9876543210fedcba9876543210", first_name: "Bo" }] }, { ...server, hh: [{ member_id: "0123456789abcdef0123456789abcdef", first_name: "Ming" }] }, 2), true);
  assert.equal(sendableDiffers({ ...server, best_contact_time: ["weekend"] }, { ...server, best_contact_time: ["weekend"] }, 2), false);
});

test("keepLocalOnly keeps withheld values and space-only differences", () => {
  const previous = { tp_first_name: "Mei", email: "a@", addr_zip: " 19107 ", tp_last_name: "Lin", hh: [{ member_id: "0123456789abcdef0123456789abcdef", first_name: "Ming" }, {}] };
  const server = { tp_first_name: "Ming", addr_zip: "19107", tp_last_name: "Chen", hh: [{ member_id: "0123456789abcdef0123456789abcdef", first_name: "Ming" }], tp_dob: "1961-04-12" };
  assert.deepEqual(keepLocalOnly(previous, server, 2), {
    tp_first_name: "Ming", email: "a@", addr_zip: " 19107 ", tp_last_name: "Chen",
    hh: [{ member_id: "0123456789abcdef0123456789abcdef", first_name: "Ming" }, {}], tp_dob: "1961-04-12",
  });
});

// ---------------------------------------------------------------------------
// Read-only text
// ---------------------------------------------------------------------------

test("formatAnswer", () => {
  assert.equal(formatAnswer(q("tp_dob"), "1961-04-12"), "Apr 12, 1961");
  assert.equal(formatAnswer(q("tp_phone"), "2155550199"), "(215) 555-0199");
  assert.equal(formatAnswer(q("us_citizen"), ["me", "spouse"]), "Me, My spouse");
  assert.equal(formatAnswer(q("inc_wages"), "not_sure"), yesnoLabel("not_sure"));
  assert.equal(formatAnswer(q("service"), "drop_off"), "Drop-off");
  assert.equal(formatAnswer(q("tp_first_name"), "Mei"), "Mei");
  // The catalogue's relationship label is "Son / Daughter" (no "Son" option exists).
  const relationship = label(sub("relationship").options.find((o) => o.value === "son_daughter"));
  assert.equal(
    formatAnswer(HH, [{ member_id: "0123456789abcdef0123456789abcdef", first_name: "Xiao Ming", last_name: "Wang", relationship: "son_daughter", dob: "2015-03-14", months_lived: "12" }]),
    `Xiao Ming Wang · ${relationship} · born Mar 14, 2015 · lived with you 12 months`,
  );
  assert.equal(
    formatAnswer(HH, [{ member_id: "0123456789abcdef0123456789abcdef", first_name: "Xiao Ming", middle_name: "Q", last_name: "Wang", relationship: "son_daughter", dob: "2015-03-14", months_lived: "12" }]),
    `Xiao Ming Q Wang · ${relationship} · born Mar 14, 2015 · lived with you 12 months`,
  );
  for (const empty of [null, undefined, "", "  ", []]) assert.equal(formatAnswer(q("tp_first_name"), empty), null);
  assert.equal(formatAnswer(q("us_citizen"), []), null);
  assert.equal(formatAnswer(HH, [{}]), null);
});

// ---------------------------------------------------------------------------
// Part 4d, Task 3: the form's text in the screen language
// (docs/superpowers/specs/2026-10-05-chinese-on-screen-design.md §3.2). Without
// lang, every function above still returns today's English.
// ---------------------------------------------------------------------------

const LANGUAGES = ["en", "zh-Hans", "zh-Hant"];
const HAN = /\p{Script=Han}/u;
const inLang = (pair, lang) => (lang === "en" ? pair.en : lang === "zh-Hans" ? pair.zh : HANT_MAP[pair.zh]);
const withHant = (fn) => {
  setHantMap(HANT_MAP);
  try {
    fn();
  } finally {
    setHantMap(null);
  }
};
// Answers under which every condition of `conditions` holds.
// A rule (op "any") holds through the first of its groups that doesn't contradict
// the plain conditions beside it.
const satisfying = (conditions) => {
  const plain = (conditions ?? []).filter((c) => c.op !== "any");
  const answers = Object.fromEntries(
    plain.map((c) => [c.field, c.op === "eq" || c.op === "gte" || c.op === "lte" ? String(c.value) : c.op === "filled" ? "x" : "__other__"]),
  );
  for (const rule of (conditions ?? []).filter((c) => c.op === "any")) {
    const options = rule.groups.map((group) => satisfying(group));
    const fits = options.find((option) => Object.entries(option).every(([field, value]) => !(field in answers) || answers[field] === value));
    Object.assign(answers, fits ?? options[0]);
  }
  return answers;
};
const optionsOf = (question) =>
  question.type === "who" ? CATALOGUE.fixedOptions.who.options
    : question.type === "yesno" ? question.options.map((o) => CATALOGUE.fixedOptions.yesno.options.find((y) => y.value === o.value) ?? o)
      : question.options ?? [];

test("every question's wording, option and tip renders in all three languages; zh-Hant is the map's value", () => {
  withHant(() => {
    const every = [...ALL, ...HH.fields.filter((f) => f.type !== "id")];
    let tipCount = 0;
    for (const question of every)
      for (const variant of ["general", "senior"])
        for (const lang of LANGUAGES) {
          const where = `${question.id} ${variant} ${lang}`;
          const title = inLang(question.wording[variant] ?? question.wording.general, lang);
          assert.ok(title, where);
          const html = client(question, null, { variant, lang, answers: { marital_status: "married" } });
          assert.ok(html.includes(esc(title)), where);
          for (const option of optionsOf(question)) {
            const text = inLang(option.label[variant] ?? option.label.general, lang);
            assert.ok(text, `${where} ${option.value}`);
            assert.ok(html.includes(`>${esc(text)}<`), `${where} ${option.value}`);
          }
          for (const tip of question.tips?.[variant] ?? question.tips?.general ?? []) {
            const text = inLang(tip, lang);
            assert.ok(text, `${where} tip`);
            const shown = client(question, null, { variant, lang, answers: { marital_status: "married", ...satisfying(tip.showIf) } });
            assert.ok(shown.includes(renderRichText(text)), `${where} tip ${text.slice(0, 30)}`);
            tipCount += 1;
          }
        }
    assert.ok(tipCount > 0);
  });
});

test("date boxes: year, month, day in Chinese, month, day, year in English; ids unchanged; the year box marked by its part", () => {
  assert.deepEqual(datePartsFor().map((p) => p.part), ["month", "day", "year"]);
  assert.deepEqual(datePartsFor("en").map((p) => [p.part, p.label, p.hint, p.size]), [["month", "Month", "MM", 2], ["day", "Day", "DD", 2], ["year", "Year", "YYYY", 4]]);
  withHant(() => {
    for (const lang of ["zh-Hans", "zh-Hant"]) {
      assert.deepEqual(datePartsFor(lang).map((p) => [p.part, p.label, p.hint, p.size]), [["year", "年", "YYYY", 4], ["month", "月", "MM", 2], ["day", "日", "DD", 2]], lang);
      const html = client(q("tp_dob"), "1961-04-12", { lang });
      const order = [...html.matchAll(/<label for="field-client-tp_dob-(\w+)" class="q-date-part is-(\w+)"><span>([^<]*)<\/span>/g)].map((m) => [m[1], m[2], m[3]]);
      assert.deepEqual(order, [["year", "year", "年"], ["month", "month", "月"], ["day", "day", "日"]], lang);
      assert.match(html, /id="field-client-tp_dob-year"[^>]*placeholder="YYYY" value="1961"/);
    }
  });
  for (const options of [{}, { lang: "en" }]) {
    const html = client(q("tp_dob"), "1961-04-12", options);
    const order = [...html.matchAll(/<label for="field-client-tp_dob-(\w+)" class="q-date-part is-(\w+)"><span>([^<]*)<\/span>/g)].map((m) => [m[1], m[2], m[3]]);
    assert.deepEqual(order, [["month", "month", "Month"], ["day", "day", "Day"], ["year", "year", "Year"]]);
  }
});

test("styles: the year box is widened by its part, not its position", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /\.q-date-part:last-child/);
  assert.equal(css.match(/\.q-date-part\.is-year input\.q-input\s*\{/g)?.length, 2);
});

test("formatDate: Apr 12, 1961 in English, 1961年4月12日 in Chinese; a partial date as is", () => {
  assert.equal(formatDate("1961-04-12"), "Apr 12, 1961");
  assert.equal(formatDate("1961-04-12", "en"), "Apr 12, 1961");
  assert.equal(formatDate("1961-04-12", "zh-Hans"), "1961年4月12日");
  assert.equal(formatDate("1961-04-12", "zh-Hant"), "1961年4月12日");
  for (const lang of LANGUAGES) {
    assert.equal(formatDate("1961--12", lang), "1961--12");
    assert.equal(formatDate("-04-12", lang), "-04-12");
    assert.equal(formatDate("1961-13-01", lang), "1961-13-01");
  }
});

test("formatAnswer in Chinese: dates, labels and the household line", () => {
  withHant(() => {
    assert.equal(formatAnswer(q("tp_dob"), "1961-04-12", { lang: "zh-Hans" }), "1961年4月12日");
    const me = CATALOGUE.fixedOptions.who.options.find((o) => o.value === "me").label.general.zh;
    const spouse = CATALOGUE.fixedOptions.who.options.find((o) => o.value === "spouse").label.general.zh;
    assert.equal(formatAnswer(q("us_citizen"), ["me", "spouse"], { lang: "zh-Hans" }), `${me}、${spouse}`);
    assert.equal(formatAnswer(q("us_citizen"), ["me", "spouse"], { lang: "zh-Hant" }), `${HANT_MAP[me]}、${HANT_MAP[spouse]}`);
    const relationship = sub("relationship").options.find((o) => o.value === "son_daughter").label.general.zh;
    const member = { member_id: "0123456789abcdef0123456789abcdef", first_name: "Xiao Ming", last_name: "Wang", relationship: "son_daughter", dob: "2015-03-14", months_lived: "12" };
    assert.equal(formatAnswer(HH, [member], { lang: "zh-Hans" }), `Xiao Ming Wang · ${relationship} · 2015年3月14日出生 · 居住 12 个月`);
    assert.equal(formatAnswer(HH, [{ ...member, months_lived: "1" }]), `Xiao Ming Wang · ${label(sub("relationship").options.find((o) => o.value === "son_daughter"))} · born Mar 14, 2015 · lived with you 1 month`);
  });
});

test("rangeText and countText in all three languages", () => {
  const months = sub("months_lived");
  assert.equal(rangeText(months), "0 to 12");
  assert.equal(rangeText(months, "en"), "0 to 12");
  assert.equal(rangeText(months, "zh-Hans"), "0 至 12");
  assert.equal(rangeText({ min: 1 }, "en"), "1 or more");
  assert.equal(rangeText({ min: 1 }, "zh-Hans"), "1 或以上");
  assert.equal(rangeText({}, "zh-Hans"), "");
  assert.equal(countText("a".repeat(4612), "en"), "4,612 of 5,000 characters");
  assert.equal(countText("a".repeat(4612), "zh-Hans"), "已输入 4,612 / 5,000 个字");
  assert.equal(countText("a".repeat(4500), "zh-Hans"), "");
  withHant(() => {
    assert.equal(rangeText(months, "zh-Hant"), "0 至 12");
    assert.equal(rangeText({ min: 1 }, "zh-Hant"), "1 或以上");
    assert.equal(countText("a".repeat(4612), "zh-Hant"), "已輸入 4,612 / 5,000 個字");
    assert.ok(renderQuestion(months, null, { lang: "zh-Hant" }).includes('<span class="q-range">0 至 12</span>'));
    assert.ok(client(q("additional_notes"), "a".repeat(4612), { lang: "zh-Hant" }).includes("已輸入 4,612 / 5,000 個字"));
  });
});

test("the note in Chinese: Needs an answer and the answer checks' messages", () => {
  const first = q("tp_first_name");
  assert.deepEqual(noteState(first, null, { showMissing: true, lang: "zh-Hans" }), { text: "需要回答", className: "is-missing" });
  assert.deepEqual(noteState(q("email"), "a@", { showInvalid: true, lang: "zh-Hans" }), { text: "请输入有效的电子邮箱。", className: "is-invalid" });
  assert.deepEqual(noteState(first, "x".repeat(201), { showInvalid: true, lang: "zh-Hans" }), { text: "最多 200 个字。", className: "is-invalid" });
  assert.deepEqual(noteState(sub("months_lived"), "13", { showInvalid: true, lang: "zh-Hans" }), { text: "请输入 0 至 12 之间的数字。", className: "is-invalid" });
  assert.ok(client(first, null, { showMissing: true, lang: "zh-Hans" }).includes('class="q-note is-missing" aria-live="polite">需要回答</p>'));
  withHant(() => {
    assert.deepEqual(noteState(first, null, { showMissing: true, lang: "zh-Hant" }), { text: "需要回答", className: "is-missing" });
    assert.equal(invalidText("Enter a valid email address.", "zh-Hant"), HANT_MAP["请输入有效的电子邮箱。"]);
  });
  // English: the reason as checkValue gave it.
  assert.equal(invalidText("Use at most 200 characters."), "Use at most 200 characters.");
  assert.equal(invalidText("Use at most 200 characters.", "en"), "Use at most 200 characters.");
});

test("a household member's note names the sub-field by its wording in Chinese; English keeps the id", () => {
  const badDob = [{ member_id: "0".repeat(31) + "1", dob: "1961-02-30" }];
  const reason = checkValue(HH, badDob);
  assert.equal(reason, "dob: Enter a real date as YYYY-MM-DD.");
  const dob = sub("dob");
  const zh = noteState(HH, badDob, { showInvalid: true, lang: "zh-Hans" }).text;
  assert.equal(zh, `${wording(dob, { lang: "zh-Hans" })}：${invalidText("Enter a real date as YYYY-MM-DD.", "zh-Hans")}`);
  assert.doesNotMatch(zh, /dob/);
  withHant(() => {
    const hant = noteState(HH, badDob, { showInvalid: true, lang: "zh-Hant" }).text;
    assert.ok(hant.startsWith(`${HANT_MAP[dob.wording.general.zh]}：`), hant);
  });
  // English is byte for byte what it was: the id and checkValue's reason.
  assert.equal(noteState(HH, badDob, { showInvalid: true }).text, reason);
  assert.equal(invalidText(reason, "en", HH), reason);
  // Without the household, or for a sub-field it lacks, the id stands.
  assert.equal(invalidText(reason, "zh-Hans"), `dob：${invalidText("Enter a real date as YYYY-MM-DD.", "zh-Hans")}`);
  assert.ok(invalidText("nope: Expected text.", "zh-Hans", HH).startsWith("nope："));
});

test("every message checkValue can return reads in Chinese through invalidText", () => {
  const reasons = new Set();
  const add = (question, value) => {
    const reason = checkValue(question, value);
    assert.ok(reason, `${question.id ?? question.type} ${JSON.stringify(value)}`);
    reasons.add(reason);
  };
  for (const row of INTAKE_VALUE_CASES) if (!row.js) add(q(row.field), row.value);
  // A bad value of each type, and every rule of the household.
  add(q("tp_first_name"), "x".repeat(201));
  add(q("additional_notes"), "x".repeat(5001));
  add(q("gcf_tp_signature"), "x".repeat(201));
  add(q("email"), "a@");
  add(q("tp_phone"), "123");
  add(q("addr_zip"), "1234");
  add(q("tp_dob"), "1961-02-30");
  add(q("spouse_death_year"), "61");
  add(q("inc_wages_job_count"), "two");
  add(q("inc_wages_job_count"), "1234567");
  add(sub("months_lived"), "13");
  add(q("marital_status"), "unknown");
  add(q("married_last_day"), "maybe");
  add(q("us_citizen"), ["none", "me"]);
  add(q("us_citizen"), ["me", "me"]);
  add(q("us_citizen"), ["stranger"]);
  add(q("us_citizen"), "me");
  add(q("best_contact_time"), "x");
  add(q("tp_first_name"), 7);
  add(sub("member_id"), "XYZ");
  add({ id: "odd", type: "odd" }, "x");
  add(HH, "Bo");
  add(HH, Array.from({ length: 11 }, (_, i) => ({ member_id: (i + 1).toString(16).padStart(32, "0") })));
  add(HH, [null]);
  add(HH, [{ member_id: "0".repeat(31) + "1", extra: "x" }]);
  add(HH, [{ member_id: "0".repeat(31) + "1", dob: "1961-02-30" }]);
  add(HH, [{ first_name: "Ming" }]);
  add(HH, [{ member_id: "0".repeat(31) + "1" }, { member_id: "0".repeat(31) + "1" }]);
  assert.ok(reasons.size >= 25, `${reasons.size} distinct messages`);
  withHant(() => {
    for (const reason of reasons)
      for (const lang of ["zh-Hans", "zh-Hant"]) {
        const text = invalidText(reason, lang);
        assert.match(text, HAN, `${lang}: ${reason}`);
        assert.doesNotMatch(text, /\b(Enter|Use|Choose|Expected|Digits|At most|Not|No|Each|Two|Unknown)\b/, `${lang}: ${reason} → ${text}`);
      }
  });
});

test("part statuses, household buttons and the select's blank option in Chinese", () => {
  const visited = ["about.you"];
  assert.deepEqual(substepStatus("about.you", { answers: {}, visited, lang: "zh-Hans" }), { key: "needs", text: "需要回答" });
  assert.deepEqual(stepRollup("about", { answers: {}, visited, lang: "zh-Hans" }), { key: "needs", text: "需要回答" });
  assert.deepEqual(substepStatus("review.summary", { visited: ["review.summary"], lang: "zh-Hans" }), { key: "done", text: "已完成" });
  assert.deepEqual(substepStatus("review.summary", { visited: [], lang: "zh-Hans" }), { key: "none", text: "" });
  const docs = substepsFor(2).find((s) => s.kind === "documents" && s.cards !== "bring" && s.cards !== "other");
  const owing = [{ substep: docs.cards, group: "needed", status: "not_done" }];
  assert.deepEqual(substepStatus(docs.id, { visited: [docs.id], cards: owing, lang: "zh-Hans" }), { key: "docs", text: "需要文件" });
  // English unchanged without lang.
  assert.deepEqual(substepStatus(docs.id, { visited: [docs.id], cards: owing }), { key: "docs", text: "Needs documents" });

  const member = { member_id: "0123456789abcdef0123456789abcdef", first_name: "Ming" };
  const zh = client(HH, [member], { lang: "zh-Hans" });
  assert.ok(zh.includes(">成员 1</h3>"));
  assert.ok(zh.includes('aria-label="移除成员 1"'));
  assert.match(zh, /data-action="remove-member"[^>]*>移除<\/button>/);
  assert.match(zh, /data-action="add-member"[^>]*>添加一位家庭成员<\/button>/);
  const en = client(HH, [member]);
  assert.ok(en.includes(">Person 1</h3>") && en.includes('aria-label="Remove person 1"'));
  assert.match(en, /data-action="add-member"[^>]*>Add a person<\/button>/);

  const relationship = sub("relationship");
  assert.ok(renderQuestion(relationship, null, { lang: "zh-Hans" }).includes('<option value="">请选择</option>'));
  assert.ok(renderQuestion(relationship, null).includes('<option value="">Select an option</option>'));
  withHant(() => {
    assert.ok(renderQuestion(relationship, null, { lang: "zh-Hant" }).includes(`<option value="">${HANT_MAP["请选择"]}</option>`));
    assert.match(client(HH, [member], { lang: "zh-Hant" }), new RegExp(`data-action="add-member"[^>]*>${HANT_MAP["添加一位家庭成员"]}</button>`));
  });
});

test("an unmarried client's who question asks directly, as Yes/No radio buttons; the answer stays a list", () => {
  const single = { marital_status: "never_married" };
  const married = { marital_status: "married" };
  const citizen = renderQuestion(q("us_citizen"), ["none"], { answers: single });
  assert.match(citizen, /Are you a U\.S\. citizen\?/);
  assert.equal((citizen.match(/type="radio"/g) ?? []).length, 2);
  assert.doesNotMatch(citizen, /type="checkbox"/);
  assert.match(citizen, /value="me"><span>Yes<\/span>/);
  assert.match(citizen, /value="none" checked><span>No<\/span>/);
  assert.match(renderQuestion(q("us_citizen"), null, { lang: "zh-Hans", answers: single }), /您是美国公民吗？[\s\S]*<span>是<\/span>[\s\S]*<span>否<\/span>/);

  const asked = renderQuestion(q("us_citizen"), ["me"], { answers: married });
  assert.match(asked, /Who is a U\.S\. citizen\?/);
  assert.equal((asked.match(/type="checkbox"/g) ?? []).length, 3);
  assert.match(asked, /My spouse/);

  // Section 8's "who" questions: same options, their own wording.
  const fund = renderQuestion(q("pecf"), null, { answers: single });
  assert.equal((fund.match(/type="radio"/g) ?? []).length, 2);
  assert.match(fund, /<span>Yes<\/span>[\s\S]*<span>No<\/span>/);

  // A radio's single value is read back as a list.
  const radios = (checked) => [
    { q: "us_citizen", type: "radio", value: "me", checked: checked === "me" },
    { q: "us_citizen", type: "radio", value: "none", checked: checked === "none" },
  ];
  assert.deepEqual(valuesFromControls(radios("me")), { us_citizen: ["me"] });
  assert.deepEqual(valuesFromControls(radios("none")), { us_citizen: ["none"] });
  assert.deepEqual(valuesFromControls(radios(null)), { us_citizen: null });

  // Labels: Yes/No with an unmarried application, Me/No one without one or when married.
  assert.equal(formatAnswer(q("on_visa"), ["none"], { answers: single }), "No");
  assert.equal(formatAnswer(q("on_visa"), ["me"], { answers: single }), "Yes");
  assert.equal(formatAnswer(q("on_visa"), ["none"]), "No one");
  assert.equal(formatAnswer(q("on_visa"), ["me", "spouse"], { answers: married }), "Me, My spouse");
});

test("invalidText: a year range in Chinese, without digit grouping (add-widowed-spouse-rules)", () => {
  const reason = checkValue({ id: "y", type: "year", min: 1900, max: 2025 }, "2205");
  assert.equal(reason, "Enter a year from 1900 to 2025.");
  assert.equal(invalidText(reason, "zh-Hans"), "请输入 1900 至 2025 之间的年份。");
  assert.equal(invalidText(reason, "en"), reason);
});

test("the 14446 gate: an unconsented form lands on 0.4 (add-form-14446-consent)", () => {
  assert.equal(consented({}), false);
  assert.equal(consented({ vc_agree: [] }), false);
  assert.equal(consented({ vc_agree: ["yes"] }), true);
  const open = { vc_agree: ["yes"] };
  assert.equal(resolveSubstep("about.address", {}, []), "before.virtual");
  assert.equal(resolveSubstep("review.check", {}, []), "before.virtual");
  assert.equal(resolveSubstep("before.language", {}, []), "before.language");
  assert.equal(resolveSubstep("about.address", open, []), "about.address");
  assert.equal(resolveSubstep(null, {}, []), "before.ready");
});

// Issue 147: autofill on a phone, for the taxpayer's own fields only.
test("issue 147: the client's own fields carry autocomplete tokens in the client's intake", () => {
  const attr = (html) => [...html.matchAll(/autocomplete="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(attr(renderQuestion(q("tp_first_name"), "", { scope: "client" })), ["given-name"]);
  assert.deepEqual(attr(renderQuestion(q("tp_last_name"), "", { scope: "client" })), ["family-name"]);
  assert.deepEqual(attr(renderQuestion(q("tp_phone"), "", { scope: "client" })), ["tel"]);
  assert.deepEqual(attr(renderQuestion(q("email"), "", { scope: "client" })), ["email"]);
  assert.deepEqual(attr(renderQuestion(q("addr_zip"), "", { scope: "client" })), ["postal-code"]);
  // The birthday's three boxes each get their part.
  assert.deepEqual(attr(renderQuestion(q("tp_dob"), "", { scope: "client" })).sort(), ["bday-day", "bday-month", "bday-year"]);
  // Every id in the map is a real question.
  for (const id of Object.keys(CLIENT_AUTOFILL)) assert.ok(q(id), `${id} is in the catalogue`);
});

test("issue 147: no autocomplete for anyone else's fields, a signature, or the office's forms", () => {
  const none = (id, scope = "client") => assert.doesNotMatch(renderQuestion(q(id), "", { scope }), /autocomplete=/, `${id} (${scope})`);
  for (const id of ["sp_first_name", "sp_last_name", "sp_dob", "sp_phone", "vc_tp_signature", "vc_sp_signature", "vc_sp_email", "best_contact_note"]) none(id);
  // The office types a client's answers: its own saved details must not be offered.
  for (const id of Object.keys(CLIENT_AUTOFILL)) none(id, "office");
  // Household members (a group) get none.
  assert.equal(q("hh").type, "group");
  assert.doesNotMatch(renderQuestion(q("hh"), [{ first_name: "", last_name: "" }], { scope: "client" }), /autocomplete=/);
});
