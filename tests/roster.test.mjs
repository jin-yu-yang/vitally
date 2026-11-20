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
  rosterLinkNotes,
  parseRosterArgs,
  applyRoster,
} from "../tools/admin/roster.mjs";

const NOTE = "sampleCaseOwners is no longer used and was ignored.";
const PRESENTER_NOTE =
  "presenters is no longer used and was ignored; those addresses get no access.";
const CAPABILITIES_NOTE =
  "capabilities is no longer used and was ignored; roles on the Roster decide what each person can do.";
const SITE_NUMBER_NOTE =
  "siteNumber is no longer used and was ignored; set the SIDN on Season settings.";
const DEFAULT_FOLLOWUP_ERROR = "defaultFollowup must name a staff entry with siteCoordinator: true.";
const WORKSPACE = "3f1c2b4a-8d7e-4f60-9a1b-2c3d4e5f6a7b";
const riley = (extra = {}) => ({
  email: " Riley@Example.org ",
  name: "Riley Park",
  personKey: "riley",
  siteCoordinator: true,
  ...extra,
});
const valid = () => ({
  workspaceId: WORKSPACE,
  staff: [riley()],
  defaultFollowup: "riley",
  applicants: ["client-a@example.org", "client-b@example.org"],
});
const invalid = (pattern) => (error) =>
  error.code === "ROSTER_INVALID" && pattern.test(error.message);

test("a roster is trimmed, lower-cased and kept in order", () => {
  assert.deepEqual(parseRoster(valid()), {
    workspaceId: WORKSPACE,
    applicants: ["client-a@example.org", "client-b@example.org"],
    staff: [
      {
        email: "riley@example.org",
        name: "Riley Park",
        personKey: "riley",
        siteCoordinator: true,
      },
    ],
    defaultFollowup: "riley",
    notices: [],
  });
});

// Change add-season-settings (design D9): the SIDN is set on Season settings,
// so an old roster's siteNumber (add-account-invitations, D12) is ignored,
// whatever it holds, and never reaches the workspace. Fictional numbers only.
test("an old roster's siteNumber is ignored with a notice", async () => {
  for (const old of ["S00000000", " s0000-0000 ", "not a number", 12345678, null]) {
    const raw = { ...valid(), siteNumber: old };
    const parsed = parseRoster(raw);
    assert.equal("siteNumber" in parsed, false);
    assert.deepEqual(parsed.notices, [SITE_NUMBER_NOTE]);
    assert.deepEqual(rosterNotes(raw), [SITE_NUMBER_NOTE]);
  }
  const setups = [];
  await applyRoster(parseRoster({ ...valid(), siteNumber: "S00000000" }), {
    admin: fakeAdmin([]).admin,
    initialize: async (setup) => setups.push(setup),
  });
  assert.equal("siteNumber" in setups[0], false);
});

test("an old roster's capabilities are ignored with one notice", async () => {
  // Values the removed capabilities checks refused (an unknown capability,
  // followup without admin, not a list) are all accepted now.
  const kai = riley({
    email: "kai@example.org",
    name: "Kai Mensah",
    personKey: "kai",
    siteCoordinator: false,
    capabilities: ["followup", "assist"],
  });
  const lee = riley({ email: "lee@example.org", personKey: "lee", capabilities: "prepare" });
  const raw = withStaff([riley({ capabilities: ["teach"] }), kai, lee]);
  const parsed = parseRoster(raw);
  assert.deepEqual(parsed.notices, [CAPABILITIES_NOTE]);
  assert.deepEqual(rosterNotes(raw), [CAPABILITIES_NOTE]);
  for (const entry of parsed.staff) assert.equal("capabilities" in entry, false);
  const setups = [];
  await applyRoster(parsed, {
    admin: fakeAdmin([]).admin,
    initialize: async (setup) => setups.push(setup),
  });
  for (const entry of setups[0].staff) assert.equal("capabilities" in entry, false);
  assert.deepEqual(rosterNotes(valid()), []);
  // Every note, in a fixed order.
  assert.deepEqual(
    rosterNotes({ ...raw, siteNumber: "S00000000", sampleCaseOwners: {}, presenters: [] }),
    [NOTE, PRESENTER_NOTE, CAPABILITIES_NOTE, SITE_NUMBER_NOTE],
  );
});

test("siteCoordinator is optional, and must be true or false when given", () => {
  const lee = (extra) =>
    riley({ email: "lee@example.org", name: "Lee Park", personKey: "lee", ...extra });
  const { siteCoordinator, ...plain } = lee({});
  const lou = lee({ personKey: "lou", email: "lou@example.org", siteCoordinator: false });
  const parsed = parseRoster(withStaff([riley(), plain, lou]));
  assert.deepEqual(parsed.staff.map((m) => m.siteCoordinator), [true, false, false]);
  for (const bad of ["true", "yes", 1, 0, null, [], {}])
    assert.throws(
      () => parseRoster(withStaff([riley(), lee({ siteCoordinator: bad })])),
      refused(/^staff\[1\]\.siteCoordinator must be true or false\.$/),
    );
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

test("an old roster's presenters are ignored with a note", async () => {
  const old = { ...valid(), presenters: ["presenter@example.org"] };
  const parsed = parseRoster(old);
  assert.equal("presenters" in parsed, false);
  assert.deepEqual(rosterNotes(old), [PRESENTER_NOTE]);
  assert.deepEqual(rosterNotes(valid()), []);
  assert.doesNotThrow(() => parseRoster({ ...valid(), presenters: "anything" }));
  // Review Focus 3: both notes print, and no account is made for the presenter.
  const both = { ...old, sampleCaseOwners: { preparation_ready: "client-a@example.org" } };
  assert.deepEqual(rosterNotes(both), [NOTE, PRESENTER_NOTE]);
  const { admin, calls } = fakeAdmin([]);
  await applyRoster(parseRoster(both), { admin, initialize: async () => ({}) });
  assert.equal(
    calls.create.some((call) => call.email === "presenter@example.org"),
    false,
  );
});

test("a roster with no defaultFollowup is refused", () => {
  const { defaultFollowup, ...none } = valid();
  for (const roster of [none, { ...none, defaultFollowup: null }])
    assert.throws(
      () => parseRoster(roster),
      (error) => refused(/defaultFollowup/)(error) && error.message === DEFAULT_FOLLOWUP_ERROR,
    );
});

test("a roster with no staff is refused", () => {
  const { staff, ...none } = valid();
  assert.throws(() => parseRoster(none), refused(/at least one staff member/));
  assert.throws(() => parseRoster({ ...none, staff: [] }), refused(/at least one staff member/));
});

test("any valid key is accepted by the parser", () => {
  for (const personKey of ["sam", "alex", "morgan"])
    assert.equal(
      parseRoster(withStaff([riley({ personKey })], { defaultFollowup: personKey })).staff[0].personKey,
      personKey,
    );
});

test("a malformed roster names the problem, never the address", () => {
  assert.throws(() => parseRoster(null), invalid(/JSON object/));
  assert.throws(
    () => parseRoster({ ...valid(), workspaceId: "not-a-uuid" }),
    invalid(/workspaceId/),
  );
  assert.throws(
    () => parseRoster({ ...valid(), applicants: "client@example.org" }),
    invalid(/applicants must be a list/),
  );
  const badAddress = { ...valid(), applicants: ["ok@example.org", "no at sign"] };
  assert.throws(() => parseRoster(badAddress), (error) =>
    invalid(/applicants\[1\]/)(error) && !error.message.includes("no at sign"),
  );
  const twice = { ...valid(), applicants: ["RILEY@example.org"] };
  assert.throws(() => parseRoster(twice), (error) =>
    invalid(/applicants\[0\] is already on the roster/)(error) &&
    !/riley@/i.test(error.message),
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
    { id: "aaaaaaaa-0000-4000-8000-000000000001", email: "riley@example.org", email_confirmed_at: "then" },
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
      applicantUserIds: [
        "00000000-0000-4000-8000-000000000001",
        "bbbbbbbb-0000-4000-8000-000000000002",
      ],
      staff: [
        {
          userId: "aaaaaaaa-0000-4000-8000-000000000001",
          personKey: "riley",
          name: "Riley Park",
          siteCoordinator: true,
        },
      ],
      defaultFollowup: "riley",
    },
  ]);
  assert.deepEqual(result, {
    workspaceId: WORKSPACE,
    applicants: 2,
    staff: 1,
    created: 1,
    confirmed: 1,
    linked: [],
  });
});

test("applyRoster reports the links initialize returns", async () => {
  const linked = [{ personKey: "riley", nameDiffers: true }];
  const { admin } = fakeAdmin([]);
  const result = await applyRoster(parseRoster(valid()), {
    admin,
    initialize: async () => ({ linked }),
  });
  assert.deepEqual(result.linked, linked);
  const none = await applyRoster(parseRoster(valid()), {
    admin: fakeAdmin([]).admin,
    initialize: async () => undefined,
  });
  assert.deepEqual(none.linked, []);
});

test("link notes name the key, say when the names differ, and hold no address", () => {
  const differs = rosterLinkNotes({ linked: [{ personKey: "riley", nameDiffers: true }] });
  assert.equal(differs.length, 1);
  assert.match(differs[0], /riley/);
  assert.match(differs[0], /name on the Roster was kept and differs from the file/);
  const same = rosterLinkNotes({ linked: [{ personKey: "riley", nameDiffers: false }] });
  assert.equal(same.length, 1);
  assert.match(same[0], /riley/);
  assert.doesNotMatch(same[0], /differ/);
  for (const line of [...differs, ...same]) assert.equal(line.includes("@"), false);
  assert.deepEqual(rosterLinkNotes({ linked: [] }), []);
});

test("every page of existing accounts is read before anything is created", async () => {
  const existing = Array.from({ length: 5 }, (_, i) => ({
    id: `dddddddd-0000-4000-8000-00000000000${i}`,
    email: `filler-${i}@example.org`,
    email_confirmed_at: "then",
  }));
  existing.push({
    id: "eeeeeeee-0000-4000-8000-000000000009",
    email: "riley@example.org",
    email_confirmed_at: "then",
  });
  const { admin, calls } = fakeAdmin(existing, { perPage: 2 });
  await applyRoster(
    parseRoster({ ...valid(), applicants: [] }),
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
      /staff\[0\]/.test(error.message) &&
      !error.message.includes("@"),
  );
  assert.equal(initialized, false);
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
      siteCoordinator: true,
    },
  ]);
  assert.equal(roster.defaultFollowup, "riley");
});

test("clients alone are not a roster", () => {
  const { staff, defaultFollowup, ...clients } = valid();
  assert.throws(() => parseRoster(clients), refused(/at least one staff member/));
  assert.throws(
    () => parseRoster({ ...clients, staff: [] }),
    refused(/at least one staff member/),
  );
});

test("staff entries are validated before any account is made", () => {
  for (const [entry, pattern] of [
    [riley({ personKey: "Riley" }), /staff\[0\]\.personKey/],
    [riley({ personKey: "9riley" }), /staff\[0\]\.personKey/],
    [riley({ personKey: "r".repeat(41) }), /staff\[0\]\.personKey/],
    [riley({ name: "" }), /staff\[0\]\.name/],
    [riley({ name: "x".repeat(81) }), /staff\[0\]\.name/],
    [riley({ siteCoordinator: "yes" }), /staff\[0\]\.siteCoordinator/],
    [riley({ email: "no at sign" }), /staff\[0\]/],
    ["riley", /staff\[0\]/],
  ])
    assert.throws(() => parseRoster(withStaff([entry])), refused(pattern));
  assert.throws(() => parseRoster({ ...valid(), staff: "riley" }), refused(/staff must be a list/));
});

// Was "follow-up access without admin is refused at any position (042)". The
// roster check it covered ("staff[<n>].capabilities must include admin when
// they include followup.") is removed by add-season-settings (spec sign-in,
// REMOVED): such an entry is now accepted, its capabilities ignored.
test("follow-up access without admin is no longer refused (052)", () => {
  const kai = riley({ email: "kai@example.org", name: "Kai Mensah", personKey: "kai", siteCoordinator: false, capabilities: ["followup", "assist"] });
  const parsed = parseRoster(withStaff([riley(), kai]));
  assert.equal(parsed.staff[1].personKey, "kai");
  assert.deepEqual(parsed.notices, [CAPABILITIES_NOTE]);
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
    () => parseRoster(withStaff([riley({ email: "client-a@example.org" })])),
    refused(/is already on the roster/),
  );
  // Review Focus 4: case and spacing do not hide a duplicate.
  assert.throws(
    () => parseRoster({ ...withStaff(), applicants: ["riley@example.org"] }),
    refused(/is already on the roster/),
  );
});

test("defaultFollowup must name a staff entry with siteCoordinator: true", () => {
  const prep = riley({ personKey: "pat", email: "pat@example.org", siteCoordinator: false });
  const { siteCoordinator, ...unmarked } = riley({ personKey: "uma", email: "uma@example.org" });
  const exact = (error) => refused(/defaultFollowup/)(error) && error.message === DEFAULT_FOLLOWUP_ERROR;
  // An entry with the old followup capability but no siteCoordinator is refused.
  assert.throws(
    () => parseRoster(withStaff([riley(), { ...unmarked, capabilities: ["admin", "followup"] }], { defaultFollowup: "uma" })),
    exact,
  );
  for (const defaultFollowup of ["nobody", "pat", "uma", 7])
    assert.throws(() => parseRoster(withStaff([riley(), prep, unmarked], { defaultFollowup })), exact);
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
    { id: "aaaaaaaa-0000-4000-8000-000000000001", email: "someone-else@example.org", email_confirmed_at: "then" },
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
  assert.deepEqual(Object.keys(riley_).sort(), ["name", "personKey", "siteCoordinator", "userId"]);
  assert.equal(riley_.personKey, "riley");
  assert.equal(riley_.name, "Riley Park");
  assert.equal(riley_.siteCoordinator, true);
  assert.equal("siteNumber" in setups[0], false);
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
    roster.staff.map(({ personKey, siteCoordinator }) => [personKey, siteCoordinator]),
    [
      ["site_coordinator", true],
      ["preparer", false],
      ["reviewer", false],
      ["intaker", false],
    ],
  );
  // No old keys: the example runs without a notice.
  assert.deepEqual(roster.notices, []);
  assert.equal("siteNumber" in example, false);
  for (const entry of example.staff) assert.equal("capabilities" in entry, false);
  assert.equal(roster.defaultFollowup, "site_coordinator");
  assert.deepEqual(roster.applicants, ["client-a@example.org"]);
  assert.equal("presenters" in roster, false);
});

test("the roster command prints each old-key note once", () => {
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
    assert.equal(without.stdout, "");
    // Two entries with capabilities still print that note once.
    const old = run({
      ...valid(),
      workspaceId: crypto.randomUUID(),
      staff: [
        riley({ capabilities: ["prepare"] }),
        riley({ email: "kai@example.org", personKey: "kai", capabilities: ["review"] }),
      ],
      siteNumber: "S00000000",
    });
    assert.match(old.stderr, /Roster failed \(TARGET_REJECTED\)/);
    assert.equal(old.stdout.split(CAPABILITIES_NOTE).length - 1, 1);
    assert.equal(old.stdout.split(SITE_NUMBER_NOTE).length - 1, 1);
    assert.equal(old.stdout.includes("@"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
