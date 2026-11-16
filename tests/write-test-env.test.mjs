import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import {
  testConfigFromStatus,
  formatEnv,
  parseWriteArgs,
  writeTestEnv,
} from "../tools/admin/write-test-env.mjs";
import { validateTestTarget } from "../tools/admin/test-target.mjs";

// A fictional `supabase status --output json`, shaped like CLI 2.117.0's.
const STATUS = Object.freeze({
  ANON_KEY: "fictional.anon.jwt-value-0001",
  API_URL: "http://127.0.0.1:57321",
  DB_URL: "postgresql://postgres:postgres@127.0.0.1:57322/postgres",
  GRAPHQL_URL: "http://127.0.0.1:57321/graphql/v1",
  INBUCKET_URL: "http://127.0.0.1:57324",
  JWT_SECRET: "fictional-jwt-secret-with-at-least-32-characters",
  MAILPIT_URL: "http://127.0.0.1:57324",
  PUBLISHABLE_KEY: "sb_publishable_fictional_0002",
  REST_URL: "http://127.0.0.1:57321/rest/v1",
  SECRET_KEY: "sb_secret_fictional_0003",
  SERVICE_ROLE_KEY: "fictional.service.jwt-value-0004",
});
const OPTIONS = Object.freeze({
  instanceId: "vitally-ci",
  manifestPath: "/runner/temp/vitally-ci/vitally-targets.json",
});
const SECRET_VALUES = [
  STATUS.ANON_KEY,
  STATUS.JWT_SECRET,
  STATUS.PUBLISHABLE_KEY,
  STATUS.SECRET_KEY,
  STATUS.SERVICE_ROLE_KEY,
  STATUS.DB_URL,
];

// What `docker inspect` reports for a running stack with this manifest.
const inventoryFor = (manifest) =>
  Object.entries(manifest.test.containers).map(([kind, c]) => ({
    Name: `/${c.name}`,
    State: { Running: true },
    Config: { Labels: { "com.supabase.cli.project": manifest.test.instanceId } },
    NetworkSettings: {
      Ports: {
        [`${c.containerPort}/tcp`]: [
          {
            HostIp: "0.0.0.0",
            HostPort: String(kind === "api" ? 57321 : manifest.test.database.port),
          },
        ],
      },
    },
  }));

test("the written configuration is one the local target guard accepts", () => {
  const { env, manifest } = testConfigFromStatus(STATUS, OPTIONS);
  assert.deepEqual(env, {
    VITALLY_TEST_MODE: "local",
    VITALLY_TEST_SUPABASE_URL: STATUS.API_URL,
    VITALLY_TEST_PUBLISHABLE_KEY: STATUS.PUBLISHABLE_KEY,
    VITALLY_TEST_ADMIN_KEY: STATUS.SECRET_KEY,
    VITALLY_TEST_DATABASE_URL: STATUS.DB_URL,
    VITALLY_TARGET_MANIFEST: OPTIONS.manifestPath,
    VITALLY_TEST_LOCAL_INSTANCE_ID: "vitally-ci",
    VITALLY_TEST_MAIL_URL: STATUS.MAILPIT_URL,
  });
  assert.deepEqual(manifest, {
    version: 1,
    test: {
      mode: "local",
      instanceId: "vitally-ci",
      apiOrigin: "http://127.0.0.1:57321",
      database: {
        host: "127.0.0.1",
        port: 57322,
        database: "postgres",
        user: "postgres",
        connectionMode: "direct",
      },
      containers: {
        api: { name: "supabase_kong_vitally-ci", containerPort: 8000 },
        database: { name: "supabase_db_vitally-ci", containerPort: 5432 },
      },
    },
  });
  assert.equal(validateTestTarget(env, manifest, inventoryFor(manifest)).mode, "local");
  // The manifest records endpoint identity only: no key and no password.
  const text = JSON.stringify(manifest);
  for (const value of [...SECRET_VALUES, "postgres:postgres"])
    assert.ok(!text.includes(value), "the manifest carries a secret");
});

test("the older key names are used when the new ones are absent", () => {
  const { PUBLISHABLE_KEY, SECRET_KEY, ...older } = STATUS;
  const { env } = testConfigFromStatus(older, OPTIONS);
  assert.equal(env.VITALLY_TEST_PUBLISHABLE_KEY, STATUS.ANON_KEY);
  assert.equal(env.VITALLY_TEST_ADMIN_KEY, STATUS.SERVICE_ROLE_KEY);
});

test("writes the mail catcher URL", () => {
  const { env } = testConfigFromStatus(STATUS, OPTIONS);
  assert.equal(env.VITALLY_TEST_MAIL_URL, "http://127.0.0.1:57324");
  assert.match(formatEnv(env), /^VITALLY_TEST_MAIL_URL=http:\/\/127\.0\.0\.1:57324$/m);
  const { MAILPIT_URL, ...inbucketOnly } = STATUS;
  assert.equal(testConfigFromStatus(inbucketOnly, OPTIONS).env.VITALLY_TEST_MAIL_URL, STATUS.INBUCKET_URL);
  const { INBUCKET_URL, ...neither } = inbucketOnly;
  assert.equal(testConfigFromStatus(neither, OPTIONS).env.VITALLY_TEST_MAIL_URL, undefined);
});

test("every key, secret and the database URL are masked, but not the bare default password", () => {
  const { secrets } = testConfigFromStatus(STATUS, OPTIONS);
  assert.deepEqual([...secrets].sort(), [...SECRET_VALUES].sort());
  assert.ok(!secrets.includes("postgres"));
});

test("a status that is not a plain local stack is refused without echoing its values", () => {
  const cases = [
    [{ ...STATUS, API_URL: "https://127.0.0.1:57321" }, OPTIONS],
    [{ ...STATUS, API_URL: "http://example.com:57321" }, OPTIONS],
    [{ ...STATUS, API_URL: "http://localhost:57321" }, OPTIONS],
    [{ ...STATUS, API_URL: "http://127.0.0.1:57321/rest" }, OPTIONS],
    [{ ...STATUS, API_URL: "not a url" }, OPTIONS],
    [{ ...STATUS, API_URL: undefined }, OPTIONS],
    [{ ...STATUS, DB_URL: "postgresql://postgres:postgres@db.example.com:5432/postgres" }, OPTIONS],
    [{ ...STATUS, DB_URL: "mysql://postgres:postgres@127.0.0.1:57322/postgres" }, OPTIONS],
    [{ ...STATUS, DB_URL: "postgresql://postgres@127.0.0.1:57322/postgres" }, OPTIONS],
    [{ ...STATUS, DB_URL: "postgresql://postgres:postgres@127.0.0.1:57322/postgres?pgbouncer=true" }, OPTIONS],
    [{ ...STATUS, PUBLISHABLE_KEY: "", ANON_KEY: "" }, OPTIONS],
    [{ ...STATUS, SECRET_KEY: undefined, SERVICE_ROLE_KEY: undefined }, OPTIONS],
    [STATUS, { ...OPTIONS, instanceId: "ci-stack" }],
    [STATUS, { ...OPTIONS, instanceId: "vitally-ci; rm" }],
    [STATUS, { ...OPTIONS, manifestPath: "vitally-targets.json" }],
    [null, OPTIONS],
  ];
  for (const [status, options] of cases)
    assert.throws(
      () => testConfigFromStatus(status, options),
      (error) =>
        error.code === "TEST_ENV_INVALID" &&
        SECRET_VALUES.every((v) => !error.message.includes(v)),
    );
});

test("the .env text parses back to the same values and refuses what it cannot hold", () => {
  const { env } = testConfigFromStatus(STATUS, OPTIONS);
  assert.deepEqual(parseEnv(formatEnv(env)), env);
  for (const value of ["two words", "a#b", 'quote"', "line\nbreak", ""])
    assert.throws(() => formatEnv({ NAME: value }), { code: "TEST_ENV_INVALID" });
});

test("the arguments are all required, once each", () => {
  const argv = ["--status", "s.json", "--instance", "vitally-ci", "--env", ".env.test", "--manifest", "/m.json"];
  assert.deepEqual(parseWriteArgs(argv), {
    statusPath: "s.json",
    instanceId: "vitally-ci",
    envPath: ".env.test",
    manifestPath: "/m.json",
  });
  for (const bad of [argv.slice(0, 6), [...argv, "--env", "x"], [...argv.slice(0, 7)], ["--other", "x", ...argv]])
    assert.throws(() => parseWriteArgs(bad), { code: "TEST_ENV_USAGE" });
});

test("both files are written with mode 600, masks come first in Actions only, and nothing secret is logged", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "vitally-write-test-env-"));
  try {
    const statusPath = path.join(dir, "status.private.json");
    const envPath = path.join(dir, ".env.test");
    const manifestPath = path.join(dir, ".vitally-targets.json");
    await writeFile(statusPath, JSON.stringify(STATUS));
    const argv = ["--status", statusPath, "--instance", "vitally-ci", "--env", envPath, "--manifest", manifestPath];

    const actionsLog = [];
    await writeTestEnv({ argv, env: { GITHUB_ACTIONS: "true" }, log: (l) => actionsLog.push(l) });
    const masks = actionsLog.filter((l) => l.startsWith("::add-mask::"));
    assert.deepEqual(masks.map((l) => l.slice("::add-mask::".length)).sort(), [...SECRET_VALUES].sort());
    assert.ok(actionsLog.slice(0, masks.length).every((l) => l.startsWith("::add-mask::")));
    for (const line of actionsLog.slice(masks.length))
      for (const value of SECRET_VALUES) assert.ok(!line.includes(value), "a secret was logged");

    for (const file of [envPath, manifestPath])
      assert.equal((await stat(file)).mode & 0o777, 0o600);
    const written = parseEnv(await readFile(envPath, "utf8"));
    assert.equal(written.VITALLY_TARGET_MANIFEST, manifestPath);
    assert.equal(JSON.parse(await readFile(manifestPath, "utf8")).test.instanceId, "vitally-ci");

    const localLog = [];
    await writeTestEnv({ argv, env: {}, log: (l) => localLog.push(l) });
    assert.equal(localLog.length, 1);
    for (const value of SECRET_VALUES) assert.ok(!localLog[0].includes(value));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an unreadable status file is refused", async () => {
  const argv = ["--status", "missing.json", "--instance", "vitally-ci", "--env", ".env.test", "--manifest", "/m.json"];
  await assert.rejects(
    writeTestEnv({
      argv,
      env: {},
      readFile: async () => "not json",
      write: async () => assert.fail("nothing is written"),
      log: () => {},
    }),
    { code: "TEST_ENV_INVALID" },
  );
});
