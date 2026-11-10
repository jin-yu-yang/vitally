import test from "node:test";
import assert from "node:assert/strict";
import { POOL_STAGES, POOL_TABS, poolPhase, poolFilters, filterPool, poolCounts, renderCasePool } from "../src/pool-views.mjs";
import { describeStage } from "../src/domain.mjs";
import { STAGES } from "../src/contracts.mjs";

test("every stage lands on exactly one pool phase", () => {
  const expected = {
    draft: "intake", received: "intake", screening: "intake",
    awaiting_documents: "signing", on_hold: "attention",
    preparation_ready: "available", preparing: "preparation", corrections_required: "preparation",
    review_ready: "review", reviewing: "review",
    review_approved: "signing", ready_to_efile: "filing", efiled: "filing",
    rejected: "attention", accepted: "done", closed: "closed",
  };
  assert.deepEqual([...POOL_STAGES].sort(), Object.keys(expected).sort());
  assert.deepEqual(POOL_STAGES, STAGES);
  for (const [stage, phase] of Object.entries(expected))
    assert.equal(poolPhase({ stage, preparerId: null }), phase, stage);
  assert.equal(poolPhase({ stage: "preparation_ready", preparerId: "p1" }), "preparation");
  assert.equal(poolPhase({ stage: "made_up" }), null);
  for (const stage of POOL_STAGES) assert.notEqual(describeStage(stage).label, "Application");
});

test("the pool's tabs, in order: Needs attention and Done before Closed", () => {
  assert.deepEqual(POOL_TABS, [
    ["all", "All cases"],
    ["intake", "Intake"],
    ["available", "Available"],
    ["preparation", "Waiting for preparation"],
    ["review", "Waiting for review"],
    ["signing", "Waiting on client"],
    ["filing", "Filing"],
    ["attention", "Needs attention"],
    ["done", "Done"],
    ["closed", "Closed"],
  ]);
  assert.equal(poolFilters({ poolPhase: "done" }).poolPhase, "done");
  assert.equal(poolFilters({ poolPhase: "filing" }).poolPhase, "filing");
  // Every stage is counted on a tab, so the tab counts add up to All.
  const mapped = [...POOL_STAGES];
  const cases = mapped.map((stage, i) => ({ id: String(i), stage, preparerId: null, answers: {} }));
  const counts = poolCounts(cases, poolFilters({}));
  const { all, ...tabs } = counts;
  assert.equal(all, mapped.length);
  assert.equal(Object.values(tabs).reduce((a, b) => a + b, 0), all);
  assert.deepEqual(tabs, { intake: 3, available: 1, preparation: 2, review: 2, signing: 2, filing: 2, attention: 2, done: 1, closed: 1 });
  assert.deepEqual(filterPool(cases, poolFilters({ poolPhase: "attention" })).map((c) => c.stage), ["on_hold", "rejected"]);
  assert.deepEqual(filterPool(cases, poolFilters({ poolPhase: "done" })).map((c) => c.stage), ["accepted"]);
  assert.deepEqual(filterPool(cases, poolFilters({ poolPhase: "filing" })).map((c) => c.stage), ["ready_to_efile", "efiled"]);
});

test("unknown saved values fall back to All, and volunteer keys are ignored", () => {
  const chosen = poolFilters({ poolPhase: "mine", poolStage: "made_up", status: "review" });
  assert.equal(chosen.poolPhase, "all");
  assert.equal(chosen.poolStage, "all");
  assert.equal("status" in chosen, false);
});

test("prepared by and reviewed by match a person, or nobody", () => {
  const cases = [
    { id: "1", stage: "preparing", preparerId: "p-alex", answers: {} },
    { id: "2", stage: "preparation_ready", preparerId: null, answers: {} },
  ];
  assert.deepEqual(filterPool(cases, poolFilters({ poolPreparer: "unassigned" })).map((c) => c.id), ["2"]);
  assert.deepEqual(filterPool(cases, poolFilters({ poolPreparer: "p-alex" })).map((c) => c.id), ["1"]);
});

test("tab counts respect the other filters but not the tab", () => {
  const cases = [
    { id: "1", stage: "received", answers: { language: "Mandarin" } },
    { id: "2", stage: "closed", answers: { language: "English" } },
    { id: "3", stage: "draft", answers: { language: "Mandarin" } },
  ];
  const counts = poolCounts(cases, poolFilters({ poolPhase: "closed", poolLanguage: "Mandarin" }));
  assert.equal(counts.all, 2);
  assert.equal(counts.intake, 2);
  assert.equal(counts.closed, 0);
});

// ---------------------------------------------------------------------------
// The renderer
// ---------------------------------------------------------------------------

const NOW = Date.parse("2026-03-10T12:00:00Z");
const PEOPLE = [
  { id: "p-alex", name: "Alex" },
  { id: "p-sam", name: "Sam" },
];
const rec = (id, stage, extra = {}) => ({
  id,
  reference: `VT-${id}`,
  stage,
  answers: { language: "English", service: "Federal return" },
  preparerId: null,
  reviewerId: null,
  preparerName: null,
  reviewerName: null,
  updatedAt: "2026-03-09T10:00:00Z",
  ...extra,
});
const CASES = [
  rec("A", "received", { updatedAt: "2026-03-01T10:00:00Z" }),
  rec("B", "preparing", { preparerId: "p-alex", preparerName: "Alex", updatedAt: "2026-03-09T10:00:00Z" }),
  rec("C", "review_ready", { reviewerId: "p-sam", reviewerName: "Sam", answers: { language: "Mandarin", service: "State return" }, updatedAt: "2026-03-05T10:00:00Z" }),
  rec("D", "closed"),
  rec("E", "preparation_ready"),
];
const render = (filters = {}, cases = CASES) =>
  renderCasePool(cases, PEOPLE, { filters, now: NOW });

test("a pool row names E-filed and Accepted by the filing method", () => {
  const html = render({}, [
    rec("M", "efiled", { federalMethod: "efile", stateMethod: "paper" }),
    rec("O", "efiled"),
  ]);
  assert.match(html, /<i><\/i>E-filed, PA on paper</);
  assert.match(html, /<i><\/i>E-filed</);
});

test("the pool's stage filter keeps the plain stage names", () => {
  assert.match(render(), /<option value="efiled">E-filed<\/option>/);
}
);

test("the pool shows ten phase tabs with counts and pressed state", () => {
  const html = render({ poolPhase: "review" });
  assert.match(html, /role="group" aria-label="Case phase"/);
  const tabs = html.match(/<button[^>]*data-filter="poolPhase"[^>]*>/g) ?? [];
  assert.equal(tabs.length, 10);
  for (const tab of tabs) assert.match(tab, /data-action="set-board-filter"/);
  assert.match(html, /data-value="review"[^>]*aria-pressed="true"/);
  assert.match(html, /data-value="all"[^>]*aria-pressed="false"/);
  assert.match(html, /data-value="all"[^>]*>All cases <span class="count">5<\/span><\/button>/);
});

test("five filter dropdowns each have a label and no blank choice", () => {
  const html = render({ poolPreparer: "p-alex" });
  const selects = [...html.matchAll(/<select[^>]*data-board-filter="(\w+)"[^>]*>(.*?)<\/select>/g)];
  assert.deepEqual(selects.map((m) => m[1]), ["poolStage", "poolLanguage", "poolService", "poolPreparer", "poolReviewer"]);
  for (const [, key, options] of selects) {
    assert.match(html, new RegExp(`<label[^>]*for="field-${key}"`));
    assert.doesNotMatch(options, /Select an option/);
    assert.doesNotMatch(options, /value=""/);
  }
  assert.doesNotMatch(html, /<select[^>]*\sname=/);
  const options = Object.fromEntries(selects.map((m) => [m[1], [...m[2].matchAll(/<option value="([^"]*)"[^>]*>([^<]*)</g)].map((o) => [o[1], o[2]])]));
  assert.deepEqual(options.poolStage[0], ["all", "Any stage"]);
  assert.deepEqual(options.poolStage.slice(1).map((o) => o[1]), POOL_STAGES.map((s) => describeStage(s).label));
  assert.deepEqual(options.poolLanguage, [["all", "Any language"], ["English", "English"], ["Mandarin", "Mandarin"]]);
  assert.equal(options.poolService[0][1], "Any service");
  assert.deepEqual(options.poolPreparer, [["all", "Anyone"], ["unassigned", "Unassigned"], ["p-alex", "Alex"], ["p-sam", "Sam"]]);
  assert.deepEqual(options.poolReviewer.slice(0, 2), [["all", "Anyone"], ["unassigned", "Unassigned"]]);
  assert.match(html, /<option value="p-alex" selected>/);
});

test("a row shows the reference, stage, phase, people and how long ago", () => {
  const html = render({}, [CASES[1], CASES[2]]);
  assert.match(html, /<tr class="pool-row">/);
  assert.match(html, /<button class="board-reference" data-action="open-case" data-case-id="B">VT-B<\/button>/);
  assert.match(html, /class="pool-phase">Waiting for preparation</);
  assert.match(html, /class="pool-phase">Waiting for review</);
  assert.match(html, /Mandarin/);
  assert.match(html, /State return/);
  assert.match(html, /Alex/);
  assert.match(html, /Unassigned/);
  assert.match(html, /Yesterday/);
  assert.match(html, /5 days ago/);
  assert.match(html, /class="badge/);
});

test("rows are newest first", () => {
  const html = render();
  const order = [...html.matchAll(/data-case-id="(\w)"/g)].map((m) => m[1]);
  const dates = { A: "2026-03-01", B: "2026-03-09", C: "2026-03-05", D: "2026-03-09", E: "2026-03-09" };
  const times = order.map((id) => dates[id]);
  assert.deepEqual(times, [...times].sort().reverse());
  assert.equal(order[order.length - 1], "A");
});

test("the count line and the clear-filters control", () => {
  const narrowed = render({ poolLanguage: "Mandarin", poolPhase: "review" });
  assert.match(narrowed, /<span[^>]*role="status"[^>]*>Showing 1 of 5 cases<\/span>/);
  assert.match(narrowed, /data-action="clear-pool-filters"[^>]*>Clear filters</);
  assert.doesNotMatch(narrowed, /No filters\./);
  const plain = render({ poolPhase: "review" });
  assert.match(plain, /No filters\. Showing every case this season\./);
  assert.doesNotMatch(plain, /clear-pool-filters/);
});

test("no matching case is an empty state", () => {
  const html = render({ poolLanguage: "Mandarin", poolPhase: "closed" });
  assert.match(html, /class="empty-state"[^>]*>[\s\S]*No case matches these filters\./);
  assert.doesNotMatch(html, /<tr class="pool-row"/);
});

test("answer codes display and filter by their labels", () => {
  const cases = [
    rec("X", "received", { answers: { language: "cantonese", service: "drop_off" } }),
    rec("Y", "received", { answers: { language: "cantonese", service: "drop_off" } }),
    rec("Z", "received", { answers: { language: "english", service: "online" } }),
  ];
  const html = render({}, cases);
  assert.doesNotMatch(html, /drop_off|cantonese|online<|english</);
  const opts = (key) => [...html.match(new RegExp(`data-board-filter="${key}"[^>]*>(.*?)</select>`))[1].matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(opts("poolLanguage"), ["all", "Cantonese", "English"]);
  assert.deepEqual(opts("poolService"), ["all", "Drop-off", "Online"]);
  const narrowed = render({ poolService: "Drop-off", poolLanguage: "Cantonese" }, cases);
  assert.match(narrowed, /VT-X/);
  assert.match(narrowed, /VT-Y/);
  assert.doesNotMatch(narrowed, /VT-Z/);
});

test("the pool's Language cell lists every language, and its filter and options include second languages", () => {
  const cases = [
    rec("A", "received", { answers: { language: "cantonese", language_also: ["mandarin"] } }),
    rec("B", "received", { answers: { language: "english" } }),
    rec("C", "received", { answers: { language: "english", language_also: ["other"], language_also_other: "Vietnamese" } }),
  ];
  const opts = (html) => [...html.match(/data-board-filter="poolLanguage"[^>]*>(.*?)<\/select>/)[1].matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
  const all = render({}, cases);
  assert.deepEqual(opts(all), ["all", "Cantonese", "English", "Mandarin", "Other"]);
  assert.match(all, /data-languages="Cantonese\|Mandarin"><span aria-hidden="true">C, M<\/span>/);
  assert.match(all, /title="English \(preferred\), Other: Vietnamese"/);
  assert.match(all, /data-languages="English\|Other"><span aria-hidden="true">E, O<\/span>/);
  const mandarin = render({ poolLanguage: "Mandarin" }, cases);
  assert.match(mandarin, /VT-A/);
  assert.doesNotMatch(mandarin, /VT-B/);
});

test("references and languages are escaped, and the footnote says what is not shown", () => {
  const html = render({}, [rec("X", "received", { reference: "<script>x</script>", answers: { language: "<script>y</script>", service: "s" } })]);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;x/);
  assert.match(html, /&lt;script&gt;y/);
  assert.match(html, /<section class="panel case-pool" aria-labelledby="pool-title"><h2 id="pool-title">All cases<\/h2>/);
  assert.match(html, /class="board-table pool-table"/);
  assert.match(html, /This pool shows workflow only: no taxpayer names, no addresses and no document contents\./);
});

test("the pool's first column is the client number, before the reference", () => {
  const html = render({}, [rec("N", "received", { clientNumber: 93, season: 2025 })]);
  assert.match(html, /<th scope="col">Client<\/th>/);
  assert.match(html, /<span class="client-number">#093<\/span><button class="board-reference"/);
});

// The masked phone in the case pool (D5): the same helper and rule as the
// board. Only admins reach the pool, but the rule decides, not the screen.
const ADMIN = { id: "p-sam", name: "Sam", capabilities: ["admin", "followup"] };
const VOLUNTEER = { id: "p-alex", name: "Alex", capabilities: ["prepare"] };
const PHONE_CASES = [
  rec("P", "preparation_ready", { phone: "2155550123" }),
  rec("Q", "preparing", { preparerId: "p-alex", preparerName: "Alex", phone: "2155550124" }),
  rec("R", "received", { phone: null }),
];
const phonePool = (person) => renderCasePool(PHONE_CASES, PEOPLE, { filters: {}, now: NOW, person });
const poolRowOf = (html, reference) =>
  html.split('<tr class="pool-row">').slice(1).find((row) => row.includes(`>${reference}<`))?.split("</tr>")[0] ?? "";

test("the pool's Phone column comes right after Stage", () => {
  const headers = [...phonePool(ADMIN).matchAll(/<th scope="col">([^<]*)<\/th>/g)].map((match) => match[1]);
  assert.deepEqual(headers, ["Client", "Stage", "Phone", "Language", "Service", "Preparer", "Reviewer", "Updated"]);
});

test("an admin can reveal every listed phone, claimed or not", () => {
  const html = phonePool(ADMIN);
  for (const id of ["P", "Q"]) {
    const row = poolRowOf(html, `VT-${id}`);
    assert.match(row, new RegExp(`<span class="phone-mask" id="pool-phone-${id}" tabindex="0">`));
    assert.ok(row.indexOf('class="board-reference"') < row.indexOf("phone-mask"), "the phone is before the case link");
  }
  assert.match(poolRowOf(html, "VT-R"), /<td>—<\/td>/);
});

test("the pool goes through the rule: a volunteer's unclaimed row, and no person at all, are locked", () => {
  const volunteer = phonePool(VOLUNTEER);
  assert.match(poolRowOf(volunteer, "VT-P"), /phone-mask is-locked/);
  assert.doesNotMatch(poolRowOf(volunteer, "VT-P"), /555|id="pool-phone-/);
  assert.match(poolRowOf(volunteer, "VT-Q"), /id="pool-phone-Q"/);
  const nobody = phonePool(undefined);
  for (const id of ["P", "Q"]) {
    assert.match(poolRowOf(nobody, `VT-${id}`), /phone-mask is-locked/);
    assert.doesNotMatch(poolRowOf(nobody, `VT-${id}`), /555/);
  }
});

test("the pool's note keeps workflow only and says phones stay masked", () => {
  const html = phonePool(ADMIN);
  assert.match(html, /This pool shows workflow only: no taxpayer names, no addresses and no document contents\./);
  assert.match(html, /Phone numbers stay masked until you hover over or tab to them, so they don't show on a shared screen\./);
});

test("the case pool while its cases load, and when they couldn't", () => {
  const loading = renderCasePool([], PEOPLE, { list: "loading", filters: {}, now: NOW });
  assert.match(loading, /Loading cases…/);
  assert.doesNotMatch(loading, /No case matches these filters|data-filter="poolPhase"|Showing 0/);
  const failed = renderCasePool([], PEOPLE, { list: "failed", filters: {}, now: NOW });
  assert.match(failed, /The cases couldn&#39;t load\./);
  assert.doesNotMatch(failed, /No case matches these filters/);
  assert.match(renderCasePool([], PEOPLE, { filters: {}, now: NOW }), /No cases yet this season\./, "ready by default");
});

test("an empty pool says whether nothing exists or nothing matches", () => {
  const none = renderCasePool([], PEOPLE, { filters: {}, now: NOW });
  assert.match(none, /<div class="empty-state"><svg[^]*?<\/svg><p>No cases yet this season\.<\/p><\/div>/);
  assert.doesNotMatch(none, /No case matches these filters/);
  const filtered = renderCasePool([rec("A", "received", { answers: { language: "english" } })], PEOPLE, {
    filters: { poolLanguage: "Mandarin" },
    now: NOW,
  });
  assert.match(filtered, /<div class="empty-state"><svg[^]*?<\/svg><p>No case matches these filters\.<\/p><\/div>/);
  assert.doesNotMatch(filtered, /No cases yet this season/);
  assert.equal([...filtered.matchAll(/data-action="clear-pool-filters"/g)].length, 1, "Clear filters shows once");
  const wrongTab = renderCasePool([rec("B", "received")], PEOPLE, { filters: { poolPhase: "closed" }, now: NOW });
  assert.match(wrongTab, /<p>No case matches these filters\.<\/p>/, "a phase tab is a filter");
  assert.doesNotMatch(wrongTab, /No cases yet this season/);
  const emptyTab = renderCasePool([], PEOPLE, { filters: { poolPhase: "closed" }, now: NOW });
  assert.match(emptyTab, /<p>No case matches these filters\.<\/p>/, "no cases and a phase tab counts as a filter");
  const both = renderCasePool([rec("A", "received", { answers: { language: "english" } })], PEOPLE, {
    filters: { poolPhase: "closed", poolLanguage: "Mandarin" },
    now: NOW,
  });
  assert.match(both, /<p>No case matches these filters\.<\/p>/);
  assert.equal([...both.matchAll(/data-action="clear-pool-filters"/g)].length, 1, "Clear filters shows once");
});

test("the Closed tab filters by reason: each of the six, and No reason", () => {
  const closed = (id, closingReason) => ({
    id, reference: `VT-${id}`, stage: "closed", closingReason, answers: {}, updatedAt: "2026-10-01T12:00:00Z",
  });
  const cases = [
    closed("a", "withdrawn"),
    closed("b", "duplicate"),
    closed("c", null), // closed before reasons existed
    closed("d", undefined),
    { id: "e", reference: "VT-e", stage: "preparing", answers: {} },
  ];
  const ids = (filters) => filterPool(cases, poolFilters(filters)).map((r) => r.id).sort();
  assert.deepEqual(ids({ poolPhase: "closed" }), ["a", "b", "c", "d"]);
  assert.deepEqual(ids({ poolPhase: "closed", poolReason: "withdrawn" }), ["a"]);
  assert.deepEqual(ids({ poolPhase: "closed", poolReason: "duplicate" }), ["b"]);
  assert.deepEqual(ids({ poolPhase: "closed", poolReason: "none" }), ["c", "d"]);
  assert.deepEqual(ids({ poolPhase: "closed", poolReason: "other" }), []);
  // The filter belongs to the Closed tab, and an unknown value is All.
  assert.equal(poolFilters({ poolPhase: "all", poolReason: "withdrawn" }).poolReason, "all");
  assert.equal(poolFilters({ poolPhase: "closed", poolReason: "nonsense" }).poolReason, "all");
  // The tab counts ignore it.
  assert.equal(poolCounts(cases, poolFilters({ poolPhase: "closed", poolReason: "withdrawn" })).closed, 4);
});

test("the Closed reason filter shows on the Closed tab only, with the staff names", () => {
  const closedTab = renderCasePool([], [], { filters: { poolPhase: "closed" } });
  assert.match(closedTab, /id="field-poolReason" data-board-filter="poolReason"/);
  const select = closedTab.slice(closedTab.indexOf('id="field-poolReason"'));
  assert.deepEqual(
    [...select.slice(0, select.indexOf("</select>")).matchAll(/<option value="[a-z_]+"[^>]*>([^<]*)<\/option>/g)].map((m) => m[1]),
    ["Any reason", "Out of scope", "No need to file", "Duplicate", "Dismissed (client unreachable)", "Withdrawn", "Other", "No reason"],
  );
  assert.doesNotMatch(renderCasePool([], [], { filters: {} }), /poolReason/);
  // A closed row names its reason; one closed before reasons existed says "Closed".
  const row = (closingReason) =>
    renderCasePool([{ id: "x", reference: "VT-X", stage: "closed", closingReason, answers: {} }], [], { filters: { poolPhase: "closed" } });
  assert.match(row("duplicate"), /Closed · Duplicate/);
  assert.doesNotMatch(row(null), /Closed ·/);
});

test("the Prepared by and Reviewed by filters skip a person with no capabilities", () => {
  // A volunteer added on the Roster has no sign-in and no capabilities; a
  // person read without the field (an older double) is still offered.
  const people = [
    { id: "p-alex", name: "Alex", capabilities: ["prepare"] },
    { id: "p-ren", name: "Ren", capabilities: [] },
    { id: "p-sam", name: "Sam" },
  ];
  const html = renderCasePool(CASES, people, { filters: {}, now: NOW });
  for (const key of ["poolPreparer", "poolReviewer"]) {
    const select = html.match(new RegExp(`<select id="field-${key}"[\\s\\S]*?</select>`))[0];
    assert.match(select, /<option value="p-alex">Alex<\/option>/);
    assert.match(select, /<option value="p-sam">Sam<\/option>/);
    assert.doesNotMatch(select, /p-ren|Ren/);
  }
});
