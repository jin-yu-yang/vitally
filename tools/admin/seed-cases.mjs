import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { databaseError, openDatabase } from "./database.mjs";
import * as SEED_VALUES from "./seed-values.mjs";
import { assertTestTarget } from "./test-target.mjs";
import { rejected } from "./target-common.mjs";

// Runs `fn` as the given auth user: the same role and claims PostgREST sets,
// so the public RPCs see auth.uid() and apply their own permission checks.
export async function actAs(client, userId, fn) {
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw databaseError(error);
  }
}

export async function callRpc(client, userId, name, args) {
  const keys = Object.keys(args);
  const params = keys.map((key, i) => `${key} => $${i + 1}`).join(", ");
  const values = keys.map((key) => args[key]);
  return actAs(client, userId, async (c) => {
    const { rows } = await c.query(
      `select public.${name}(${params}) as result`,
      values,
    );
    return rows[0].result;
  });
}

export async function applyAction(client, userId, caseId, type, payload = {}) {
  const { rows } = await client.query(
    "select revision from public.cases where id = $1",
    [caseId],
  );
  return callRpc(client, userId, "vitally_apply_action", {
    p_action_id: randomUUID(),
    p_case_id: caseId,
    p_expected_revision: rows[0].revision,
    p_type: type,
    p_payload: JSON.stringify(payload),
  });
}

const failure = (code, message) =>
  Object.assign(new Error(message), { code });

// The seed only ever runs against the local test stack.
export async function assertLocalSeedTarget({
  env,
  manifest,
  assert = assertTestTarget,
} = {}) {
  const approved = await assert({ env, manifest });
  if (approved?.mode !== "local") throw rejected();
  return approved;
}

export function requireSeedFlag(env) {
  if (env?.VITALLY_ALLOW_LOCAL_SEED !== "1")
    throw failure(
      "SEED_NOT_ALLOWED",
      "Set VITALLY_ALLOW_LOCAL_SEED=1 to seed the local test stack.",
    );
}

export function parseSeedArgs(argv) {
  const usage = () =>
    failure("SEED_USAGE", "Usage: seed.mjs [--roster <file.json>]");
  if (argv.length === 0) return { rosterPath: ".vitally-roster.local.json" };
  if (argv.length !== 2 || argv[0] !== "--roster" || !argv[1]) throw usage();
  return { rosterPath: argv[1] };
}

export function formatSeedResult({ casesRemoved, casesCreated, volunteersCreated }) {
  const line = `Seeded ${casesCreated} cases (removed ${casesRemoved} from the previous run)`;
  return volunteersCreated == null
    ? `${line}.`
    : `${line} and ${volunteersCreated} volunteers on the Roster.`;
}

const ROLE_KEYS = ["site_coordinator", "preparer", "reviewer"];

// Finds the accounts the seed acts as. Refusals never repeat an address.
export async function resolveSeedTargets(client, { workspaceId, clientAEmail }) {
  if (!workspaceId || !clientAEmail)
    throw failure(
      "SEED_SETUP",
      "The seed needs a workspace id and the roster's first applicant.",
    );
  const targets = { workspaceId };
  for (const key of ROLE_KEYS) {
    const { rows } = await client.query(
      `select p.id, p.user_id
         from public.people p
         join public.memberships m
           on m.workspace_id = p.workspace_id and m.user_id = p.user_id
        where p.workspace_id = $1 and p.person_key = $2
          and p.user_id is not null and m.access = 'staff' and m.active`,
      [workspaceId, key],
    );
    if (!rows.length)
      throw failure(
        "SEED_SETUP",
        `The workspace has no staff account with the person key "${key}".`,
      );
    const field = key.replace(/_(\w)/g, (_, c) => c.toUpperCase());
    targets[field] = { userId: rows[0].user_id, personId: rows[0].id };
  }
  const { rows: clients } = await client.query(
    `select u.id
       from auth.users u
       join public.memberships m on m.user_id = u.id
      where lower(u.email) = lower($1) and m.workspace_id = $2
        and m.access = 'applicant' and m.active`,
    [clientAEmail, workspaceId],
  );
  if (!clients.length)
    throw failure(
      "SEED_SETUP",
      "The roster's first applicant has no client account in this workspace.",
    );
  targets.clientA = { userId: clients[0].id };
  const { rows: workspaces } = await client.query(
    "select default_followup_person_id from public.workspaces where id = $1",
    [workspaceId],
  );
  if (
    workspaces[0]?.default_followup_person_id !== targets.siteCoordinator.personId
  )
    throw failure(
      "SEED_SETUP",
      'The default follow-up person must be the "site_coordinator" account. Re-run the roster command with the current example roster.',
    );
  return targets;
}

export function runFilePath(workspaceId, runDir = ".vitally-runs") {
  return `${runDir}/seed-${workspaceId}.json`;
}

export async function readRun(workspaceId, runDir) {
  let run;
  try {
    run = JSON.parse(await readFile(runFilePath(workspaceId, runDir), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    run = { workspaceId };
  }
  const list = (value) => (Array.isArray(value) ? value : []);
  return {
    ...run,
    caseIds: list(run?.caseIds),
    assistanceIds: list(run?.assistanceIds),
  };
}

// Removes only the rows the previous run recorded, and only in its workspace.
export async function deletePreviousRun(client, run) {
  await client.query(
    "delete from public.assistance_items where workspace_id=$1 and id = any($2::uuid[])",
    [run.workspaceId, run.assistanceIds],
  );
  const { rows } = await client.query(
    "delete from public.cases where workspace_id=$1 and id = any($2::uuid[]) returning id",
    [run.workspaceId, run.caseIds],
  );
  return { casesRemoved: rows.length };
}

export async function recordRun(run, runDir = ".vitally-runs") {
  await mkdir(runDir, { recursive: true, mode: 0o700 });
  await writeFile(
    runFilePath(run.workspaceId, runDir),
    `${JSON.stringify(run, null, 2)}
`,
  );
}

export const SEED_SCENARIOS = Object.freeze([
  "client_received",
  "preparation_ready",
  "waiting_documents",
  "admin_followup",
  "review_ready",
  "corrections_required",
  "review_approved",
  "rejected",
  "accepted",
  "on_hold",
  "withdrawn",
]);

// Replaces the previous run's set with a fresh one, built only through the
// public RPCs as the acting accounts. The run file is rewritten after every
// create, so a refused step leaves each created id listed for the next run.
export async function seedCases(
  client,
  targets,
  { runDir = ".vitally-runs", values = SEED_VALUES } = {},
) {
  const { workspaceId, siteCoordinator, preparer, reviewer, clientA } = targets;
  const previous = await readRun(workspaceId, runDir);
  const { casesRemoved } = await deletePreviousRun(client, {
    ...previous,
    workspaceId,
  });
  const run = { workspaceId, caseIds: [], assistanceIds: [] };
  await recordRun(run, runDir);

  const refused = (scenario, type) => (error) => {
    // The original error stays as `cause` for debugging; it is never printed.
    throw Object.assign(
      failure(
        "SEED_STEP_FAILED",
        `${scenario}: ${type} was refused (${error.code || "SERVER_ERROR"}).`,
      ),
      { cause: error },
    );
  };
  const act = (scenario, actor, caseId, type, payload = {}) =>
    applyAction(client, actor.userId, caseId, type, payload).catch(
      refused(scenario, type),
    );
  const create = async (scenario, actor, mode) => {
    const created = await callRpc(client, actor.userId, "vitally_create_case", {
      p_action_id: randomUUID(),
      p_mode: mode,
      p_answers: "{}",
    }).catch(refused(scenario, "CREATE_CASE"));
    run.caseIds.push(created.caseId);
    await recordRun(run, runDir);
    const answers = values.caseAnswers(SEED_SCENARIOS.indexOf(scenario));
    await act(scenario, actor, created.caseId, "SAVE_ANSWERS", { answers });
    return { caseId: created.caseId, answers };
  };
  const filingDay = async () =>
    (
      await client.query(
        "select (now() at time zone 'America/New_York')::date::text as day",
      )
    ).rows[0].day;

  // Each builder takes the case one stage further than the one it calls.
  const clientCase = async (s) => {
    const { caseId } = await create(s, clientA, "client");
    await act(s, clientA, caseId, "SUBMIT", { confirmed: true });
    return caseId;
  };
  const walkIn = async (s) => {
    const created = await create(s, siteCoordinator, "assisted");
    // An office-entered submit lands at screening.
    await act(s, siteCoordinator, created.caseId, "SUBMIT", { confirmed: true });
    return created;
  };
  const officeBase = async (s) => {
    const { caseId, answers } = await walkIn(s);
    await act(s, siteCoordinator, caseId, "VERIFY_INTAKE", {
      checks: values.screeningChecks(answers.service),
    });
    return caseId;
  };
  const preparing = async (s) => {
    const caseId = await officeBase(s);
    await act(s, preparer, caseId, "CLAIM_PREPARATION");
    return caseId;
  };
  const waitingOnRequest = async (s) => {
    const caseId = await preparing(s);
    await act(s, preparer, caseId, "REQUEST_DOCUMENT", values.DOCUMENT_REQUEST);
    return caseId;
  };
  const reviewReady = async (s) => {
    const caseId = await preparing(s);
    await act(s, preparer, caseId, "SUBMIT_REVIEW", {
      questionnaire: values.PREPARER_QUESTIONNAIRE,
    });
    return caseId;
  };
  const inReview = async (s) => {
    const caseId = await reviewReady(s);
    await act(s, reviewer, caseId, "CLAIM_REVIEW");
    return caseId;
  };
  const approved = async (s) => {
    const caseId = await inReview(s);
    await act(s, reviewer, caseId, "APPROVE_REVIEW", {
      questionnaire: values.REVIEWER_QUESTIONNAIRE,
    });
    return caseId;
  };
  const filedWith = (results) => async (s) => {
    const caseId = await approved(s);
    await act(s, siteCoordinator, caseId, "MARK_READY_TO_EFILE", {
      confirmed: true,
    });
    await act(s, siteCoordinator, caseId, "MARK_EFILED", {
      confirmed: true,
      methods: values.FILING_METHODS,
    });
    await act(s, siteCoordinator, caseId, "RECORD_FILING_RESULT", {
      confirmed: true,
      results: results(await filingDay()),
    });
    return caseId;
  };

  const builders = {
    client_received: clientCase,
    preparation_ready: officeBase,
    waiting_documents: waitingOnRequest,
    admin_followup: async (s) => {
      const caseId = await waitingOnRequest(s);
      const { rows } = await client.query(
        "select id from public.document_requests where case_id=$1 and status='open'",
        [caseId],
      );
      await act(s, preparer, caseId, "ESCALATE_CONTACT", {
        requestId: rows[0]?.id,
        reason: values.ESCALATION_REASON,
      });
      return caseId;
    },
    review_ready: reviewReady,
    corrections_required: async (s) => {
      const caseId = await inReview(s);
      await act(s, reviewer, caseId, "REQUEST_CORRECTIONS", {
        findings: values.CORRECTION_FINDINGS,
      });
      return caseId;
    },
    review_approved: approved,
    rejected: filedWith(values.stateRejectedResults),
    accepted: filedWith(values.acceptedResults),
    on_hold: async (s) => {
      const { caseId } = await walkIn(s);
      await act(s, siteCoordinator, caseId, "REQUEST_DOCUMENTS_AT_INTAKE", {
        requests: values.INTAKE_REQUESTS,
      });
      await act(s, siteCoordinator, caseId, "PUT_ON_HOLD", values.HOLD);
      return caseId;
    },
    withdrawn: async (s) => {
      const caseId = await officeBase(s);
      await act(s, siteCoordinator, caseId, "CLOSE_CASE", {
        confirmed: true,
        reason: "withdrawn",
      });
      return caseId;
    },
  };

  const caseIdsByScenario = {};
  for (const scenario of SEED_SCENARIOS)
    caseIdsByScenario[scenario] = await builders[scenario](scenario);

  // No action creates help requests, so the one help request is inserted.
  const help = values.HELP_REQUEST;
  const { rows } = await client.query(
    `insert into public.assistance_items(workspace_id,case_id,title,status,revision,assignee_person_id,language,contact_preference)
     values($1,$2,$3,'open',1,null,$4,$5) returning id`,
    [
      workspaceId,
      caseIdsByScenario.client_received,
      help.title,
      help.language,
      help.contactPreference,
    ],
  );
  const assistanceId = rows[0].id;
  run.assistanceIds.push(assistanceId);
  await recordRun(run, runDir);

  return {
    casesRemoved,
    casesCreated: run.caseIds.length,
    caseIdsByScenario,
    assistanceId,
  };
}

const includesAll = (have, want) => want.every((x) => have.includes(x));
const union = (a, b) => [...new Set([...a, ...b])];

// Gives each role account in the workspace its current-season role and
// confirmed certificates (ROLE_ACCOUNT_CLEARANCE), through the same
// `vitally_save_volunteer` the Roster uses, acting as the Site Coordinator.
// An account that already has at least these roles and these confirmed
// certificates, and `isNew: false`, is left alone, so a second run changes no
// revision. Otherwise the save adds the missing roles and certificates to what
// the account has: nothing it already holds is removed (the existing roles are
// already backed by its confirmed certificates). Everything else about the account (name, phone, languages, the
// photo ID check) is sent as it was read. A key with no staff account in the
// workspace is skipped. This runs before anything acts as a role account:
// the case RPCs refuse staff who are not cleared.
export async function clearRoleAccounts(client, { workspaceId, actorUserId }) {
  let saved = 0;
  for (const [key, want] of Object.entries(SEED_VALUES.ROLE_ACCOUNT_CLEARANCE)) {
    const { rows: people } = await client.query(
      `select p.id, p.name, v.email, v.phone, v.works, v.languages,
              v.other_language, v.revision,
              e.roles as entry_roles, e.is_new,
              e.photo_id_checked_at is not null as photo_id_checked,
              array(select c.certificate from public.certificates c
                     where c.workspace_id = p.workspace_id and c.person_id = p.id
                       and c.season = w.current_season and c.status = 'confirmed') as confirmed
         from public.people p
         join public.workspaces w on w.id = p.workspace_id
         join public.volunteer_profiles v
           on v.workspace_id = p.workspace_id and v.person_id = p.id
         left join public.roster_entries e
           on e.workspace_id = p.workspace_id and e.person_id = p.id
          and e.season = w.current_season
        where p.workspace_id = $1 and p.person_key = $2 and p.user_id is not null`,
      [workspaceId, key],
    );
    const person = people[0];
    if (!person) continue;
    if (
      person.entry_roles &&
      person.is_new === false &&
      includesAll(person.entry_roles, want.roles) &&
      includesAll(person.confirmed, want.certificates)
    )
      continue;
    await callRpc(client, actorUserId, "vitally_save_volunteer", {
      p_action_id: randomUUID(),
      p_volunteer_id: person.id,
      p_expected_revision: person.revision,
      p_volunteer: {
        name: person.name,
        email: person.email,
        phone: person.phone,
        works: person.works,
        languages: person.languages,
        otherLanguage: person.other_language,
        roles: union(person.entry_roles ?? [], want.roles),
        certificates: union(person.confirmed, want.certificates),
        isNew: want.isNew,
        photoIdChecked: person.photo_id_checked,
      },
    });
    saved += 1;
  }
  return saved;
}

// Adds the rehearsal volunteers to the Roster. A re-run first removes the
// earlier ones (a person with no sign-in and one of these addresses; the
// foreign keys remove their profile, roster entry and certificates), so
// the count stays at eight. Only `seedWorkspace` calls this: the browser story
// calls `seedCases` directly and must not gain Roster rows.
export async function seedVolunteers(client, { workspaceId, actorUserId }) {
  await client.query(
    `delete from public.people p
      where p.workspace_id = $1 and p.user_id is null
        and exists (select 1 from public.volunteer_profiles v
                     where v.person_id = p.id and v.workspace_id = p.workspace_id
                       and v.email = any($2::text[]))`,
    [workspaceId, SEED_VALUES.SEED_VOLUNTEERS.map((v) => v.email)],
  );
  for (const volunteer of SEED_VALUES.SEED_VOLUNTEERS) {
    await callRpc(client, actorUserId, "vitally_save_volunteer", {
      p_action_id: randomUUID(),
      p_volunteer_id: null,
      p_expected_revision: null,
      p_volunteer: volunteer,
    });
  }
  return SEED_VALUES.SEED_VOLUNTEERS.length;
}

// What `seed.mjs` runs: the local-only guard, then one seed on its own
// connection.
export async function seedWorkspace({
  workspaceId,
  clientAEmail,
  runDir = ".vitally-runs",
  env = process.env,
} = {}) {
  await assertLocalSeedTarget({ env });
  const client = await openDatabase({ kind: "test", env });
  try {
    const targets = await resolveSeedTargets(client, {
      workspaceId,
      clientAEmail,
    });
    // First, so the case seed's role accounts are cleared when they act.
    await clearRoleAccounts(client, {
      workspaceId,
      actorUserId: targets.siteCoordinator.userId,
    });
    const { casesRemoved, casesCreated } = await seedCases(client, targets, {
      runDir,
    });
    const volunteersCreated = await seedVolunteers(client, {
      workspaceId,
      actorUserId: targets.siteCoordinator.userId,
    });
    return { casesRemoved, casesCreated, volunteersCreated };
  } finally {
    await client.end();
  }
}
