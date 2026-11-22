// My profile (change add-my-profile, design D9): a cleared staff member's own
// details, the office's records read-only, and the Form 13615 they send again.
// Staff text, English only. Pure: `state.myProfile` is the
// `vitally_my_profile()` answer, and `state.myShifts` the `vitally_my_shifts()`
// one (change add-volunteer-schedule).
import { esc, button, icon, SENT_DAY, loadingLine, unloadedLine } from "./ui.mjs";
import { reviewLine } from "./clearance.mjs";
import { ROLES, CERTIFICATES, WORKS, LANGUAGES } from "./volunteer-roster.mjs";
import { accountLabel } from "./volunteer-views.mjs";
import { shiftLine } from "./volunteer-schedule.mjs";

const when = (condition, html) => (condition ? html : "");
const labelOf = (list, value) => list.find((entry) => entry.value === value)?.label ?? value;

const DAYS = Object.freeze([
  ["mon", "Monday"],
  ["tue", "Tuesday"],
  ["wed", "Wednesday"],
  ["thu", "Thursday"],
  ["fri", "Friday"],
  ["sat", "Saturday"],
  ["sun", "Sunday"],
]);

const frame = (body) =>
  `<main id="main" class="narrow" tabindex="-1"><div class="page-intro"><span class="overline">MY PROFILE</span><h1>My profile</h1></div>${body}</main>`;

const field = (id, label, name, value, { type = "text", maxlength = 80, extra = "" } = {}) =>
  `<label class="field" for="${id}"><span>${label}</span><input id="${id}" name="${name}" type="${type}" value="${esc(
    value ?? "",
  )}" maxlength="${maxlength}" autocomplete="off"${extra}></label>`;

const choices = (type, name, list, chosen) =>
  list
    .map((entry) => {
      const id = `my-profile-${name}-${entry.value}`;
      return `<label class="checkbox-row small" for="${id}"><input type="${type}" name="${name}" value="${esc(
        entry.value,
      )}"${chosen.includes(entry.value) ? " checked" : ""} id="${id}"><span>${esc(entry.label)}</span></label>`;
    })
    .join("");

function detailsSection(p, busy) {
  const languages = p.languages ?? [];
  const works = p.works || "on_site";
  const days = DAYS.map(([value, label]) => ({ value, label }));
  return `<section class="panel my-profile-section" id="my-profile-details" aria-labelledby="my-profile-details-title"><h2 id="my-profile-details-title">Your details</h2><form id="my-profile-form" class="staff-form" novalidate>${field(
    "my-profile-name",
    "Name",
    "name",
    p.name,
  )}${field("my-profile-email", "Email", "email", p.email, {
    type: "email",
    maxlength: 254,
    extra: ' readonly aria-describedby="my-profile-email-note"',
  })}<p class="field-note" id="my-profile-email-note">Your email is how you sign in. Only a site coordinator can change it.</p><p class="my-profile-status"><span class="muted">Account</span> <strong>${esc(
    accountLabel({ account: { status: p.accountStatus } }),
  )}</strong></p>${field("my-profile-phone", "Phone (optional)", "phone", p.phone, {
    type: "tel",
    maxlength: 30,
  })}<fieldset class="check-group"><legend>Works</legend>${choices("radio", "works", WORKS, [works])}</fieldset><fieldset class="check-group"><legend>Languages</legend>${choices(
    "checkbox",
    "languages",
    LANGUAGES,
    languages,
  )}</fieldset><label class="field" id="my-profile-other-language" for="my-profile-other-language-input"${when(
    !languages.includes("other"),
    " hidden",
  )}><span>Other language</span><input id="my-profile-other-language-input" name="otherLanguage" type="text" value="${esc(
    p.otherLanguage ?? "",
  )}" maxlength="40" autocomplete="off"></label><fieldset class="check-group"><legend>Usual days</legend>${choices(
    "checkbox",
    "usualDays",
    days,
    p.usualDays ?? [],
  )}</fieldset><div class="drawer-actions"><button type="submit" class="btn primary"${busy ? " disabled" : ""}>Save</button></div></form></section>`;
}

function seasonSection(p) {
  const list = (values, all, none) =>
    values?.length
      ? `<span class="volunteer-chips">${values
          .map((value) => `<span class="volunteer-chip">${esc(labelOf(all, value))}</span>`)
          .join("")}</span>`
      : `<span class="muted">${none}</span>`;
  return `<section class="panel my-profile-section" id="my-profile-season" aria-labelledby="my-profile-season-title"><h2 id="my-profile-season-title">This season</h2><p class="muted">Managed by the office</p><p><span class="muted">Roles</span> ${list(
    p.roles,
    ROLES,
    "No roles this season",
  )}</p><p><span class="muted">Certificates</span> ${list(p.certificates, CERTIFICATES, "None confirmed")}</p></section>`;
}

// Your shifts this week (change add-volunteer-schedule, design D8): read on
// its own (`state.myShifts`, the `vitally_my_shifts()` answer), so a failed
// read is said here and the rest of the page still draws.
function shiftsSection(state) {
  const list = state?.lists?.myShifts ?? "loading";
  const shifts = state?.myShifts?.shifts ?? null;
  const body =
    list === "failed"
      ? unloadedLine("Your shifts couldn't load.")
      : !shifts
        ? loadingLine("Loading your shifts…")
        : shifts.length
          ? `<ul class="my-profile-shifts">${shifts.map((shift) => `<li>${esc(shiftLine(shift))}</li>`).join("")}</ul>`
          : `<p class="muted">No shifts this week.</p>`;
  return `<section class="panel my-profile-section" id="my-profile-shifts" aria-labelledby="my-profile-shifts-title"><h2 id="my-profile-shifts-title">Your shifts this week</h2>${body}</section>`;
}

function sendSection(p, busy) {
  const item = p.form13615 ?? null;
  const sentAt = item?.sentAt ?? null;
  const day = sentAt ? new Date(sentAt) : null;
  const upload = p.uploadUrl
    ? `<a class="btn secondary" href="${esc(p.uploadUrl)}" target="_blank" rel="noopener">Upload</a>`
    : "";
  const sent = sentAt
    ? `<span>Waiting for review${Number.isNaN(day.getTime()) ? "" : ` · sent ${esc(SENT_DAY.format(day))}`}</span>`
    : button(
        "I've uploaded it",
        "mark-upload-sent",
        "primary",
        `data-document="form13615" aria-describedby="my-profile-send-title"${busy ? " disabled" : ""}`,
      );
  const why = item ? reviewLine({ document: "form13615", sentAt, reviewReason: item.reviewReason }) : null;
  return `<section class="panel my-profile-section" id="my-profile-send" aria-labelledby="my-profile-send-title"><h2 id="my-profile-send-title">Passed a higher certification? Send your new Form 13615</h2>${
    why ? `<p class="setup-reason">${esc(why)}</p>` : ""
  }<div class="setup-upload">${upload} ${sent}</div></section>`;
}

export function myProfilePage(state) {
  const p = state?.myProfile ?? null;
  const list = state?.lists?.myProfile ?? "loading";
  // A failed read, or none yet: no Save form, which could only do nothing.
  if (!p || list === "failed") {
    if (list === "failed") return frame(unloadedLine("My profile couldn't load."));
    return frame(loadingLine("Loading My profile…"));
  }
  const busy = state?.busy === true;
  return frame(`${detailsSection(p, busy)}${seasonSection(p)}${shiftsSection(state)}${sendSection(p, busy)}`);
}
