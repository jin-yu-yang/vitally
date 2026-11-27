// The Season settings screen (change add-season-settings, design D10): the
// season card with the two upload links and the SIDN row, and the Site
// coordinators card with its History. A site coordinator gets the inputs and
// buttons; any other workspace admin the same values as text. Staff text,
// English only. Pure: `view` is the `vitally_season_settings()` answer.
import { esc, button, loadingLine, unloadedLine } from "./ui.mjs";
import { WEEKDAYS, hourLabel } from "./volunteer-schedule.mjs";
import { FREE_TEXT_WARNING } from "./season-export.mjs";

export const LINK_MESSAGE = "Enter a link that starts with https://.";
export const READ_ONLY_NOTE = "Only site coordinators can change these settings.";

// "2027 for TY 2026": the season is the filing year, the tax year the one before.
export const seasonLabel = (season) => `${season} for TY ${Number(season) - 1}`;

// "Nov 19, 2026": a calendar day in New York, whatever the machine's time zone.
const DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  year: "numeric",
});
const longDay = (value) => {
  if (!value) return "";
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? "" : DAY.format(at);
};

const disabled = (busy) => (busy ? " disabled" : "");

// The two links: the payload key, the input id, the label and the help text.
const LINKS = Object.freeze([
  {
    key: "certificateUploadUrl",
    id: "settings-certificate-link",
    label: "Certificate and photo ID upload link",
    help: 'Volunteers open this from "Finish your setup". Use a folder only site coordinators can see.',
  },
  {
    key: "clientDocumentsUrl",
    id: "settings-documents-link",
    label: "Client documents upload link",
    help: "Clients open this to send documents. Use a OneDrive file-request (upload-only) link so clients cannot see one another's files.",
  },
]);

const notice = (ui, place) =>
  ui?.notice?.place === place && ui.notice.text
    ? `<p class="notice error settings-notice" role="alert">${esc(ui.notice.text)}</p>`
    : "";

function linkField(link, value, error, busy) {
  const described = [`${link.id}-note`, error ? `${link.id}-error` : ""].filter(Boolean).join(" ");
  return `<label class="field" for="${link.id}"><span>${esc(link.label)}</span><input type="text" inputmode="url" id="${link.id}" name="${link.key}" maxlength="500" autocomplete="off" spellcheck="false" placeholder="https://…" value="${esc(
    value ?? "",
  )}"${error ? ' aria-invalid="true"' : ""} aria-describedby="${described}"${disabled(busy)}></label><p class="field-note" id="${link.id}-note">${esc(
    link.help,
  )}</p>${error ? `<p class="field-error" id="${link.id}-error">${esc(error)}</p>` : ""}`;
}

function linkValue(link, value) {
  return `<div class="settings-value"><span class="settings-label">${esc(link.label)}</span><p class="settings-link">${
    value ? esc(value) : "Not set"
  }</p><p class="field-note">${esc(link.help)}</p></div>`;
}

function sidnRow(view, canEdit, busy) {
  const number = view.siteNumber ?? {};
  const status = number.set ? `Set · updated ${longDay(number.updatedAt)}` : "Not set";
  return `<div class="settings-sidn"><h3 id="sidn-title">Site ID number (SIDN)</h3><div class="settings-sidn-row"><p id="sidn-status">${esc(
    status,
  )}</p>${canEdit ? button("Change…", "open-change-sidn", "secondary", `aria-describedby="sidn-title"${disabled(busy)}`) : ""}</div><p class="field-note">Volunteers type it at their first sign-in.</p></div>`;
}

function seasonCard(view, canEdit, ui) {
  const busy = ui?.busy === true;
  const errors = ui?.fieldErrors ?? {};
  const links = canEdit
    ? `<form id="season-settings-form" class="staff-form settings-form" novalidate>${LINKS.map((link) =>
        linkField(link, view[link.key], errors[link.key], busy),
      ).join("")}<div class="settings-actions"><button type="submit" class="btn primary"${disabled(busy)}>Save</button></div></form>`
    : LINKS.map((link) => linkValue(link, view[link.key])).join("");
  return `<section class="panel settings-card" aria-labelledby="season-card-title"><div class="card-head"><h2 id="season-card-title">${esc(
    seasonLabel(view.season),
  )} <span class="badge neutral">Current</span></h2></div>${notice(ui, "links")}${links}${sidnRow(view, canEdit, busy)}</section>`;
}

// ---- Site hours and coverage (change add-volunteer-schedule) --------------
//
// One week of site hours, Monday to Sunday, each day closed or open from a
// whole hour to a later one (America/New_York), and the three coverage
// targets. A site coordinator gets a tile per day, the hour selects, the
// number inputs and the card's own Save; any other workspace admin the same
// values as text. `view.schedule` is `{siteHours: {"1".."7": {open, close}},
// targets: {preparersNeeded, reviewersNeeded, onSiteNeeded}, revision}`.

const TARGETS = Object.freeze([
  { key: "preparersNeeded", id: "site-target-preparers", label: "Preparers needed", one: "preparer", many: "preparers" },
  { key: "reviewersNeeded", id: "site-target-reviewers", label: "Reviewers needed", one: "reviewer", many: "reviewers" },
  { key: "onSiteNeeded", id: "site-target-on-site", label: "On site needed (greeters or intakers)", one: "on site", many: "on site" },
]);

const DEFAULT_TARGETS = Object.freeze({ preparersNeeded: 2, reviewersNeeded: 1, onSiteNeeded: 1 });
// The hours a closed day offers when it is opened.
const DEFAULT_DAY = Object.freeze({ open: 10, close: 16 });

const dayHours = (siteHours, day) => {
  const hours = siteHours?.[day] ?? siteHours?.[String(day)];
  return hours && Number.isInteger(hours.open) && Number.isInteger(hours.close) ? hours : null;
};

const hourChoices = (from, to, value) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i)
    .map((hour) => `<option value="${hour}"${hour === value ? " selected" : ""}>${esc(hourLabel(hour))}</option>`)
    .join("");

function dayTile(day, hours, error, busy) {
  const name = WEEKDAYS[day - 1];
  const shown = hours ?? DEFAULT_DAY;
  const base = `site-day-${day}`;
  const invalid = error ? ` aria-invalid="true" aria-describedby="${base}-error"` : "";
  return `<fieldset class="site-day"><legend>${esc(name)}</legend><label class="checkbox-row small" for="${base}-open"><input type="checkbox" id="${base}-open" name="open-${day}" data-site-day="${day}"${
    hours ? " checked" : ""
  }${disabled(busy)}><span>Open</span></label><div class="site-day-hours" id="${base}-hours"${hours ? "" : " hidden"}><label class="field" for="${base}-from"><span>Opens</span><select id="${base}-from" name="from-${day}"${invalid}${disabled(
    busy,
  )}>${hourChoices(0, 23, shown.open)}</select></label><label class="field" for="${base}-to"><span>Closes</span><select id="${base}-to" name="to-${day}"${invalid}${disabled(
    busy,
  )}>${hourChoices(1, 24, shown.close)}</select></label></div>${error ? `<p class="field-error" id="${base}-error">${esc(error)}</p>` : ""}</fieldset>`;
}

function targetField(target, value, error, busy) {
  const invalid = error ? ` aria-invalid="true" aria-describedby="${target.id}-error"` : "";
  return `<label class="field" for="${target.id}"><span>${esc(target.label)}</span><input type="number" id="${target.id}" name="${target.key}" min="0" max="9" step="1" inputmode="numeric" value="${esc(
    value ?? "",
  )}"${invalid}${disabled(busy)}></label>${error ? `<p class="field-error" id="${target.id}-error">${esc(error)}</p>` : ""}`;
}

const dayLine = (day, hours) =>
  `<li>${esc(`${WEEKDAYS[day - 1]} · ${hours ? `${hourLabel(hours.open)} – ${hourLabel(hours.close)}` : "Closed"}`)}</li>`;

const targetLine = (target, value) => `<li>${esc(`${value} ${Number(value) === 1 ? target.one : target.many}`)}</li>`;

const DAYS = Object.freeze([1, 2, 3, 4, 5, 6, 7]);

function siteHoursCard(view, canEdit, ui) {
  const schedule = view.schedule;
  if (!schedule || typeof schedule !== "object") return "";
  const busy = ui?.busy === true;
  const errors = ui?.fieldErrors ?? {};
  const targets = { ...DEFAULT_TARGETS, ...(schedule.targets ?? {}) };
  const body = canEdit
    ? `<form id="site-hours-form" class="staff-form site-hours-form" novalidate><div class="site-days">${DAYS.map((day) =>
        dayTile(day, dayHours(schedule.siteHours, day), errors[`siteHours.${day}`], busy),
      ).join("")}</div><fieldset class="site-targets"><legend>Needed each open hour</legend>${TARGETS.map((target) =>
        targetField(target, targets[target.key], errors[target.key], busy),
      ).join("")}</fieldset><div class="settings-actions"><button type="submit" class="btn primary"${disabled(busy)}>Save</button></div></form>`
    : `<ul class="site-hours-list">${DAYS.map((day) => dayLine(day, dayHours(schedule.siteHours, day))).join(
        "",
      )}</ul><h3 class="site-targets-title">Needed each open hour</h3><ul class="site-hours-list">${TARGETS.map((target) =>
        targetLine(target, targets[target.key]),
      ).join("")}</ul>`;
  return `<section class="panel settings-card" aria-labelledby="site-hours-title"><div class="card-head"><h2 id="site-hours-title">Site hours and coverage</h2><span class="muted small">Every week · New York time</span></div>${notice(
    ui,
    "site-hours",
  )}${body}</section>`;
}

/**
 * The site hours form read whole, for `vitally_save_schedule_settings`:
 * every open day's hours (a closed day is left out of `siteHours`) and all
 * three targets. A target left empty goes as null, for the database to name.
 */
export function scheduleSettingsFromForm(formData) {
  const siteHours = {};
  for (const day of DAYS) {
    if (formData.get(`open-${day}`) == null) continue;
    siteHours[day] = { open: Number(formData.get(`from-${day}`)), close: Number(formData.get(`to-${day}`)) };
  }
  const target = (key) => {
    const text = String(formData.get(key) ?? "").trim();
    return text === "" ? null : Number(text);
  };
  return {
    siteHours,
    targets: Object.fromEntries(TARGETS.map(({ key }) => [key, target(key)])),
  };
}

// ---- Start next season (change add-start-next-season, design D8) --------

// The confirm opens only for the next season's year, typed (spaces aside).
export const startSeasonReady = (season, typed) =>
  Number.isInteger(Number(season)) && season != null && String(typed ?? "").trim() === String(Number(season) + 1);

// A SEASON_NOT_FINISHED refusal's counts, one line for each above zero, in
// the order the database counts them; singular for one.
const REFUSAL_LINES = Object.freeze([
  ["openCases", "open case", "open cases"],
  ["openFollowups", "open follow-up", "open follow-ups"],
  ["claimedHelp", "claimed help request", "claimed help requests"],
  ["unclaimedHelpOnCases", "unclaimed help request on cases", "unclaimed help requests on cases"],
]);
export function seasonRefusalLines(counts) {
  if (!counts || typeof counts !== "object") return [];
  return REFUSAL_LINES.flatMap(([key, one, many]) => {
    const n = Number(counts[key]);
    return Number.isInteger(n) && n > 0 ? [`${n} ${n === 1 ? one : many}`] : [];
  });
}

// "Nov 27, 3:05 pm": the export's moment in New York, whatever the machine's
// time zone.
const EXPORT_MOMENT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** The card's line for the latest export of the season: `{name, exportedAt}` or none. */
export function lastExportLine(lastExport) {
  const at = lastExport?.exportedAt ? new Date(lastExport.exportedAt) : null;
  if (!lastExport?.name || !at || Number.isNaN(at.getTime())) return "No export yet this season.";
  const part = Object.fromEntries(EXPORT_MOMENT.formatToParts(at).map((p) => [p.type, p.value]));
  const moment = `${part.month} ${part.day}, ${part.hour}:${part.minute} ${String(part.dayPeriod).toLowerCase()}`;
  return `Last export: ${lastExport.name} · ${moment}`;
}

// The card: one ZIP of CSVs, the Last export line, and for a site coordinator
// the button. Any other workspace admin reads the line.
function exportCard(view, canEdit, ui) {
  const busy = ui?.busy === true;
  const open = canEdit
    ? `<div class="settings-actions">${button("Export this season…", "open-export-season", "secondary", `aria-describedby="season-export-title"${disabled(busy)}`)}</div>`
    : "";
  return `<section class="panel settings-card" aria-labelledby="season-export-title"><div class="card-head"><h2 id="season-export-title">Season export</h2><span class="muted small">${esc(
    seasonLabel(view.season),
  )}</span></div><p>One ZIP of CSVs for PCDC's archive.</p><p class="field-note" id="season-export-last">${esc(lastExportLine(view.lastExport))}</p>${open}</section>`;
}

/**
 * The Export the season dialog's body. `season` is the season the page read;
 * `busy` is true while the export runs (the confirm reads Preparing…).
 */
export function exportSeasonDialogBody({ season, busy = false } = {}) {
  return `<div id="export-season-body" class="staff-form"><p>Export the ${esc(
    season,
  )} season as one ZIP of CSV files.</p><p class="field-note">Included: cases and intake answers, household members, status history, messages between clients and staff, follow-ups, the call log, and help requests.</p><p class="field-note">Not included: the roster and certificates (use Roster → Export CSV), and the 13614-C PDFs (rebuilt from the answers).</p><p class="notice" role="note">${esc(
    FREE_TEXT_WARNING,
  )}</p><div class="drawer-actions"><button type="button" class="btn primary" id="export-season-submit" data-action="export-season"${
    busy ? " disabled" : ""
  }>${busy ? "Preparing…" : "Download ZIP"}</button>${button("Cancel", "close-dialog", "text", disabled(busy).trim())}</div></div>`;
}

// The card: what starting the next season does, and for a site coordinator
// the button. Any other workspace admin reads the same text.
function nextSeasonCard(view, canEdit, ui) {
  const busy = ui?.busy === true;
  const next = Number(view.season) + 1;
  const start = canEdit
    ? `<div class="settings-actions">${button("Start next season…", "open-start-season", "secondary", `aria-describedby="next-season-title"${disabled(busy)}`)}</div>`
    : "";
  return `<section class="panel settings-card" aria-labelledby="next-season-title"><div class="card-head"><h2 id="next-season-title">Next season</h2><span class="muted small">${esc(
    seasonLabel(next),
  )}</span></div>${notice(ui, "next-season")}<p>When this season's work is finished, a site coordinator starts the next one. Site coordinators keep their sign-in; every other staff account loses it, and the new roster starts with only the person who starts it.</p>${start}</section>`;
}

/**
 * The Start next season dialog's body. `season` is the season the page read;
 * `typed` what the year field holds; `refusal` a SEASON_NOT_FINISHED
 * refusal's counts. The confirm stays disabled until the year is typed.
 */
export function startSeasonDialogBody({ season, typed = "", refusal = null, busy = false } = {}) {
  const next = Number(season) + 1;
  const lines = seasonRefusalLines(refusal);
  const refused = lines.length
    ? `<div class="notice error" role="alert" id="start-season-refusal"><p>Finish these first:</p><ul>${lines
        .map((line) => `<li>${esc(line)}</li>`)
        .join("")}</ul></div>`
    : "";
  const ready = startSeasonReady(season, typed) && !busy;
  return `${refused}<form id="start-season-form" class="staff-form" novalidate><ul class="start-season-effects"><li>Site coordinators keep their sign-in.</li><li>Every other staff account loses its sign-in.</li><li>The ${esc(
    next,
  )} roster starts with only you.</li></ul><p class="field-note">${esc(
    "Export this season's roster and cases first if you need them.",
  )}</p><label class="field" for="start-season-year"><span>Type ${esc(next)} to confirm</span><input type="text" id="start-season-year" name="year" inputmode="numeric" maxlength="4" autocomplete="off" spellcheck="false" value="${esc(
    typed,
  )}"${disabled(busy)}></label><div class="drawer-actions"><button type="submit" class="btn primary" id="start-season-submit"${
    ready ? "" : " disabled"
  }>Start the ${esc(next)} season</button>${button("Cancel", "close-dialog", "text")}</div></form>`;
}

function coordinatorRow(person, { canEdit, selfId, busy }) {
  const details = [
    person.email ?? "",
    person.since ? `since ${longDay(person.since)}` : "",
    person.onRoster === false ? "not on this season's roster" : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const you = selfId != null && person.volunteerId === selfId ? ' <span class="badge neutral">You</span>' : "";
  const remove = canEdit
    ? button(
        "Remove",
        "remove-site-coordinator",
        "text danger-text",
        `data-volunteer-id="${esc(person.volunteerId)}" aria-label="Remove ${esc(person.name)}"${disabled(busy)}`,
      )
    : "";
  return `<li><div class="sc-person"><strong>${esc(person.name)}</strong>${you}<small>${esc(details)}</small></div>${remove}</li>`;
}

const historyLine = (line) => {
  const text =
    line.changedByName == null
      ? `The roster command made ${line.personName} a site coordinator`
      : line.granted
        ? `${line.changedByName} made ${line.personName} a site coordinator`
        : `${line.changedByName} removed ${line.personName} as site coordinator`;
  return `<li><span class="muted">${esc(longDay(line.changedAt))}</span> ${esc(text)}</li>`;
};

function coordinatorsCard(view, { canEdit, selfId, ui }) {
  const busy = ui?.busy === true;
  const people = Array.isArray(view.siteCoordinators) ? view.siteCoordinators : [];
  const candidates = Array.isArray(view.candidates) ? view.candidates : [];
  const history = Array.isArray(view.history) ? view.history : [];
  const list = `<ul class="sc-list">${people.map((person) => coordinatorRow(person, { canEdit, selfId, busy })).join("")}</ul>`;
  const add = canEdit
    ? `<form id="sc-add-form" class="staff-form sc-add" novalidate><select id="sc-pick" name="volunteerId" aria-label="Make someone a site coordinator"${disabled(
        busy,
      )}><option value="">Make someone a site coordinator…</option>${candidates
        .map((person) => `<option value="${esc(person.volunteerId)}">${esc(person.name)}</option>`)
        .join("")}</select>${button("Add", "add-site-coordinator", "secondary", "disabled")}</form>`
    : "";
  const log = history.length
    ? `<details class="sc-log"><summary>History</summary><ul>${history.map(historyLine).join("")}</ul></details>`
    : "";
  return `<section class="panel settings-card" aria-labelledby="sc-title"><div class="card-head"><h2 id="sc-title">Site coordinators</h2><span class="muted small">Kept across seasons · at least one</span></div>${notice(
    ui,
    "coordinators",
  )}${list}${add}${log}</section>`;
}

/**
 * The page's body. `canEdit` is the read's own answer (a site coordinator);
 * `selfId` the signed-in person, for the "You" badge; `list` the read's state
 * before any answer landed; `ui` is `{notice: {place, text}, fieldErrors,
 * busy}`.
 */
export function renderSeasonSettings(view, { canEdit = false, selfId = null, list = "ready", ui = {} } = {}) {
  if (!view) {
    if (list === "failed") return unloadedLine("Season settings couldn't load.");
    return loadingLine("Loading Season settings…");
  }
  const readOnly = canEdit ? "" : `<p class="notice settings-readonly" role="note">${esc(READ_ONLY_NOTE)}</p>`;
  return `<div class="season-settings">${readOnly}${seasonCard(view, canEdit, ui)}${siteHoursCard(view, canEdit, ui)}${exportCard(view, canEdit, ui)}${nextSeasonCard(view, canEdit, ui)}${coordinatorsCard(view, { canEdit, selfId, ui })}</div>`;
}

/** The Change the SIDN dialog's body: one field, Save and Cancel. */
export function changeSidnDialogBody({ error = null, busy = false } = {}) {
  return `<form id="sidn-form" class="staff-form" novalidate><label class="field" for="sidn-input"><span>SIDN</span><input type="text" id="sidn-input" name="sidn" maxlength="20" autocomplete="off" spellcheck="false"${
    error ? ' aria-invalid="true" aria-describedby="sidn-error"' : ""
  }></label>${error ? `<p class="field-error" id="sidn-error" role="alert">${esc(error)}</p>` : ""}<div class="drawer-actions"><button type="submit" class="btn primary"${disabled(
    busy,
  )}>Save</button>${button("Cancel", "close-dialog", "text")}</div></form>`;
}
