import test from "node:test";
import assert from "node:assert/strict";
import {
  EXPORT_FILES,
  seasonExportFilename,
  seasonExportCsvs,
  seasonExportReadme,
  seasonExportZip,
} from "../src/season-export.mjs";
import { CATALOGUE, findQuestion, wording } from "../src/intake-catalogue.mjs";
import { readZip } from "./support/read-zip.mjs";

// Splits a CSV into rows of cells: BOM off, CR LF lines, quoted cells.
function parse(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const body = text.replace(/^﻿/, "");
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\r" && body[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i += 1;
    } else cell += ch;
  }
  return rows;
}

const member = (id, first, last, relationship) => ({
  member_id: id.repeat(32),
  first_name: first,
  last_name: last,
  dob: "2015-03-04",
  relationship,
});

const answer = () => ({
  season: 2026,
  exportedAt: "2026-11-27T20:05:00Z",
  exportedByName: "Casey Coordinator",
  cases: [
    {
      id: "c1", clientNumber: 1, reference: "VT-0001", origin: "client", stage: "preparing", closingReason: null,
      submittedAt: "2026-02-01T15:00:00Z", preparerName: "Pat Preparer", reviewerName: null, intakeVersion: 2,
      answers: {
        language: "english",
        language_other: "Hidden because language is not other",
        language_also: ["cantonese", "mandarin"],
        has_household_members: "yes",
        hh: [member("a", "Mina", "Lee", "son_daughter"), member("b", "Ravi", "Lee", "sibling")],
        no_such_question: "x",
      },
    },
    {
      id: "c2", clientNumber: 2, reference: "VT-0002", origin: "office", stage: "closed", closingReason: "duplicate",
      submittedAt: null, preparerName: null, reviewerName: null, intakeVersion: 2,
      answers: { tp_first_name: "小明", has_household_members: "no" },
    },
  ],
  events: [
    { caseId: "c1", createdAt: "2026-11-27T20:05:00Z", action: "SUBMIT", actorName: "Pat Preparer", detail: { a: 1, b: "x,y" } },
    { caseId: "c2", createdAt: "2026-02-02T15:00:00Z", action: "CLOSE", actorName: null, detail: null },
  ],
  clientEvents: [{ caseId: "c1", createdAt: "2026-03-01T15:00:00Z", message: "We asked for a W-2." }],
  documentRequests: [
    { caseId: "c1", createdAt: "2026-02-15T15:00:00Z", title: "W-2", message: "Please send\nyour W-2, page 1", status: "open", requestedByName: "Pat Preparer" },
    { caseId: "c1", createdAt: "2026-04-01T15:00:00Z", title: "ID", message: "Photo ID", status: "done", requestedByName: null },
  ],
  followups: [
    {
      caseId: "c1", reason: "Missing phone", assigneeName: null, status: "open", resolutionOutcome: null,
      resolutionNote: null, createdAt: "2026-03-05T15:00:00Z", resolvedAt: null,
    },
  ],
  contactLog: [
    {
      caseId: "c1", contactedAt: "2026-03-10T15:00:00Z", direction: "outgoing", withWhom: "client", otherName: null,
      method: "phone", purpose: "ask_question", outcome: "reached", note: "-5", loggedByName: "Pat Preparer",
    },
    {
      caseId: "c2", contactedAt: "2026-03-12T15:00:00Z", direction: "incoming", withWhom: "other", otherName: "Aunt Jo",
      method: "text", purpose: "other", outcome: "sent", note: null, loggedByName: null,
    },
  ],
  contactAttempts: [
    { caseId: "c1", createdAt: "2026-03-11T15:00:00Z", outcome: "no_answer", note: "=HYPERLINK(1)", actorName: "Pat Preparer" },
  ],
  helpRequests: [
    {
      caseId: null, title: "Needs a ride", status: "open", assigneeName: null, language: "mandarin",
      contactPreference: "phone", resolutionNote: null, createdAt: "2026-03-20T15:00:00Z",
    },
  ],
});

const empty = () => ({
  season: 2026, exportedAt: "2026-11-27T20:05:00Z", exportedByName: "Casey Coordinator",
  cases: [], events: [], clientEvents: [], documentRequests: [], followups: [], contactLog: [],
  contactAttempts: [], helpRequests: [],
});

const file = (csvs, name) => parse(csvs.find((f) => f.name === name).text);

test("the file name uses the New York date", () => {
  assert.equal(seasonExportFilename(2026, new Date("2026-11-27T15:00:00Z")), "vitally-2026-export-2026-11-27.zip");
  assert.equal(seasonExportFilename(2026, new Date("2026-11-28T03:00:00Z")), "vitally-2026-export-2026-11-27.zip");
});

test("eight files in order with their headers", () => {
  const csvs = seasonExportCsvs(answer());
  assert.deepEqual(csvs.map((f) => f.name), EXPORT_FILES);
  assert.deepEqual(EXPORT_FILES, [
    "cases.csv", "intake-answers.csv", "household-members.csv", "status-history.csv",
    "messages.csv", "follow-ups.csv", "call-log.csv", "help-requests.csv",
  ]);
  assert.deepEqual(file(csvs, "cases.csv")[0],
    ["Client Number", "Reference", "Origin", "Stage", "Closing Reason", "Submitted At", "Preparer", "Reviewer"]);
  assert.deepEqual(file(csvs, "intake-answers.csv")[0], ["Client Number", "Reference", "Question Id", "Question", "Answer"]);
  assert.deepEqual(file(csvs, "household-members.csv")[0].slice(0, 3), ["Client Number", "Reference", "Member"]);
  assert.deepEqual(file(csvs, "status-history.csv")[0], ["Client Number", "Time", "Action", "By", "Detail"]);
  assert.deepEqual(file(csvs, "messages.csv")[0], ["Client Number", "Time", "Kind", "From", "Title", "Message", "Status"]);
  assert.deepEqual(file(csvs, "follow-ups.csv")[0],
    ["Client Number", "Reason", "Assignee", "Status", "Outcome", "Note", "Opened", "Resolved"]);
  assert.deepEqual(file(csvs, "call-log.csv")[0],
    ["Client Number", "Contacted At", "Direction", "With Whom", "Method", "Purpose", "Outcome", "Note", "Logged By"]);
  assert.deepEqual(file(csvs, "help-requests.csv")[0],
    ["Client Number", "Title", "Status", "Assignee", "Language", "Contact Preference", "Note", "Created"]);
});

test("every file has the BOM and CR LF", () => {
  for (const f of seasonExportCsvs(answer())) {
    assert.ok(f.text.startsWith("﻿"), f.name);
    assert.ok(f.text.endsWith("\r\n"), f.name);
  }
});

test("cases: staff labels, empty cells and a Chinese answer", () => {
  const rows = file(seasonExportCsvs(answer()), "cases.csv");
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1].slice(0, 3), ["1", "VT-0001", "client"]);
  assert.equal(rows[1][5], "2026-02-01 10:00");
  assert.equal(rows[1][7], "");
  assert.equal(rows[2][4], "Duplicate");
  assert.equal(rows[2][5], "");
  assert.ok(!rows.flat().includes("null"));
});

test("times are New York", () => {
  const rows = file(seasonExportCsvs(answer()), "status-history.csv");
  assert.deepEqual(rows[1], ["2", "2026-02-02 10:00", "CLOSE", "", ""]);
  assert.deepEqual(rows[2], ["1", "2026-11-27 15:05", "SUBMIT", "Pat Preparer", '{"a":1,"b":"x,y"}']);
});

test("visible answers only, in English, multi-select joined", () => {
  const a = answer();
  const all = file(seasonExportCsvs(a), "intake-answers.csv");
  const rows = all.slice(1).filter((r) => r[0] === "1");
  const ids = rows.map((r) => r[2]);
  assert.ok(!ids.includes("language_other"), "hidden answer exported");
  const also = rows.find((r) => r[2] === "language_also");
  assert.equal(also[4], "Cantonese; Mandarin");
  assert.equal(also[3], wording(findQuestion(2, "language_also"), { lang: "en", answers: a.cases[0].answers }));
  assert.equal(rows.find((r) => r[2] === "language")[4], "English");
  const order = CATALOGUE.steps.flatMap((s) => s.sections.flatMap((x) => x.questions.map((q) => q.id)));
  const positions = ids.map((id) => order.indexOf(id));
  assert.ok(!positions.includes(-1));
  assert.deepEqual(positions, [...positions].sort((x, y) => x - y));
  assert.ok(all.some((r) => r[4] === "小明"));
});

test("unknown answer keys are skipped", () => {
  const a = empty();
  a.cases = [{ id: "c", clientNumber: 1, reference: "R", origin: "client", stage: "received", intakeVersion: 2, answers: { no_such_question: "x" } }];
  const rows = file(seasonExportCsvs(a), "intake-answers.csv");
  assert.equal(rows.length, 1);
});

test("household rows", () => {
  const rows = file(seasonExportCsvs(answer()), "household-members.csv");
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.slice(1).map((r) => [r[0], r[2]]), [["1", "1"], ["1", "2"]]);
  const header = rows[0];
  assert.ok(header.includes("First name") && header.includes("Relationship to you") && !header.includes("Person id"));
  assert.equal(rows[1][header.indexOf("First name")], "Mina");
  assert.equal(rows[1][header.indexOf("Relationship to you")], "Son / Daughter");
  assert.equal(rows[2][header.indexOf("Last name")], "Lee");
});

test("messages of both kinds", () => {
  const rows = file(seasonExportCsvs(answer()), "messages.csv");
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.slice(1).map((r) => r[1]), ["2026-02-15 10:00", "2026-03-01 10:00", "2026-04-01 11:00"]);
  assert.deepEqual(rows[1], ["1", "2026-02-15 10:00", "Document request", "Pat Preparer", "W-2", "Please send\nyour W-2, page 1", "open"]);
  assert.deepEqual(rows[2], ["1", "2026-03-01 10:00", "Client history", "PCDC", "", "We asked for a W-2.", ""]);
  assert.equal(rows[3][3], "");
});

test("call log merges both sources", () => {
  const rows = file(seasonExportCsvs(answer()), "call-log.csv");
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.slice(1).map((r) => r[1]), ["2026-03-10 11:00", "2026-03-11 11:00", "2026-03-12 11:00"]);
  assert.deepEqual(rows[1], ["1", "2026-03-10 11:00", "We contacted", "Client", "Phone", "Ask a question", "Reached", "'-5", "Pat Preparer"]);
  assert.equal(rows[2][7], "'=HYPERLINK(1)");
  assert.equal(rows[2][6], "No answer");
  assert.equal(rows[3][3], "Other: Aunt Jo");
  assert.equal(rows[3][8], "");
});

test("null people and notes give empty cells", () => {
  const rows = file(seasonExportCsvs(answer()), "follow-ups.csv");
  assert.deepEqual(rows[1], ["1", "Missing phone", "", "open", "", "", "2026-03-05 10:00", ""]);
});

test("help request with no case", () => {
  const rows = file(seasonExportCsvs(answer()), "help-requests.csv");
  assert.equal(rows.length, 2);
  assert.equal(rows[1][0], "");
  assert.equal(rows[1][1], "Needs a ride");
});

test("an empty season", () => {
  const csvs = seasonExportCsvs(empty());
  for (const f of csvs) {
    assert.equal(f.rows, 0, f.name);
    assert.equal(parse(f.text).length, 1, f.name);
  }
  const { bytes } = seasonExportZip(empty(), new Date("2026-11-27T20:05:00Z"));
  assert.equal(String.fromCharCode(bytes[0], bytes[1]), "PK");
});

test("rows counts the data rows", () => {
  const csvs = seasonExportCsvs(answer());
  assert.deepEqual(csvs.map((f) => f.rows), csvs.map((f) => parse(f.text).length - 1));
  assert.equal(csvs[0].rows, 2);
});

test("README", () => {
  const a = answer();
  const csvs = seasonExportCsvs(a);
  const text = seasonExportReadme(a, csvs);
  assert.ok(text.includes("2026"));
  assert.ok(text.includes("Casey Coordinator"));
  assert.ok(text.includes("2026-11-27 15:05"));
  for (const f of csvs) assert.ok(text.includes(`${f.name}: ${f.rows} rows`), f.name);
  assert.ok(text.includes("Messages, notes and call log entries are exported as staff and clients wrote them. Notes must not hold amounts or ID numbers."));
  assert.ok(text.includes("not re-imported"));
  assert.ok(text.includes("use ViTally's internal codes where no staff label exists."));
  assert.ok(text.endsWith("\r\n"));
  assert.ok(!/(^|[^\r])\n/.test(text), "a bare LF");
});

test("the ZIP holds the README first, then the eight CSVs", () => {
  const now = new Date("2026-11-27T20:05:00Z");
  const { filename, bytes } = seasonExportZip(answer(), now);
  assert.equal(filename, "vitally-2026-export-2026-11-27.zip");
  const files = readZip(bytes);
  assert.deepEqual(files.map((f) => f.name), ["README.txt", ...EXPORT_FILES]);
  const csvs = seasonExportCsvs(answer());
  assert.equal(new TextDecoder("utf-8", { ignoreBOM: true }).decode(files[1].data), csvs[0].text);
});

// A question that asks for one of these numbers must get masking first (design D7).
const SENSITIVE = /\b(ssn|itin|social security number|routing( number)?|account number|acct)\b/i;
const ALLOWED = new Set([
  // (ids that only name a document card are listed here, each with a comment)
]);

// An id counts with "_" read as a separator, since `\b` never fires inside snake_case.
const sensitive = (id, text) => SENSITIVE.test(String(id).replace(/_/g, " ")) || SENSITIVE.test(text ?? "");

test("the sensitive-field check flags snake_case ids", () => {
  for (const id of ["routing_number", "account_number", "tp_ssn", "itin_number"]) assert.ok(sensitive(id, ""), id);
  assert.ok(!sensitive("tp_first_name", "First name"));
});

test("no SSN, ITIN, routing or account-number question in the catalogue", () => {
  const questions = CATALOGUE.steps.flatMap((s) => s.sections.flatMap((x) => x.questions));
  const hits = [];
  for (const q of questions) {
    for (const p of [q, ...(q.fields ?? [])]) {
      const text = wording(p, { lang: "en" });
      if (sensitive(p.id, text) && !ALLOWED.has(p.id)) hits.push(`${p.id}: ${text}`);
    }
  }
  assert.deepEqual(hits, []);
});
