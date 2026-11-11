import test from "node:test";
import assert from "node:assert/strict";
import { ceilingAdmin, missingLines, withOwnCapabilities } from "../src/clearance.mjs";

const clearance = (extra = {}) => ({
  cleared: false,
  missing: [],
  capabilities: ["prepare"],
  isAdmin: false,
  siteCoordinatorName: null,
  ...extra,
});

test("withOwnCapabilities replaces only the signed-in person's capabilities", () => {
  const people = [
    { id: "p1", name: "Sam", capabilities: ["prepare", "review"] },
    { id: "p2", name: "Lee", capabilities: ["prepare", "review"] },
  ];
  const result = withOwnCapabilities(people, { personId: "p1", clearance: clearance() });
  assert.deepEqual(result[0], { id: "p1", name: "Sam", capabilities: ["prepare"] });
  assert.equal(result[1], people[1]);
  assert.deepEqual(people[0].capabilities, ["prepare", "review"]);
});

test("withOwnCapabilities leaves people alone without a clearance or a person", () => {
  const people = [{ id: "p1", capabilities: ["admin"] }];
  assert.equal(withOwnCapabilities(people, { access: "applicant" }), people);
  assert.equal(withOwnCapabilities(people, null), people);
  assert.equal(withOwnCapabilities(people, { personId: null, clearance: clearance() }), people);
});

test("withOwnCapabilities gives an empty list to an uncleared person with none", () => {
  const people = [{ id: "p1", capabilities: ["admin"] }];
  const result = withOwnCapabilities(people, { personId: "p1", clearance: clearance({ capabilities: [] }) });
  assert.deepEqual(result[0].capabilities, []);
});

test("ceilingAdmin reads isAdmin and is false without a clearance", () => {
  assert.equal(ceilingAdmin({ clearance: clearance({ isAdmin: true }) }), true);
  assert.equal(ceilingAdmin({ clearance: clearance() }), false);
  assert.equal(ceilingAdmin({ access: "applicant" }), false);
  assert.equal(ceilingAdmin(null), false);
});

test("missingLines gives the copy in order: Form 13615, photo ID, then roles", () => {
  const lines = missingLines(
    clearance({
      missing: [
        { kind: "form13615" },
        { kind: "photoId" },
        { kind: "role", role: "preparer", certificates: ["IT&QR", "Basic or Advanced"] },
        { kind: "role", role: "greeter", certificates: ["IT&QR"] },
      ],
    }),
  );
  assert.deepEqual(lines, [
    "Upload your signed Form 13615.",
    "Have your photo ID checked.",
    "Preparer needs IT&QR and Basic or Advanced.",
    "Greeter needs IT&QR.",
  ]);
  assert.deepEqual(missingLines(clearance()), []);
});
