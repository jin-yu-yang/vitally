// Renames a workspace's current season, keeping everything in it.
//
//   node --env-file=.env.admin tools/admin/relabel-season.mjs --target classroom \
//     --roster .vitally-roster.classroom.json --from 2025 --to 2026            (dry run)
//   ... the same with --apply                                                  (writes)
//
// This is not Start next season. Start next season begins an empty season;
// this says the current season was labelled wrongly (for example 2025 where
// PCDC means "2026 for TY 2025") and moves what is in it to the new label:
// the workspace's current_season, every roster entry and its certificates,
// every case's season and its client-number counter. Client numbers keep
// their values. Nobody's roles, certificates, capabilities or clearance
// change; the tool checks that before it commits and refuses otherwise.
//
// A dry run does all of it inside a transaction and rolls back, so it reports
// exactly what --apply would do. Output is counts only, never names or
// addresses. The target is approved by the same fail-closed guards as every
// other privileged tool before anything is read.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { openDatabase, databaseError } from "./database.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SEASON = /^\d{4}$/;
const USAGE =
  "Usage: relabel-season.mjs --target test|classroom --roster <file.json> --from <season> --to <season> [--apply]";

const failure = (code, message) => Object.assign(new Error(message), { code });
const refused = (message) => failure("RELABEL_REFUSED", message);

export function parseRelabelArgs(argv) {
  const usage = () => failure("RELABEL_USAGE", USAGE);
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--apply") {
      if (options.apply) throw usage();
      options.apply = true;
      continue;
    }
    const value = argv[i + 1];
    if (!["--target", "--roster", "--from", "--to"].includes(flag) || value === undefined || flag in options)
      throw usage();
    options[flag] = value;
    i += 1;
  }
  if (
    !["test", "classroom"].includes(options["--target"]) ||
    !options["--roster"] ||
    !SEASON.test(options["--from"] ?? "") ||
    !SEASON.test(options["--to"] ?? "")
  )
    throw usage();
  const from = Number(options["--from"]);
  const to = Number(options["--to"]);
  if (from < 2000 || from > 2100 || to < 2000 || to > 2100 || to === from) throw usage();
  return {
    target: { kind: options["--target"] },
    rosterPath: options["--roster"],
    from,
    to,
    apply: options.apply === true,
  };
}

export function workspaceFromRoster(raw) {
  if (!raw || typeof raw !== "object" || typeof raw.workspaceId !== "string" || !UUID.test(raw.workspaceId))
    throw failure("RELABEL_USAGE", "The roster file has no workspaceId.");
  return raw.workspaceId;
}

const count = async (client, text, values) => Number((await client.query(text, values)).rows[0].n);

// Each person's capabilities and clearance, keyed by person id.
async function standing(client, workspaceId) {
  const { rows } = await client.query(
    `select id::text, capabilities, vitally_private.cleared(workspace_id, id) as cleared
       from public.people where workspace_id = $1`,
    [workspaceId],
  );
  return new Map(rows.map((row) => [row.id, `${[...row.capabilities].sort().join(",")}|${row.cleared}`]));
}

// Runs on an open client, inside one transaction it begins and ends. Commits
// only when `apply` is true and every check passed; otherwise rolls back.
export async function relabelSeason(client, { workspaceId, from, to, apply = false }) {
  if (!UUID.test(workspaceId ?? "")) throw failure("RELABEL_USAGE", "workspaceId must be a UUID.");
  try {
    await client.query("begin");
    // Roster writes in the workspace take this lock first. Case actions don't:
    // they lock only their own case row (see the next lock).
    await client.query("select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1::text, 0))", [
      workspaceId,
    ]);
    // EXCLUSIVE conflicts with the ROW SHARE a case action takes when it locks
    // its case row, so this waits for in-flight actions to finish before the
    // tool touches any row, and new ones wait for the tool. A weaker mode let an
    // action holding its row wait on the tool while the tool waited on that row
    // (40P01, found in review of #248).
    await client.query("lock table public.cases in exclusive mode");
    const workspace = (
      await client.query("select current_season from public.workspaces where id = $1 for update", [workspaceId])
    ).rows[0];
    if (!workspace) throw refused("No workspace with that id on this target.");
    if (Number(workspace.current_season) !== from)
      throw refused(`The workspace's current season is ${workspace.current_season}, not ${from}. Nothing was changed.`);
    const at = (table, season) =>
      count(client, `select count(*) as n from ${table} where workspace_id = $1 and season = $2`, [workspaceId, season]);
    for (const table of [
      "public.roster_entries",
      "public.certificates",
      "public.cases",
      "vitally_private.client_number_counters",
    ])
      if ((await at(table, to)) > 0)
        throw refused(`${table} already has rows for ${to}. Nothing was changed.`);

    const before = await standing(client, workspaceId);
    const moved = {
      rosterEntries: await at("public.roster_entries", from),
      certificates: await at("public.certificates", from),
      cases: await at("public.cases", from),
      counters: await at("vitally_private.client_number_counters", from),
    };

    await client.query("update public.workspaces set current_season = $2 where id = $1", [workspaceId, to]);
    // Certificates reference their entry by season, so the entries are copied
    // to the new season, the certificates moved onto the copies, and the old
    // entries deleted. Every column is copied, whatever later migrations add.
    const { rows: columns } = await client.query(
      `select quote_ident(column_name) as name from information_schema.columns
        where table_schema = 'public' and table_name = 'roster_entries' order by ordinal_position`,
    );
    const names = columns.map((c) => c.name);
    const values = names.map((name) => (name === "season" ? "$2::smallint" : name));
    await client.query(
      `insert into public.roster_entries (${names.join(", ")})
         select ${values.join(", ")} from public.roster_entries where workspace_id = $1 and season = $3`,
      [workspaceId, to, from],
    );
    await client.query("update public.certificates set season = $2 where workspace_id = $1 and season = $3", [
      workspaceId,
      to,
      from,
    ]);
    await client.query("delete from public.roster_entries where workspace_id = $1 and season = $2", [
      workspaceId,
      from,
    ]);
    // A numbered case's season never changes in the product (010's trigger
    // refuses it). The rename is the one exception, so the trigger is off for
    // this one statement, inside this transaction.
    await client.query("alter table public.cases disable trigger cases_client_number");
    await client.query("update public.cases set season = $2 where workspace_id = $1 and season = $3", [
      workspaceId,
      to,
      from,
    ]);
    await client.query("alter table public.cases enable trigger cases_client_number");
    await client.query(
      "update vitally_private.client_number_counters set season = $2 where workspace_id = $1 and season = $3",
      [workspaceId, to, from],
    );
    // The role/certificate rule is checked at commit; run it now so a
    // problem refuses here, with nothing written.
    await client.query("set constraints all immediate");

    const after = await standing(client, workspaceId);
    let changed = 0;
    for (const [id, value] of before) if (after.get(id) !== value) changed += 1;
    if (changed > 0 || after.size !== before.size)
      throw refused(`${changed} people's capabilities or clearance would change. Nothing was changed.`);
    const left = {
      rosterEntries: await at("public.roster_entries", from),
      certificates: await at("public.certificates", from),
      cases: await at("public.cases", from),
    };
    if (left.rosterEntries + left.certificates + left.cases > 0)
      throw refused("Rows were left in the old season. Nothing was changed.");

    await client.query(apply ? "commit" : "rollback");
    return { workspaceId, from, to, applied: apply, ...moved, people: before.size, cleared: [...before.values()].filter((v) => v.endsWith("|true")).length };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    if (error.code === "RELABEL_REFUSED" || error.code === "RELABEL_USAGE") throw error;
    throw databaseError(error);
  }
}

export const describeResult = (r) =>
  `${r.applied ? "Relabelled" : "Dry run, nothing written:"} season ${r.from} -> ${r.to} in workspace ${r.workspaceId}: ` +
  `${r.rosterEntries} roster entries, ${r.certificates} certificates, ${r.cases} cases, ${r.counters} client-number counter(s). ` +
  `${r.people} people checked, ${r.cleared} cleared, none changed.` +
  (r.applied ? "" : " Run again with --apply to write it.");

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  (async () => {
    let options;
    try {
      options = parseRelabelArgs(process.argv.slice(2));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 2;
      return;
    }
    try {
      const workspaceId = workspaceFromRoster(JSON.parse(await readFile(options.rosterPath, "utf8")));
      const client = await openDatabase(options.target);
      try {
        console.log(describeResult(await relabelSeason(client, { workspaceId, ...options })));
      } finally {
        await client.end();
      }
    } catch (error) {
      console.error(
        error.code === "RELABEL_REFUSED" || error.code === "RELABEL_USAGE"
          ? error.message
          : `Relabel failed (${error.code || "SERVER_ERROR"}).`,
      );
      process.exitCode = 1;
    }
  })();
}
