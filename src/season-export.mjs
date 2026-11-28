// The season export: turns the answer of vitally_export_season() into a README
// and eight CSVs, and packs them in a stored ZIP (change add-season-export).
// Staff and English only. Every file is built from explicit columns, and answers
// only from catalogue questions, so a stray key in the stored answers never leaks.
import { toCsv } from "./csv.mjs";
import { zipStored } from "./zip.mjs";
import { CATALOGUE, isAnswered, visibleAnswers, wording } from "./intake-catalogue.mjs";
import { householdRows } from "./shaded-fields.mjs";
import { CLOSING_REASON_NAMES, describeStage } from "./domain.mjs";
import {
  CONTACT_DIRECTIONS,
  CONTACT_METHODS,
  CONTACT_PURPOSES,
  CONTACT_WITH,
  VOICE_OUTCOMES,
  WRITTEN_OUTCOMES,
} from "./contact-log.mjs";

export const EXPORT_FILES = Object.freeze([
  "cases.csv",
  "intake-answers.csv",
  "household-members.csv",
  "status-history.csv",
  "messages.csv",
  "follow-ups.csv",
  "call-log.csv",
  "help-requests.csv",
]);

export const FREE_TEXT_WARNING =
  "Messages, notes and call log entries are exported as staff and clients wrote them. Notes must not hold amounts or ID numbers.";

const ZONE = "America/New_York";
const clock = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const nyParts = (when) => Object.fromEntries(clock.formatToParts(new Date(when)).map((p) => [p.type, p.value]));
const nyDate = (when) => {
  const p = nyParts(when);
  return `${p.year}-${p.month}-${p.day}`;
};
const nyTime = (when) => {
  if (when == null) return "";
  const p = nyParts(when);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
};

export const seasonExportFilename = (season, now) => `vitally-${season}-export-${nyDate(now)}.zip`;

const cell = (value) => (value == null ? "" : value);
const byTime = (a, b) => Date.parse(a.at) - Date.parse(b.at);
const labelIn = (list, code) => list.find(([key]) => key === code)?.[1] ?? cell(code);

const UNKNOWN_STAGE_LABEL = describeStage("\u0000unknown", "en", null).label;
const stageLabel = (c) => {
  const label = describeStage(c.stage, "en", { closingReason: c.closingReason }).label;
  return label === UNKNOWN_STAGE_LABEL ? cell(c.stage) : label;
};

// ---- answers ----

const optionsOf = (question) => {
  if (question.type === "who") return CATALOGUE.fixedOptions.who.options;
  if (question.type === "yesno")
    return (question.options ?? []).map((o) => CATALOGUE.fixedOptions.yesno.options.find((f) => f.value === o.value) ?? o);
  return question.options ?? [];
};
const optionText = (question, value) => {
  const option = optionsOf(question).find((o) => o.value === value);
  return option?.label?.general?.en ?? String(value);
};

function answerText(question, value) {
  if (question.type === "group") {
    const fields = (question.fields ?? []).filter((f) => f.id !== "member_id");
    return (Array.isArray(value) ? value : [])
      .map((m) => fields.map((f) => answerText(f, m?.[f.id])).filter((t) => t !== "").join(", "))
      .join("; ");
  }
  if (!isAnswered(value)) return "";
  if (Array.isArray(value)) return value.map((v) => optionText(question, v)).join("; ");
  if (["choice", "yesno", "who", "multi"].includes(question.type)) return optionText(question, value);
  return String(value);
}

const QUESTIONS = CATALOGUE.steps.flatMap((s) => s.sections.flatMap((x) => x.questions));
const HOUSEHOLD = QUESTIONS.find((q) => q.id === "hh");
const MEMBER_FIELDS = (HOUSEHOLD?.fields ?? []).filter((f) => f.id !== "member_id");

// ---- the CSVs ----

export function seasonExportCsvs(answer) {
  const cases = answer.cases ?? [];
  const byId = new Map(cases.map((c) => [c.id, c]));
  const number = (caseId) => cell(byId.get(caseId)?.clientNumber);
  const file = (name, header, rows) => ({ name, text: toCsv(header, rows), rows: rows.length });
  const sorted = (items) => items.sort(byTime).map((i) => i.row);

  const caseRows = cases.map((c) => [
    c.clientNumber, c.reference, c.origin, stageLabel(c),
    c.closingReason ? (CLOSING_REASON_NAMES[c.closingReason] ?? c.closingReason) : "",
    nyTime(c.submittedAt), c.preparerName, c.reviewerName,
  ].map(cell));

  const answerRows = [];
  const householdRowsOut = [];
  for (const c of cases) {
    const answers = c.answers ?? {};
    const shown = visibleAnswers(2, answers);
    for (const q of QUESTIONS) {
      if (!Object.hasOwn(shown, q.id) || !isAnswered(shown[q.id])) continue;
      answerRows.push([
        c.clientNumber, c.reference, q.id, wording(q, { lang: "en", answers }), answerText(q, shown[q.id]),
      ].map(cell));
    }
    const members = Array.isArray(shown.hh) ? shown.hh.slice(0, householdRows(answers, { version: 2 })) : [];
    members.forEach((m, i) => {
      householdRowsOut.push([
        c.clientNumber, c.reference, i + 1, ...MEMBER_FIELDS.map((f) => answerText(f, m?.[f.id])),
      ].map(cell));
    });
  }

  const history = sorted((answer.events ?? []).map((e) => ({
    at: e.createdAt,
    row: [number(e.caseId), nyTime(e.createdAt), e.action, e.actorName, e.detail == null ? "" : JSON.stringify(e.detail)].map(cell),
  })));

  const messages = sorted([
    ...(answer.documentRequests ?? []).map((d) => ({
      at: d.createdAt,
      row: [number(d.caseId), nyTime(d.createdAt), "Document request", d.requestedByName, d.title, d.message, d.status].map(cell),
    })),
    ...(answer.clientEvents ?? []).map((e) => ({
      at: e.createdAt,
      row: [number(e.caseId), nyTime(e.createdAt), "Client history", "PCDC", "", e.message, ""].map(cell),
    })),
  ]);

  const followups = sorted((answer.followups ?? []).map((f) => ({
    at: f.createdAt,
    row: [number(f.caseId), f.reason, f.assigneeName, f.status, f.resolutionOutcome, f.resolutionNote,
      nyTime(f.createdAt), nyTime(f.resolvedAt)].map(cell),
  })));

  const outcomeLabel = (code) => labelIn([...VOICE_OUTCOMES, ...WRITTEN_OUTCOMES], code);
  const calls = sorted([
    ...(answer.contactLog ?? []).map((l) => ({
      at: l.contactedAt,
      row: [
        number(l.caseId), nyTime(l.contactedAt), labelIn(CONTACT_DIRECTIONS, l.direction),
        l.withWhom === "other" && l.otherName ? `Other: ${l.otherName}` : labelIn(CONTACT_WITH, l.withWhom),
        labelIn(CONTACT_METHODS, l.method), labelIn(CONTACT_PURPOSES, l.purpose), outcomeLabel(l.outcome),
        l.note, l.loggedByName,
      ].map(cell),
    })),
    ...(answer.contactAttempts ?? []).map((t) => ({
      at: t.createdAt,
      row: [number(t.caseId), nyTime(t.createdAt), "", "", "", "", outcomeLabel(t.outcome), t.note, t.actorName].map(cell),
    })),
  ]);

  const help = sorted((answer.helpRequests ?? []).map((h) => ({
    at: h.createdAt,
    row: [number(h.caseId), h.title, h.status, h.assigneeName, h.language, h.contactPreference,
      h.resolutionNote, nyTime(h.createdAt)].map(cell),
  })));

  return [
    file("cases.csv",
      ["Client Number", "Reference", "Origin", "Stage", "Closing Reason", "Submitted At", "Preparer", "Reviewer"], caseRows),
    file("intake-answers.csv", ["Client Number", "Reference", "Question Id", "Question", "Answer"], answerRows),
    file("household-members.csv",
      ["Client Number", "Reference", "Member", ...MEMBER_FIELDS.map((f) => wording(f, { lang: "en" }))], householdRowsOut),
    file("status-history.csv", ["Client Number", "Time", "Action", "By", "Detail"], history),
    file("messages.csv", ["Client Number", "Time", "Kind", "From", "Title", "Message", "Status"], messages),
    file("follow-ups.csv",
      ["Client Number", "Reason", "Assignee", "Status", "Outcome", "Note", "Opened", "Resolved"], followups),
    file("call-log.csv",
      ["Client Number", "Contacted At", "Direction", "With Whom", "Method", "Purpose", "Outcome", "Note", "Logged By"], calls),
    file("help-requests.csv",
      ["Client Number", "Title", "Status", "Assignee", "Language", "Contact Preference", "Note", "Created"], help),
  ];
}

export function seasonExportReadme(answer, csvs) {
  const lines = [
    "ViTally season export",
    "",
    `Season: ${answer.season}`,
    `Exported by: ${cell(answer.exportedByName)}`,
    `Exported at: ${nyTime(answer.exportedAt)} (New York time)`,
    "",
    "Files:",
    ...csvs.map((f) => `${f.name}: ${f.rows} rows`),
    "",
    FREE_TEXT_WARNING,
    "",
    "Status, action, outcome, origin, language and similar columns use ViTally's internal codes where no staff label exists.",
    "",
    "This file is PCDC's archive. It is not re-imported into ViTally.",
  ];
  return `${lines.join("\r\n")}\r\n`;
}

export function seasonExportZip(answer, now) {
  const csvs = seasonExportCsvs(answer);
  const files = [{ name: "README.txt", text: seasonExportReadme(answer, csvs) }, ...csvs.map(({ name, text }) => ({ name, text }))];
  return { filename: seasonExportFilename(answer.season, now), bytes: zipStored(files, now) };
}
