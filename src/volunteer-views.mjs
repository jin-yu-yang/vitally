// The admin-only Roster (change add-volunteer-roster-records, design D9): the
// Volunteers page and its Add / Edit drawer. Staff screens stay English. Each
// row says whether the volunteer is cleared (change add-volunteer-clearance).
import { esc, button, icon, SENT_DAY, loadingLine, unloadedLine, emptyLine, confirmBody } from "./ui.mjs";
import { drawerError } from "./office-views.mjs";
import { ROLES, CERTIFICATES, WORKS, LANGUAGES, SHOW_VIEWS, filterVolunteers, languagesText, accountLabel, ACCOUNT_LABELS, returningFill } from "./volunteer-roster.mjs";

export { languagesText, accountLabel };

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

const MISSING_TEXT = Object.freeze({
  form13615: "Form 13615 missing",
  photoId: "Photo ID check missing",
  scCertificate: "SC certificate missing",
  noAccount: "No account yet",
  notSignedIn: "Hasn't signed in yet",
  deactivated: "Account deactivated",
});

// The name the volunteer gave at their site check, under the account status.
const signedInAs = (volunteer, className) =>
  volunteer?.signedInName ? `<span class="${className}">Signed in as ${esc(volunteer.signedInName)}</span>` : "";

// What a volunteer said they sent and nobody has marked reviewed yet.
const toReview = (volunteer) =>
  [
    volunteer.form13615SentAt != null ? "Form 13615 to review" : "",
    volunteer.photoIdSentAt != null ? "Photo ID to review" : "",
  ].filter(Boolean);

const clearedCell = (volunteer) => {
  const status =
    volunteer.cleared === true
      ? `<span class="volunteer-cleared">Cleared</span>`
      : `<span class="volunteer-not-cleared">Not cleared</span> <span class="muted">${esc(
          (volunteer.missing ?? []).map((item) => MISSING_TEXT[item] ?? item).join(", "),
        )}</span>`;
  const review = toReview(volunteer);
  return review.length ? `${status} <span class="volunteer-to-review">${esc(review.join(", "))}</span>` : status;
};

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

function toolbar(filters, { exportable = false, empty = false } = {}) {
  const role = filters.role || "all";
  const show = SHOW_VIEWS.find((entry) => entry.value === filters.show)?.value ?? "all";
  const showOptions = SHOW_VIEWS.map(
    (entry) => `<option value="${esc(entry.value)}"${entry.value === show ? " selected" : ""}>${esc(entry.label)}</option>`,
  ).join("");
  const options = [{ value: "all", label: "All roles" }, ...ROLES]
    .map(
      (entry) =>
        `<option value="${esc(entry.value)}"${entry.value === role ? " selected" : ""}>${esc(entry.label)}</option>`,
    )
    .join("");
  return `<div class="volunteer-toolbar"><label class="field pool-filter" for="volunteer-role-filter"><span>Role</span><select id="volunteer-role-filter" data-volunteer-filter="role">${options}</select></label><label class="field pool-filter" for="volunteer-show-filter"><span>Show</span><select id="volunteer-show-filter" data-volunteer-filter="show">${showOptions}</select></label><input id="volunteer-search" name="volunteerSearch" type="search" value="${esc(
    filters.search ?? "",
  )}" placeholder="Search name, email or phone" aria-label="Search volunteers" autocomplete="off">${when(
    exportable,
    button("Export CSV", "export-roster-csv", "secondary volunteer-export", empty ? "disabled" : ""),
  )}</div>`;
}

/**
 * The Roster's panel: the toolbar, the table and its count.
 *
 * @param {object[]} volunteers the combined list (`combineVolunteers`)
 * @param {object} ui `{list, filters, exportable}` — `list` is "loading",
 *   "failed" or "ready"; `exportable` adds Export CSV, off while no row passes
 *   the filters.
 */
export function renderRoster(volunteers, { list = "ready", filters = {}, exportable = false } = {}) {
  const open = `<section class="panel volunteer-roster" aria-labelledby="roster-title"><h2 id="roster-title">Roster</h2>`;
  if (list === "loading") return `${open}${loadingLine("Loading volunteers…")}</section>`;
  if (list === "failed") return `${open}${unloadedLine("The volunteers couldn't load.")}</section>`;
  const all = Array.isArray(volunteers) ? volunteers : [];
  const chosen = { search: filters.search ?? "", role: filters.role || "all", show: filters.show || "all" };
  const shown = filterVolunteers(all, chosen);
  const body = shown.length
    ? `<div class="board-table-wrap"><table class="board-table people-table"><thead><tr><th scope="col">Volunteer</th><th scope="col">Roles</th><th scope="col">Certificates</th><th scope="col">Languages</th><th scope="col">Account</th><th scope="col">Cleared</th><th scope="col">Edit</th></tr></thead><tbody>${shown
        .map(volunteerRow)
        .join("")}</tbody></table></div>`
    : emptyLine(all.length ? "Nobody matches." : "No volunteers yet.");
  return `${open}${toolbar(chosen, { exportable, empty: shown.length === 0 })}${body}<p class="board-foot" role="status">${shown.length} of ${all.length} volunteers</p></section>`;
}

// `locked` maps a value to the id of the note that says why its box is
// disabled. A disabled box is not sent with the form, so a ticked one is
// carried by a hidden input: its saved value goes back unchanged.
const ticks = (name, list, chosen, { full = false, locked = {} } = {}) =>
  list
    .map((entry) => {
      const id = `volunteer-${name}-${entry.value}`;
      const text = full && entry.full !== entry.label ? `${entry.label} · ${entry.full}` : entry.label;
      const note = locked[entry.value];
      const on = chosen.includes(entry.value);
      return `<label class="checkbox-row small" for="${id}"><input type="checkbox" name="${name}" value="${esc(
        entry.value,
      )}"${on ? " checked" : ""} id="${id}"${note ? ` disabled aria-describedby="${note}"` : ""}><span>${esc(
        text,
      )}</span></label>${when(note && on, `<input type="hidden" name="${name}" value="${esc(entry.value)}">`)}`;
    })
    .join("");

const tickRow = (name, text, on) =>
  `<label class="checkbox-row small" for="volunteer-${name}"><input type="checkbox" name="${name}" id="volunteer-${name}"${
    on ? " checked" : ""
  }><span>${esc(text)}</span></label>`;

// A "sent" line in the drawer with its Mark reviewed (design D7). The date is
// the New York day; an unreadable one leaves the line without it.
function sentLine(sentAt, name, document, busy = false) {
  const day = new Date(sentAt);
  const date = Number.isNaN(day.getTime()) ? "" : ` ${SENT_DAY.format(day)}`;
  return `<p class="volunteer-sent" data-document="${document}"><span>${name} sent${esc(date)}</span> ${button(
    "Mark reviewed",
    "mark-upload-reviewed",
    "secondary",
    `data-document="${document}"${busy ? " disabled" : ""}`,
  )}</p>`;
}

// The reasons an admin can pick when sending a document back (change
// add-my-profile, D7). "Already on file" is for a Form 13615 of a volunteer
// with a role this season.
const REVIEW_PICKS = {
  form13615: ["Not signed", "Can't read it", "Wrong form", "Missing a certification"],
  photoId: ["Can't read it", "Expired", "Not a photo ID"],
};
const DAYS = [
  ["mon", "Monday"],
  ["tue", "Tuesday"],
  ["wed", "Wednesday"],
  ["thu", "Thursday"],
  ["fri", "Friday"],
  ["sat", "Saturday"],
  ["sun", "Sunday"],
];

// The reason row Mark reviewed opens: quick picks, a note, Send back and
// Cancel. Send back stays off until a pick or a note; the page turns it on.
export function reasonRow(document, { hasRole = false, busy = false } = {}) {
  const picks = [...(REVIEW_PICKS[document] ?? []), ...(document === "form13615" && hasRole ? ["Already on file"] : [])];
  const radios = picks
    .map((text, index) => {
      const id = `volunteer-review-${document}-${index}`;
      return `<label class="checkbox-row small" for="${id}"><input type="radio" name="review-reason" value="${esc(text)}" id="${id}"><span>${esc(text)}</span></label>`;
    })
    .join("");
  const note = `volunteer-review-note-${document}`;
  return `<fieldset class="check-group volunteer-review" data-document="${document}"><legend>Why send it back?</legend>${radios}<label class="field" for="${note}"><span>Or write a note</span><input id="${note}" name="review-note" type="text" maxlength="120" autocomplete="off"></label><div class="drawer-actions">${button(
    "Send back",
    "send-back",
    "primary",
    `data-document="${document}" disabled`,
  )}${button("Cancel", "cancel-review", "text", `data-document="${document}"${busy ? " disabled" : ""}`)}</div></fieldset>`;
}

// The document's place in the drawer: its sent line (with the reason row when
// Mark reviewed was pressed), else what the office last said about it.
function documentLine(v, document, ui) {
  const sentAt = v[`${document}SentAt`];
  const name = document === "form13615" ? "Form 13615" : "Photo ID";
  if (sentAt != null)
    return (
      sentLine(sentAt, name, document, ui?.busy === true) +
      when(
        ui?.reviewReasonFor === document,
        reasonRow(document, { hasRole: (v.roles ?? []).length > 0, busy: ui?.busy === true }),
      )
    );
  const reason = v[`${document}ReviewReason`];
  if (!reason) return "";
  const day = new Date(v[`${document}ReviewedAt`]);
  const date = Number.isNaN(day.getTime()) ? "" : ` · ${SENT_DAY.format(day)}`;
  return `<p class="volunteer-sent" data-document="${document}"><span>Last returned: ${esc(reason)}${esc(date)}</span></p>`;
}

// The drawer's Account section: the status and the one or two actions it
// allows. A volunteer who is not saved yet has none. `notice` is the last
// result, `{kind: "ok" | "error", text}`.
// Create account sends the saved profile, so it waits while the form has
// unsaved changes: the page turns it off and shows the hint as the form is
// edited (`volunteerFormChanged`).
// Deactivating a site coordinator's account needs a site coordinator (change
// add-season-settings): for anyone else the drawer says so instead.
function accountSection(volunteer, notice, { viewerIsSiteCoordinator = true } = {}) {
  const status = volunteer?.account?.status ?? "none";
  const id = `data-volunteer-id="${esc(volunteer.id)}"`;
  const deactivate =
    volunteer?.isSiteCoordinator === true && !viewerIsSiteCoordinator
      ? `<p class="field-note" id="volunteer-deactivate-note">${esc(
          "Only site coordinators deactivate a site coordinator's account.",
        )}</p>`
      : button("Deactivate", "account-deactivate", "secondary", id);
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
    )}${deactivate}`,
    active: deactivate,
    deactivated: `${button("Reactivate", "account-reactivate", "secondary", id)}${when(
      !notice?.text,
      `<p class="field-note" id="volunteer-reactivate-note">Reactivate so they can sign in.</p>`,
    )}`,
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

// Remove from this season's roster (change add-remove-from-roster). The drawer
// offers it to any admin, except that a site coordinator, or someone holding
// the Admin role this season, is removed only by a site coordinator.
const ADMIN_ROLE_SENTENCE = "Only site coordinators change the Admin role.";
function removeSection(volunteer, { viewerIsSiteCoordinator = true } = {}) {
  const id = `data-volunteer-id="${esc(volunteer.id)}"`;
  const note = (text) => `<p class="field-note" id="volunteer-remove-note">${esc(text)}</p>`;
  let action = button("Remove from this season's roster…", "volunteer-remove", "secondary", id);
  if (!viewerIsSiteCoordinator) {
    if (volunteer.isSiteCoordinator === true) action = note("Only site coordinators remove a site coordinator from the roster.");
    else if ((volunteer.roles ?? []).includes("admin")) action = note(ADMIN_ROLE_SENTENCE);
  }
  return `<div class="drawer-actions volunteer-remove">${action}</div>`;
}

/**
 * The remove-from-roster confirmation: nothing changes until its confirm
 * button is pressed. `error` is the refusal the last attempt got.
 */
export function removeFromRosterDialogBody({ volunteer = null, error = null } = {}) {
  const name = volunteer?.name ?? "this volunteer";
  const email = volunteer?.email ?? "";
  const status = volunteer?.account?.status ?? "none";
  const accountLine =
    status === "deactivated"
      ? "Their account is already deactivated."
      : status === "none"
        ? ""
        : volunteer?.isSiteCoordinator === true
          ? "Their account stays active because they are a site coordinator, but they will have no roles this season."
          : "Their account is deactivated, so they can no longer sign in.";
  const lead = [
    `${name} (${email}) comes off this season's roster, with their roles, certificates and the record of what they sent this season.`,
    accountLine,
    `Their cases and contact details are kept. To add them back, search for ${email} in Add a volunteer.`,
  ]
    .filter(Boolean)
    .map((line) => esc(line))
    .join(" ");
  const refusal = error
    ? `<p class="notice error" role="alert" id="remove-from-roster-error">${icon("help")}<span>${esc(error)}</span></p>`
    : "";
  return confirmBody({
    before: refusal,
    lead,
    confirm: button("Remove from roster", "confirm-remove-from-roster", "primary full"),
    keep: "Cancel",
  });
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
    lead: `The invitation for ${who} will be cancelled and it will no longer give them access. ${
      volunteer ? "The email can be edited again, and you" : "You"
    } can invite them again later.`,
    confirm: button("Cancel invitation", "confirm-cancel-invitation", "primary full"),
    keep: "Keep invitation",
  });
}

// The Add drawer's returning-volunteer picker (change
// add-returning-volunteers-and-roster-csv): a search over the earlier
// volunteers, each a button that fills the drawer; once one is picked, their
// name and Not this person. It sits before the form, so its search box is not
// one of the form's fields.
function returningPicker(returning, picked) {
  if (picked)
    return `<div class="returning-picked"><span class="returning-person-info"><strong>${esc(
      picked.name,
    )}</strong><span class="volunteer-contact">${esc(picked.email)}</span></span>${button(
      "Not this person",
      "unpick-returning-volunteer",
      "secondary",
    )}</div>`;
  const query = String(returning?.query ?? "");
  const candidates = returning?.candidates ?? [];
  const list = candidates.length
    ? `<ul class="returning-list">${candidates
        .map(
          (entry) =>
            `<li><button type="button" class="returning-person" data-action="pick-returning-volunteer" data-id="${esc(
              entry.id,
            )}"><span class="returning-person-info"><span class="volunteer-name">${esc(
              entry.name,
            )}</span><span class="volunteer-contact">${esc(entry.email)}</span></span>${when(
              entry.earlier === true,
              `<span class="remote-badge">Earlier volunteer</span>`,
            )}</button></li>`,
        )
        .join("")}</ul>`
    : when(query.trim(), emptyLine("Nobody matches."));
  return `<div class="returning-picker"><label class="field" for="returning-search"><span>Returning volunteer? Search last season's roster</span><input id="returning-search" name="returningSearch" type="search" value="${esc(
    query,
  )}" placeholder="Search name or email" autocomplete="off"></label>${list}</div>`;
}

/**
 * The Add / Edit drawer's body. Add has no volunteer; an Edit whose volunteer
 * is no longer listed says so and offers Close, never a blank form.
 *
 * @param {object} args `{volunteer, isNew, ui, canChangeAdmin}` — `ui` is
 *   `{busy, error, retryable, formError}`. `canChangeAdmin` is false for a
 *   caller who is not a site coordinator: the Admin tick is then disabled,
 *   showing its saved state, and a site coordinator's account offers no
 *   Deactivate (change add-season-settings). `returning` (Add only) is
 *   `{query, candidates, picked}` for the returning-volunteer picker, or null;
 *   with `picked`, the form is filled from that person and New volunteer is
 *   left unticked.
 */
export function volunteerDrawerBody({ volunteer = null, isNew = false, ui = {}, canChangeAdmin = true, returning = null } = {}) {
  if (!isNew && !volunteer)
    return `${drawerError(ui, VOLUNTEER_CONFLICT_HEADING)}<p>This volunteer could not be opened. Close this and try again.</p>${button(
      "Close",
      "close-dialog",
      "secondary",
    )}`;
  const picked = isNew ? (returning?.picked ?? null) : null;
  const v = volunteer ?? (picked ? returningFill(picked) : {});
  const works = v.works || "on_site";
  const languages = v.languages ?? [];
  const otherOpen = languages.includes("other");
  // A picked earlier volunteer keeps their email: it is who they are.
  const signInEmail = (!isNew || picked) && v.hasSignIn === true;
  const locked = signInEmail || Boolean(picked);
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
  )}" maxlength="254" autocomplete="off"${locked ? " readonly" : ""}${signInEmail ? ' aria-describedby="volunteer-email-note"' : ""}></label>${when(
    signInEmail,
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
  )}" maxlength="40" autocomplete="off"></label><fieldset class="check-group"><legend>Usual days</legend>${DAYS.map(([value, label]) => {
    const id = `volunteer-usualDays-${value}`;
    return `<label class="checkbox-row small" for="${id}"><input type="checkbox" name="usualDays" value="${value}"${(v.usualDays ?? []).includes(value) ? " checked" : ""} id="${id}"><span>${label}</span></label>`;
  }).join("")}</fieldset><fieldset class="check-group"><legend>Roles</legend>${ticks(
    "role",
    ROLES,
    v.roles ?? [],
    { locked: canChangeAdmin ? {} : { admin: "volunteer-admin-note" } },
  )}${when(
    !canChangeAdmin,
    `<p class="field-note" id="volunteer-admin-note">${ADMIN_ROLE_SENTENCE}</p>`,
  )}</fieldset>${when(!isNew, documentLine(v, "form13615", ui))}<fieldset class="check-group"><legend>Certificates</legend>${ticks(
    "certificate",
    CERTIFICATES,
    v.certificates ?? [],
    { full: true },
  )}</fieldset><fieldset class="check-group"><legend>Clearance</legend>${tickRow(
    "isNew",
    "New volunteer",
    isNew && !picked ? true : v.isNew === true,
  )}${tickRow("photoIdChecked", "Photo ID checked", v.photoIdChecked === true)}${when(!isNew, documentLine(v, "photoId", ui))}</fieldset>${when(!isNew && volunteer, accountSection(v, ui?.accountNotice, { viewerIsSiteCoordinator: canChangeAdmin }))}${when(!isNew && volunteer, removeSection(v, { viewerIsSiteCoordinator: canChangeAdmin }))}`;
  const formError = ui?.formError
    ? `<p class="notice error" role="alert" id="volunteer-form-error">${icon("help")}<span>${esc(ui.formError)}</span></p>`
    : "";
  // Filled by the app when a certificate change unticks roles (#192), so a
  // screen reader hears it; empty on every draw.
  const roleNotice = `<p class="sr-only" role="status" aria-live="polite" id="volunteer-role-notice"></p>`;
  return `${when(isNew && returning, returningPicker(returning, picked))}<form id="volunteer-form" class="staff-form" novalidate>${fields}${roleNotice}${formError}${drawerError(
    ui,
    VOLUNTEER_CONFLICT_HEADING,
  )}<div class="drawer-actions"><button type="submit" class="btn primary"${ui?.busy ? " disabled" : ""}>${
    isNew ? "Add a volunteer" : "Save"
  }</button>${button("Cancel", "close-dialog", "text")}</div></form>`;
}
