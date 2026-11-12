import test from "node:test";
import assert from "node:assert/strict";
import {
  ROLES, CERTIFICATES, WORKS, LANGUAGES,
  combineVolunteers, filterVolunteers, volunteerFromForm, volunteerProblem,
  ROLE_NEEDS, missingFor, withoutLostRoles, roleNeedsMessage, openWorkMessage
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
  { person_id: "p1", season: 2026, certificate: "vsc", status: "confirmed" },
  { person_id: "p1", season: 2026, certificate: "basic", status: "confirmed" },
  { person_id: "p1", season: 2026, certificate: "itqr", status: "uploaded" }
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
    certificates: ["vsc", "basic"], revision: 3, hasSignIn: true,
    isNew: false, photoIdChecked: false, cleared: true, missing: []
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
    otherLanguage: null, roles: ["greeter", "admin"], certificates: ["vsc"],
    isNew: false, photoIdChecked: false
  });
  fd.set("isNew", "on");
  fd.set("photoIdChecked", "on");
  const ticked = volunteerFromForm(fd);
  assert.equal(ticked.isNew, true);
  assert.equal(ticked.photoIdChecked, true);
});

test("cleared follows roles and the photo ID check of the current season", () => {
  const one = (entry) => combineVolunteers({
    profiles: [profile("p1")], people: [people[1]], certificates: [],
    entries: [{ person_id: "p1", season: 2026, roles: [], is_new: false, photo_id_checked_at: null, ...entry }]
  })[0];
  const noRoles = one({ roles: [] });
  assert.deepEqual([noRoles.cleared, noRoles.missing], [false, ["form13615"]]);
  const waiting = one({ roles: ["greeter"], is_new: true });
  assert.deepEqual([waiting.isNew, waiting.photoIdChecked, waiting.cleared, waiting.missing], [true, false, false, ["photoId"]]);
  const checked = one({ roles: ["greeter"], is_new: true, photo_id_checked_at: "2026-01-05T10:00:00Z" });
  assert.deepEqual([checked.photoIdChecked, checked.cleared, checked.missing], [true, true, []]);
  const returning = one({ roles: ["greeter"], is_new: false });
  assert.deepEqual([returning.cleared, returning.missing], [true, []]);
  // No roles wins over an unchecked photo ID: one thing is shown.
  assert.deepEqual(one({ roles: [], is_new: true }).missing, ["form13615"]);
});

test("an uploaded certificate is not a certificate", () => {
  const v = combineVolunteers({ profiles, entries, certificates, people })[0];
  assert.deepEqual(v.certificates, ["vsc", "basic"]);
});

// A fixture copy of the SQL table (migration 045): what each role needs.
const SQL_NEEDS = {
  greeter: { all: ["vsc"], oneOf: [] },
  intaker: { all: ["vsc", "itqr"], oneOf: [] },
  admin: { all: ["vsc", "itqr"], oneOf: [] },
  preparer: { all: ["vsc", "itqr"], oneOf: ["basic", "advanced"] },
  reviewer: { all: ["vsc", "itqr"], oneOf: ["basic", "advanced"] }
};

test("ROLE_NEEDS matches the SQL needs table", () => {
  assert.deepEqual(ROLE_NEEDS, SQL_NEEDS);
  assert.deepEqual(Object.keys(ROLE_NEEDS).sort(), ROLES.map((r) => r.value).sort());
});

test("missingFor names what a role still needs, in the screen's labels", () => {
  assert.deepEqual(missingFor("greeter", ["vsc"]), []);
  assert.deepEqual(missingFor("preparer", ["vsc"]), ["IT&QR", "Basic or Advanced"]);
  assert.deepEqual(missingFor("preparer", ["vsc", "itqr", "advanced"]), []);
  assert.deepEqual(missingFor("intaker", []), ["VSC", "IT&QR"]);
  assert.deepEqual(missingFor("reviewer", ["vsc", "itqr", "sc"]), ["Basic or Advanced"]);
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
  const ok = { name: "Ana", email: "ana@x.org", phone: null, works: "on_site", languages: [], otherLanguage: null, roles: ["greeter"], certificates: ["vsc"], isNew: true, photoIdChecked: false };
  assert.equal(volunteerProblem(ok, [], null), null);
  assert.equal(volunteerProblem({ ...ok, name: "" }, [], null), "Enter a name.");
  assert.equal(volunteerProblem({ ...ok, email: "nope" }, [], null), "Enter a valid email.");
  assert.equal(volunteerProblem({ ...ok, email: "ANA@x.org" }, [{ id: "p1", email: "ana@x.org" }], null), "That email is already on the Roster.");
  assert.equal(volunteerProblem({ ...ok, email: "ANA@x.org" }, [{ id: "p1", email: "ana@x.org" }], "p1"), null);
  assert.equal(volunteerProblem({ ...ok, roles: [] }, [], null), null, "no role is allowed");
  assert.equal(volunteerProblem({ ...ok, languages: ["other"] }, [], null), "Name the other language.");
  assert.equal(volunteerProblem({ ...ok, languages: ["other"], otherLanguage: "Tagalog" }, [], null), null);
});

test("a newly ticked role without its certificates is refused, naming the first such role", () => {
  const ok = { name: "Ana", email: "ana@x.org", phone: null, works: "on_site", languages: [], otherLanguage: null, certificates: ["vsc"], isNew: true, photoIdChecked: false };
  assert.equal(volunteerProblem({ ...ok, roles: ["preparer"] }, [], null), "Preparer needs IT&QR and Basic or Advanced.");
  assert.equal(volunteerProblem({ ...ok, roles: ["greeter", "intaker", "preparer"] }, [], null), "Intaker needs IT&QR.");
  assert.equal(volunteerProblem({ ...ok, roles: ["intaker"], certificates: [] }, [], null), "Intaker needs VSC and IT&QR.");
  assert.equal(volunteerProblem({ ...ok, roles: ["greeter"] }, [], null), null);
});

test("a role held before the edit is not refused, and is dropped when it lost a certificate", () => {
  const held = [{ id: "p1", email: "other@x.org", roles: ["preparer", "greeter"] }];
  const payload = { name: "Ana", email: "ana@x.org", phone: null, works: "on_site", languages: [], otherLanguage: null, certificates: ["vsc", "itqr"], roles: ["preparer", "greeter"], isNew: false, photoIdChecked: false };
  assert.equal(volunteerProblem(payload, held, "p1"), null);
  assert.deepEqual(withoutLostRoles(payload, held, "p1").roles, ["greeter"]);
  // A new role that is missing a certificate is not "held": it is refused, not dropped.
  assert.deepEqual(withoutLostRoles({ ...payload, roles: ["reviewer"] }, held, "p1").roles, ["reviewer"]);
  assert.equal(volunteerProblem({ ...payload, roles: ["reviewer"] }, held, "p1"), "Reviewer needs Basic or Advanced.");
  // An Add holds nothing before.
  assert.deepEqual(withoutLostRoles(payload, held, null).roles, ["preparer", "greeter"]);
});

test("the server's refusals read as the drawer's sentences", () => {
  assert.equal(roleNeedsMessage("preparer: IT&QR, Basic or Advanced"), "Preparer needs IT&QR and Basic or Advanced.");
  assert.equal(roleNeedsMessage("intaker: VSC"), "Intaker needs VSC.");
  assert.equal(roleNeedsMessage(undefined), null);
  assert.equal(roleNeedsMessage("nonsense"), null);
  assert.equal(roleNeedsMessage("wizard: VSC"), null);
  assert.equal(
    openWorkMessage("Mira Patel", '["preparing client 1042","default follow-up person"]'),
    "Mira Patel still has open work: preparing client 1042, default follow-up person. Finish it or hand it over first."
  );
  assert.equal(openWorkMessage("Mira Patel", "not json"), null);
  assert.equal(openWorkMessage("Mira Patel", "[]"), null);
  assert.equal(openWorkMessage("Mira Patel", '{"a":1}'), null);
  assert.equal(openWorkMessage("Mira Patel", '[1,"x"]'), null);
  assert.equal(openWorkMessage("Mira Patel", undefined), null);
});
