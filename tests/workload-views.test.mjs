import test from "node:test";
import assert from "node:assert/strict";
import {
  volunteerTabs,
  renderWorkload,
  assignDrawerBody,
  assignDrawerTitle,
  WORKLOAD_FOOTNOTE,
} from "../src/workload-views.mjs";
import { workloadRows, unassignedCases, candidates } from "../src/volunteer-workload.mjs";

// Fictional people and clients only. Midday in New York.
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
const person = (id, name) => ({ id, name, capabilities: ALL_CAPS });

const kase = (id, reference, extra = {}) => ({
  id,
  reference,
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
});

const VOLUNTEERS = [
  volunteer("v-jordan", "Jordan Park", ["preparer"]),
  volunteer("v-alex", "Alex Chen", ["reviewer"]),
  volunteer("v-casey", "Casey Novak", ["preparer"], { cleared: false }),
];
const PEOPLE = VOLUNTEERS.map((v) => person(v.id, v.name));
const CASES = [
  kase("c-1", "VT-ABCD-EFGH", {
    preparerId: "v-jordan",
    participants: ["v-jordan"],
    answers: { tp_first_name: "Lena", tp_last_name: "Ortiz" },
  }),
  kase("c-2", "VT-BBBB-2222", { preparerId: "v-jordan", openRequests: 1, updatedAt: daysAgo(6) }),
  kase("c-3", "VT-CCCC-3333", { preparerId: "v-jordan", stage: "corrections_required" }),
  kase("c-4", "VT-DDDD-4444", { reviewerId: "v-jordan", stage: "reviewing" }),
  kase("c-5", "VT-EEEE-5555", { stage: "preparation_ready", answers: { tp_first_name: "Omar" } }),
  kase("c-6", "VT-FFFF-6666", { stage: "review_ready", preparerId: "v-alex", participants: ["v-alex"] }),
];

const args = (overrides = {}) => ({
  rows: workloadRows({ volunteers: VOLUNTEERS, people: PEOPLE, cases: CASES, now: NOW }),
  unassigned: unassignedCases(CASES),
  sort: { key: "open", dir: "desc" },
  search: "",
  expanded: [],
  now: NOW,
  ...overrides,
});

const rowIds = (html) => [...html.matchAll(/<tr class="workload-row[^"]*" data-row-id="([^"]+)"/g)].map((m) => m[1]);
const casesOf = (html, id) =>
  [...html.matchAll(/<tr class="workload-cases-row" id="workload-cases-([^"]+)">([\s\S]*?)<\/tr>/g)].find((m) => m[1] === id)?.[2];

// ---- Tabs ---------------------------------------------------------------

test("the Workload tab is offered only when workload is true", () => {
  const without = volunteerTabs("roster", { workload: false });
  assert.match(without, /data-action="volunteer-tab" data-tab="roster"/);
  assert.doesNotMatch(without, /data-tab="workload"/);
  const both = volunteerTabs("workload", { workload: true });
  assert.match(both, /data-action="volunteer-tab" data-tab="roster"/);
  assert.match(both, /data-action="volunteer-tab" data-tab="workload"[^>]*aria-current="page"/);
  assert.doesNotMatch(both, /data-tab="roster"[^>]*aria-current/);
  assert.ok(both.indexOf('data-tab="roster"') < both.indexOf('data-tab="workload"'), "Roster comes first");
});

// ---- Table --------------------------------------------------------------

test("the Unassigned row is first, whatever the sort or search", () => {
  const byName = renderWorkload(args({ sort: { key: "name", dir: "asc" } }));
  assert.deepEqual(rowIds(byName), ["unassigned", "v-alex", "v-casey", "v-jordan"]);
  const byOpen = renderWorkload(args());
  assert.deepEqual(rowIds(byOpen), ["unassigned", "v-jordan", "v-alex", "v-casey"]);
  const nobody = renderWorkload(args({ search: "zzz" }));
  assert.deepEqual(rowIds(nobody), ["unassigned"]);
  const par = renderWorkload(args({ search: "PAR" }));
  assert.deepEqual(rowIds(par), ["unassigned", "v-jordan"]);
});

test("the headers are sort buttons inside th aria-sort, with no hours column", () => {
  const html = renderWorkload(args({ sort: { key: "name", dir: "asc" } }));
  for (const key of ["name", "open", "preparing", "review", "waiting", "stalled"])
    assert.match(html, new RegExp(`<th scope="col" aria-sort="[a-z]+"><button type="button"[^>]*data-action="sort-workload" data-key="${key}"`), key);
  assert.match(html, /aria-sort="ascending"><button type="button"[^>]*data-key="name"/);
  assert.match(html, /aria-sort="none"><button type="button"[^>]*data-key="open"/);
  const desc = renderWorkload(args());
  assert.match(desc, /aria-sort="descending"><button type="button"[^>]*data-key="open"/);
  assert.doesNotMatch(html, /hours/i);
  assert.match(html, /<input id="workload-search"[^>]*type="search"/);
  assert.match(html, /class="board-table people-table workload-table"/);
});

test("each row toggles, shows its counts, and tags Not cleared", () => {
  const html = renderWorkload(args());
  assert.match(html, /data-action="toggle-workload-row" data-row-id="v-jordan" aria-expanded="false" aria-controls="workload-cases-v-jordan"/);
  const jordan = /<tr class="workload-row" data-row-id="v-jordan">([\s\S]*?)<\/tr>/.exec(html)[1];
  const cells = [...jordan.matchAll(/<td[^>]*data-col="([a-z]+)"[^>]*>([\s\S]*?)<\/td>/g)].map((m) => [m[1], m[2].replace(/<[^>]+>/g, "")]);
  assert.deepEqual(
    Object.fromEntries(cells.filter(([k]) => k !== "bar")),
    { open: "4", preparing: "3", review: "1", waiting: "1", stalled: "1" },
  );
  // The breakdown bar carries both numbers for screen readers.
  assert.match(jordan, /class="workload-bar" role="img" aria-label="3 preparing, 1 in review"/);
  const casey = /<tr class="workload-row" data-row-id="v-casey">([\s\S]*?)<\/tr>/.exec(html)[1];
  assert.match(casey, /Not cleared/);
  assert.doesNotMatch(jordan, /Not cleared/);
});

test("an expanded row lists the volunteer's cases with names, stage, slot, Open and Reassign", () => {
  const html = renderWorkload(args({ expanded: ["v-jordan"] }));
  assert.match(html, /data-row-id="v-jordan" aria-expanded="true"/);
  const list = casesOf(html, "v-jordan");
  assert.ok(list, "the case list is rendered");
  assert.match(list, /VT-ABCD-EFGH/);
  assert.match(list, /Lena Ortiz/);
  assert.match(list, /Filing in progress \(preparing\)/);
  assert.match(list, /Preparer/);
  assert.match(list, /Reviewer/);
  assert.match(list, /data-action="open-case" data-case-id="c-1"/);
  assert.match(list, /data-action="open-assign" data-case-id="c-1" data-slot="preparer"[^>]*>Reassign</);
  assert.match(list, /data-action="open-assign" data-case-id="c-4" data-slot="reviewer"[^>]*>Reassign</);
  // A case with no name reads "—"; the stalled one says so.
  assert.match(list, /VT-BBBB-2222[\s\S]*?—[\s\S]*?Stalled/);
  // Collapsed rows list nothing.
  assert.equal(casesOf(html, "v-alex"), undefined);
});

test("the Unassigned row counts and lists cases waiting for a preparer or a reviewer", () => {
  const html = renderWorkload(args({ expanded: ["unassigned"] }));
  const row = /<tr class="workload-row workload-unassigned" data-row-id="unassigned">([\s\S]*?)<\/tr>/.exec(html)[1];
  assert.match(row, /Unassigned/);
  assert.match(row, /1 waiting for a preparer, 1 for a reviewer/);
  const list = casesOf(html, "unassigned");
  assert.match(list, /VT-EEEE-5555[\s\S]*Omar[\s\S]*Pending intake \/ filing[\s\S]*data-action="open-assign" data-case-id="c-5" data-slot="preparer"[^>]*>Assign</);
  assert.match(list, /VT-FFFF-6666[\s\S]*Pending review[\s\S]*data-action="open-assign" data-case-id="c-6" data-slot="reviewer"[^>]*>Assign</);
  assert.match(list, /data-action="open-case" data-case-id="c-5"/);
});

test("the Workload says why taxpayer names show, and states loading and failure", () => {
  const html = renderWorkload(args());
  assert.equal(WORKLOAD_FOOTNOTE, "Taxpayer names show here because only admins can open the Workload.");
  assert.match(html, /Taxpayer names show here because only admins can open the Workload\./);
  assert.match(renderWorkload(args({ list: "loading" })), /Loading the workload…/);
  assert.match(renderWorkload(args({ list: "failed" })), /The workload couldn&#39;t load\./);
});

test("names and references are escaped", () => {
  const html = renderWorkload(
    args({
      rows: workloadRows({
        volunteers: [volunteer("v-x", "<b>X</b>", ["preparer"])],
        people: [person("v-x", "<b>X</b>")],
        cases: [kase("c-x", "VT-XXXX-XXXX", { preparerId: "v-x", answers: { tp_first_name: "<i>Y</i>" } })],
        now: NOW,
      }),
      expanded: ["v-x"],
    }),
  );
  assert.doesNotMatch(html, /<b>X<\/b>|<i>Y<\/i>/);
  assert.match(html, /&lt;b&gt;X&lt;\/b&gt;/);
});

// ---- The Assign/Reassign drawer ------------------------------------------

const DRAWER_VOLUNTEERS = [
  volunteer("v-jordan", "Jordan Park", ["reviewer"], { languages: ["english", "other"], otherLanguage: "Tagalog" }),
  volunteer("v-alex", "Alex Chen", ["reviewer"]),
  volunteer("v-riley", "Riley Quinn", ["reviewer"]),
  volunteer("v-morgan", "Morgan Lee", ["reviewer"]),
];
const DRAWER_PEOPLE = DRAWER_VOLUNTEERS.map((v) => person(v.id, v.name));
const reviewing = kase("c-r", "VT-ABCD-EFGH", {
  stage: "reviewing",
  preparerId: "v-jordan",
  reviewerId: "v-morgan",
  participants: ["v-jordan", "v-alex"],
  answers: { tp_first_name: "Lena", tp_last_name: "Ortiz" },
});
const drawer = (record, slot, search = "", ui = {}) =>
  assignDrawerBody({
    record,
    slot,
    result: candidates({ record, slot, volunteers: DRAWER_VOLUNTEERS, people: DRAWER_PEOPLE, rows: [] }),
    search,
    ui,
  });

test("the drawer's heading names the case and the client; the body names the slot", () => {
  assert.equal(assignDrawerTitle(reviewing), "VT-ABCD-EFGH · Lena Ortiz");
  assert.match(drawer(reviewing, "reviewer"), /Reassign the reviewer/);
  assert.match(drawer(reviewing, "preparer"), /Reassign the preparer/);
  const empty = kase("c-e", "VT-EEEE-5555", { stage: "preparation_ready" });
  assert.match(drawer(empty, "preparer"), /Assign a preparer/);
});

test("the current holder is marked Current with no Choose; the others have Choose", () => {
  const html = drawer(reviewing, "reviewer");
  const items = html.split('<li class="assign-person').slice(1);
  const morgan = items.find((item) => item.includes("Morgan Lee"));
  assert.match(morgan, /Current/);
  assert.doesNotMatch(morgan, /data-action="assign-case"/);
  const riley = items.find((item) => item.includes("Riley Quinn"));
  assert.match(riley, /data-action="assign-case" data-person-id="v-riley"/);
  assert.doesNotMatch(riley, /Current/);
  // Each person shows their languages, roles and Open count.
  assert.match(riley, /English/);
  assert.match(riley, /Reviewer/);
  assert.match(riley, /0 open/);
  const jordan = drawer(reviewing, "preparer").split('<li class="assign-person').find((item) => item.includes("Jordan Park"));
  assert.match(jordan, /English, Tagalog/);
});

test("the drawer says how many people who prepared the case aren't shown", () => {
  // Alex prepared it earlier; Jordan is its preparer. Both are left out.
  const two = drawer(reviewing, "reviewer");
  assert.match(two, /2 people who prepared this case aren&#39;t shown\./);
  assert.doesNotMatch(two, /Alex Chen/);
  const one = drawer({ ...reviewing, participants: ["v-alex"] }, "reviewer");
  assert.match(one, /1 person who prepared this case isn&#39;t shown\./);
  const none = drawer({ ...reviewing, participants: [] }, "reviewer");
  assert.doesNotMatch(none, /isn&#39;t shown|aren&#39;t shown/);
  // For the preparer slot, the case's reviewer is left out.
  assert.match(drawer(reviewing, "preparer"), /1 person who is reviewing this case isn&#39;t shown\./);
});

test("the drawer's search filters the list by name, ignoring case", () => {
  const html = drawer(reviewing, "reviewer", "RIL");
  assert.match(html, /<input id="assign-search"[^>]*value="RIL"/);
  assert.match(html, /Riley Quinn/);
  assert.doesNotMatch(html, /Morgan Lee/);
  assert.match(drawer(reviewing, "reviewer", "zzz"), /Nobody matches\./);
});

test("a busy drawer disables Choose; a missing case offers Close", () => {
  assert.match(drawer(reviewing, "reviewer", "", { busy: true }), /data-action="assign-case" data-person-id="v-riley"[^>]*disabled/);
  const missing = assignDrawerBody({ record: null, slot: "preparer", result: { list: [], hiddenForIndependence: 0 }, search: "", ui: {} });
  assert.match(missing, /This case could not be opened\./);
  assert.match(missing, /data-action="close-dialog"/);
});
