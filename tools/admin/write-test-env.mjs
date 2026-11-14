// Writes the private test configuration, `.env.test` and the target manifest
// (docs/setup.md, "Private test configuration"), from a local stack's own
// `supabase status --output json`, so no value is ever copied by hand:
//
//   supabase status --workdir "$VITALLY_STACK" --output json > "$VITALLY_STACK/status.private.json"
//   node tools/admin/write-test-env.mjs --status "$VITALLY_STACK/status.private.json" \
//     --instance "$VITALLY_INSTANCE" --env .env.test --manifest "$PWD/.vitally-targets.json"
//
// Both files are written with mode 600. Nothing secret is printed. In GitHub
// Actions it first masks every key, so a later step that prints one shows ***.
import { readFile as readFileFromDisk, writeFile, chmod } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isLoopback } from "./target-common.mjs";

const invalid = (what) =>
  Object.assign(new Error(`The stack status cannot be used: ${what}.`), {
    code: "TEST_ENV_INVALID",
  });

const parseUrl = (raw, what) => {
  try {
    return new URL(raw);
  } catch {
    throw invalid(what);
  }
};

const firstString = (status, names) =>
  names.map((n) => status?.[n]).find((v) => typeof v === "string" && v.length > 0);

/**
 * The `.env.test` values, the target manifest and the values to mask, from a
 * parsed status object. Only a loopback, plain-HTTP stack with a direct
 * PostgreSQL connection is accepted; the guard in test-target.mjs checks the
 * same things again, against the running containers, before every connection.
 */
export function testConfigFromStatus(status, { instanceId, manifestPath }) {
  if (typeof instanceId !== "string" || !/^vitally-[a-zA-Z0-9._-]+$/.test(instanceId))
    throw invalid("the instance id must start with vitally-");
  if (typeof manifestPath !== "string" || !path.isAbsolute(manifestPath))
    throw invalid("the manifest path must be absolute");
  if (typeof status?.API_URL !== "string") throw invalid("API_URL is missing");
  const api = parseUrl(status.API_URL, "API_URL is not a URL");
  if (
    api.protocol !== "http:" ||
    !isLoopback(api.hostname) ||
    api.pathname !== "/" ||
    api.search ||
    api.hash ||
    api.username ||
    api.password
  )
    throw invalid("API_URL is not a plain loopback address");
  if (typeof status.DB_URL !== "string") throw invalid("DB_URL is missing");
  const db = parseUrl(status.DB_URL, "DB_URL is not a URL");
  if (
    !["postgres:", "postgresql:"].includes(db.protocol) ||
    !isLoopback(db.hostname) ||
    !db.username ||
    !db.password ||
    db.pathname.length < 2 ||
    db.hash ||
    [...db.searchParams.keys()].some((k) => k !== "sslmode")
  )
    throw invalid("DB_URL is not a direct loopback PostgreSQL address");
  const publishableKey = firstString(status, ["PUBLISHABLE_KEY", "ANON_KEY"]);
  const adminKey = firstString(status, ["SECRET_KEY", "SERVICE_ROLE_KEY"]);
  if (!publishableKey) throw invalid("PUBLISHABLE_KEY and ANON_KEY are missing");
  if (!adminKey) throw invalid("SECRET_KEY and SERVICE_ROLE_KEY are missing");

  // The local mail catcher (Mailpit; CLI 2.117.0 reports it as MAILPIT_URL and
  // INBUCKET_URL). Optional: a status without either simply has no catcher.
  const mailUrl = firstString(status, ["MAILPIT_URL", "INBUCKET_URL"]);
  if (mailUrl !== undefined) {
    const mail = parseUrl(mailUrl, "the mail catcher URL is not a URL");
    if (mail.protocol !== "http:" || !isLoopback(mail.hostname))
      throw invalid("the mail catcher URL is not a plain loopback address");
  }

  const env = {
    VITALLY_TEST_MODE: "local",
    VITALLY_TEST_SUPABASE_URL: status.API_URL,
    VITALLY_TEST_PUBLISHABLE_KEY: publishableKey,
    VITALLY_TEST_ADMIN_KEY: adminKey,
    VITALLY_TEST_DATABASE_URL: status.DB_URL,
    VITALLY_TARGET_MANIFEST: manifestPath,
    VITALLY_TEST_LOCAL_INSTANCE_ID: instanceId,
    ...(mailUrl === undefined ? {} : { VITALLY_TEST_MAIL_URL: mailUrl }),
  };
  const manifest = {
    version: 1,
    test: {
      mode: "local",
      instanceId,
      apiOrigin: api.origin,
      database: {
        host: db.hostname,
        port: Number(db.port || 5432),
        database: decodeURIComponent(db.pathname.slice(1)),
        user: decodeURIComponent(db.username),
        connectionMode: "direct",
      },
      containers: {
        api: { name: `supabase_kong_${instanceId}`, containerPort: 8000 },
        database: { name: `supabase_db_${instanceId}`, containerPort: 5432 },
      },
    },
  };
  // Every key, secret and token the status carries, and the whole database
  // URL (its password alone is the CLI's default "postgres", and masking that
  // word would hide it everywhere in the log).
  const secrets = [
    ...new Set(
      [
        status.DB_URL,
        ...Object.entries(status)
          .filter(([k]) => /KEY|SECRET|TOKEN|PASSWORD/i.test(k))
          .map(([, v]) => v),
      ].filter((v) => typeof v === "string" && v.length >= 8),
    ),
  ];
  return { env, manifest, secrets };
}

/** `.env.test` text. A value that `--env-file` could misread is refused. */
export function formatEnv(env) {
  return (
    Object.entries(env)
      .map(([name, value]) => {
        if (typeof value !== "string" || !value || /[\s"'`#\\]/.test(value))
          throw invalid(`${name} has a character .env files cannot hold unquoted`);
        return `${name}=${value}`;
      })
      .join("\n") + "\n"
  );
}

export function parseWriteArgs(argv) {
  const out = {};
  const names = { "--status": "statusPath", "--instance": "instanceId", "--env": "envPath", "--manifest": "manifestPath" };
  for (let i = 0; i < argv.length; i += 2) {
    const key = names[argv[i]];
    if (!key || typeof argv[i + 1] !== "string" || out[key] !== undefined)
      throw Object.assign(
        new Error("Usage: write-test-env.mjs --status <file> --instance <id> --env <file> --manifest <absolute file>"),
        { code: "TEST_ENV_USAGE" },
      );
    out[key] = argv[i + 1];
  }
  for (const key of Object.values(names))
    if (out[key] === undefined)
      throw Object.assign(new Error(`Missing ${Object.keys(names).find((n) => names[n] === key)}.`), {
        code: "TEST_ENV_USAGE",
      });
  return out;
}

const writePrivate = async (file, text) => {
  await writeFile(file, text, { mode: 0o600 });
  await chmod(file, 0o600);
};

export async function writeTestEnv({
  argv,
  env = process.env,
  readFile = (p) => readFileFromDisk(p, "utf8"),
  write = writePrivate,
  log = console.log,
}) {
  const { statusPath, instanceId, envPath, manifestPath } = parseWriteArgs(argv);
  let status;
  try {
    status = JSON.parse(await readFile(statusPath));
  } catch {
    throw invalid("the status file could not be read as JSON");
  }
  const config = testConfigFromStatus(status, { instanceId, manifestPath });
  // Masks first, before anything else could print a value.
  if (env.GITHUB_ACTIONS === "true")
    for (const value of config.secrets) log(`::add-mask::${value}`);
  const envText = formatEnv(config.env);
  await write(manifestPath, JSON.stringify(config.manifest, null, 2) + "\n");
  await write(envPath, envText);
  log(`Wrote the test configuration for ${instanceId} (${config.manifest.test.apiOrigin}).`);
  return config;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  writeTestEnv({ argv: process.argv.slice(2) }).catch((error) => {
    console.error(`${error.code || "SERVER_ERROR"}: ${error.message}`);
    process.exitCode = 1;
  });
