// The admin Workload (change add-volunteer-workload): the Volunteers page's
// tabs, the Workload table with its Unassigned row and expandable case lists,
// and the Assign/Reassign drawer. Staff screens stay English. Taxpayer names
// show here, and only here, because only a cleared admin opens the Workload
// (design D2). The numbers come from `volunteer-workload.mjs`.
import { esc, button, icon, stageBadge, loadingLine, unloadedLine, emptyLine } from "./ui.mjs";
import { drawerError } from "./office-views.mjs";
import { languagesText } from "./volunteer-views.mjs";
import { ROLES } from "./volunteer-roster.mjs";
import { sortRows, searchRows, taxpayerName } from "./volunteer-workload.mjs";

const when = (condition, html) => (condition ? html : "");
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

export const WORKLOAD_FOOTNOTE = "Taxpayer names show here because only admins can open the Workload.";
export const DEFAULT_WORKLOAD_SORT = Object.freeze({ key: "open", dir: "desc" });
const UNASSIGNED_ID = "unassigned";

const TABS = Object.freeze([
  ["roster", "Roster"],
  ["workload", "Workload"],
]);

/**
 * The Volunteers page's tabs. The Workload tab is offered only when
 * `workload` (a cleared, effective admin; design D1).
 */
export function volunteerTabs(current = "roster", { workload = false } = {}) {
  const buttons = TABS.filter(([tab]) => tab === "roster" || workload)
    .map(([tab, label]) => {
      const on = tab === current;
      return `<button type="button" class="volunteer-tab${on ? " current" : ""}" data-action="volunteer-tab" data-tab="${tab}"${
        on ? ' aria-current="page"' : ""
      }>${label}</button>`;
    })
    .join("");
  return `<nav class="volunteer-tabs" aria-label="Volunteers">${buttons}</nav>`;
}

// ---- The table ------------------------------------------------------------

const COLUMNS = Object.freeze([
  { key: "name", label: "Volunteer" },
  { key: "open", label: "Open" },
  { key: null, label: "Breakdown" },
  { key: "preparing", label: "Preparing" },
  { key: "review", label: "Review" },
  { key: "waiting", label: "Waiting on client" },
  { key: "stalled", label: "Stalled" },
]);

function header(column, sort) {
  if (!column.key) return `<th scope="col">${esc(column.label)}</th>`;
  const current = sort.key === column.key;
  const ariaSort = current ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
  return `<th scope="col" aria-sort="${ariaSort}"><button type="button" class="workload-sort" data-action="sort-workload" data-key="${column.key}">${esc(
    column.label,
  )}</button></th>`;
}

// A bar split into Preparing and Review; the numbers are in its label.
function bar(first, second, label) {
  const total = first + second;
  const share = (part) => (total ? Math.round((part / total) * 100) : 0);
  return `<div class="workload-bar" role="img" aria-label="${esc(label)}"><span class="workload-bar-preparing" style="width:${share(
    first,
  )}%"></span><span class="workload-bar-review" style="width:${share(second)}%"></span></div>`;
}

const cell = (col, value) => `<td data-col="${col}">${value}</td>`;

function toggle(id, name, expanded) {
  return `<button type="button" class="workload-toggle" data-action="toggle-workload-row" data-row-id="${esc(id)}" aria-expanded="${
    expanded ? "true" : "false"
  }" aria-controls="workload-cases-${esc(id)}">${icon("expand")}<span class="workload-name">${name}</span></button>`;
}

const SLOT_LABEL = Object.freeze({ preparer: "Preparer", reviewer: "Reviewer" });
const SLOT_NEEDS_WORD = Object.freeze({ preparer: "prepare", reviewer: "review" });
const WAITING_LABEL = Object.freeze({ preparer: "Needs a preparer", reviewer: "Needs a reviewer" });

function caseItem(record, { slotText, stalled = false, roleRemoved = false, action, slot }) {
  const reference = record.reference ?? "";
  const verb = action === "Assign" ? `Assign a ${slot} to` : `Reassign the ${slot} of`;
  return `<li class="workload-case"><span class="workload-case-ref">${esc(reference)}</span><span class="workload-case-name">${esc(
    taxpayerName(record.answers),
  )}</span>${stageBadge(record.stage, "en", { record })}<span class="workload-slot">${esc(slotText)}</span>${when(
    stalled,
    `<span class="workload-stalled">Stalled</span>`,
  )}${when(roleRemoved, `<span class="workload-role-removed">No ${SLOT_NEEDS_WORD[slot]} role</span>`)}<span class="workload-case-actions">${button(
    "Open",
    "open-case",
    "secondary",
    `data-case-id="${esc(record.id)}" aria-label="Open ${esc(reference)}"`,
  )}${button(
    action,
    "open-assign",
    "secondary",
    `data-case-id="${esc(record.id)}" data-slot="${slot}" aria-label="${esc(`${verb} ${reference}`)}"`,
  )}</span></li>`;
}

const casesRow = (id, items, none) =>
  `<tr class="workload-cases-row" id="workload-cases-${esc(id)}"><td colspan="${COLUMNS.length}">${
    items.length ? `<ul class="workload-cases">${items.join("")}</ul>` : emptyLine(esc(none))
  }</td></tr>`;

function unassignedRows(unassigned, expanded) {
  const preparer = unassigned?.preparer ?? [];
  const reviewer = unassigned?.reviewer ?? [];
  const open = expanded.includes(UNASSIGNED_ID);
  const summary = `${preparer.length} waiting for a preparer, ${reviewer.length} for a reviewer`;
  const row = `<tr class="workload-row workload-unassigned" data-row-id="${UNASSIGNED_ID}"><th scope="row">${toggle(
    UNASSIGNED_ID,
    "Unassigned",
    open,
  )}<span class="workload-sub">${esc(summary)}</span></th>${cell("open", preparer.length + reviewer.length)}${cell(
    "bar",
    bar(preparer.length, reviewer.length, summary),
  )}${cell("preparing", preparer.length)}${cell("review", reviewer.length)}${cell("waiting", "—")}${cell("stalled", "—")}</tr>`;
  if (!open) return row;
  const items = [
    ...preparer.map((record) => caseItem(record, { slotText: WAITING_LABEL.preparer, action: "Assign", slot: "preparer" })),
    ...reviewer.map((record) => caseItem(record, { slotText: WAITING_LABEL.reviewer, action: "Assign", slot: "reviewer" })),
  ];
  return `${row}${casesRow(UNASSIGNED_ID, items, "No case is waiting for a preparer or a reviewer.")}`;
}

function volunteerRows(row, expanded) {
  const open = expanded.includes(row.id);
  const line = `<tr class="workload-row" data-row-id="${esc(row.id)}"><th scope="row">${toggle(row.id, esc(row.name), open)}${when(
    !row.cleared,
    ` <span class="volunteer-not-cleared">Not cleared</span>`,
  )}${when(
    row.roleRemoved,
    ` <span class="workload-role-removed">Holds cases without the role</span>`,
  )}</th>${cell("open", row.open)}${cell("bar", bar(row.preparing, row.review, `${row.preparing} preparing, ${row.review} in review`))}${cell(
    "preparing",
    row.preparing,
  )}${cell("review", row.review)}${cell("waiting", row.waiting)}${cell("stalled", row.stalled)}</tr>`;
  if (!open) return line;
  const items = (row.cases ?? []).map(({ record, slot, stalled, roleRemoved }) =>
    caseItem(record, { slotText: SLOT_LABEL[slot] ?? slot, stalled, roleRemoved, action: "Reassign", slot }),
  );
  return `${line}${casesRow(row.id, items, "No open cases.")}`;
}

/**
 * The Workload's panel: the search box, the table (Unassigned first, then one
 * row per volunteer, sorted and searched), the count and the footnote.
 *
 * @param {object} args `{rows, unassigned, sort, search, expanded, now, list}` —
 *   `rows` from `workloadRows`, `unassigned` from `unassignedCases`, `sort`
 *   `{key, dir}`, `expanded` the row ids that are open ("unassigned" for the
 *   Unassigned row), `list` "loading", "failed" or "ready".
 */
export function renderWorkload({
  rows = [],
  unassigned = { preparer: [], reviewer: [] },
  sort = DEFAULT_WORKLOAD_SORT,
  search = "",
  expanded = [],
  list = "ready",
} = {}) {
  const head = `<section class="panel volunteer-workload" aria-labelledby="workload-title"><h2 id="workload-title">Workload</h2>`;
  if (list === "loading") return `${head}${loadingLine("Loading the workload…")}</section>`;
  if (list === "failed") return `${head}${unloadedLine("The workload couldn't load.")}</section>`;
  const chosen = { key: sort?.key ?? DEFAULT_WORKLOAD_SORT.key, dir: sort?.dir ?? DEFAULT_WORKLOAD_SORT.dir };
  const open = Array.isArray(expanded) ? expanded : [];
  const all = Array.isArray(rows) ? rows : [];
  const shown = sortRows(searchRows(all, search), chosen);
  const toolbar = `<div class="volunteer-toolbar"><input id="workload-search" name="workloadSearch" type="search" value="${esc(
    search ?? "",
  )}" placeholder="Search volunteers by name" aria-label="Search the workload" autocomplete="off"></div>`;
  const table = `<div class="board-table-wrap"><table class="board-table people-table workload-table"><thead><tr>${COLUMNS.map((column) =>
    header(column, chosen),
  ).join("")}</tr></thead><tbody>${unassignedRows(unassigned, open)}${shown
    .map((row) => volunteerRows(row, open))
    .join("")}</tbody></table></div>`;
  const nobody = all.length && !shown.length ? emptyLine("Nobody matches.") : "";
  return `${head}${toolbar}${table}${nobody}<p class="board-foot" role="status">${shown.length} of ${all.length} volunteers</p><p class="field-note workload-note">${esc(
    WORKLOAD_FOOTNOTE,
  )}</p></section>`;
}

// ---- The Assign/Reassign drawer ----------------------------------------------

const roleText = (roles) =>
  (roles ?? []).map((role) => ROLES.find((entry) => entry.value === role)?.label ?? role).join(", ") || "No roles recorded";

/** The drawer's heading: the case # and the primary taxpayer's full name. */
export const assignDrawerTitle = (record) =>
  record ? `${record.reference ?? ""} · ${taxpayerName(record.answers)}` : "Assign";

function hiddenNote(slot, count) {
  if (!count) return "";
  const text =
    slot === "reviewer"
      ? count === 1
        ? "1 person who prepared this case isn't shown."
        : `${count} people who prepared this case aren't shown.`
      : count === 1
        ? "1 person who is reviewing this case isn't shown."
        : `${count} people who are reviewing this case aren't shown.`;
  return `<p class="field-note assign-hidden">${esc(text)}</p>`;
}

function personItem(entry, busy) {
  const choose = entry.current
    ? `<span class="assign-current">Current</span>`
    : button(
        "Choose",
        "assign-case",
        "secondary",
        `data-person-id="${esc(entry.id)}" aria-label="Choose ${esc(entry.name)}"${busy ? " disabled" : ""}`,
      );
  return `<li class="assign-person${entry.current ? " is-current" : ""}"><div class="assign-person-info"><strong>${esc(
    entry.name,
  )}</strong><span class="assign-languages">${esc(languagesText(entry))}</span><span class="assign-roles">${esc(
    roleText(entry.roles),
  )}</span><span class="assign-open">${esc(plural(entry.open ?? 0, "open case", "open cases"))}</span></div>${choose}</li>`;
}

/**
 * The Assign/Reassign drawer's body for one slot of one case.
 *
 * @param {object} args `{record, slot, result, search, ui}` — `result` is
 *   `candidates(...)`; `search` filters its list by name, ignoring case; `ui` is
 *   `{busy, error, retryable}`.
 */
export function assignDrawerBody({ record = null, slot = "preparer", result = null, search = "", ui = {} } = {}) {
  if (!record)
    return `${drawerError(ui)}<p>This case could not be opened. Close this and try again.</p>${button(
      "Close",
      "close-dialog",
      "secondary",
    )}`;
  const held = slot === "reviewer" ? record.reviewerId : record.preparerId;
  const what = held ? `Reassign the ${slot}` : `Assign a ${slot}`;
  const needle = String(search ?? "").trim().toLowerCase();
  const all = result?.list ?? [];
  const shown = needle ? all.filter((entry) => String(entry.name ?? "").toLowerCase().includes(needle)) : all;
  const listHtml = shown.length
    ? `<ul class="assign-list">${shown.map((entry) => personItem(entry, ui?.busy === true)).join("")}</ul>`
    : emptyLine(all.length ? "Nobody matches." : `Nobody can be the ${slot} right now.`);
  return `<p class="assign-slot"><strong>${esc(what)}</strong></p><input id="assign-search" name="assignSearch" type="search" value="${esc(
    search ?? "",
  )}" placeholder="Search by name" aria-label="Search people" autocomplete="off">${hiddenNote(
    slot,
    result?.hiddenForIndependence ?? 0,
  )}${listHtml}${drawerError(ui)}<div class="drawer-actions">${button("Cancel", "close-dialog", "text")}</div>`;
}
