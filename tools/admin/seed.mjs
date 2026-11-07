// Builds rehearsal cases on the local test stack through the public RPCs.
//
//   VITALLY_ALLOW_LOCAL_SEED=1 npm run seed:local
//
// Local only: the target must be approved with mode "local", and the opt-in
// flag is checked before any file is read or any connection is made.
import { readFile as readFileFromDisk } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  requireSeedFlag,
  parseSeedArgs,
  formatSeedResult,
} from "./seed-cases.mjs";

export async function runSeed({
  argv,
  env,
  readFile = (path) => readFileFromDisk(path, "utf8"),
  seed,
  log = console.log,
}) {
  requireSeedFlag(env);
  const { rosterPath } = parseSeedArgs(argv);
  let roster;
  try {
    roster = JSON.parse(await readFile(rosterPath));
  } catch {
    throw Object.assign(
      new Error("The roster file could not be read as JSON."),
      { code: "SEED_ROSTER_UNREADABLE" },
    );
  }
  const result = await seed({
    workspaceId: roster?.workspaceId,
    clientAEmail: roster?.applicants?.[0],
  });
  log(formatSeedResult(result));
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  runSeed({
    argv: process.argv.slice(2),
    env: process.env,
    seed: (args) => import("./seed-cases.mjs").then((m) => m.seedWorkspace(args)),
  }).catch((error) => {
    console.error(`${error.code || "SERVER_ERROR"}: ${error.message}`);
    process.exitCode = 1;
  });
