// Pure logic for the admin-only volunteer Roster: lists, combining, search, form reading, validation.
import { EMAIL_PATTERN } from "./auth.mjs";

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
  for (const c of certificates) {
    if (!certsById.has(c.person_id)) certsById.set(c.person_id, []);
    // An uploaded certificate has not been confirmed: it is not shown and counts for nothing.
    if (c.status === "confirmed") certsById.get(c.person_id).push(c.certificate);
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
    const cleared = roles.length > 0 && (!isNew || photoIdChecked) && account.status === "active";
    // What the row waits for, in order: the Form 13615 (no roles) or the photo ID, then the account.
    const missing = roles.length === 0 ? ["form13615"] : !isNew || photoIdChecked ? [] : ["photoId"];
    if (account.status !== "active") missing.push(ACCOUNT_MISSING[account.status]);
    list.push({
      id: person.id,
      name: person.name,
      email: profile.email,
      phone: profile.phone ?? null,
      works: profile.works,
      languages: [...(profile.languages ?? [])],
      otherLanguage: profile.other_language ?? null,
      roles,
      certificates: certsById.get(person.id) ?? [],
      revision: profile.revision,
      hasSignIn: Boolean(person.user_id),
      // The name the volunteer gave at their site check (migration 047).
      signedInName: profile.signed_in_name ?? null,
      isNew,
      photoIdChecked,
      account,
      cleared,
      missing
    });
  }
  return list.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

export function filterVolunteers(list, { search = "", role = "all" } = {}) {
  const needle = String(search ?? "").trim().toLowerCase();
  return list.filter((v) => {
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
    photoIdChecked: formData.get("photoIdChecked") != null
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
    payload.photoIdChecked !== (volunteer.photoIdChecked === true)
  );
}

// Returns the first problem as a sentence, or null when the payload may be saved.
export function volunteerProblem(payload, list, volunteerId) {
  if (!payload.name || payload.name.length > NAME_MAX) return "Enter a name.";
  const email = String(payload.email ?? "").trim().toLowerCase();
  if (!email || email.length > EMAIL_MAX || !EMAIL_PATTERN.test(email)) return "Enter a valid email.";
  if (list.some((v) => v.id !== volunteerId && String(v.email ?? "").toLowerCase() === email)) {
    return "That email is already on the Roster.";
  }
  if (payload.phone && payload.phone.length > PHONE_MAX) return "Enter a phone number of 30 characters or fewer.";
  // A role held before this edit is not refused here: the server drops it when
  // it lost a certificate (withoutLostRoles). Only a newly ticked one is.
  const held = heldRoles(list, volunteerId);
  for (const role of payload.roles ?? []) {
    if (held.includes(role)) continue;
    const missing = missingFor(role, payload.certificates);
    if (missing.length) return `${roleLabel(role)} needs ${missing.join(" and ")}.`;
  }
  if (payload.languages?.includes("other")) {
    if (!payload.otherLanguage) return "Name the other language.";
    if (payload.otherLanguage.length > OTHER_LANGUAGE_MAX) return "Name the other language in 40 characters or fewer.";
  }
  return null;
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
