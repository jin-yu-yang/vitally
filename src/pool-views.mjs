import { STAGES, CLOSING_REASONS } from "./contracts.mjs";
import { phaseTab, describeStage, CLOSING_REASON_NAMES } from "./domain.mjs";
import { clientLanguages, languageOptions, languageSummary, speaksLanguage, serviceLabel } from "./intake-catalogue.mjs";
import { esc, icon, button, relativeDay, stageBadge, clientNumberTag, languageCell, loadingLine, unloadedLine, emptyState } from "./ui.mjs";
import { listPhone, when } from "./staff-views.mjs";

export const POOL_TABS = Object.freeze([
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
const TAB_VALUES = Object.freeze(POOL_TABS.map(([value]) => value));
export const POOL_STAGES = STAGES;
export const DEFAULT_POOL_FILTERS = Object.freeze({
  poolPhase: "all", poolStage: "all", poolLanguage: "all",
  poolService: "all", poolPreparer: "all", poolReviewer: "all", poolReason: "all",
});
export const POOL_FILTER_KEYS = Object.freeze(Object.keys(DEFAULT_POOL_FILTERS));

// The office's phases on every stage. The three middle ones are the
// volunteer board's own tabs (`phaseTab`), so a case never sits on one tab
// for a volunteer and another for the office. A case waiting on the client
// (Waiting for documents, or an approved return awaiting the client's signature) is on
// "signing"; once signed, it is the office's to file. A Hold, like a Rejected
// return, needs the office's attention.
export function poolPhase(record) {
  const stage = record?.stage;
  if (["draft", "received", "screening"].includes(stage)) return "intake";
  if (stage === "review_approved" || stage === "awaiting_documents") return "signing";
  if (stage === "on_hold") return "attention";
  if (stage === "ready_to_efile" || stage === "efiled") return "filing";
  if (stage === "rejected") return "attention";
  if (stage === "accepted") return "done";
  if (stage === "closed") return "closed";
  return phaseTab(record);
}

export function poolFilters(filters) {
  const chosen = { ...DEFAULT_POOL_FILTERS };
  for (const key of POOL_FILTER_KEYS) {
    const value = String(filters?.[key] ?? "").trim();
    if (value) chosen[key] = value;
  }
  if (!TAB_VALUES.includes(chosen.poolPhase)) chosen.poolPhase = "all";
  if (chosen.poolStage !== "all" && !POOL_STAGES.includes(chosen.poolStage)) chosen.poolStage = "all";
  // The reason filter belongs to the Closed tab: anywhere else it is "all".
  if (chosen.poolPhase !== "closed" || !POOL_REASONS.includes(chosen.poolReason)) chosen.poolReason = "all";
  return chosen;
}

// A closed case's reason: one of the six, or "none" for a case closed before
// reasons existed (it has no reason, and shows the staff name "Closed").
const POOL_REASONS = Object.freeze(["all", ...CLOSING_REASONS, "none"]);
const REASON_OPTIONS = Object.freeze([
  ["all", "Any reason"],
  ...CLOSING_REASONS.map((reason) => [reason, CLOSING_REASON_NAMES[reason]]),
  ["none", "No reason"],
]);
const matchesReason = (record, chosen) =>
  chosen === "all" ||
  (record?.stage === "closed" &&
    (chosen === "none"
      ? !Object.hasOwn(CLOSING_REASON_NAMES, record?.closingReason ?? "")
      : record?.closingReason === chosen));

const matchesValue = (value, chosen, labelOf = (v) => v) =>
  chosen === "all" || labelOf(value ?? "") === labelOf(chosen);
const matchesPerson = (id, chosen) =>
  chosen === "all" || (chosen === "unassigned" ? !id : id === chosen);

export function filterPool(cases = [], chosen, { ignorePhase = false } = {}) {
  return (Array.isArray(cases) ? cases : []).filter(
    (record) =>
      (ignorePhase || chosen.poolPhase === "all" || poolPhase(record) === chosen.poolPhase) &&
      matchesValue(record?.stage, chosen.poolStage) &&
      (ignorePhase || matchesReason(record, chosen.poolReason)) &&
      speaksLanguage(clientLanguages(record?.answers), chosen.poolLanguage) &&
      matchesValue(record?.answers?.service, chosen.poolService, serviceLabel) &&
      matchesPerson(record?.preparerId, chosen.poolPreparer) &&
      matchesPerson(record?.reviewerId, chosen.poolReviewer),
  );
}

export function poolCounts(cases = [], chosen) {
  const scoped = filterPool(cases, chosen, { ignorePhase: true });
  return Object.fromEntries(
    TAB_VALUES.map((tab) => [tab, tab === "all" ? scoped.length : scoped.filter((r) => poolPhase(r) === tab).length]),
  );
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

// No `ui.select`: it adds a blank "Select an option" entry, which reads as a
// real choice here. And no `name`, so no form handler or answer draft reads it.
const filterSelect = (label, key, value, options) =>
  `<label class="field pool-filter" for="field-${key}"><span>${esc(label)}</span><select id="field-${key}" data-board-filter="${key}">${options
    .map(([v, t]) => `<option value="${esc(v)}"${v === value ? " selected" : ""}>${esc(t)}</option>`)
    .join("")}</select></label>`;

const valueOptions = (cases, key, anyLabel, labelOf) => [
  ["all", anyLabel],
  ...[
    ...new Set(
      cases.map((record) => String(labelOf(record?.answers?.[key] ?? "")).trim()).filter(Boolean),
    ),
  ]
    .sort()
    .map((value) => [value, value]),
];

// A volunteer added on the Roster has no capabilities and could never have
// prepared or reviewed a case, so they are not offered. A person read without
// the field at all is kept.
const personOptions = (people) => [
  ["all", "Anyone"],
  ["unassigned", "Unassigned"],
  ...people
    .filter((p) => !Array.isArray(p?.capabilities) || p.capabilities.length > 0)
    .map((person) => [person.id, person.name ?? person.id]),
];

const TAB_LABELS = Object.fromEntries(POOL_TABS);
const NARROWING_KEYS = POOL_FILTER_KEYS.filter((key) => key !== "poolPhase");
const who = (name, id) => (id ? esc(name ?? "Unknown") : `<span class="unassigned">Unassigned</span>`);

function poolRow(record, now, person) {
  const phase = TAB_LABELS[poolPhase(record)];
  return `<tr class="pool-row"><th scope="row">${clientNumberTag(record)}<button class="board-reference" data-action="open-case" data-case-id="${esc(record.id)}">${esc(record.reference)}</button></th><td>${stageBadge(record.stage, "en", { record })}${
    phase ? `<span class="pool-phase">${esc(phase)}</span>` : ""
  }</td><td>${listPhone(record, person, "pool-phone")}</td><td>${languageCell(languageSummary(clientLanguages(record?.answers)))}</td><td>${esc(serviceLabel(record?.answers?.service) || "—")}</td><td>${who(record.preparerName, record.preparerId)}</td><td>${who(record.reviewerName, record.reviewerId)}</td><td class="board-updated">${esc(
    record.updatedAt ? relativeDay(record.updatedAt, now) : "No updates yet",
  )}</td></tr>`;
}

export function renderCasePool(cases = [], people = [], ui = {}) {
  if (ui.list === "loading" || ui.list === "failed")
    return `<section class="panel case-pool" aria-labelledby="pool-title"><h2 id="pool-title">All cases</h2>${
      ui.list === "loading" ? loadingLine("Loading cases…") : unloadedLine("The cases couldn't load.")
    }</section>`;
  const all = Array.isArray(cases) ? cases : [];
  const now = ui.now ?? Date.now();
  const person = ui.person ?? null;
  const chosen = poolFilters(ui.filters);
  const counts = poolCounts(all, chosen);
  const shown = filterPool(all, chosen).sort(
    (a, b) => (Date.parse(b?.updatedAt) || 0) - (Date.parse(a?.updatedAt) || 0),
  );
  const narrowed = NARROWING_KEYS.some((key) => chosen[key] !== "all");
  const tabs = `<div class="filter-group" role="group" aria-label="Case phase">${POOL_TABS.map(([value, label]) =>
    button(
      `${esc(label)} <span class="count">${counts[value]}</span>`,
      "set-board-filter",
      chosen.poolPhase === value ? "chip selected" : "chip",
      `data-filter="poolPhase" data-value="${esc(value)}" aria-pressed="${chosen.poolPhase === value}"`,
    ),
  ).join("")}</div>`;
  const filters = `<div class="pool-filters">${filterSelect(
    "Stage", "poolStage", chosen.poolStage,
    [["all", "Any stage"], ...POOL_STAGES.map((stage) => [stage, describeStage(stage).label])],
  )}${when(
    chosen.poolPhase === "closed",
    filterSelect("Closed reason", "poolReason", chosen.poolReason, REASON_OPTIONS),
  )}${filterSelect("Language", "poolLanguage", chosen.poolLanguage, languageOptions(all, "Any language"))}${filterSelect(
    "Service", "poolService", chosen.poolService, valueOptions(all, "service", "Any service", serviceLabel),
  )}${filterSelect("Prepared by", "poolPreparer", chosen.poolPreparer, personOptions(people))}${filterSelect(
    "Reviewed by", "poolReviewer", chosen.poolReviewer, personOptions(people),
  )}</div>`;
  const summary = `<p class="pool-summary"><span role="status">Showing ${shown.length} of ${all.length} cases</span> ${
    narrowed
      ? button("Clear filters", "clear-pool-filters", "text")
      : `<span class="field-note">No filters. Showing every case this season.</span>`
  }</p>`;
  const body = shown.length
    ? `<div class="board-table-wrap"><table class="board-table pool-table"><thead><tr><th scope="col">Client</th><th scope="col">Stage</th><th scope="col">Phone</th><th scope="col">Language</th><th scope="col">Service</th><th scope="col">Preparer</th><th scope="col">Reviewer</th><th scope="col">Updated</th></tr></thead><tbody>${shown
        .map((record) => poolRow(record, now, person))
        .join("")}</tbody></table></div>`
    : emptyState({ icon: "folder", text: narrowed || chosen.poolPhase !== "all" ? "No case matches these filters." : "No cases yet this season." });
  return `<section class="panel case-pool" aria-labelledby="pool-title"><h2 id="pool-title">All cases</h2>${tabs}${filters}${summary}${body}<p class="field-note board-note">${icon("lock")} This pool shows workflow only: no taxpayer names, no addresses and no document contents. Phone numbers stay masked until you hover over or tab to them, so they don't show on a shared screen.</p></section>`;
}
