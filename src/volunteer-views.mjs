// The admin-only Roster (change add-volunteer-roster-records, design D9): the
// Volunteers page and its Add / Edit drawer. Staff screens stay English. Each
// row says whether the volunteer is cleared (change add-volunteer-clearance).
import { esc, button, icon, loadingLine, unloadedLine, emptyLine, confirmBody } from "./ui.mjs";
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

const MISSING_TEXT = Object.freeze({
  form13615: "Form 13615 missing",
  photoId: "Photo ID check missing",
  noAccount: "No account yet",
  notSignedIn: "Hasn't signed in yet",
  deactivated: "Account deactivated",
});

const ACCOUNT_LABELS = Object.freeze({
  none: "Not created",
  invited: "Invited",
  active: "Active",
  deactivated: "Deactivated",
});
const accountLabel = (volunteer) => ACCOUNT_LABELS[volunteer?.account?.status ?? "none"] ?? "Not created";

// The name the volunteer gave at their site check, under the account status.
const signedInAs = (volunteer, className) =>
  volunteer?.signedInName ? `<span class="${className}">Signed in as ${esc(volunteer.signedInName)}</span>` : "";

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
  )}</td><td>${esc(accountLabel(volunteer))}${signedInAs(volunteer, "volunteer-signed-in")}</td><td>${clearedCell(volunteer)}</td><td>${button(
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
    ? `<div class="board-table-wrap"><table class="board-table people-table"><thead><tr><th scope="col">Volunteer</th><th scope="col">Roles</th><th scope="col">Certificates</th><th scope="col">Languages</th><th scope="col">Account</th><th scope="col">Cleared</th><th scope="col">Edit</th></tr></thead><tbody>${shown
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

// The drawer's Account section: the status and the one or two actions it
// allows. A volunteer who is not saved yet has none. `notice` is the last
// result, `{kind: "ok" | "error", text}`.
// Create account sends the saved profile, so it waits while the form has
// unsaved changes: the page turns it off and shows the hint as the form is
// edited (`volunteerFormChanged`).
function accountSection(volunteer, notice) {
  const status = volunteer?.account?.status ?? "none";
  const id = `data-volunteer-id="${esc(volunteer.id)}"`;
  // An invitation nobody has used yet can be taken back; one that was ever
  // active cannot.
  const cancellable = volunteer?.account?.activatedAt == null;
  const actions = {
    none: `${button(
      "Create account",
      "account-create",
      "secondary",
      `${id} aria-describedby="volunteer-account-hint"`,
    )}<p class="field-note" id="volunteer-account-hint" hidden>Save your changes first.</p>`,
    invited: `${button("Resend", "account-resend", "secondary", id)}${when(
      cancellable,
      button("Cancel invitation", "account-cancel-invitation", "secondary", id),
    )}${button("Deactivate", "account-deactivate", "secondary", id)}`,
    active: button("Deactivate", "account-deactivate", "secondary", id),
    deactivated: button("Reactivate", "account-reactivate", "secondary", id),
  }[status];
  const said = notice?.text
    ? `<p class="notice ${notice.kind === "error" ? "error" : "info"}" role="${notice.kind === "error" ? "alert" : "status"}" id="volunteer-account-notice">${icon(
        notice.kind === "error" ? "help" : "check",
      )}<span>${esc(notice.text)}</span></p>`
    : "";
  return `<fieldset class="check-group volunteer-account"><legend>Account</legend><p>Status: <strong>${esc(
    ACCOUNT_LABELS[status] ?? "Not created",
  )}</strong></p>${when(
    volunteer?.signedInName,
    `<p class="volunteer-signed-in">Signed in as ${esc(volunteer?.signedInName ?? "")}</p>`,
  )}${said}<div class="drawer-actions">${actions}</div></fieldset>`;
}

/**
 * The deactivate confirmation: shown from the drawer, it changes nothing
 * until its confirm button is pressed.
 */
export function deactivateAccountDialogBody({ volunteer = null } = {}) {
  const name = volunteer?.name ?? "this volunteer";
  return confirmBody({
    lead: `${esc(name)} will no longer be able to open ViTally. Their roster entry and their work stay as they are, and you can reactivate the account later.`,
    confirm: button("Deactivate account", "confirm-deactivate-account", "primary full"),
    keep: "Keep account",
  });
}

/**
 * The question before an invitation is sent (Create account, Invite). The
 * question itself, naming the email, is the dialog's title
 * (`sendInvitationTitle`); nothing is sent until Send is pressed.
 */
export const sendInvitationTitle = (email) => `Send a sign-in invitation to ${email}?`;

export function sendInvitationDialogBody() {
  return confirmBody({
    confirm: button("Send", "confirm-send-invitation", "primary full"),
    keep: "Cancel",
  });
}

/**
 * The cancel-invitation confirmation, from the drawer (`volunteer`) or the
 * office list (`email` only). Nothing changes until its confirm is pressed.
 */
export function cancelInvitationDialogBody({ volunteer = null, email = "" } = {}) {
  const address = volunteer?.email ?? email;
  const who = volunteer ? `${esc(volunteer.name)} (${esc(address)})` : esc(address);
  return confirmBody({
    lead: `The invitation for ${who} will be cancelled and its sign-in code will no longer work. ${
      volunteer ? "The email can be edited again, and you" : "You"
    } can invite them again later.`,
    confirm: button("Cancel invitation", "confirm-cancel-invitation", "primary full"),
    keep: "Keep invitation",
  });
}

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
  )}${tickRow("photoIdChecked", "Photo ID checked", v.photoIdChecked === true)}</fieldset>${when(!isNew && volunteer, accountSection(v, ui?.accountNotice))}`;
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
