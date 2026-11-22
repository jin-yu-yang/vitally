import test from "node:test";
import assert from "node:assert/strict";
import { ceilingAdmin, missingLines, reviewLine, uploadItems, siteCoordinator, withOwnCapabilities } from "../src/clearance.mjs";

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

test("siteCoordinator reads isSiteCoordinator and is false without a clearance", () => {
  assert.equal(siteCoordinator({ clearance: clearance({ isAdmin: true, isSiteCoordinator: true }) }), true);
  assert.equal(siteCoordinator({ clearance: clearance({ isAdmin: true }) }), false);
  assert.equal(siteCoordinator({ clearance: clearance({ isSiteCoordinator: "yes" }) }), false);
  assert.equal(siteCoordinator({ access: "applicant" }), false);
  assert.equal(siteCoordinator(null), false);
});

test("missingLines says a site coordinator needs the SC certificate, after the roles", () => {
  const lines = missingLines(
    clearance({
      missing: [
        { kind: "role", role: "admin", certificates: ["IT&QR"] },
        { kind: "siteCoordinator", certificates: ["SC"] },
      ],
    }),
  );
  assert.deepEqual(lines, ["Admin needs IT&QR.", "Site coordinators need the SC certificate."]);
});

test("uploadItems gives the two upload kinds with their lines and sent times", () => {
  const items = uploadItems(
    clearance({
      missing: [
        { kind: "form13615", sentAt: "2026-11-20T15:00:00Z" },
        { kind: "photoId", sentAt: null },
        { kind: "role", role: "greeter", certificates: ["IT&QR"] },
      ],
    }),
  );
  assert.deepEqual(items, [
    { document: "form13615", line: "Upload your signed Form 13615.", sentAt: "2026-11-20T15:00:00Z", reviewedAt: null, reviewReason: null },
    { document: "photoId", line: "Have your photo ID checked.", sentAt: null, reviewedAt: null, reviewReason: null },
  ]);
  assert.deepEqual(uploadItems(null), []);
  assert.equal(uploadItems(clearance({ missing: [{ kind: "form13615" }] }))[0].sentAt, null);
});

test("uploadItems carries the review", () => {
  const items = uploadItems(
    clearance({
      missing: [
        { kind: "form13615", sentAt: null, reviewedAt: "2026-11-20T15:00:00Z", reviewReason: "Not signed" },
        { kind: "photoId" },
      ],
    }),
  );
  assert.equal(items[0].reviewedAt, "2026-11-20T15:00:00Z");
  assert.equal(items[0].reviewReason, "Not signed");
  assert.equal(items[1].reviewedAt, null);
  assert.equal(items[1].reviewReason, null);
});

test("reviewLine is null with a sent date or no reason", () => {
  assert.equal(reviewLine({ document: "form13615", sentAt: "2026-11-20T15:00:00Z", reviewReason: "Not signed" }), null);
  assert.equal(reviewLine({ document: "form13615", sentAt: null, reviewReason: null }), null);
  assert.equal(reviewLine({ document: "photoId", sentAt: null }), null);
});

test("only the exact quick pick is already on file", () => {
  assert.equal(
    reviewLine({ document: "form13615", sentAt: null, reviewReason: "Already on file" }),
    "Your site coordinator says this is already on file. You don't need to send it again.",
  );
  assert.equal(
    reviewLine({ document: "form13615", sentAt: null, reviewReason: "already on file" }),
    "Your site coordinator looked at this: already on file. Please send it again or ask them.",
  );
});

test("a photo ID is never already on file", () => {
  assert.equal(
    reviewLine({ document: "photoId", sentAt: null, reviewReason: "Already on file" }),
    "Your site coordinator looked at this: Already on file. Please send it again or ask them.",
  );
});

test("a note's own ending . ! or ? is not doubled", () => {
  for (const mark of [".", "!", "?"])
    assert.equal(
      reviewLine({ document: "form13615", sentAt: null, reviewReason: `Please re-sign${mark}` }),
      "Your site coordinator looked at this: Please re-sign. Please send it again or ask them.",
    );
  assert.equal(
    reviewLine({ document: "form13615", sentAt: null, reviewReason: "Page 2 is missing. " }),
    "Your site coordinator looked at this: Page 2 is missing. Please send it again or ask them.",
  );
  assert.equal(
    reviewLine({ document: "form13615", sentAt: null, reviewReason: "Already on file" }),
    "Your site coordinator says this is already on file. You don't need to send it again.",
  );
});

test("a note is quoted in the generic line", () => {
  assert.equal(
    reviewLine({ document: "form13615", sentAt: null, reviewReason: "Page 2 is missing" }),
    "Your site coordinator looked at this: Page 2 is missing. Please send it again or ask them.",
  );
});
