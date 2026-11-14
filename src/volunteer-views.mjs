// The admin-only Roster (change add-volunteer-roster-records, design D9): the
// Volunteers page and its Add / Edit drawer. Staff screens stay English. Each
// row says whether the volunteer is cleared (change add-volunteer-clearance).
import { esc, button, icon, loadingLine, unloadedLine, emptyLine } from "./ui.mjs";
import { drawerError } from "./office-views.mjs";
import { ROLES, CERTIFICATES, WORKS, LANGUAGES, filterVolunteers } from "./volunteer-roster.mjs";

const when = (condition, html) => (condition ? html : "");
const labelOf = (list, value) => list.find((entry) => entry.value === value)?.label ?? value;

const REMOTE_WORKS = Object.freeze(["remote", "on_site_and_remote"]);
const VOLUNTEER_CONFLICT_HEADING = "This volunteer changed while you were working";

const chips = (values, list, none) =>
  values?.length
    ? `<span class="volunteer-chips">${values
        .map((value) => `<span class="volunteer-chip">${esc(labelOf(list, value))}</span>`)
        .join("")}</span>`
    : `<span class="muted">${esc(none)}</span>`;

// The languages, with Other replaced by the language it names.
export const languagesText = (volunteer) => {
  const names = (volunteer.languages ?? []).map((value) =>
    value === "other" && volunteer.otherLanguage ? volunteer.otherLanguage : labelOf(LANGUAGES, value),
  );
  return names.length ? names.join(", ") : "—";
};

const MISSING_TEXT = Object.freeze({ form13615: "Form 13615 missing", photoId: "Photo ID check missing" });

const clearedCell = (volunteer) =>
  volunteer.cleared === true
    ? `<span class="volunteer-cleared">Cleared</span>`
    : `<span class="volunteer-not-cleared">Not cleared</span> <span class="muted">${esc(
        (volunteer.missing ?? []).map((item) => MISSING_TEXT[item] ?? item).join(", "),
      )}</span>`;

function volunteerRow(volunteer) {
  const contact = [volunteer.email, volunteer.phone].filter(Boolean).join(" · ");
  return `<tr class="volunteer-row"><th scope="row"><span class="volunteer-name">${esc(volunteer.name)}</span>${when(
    REMOTE_WORKS.includes(volunteer.works),
    ` <span class="remote-badge">Remote</span>`,
  )}<span class="volunteer-contact">${esc(contact)}</span></th><td>${chips(
    volunteer.roles,
    ROLES,
    "No roles recorded",
  )}</td><td>${chips(volunteer.certificates, CERTIFICATES, "None recorded")}</td><td>${esc(
    languagesText(volunteer),
  )}</td><td>${clearedCell(volunteer)}</td><td>${button(
    "Edit",
    "open-edit-volunteer",
    "secondary",
    `data-volunteer-id="${esc(volunteer.id)}" aria-label="Edit ${esc(volunteer.name)}"`,
  )}</td></tr>`;
}

function toolbar(filters) {
  const role = filters.role || "all";
  const options = [{ value: "all", label: "All roles" }, ...ROLES]
    .map(
      (entry) =>
        `<option value="${esc(entry.value)}"${entry.value === role ? " selected" : ""}>${esc(entry.label)}</option>`,
    )
    .join("");
  return `<div class="volunteer-toolbar"><label class="field pool-filter" for="volunteer-role-filter"><span>Role</span><select id="volunteer-role-filter" data-volunteer-filter="role">${options}</select></label><input id="volunteer-search" name="volunteerSearch" type="search" value="${esc(
    filters.search ?? "",
  )}" placeholder="Search name, email or phone" aria-label="Search volunteers" autocomplete="off"></div>`;
}

/**
 * The Roster's panel: the toolbar, the table and its count.
 *
 * @param {object[]} volunteers the combined list (`combineVolunteers`)
 * @param {object} ui `{list, filters}` — `list` is "loading", "failed" or "ready".
 */
export function renderRoster(volunteers, { list = "ready", filters = {} } = {}) {
  const open = `<section class="panel volunteer-roster" aria-labelledby="roster-title"><h2 id="roster-title">Roster</h2>`;
  if (list === "loading") return `${open}${loadingLine("Loading volunteers…")}</section>`;
  if (list === "failed") return `${open}${unloadedLine("The volunteers couldn't load.")}</section>`;
  const all = Array.isArray(volunteers) ? volunteers : [];
  const chosen = { search: filters.search ?? "", role: filters.role || "all" };
  const shown = filterVolunteers(all, chosen);
  const body = shown.length
    ? `<div class="board-table-wrap"><table class="board-table people-table"><thead><tr><th scope="col">Volunteer</th><th scope="col">Roles</th><th scope="col">Certificates</th><th scope="col">Languages</th><th scope="col">Cleared</th><th scope="col">Edit</th></tr></thead><tbody>${shown
        .map(volunteerRow)
        .join("")}</tbody></table></div>`
    : emptyLine(all.length ? "Nobody matches." : "No volunteers yet.");
  return `${open}${toolbar(chosen)}${body}<p class="board-foot" role="status">${shown.length} of ${all.length} volunteers</p></section>`;
}

const ticks = (name, list, chosen, { full = false } = {}) =>
  list
    .map((entry) => {
      const id = `volunteer-${name}-${entry.value}`;
      const text = full && entry.full !== entry.label ? `${entry.label} · ${entry.full}` : entry.label;
      return `<label class="checkbox-row small" for="${id}"><input type="checkbox" name="${name}" value="${esc(
        entry.value,
      )}"${chosen.includes(entry.value) ? " checked" : ""} id="${id}"><span>${esc(text)}</span></label>`;
    })
    .join("");

const tickRow = (name, text, on) =>
  `<label class="checkbox-row small" for="volunteer-${name}"><input type="checkbox" name="${name}" id="volunteer-${name}"${
    on ? " checked" : ""
  }><span>${esc(text)}</span></label>`;

/**
 * The Add / Edit drawer's body. Add has no volunteer; an Edit whose volunteer
 * is no longer listed says so and offers Close, never a blank form.
 *
 * @param {object} args `{volunteer, isNew, ui}` — `ui` is
 *   `{busy, error, retryable, formError}`.
 */
export function volunteerDrawerBody({ volunteer = null, isNew = false, ui = {} } = {}) {
  if (!isNew && !volunteer)
    return `${drawerError(ui, VOLUNTEER_CONFLICT_HEADING)}<p>This volunteer could not be opened. Close this and try again.</p>${button(
      "Close",
      "close-dialog",
      "secondary",
    )}`;
  const v = volunteer ?? {};
  const works = v.works || "on_site";
  const languages = v.languages ?? [];
  const otherOpen = languages.includes("other");
  const locked = !isNew && v.hasSignIn === true;
  const worksRadios = WORKS.map((entry) => {
    const id = `volunteer-works-${entry.value}`;
    return `<label class="checkbox-row small" for="${id}"><input type="radio" name="works" value="${esc(
      entry.value,
    )}"${entry.value === works ? " checked" : ""} id="${id}"><span>${esc(entry.label)}</span></label>`;
  }).join("");
  const fields = `<label class="field" for="volunteer-name"><span>Name</span><input id="volunteer-name" name="name" type="text" value="${esc(
    v.name ?? "",
  )}" maxlength="80" autocomplete="off"></label><label class="field" for="volunteer-email"><span>Email</span><input id="volunteer-email" name="email" type="email" value="${esc(
    v.email ?? "",
  )}" maxlength="254" autocomplete="off"${locked ? ' readonly aria-describedby="volunteer-email-note"' : ""}></label>${when(
    locked,
    `<p class="field-note" id="volunteer-email-note">This is their sign-in email.</p>`,
  )}<label class="field" for="volunteer-phone"><span>Phone (optional)</span><input id="volunteer-phone" name="phone" type="tel" value="${esc(
    v.phone ?? "",
  )}" maxlength="30" autocomplete="off"></label><fieldset class="check-group"><legend>Works</legend>${worksRadios}</fieldset><fieldset class="check-group"><legend>Languages</legend>${ticks(
    "language",
    LANGUAGES,
    languages,
  )}</fieldset><label class="field" id="volunteer-other-language" for="volunteer-other-language-input"${
    otherOpen ? "" : " hidden"
  }><span>Other language</span><input id="volunteer-other-language-input" name="otherLanguage" type="text" value="${esc(
    v.otherLanguage ?? "",
  )}" maxlength="40" autocomplete="off"></label><fieldset class="check-group"><legend>Roles</legend>${ticks(
    "role",
    ROLES,
    v.roles ?? [],
  )}</fieldset><fieldset class="check-group"><legend>Certificates</legend>${ticks(
    "certificate",
    CERTIFICATES,
    v.certificates ?? [],
    { full: true },
  )}</fieldset><fieldset class="check-group"><legend>Clearance</legend>${tickRow(
    "isNew",
    "New volunteer",
    isNew ? true : v.isNew === true,
  )}${tickRow("photoIdChecked", "Photo ID checked", v.photoIdChecked === true)}</fieldset>`;
  const formError = ui?.formError
    ? `<p class="notice error" role="alert" id="volunteer-form-error">${icon("help")}<span>${esc(ui.formError)}</span></p>`
    : "";
  return `<form id="volunteer-form" class="staff-form" novalidate>${fields}${formError}${drawerError(
    ui,
    VOLUNTEER_CONFLICT_HEADING,
  )}<div class="drawer-actions"><button type="submit" class="btn primary"${ui?.busy ? " disabled" : ""}>${
    isNew ? "Add a volunteer" : "Save"
  }</button>${button("Cancel", "close-dialog", "text")}</div></form>`;
}
