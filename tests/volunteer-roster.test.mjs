import test from "node:test";
import assert from "node:assert/strict";
import {
  ROLES, CERTIFICATES, WORKS, LANGUAGES,
  combineVolunteers, filterVolunteers, volunteerFromForm, volunteerProblem
} from "../src/volunteer-roster.mjs";

const people = [
  { id: "p2", name: "Zed Tran", user_id: null },
  { id: "p1", name: "ana Lopez", user_id: "u1" },
  { id: "p3", name: "No Entry", user_id: null }
];
const profile = (person_id, extra = {}) => ({
  workspace_id: "w", person_id, email: `${person_id}@x.org`, phone: null,
  works: "on_site", languages: [], other_language: null, revision: 1, ...extra
});
const profiles = [
  profile("p2", { phone: "555-0102", roles: undefined }),
  profile("p1", { email: "ana@x.org", works: "remote", languages: ["english", "other"], other_language: "Tagalog", revision: 3 }),
  profile("p3")
];
const entries = [
  { person_id: "p1", season: 2026, roles: ["preparer"] },
  { person_id: "p2", season: 2026, roles: ["reviewer", "greeter"] }
];
const certificates = [
  { person_id: "p1", season: 2026, certificate: "vsc" },
  { person_id: "p1", season: 2026, certificate: "basic" }
];

test("fixed lists carry the stored values", () => {
  assert.deepEqual(ROLES.map((r) => r.value), ["greeter", "intaker", "preparer", "reviewer", "admin"]);
  assert.deepEqual(CERTIFICATES.map((c) => c.value), ["vsc", "itqr", "sc", "basic", "advanced"]);
  assert.equal(CERTIFICATES[0].full, "Volunteer Standards of Conduct");
  assert.deepEqual(WORKS.map((w) => w.value), ["on_site", "remote", "on_site_and_remote"]);
  assert.deepEqual(LANGUAGES.map((l) => l.value), ["english", "mandarin", "cantonese", "other"]);
});

test("combine keeps only people with a roster entry", () => {
  const list = combineVolunteers({ profiles, entries, certificates, people });
  assert.deepEqual(list.map((v) => v.id), ["p1", "p2"]);
  assert.equal(list[0].hasSignIn, true);
  assert.equal(list[1].hasSignIn, false);
  assert.deepEqual(list[0], {
    id: "p1", name: "ana Lopez", email: "ana@x.org", phone: null, works: "remote",
    languages: ["english", "other"], otherLanguage: "Tagalog", roles: ["preparer"],
    certificates: ["vsc", "basic"], revision: 3, hasSignIn: true
  });
  assert.deepEqual(list[1].certificates, []);
});

const sample = combineVolunteers({ profiles, entries, certificates, people });

test("search matches name, email or phone ignoring case", () => {
  assert.deepEqual(filterVolunteers(sample, { search: "ANA" }).map((v) => v.id), ["p1"]);
  assert.deepEqual(filterVolunteers(sample, { search: "P2@X" }).map((v) => v.id), ["p2"]);
  assert.deepEqual(filterVolunteers(sample, { search: "0102" }).map((v) => v.id), ["p2"]);
  assert.equal(filterVolunteers(sample, { search: "" }).length, 2);
  assert.equal(filterVolunteers(sample, {}).length, 2);
});

test("role and search apply together", () => {
  assert.deepEqual(filterVolunteers(sample, { role: "reviewer" }).map((v) => v.id), ["p2"]);
  assert.deepEqual(filterVolunteers(sample, { role: "reviewer", search: "ana" }), []);
  assert.deepEqual(filterVolunteers(sample, { role: "all", search: "ana" }).map((v) => v.id), ["p1"]);
});

test("form reading trims, lower-cases and collects ticks", () => {
  const fd = new FormData();
  fd.set("name", " Ana ");
  fd.set("email", " A@B.ORG ");
  fd.set("phone", "");
  fd.append("role", "greeter");
  fd.append("role", "admin");
  fd.append("certificate", "vsc");
  assert.deepEqual(volunteerFromForm(fd), {
    name: "Ana", email: "a@b.org", phone: null, works: "on_site", languages: [],
    otherLanguage: null, roles: ["greeter", "admin"], certificates: ["vsc"]
  });
});

test("otherLanguage is null unless Other is ticked", () => {
  const fd = new FormData();
  fd.set("name", "A");
  fd.set("otherLanguage", " Tagalog ");
  fd.append("language", "english");
  assert.equal(volunteerFromForm(fd).otherLanguage, null);
  fd.append("language", "other");
  assert.equal(volunteerFromForm(fd).otherLanguage, "Tagalog");
});

test("problems", () => {
  const ok = { name: "Ana", email: "ana@x.org", phone: null, works: "on_site", languages: [], otherLanguage: null, roles: ["greeter"], certificates: [] };
  assert.equal(volunteerProblem(ok, [], null), null);
  assert.equal(volunteerProblem({ ...ok, name: "" }, [], null), "Enter a name.");
  assert.equal(volunteerProblem({ ...ok, email: "nope" }, [], null), "Enter a valid email.");
  assert.equal(volunteerProblem({ ...ok, email: "ANA@x.org" }, [{ id: "p1", email: "ana@x.org" }], null), "That email is already on the Roster.");
  assert.equal(volunteerProblem({ ...ok, email: "ANA@x.org" }, [{ id: "p1", email: "ana@x.org" }], "p1"), null);
  assert.equal(volunteerProblem({ ...ok, roles: [] }, [], null), "Choose at least one role.");
  assert.equal(volunteerProblem({ ...ok, languages: ["other"] }, [], null), "Name the other language.");
  assert.equal(volunteerProblem({ ...ok, languages: ["other"], otherLanguage: "Tagalog" }, [], null), null);
});
