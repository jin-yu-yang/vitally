import test from "node:test";
import assert from "node:assert/strict";
import {
  ROLE_CAPABILITIES,
  effectiveCapabilities,
  STALLED_DAYS,
  lastActivity,
  isStalled,
  taxpayerName,
  workloadRows,
  unassignedCases,
  sortRows,
  searchRows,
  languageGroup,
  candidates,
} from "../src/volunteer-workload.mjs";
import { clientLanguages } from "../src/intake-catalogue.mjs";

// Midday in New York; every timestamp below sits well inside its day, so the
// calendar-day count is the same in any timezone a test machine uses.
const NOW = Date.parse("2026-11-13T15:00:00-05:00");
const daysAgo = (days) => new Date(NOW - days * 86_400_000).toISOString();

const volunteer = (id, name, roles, extra = {}) => ({
  id,
  name,
  roles,
  languages: ["english"],
  otherLanguage: null,
  cleared: true,
  ...extra,
});
const ALL_CAPS = ["prepare", "review", "admin", "followup", "assist", "receive_documents"];
const person = (id, name, capabilities = ALL_CAPS) => ({ id, name, capabilities });

let caseSeq = 0;
const kase = (extra = {}) => {
  caseSeq += 1;
  return {
    id: `case-${caseSeq}`,
    reference: `VT-TEST-${String(caseSeq).padStart(4, "0")}`,
    revision: 1,
    stage: "preparing",
    preparerId: null,
    reviewerId: null,
    participants: [],
    openRequests: 0,
    updatedAt: daysAgo(1),
    lastContactAt: null,
    answers: {},
    ...extra,
  };
};

const rowOf = (rows, id) => rows.find((row) => row.id === id);

// ---- Capabilities -------------------------------------------------------

test("ROLE_CAPABILITIES matches the clearance spec and is frozen", () => {
  assert.deepEqual(ROLE_CAPABILITIES, {
    greeter: [],
    intaker: ["receive_documents", "assist"],
    preparer: ["prepare"],
    reviewer: ["prepare", "review"],
    admin: ["admin", "followup", "assist", "receive_documents"],
  });
  assert.ok(Object.isFrozen(ROLE_CAPABILITIES));
  assert.equal(STALLED_DAYS, 5);
});

test("effective capabilities are the roles' union within the ceiling", () => {
  const caps = effectiveCapabilities(
    volunteer("v1", "Tess Rowan", ["reviewer", "admin"]),
    person("v1", "Tess Rowan", ["review", "admin"]),
  );
  assert.deepEqual([...caps].sort(), ["admin", "review"]);
  assert.deepEqual(effectiveCapabilities(volunteer("v2", "No Roles", []), person("v2", "No Roles")), []);
  assert.deepEqual(effectiveCapabilities(volunteer("v3", "No Person", ["preparer"]), undefined), []);
});

// ---- Who has a row ------------------------------------------------------

test("Who has a row", () => {
  const volunteers = [
    volunteer("p", "Pia Marsh", ["preparer"]),
    volunteer("r", "Rory Vance", ["reviewer"]),
    volunteer("a", "Ada Quill", ["admin"]),
    volunteer("n", "Nell Pryor", ["preparer"], { cleared: false }),
  ];
  const people = volunteers.map((v) => person(v.id, v.name));
  const rows = workloadRows({ volunteers, people, cases: [], now: NOW });
  assert.deepEqual(rows.map((row) => row.id).sort(), ["n", "p", "r"]);
  assert.equal(rowOf(rows, "n").cleared, false);
  assert.equal(rowOf(rows, "p").cleared, true);
});

test("An admin who also reviews", () => {
  const volunteers = [volunteer("a", "Ada Quill", ["admin", "reviewer"])];
  const rows = workloadRows({ volunteers, people: [person("a", "Ada Quill")], cases: [], now: NOW });
  assert.equal(rows.length, 1);
});

test("A ceiling wider than the roles", () => {
  const volunteers = [volunteer("g", "Gil Hart", ["greeter"])];
  const rows = workloadRows({
    volunteers,
    people: [person("g", "Gil Hart", ["prepare"])],
    cases: [],
    now: NOW,
  });
  assert.deepEqual(rows, []);
});

// ---- Counts -------------------------------------------------------------

test("Counting a volunteer's cases", () => {
  const volunteers = [volunteer("v", "Vera Lind", ["reviewer"])];
  const cases = [
    kase({ stage: "preparing", preparerId: "v" }),
    kase({ stage: "preparing", preparerId: "v", openRequests: 1 }),
    kase({ stage: "corrections_required", preparerId: "v" }),
    kase({ stage: "reviewing", preparerId: "other", reviewerId: "v" }),
  ];
  const [row] = workloadRows({ volunteers, people: [person("v", "Vera Lind")], cases, now: NOW });
  assert.equal(row.preparing, 3);
  assert.equal(row.review, 1);
  assert.equal(row.open, 4);
  assert.equal(row.waiting, 1);
  assert.equal(row.stalled, 0);
  assert.equal(row.cases.length, 4);
  assert.deepEqual(
    row.cases.map((entry) => entry.slot),
    ["preparer", "preparer", "preparer", "reviewer"],
  );
});

test("Approved cases leave the count", () => {
  const volunteers = [volunteer("v", "Vera Lind", ["preparer"])];
  const cases = [
    kase({ stage: "review_approved", preparerId: "v", updatedAt: daysAgo(10) }),
    kase({ stage: "review_ready", preparerId: "v", openRequests: 2 }),
  ];
  const [row] = workloadRows({ volunteers, people: [person("v", "Vera Lind")], cases, now: NOW });
  assert.deepEqual(
    [row.preparing, row.review, row.open, row.waiting, row.stalled, row.cases.length],
    [0, 0, 0, 0, 0, 0],
  );
});

test("Waiting on client counts only Preparing cases", () => {
  const volunteers = [volunteer("v", "Vera Lind", ["reviewer"])];
  const cases = [kase({ stage: "reviewing", preparerId: "x", reviewerId: "v", openRequests: 1 })];
  const [row] = workloadRows({ volunteers, people: [person("v", "Vera Lind")], cases, now: NOW });
  assert.equal(row.waiting, 0);
  assert.equal(row.review, 1);
});

// ---- Stalled ------------------------------------------------------------

test("lastActivity is the later of the last action and the newest contact", () => {
  assert.equal(lastActivity({ updatedAt: daysAgo(6), lastContactAt: daysAgo(2) }), daysAgo(2));
  assert.equal(lastActivity({ updatedAt: daysAgo(1), lastContactAt: daysAgo(2) }), daysAgo(1));
  assert.equal(lastActivity({ updatedAt: daysAgo(3), lastContactAt: null }), daysAgo(3));
  assert.equal(lastActivity({ updatedAt: null, lastContactAt: null }), null);
});

test("A stalled case", () => {
  const record = kase({ preparerId: "v", updatedAt: daysAgo(6), lastContactAt: null });
  assert.equal(isStalled(record, NOW), true);
  const [row] = workloadRows({
    volunteers: [volunteer("v", "Vera Lind", ["preparer"])],
    people: [person("v", "Vera Lind")],
    cases: [record],
    now: NOW,
  });
  assert.equal(row.stalled, 1);
  assert.equal(row.cases[0].stalled, true);
});

test("Five calendar days is stalled; four is not", () => {
  assert.equal(isStalled(kase({ updatedAt: daysAgo(5) }), NOW), true);
  assert.equal(isStalled(kase({ updatedAt: daysAgo(4) }), NOW), false);
});

test("A logged contact keeps a case moving", () => {
  const record = kase({ preparerId: "v", updatedAt: daysAgo(6), lastContactAt: daysAgo(2) });
  assert.equal(isStalled(record, NOW), false);
});

test("An edited contact does not", () => {
  // The contact was logged 6 days ago and edited today: lastContactAt is the
  // logged time, so the edit is not activity.
  const record = kase({ preparerId: "v", updatedAt: daysAgo(6), lastContactAt: daysAgo(6) });
  assert.equal(isStalled(record, NOW), true);
});

test("A case with no activity time is not stalled", () => {
  assert.equal(isStalled(kase({ updatedAt: null, lastContactAt: null }), NOW), false);
});

// ---- Names --------------------------------------------------------------

test("taxpayerName joins first and last, or shows a dash", () => {
  assert.equal(taxpayerName({ tp_first_name: " Lena ", tp_last_name: "Ortiz" }), "Lena Ortiz");
  assert.equal(taxpayerName({ tp_first_name: "Lena" }), "Lena");
  assert.equal(taxpayerName({ tp_last_name: "Ortiz" }), "Ortiz");
  assert.equal(taxpayerName({}), "—");
  assert.equal(taxpayerName({ tp_first_name: "  ", tp_last_name: "" }), "—");
  assert.equal(taxpayerName(undefined), "—");
});

// ---- Sorting and search -------------------------------------------------

const sampleRows = () => [
  { id: "1", name: "Zane Park", open: 4, preparing: 4, review: 0, waiting: 1, stalled: 0 },
  { id: "2", name: "Bea Moss", open: 1, preparing: 0, review: 1, waiting: 0, stalled: 1 },
  { id: "3", name: "amy Parr", open: 4, preparing: 2, review: 2, waiting: 0, stalled: 2 },
];

test("The default order", () => {
  assert.deepEqual(sortRows(sampleRows()).map((row) => row.name), ["amy Parr", "Zane Park", "Bea Moss"]);
});

test("Sorting by a column, and reversing it", () => {
  assert.deepEqual(sortRows(sampleRows(), { key: "open", dir: "asc" }).map((row) => row.id), ["2", "3", "1"]);
  assert.deepEqual(sortRows(sampleRows(), { key: "name", dir: "asc" }).map((row) => row.id), ["3", "2", "1"]);
  assert.deepEqual(sortRows(sampleRows(), { key: "name", dir: "desc" }).map((row) => row.id), ["1", "2", "3"]);
  assert.deepEqual(sortRows(sampleRows(), { key: "stalled", dir: "desc" }).map((row) => row.id), ["3", "2", "1"]);
  const input = sampleRows();
  sortRows(input, { key: "review" });
  assert.deepEqual(input.map((row) => row.id), ["1", "2", "3"], "the input is not sorted in place");
});

test("Searching", () => {
  assert.deepEqual(searchRows(sampleRows(), "par").map((row) => row.id), ["1", "3"]);
  assert.deepEqual(searchRows(sampleRows(), " PAR ").map((row) => row.id), ["1", "3"]);
  assert.equal(searchRows(sampleRows(), "").length, 3);
  assert.equal(searchRows(sampleRows(), undefined).length, 3);
});

// ---- Unassigned ---------------------------------------------------------

test("Cases waiting", () => {
  const waitingPreparer = kase({ stage: "preparation_ready" });
  const waitingReviewer = kase({ stage: "review_ready", preparerId: "p" });
  const cases = [
    waitingPreparer,
    waitingReviewer,
    kase({ stage: "preparing", preparerId: "p" }),
    kase({ stage: "preparation_ready", preparerId: "p" }),
    kase({ stage: "review_ready", preparerId: "p", reviewerId: "r" }),
    kase({ stage: "received" }),
  ];
  const result = unassignedCases(cases);
  assert.deepEqual(result.preparer, [waitingPreparer]);
  assert.deepEqual(result.reviewer, [waitingReviewer]);
});

// ---- Language groups ----------------------------------------------------

test("languageGroup: preferred, another, none; no languages is group 2", () => {
  const entries = clientLanguages({ language: "cantonese", language_also: ["mandarin"] });
  assert.equal(languageGroup({ languages: ["cantonese"], otherLanguage: null }, entries), 0);
  assert.equal(languageGroup({ languages: ["english", "mandarin"], otherLanguage: null }, entries), 1);
  assert.equal(languageGroup({ languages: ["english"], otherLanguage: null }, entries), 2);
  assert.equal(languageGroup({ languages: [], otherLanguage: null }, entries), 2);
  assert.equal(languageGroup({ languages: ["cantonese"], otherLanguage: null }, []), 2);
  assert.equal(languageGroup({ languages: ["english"], otherLanguage: null }, clientLanguages({ language: "english" })), 0);
});

// ---- Drawer -------------------------------------------------------------

const drawer = ({ record, slot, volunteers, people, rows = [] }) =>
  candidates({ record, slot, volunteers, people: people ?? volunteers.map((v) => person(v.id, v.name)), rows });

test("A former preparer is not offered as reviewer", () => {
  const volunteers = [
    volunteer("alex", "Alex Chen", ["reviewer"]),
    volunteer("jo", "Jordan Park", ["reviewer"]),
    volunteer("mo", "Morgan Lee", ["reviewer"]),
  ];
  const record = kase({
    stage: "reviewing",
    preparerId: "jo",
    reviewerId: "mo",
    participants: ["alex", "jo"],
  });
  const result = drawer({ record, slot: "reviewer", volunteers });
  assert.deepEqual(result.list.map((entry) => entry.id), ["mo"]);
  assert.equal(result.hiddenForIndependence, 2);

  const onlyAlex = drawer({
    record: kase({ stage: "reviewing", preparerId: "jo", reviewerId: "mo", participants: ["alex"] }),
    slot: "reviewer",
    volunteers: volunteers.filter((v) => v.id !== "jo"),
  });
  assert.ok(!onlyAlex.list.some((entry) => entry.id === "alex"));
  assert.equal(onlyAlex.hiddenForIndependence, 1);
});

test("The current reviewer is not offered as preparer, and counts as hidden", () => {
  const volunteers = [volunteer("p", "Pia Marsh", ["preparer"]), volunteer("r", "Rory Vance", ["reviewer"])];
  const record = kase({ stage: "reviewing", preparerId: "p", reviewerId: "r", participants: ["p"] });
  const result = drawer({ record, slot: "preparer", volunteers });
  assert.deepEqual(result.list.map((entry) => entry.id), ["p"]);
  assert.equal(result.hiddenForIndependence, 1);
});

test("Uncleared people are not offered", () => {
  const volunteers = [
    volunteer("n", "Nell Pryor", ["preparer"], { cleared: false }),
    volunteer("p", "Pia Marsh", ["preparer"]),
  ];
  const result = drawer({ record: kase({ stage: "preparation_ready" }), slot: "preparer", volunteers });
  assert.deepEqual(result.list.map((entry) => entry.id), ["p"]);
  assert.equal(result.hiddenForIndependence, 0);
});

test("The current holder", () => {
  const volunteers = [volunteer("p", "Pia Marsh", ["preparer"]), volunteer("q", "Quin Abel", ["preparer"])];
  const record = kase({ stage: "preparing", preparerId: "p", participants: ["p"] });
  const result = drawer({ record, slot: "preparer", volunteers });
  assert.deepEqual(
    result.list.map((entry) => [entry.id, entry.current]),
    [["p", true], ["q", false]],
  );
  assert.equal(result.hiddenForIndependence, 0);
});

test("Each candidate carries name, languages, roles and Open from the rows", () => {
  const volunteers = [volunteer("p", "Pia Marsh", ["preparer"], { languages: ["other"], otherLanguage: "Tagalog" })];
  const rows = [{ id: "p", open: 3 }];
  const [entry] = drawer({ record: kase({ stage: "preparation_ready" }), slot: "preparer", volunteers, rows }).list;
  assert.deepEqual(entry, {
    id: "p",
    name: "Pia Marsh",
    languages: ["other"],
    otherLanguage: "Tagalog",
    roles: ["preparer"],
    open: 3,
    current: false,
  });
});

test("Preferred, then another, then none", () => {
  const volunteers = [
    volunteer("m", "Mina Sol", ["preparer"], { languages: ["mandarin"] }),
    volunteer("c", "Cal Wren", ["preparer"], { languages: ["cantonese"] }),
    volunteer("e", "Eli Dorn", ["preparer"], { languages: ["english"] }),
  ];
  const rows = [
    { id: "m", open: 1 },
    { id: "c", open: 3 },
    { id: "e", open: 0 },
  ];
  const record = kase({ stage: "preparation_ready", answers: { language: "cantonese", language_also: ["mandarin"] } });
  const result = drawer({ record, slot: "preparer", volunteers, rows });
  assert.deepEqual(result.list.map((entry) => entry.id), ["c", "m", "e"]);
});

test("Fewest open cases within a group", () => {
  const volunteers = [
    volunteer("a", "Ari Lund", ["preparer"], { languages: ["cantonese"] }),
    volunteer("b", "Bo Kerr", ["preparer"], { languages: ["cantonese"] }),
    volunteer("c", "Cy Dale", ["preparer"], { languages: ["cantonese"] }),
  ];
  const rows = [
    { id: "a", open: 2 },
    { id: "b", open: 0 },
    { id: "c", open: 0 },
  ];
  const record = kase({ stage: "preparation_ready", answers: { language: "cantonese" } });
  assert.deepEqual(drawer({ record, slot: "preparer", volunteers, rows }).list.map((entry) => entry.id), ["b", "c", "a"]);
});

test("Other languages", () => {
  const entries = clientLanguages({ language: "other", language_other: "Vietnamese" });
  const viet = { languages: ["other"], otherLanguage: "vietnamese " };
  const tagalog = { languages: ["other"], otherLanguage: "Tagalog" };
  assert.ok(languageGroup(viet, entries) < 2);
  assert.equal(languageGroup(tagalog, entries), 2);
  // An empty other language never matches an empty other language.
  assert.equal(languageGroup({ languages: ["other"], otherLanguage: "" }, [{ code: "other", text: "", label: "Other" }]), 2);
  assert.equal(languageGroup({ languages: ["other"], otherLanguage: null }, [{ code: "other", text: "", label: "Other" }]), 2);
});

test("The picker follows effective capabilities", () => {
  const volunteers = [
    volunteer("w", "Wes Iley", ["preparer"]),
    volunteer("r", "Rory Vance", ["reviewer"]),
  ];
  const people = [person("w", "Wes Iley", ["prepare", "review"]), person("r", "Rory Vance", ["prepare", "review"])];
  const record = kase({ stage: "review_ready", preparerId: "x", participants: ["x"] });
  const result = candidates({ record, slot: "reviewer", volunteers, people, rows: [] });
  assert.deepEqual(result.list.map((entry) => entry.id), ["r"]);
  assert.equal(result.hiddenForIndependence, 0);
});

test("candidates never throws on empty answers or missing rows", () => {
  const volunteers = [volunteer("p", "Pia Marsh", ["preparer"], { languages: [] })];
  const result = candidates({
    record: kase({ stage: "preparation_ready", answers: {} }),
    slot: "preparer",
    volunteers,
    people: [person("p", "Pia Marsh")],
    rows: [],
  });
  assert.deepEqual(result.list.map((entry) => [entry.id, entry.open]), [["p", 0]]);
  assert.doesNotThrow(() =>
    candidates({ record: kase({ answers: undefined }), slot: "reviewer", volunteers, people: [], rows: undefined }),
  );
});
