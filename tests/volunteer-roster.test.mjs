import test from "node:test";
import assert from "node:assert/strict";
import {
  ROLES, CERTIFICATES, WORKS, LANGUAGES,
  combineVolunteers, filterVolunteers, SHOW_VIEWS, volunteerFromForm, volunteerProblem,
  ROLE_NEEDS, missingFor, withoutLostRoles, roleNeedsMessage, openWorkMessage, rolesToUntick, untickedRolesMessage,
  accountMessage, volunteerFormChanged, roleBoxesToUntick, rosterCsv, rosterCsvFilename,
  returningCandidates, returningFill
} from "../src/volunteer-roster.mjs";
import { volunteerDrawerBody } from "../src/volunteer-views.mjs";

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
const accounts = [
  { person_id: "p1", status: "active", revision: "2" },
  { person_id: "p2", status: "invited", revision: 1 }
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
  const list = combineVolunteers({ profiles, entries, certificates, people, accounts });
  assert.deepEqual(list.map((v) => v.id), ["p1", "p2"]);
  assert.equal(list[0].hasSignIn, true);
  assert.equal(list[1].hasSignIn, false);
  assert.deepEqual(list[0], {
    id: "p1", name: "ana Lopez", email: "ana@x.org", phone: null, works: "remote",
    languages: ["english", "other"], otherLanguage: "Tagalog", usualDays: [], roles: ["preparer"],
    certificates: ["vsc", "basic"], certificateDates: {}, revision: 3, hasSignIn: true, signedInName: null,
    isNew: false, photoIdChecked: false, form13615SentAt: null, photoIdSentAt: null,
    form13615ReviewedAt: null, form13615ReviewReason: null, photoIdReviewedAt: null, photoIdReviewReason: null,
    account: { status: "active", revision: 2, activatedAt: null, expiresAt: null }, isSiteCoordinator: false,
    cleared: true, missing: [], hasShiftsFromToday: false
  });
  assert.deepEqual(list[1].account, { status: "invited", revision: 1, activatedAt: null, expiresAt: null });
  assert.deepEqual(list[1].certificates, []);
});

test("combine marks who has a shift from today on", () => {
  const list = combineVolunteers({ profiles, entries, certificates, people, accounts, shifts: [{ person_id: "p2" }, { person_id: "p2" }] });
  assert.deepEqual(list.map((v) => [v.id, v.hasShiftsFromToday]), [["p1", false], ["p2", true]]);
});

const sample = combineVolunteers({ profiles, entries, certificates, people, accounts });

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
    isNew: false, photoIdChecked: false, usualDays: []
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
    accounts: [{ person_id: "p1", status: "active", revision: 1 }],
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

test("combine carries the sent dates", () => {
  const one = (entry) => combineVolunteers({
    profiles: [profile("p1")], people: [people[1]], certificates: [], accounts: [],
    entries: [{ person_id: "p1", season: 2026, roles: [], ...entry }]
  })[0];
  const sent = one({ form_13615_sent_at: "2026-11-20T15:00:00Z" });
  assert.equal(sent.form13615SentAt, "2026-11-20T15:00:00Z");
  assert.equal(sent.photoIdSentAt, null);
  const photo = one({ photo_id_sent_at: "2026-11-19T15:00:00Z" });
  assert.deepEqual([photo.form13615SentAt, photo.photoIdSentAt], [null, "2026-11-19T15:00:00Z"]);
});

test("an uploaded certificate is not a certificate", () => {
  const v = combineVolunteers({ profiles, entries, certificates, people, accounts })[0];
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

// rolesToUntick(checkedRoles, checkedCertificates AFTER the change, changedCertificate)
test("ticking a certificate unticks no role, even one still missing certificates", () => {
  assert.deepEqual(rolesToUntick(["preparer"], ["vsc"], "vsc"), []);
  assert.deepEqual(rolesToUntick(["greeter", "preparer"], ["vsc", "itqr"], "itqr"), []);
});

test("unticking Advanced while Basic stays unticks nothing", () => {
  assert.deepEqual(rolesToUntick(["preparer", "reviewer"], ["vsc", "itqr", "basic"], "advanced"), []);
});

test("unticking IT&QR unticks Preparer", () => {
  assert.deepEqual(rolesToUntick(["preparer"], ["vsc", "basic"], "itqr"), ["preparer"]);
  assert.deepEqual(rolesToUntick(["greeter", "preparer"], ["vsc", "basic"], "itqr"), ["preparer"]);
});

test("unticking VSC unticks every ticked role", () => {
  assert.deepEqual(
    rolesToUntick(["greeter", "intaker", "preparer", "reviewer", "admin"], ["itqr", "basic"], "vsc"),
    ["greeter", "intaker", "preparer", "reviewer", "admin"]
  );
});

test("unticking a certificate no ticked role needs unticks nothing", () => {
  assert.deepEqual(rolesToUntick(["greeter"], ["vsc", "itqr"], "itqr"), []);
  assert.deepEqual(rolesToUntick(["preparer"], ["vsc", "itqr", "basic"], "sc"), []);
});

test("unticking Basic unticks Preparer only when Advanced is not ticked", () => {
  assert.deepEqual(rolesToUntick(["preparer"], ["vsc", "itqr"], "basic"), ["preparer"]);
  assert.deepEqual(rolesToUntick(["preparer"], ["vsc", "itqr", "advanced"], "basic"), []);
});

test("a role that was already missing certificates is left to the save's message", () => {
  assert.deepEqual(rolesToUntick(["preparer"], ["vsc"], "sc"), []);
});

const withAccount = (account, roles = ["preparer"]) => combineVolunteers({
  profiles: [profile("p1")], people: [people[1]], certificates: [],
  entries: [{ person_id: "p1", season: 2026, roles }],
  accounts: account ? [{ person_id: "p1", ...account }] : []
})[0];

test("combineVolunteers marks a volunteer with roles and no account not cleared with noAccount", () => {
  const v = withAccount(null);
  assert.deepEqual(v.account, { status: "none", revision: null, activatedAt: null, expiresAt: null });
  assert.deepEqual([v.cleared, v.missing], [false, ["noAccount"]]);
});

test("combineVolunteers: invited gives notSignedIn", () => {
  const v = withAccount({ status: "invited", revision: 1 });
  assert.deepEqual([v.cleared, v.missing], [false, ["notSignedIn"]]);
});

test("combineVolunteers: deactivated gives deactivated", () => {
  const v = withAccount({ status: "deactivated", revision: 3 });
  assert.deepEqual([v.cleared, v.missing, v.account.revision], [false, ["deactivated"], 3]);
});

test("combineVolunteers: active with roles is cleared", () => {
  const v = withAccount({ status: "active", revision: 1 });
  assert.deepEqual([v.cleared, v.missing], [true, []]);
});

test("the account reason follows the Form 13615 and the photo ID in missing", () => {
  assert.deepEqual(withAccount(null, []).missing, ["form13615", "noAccount"]);
});

test("accountMessage maps each reason", () => {
  assert.equal(accountMessage("NO_EMAIL"), "Add an email first");
  assert.equal(accountMessage("ALREADY_INVITED"), "This person is already invited or signed in.");
  assert.equal(accountMessage("USE_REACTIVATE"), "This account is deactivated. Use Reactivate.");
  assert.equal(accountMessage("EMAIL_IN_USE"), "That email is already used by another sign-in. Use another email.");
  assert.equal(accountMessage("EMAIL_ON_ROSTER"), "That email belongs to a volunteer. Use another email.");
  assert.equal(accountMessage("SELF"), "You can't deactivate your own account.");
  assert.equal(accountMessage("OTHER"), null);
  assert.equal(accountMessage(undefined), null);
});

test("combineVolunteers carries the account's dates and the site check's name", () => {
  const [v] = combineVolunteers({
    profiles: [profile("p1", { signed_in_name: "Ana L." })],
    people: [people[1]],
    certificates: [],
    entries: [{ person_id: "p1", season: 2026, roles: ["greeter"] }],
    accounts: [{
      person_id: "p1", status: "active", revision: 4,
      activated_at: "2026-11-02T10:00:00Z", expires_at: null
    }]
  });
  assert.equal(v.signedInName, "Ana L.");
  assert.deepEqual(v.account, { status: "active", revision: 4, activatedAt: "2026-11-02T10:00:00Z", expiresAt: null });
  const [invited] = combineVolunteers({
    profiles: [profile("p1")],
    people: [people[1]],
    certificates: [],
    entries: [{ person_id: "p1", season: 2026, roles: ["greeter"] }],
    accounts: [{ person_id: "p1", status: "invited", revision: 1, activated_at: null, expires_at: "2026-11-09T10:00:00Z" }]
  });
  assert.equal(invited.signedInName, null);
  assert.equal(invited.account.expiresAt, "2026-11-09T10:00:00Z");
});

test("volunteerFormChanged is false for the saved values and true for any edit", () => {
  const saved = sample.find((v) => v.id === "p1");
  const form = (edit = (fd) => fd) => {
    const fd = new FormData();
    fd.set("name", saved.name);
    fd.set("email", saved.email);
    fd.set("phone", saved.phone ?? "");
    fd.set("works", saved.works);
    for (const value of saved.languages) fd.append("language", value);
    fd.set("otherLanguage", saved.otherLanguage ?? "");
    for (const value of saved.roles) fd.append("role", value);
    for (const value of saved.certificates) fd.append("certificate", value);
    edit(fd);
    return volunteerFromForm(fd);
  };
  assert.equal(volunteerFormChanged(saved, form()), false);
  assert.equal(volunteerFormChanged(saved, form((fd) => fd.set("name", " ana Lopez "))), false, "trimmed text is the same");
  assert.equal(volunteerFormChanged(saved, form((fd) => fd.set("email", "ANA@X.ORG"))), false, "email case is the same");
  assert.equal(volunteerFormChanged(saved, form((fd) => fd.set("email", "ana2@x.org"))), true);
  assert.equal(volunteerFormChanged(saved, form((fd) => fd.set("phone", "555-0199"))), true);
  assert.equal(volunteerFormChanged(saved, form((fd) => fd.append("role", "greeter"))), true);
  assert.equal(volunteerFormChanged(saved, form((fd) => fd.set("isNew", "on"))), true);
  assert.equal(volunteerFormChanged(saved, form((fd) => fd.set("otherLanguage", "Ilocano"))), true);
  assert.equal(volunteerFormChanged(null, form()), true, "no saved volunteer: nothing is saved yet");
});

// untickedRolesMessage(rolesToUntick's answer, checkedCertificates AFTER the change) (#192)
test("the unticked-roles sentence names the role and what it now needs", () => {
  assert.equal(untickedRolesMessage(["admin"], ["vsc"]), "Admin was unticked: it needs IT&QR.");
  assert.equal(
    untickedRolesMessage(["preparer"], ["vsc", "itqr"]),
    "Preparer was unticked: it needs Basic or Advanced."
  );
});

test("roles that now lack the same certificates share one sentence", () => {
  assert.equal(
    untickedRolesMessage(["preparer", "reviewer"], ["vsc", "itqr"]),
    "Preparer and Reviewer were unticked: they need Basic or Advanced."
  );
  assert.equal(
    untickedRolesMessage(["greeter", "intaker", "preparer", "reviewer", "admin"], ["itqr", "basic"]),
    "Greeter, Intaker, Preparer, Reviewer and Admin were unticked: they need VSC."
  );
  assert.equal(
    untickedRolesMessage(["intaker", "preparer"], ["vsc", "basic"]),
    "Intaker and Preparer were unticked: they need IT&QR."
  );
});

test("roles that lack different certificates get a sentence each; a role lacking nothing is left out", () => {
  assert.equal(
    untickedRolesMessage(["admin", "preparer"], ["vsc", "itqr"]),
    "Preparer was unticked: it needs Basic or Advanced."
  );
  assert.equal(
    untickedRolesMessage(["greeter", "preparer"], ["itqr"]),
    "Greeter was unticked: it needs VSC. Preparer was unticked: it needs VSC and Basic or Advanced."
  );
});

test("three or more missing certificates are listed with commas", () => {
  assert.equal(
    untickedRolesMessage(["preparer"], []),
    "Preparer was unticked: it needs VSC, IT&QR, and Basic or Advanced."
  );
});

test("nothing unticked, nothing announced", () => {
  assert.equal(untickedRolesMessage([], ["vsc"]), "");
  assert.equal(untickedRolesMessage(undefined, []), "");
});

// A site coordinator (accounts.is_site_coordinator) is cleared only with SC
// confirmed this season (design D6).
const coordinator = (certificates, extra = {}) => combineVolunteers({
  profiles: [profile("p1")], people: [people[1]],
  certificates: certificates.map((certificate) => ({ person_id: "p1", season: 2026, certificate, status: "confirmed" })),
  entries: [{ person_id: "p1", season: 2026, roles: ["admin"], ...extra }],
  accounts: [{ person_id: "p1", status: "active", revision: 1, is_site_coordinator: true }]
})[0];

test("combineVolunteers: a site coordinator without SC is not cleared, with scCertificate", () => {
  const v = coordinator(["vsc", "itqr"]);
  assert.equal(v.isSiteCoordinator, true);
  assert.deepEqual([v.cleared, v.missing], [false, ["scCertificate"]]);
});

test("combineVolunteers: a site coordinator with SC confirmed is cleared", () => {
  const v = coordinator(["vsc", "itqr", "sc"]);
  assert.deepEqual([v.cleared, v.missing], [true, []]);
});

test("combineVolunteers: an uploaded SC does not clear a site coordinator", () => {
  const v = combineVolunteers({
    profiles: [profile("p1")], people: [people[1]],
    certificates: [{ person_id: "p1", season: 2026, certificate: "sc", status: "uploaded" }],
    entries: [{ person_id: "p1", season: 2026, roles: ["greeter"] }],
    accounts: [{ person_id: "p1", status: "active", revision: 1, is_site_coordinator: true }]
  })[0];
  assert.deepEqual([v.cleared, v.missing], [false, ["scCertificate"]]);
});

test("the SC item follows the photo ID and comes before the account reason", () => {
  const v = combineVolunteers({
    profiles: [profile("p1")], people: [people[1]], certificates: [],
    entries: [{ person_id: "p1", season: 2026, roles: ["admin"], is_new: true }],
    accounts: [{ person_id: "p1", status: "invited", revision: 1, is_site_coordinator: true }]
  })[0];
  assert.deepEqual(v.missing, ["photoId", "scCertificate", "notSignedIn"]);
  assert.deepEqual(coordinator([], { roles: [] }).missing, ["form13615", "scCertificate"]);
});

test("combineVolunteers: someone who is not a site coordinator needs no SC", () => {
  const v = withAccount({ status: "active", revision: 1 });
  assert.equal(v.isSiteCoordinator, false);
  assert.deepEqual([v.cleared, v.missing], [true, []]);
});

// The drawer's role boxes as the page sees them: {value, checked, disabled}.
const box = (value, extra = {}) => ({ value, checked: true, disabled: false, ...extra });

test("a disabled Admin tick keeps its saved state when IT&QR is unticked", () => {
  const admin = box("admin", { disabled: true });
  const intaker = box("intaker");
  const drop = roleBoxesToUntick([admin, intaker], ["vsc"], "itqr");
  assert.deepEqual(drop, [intaker]);
  // Only what is unticked is announced: no "Admin was unticked".
  assert.equal(untickedRolesMessage(drop.map((b) => b.value), ["vsc"]), "Intaker was unticked: it needs IT&QR.");
  assert.deepEqual(roleBoxesToUntick([admin], [], "vsc"), []);
});

test("an enabled Admin tick is still unticked when it loses a certificate", () => {
  const admin = box("admin");
  assert.deepEqual(roleBoxesToUntick([admin, box("greeter", { checked: false })], ["vsc"], "itqr"), [admin]);
});

const sent = (id, form13615SentAt, photoIdSentAt, roles = ["preparer"]) => ({
  id, name: id, email: `${id}@x.test`, phone: null, roles, form13615SentAt, photoIdSentAt,
});
const uploadList = [
  sent("a", "2026-11-20T15:00:00Z", null),
  sent("b", null, "2026-11-20T15:00:00Z", ["reviewer"]),
  sent("c", null, null),
];

test("filterVolunteers keeps uploads to review", () => {
  assert.deepEqual(filterVolunteers(uploadList, { show: "uploads" }).map((v) => v.id), ["a", "b"]);
  assert.deepEqual(filterVolunteers(uploadList, { show: "all" }).map((v) => v.id), ["a", "b", "c"]);
});

test("show combines with role and search", () => {
  assert.deepEqual(filterVolunteers(uploadList, { show: "uploads", role: "reviewer" }).map((v) => v.id), ["b"]);
  assert.deepEqual(filterVolunteers(uploadList, { show: "uploads", search: "a@x" }).map((v) => v.id), ["a"]);
});

test("an unknown show value keeps everyone", () => {
  assert.equal(filterVolunteers(uploadList, { show: "nonsense" }).length, 3);
});

test("SHOW_VIEWS lists Everyone then Uploads to review", () => {
  assert.deepEqual(SHOW_VIEWS.map((v) => [v.value, v.label]), [["all", "Everyone"], ["uploads", "Uploads to review"]]);
});

// ---- Usual days in the Roster's drawer (change add-volunteer-schedule) ----
// Main's usual days (change add-my-profile) are check boxes holding mon..sun;
// this change adds no toggles of its own.

test("the drawer shows main's usual-days check boxes only, ticked from the volunteer's days", () => {
  const v = { ...sample.find((entry) => entry.id === "p1"), usualDays: ["tue", "sat"] };
  const html = volunteerDrawerBody({ volunteer: v, isNew: false, ui: {} });
  const boxes = [...html.matchAll(/<input type="checkbox" name="usualDays" value="([a-z]+)"( checked)?/g)];
  assert.deepEqual(boxes.map((m) => m[1]), ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
  assert.deepEqual(boxes.filter((m) => m[2]).map((m) => m[1]), ["tue", "sat"]);
  assert.doesNotMatch(html, /toggle-usual-day|data-day=|id="volunteer-usual-days"/);
});

test("form reading sends the ticked usual days as main's strings", () => {
  const fd = new FormData();
  fd.set("name", "Ana");
  fd.set("email", "ana@x.org");
  fd.append("usualDays", "mon");
  fd.append("usualDays", "sat");
  assert.deepEqual(volunteerFromForm(fd).usualDays, ["mon", "sat"]);
});

test("combine keeps the confirmed date of each confirmed certificate only", () => {
  const list = combineVolunteers({
    profiles, entries, people, accounts,
    certificates: [
      { person_id: "p1", season: 2026, certificate: "itqr", status: "confirmed", confirmed_at: "2026-11-04T03:30:00Z" },
      { person_id: "p1", season: 2026, certificate: "vsc", status: "uploaded", confirmed_at: null }
    ]
  });
  assert.deepEqual(list[0].certificates, ["itqr"]);
  assert.deepEqual(list[0].certificateDates, { itqr: "2026-11-04T03:30:00Z" });
});

test("rosterCsvFilename uses the New York date", () => {
  assert.equal(rosterCsvFilename(2026, new Date("2026-11-24T04:30:00Z")), "roster-2026-2026-11-23.csv");
});

const csvVolunteer = (extra = {}) => ({
  name: "Ana Lopez", email: "ana@x.org", phone: null, roles: [], certificates: [], certificateDates: {},
  languages: [], otherLanguage: null, account: { status: "none" }, cleared: false, ...extra
});
const csvLines = (volunteers) => rosterCsv(volunteers).replace(/^\uFEFF/, "").split("\r\n");

test("rosterCsv writes the header and a Preparer row with dated certificates", () => {
  const lines = csvLines([csvVolunteer({
    roles: ["preparer"], certificates: ["itqr", "basic"],
    certificateDates: { itqr: "2026-11-04T03:30:00Z", basic: "2026-11-04T03:30:00Z" },
    languages: ["english", "other"], otherLanguage: "Tagalog", account: { status: "active" }, cleared: true
  })]);
  assert.equal(lines[0], "Name,Email,Phone,Roles,Certificates,Languages,Account,Cleared");
  assert.equal(lines[1], 'Ana Lopez,ana@x.org,,Preparer,IT&QR (2026-11-03); Basic (2026-11-03),"English, Tagalog",Active,Yes');
});

test("rosterCsv leaves roles and certificates empty, labels accounts and guards phones", () => {
  const lines = csvLines([
    csvVolunteer({ phone: "+1 555 0100", account: { status: "invited" } }),
    csvVolunteer({ name: "Zed Tran", account: { status: "deactivated" } })
  ]);
  assert.equal(lines[1], "Ana Lopez,ana@x.org,'+1 555 0100,,,,Invited,No");
  assert.equal(lines[2], "Zed Tran,ana@x.org,,,,,Deactivated,No");
  assert.match(csvLines([csvVolunteer()])[1], /,Not created,No$/);
});

// Returning volunteers (change add-returning-volunteers-and-roster-csv)
const earlier = (id, name, email, lastSeason, extra = {}) => ({
  id, name, email, phone: null, works: "remote", languages: ["english", "other"],
  otherLanguage: "Tagalog", usualDays: ["tue", "thu"], revision: 4, hasSignIn: false, lastSeason, ...extra
});
const EARLIER = [
  earlier("e1", "Nadia Kerr", "nadia@example.org", true),
  earlier("e2", "Omar Haddad", "omar@example.org", true),
  earlier("e3", "Kerry Older", "kerry@example.org", false)
];

test("returningCandidates keeps last season's people whose name or email has the query", () => {
  assert.deepEqual(returningCandidates(EARLIER, " KER ").map((e) => e.id), ["e1"]);
  assert.deepEqual(returningCandidates(EARLIER, "omar@").map((e) => e.id), ["e2"]);
  assert.deepEqual(returningCandidates(EARLIER, "").map((e) => e.id), ["e1", "e2"]);
});

test("returningCandidates adds an older volunteer found by their full email, flagged earlier", () => {
  const found = returningCandidates(EARLIER, "KERRY@example.org");
  assert.deepEqual(found.map((e) => [e.id, e.earlier]), [["e3", true]]);
  assert.equal(returningCandidates(EARLIER, "nadia@example.org")[0].earlier, undefined);
});

test("returningFill makes a drawer volunteer with the stored details and nothing for this season", () => {
  const fill = returningFill(EARLIER[0]);
  assert.deepEqual(fill.usualDays, ["tue", "thu"]);
  assert.equal(fill.otherLanguage, "Tagalog");
  assert.equal(fill.email, "nadia@example.org");
  assert.deepEqual(fill.roles, []);
  assert.deepEqual(fill.certificates, []);
  assert.equal(fill.isNew, false);
  assert.equal(fill.photoIdChecked, false);
  assert.equal(fill.hasSignIn, false);
});

test("volunteerProblem refuses an earlier volunteer's email on an add, not for the picked person", () => {
  const payload = { name: "Nadia Kerr", email: "Nadia@example.org", works: "remote", languages: ["english"], roles: [], certificates: [] };
  assert.equal(volunteerProblem(payload, [], null, EARLIER), "That email belongs to an earlier volunteer. Pick them above.");
  assert.equal(volunteerProblem(payload, [], "e1", EARLIER), null);
  assert.equal(volunteerProblem(payload, [], null), null);
});
