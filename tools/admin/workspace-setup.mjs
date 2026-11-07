import { openDatabase, serializable } from "./database.mjs";
export async function initializeWorkspace(
  {
    workspaceId,
    presenterUserIds = [],
    applicantUserIds = [],
    staff = [],
    defaultFollowup = null,
    target = { kind: "test" },
  },
  { afterInitialize } = {},
) {
  const client = await openDatabase(target);
  try {
    return await serializable(client, async (connection) => {
      const { rows } = await connection.query(
        "select vitally_private.initialize_workspace($1,$2::uuid[],$3::uuid[]) as result",
        [workspaceId, presenterUserIds, applicantUserIds],
      );
      const result = rows[0].result;
      // Same transaction (and so the same 40001 retry) as initialize_workspace.
      for (const member of staff)
        await connection.query(
          "select vitally_private.add_staff_member($1,$2,$3,$4,$5::text[])",
          [workspaceId, member.userId, member.personKey, member.name, member.capabilities],
        );
      if (defaultFollowup)
        await connection.query("select vitally_private.set_default_followup($1,$2)", [
          workspaceId,
          defaultFollowup,
        ]);
      // Trusted tooling hook: SQL-only, atomic with setup, safe to rerun on serialization failure.
      if (afterInitialize) await afterInitialize(connection, result);
      return result;
    });
  } finally {
    await client.end();
  }
}
