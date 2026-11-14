import { openDatabase, serializable } from "./database.mjs";

// The Roster volunteer with no sign-in that `add_staff_member` would link this
// account to, or null. `query(text, values)` answers with `{ rows }`.
export async function findRosterLink(query, workspaceId, userId) {
  const { rows } = await query(
    `select p.name from public.people p
      join public.volunteer_profiles v on v.workspace_id=p.workspace_id and v.person_id=p.id
      join auth.users u on lower(u.email)=v.email
     where p.workspace_id=$1 and p.user_id is null and u.id=$2`,
    [workspaceId, userId],
  );
  return rows[0] ? { name: rows[0].name } : null;
}

export async function initializeWorkspace(
  {
    workspaceId,
    applicantUserIds = [],
    staff = [],
    defaultFollowup = null,
    siteNumber = null,
    target = { kind: "test" },
  },
  { afterInitialize } = {},
) {
  const client = await openDatabase(target);
  try {
    return await serializable(client, async (connection) => {
      const { rows } = await connection.query(
        "select vitally_private.initialize_workspace($1,$2::uuid[]) as result",
        [workspaceId, applicantUserIds],
      );
      const result = rows[0].result;
      // Same transaction (and so the same 40001 retry) as initialize_workspace.
      // Declared here so a retry starts afresh.
      const linked = [];
      for (const member of staff) {
        const link = await findRosterLink(
          (text, values) => connection.query(text, values),
          workspaceId,
          member.userId,
        );
        if (link) linked.push({ personKey: member.personKey, nameDiffers: link.name !== member.name });
        await connection.query(
          "select vitally_private.add_staff_member($1,$2,$3,$4,$5::text[])",
          [workspaceId, member.userId, member.personKey, member.name, member.capabilities],
        );
      }
      if (defaultFollowup)
        await connection.query("select vitally_private.set_default_followup($1,$2)", [
          workspaceId,
          defaultFollowup,
        ]);
      // The site's number for the volunteer site check (change
      // add-account-invitations, design D12). Fictional outside a real roster file.
      if (siteNumber)
        await connection.query("select vitally_private.set_site_number($1,$2)", [workspaceId, siteNumber]);
      // Trusted tooling hook: SQL-only, atomic with setup, safe to rerun on serialization failure.
      if (afterInitialize) await afterInitialize(connection, result);
      return { ...result, linked };
    });
  } finally {
    await client.end();
  }
}
