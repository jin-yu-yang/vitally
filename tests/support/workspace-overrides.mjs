import { assertTestTarget } from "../../tools/admin/test-target.mjs";
import { openDatabase, serializable } from "../../tools/admin/database.mjs";
import { requireOwnedWorkspace } from "./run-manifest.mjs";
const capabilities = new Set([
  "prepare",
  "review",
  "admin",
  "followup",
  "receive_documents",
  "assist",
]);
function validate(condition) {
  if (!condition)
    throw Object.assign(new Error("Test workspace extension rejected."), {
      code: "VALIDATION",
    });
}
function exactKeys(object, allowed) {
  validate(
    object &&
      typeof object === "object" &&
      !Array.isArray(object) &&
      Object.keys(object).every((k) => allowed.includes(k)),
  );
}
export async function extendTestWorkspace(input) {
  await assertTestTarget();
  exactKeys(input, [
    "runManifest",
    "workspaceId",
    "addPeople",
    "addCapabilities",
  ]);
  const {
    runManifest,
    workspaceId,
    addPeople = [],
    addCapabilities = [],
  } = input;
  requireOwnedWorkspace(runManifest, workspaceId);
  validate(Array.isArray(addPeople) && Array.isArray(addCapabilities));
  for (const person of addPeople) {
    exactKeys(person, ["key", "name", "capabilities"]);
    validate(
      /^[a-z][a-z0-9_]{0,39}$/.test(person.key) &&
        typeof person.name === "string" &&
        person.name.length > 0 &&
        person.name.length <= 80 &&
        Array.isArray(person.capabilities) &&
        person.capabilities.every((c) => capabilities.has(c)) &&
        new Set(person.capabilities).size === person.capabilities.length,
    );
  }
  for (const addition of addCapabilities) {
    exactKeys(addition, ["personId", "capability"]);
    validate(
      typeof addition.personId === "string" &&
        capabilities.has(addition.capability),
    );
  }
  const client = await openDatabase();
  try {
    return await serializable(client, async (connection) => {
      await connection.query(
        "select pg_advisory_xact_lock(hashtextextended($1,0))",
        [workspaceId],
      );
      const marker = await connection.query(
        "select run_id from vitally_private.test_workspaces where workspace_id=$1 for update",
        [workspaceId],
      );
      validate(marker.rows[0]?.run_id === runManifest.runId);
      const people = {};
      for (const person of addPeople) {
        const caps = [...person.capabilities].sort();
        const existing = (
          await connection.query(
            "select id,name,capabilities from public.people where workspace_id=$1 and person_key=$2",
            [workspaceId, person.key],
          )
        ).rows[0];
        // The stored capabilities are the mirror of the person's roles
        // (migration 052), not what was asked for, so only the name is compared.
        if (existing) {
          validate(existing.name === person.name);
          people[person.key] = existing.id;
        } else {
          // The capabilities written are replaced by the mirror (migration 052);
          // f.enrich gives the person roles for them.
          const inserted = await connection.query(
            "insert into public.people(workspace_id,person_key,name,capabilities) values($1,$2,$3,$4) returning id",
            [workspaceId, person.key, person.name, caps],
          );
          people[person.key] = inserted.rows[0].id;
        }
      }
      for (const addition of addCapabilities) {
        const result = await connection.query(
          "update public.people set capabilities=array(select distinct c from unnest(capabilities||$3::text) c order by c) where workspace_id=$1 and id=$2 returning id",
          [workspaceId, addition.personId, addition.capability],
        );
        validate(result.rowCount === 1);
      }
      if (addPeople.length || addCapabilities.length)
        await connection.query(
          "update vitally_private.test_workspaces set test_overrides_applied=true where workspace_id=$1",
          [workspaceId],
        );
      return { workspaceId, people };
    });
  } finally {
    await client.end();
  }
}
