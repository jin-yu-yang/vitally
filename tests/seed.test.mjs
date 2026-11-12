import test from "node:test";
import assert from "node:assert/strict";
import {
  assertLocalSeedTarget,
  requireSeedFlag,
  parseSeedArgs,
  formatSeedResult,
} from "../tools/admin/seed-cases.mjs";
import { ROLE_ACCOUNT_CLEARANCE, SEED_VOLUNTEERS } from "../tools/admin/seed-values.mjs";
import { runSeed } from "../tools/admin/seed.mjs";

const code = (expected) => (error) => error.code === expected;

test("the seed flag is required", () => {
  assert.throws(() => requireSeedFlag({}), code("SEED_NOT_ALLOWED"));
  assert.throws(
    () => requireSeedFlag({ VITALLY_ALLOW_LOCAL_SEED: "true" }),
    code("SEED_NOT_ALLOWED"),
  );
  assert.doesNotThrow(() => requireSeedFlag({ VITALLY_ALLOW_LOCAL_SEED: "1" }));
});

test("a hosted target is rejected", async () => {
  await assert.rejects(
    assertLocalSeedTarget({ assert: async () => ({ mode: "hosted" }) }),
    code("TARGET_REJECTED"),
  );
});

test("a target the guards reject stays rejected", async () => {
  await assert.rejects(
    assertLocalSeedTarget({
      assert: async () => {
        throw Object.assign(new Error(), { code: "TARGET_REJECTED" });
      },
    }),
    code("TARGET_REJECTED"),
  );
});

test("a local target is returned", async () => {
  const approved = { mode: "local", databaseUrl: "postgres://x" };
  assert.deepEqual(
    await assertLocalSeedTarget({ assert: async () => approved }),
    approved,
  );
});

test("arguments default to the local roster and accept only --roster", () => {
  assert.deepEqual(parseSeedArgs([]), { rosterPath: ".vitally-roster.local.json" });
  assert.deepEqual(parseSeedArgs(["--roster", "a.json"]), { rosterPath: "a.json" });
  for (const argv of [["--target", "x"], ["--roster"]])
    assert.throws(
      () => parseSeedArgs(argv),
      (error) =>
        error.code === "SEED_USAGE" &&
        error.message === "Usage: seed.mjs [--roster <file.json>]",
    );
});

test("the result line names counts and no address", () => {
  const line = formatSeedResult({ casesRemoved: 11, casesCreated: 11 });
  assert.equal(line, "Seeded 11 cases (removed 11 from the previous run).");
  assert.ok(!line.includes("@"));
});

test("the result line counts the volunteers when the seed added them", () => {
  const line = formatSeedResult({ casesRemoved: 11, casesCreated: 11, volunteersCreated: 8 });
  assert.ok(line.includes("8 volunteers"));
  assert.ok(!line.includes("@"));
  assert.equal(
    formatSeedResult({ casesRemoved: 11, casesCreated: 11 }),
    "Seeded 11 cases (removed 11 from the previous run).",
  );
});

test("the seed volunteers cover every roster value and use example addresses", () => {
  assert.equal(SEED_VOLUNTEERS.length, 8);
  const seen = (key) => new Set(SEED_VOLUNTEERS.flatMap((v) => [].concat(v[key])));
  assert.deepEqual(
    [...seen("works")].sort(),
    ["on_site", "on_site_and_remote", "remote"],
  );
  assert.deepEqual(
    [...seen("languages")].sort(),
    ["cantonese", "english", "mandarin", "other"],
  );
  assert.deepEqual(
    [...seen("roles")].sort(),
    ["admin", "greeter", "intaker", "preparer", "reviewer"],
  );
  assert.deepEqual(
    [...seen("certificates")].sort(),
    ["advanced", "basic", "itqr", "sc", "vsc"],
  );
  for (const v of SEED_VOLUNTEERS) {
    assert.ok(v.email.endsWith("@example.org"));
    assert.equal(v.languages.includes("other"), Boolean(v.otherLanguage));
  }
  assert.equal(SEED_VOLUNTEERS.filter((v) => v.phone === null).length, 2);
});

test("every seed volunteer's roles are backed by their certificates", () => {
  const needs = {
    greeter: ["vsc"],
    intaker: ["vsc", "itqr"],
    admin: ["vsc", "itqr"],
    preparer: ["vsc", "itqr", "basic"],
    reviewer: ["vsc", "itqr", "advanced"],
  };
  for (const v of SEED_VOLUNTEERS) {
    assert.equal(typeof v.isNew, "boolean", v.name);
    assert.equal(typeof v.photoIdChecked, "boolean", v.name);
    for (const role of v.roles)
      for (const c of needs[role])
        assert.ok(v.certificates.includes(c), `${v.name}: ${role} needs ${c}`);
  }
  const waiting = SEED_VOLUNTEERS.filter((v) => v.roles.length === 0);
  assert.equal(waiting.length, 1);
  assert.deepEqual(waiting[0].certificates, []);
  assert.ok(SEED_VOLUNTEERS.some((v) => v.isNew && v.photoIdChecked));
  assert.ok(SEED_VOLUNTEERS.some((v) => v.isNew && !v.photoIdChecked));
});

test("the role accounts' clearance is fixed and backed", () => {
  const rc = ROLE_ACCOUNT_CLEARANCE;
  assert.deepEqual(Object.keys(rc).sort(), ["intaker", "preparer", "reviewer", "site_coordinator"]);
  assert.deepEqual(rc.site_coordinator, { roles: ["admin"], certificates: ["vsc", "itqr"], isNew: false });
  assert.deepEqual(rc.preparer, { roles: ["preparer"], certificates: ["vsc", "itqr", "basic"], isNew: false });
  assert.deepEqual(rc.reviewer, { roles: ["reviewer"], certificates: ["vsc", "itqr", "advanced"], isNew: false });
  assert.deepEqual(rc.intaker, { roles: ["intaker"], certificates: ["vsc", "itqr"], isNew: false });
});

test("the flag is checked before any file read or seeding", async () => {
  await assert.rejects(
    runSeed({
      argv: [],
      env: {},
      readFile: () => {
        throw new Error("read");
      },
      seed: () => {
        throw new Error("seed");
      },
    }),
    code("SEED_NOT_ALLOWED"),
  );
});

test("runSeed reads the roster and passes the workspace and client A", async () => {
  let received;
  const lines = [];
  await runSeed({
    argv: ["--roster", "r.json"],
    env: { VITALLY_ALLOW_LOCAL_SEED: "1" },
    readFile: async (path) => {
      assert.equal(path, "r.json");
      return JSON.stringify({ workspaceId: "w1", applicants: ["a@example.org"] });
    },
    seed: async (args) => {
      received = args;
      return { casesRemoved: 0, casesCreated: 3 };
    },
    log: (line) => lines.push(line),
  });
  assert.deepEqual(received, { workspaceId: "w1", clientAEmail: "a@example.org" });
  assert.deepEqual(lines, ["Seeded 3 cases (removed 0 from the previous run)."]);
});

test("an unreadable roster is reported without seeding", async () => {
  await assert.rejects(
    runSeed({
      argv: [],
      env: { VITALLY_ALLOW_LOCAL_SEED: "1" },
      readFile: async () => "not json",
      seed: () => {
        throw new Error("seed");
      },
    }),
    code("SEED_ROSTER_UNREADABLE"),
  );
});
