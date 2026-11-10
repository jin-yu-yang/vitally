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

const NAME_MAX = 80;
const EMAIL_MAX = 254;
const PHONE_MAX = 30;
const OTHER_LANGUAGE_MAX = 40;

// Joins raw PostgREST rows into volunteers. Only people with a roster entry appear.
export function combineVolunteers({ profiles = [], entries = [], certificates = [], people = [] }) {
  const profileById = new Map(profiles.map((p) => [p.person_id, p]));
  const entryById = new Map(entries.map((e) => [e.person_id, e]));
  const certsById = new Map();
  for (const c of certificates) {
    if (!certsById.has(c.person_id)) certsById.set(c.person_id, []);
    certsById.get(c.person_id).push(c.certificate);
  }
  const list = [];
  for (const person of people) {
    const entry = entryById.get(person.id);
    const profile = profileById.get(person.id);
    if (!entry || !profile) continue;
    list.push({
      id: person.id,
      name: person.name,
      email: profile.email,
      phone: profile.phone ?? null,
      works: profile.works,
      languages: [...(profile.languages ?? [])],
      otherLanguage: profile.other_language ?? null,
      roles: [...(entry.roles ?? [])],
      certificates: certsById.get(person.id) ?? [],
      revision: profile.revision,
      hasSignIn: Boolean(person.user_id)
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
    certificates: formData.getAll("certificate").map(String)
  };
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
  if (!payload.roles?.length) return "Choose at least one role.";
  if (payload.languages?.includes("other")) {
    if (!payload.otherLanguage) return "Name the other language.";
    if (payload.otherLanguage.length > OTHER_LANGUAGE_MAX) return "Name the other language in 40 characters or fewer.";
  }
  return null;
}
