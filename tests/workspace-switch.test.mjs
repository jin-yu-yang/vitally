import test from "node:test";
import assert from "node:assert/strict";
import { workspaceSide, hasWorkspaceSwitch } from "../src/contracts.mjs";
import { ROLE_CAPABILITIES } from "../src/volunteer-workload.mjs";

// OpenSpec change add-workspace-switch, design D1: the side rule.
const staff = { access: "staff" };
const person = (...roles) => ({
  id: "p1",
  name: "Test Person",
  capabilities: [...new Set(roles.flatMap((r) => ROLE_CAPABILITIES[r]))],
});

test("workspaceSide follows the person's sides", () => {
  for (const preferred of [undefined, "office", "cases", "junk"]) {
    assert.equal(workspaceSide(staff, person("admin"), preferred), "office");
  }
  assert.equal(workspaceSide(staff, person("intaker")), "office");
  for (const role of ["preparer", "reviewer", "greeter"]) {
    assert.equal(workspaceSide(staff, person(role), "office"), "cases");
  }
  for (const [a, b] of [["admin", "reviewer"], ["intaker", "preparer"]]) {
    const p = person(a, b);
    for (const preferred of [undefined, "office", "junk"]) {
      assert.equal(workspaceSide(staff, p, preferred), "office");
    }
    assert.equal(workspaceSide(staff, p, "cases"), "cases");
  }
  assert.equal(workspaceSide(staff, null, "office"), "cases");
});

test("hasWorkspaceSwitch needs staff access and both sides", () => {
  assert.equal(hasWorkspaceSwitch(staff, person("admin", "reviewer")), true);
  assert.equal(hasWorkspaceSwitch(staff, person("intaker", "preparer")), true);
  for (const role of ["admin", "intaker", "preparer", "reviewer", "greeter"]) {
    assert.equal(hasWorkspaceSwitch(staff, person(role)), false);
  }
  assert.equal(hasWorkspaceSwitch({ access: "applicant" }, person("admin", "reviewer")), false);
  assert.equal(hasWorkspaceSwitch(staff, null), false);
});

// ---------------------------------------------------------------------------
// Task 3: the staff frame follows the side (design D4, D5).
// ---------------------------------------------------------------------------
import { staffScreen } from "../src/views.mjs";
import { cleared } from "./support/clearance.mjs";

const draw = (roles, extra = {}, { clearance = cleared({ isAdmin: roles.includes("admin") }), people } = {}) =>
  staffScreen({
    principal: { access: "staff", personId: "p1", personName: "Test Person", clearance },
    connection: "online",
    people: people ?? [person(...roles)],
    cases: [],
    assistance: [],
    screen: "staff",
    ...extra,
  });
// The sidebar itself is aria-label="Workspace", so the switch is the group.
const SWITCH = /role="group" aria-label="Workspace"/;

test("an admin-reviewer defaults to Office with the switch", () => {
  const html = draw(["admin", "reviewer"]);
  assert.match(html, /role="group" aria-label="Workspace"/);
  assert.match(html, /data-action="set-workspace-side"[^>]*data-side="office"[^>]*aria-pressed="true"[^>]*>Office/);
  assert.match(html, /data-side="cases"[^>]*aria-pressed="false"[^>]*>Cases/);
  assert.match(html, /Follow-ups/);
  assert.match(html, /All cases/);
});

test("workspaceSide cases draws the work board", () => {
  const html = draw(["admin", "reviewer"], { workspaceSide: "cases" });
  assert.match(html, /Work board/);
  assert.match(html, /data-side="cases"[^>]*aria-pressed="true"/);
  assert.doesNotMatch(html, /All cases/);
  assert.doesNotMatch(html, /data-action="open-cases"/);
});

test("an Intaker gets Follow-ups and no switch", () => {
  const html = draw(["intaker"]);
  assert.match(html, /Follow-ups/);
  assert.doesNotMatch(html, SWITCH);
  assert.doesNotMatch(html, /data-action="open-cases"/);
  assert.doesNotMatch(html, /data-action="open-add-case"/);
});

test("one side only has no switch", () => {
  for (const role of ["admin", "reviewer", "greeter"]) {
    const html = draw([role]);
    assert.doesNotMatch(html, SWITCH, role);
    assert.match(html, role === "admin" ? /Follow-ups/ : /Work board/, role);
  }
  assert.match(draw(["admin"]), /data-action="open-add-case"/);
});

test("a person not yet loaded draws the work board", () => {
  const html = draw([], {}, { people: [] });
  assert.match(html, /Work board/);
  assert.doesNotMatch(html, SWITCH);
});

test("the setup screen has no switch", () => {
  const html = draw(["admin", "reviewer"], {}, { clearance: { ...cleared({ isAdmin: true }), cleared: false, missing: [] } });
  assert.doesNotMatch(html, SWITCH);
});

test("Workload follows admin on either side", () => {
  for (const workspaceSide of ["office", "cases"]) {
    const html = draw(["admin", "reviewer"], { screen: "office-volunteers", workspaceSide });
    assert.match(html, /Workload/, workspaceSide);
  }
  assert.doesNotMatch(draw(["intaker"], { screen: "office-volunteers" }), /Workload/);
});

test("a stored office screen on Cases falls back to the board", () => {
  const html = draw(["admin", "reviewer"], { screen: "office-cases", workspaceSide: "cases" });
  assert.match(html, /Work board/);
  assert.doesNotMatch(html, /Case pool/);
  assert.match(draw(["admin", "reviewer"], { screen: "office-cases" }), /Case pool/);
});

test("one record draws both case pages", () => {
  const savedCase = {
    id: "c1", reference: "VT-TEST-0001", stage: "preparing", revision: 1, answers: {},
    participants: [], reviews: [],
  };
  const office = draw(["admin", "reviewer"], { screen: "staff-case", savedCase });
  assert.match(office, /OFFICE WORKSPACE/);
  const cases = draw(["admin", "reviewer"], { screen: "staff-case", savedCase, workspaceSide: "cases" });
  assert.match(cases, /VOLUNTEER WORKSPACE/);
  assert.doesNotMatch(cases, /Staff sections are not loaded/);
});
