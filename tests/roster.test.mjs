import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {
  parseRoster,
  rosterNotes,
  parseRosterArgs,
  applyRoster,
} from "../tools/admin/roster.mjs";

const NOTE = "sampleCaseOwners is no longer used and was ignored.";
const WORKSPACE = "3f1c2b4a-8d7e-4f60-9a1b-2c3d4e5f6a7b";
const valid = () => ({
  workspaceId: WORKSPACE,
  presenters: ["  Presenter@Example.org "],
  applicants: ["client-a@example.org", "client-b@example.org"],
});
const invalid = (pattern) => (error) =>
  error.code === "ROSTER_INVALID" && pattern.test(error.message);

test("a roster is trimmed, lower-cased and kept in order", () => {
  assert.deepEqual(parseRoster(valid()), {
    workspaceId: WORKSPACE,
    presenters: ["presenter@example.org"],
    applicants: ["client-a@example.org", "client-b@example.org"],
    staff: [],
    defaultFollowup: null,
  });
});

test("an old roster's sampleCaseOwners is ignored with a note", () => {
  const old = { ...valid(), sampleCaseOwners: { preparation_ready: "client-a@example.org" } };
  const parsed = parseRoster(old);
  assert.equal("sampleCaseOwners" in parsed, false);
  assert.deepEqual(rosterNotes(old), [NOTE]);
  assert.deepEqual(rosterNotes(valid()), []);
  assert.doesNotThrow(() => parseRoster({ ...valid(), sampleCaseOwners: "anything" }));
  assert.doesNotThrow(() => parseRoster({ ...valid(), sampleCaseOwners: null }));
  assert.deepEqual(rosterNotes({ ...valid(), sampleCaseOwners: null }), [NOTE]);
});

test("a malformed roster names the problem, never the address", () => {
  assert.throws(() => parseRoster(null), invalid(/JSON object/));
  assert.throws(
    () => parseRoster({ ...valid(), workspaceId: "not-a-uuid" }),
    invalid(/workspaceId/),
  );
  assert.throws(
    () => parseRoster({ ...valid(), presenters: [] }),
    invalid(/at least one presenter/),
  );
  assert.throws(
    () => parseRoster({ ...valid(), applicants: "client@example.org" }),
    invalid(/applicants must be a list/),
  );
  const badAddress = { ...valid(), applicants: ["ok@example.org", "no at sign"] };
  assert.throws(() => parseRoster(badAddress), (error) =>
    invalid(/applicants\[1\]/)(error) && !error.message.includes("no at sign"),
  );
  const twice = { ...valid(), applicants: ["PRESENTER@example.org"] };
  assert.throws(() => parseRoster(twice), (error) =>
    invalid(/applicants\[0\] is already on the roster/)(error) &&
    !/presenter@/i.test(error.message),
  );
});

test("the command needs an explicit target and a roster file", () => {
  assert.deepEqual(
    parseRosterArgs(["--target", "test", "--roster", "roster.json"]),
    { target: { kind: "test" }, rosterPath: "roster.json" },
  );
  assert.deepEqual(
    parseRosterArgs(["--roster", "r.json", "--target", "classroom"]),
    { target: { kind: "classroom" }, rosterPath: "r.json" },
  );
  for (const argv of [
    [],
    ["--roster", "r.json"],
    ["--target", "production", "--roster", "r.json"],
    ["--target", "test"],
    ["--target", "test", "--roster"],
    ["--target", "test", "--roster", "r.json", "--extra"],
  ])
    assert.throws(() => parseRosterArgs(argv), (error) => error.code === "ROSTER_USAGE");
});

function fakeAdmin(existing, { failCreate = false, perPage } = {}) {
  const calls = { list: [], create: [], confirm: [] };
  const users = existing.map((user) => ({ ...user }));
  let next = 1;
  const admin = {
    auth: {
      admin: {
        async listUsers({ page, perPage: size }) {
          calls.list.push({ page, perPage: size });
          const limit = perPage ?? size;
          return {
            data: { users: users.slice((page - 1) * limit, page * limit) },
            error: null,
          };
        },
        async createUser(attributes) {
          calls.create.push(attributes);
          if (failCreate)
            return { data: { user: null }, error: { message: `boom for ${attributes.email}` } };
          const user = {
            id: `00000000-0000-4000-8000-00000000000${next++}`,
            email: attributes.email,
            email_confirmed_at: "now",
          };
          users.push(user);
          return { data: { user }, error: null };
        },
        async updateUserById(id, attributes) {
          calls.confirm.push({ id, attributes });
          return { data: { user: { id } }, error: null };
        },
      },
    },
  };
  return { admin, calls };
}

test("missing accounts are created confirmed, and the workspace gets their ids", async () => {
  const { admin, calls } = fakeAdmin([
    { id: "aaaaaaaa-0000-4000-8000-000000000001", email: "presenter@example.org", email_confirmed_at: "then" },
    { id: "bbbbbbbb-0000-4000-8000-000000000002", email: "Client-B@Example.org", email_confirmed_at: null },
    { id: "cccccccc-0000-4000-8000-000000000003", email: "someone-else@example.org", email_confirmed_at: "then" },
  ]);
  const setups = [];
  const result = await applyRoster(parseRoster(valid()), {
    admin,
    initialize: async (setup) => {
      setups.push(setup);
      return { workspaceId: setup.workspaceId };
    },
  });
  assert.deepEqual(calls.create, [
    { email: "client-a@example.org", email_confirm: true },
  ]);
  assert.equal("password" in calls.create[0], false);
  assert.deepEqual(calls.confirm, [
    { id: "bbbbbbbb-0000-4000-8000-000000000002", attributes: { email_confirm: true } },
  ]);
  assert.deepEqual(setups, [
    {
      workspaceId: WORKSPACE,
      presenterUserIds: ["aaaaaaaa-0000-4000-8000-000000000001"],
      applicantUserIds: [
        "00000000-0000-4000-8000-000000000001",
        "bbbbbbbb-0000-4000-8000-000000000002",
      ],
      staff: [],
      defaultFollowup: null,
    },
  ]);
  assert.deepEqual(result, {
    workspaceId: WORKSPACE,
    presenters: 1,
    applicants: 2,
    staff: 0,
    created: 1,
    confirmed: 1,
  });
});

test("every page of existing accounts is read before anything is created", async () => {
  const existing = Array.from({ length: 5 }, (_, i) => ({
    id: `dddddddd-0000-4000-8000-00000000000${i}`,
    email: `filler-${i}@example.org`,
    email_confirmed_at: "then",
  }));
  existing.push({
    id: "eeeeeeee-0000-4000-8000-000000000009",
    email: "presenter@example.org",
    email_confirmed_at: "then",
  });
  const { admin, calls } = fakeAdmin(existing, { perPage: 2 });
  await applyRoster(
    parseRoster({ workspaceId: WORKSPACE, presenters: ["presenter@example.org"], applicants: [] }),
    { admin, initialize: async () => ({}), perPage: 2 },
  );
  assert.deepEqual(calls.list.map((call) => call.page), [1, 2, 3, 4]);
  assert.deepEqual(calls.create, []);
});

test("an account failure stops before the workspace changes and hides the address", async () => {
  const { admin } = fakeAdmin([], { failCreate: true });
  let initialized = false;
  await assert.rejects(
    applyRoster(parseRoster(valid()), {
      admin,
      initialize: async () => {
        initialized = true;
      },
    }),
    (error) =>
      error.code === "ROSTER_ACCOUNT_FAILED" &&
      /presenters\[0\]/.test(error.message) &&
      !error.message.includes("@"),
  );
  assert.equal(initialized, false);
});

const riley = (extra = {}) => ({
  email: " Riley@Example.org ",
  name: "Riley Park",
  personKey: "riley",
  capabilities: ["prepare", "followup"],
  ...extra,
});
const withStaff = (staff = [riley()], extra = {}) => ({ ...valid(), staff, ...extra });
const hasNoAddress = (error) => !/@/.test(error.message);
const refused = (pattern) => (error) =>
  invalid(pattern)(error) && hasNoAddress(error);

test("a staff entry parses, with its address normalised", () => {
  const roster = parseRoster(withStaff());
  assert.deepEqual(roster.staff, [
    {
      email: "riley@example.org",
      name: "Riley Park",
      personKey: "riley",
      capabilities: ["prepare", "followup"],
    },
  ]);
  assert.equal(roster.defaultFollowup, null);
});

test("presenters may be absent when staff exist, if a defaultFollowup is named", () => {
  const { presenters, ...noPresenters } = withStaff([riley()], { defaultFollowup: "riley" });
  const roster = parseRoster(noPresenters);
  assert.deepEqual(roster.presenters, []);
  assert.equal(roster.defaultFollowup, "riley");
  assert.throws(
    () => parseRoster({ ...noPresenters, presenters: [], defaultFollowup: undefined }),
    refused(/A roster with no presenter needs a defaultFollowup\./),
  );
  assert.throws(
    () => parseRoster((({ presenters, ...rest }) => rest)(withStaff())),
    refused(/A roster with no presenter needs a defaultFollowup\./),
  );
});

test("clients alone are not a roster", () => {
  const { presenters, ...clients } = valid();
  assert.throws(
    () => parseRoster(clients),
    refused(/The roster needs at least one presenter or staff member\./),
  );
  assert.throws(
    () => parseRoster({ ...clients, staff: [] }),
    refused(/The roster needs at least one presenter or staff member\./),
  );
});

test("staff entries are validated before any account is made", () => {
  for (const [entry, pattern] of [
    [riley({ personKey: "sam" }), /staff\[0\]\.personKey/],
    [riley({ personKey: "alex" }), /staff\[0\]\.personKey/],
    [riley({ personKey: "morgan" }), /staff\[0\]\.personKey/],
    [riley({ personKey: "Riley" }), /staff\[0\]\.personKey/],
    [riley({ personKey: "9riley" }), /staff\[0\]\.personKey/],
    [riley({ personKey: "r".repeat(41) }), /staff\[0\]\.personKey/],
    [riley({ name: "" }), /staff\[0\]\.name/],
    [riley({ name: "x".repeat(81) }), /staff\[0\]\.name/],
    [riley({ capabilities: ["teach"] }), /staff\[0\]\.capabilities/],
    [riley({ capabilities: [] }), /staff\[0\]\.capabilities/],
    [riley({ capabilities: "prepare" }), /staff\[0\]\.capabilities/],
    [riley({ email: "no at sign" }), /staff\[0\]/],
    ["riley", /staff\[0\]/],
  ])
    assert.throws(() => parseRoster(withStaff([entry])), refused(pattern));
  for (const capability of ["prepare", "review", "admin", "followup", "receive_documents", "assist"])
    parseRoster(withStaff([riley({ capabilities: [capability] })]));
  assert.throws(() => parseRoster({ ...valid(), staff: "riley" }), refused(/staff must be a list/));
});

test("staff people and addresses are never listed twice", () => {
  const second = riley({ email: "other@example.org", name: "Other Person" });
  assert.throws(
    () => parseRoster(withStaff([riley(), second])),
    refused(/staff\[1\]\.personKey is already on the roster/),
  );
  assert.throws(
    () => parseRoster(withStaff([riley(), { ...second, personKey: "other", email: "RILEY@example.org" }])),
    refused(/staff\[1\] is already on the roster/),
  );
  assert.throws(
    () => parseRoster(withStaff([riley({ email: "presenter@example.org" })])),
    refused(/is already on the roster/),
  );
  // Review Focus 4: case and spacing do not hide a duplicate.
  assert.throws(
    () => parseRoster({ ...withStaff(), applicants: ["riley@example.org"] }),
    refused(/is already on the roster/),
  );
});

test("defaultFollowup must name a staff entry that can do follow-up", () => {
  const prep = riley({ personKey: "pat", email: "pat@example.org", capabilities: ["prepare"] });
  assert.equal(
    parseRoster(withStaff([riley(), prep], { defaultFollowup: "riley" })).defaultFollowup,
    "riley",
  );
  assert.throws(
    () => parseRoster(withStaff([riley()], { defaultFollowup: "nobody" })),
    refused(/defaultFollowup/),
  );
  assert.throws(
    () => parseRoster(withStaff([riley(), prep], { defaultFollowup: "pat" })),
    refused(/defaultFollowup/),
  );
  assert.throws(
    () => parseRoster(withStaff([riley()], { defaultFollowup: 7 })),
    refused(/defaultFollowup/),
  );
});

test("staff accounts are provisioned and their ids reach the workspace", async () => {
  const { admin, calls } = fakeAdmin([
    { id: "aaaaaaaa-0000-4000-8000-000000000001", email: "presenter@example.org", email_confirmed_at: "then" },
  ]);
  const setups = [];
  const roster = parseRoster(withStaff([riley()], { defaultFollowup: "riley" }));
  const result = await applyRoster(roster, {
    admin,
    initialize: async (setup) => {
      setups.push(setup);
    },
  });
  assert.deepEqual(
    calls.create.map((call) => call.email).sort(),
    ["client-a@example.org", "client-b@example.org", "riley@example.org"],
  );
  assert.equal(setups.length, 1);
  const [riley_] = setups[0].staff;
  assert.deepEqual(Object.keys(riley_).sort(), ["capabilities", "name", "personKey", "userId"]);
  assert.equal(riley_.personKey, "riley");
  assert.equal(riley_.name, "Riley Park");
  assert.deepEqual(riley_.capabilities, ["prepare", "followup"]);
  assert.match(riley_.userId, /^00000000-0000-4000-8000-00000000000\d$/);
  assert.equal(setups[0].defaultFollowup, "riley");
  assert.equal(result.staff, 1);
  assert.equal(JSON.stringify(result).includes("@"), false);
});

test("a staff account failure names the position, not the address", async () => {
  const { admin } = fakeAdmin([], { failCreate: true });
  const roster = parseRoster({ workspaceId: WORKSPACE, staff: [riley()], defaultFollowup: "riley" });
  await assert.rejects(
    applyRoster(roster, { admin, initialize: async () => assert.fail("must not initialize") }),
    (error) =>
      error.code === "ROSTER_ACCOUNT_FAILED" &&
      /staff\[0\]/.test(error.message) &&
      !error.message.includes("@"),
  );
});

test("the example roster parses and names the role accounts", () => {
  const example = JSON.parse(readFileSync("tools/admin/roster.example.json", "utf8"));
  const roster = parseRoster({ ...example, workspaceId: WORKSPACE });
  assert.deepEqual(
    roster.staff.map(({ personKey, capabilities }) => [personKey, capabilities]),
    [
      ["site_coordinator", ["admin", "followup", "assist", "receive_documents"]],
      ["preparer", ["prepare"]],
      ["reviewer", ["review"]],
      ["intaker", ["receive_documents", "assist"]],
    ],
  );
  assert.equal(roster.defaultFollowup, "site_coordinator");
  assert.deepEqual(roster.applicants, ["client-a@example.org"]);
  assert.deepEqual(roster.presenters, ["presenter@example.org"]);
});

test("the roster command prints the sampleCaseOwners note once", () => {
  const dir = mkdtempSync(join(tmpdir(), "roster-cli-"));
  try {
    const script = fileURLToPath(new URL("../tools/admin/roster.mjs", import.meta.url));
    // No SUPABASE_* or database variables: the target check rejects the run
    // after the note is printed, so nothing reaches a database.
    const env = {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      HOME: dir,
      USERPROFILE: dir,
    };
    const run = (roster) => {
      const file = join(dir, "roster.json");
      writeFileSync(file, JSON.stringify(roster));
      return spawnSync(
        process.execPath,
        [script, "--target", "test", "--roster", file],
        { cwd: dir, env, encoding: "utf8" },
      );
    };
    const withKey = run({
      ...valid(),
      workspaceId: crypto.randomUUID(),
      sampleCaseOwners: { preparation_ready: "client-a@example.org" },
    });
    assert.match(withKey.stderr, /Roster failed \(TARGET_REJECTED\)/);
    assert.equal(withKey.stdout.split(NOTE).length - 1, 1);
    const without = run({ ...valid(), workspaceId: crypto.randomUUID() });
    assert.match(without.stderr, /Roster failed \(TARGET_REJECTED\)/);
    assert.equal(without.stdout.includes(NOTE), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
