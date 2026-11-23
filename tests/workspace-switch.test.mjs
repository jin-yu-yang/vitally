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
