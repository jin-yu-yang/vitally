// Pure logic for the admin-only volunteer Roster: lists, combining, search, form reading, validation.
import { EMAIL_PATTERN } from "./auth.mjs";
import { toCsv } from "./csv.mjs";

export const ROLES = [
  { value: "greeter", label: "Greeter" },
  { value: "intaker", label: "Intaker" },
  { value: "preparer", label: "Preparer" },
  { value: "reviewer", label: "Reviewer" },
  { value: "admin", label: "Admin" }
];

export const CERTIFICATES = [
  { value: "vsc", label: "VSC", full: "Volunteer Standards of Conduct" },
  { value: "itqr", label: "IT&QR", full: "Intake/Interview & Quality Review" },
  { value: "sc", label: "SC", full: "Site Coordinator" },
  { value: "basic", label: "Basic", full: "Basic" },
  { value: "advanced", label: "Advanced", full: "Advanced" }
];

export const WORKS = [
  { value: "on_site", label: "On site" },
  { value: "remote", label: "Remote" },
  { value: "on_site_and_remote", label: "On site and remote" }
];

export const LANGUAGES = [
  { value: "english", label: "English" },
  { value: "mandarin", label: "Mandarin" },
  { value: "cantonese", label: "Cantonese" },
  { value: "other", label: "Other" }
];

// What each role needs, mirroring the table in migration 045: every
// certificate in `all`, and at least one of `oneOf` when it is not empty.
// Only confirmed certificates of the current season count.
export const ROLE_NEEDS = Object.freeze({
  greeter: { all: ["vsc"], oneOf: [] },
  intaker: { all: ["vsc", "itqr"], oneOf: [] },
  admin: { all: ["vsc", "itqr"], oneOf: [] },
  preparer: { all: ["vsc", "itqr"], oneOf: ["basic", "advanced"] },
  reviewer: { all: ["vsc", "itqr"], oneOf: ["basic", "advanced"] }
});

const labelOf = (list, value) => list.find((entry) => entry.value === value)?.label ?? value;

// The languages, with Other replaced by the language it names.
export const languagesText = (volunteer) => {
  const names = (volunteer.languages ?? []).map((value) =>
    value === "other" && volunteer.otherLanguage ? volunteer.otherLanguage : labelOf(LANGUAGES, value),
  );
  return names.length ? names.join(", ") : "—";
};

export const ACCOUNT_LABELS = Object.freeze({
  none: "Not created",
  invited: "Invited",
  active: "Active",
  deactivated: "Deactivated",
});
export const accountLabel = (volunteer) => ACCOUNT_LABELS[volunteer?.account?.status ?? "none"] ?? "Not created";

const certificateLabel = (value) => CERTIFICATES.find((c) => c.value === value)?.label ?? value;
const roleLabel = (value) => ROLES.find((r) => r.value === value)?.label ?? value;

// What a role still needs, as screen labels: "IT&QR", "Basic or Advanced".
export function missingFor(role, certificates) {
  const needs = ROLE_NEEDS[role];
  if (!needs) return [];
  const have = new Set(certificates ?? []);
  const missing = needs.all.filter((c) => !have.has(c)).map(certificateLabel);
  if (needs.oneOf.length && !needs.oneOf.some((c) => have.has(c))) {
    missing.push(needs.oneOf.map(certificateLabel).join(" or "));
  }
  return missing;
}

const NAME_MAX = 80;
const EMAIL_MAX = 254;
const PHONE_MAX = 30;
const OTHER_LANGUAGE_MAX = 40;

const ACCOUNT_MISSING = Object.freeze({ none: "noAccount", invited: "notSignedIn", deactivated: "deactivated" });

// Joins raw PostgREST rows into volunteers. Only people with a roster entry appear.
export function combineVolunteers({ profiles = [], entries = [], certificates = [], people = [], accounts = [] }) {
  const accountById = new Map(accounts.map((a) => [a.person_id, a]));
  const profileById = new Map(profiles.map((p) => [p.person_id, p]));
  const entryById = new Map(entries.map((e) => [e.person_id, e]));
  const certsById = new Map();
  const datesById = new Map();
  for (const c of certificates) {
    if (!certsById.has(c.person_id)) certsById.set(c.person_id, []);
    // An uploaded certificate has not been confirmed: it is not shown and counts for nothing.
    if (c.status === "confirmed") {
      certsById.get(c.person_id).push(c.certificate);
      if (c.confirmed_at != null) {
        if (!datesById.has(c.person_id)) datesById.set(c.person_id, {});
        datesById.get(c.person_id)[c.certificate] = c.confirmed_at;
      }
    }
  }
  const list = [];
  for (const person of people) {
    const entry = entryById.get(person.id);
    const profile = profileById.get(person.id);
    if (!entry || !profile) continue;
    const roles = [...(entry.roles ?? [])];
    const isNew = entry.is_new === true;
    const photoIdChecked = entry.photo_id_checked_at != null;
    const row = accountById.get(person.id);
    const account = {
      status: row?.status ?? "none",
      revision: row ? Number(row.revision) : null,
      activatedAt: row?.activated_at ?? null,
      expiresAt: row?.expires_at ?? null
    };
    // A site coordinator also needs SC confirmed this season (change add-season-settings, D6).
    const isSiteCoordinator = row?.is_site_coordinator === true;
    const scMissing = isSiteCoordinator && !(certsById.get(person.id) ?? []).includes("sc");
    const cleared = roles.length > 0 && (!isNew || photoIdChecked) && !scMissing && account.status === "active";
    // What the row waits for, in order: the Form 13615 (no roles) or the photo
    // ID, a site coordinator's SC certificate, then the account.
    const missing = roles.length === 0 ? ["form13615"] : !isNew || photoIdChecked ? [] : ["photoId"];
    if (scMissing) missing.push("scCertificate");
    if (account.status !== "active") missing.push(ACCOUNT_MISSING[account.status]);
    list.push({
      id: person.id,
      name: person.name,
      email: profile.email,
      phone: profile.phone ?? null,
      works: profile.works,
      languages: [...(profile.languages ?? [])],
      otherLanguage: profile.other_language ?? null,
      usualDays: [...(profile.usual_days ?? [])],
      roles,
      certificates: certsById.get(person.id) ?? [],
      // ISO confirmed_at of each confirmed certificate, for the CSV export.
      certificateDates: datesById.get(person.id) ?? {},
      revision: profile.revision,
      hasSignIn: Boolean(person.user_id),
      // The name the volunteer gave at their site check (migration 047).
      signedInName: profile.signed_in_name ?? null,
      isNew,
      photoIdChecked,
      // When the volunteer said they sent each document (migration 053); null before.
      form13615SentAt: entry.form_13615_sent_at ?? null,
      photoIdSentAt: entry.photo_id_sent_at ?? null,
      // What the office last said about each document (migration 057); null when unset.
      form13615ReviewedAt: entry.form_13615_reviewed_at ?? null,
      form13615ReviewReason: entry.form_13615_review_reason ?? null,
      photoIdReviewedAt: entry.photo_id_reviewed_at ?? null,
      photoIdReviewReason: entry.photo_id_review_reason ?? null,
      account,
      isSiteCoordinator,
      cleared,
      missing
    });
  }
  return list.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

// The Roster's Show select (change add-clearance-uploads, design D7).
export const SHOW_VIEWS = Object.freeze([
  { value: "all", label: "Everyone", keep: () => true },
  { value: "uploads", label: "Uploads to review", keep: (v) => v.form13615SentAt != null || v.photoIdSentAt != null },
]);

export function filterVolunteers(list, { search = "", role = "all", show = "all" } = {}) {
  const needle = String(search ?? "").trim().toLowerCase();
  const view = SHOW_VIEWS.find((entry) => entry.value === show) ?? SHOW_VIEWS[0];
  return list.filter((v) => {
    if (!view.keep(v)) return false;
    if (role && role !== "all" && !v.roles.includes(role)) return false;
    if (!needle) return true;
    return [v.name, v.email, v.phone].some((field) => String(field ?? "").toLowerCase().includes(needle));
  });
}

// Reads the drawer's FormData into the exact RPC payload.
export function volunteerFromForm(formData) {
  const text = (key) => String(formData.get(key) ?? "").trim();
  const languages = formData.getAll("language").map(String);
  const other = text("otherLanguage");
  return {
    name: text("name"),
    email: text("email").toLowerCase(),
    phone: text("phone") || null,
    works: text("works") || "on_site",
    languages,
    otherLanguage: languages.includes("other") ? other || null : null,
    roles: formData.getAll("role").map(String),
    certificates: formData.getAll("certificate").map(String),
    isNew: formData.get("isNew") != null,
    photoIdChecked: formData.get("photoIdChecked") != null,
    usualDays: formData.getAll("usualDays").map(String)
  };
}

// Whether the drawer's form holds something the saved volunteer does not:
// `payload` is `volunteerFromForm` of the form as it is now. Create account
// sends the saved profile, so it waits while this is true.
export function volunteerFormChanged(volunteer, payload) {
  if (!volunteer) return true;
  const same = (a, b) => JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...(b ?? [])].sort());
  return (
    payload.name !== (volunteer.name ?? "") ||
    payload.email !== String(volunteer.email ?? "").toLowerCase() ||
    (payload.phone ?? null) !== (volunteer.phone ?? null) ||
    payload.works !== (volunteer.works || "on_site") ||
    !same(payload.languages, volunteer.languages) ||
    (payload.otherLanguage ?? null) !== (volunteer.languages?.includes("other") ? volunteer.otherLanguage ?? null : null) ||
    !same(payload.roles, volunteer.roles) ||
    !same(payload.certificates, volunteer.certificates) ||
    payload.isNew !== (volunteer.isNew === true) ||
    payload.photoIdChecked !== (volunteer.photoIdChecked === true) ||
    !same(payload.usualDays, volunteer.usualDays)
  );
}

// The field rules the Roster drawer and My profile share (change
// add-my-profile): the same sentences, null when the fields are fine.
const nameProblem = (payload) => (!payload.name || payload.name.length > NAME_MAX ? "Enter a name." : null);
const phoneProblem = (payload) =>
  payload.phone && payload.phone.length > PHONE_MAX ? "Enter a phone number of 30 characters or fewer." : null;
const otherLanguageProblem = (payload) => {
  if (!payload.languages?.includes("other")) return null;
  if (!payload.otherLanguage) return "Name the other language.";
  if (payload.otherLanguage.length > OTHER_LANGUAGE_MAX) return "Name the other language in 40 characters or fewer.";
  return null;
};

// My profile's problem with its six fields, as a sentence, or null.
export const profileProblem = (payload) =>
  nameProblem(payload) ?? phoneProblem(payload) ?? otherLanguageProblem(payload);

// The Add drawer's returning-volunteer picker (change
// add-returning-volunteers-and-roster-csv). Last season's people whose name or
// email holds the query; a full email that matches an older volunteer finds
// them too, flagged `earlier`.
export function returningCandidates(earlier, query) {
  const text = String(query ?? "").trim().toLowerCase();
  const found = earlier.filter(
    (v) => v.lastSeason && (!text || `${v.name} ${v.email}`.toLowerCase().includes(text)),
  );
  const older = text
    ? earlier
        .filter((v) => !v.lastSeason && String(v.email ?? "").toLowerCase() === text)
        .map((v) => ({ ...v, earlier: true }))
    : [];
  return [...found, ...older];
}

// The drawer's volunteer for a picked person: their stored details, and
// nothing for this season yet.
export const returningFill = (person) => ({
  id: person.id,
  name: person.name,
  email: person.email,
  phone: person.phone ?? null,
  works: person.works,
  languages: [...(person.languages ?? [])],
  otherLanguage: person.otherLanguage ?? null,
  usualDays: [...(person.usualDays ?? [])],
  hasSignIn: Boolean(person.hasSignIn),
  roles: [],
  certificates: [],
  isNew: false,
  photoIdChecked: false,
});

// Returns the first problem as a sentence, or null when the payload may be saved.
export function volunteerProblem(payload, list, volunteerId, earlier = []) {
  const name = nameProblem(payload);
  if (name) return name;
  const email = String(payload.email ?? "").trim().toLowerCase();
  if (!email || email.length > EMAIL_MAX || !EMAIL_PATTERN.test(email)) return "Enter a valid email.";
  if (list.some((v) => v.id !== volunteerId && String(v.email ?? "").toLowerCase() === email)) {
    return "That email is already on the Roster.";
  }
  if (earlier.some((v) => v.id !== volunteerId && String(v.email ?? "").toLowerCase() === email)) {
    return "That email belongs to an earlier volunteer. Pick them above.";
  }
  const phone = phoneProblem(payload);
  if (phone) return phone;
  // A role held before this edit is not refused here: the server drops it when
  // it lost a certificate (withoutLostRoles). Only a newly ticked one is.
  const held = heldRoles(list, volunteerId);
  for (const role of payload.roles ?? []) {
    if (held.includes(role)) continue;
    const missing = missingFor(role, payload.certificates);
    if (missing.length) return `${roleLabel(role)} needs ${missing.join(" and ")}.`;
  }
  return otherLanguageProblem(payload);
}

const heldRoles = (list, volunteerId) =>
  volunteerId ? (list.find((v) => v.id === volunteerId)?.roles ?? []) : [];

// The payload without the roles the volunteer held before this edit and no
// longer has the certificates for, as the server drops them.
export function withoutLostRoles(payload, list, volunteerId) {
  const held = heldRoles(list, volunteerId);
  return {
    ...payload,
    roles: (payload.roles ?? []).filter((role) => !held.includes(role) || missingFor(role, payload.certificates).length === 0)
  };
}

// What the drawer announces after a certificate change unticked `roles`
// (rolesToUntick's answer), for screen readers: "Admin was unticked: it needs
// IT&QR." Roles that now lack the same certificates share one sentence.
// `certificates` is the ticked set after the change; "" when nothing was unticked.
export function untickedRolesMessage(roles, certificates) {
  const groups = new Map();
  for (const role of roles ?? []) {
    const missing = certificateList(missingFor(role, certificates));
    if (!missing) continue;
    if (!groups.has(missing)) groups.set(missing, []);
    groups.get(missing).push(roleLabel(role));
  }
  return [...groups]
    .map(([missing, labels]) => {
      const names = labels.length > 1 ? `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}` : labels[0];
      return labels.length > 1
        ? `${names} were unticked: they need ${missing}.`
        : `${names} was unticked: it needs ${missing}.`;
    })
    .join(" ");
}

// Missing certificates read out as a list: "VSC and IT&QR", or with commas
// from three on, "VSC, IT&QR, and Basic or Advanced", so the "or" inside the
// last item is not lost among the "and"s (#216 review).
function certificateList(items) {
  if (items.length < 3) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

// The server's ROLE_NEEDS detail, "<role>: <labels joined ', '>", as the
// drawer's sentence; null when it isn't that shape.
export function roleNeedsMessage(details) {
  const match = /^([a-z]+): (.+)$/.exec(String(details ?? ""));
  if (!match || !ROLE_NEEDS[match[1]]) return null;
  return `${roleLabel(match[1])} needs ${match[2].split(", ").join(" and ")}.`;
}

// The refusal reason an account action carries (the RPC's `detail`, or the
// Edge Function's `reason`) as the drawer's sentence; null when unknown.
const ACCOUNT_MESSAGES = Object.freeze({
  NO_EMAIL: "Add an email first",
  ALREADY_INVITED: "This person is already invited or signed in.",
  USE_REACTIVATE: "This account is deactivated. Use Reactivate.",
  EMAIL_IN_USE: "That email is already used by another sign-in. Use another email.",
  EMAIL_ON_ROSTER: "That email belongs to a volunteer. Use another email.",
  SELF: "You can't deactivate your own account."
});
export const accountMessage = (reason) => ACCOUNT_MESSAGES[String(reason ?? "")] ?? null;

// What only a site coordinator may do (change add-season-settings, and
// add-remove-from-roster): said by the drawer before a press, and by the
// controller when the server refuses one. One source for both.
export const ADMIN_ROLE_MESSAGE = "Only site coordinators change the Admin role.";
export const REMOVE_SITE_COORDINATOR_MESSAGE = "Only site coordinators remove a site coordinator from the roster.";

// The server's OPEN_WORK detail, a JSON array of labels, as the drawer's
// sentence; null when it isn't a non-empty array of strings.
export function openWorkMessage(name, details) {
  let list;
  try {
    list = JSON.parse(String(details ?? ""));
  } catch {
    return null;
  }
  if (!Array.isArray(list) || !list.length || !list.every((label) => typeof label === "string")) return null;
  return `${name} still has open work: ${list.join(", ")}. Finish it or hand it over first.`;
}

// The role boxes to untick after one certificate box changed, from the
// form's role boxes (`{value, checked, disabled}`). A disabled box (the Admin
// tick for someone who is not a site coordinator) keeps its saved state: it
// is never unticked, and so never announced; the save decides about it.
export function roleBoxesToUntick(roleBoxes, checkedCertificates, changedCertificate) {
  const free = [...(roleBoxes ?? [])].filter((box) => box.checked && !box.disabled);
  const drop = rolesToUntick(free.map((box) => box.value), checkedCertificates, changedCertificate);
  return free.filter((box) => drop.includes(box.value));
}

// The ticked roles to untick after one certificate box changed. Only an
// untick can lose a role: those that had everything with the certificate and
// lack something without it. A role that was already short is left alone (the
// save names what it needs). `checkedCertificates` is the set after the change.
export function rolesToUntick(checkedRoles, checkedCertificates, changedCertificate) {
  const after = checkedCertificates ?? [];
  if (after.includes(changedCertificate)) return [];
  const before = [...after, changedCertificate];
  return (checkedRoles ?? []).filter(
    (role) => missingFor(role, before).length === 0 && missingFor(role, after).length > 0
  );
}

// The Roster's CSV export (change add-returning-volunteers-and-roster-csv).
const CSV_HEADER = ["Name", "Email", "Phone", "Roles", "Certificates", "Languages", "Account", "Cleared"];
const NEW_YORK_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });

export const rosterCsvFilename = (season, now) => `roster-${season}-${NEW_YORK_DAY.format(now)}.csv`;

const certificateText = (volunteer) =>
  (volunteer.certificates ?? [])
    .map((value) => {
      const iso = volunteer.certificateDates?.[value];
      return iso ? `${certificateLabel(value)} (${NEW_YORK_DAY.format(new Date(iso))})` : certificateLabel(value);
    })
    .join("; ");

export function rosterCsv(volunteers) {
  return toCsv(
    CSV_HEADER,
    volunteers.map((v) => [
      v.name,
      v.email,
      v.phone,
      (v.roles ?? []).map(roleLabel).join("; "),
      certificateText(v),
      (v.languages ?? []).length ? languagesText(v) : "",
      accountLabel(v),
      v.cleared ? "Yes" : "No"
    ])
  );
}
