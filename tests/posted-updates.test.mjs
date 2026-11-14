import test from "node:test";
import assert from "node:assert/strict";
import {
  KINDS, KIND_LABELS, KIND_TAGS, ROLES, ROLE_LABELS, ROLE_PLURALS,
  audienceLabel, validateUpdate, toUpdateRequest, badgeCount, isPinned, emptyUpdateForm
} from "../src/posted-updates.mjs";

const good = () => ({
  ...emptyUpdateForm(),
  kind: "irs_policy",
  title: "New rule",
  message: "Read this.",
  irsLink: "https://www.irs.gov/individuals/volunteer"
});

test("constants", () => {
  assert.deepEqual(KINDS, ["irs_policy", "office_notice"]);
  assert.equal(KIND_LABELS.office_notice, "Office notice");
  assert.equal(KIND_TAGS.irs_policy, "IRS policy");
  assert.deepEqual(ROLES, ["greeter", "intaker", "preparer", "reviewer", "admin"]);
  assert.equal(ROLE_LABELS.intaker, "Intaker");
  assert.equal(ROLE_PLURALS.admin, "Admins");
});

test("audienceLabel", () => {
  assert.equal(audienceLabel({ audience: "everyone", roles: [] }), "All volunteers");
  assert.equal(audienceLabel({ audience: "roles", roles: ["reviewer"] }), "Reviewers");
  assert.equal(audienceLabel({ audience: "roles", roles: ["reviewer", "preparer"] }), "Preparers and Reviewers");
  assert.equal(audienceLabel({ audience: "roles", roles: ["admin", "greeter", "intaker"] }), "Greeters, Intakers and Admins");
});

test("validateUpdate accepts a valid IRS update", () => {
  assert.equal(validateUpdate(good()), null);
  assert.equal(validateUpdate({ ...good(), irsLink: "" }), null);
  assert.equal(validateUpdate({ ...good(), irsLink: "HTTPS://WWW.IRS.GOV/x" }), null);
  assert.equal(validateUpdate({ ...good(), irsLink: "https://irs.gov" }), null);
});

test("validateUpdate messages", () => {
  const t = "Enter a title of up to 120 characters.";
  const m = "Enter a message of up to 2000 characters.";
  assert.deepEqual(validateUpdate({ ...good(), title: "  " }), { title: t });
  assert.deepEqual(validateUpdate({ ...good(), title: "x".repeat(121) }), { title: t });
  assert.equal(validateUpdate({ ...good(), title: "x".repeat(120) }), null);
  assert.deepEqual(validateUpdate({ ...good(), message: "" }), { message: m });
  assert.deepEqual(validateUpdate({ ...good(), message: "x".repeat(2001) }), { message: m });
  assert.equal(validateUpdate({ ...good(), message: "x".repeat(2000) }), null);
  assert.deepEqual(validateUpdate({ ...good(), kind: "" }), { kind: "Choose a type." });
  assert.deepEqual(validateUpdate({ ...good(), audience: "roles", roles: [] }), { roles: "Choose at least one role." });
  assert.equal(validateUpdate({ ...good(), audience: "roles", roles: ["admin"] }), null);
  const link = "Use an https link on irs.gov.";
  for (const bad of ["http://www.irs.gov/x", "https://evilirs.gov/x", "https://irs.gov.evil.com/", "https://example.com", "not a url", "https://www.irs.gov/a b", "https://www.irs.gov/" + "a".repeat(500)]) {
    assert.deepEqual(validateUpdate({ ...good(), irsLink: bad }), { irsLink: link }, bad);
  }
  assert.deepEqual(
    validateUpdate({ ...good(), kind: "office_notice", irsLink: "https://www.irs.gov/x" }),
    { irsLink: "Only IRS policy updates link to the IRS." }
  );
  const many = validateUpdate({ ...good(), title: "", message: "", kind: "x" });
  assert.deepEqual(Object.keys(many).sort(), ["kind", "message", "title"]);
});

test("toUpdateRequest has exactly the ten keys the database expects", () => {
  const r = toUpdateRequest(good(), {});
  assert.deepEqual(Object.keys(r).sort(), [
    "askAgain", "askConfirm", "audience", "irsLink", "keepTopUntil", "kind", "message", "post", "roles", "title"
  ]);
  assert.equal(r.post, false);
  assert.equal(r.askAgain, false);
  assert.equal(r.askConfirm, false);
  assert.equal(r.keepTopUntil, null);
  assert.deepEqual(Object.keys(toUpdateRequest(good())).length, 10);
});

test("toUpdateRequest trims and normalizes", () => {
  const r = toUpdateRequest({
    ...good(), title: "  Hi  ", message: " Body\n", irsLink: " https://www.irs.gov/x ",
    audience: "everyone", roles: ["admin"], keepTopUntil: "2026-12-01", askConfirm: true
  }, { post: true, askAgain: true });
  assert.equal(r.title, "Hi");
  assert.equal(r.message, "Body");
  assert.equal(r.irsLink, "https://www.irs.gov/x");
  assert.deepEqual(r.roles, []);
  assert.equal(r.keepTopUntil, "2026-12-01");
  assert.equal(r.askConfirm, true);
  assert.equal(r.post, true);
  assert.equal(r.askAgain, true);
  const o = toUpdateRequest({ ...good(), kind: "office_notice", audience: "roles", roles: ["reviewer", "greeter"] }, {});
  assert.equal(o.irsLink, null);
  assert.deepEqual(o.roles, ["greeter", "reviewer"]);
  assert.equal(toUpdateRequest({ ...good(), irsLink: "  " }, {}).irsLink, null);
});

test("badgeCount", () => {
  assert.equal(badgeCount([
    { readAt: null },
    { readAt: "x", askConfirm: true, confirmedAt: null },
    { readAt: "x", askConfirm: true, confirmedAt: "y" }
  ]), 2);
  assert.equal(badgeCount([]), 0);
  assert.equal(badgeCount(undefined), 0);
});

test("isPinned", () => {
  assert.equal(isPinned("2026-11-13", "2026-11-13"), true);
  assert.equal(isPinned("2026-11-12", "2026-11-13"), false);
  assert.equal(isPinned(null, "2026-11-13"), false);
});

test("emptyUpdateForm", () => {
  const f = emptyUpdateForm();
  assert.equal(f.audience, "everyone");
  assert.deepEqual(f.roles, []);
  assert.equal(f.askConfirm, false);
  assert.equal(f.title, "");
});
