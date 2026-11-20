// The Season settings screen (change add-season-settings, design D10): the
// season card with the two upload links and the SIDN row, and the Site
// coordinators card with its History. A site coordinator gets the inputs and
// buttons; any other workspace admin the same values as text. Staff text,
// English only. Pure: `view` is the `vitally_season_settings()` answer.
import { esc, button, loadingLine, unloadedLine } from "./ui.mjs";

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
    help: "Clients open this to send documents.",
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
  return `<div class="season-settings">${readOnly}${seasonCard(view, canEdit, ui)}${coordinatorsCard(view, { canEdit, selfId, ui })}</div>`;
}

/** The Change the SIDN dialog's body: one field, Save and Cancel. */
export function changeSidnDialogBody({ error = null, busy = false } = {}) {
  return `<form id="sidn-form" class="staff-form" novalidate><label class="field" for="sidn-input"><span>SIDN</span><input type="text" id="sidn-input" name="sidn" maxlength="20" autocomplete="off" spellcheck="false"${
    error ? ' aria-invalid="true" aria-describedby="sidn-error"' : ""
  }></label>${error ? `<p class="field-error" id="sidn-error" role="alert">${esc(error)}</p>` : ""}<div class="drawer-actions"><button type="submit" class="btn primary"${disabled(
    busy,
  )}>Save</button>${button("Cancel", "close-dialog", "text")}</div></form>`;
}
