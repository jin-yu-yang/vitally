import test from "node:test";
import assert from "node:assert/strict";
import {
  assertLocalSeedTarget,
  requireSeedFlag,
  parseSeedArgs,
  formatSeedResult,
} from "../tools/admin/seed-cases.mjs";
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
