import { randomUUID, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { assertTestTarget } from "../../tools/admin/test-target.mjs";
import { openDatabase, databaseError } from "../../tools/admin/database.mjs";
import { initializeWorkspace } from "../../tools/admin/workspace-setup.mjs";
import { resolveSeedTargets, seedCases } from "../../tools/admin/seed-cases.mjs";
import { createAppError } from "../../src/errors.mjs";
import { makeSampleAnswers } from "../../src/sample-data.mjs";
import { createRun, ownedRun, saveRun, endRun } from "./run-manifest.mjs";
import { extendTestWorkspace } from "./workspace-overrides.mjs";
// The fixture reads staff rows through the production adapter, so the browser
// and these tests share one snake_case → camelCase mapping (Ruling R32). A
// second copy here could drift from the shapes the application actually shows.
import { createStore, camelRow } from "../../src/supabase-store.mjs";
// The screening checks the office records (design D2): three for every case,
// and identity only for an online one.
export const screeningChecks = (service) => ({
  phone: true,
  documents: true,
  in_scope: true,
  ...(service === "online" ? { identity: true } : {}),
});
const INTAKE_CHECKS = Object.freeze(screeningChecks("drop_off"));
// The one fictional document request and the single simulated file the demo
// accepts (contracts.mjs payload table, Ruling R18).
const SAMPLE_REQUEST = Object.freeze({
  title: "Mileage record",
  message: "Please add the fictional sample.",
});
const SAMPLE_FILENAME = "demo-mileage-record-2025.pdf";
// The one fictional assistance request `seedAssistance` creates. Language and
// contact preference are the fields the assistance list shows a helper.
const SAMPLE_ASSISTANCE = Object.freeze({
  title: "Client needs help completing intake forms",
  language: "Mandarin",
  contactPreference: "Prefers calls from the main office",
});
// Actions whose payload names a related record. For compact tests only, an
// omitted id falls back to the case's single current request or open follow-up;
// the browser always sends the selected id (Ruling R20).
const RELATED_DEFAULTS = Object.freeze({
  RESPOND_DOCUMENT: "requestId",
  RECORD_DOCUMENT_RESPONSE: "requestId",
  VERIFY_DOCUMENT: "requestId",
  ESCALATE_CONTACT: "requestId",
  RECORD_CONTACT: "followupId",
  RESOLVE_FOLLOWUP: "followupId",
});
// Every table a case action could touch, for before/after state comparisons.
const STATE_TABLES = Object.freeze([
  "cases",
  "action_receipts",
  "preparation_participants",
  "case_events",
  "client_events",
  "document_requests",
  "documents",
  "admin_followups",
  "contact_attempts",
  "contact_log",
  "contact_log_versions",
  "reviews",
  "assistance_items",
  "case_contacts",
  "case_document_cards",
  "case_materials",
]);
// The four staff accounts every fixture workspace gets (see the end of
// createDatabaseFixture): [fixture field, person key, fictional name, capabilities].
const ROLE_ACCOUNTS = Object.freeze([
  ["siteCoordinator", "site_coordinator", "Avery Lin", ["admin", "followup", "assist", "receive_documents"]],
  ["preparer", "preparer", "Taylor Brooks", ["prepare"]],
  ["reviewer", "reviewer", "Jamie Ellis", ["review"]],
  ["intaker", "intaker", "Rowan Price", ["receive_documents", "assist"]],
]);
// One key for the advisory lock that keeps fixture workspace setup exclusive
// across parallel test processes (see initializeOwned below).
const SETUP_LOCK =
  "select pg_advisory_lock(hashtextextended('vitally-test-fixture-setup',0))";
const SETUP_UNLOCK =
  "select pg_advisory_unlock(hashtextextended('vitally-test-fixture-setup',0))";
const options = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};
// An assert.rejects predicate for one mapped domain code.
// Valid questionnaires for SUBMIT_REVIEW / RESUBMIT_REVIEW and APPROVE_REVIEW (fictional).
const TODAY = () => new Date().toISOString().slice(0, 10);
export const PREPARER = Object.freeze({
  confirmedBy: "client",
  confirmedMethod: "phone",
  shadedPartsCompleted: true,
  stateForgivenessSet: true,
  readyForReviewOn: TODAY(),
});
export const REVIEWER = Object.freeze({
  completedOn: TODAY(),
  paForgiveness: "eligible",
  wentOver: true,
  wentOverOn: TODAY(),
  wentOverHow: "phone",
  signMethod: "portal",
  exitForm: Object.freeze({ federal: null, state: null, local: [] }),
});
export const rejected = (code) => (error) => error.code === code;
// Fully specified immutable arguments for a direct vitally_apply_action call,
// so replays and races reuse one envelope and a payload can omit the related
// id that f.act would otherwise fill in.
export const applyArgs = ({
  actionId = randomUUID(),
  caseId,
  revision,
  personId = null,
  type,
  payload = {},
}) => ({
  p_action_id: actionId,
  p_case_id: caseId,
  p_expected_revision: revision,
  p_person_id: personId,
  p_type: type,
  p_payload: payload,
});
// The same for vitally_assistance_action, whose envelope carries an item and a
// plain note instead of a case and a payload object.
export const assistanceArgs = ({
  actionId = randomUUID(),
  itemId,
  revision,
  personId = null,
  type,
  note = null,
}) => ({
  p_action_id: actionId,
  p_item_id: itemId,
  p_expected_revision: revision,
  p_person_id: personId,
  p_type: type,
  p_note: note,
});
// The contact log's two RPCs (OpenSpec change add-contact-log, design D1).
// An entry has exactly these eight keys; SAMPLE_CONTACT is a function so each
// call takes a fresh contact time.
export const SAMPLE_CONTACT = () => ({
  direction: "outgoing",
  contactedAt: new Date().toISOString(),
  withWhom: "client",
  otherName: null,
  method: "phone",
  purpose: "go_over_return",
  outcome: "reached",
  note: "Asked about the fictional 1099-R.",
});
export const contactArgs = ({
  actionId = randomUUID(),
  caseId,
  personId = null,
  followupId = null,
  entry,
}) => ({
  p_action_id: actionId,
  p_case_id: caseId,
  p_person_id: personId,
  p_followup_id: followupId,
  p_entry: entry,
});
export const editContactArgs = ({
  actionId = randomUUID(),
  contactId,
  revision,
  personId = null,
  entry,
}) => ({
  p_action_id: actionId,
  p_contact_id: contactId,
  p_expected_revision: revision,
  p_person_id: personId,
  p_entry: entry,
});
// `siteCoordinatorFollowsUp: false` leaves Sam as the default follow-up
// person: the sample-data tests (tests/database-fixtures.mjs) check the seeded
// samples' follow-ups against the default the samples are written for.
// `roleAccounts: false` adds no role accounts at all, for the tests whose
// subject is the initializer's own workspace (exactly the three demonstration
// people, Sam the default); their reads then go through the presenter.
export async function createDatabaseFixture({
  afterInitialize,
  roleAccounts = true,
  siteCoordinatorFollowsUp = true,
} = {}) {
  const target = await assertTestTarget();
  const runManifest = await createRun(),
    run = ownedRun(runManifest);
  const admin = createClient(target.apiUrl, target.adminKey, options),
    clients = [];
  const sqlClient = await openDatabase();
  const f = {
    runManifest,
    workspaceId: randomUUID(),
    foreignWorkspaceId: randomUUID(),
    anonymous: createClient(target.apiUrl, target.publishableKey, options),
  };
  f.service = async (operation) => {
    await assertTestTarget();
    return operation(admin);
  };
  f.sql = async (text, values) => {
    await assertTestTarget();
    try {
      return await sqlClient.query(text, values);
    } catch (error) {
      throw databaseError(error);
    }
  };
  // Workspace setup is one serializable transaction over a people table small
  // enough that every workspace shares an index page, so test files starting
  // together see serialization failures that outlast the initializer's three
  // retries. Every setup call — the fixture's own and the direct
  // `initializeWorkspace` calls in tests/database.mjs — runs inside this
  // session-level advisory lock, held on the fixture's own connection and
  // never during a test. A deliberately concurrent pair belongs inside one
  // call so the pair still races itself (Ruling R26). Nothing in the product,
  // the initializer or the migrations changes.
  f.withSetupLock = async (body) => {
    await f.sql(SETUP_LOCK);
    try {
      return await body();
    } finally {
      await f.sql(SETUP_UNLOCK);
    }
  };
  // Every helper below acts as the signed-in account itself and sends
  // `p_person_id: null`: a staff account always acts as its own person, and an
  // applicant names no person. When the RPCs drop the parameter, only these
  // helpers' internals change. The `...AsPersona` helpers further down keep the
  // old explicit person for the tests whose subject is presenter or persona
  // behaviour; they go away with presenter mode.
  const createCase = async (actor, actionId, { mode = "client", personId = null, answers = {} } = {}) => {
    const { data, error } = await actor.rpc("vitally_create_case", {
      p_action_id: actionId,
      p_mode: mode,
      p_person_id: personId,
      p_answers: answers,
    });
    if (error) throw databaseError(error);
    return data;
  };
  f.createCase = (actor, actionId, { mode = "client", answers = {} } = {}) =>
    createCase(actor, actionId, { mode, answers });
  // A draft with answers. Version 2 refuses a create that carries answers (011's
  // insert trigger, VT007), so the case is created empty and the answers are
  // saved straight after, as the client's own form does.
  f.draftCase = async (actor, { mode = "client", answers = makeSampleAnswers() } = {}) => {
    const created = await f.createCase(actor, randomUUID(), { mode, answers: {} });
    await f.act(actor, created.caseId, "SAVE_ANSWERS", { answers });
    // The receipt is the create's (revision 1); the case is one ahead, at 2.
    return created;
  };
  // The drop-off set only; use f.checksFor(caseId) for an arbitrary case.
  f.intakeChecks = INTAKE_CHECKS;
  // The checks that suit one case: its service answer decides the set.
  f.checksFor = async (caseId) =>
    screeningChecks(
      (await f.sql("select answers->>'service' as service from public.cases where id=$1", [caseId]))
        .rows[0]?.service,
    );
  // The client staff reads go through: the Site Coordinator, or the presenter
  // in a fixture made with `roleAccounts: false`.
  const staffReader = () => f.siteCoordinator ?? f.presenter;
  // A row the caller cannot see is NOT_FOUND, never a raw SDK row-count error.
  const visibleRow = async (client, table, id) => {
    const { data, error } = await client.from(table).select("*").eq("id", id);
    if (error) throw createAppError(error);
    if (!data.length) throw createAppError({ code: "VT002" });
    return data[0];
  };
  const visibleCase = (client, caseId) => visibleRow(client, "cases", caseId);
  const visibleRows = async (client, table, caseId, tiebreak = "id") => {
    const { data, error } = await client
      .from(table)
      .select("*")
      .eq("case_id", caseId)
      .order("created_at")
      .order(tiebreak);
    if (error) throw createAppError(error);
    return data.map(camelRow);
  };
  // The case's one current request or one open follow-up, so a test payload can
  // leave the id out. Anything else is a fixture mistake, not a server answer.
  const onlyRelated = async (caseId, key) => {
    const [table, current] =
      key === "requestId"
        ? ["document_requests", (row) => row.status !== "cancelled"]
        : ["admin_followups", (row) => row.status === "open"];
    const rows = (await visibleRows(staffReader(), table, caseId)).filter(current);
    if (rows.length !== 1)
      throw Object.assign(
        new Error(`Expected exactly one current ${table} row for the case.`),
        { code: "FIXTURE_AMBIGUOUS" },
      );
    return rows[0].id;
  };
  const act = async (client, caseId, personId, type, payload = {}) => {
    const related = RELATED_DEFAULTS[type];
    const body =
      related && !(related in payload)
        ? { ...payload, [related]: await onlyRelated(caseId, related) }
        : payload;
    const current = await visibleCase(client, caseId);
    const { data, error } = await client.rpc("vitally_apply_action", {
      p_action_id: randomUUID(),
      p_case_id: caseId,
      p_expected_revision: current.revision,
      p_person_id: personId,
      p_type: type,
      p_payload: body,
    });
    if (error) throw createAppError(error);
    return data;
  };
  f.act = (client, caseId, type, payload = {}) => act(client, caseId, null, type, payload);
  // `f.act` for the assistance entry point. Tests that need an explicit
  // revision (races, replays, invisible items) call `rpc` with assistanceArgs.
  f.actAssistance = async (client, itemId, type, note = null) => {
    const current = await visibleRow(client, "assistance_items", itemId);
    const { data, error } = await client.rpc(
      "vitally_assistance_action",
      assistanceArgs({
        itemId,
        revision: Number(current.revision),
        type,
        note,
      }),
    );
    if (error) throw createAppError(error);
    return data;
  };
  // A contact log entry, linked to a follow-up task when `followupId` is given.
  const logContact = async (client, caseId, personId, entry, followupId = null) => {
    const { data, error } = await client.rpc(
      "vitally_log_contact",
      contactArgs({ caseId, personId, followupId, entry }),
    );
    if (error) throw createAppError(error);
    return data;
  };
  f.logContact = (client, caseId, entry, followupId = null) =>
    logContact(client, caseId, null, entry, followupId);
  // The season-end close: `cases` is [{caseId, revision}].
  f.closeUnsigned = async (
    client,
    cases,
    { actionId = randomUUID(), confirmed = true } = {},
  ) => {
    const { data, error } = await client.rpc("vitally_close_unsigned", {
      p_action_id: actionId,
      p_person_id: null,
      p_cases: cases,
      p_confirmed: confirmed,
    });
    if (error) throw createAppError(error);
    return data;
  };
  // An edit against the entry's current revision, as the caller reads it.
  f.editContact = async (client, contactId, entry) => {
    const current = await visibleRow(client, "contact_log", contactId);
    const { data, error } = await client.rpc(
      "vitally_edit_contact",
      editContactArgs({
        contactId,
        revision: Number(current.revision),
        entry,
      }),
    );
    if (error) throw createAppError(error);
    return data;
  };
  // Legacy, presenter mode only: the caller names a person explicitly. Kept for
  // the tests whose subject is presenter or persona behaviour (persona
  // refusals, a client or staff member naming a person). These go away with
  // presenter mode.
  f.createCaseAsPersona = createCase;
  f.actAsPersona = act;
  f.logContactAsPersona = logContact;
  // An unclaimed case waiting for a preparer, built only through public actions.
  f.readyCase = async () => {
    const created = await f.draftCase(f.applicantA);
    await f.act(f.applicantA, created.caseId, "SUBMIT", {
      confirmed: true,
    });
    await f.act(f.siteCoordinator, created.caseId, "START_SCREENING", {});
    await f.act(f.siteCoordinator, created.caseId, "VERIFY_INTAKE", {
      checks: await f.checksFor(created.caseId),
    });
    return created.caseId;
  };
  f.sampleRequest = SAMPLE_REQUEST;
  f.sampleFilename = SAMPLE_FILENAME;
  // An assisted case with no client owner, prepared by the Preparer and waiting
  // on one open document request: the case the staff receipt action exists for.
  f.assistedCase = async () => {
    const created = await f.draftCase(f.siteCoordinator, { mode: "assisted" });
    await f.act(f.siteCoordinator, created.caseId, "SUBMIT", {
      confirmed: true,
    });
    await f.act(f.siteCoordinator, created.caseId, "VERIFY_INTAKE", {
      checks: await f.checksFor(created.caseId),
    });
    await f.act(f.preparer, created.caseId, "CLAIM_PREPARATION", {});
    await f.act(f.preparer, created.caseId, "REQUEST_DOCUMENT", SAMPLE_REQUEST);
    return created.caseId;
  };
  // A client case the Preparer has claimed and handed to review: preparation
  // version 1, stage review_ready, no reviewer. Built only through public actions.
  f.preparedCase = async () => {
    const caseId = await f.readyCase();
    await f.act(f.preparer, caseId, "CLAIM_PREPARATION", {});
    await f.act(f.preparer, caseId, "SUBMIT_REVIEW", { questionnaire: PREPARER });
    return caseId;
  };
  // A client case just submitted: stage received, no screening yet.
  f.submittedClientCase = async () => {
    const created = await f.draftCase(f.applicantA);
    await f.act(f.applicantA, created.caseId, "SUBMIT", {
      confirmed: true,
    });
    return { caseId: created.caseId };
  };
  // The client's history lines for a case, oldest first (client_events.message).
  f.clientMessages = async (caseId) =>
    (
      await f.sql(
        "select message from public.client_events where case_id=$1 order by created_at, id",
        [caseId],
      )
    ).rows.map((row) => row.message);
  // A case at review_approved, approved with a valid Yes questionnaire: the
  // review-contact step is completed by the approval itself (design D10).
  // `wentOver: false` approves with "no" (portal signing), which opens the
  // office's go-over follow-up (design D5).
  f.approvedCase = async ({ wentOver = true } = {}) => {
    const caseId = await f.preparedCase();
    await f.act(f.reviewer, caseId, "CLAIM_REVIEW", {});
    const { wentOverOn, wentOverHow, ...rest } = REVIEWER;
    await f.act(f.reviewer, caseId, "APPROVE_REVIEW", {
      questionnaire: wentOver ? REVIEWER : { ...rest, wentOver: false },
    });
    return caseId;
  };
  // A case at review_approved as an approval from before the questionnaires
  // left it: the review is approved with its contact step pending and no
  // questionnaire. No action produces this any more, so it is inserted directly.
  f.legacyApprovedCase = async () => {
    const caseId = await f.preparedCase();
    await f.act(f.reviewer, caseId, "CLAIM_REVIEW", {});
    await f.sql(
      "update public.reviews set status='approved',decided_at=now(),client_contact_status='pending' where case_id=$1 and status='active'",
      [caseId],
    );
    await f.sql("update public.cases set stage='review_approved' where id=$1", [caseId]);
    return caseId;
  };
  // Test-only additive people and capabilities on this run's own workspace
  // (contracts, "Test-only people and capabilities"). Returns the added
  // people's ids keyed by person_key. After any enrichment the normal
  // initializer rejects this workspace, by design.
  f.enrich = async ({ addPeople = [], addCapabilities = [] } = {}) => {
    const { people } = await extendTestWorkspace({
      runManifest,
      workspaceId: f.workspaceId,
      addPeople,
      addCapabilities,
    });
    return people;
  };
  // Historical reassignment for the self-review regression only. No product
  // action reassigns or releases a case, so the test project writes the
  // records a reassignment would have left: the new current preparer, their
  // participation, and the former preparer's participation retained.
  f.reassignPreparer = async (caseId, fromPersonId, toPersonId) => {
    const moved = await f.sql(
      "update public.cases set preparer_id=$3 where id=$1 and workspace_id=$4 and preparer_id=$2 returning id",
      [caseId, fromPersonId, toPersonId, f.workspaceId],
    );
    if (moved.rowCount !== 1)
      throw Object.assign(
        new Error("Expected the case to be prepared by the former preparer."),
        { code: "FIXTURE_AMBIGUOUS" },
      );
    await f.sql(
      "insert into public.preparation_participants(workspace_id,case_id,person_id) values($1,$2,$3) on conflict do nothing",
      [f.workspaceId, caseId, toPersonId],
    );
  };
  f.sampleAssistance = SAMPLE_ASSISTANCE;
  // One open assistance request against a received, unclaimed case. Assistance
  // items have no creating action in this scope, so the row is seeded through
  // the privileged connection; its case is built only through public actions.
  f.seedAssistance = async () => {
    const created = await f.draftCase(f.applicantA);
    await f.act(f.applicantA, created.caseId, "SUBMIT", {
      confirmed: true,
    });
    const inserted = await f.sql(
      `insert into public.assistance_items(workspace_id,case_id,title,status,revision,assignee_person_id,language,contact_preference)
       values($1,$2,$3,'open',1,null,$4,$5) returning id`,
      [
        f.workspaceId,
        created.caseId,
        SAMPLE_ASSISTANCE.title,
        SAMPLE_ASSISTANCE.language,
        SAMPLE_ASSISTANCE.contactPreference,
      ],
    );
    return { itemId: inserted.rows[0].id, caseId: created.caseId };
  };
  // Staff reads go through the production adapter on the Site Coordinator's
  // own client, so these helpers prove staff visibility *and* exercise the one
  // mapping the browser uses. A row staff cannot see is NOT_FOUND, exactly as
  // it is for the application. (Since migration 038 staff see exactly what a
  // presenter sees.)
  f.staffStore = () => createStore(staffReader());
  // The assistance item as staff read it.
  f.readStaffAssistance = async (itemId) => {
    const item = (await f.staffStore().listAssistance()).find(
      (row) => row.id === itemId,
    );
    if (!item) throw createAppError({ code: "VT002" });
    return item;
  };
  // The staff Case shape from src/contracts.mjs.
  f.readStaffCase = (caseId) => f.staffStore().getCase(caseId);
  // Every column of every application row in the workspace, so an accepted
  // write cannot hide behind an unchanged row count. `f.snapshot` below covers
  // workspace setup (people, memberships, bindings) instead.
  f.stateSnapshot = async () => {
    const snapshot = {};
    for (const table of STATE_TABLES)
      snapshot[table] = (
        await f.sql(
          `select to_jsonb(t.*) as record from public.${table} t where t.workspace_id=$1 order by to_jsonb(t.*)::text`,
          [f.workspaceId],
        )
      ).rows.map((row) => row.record);
    return snapshot;
  };
  // Receipt rows for one action id: zero after any rejection.
  f.receiptsFor = async (actionId) =>
    Number(
      (
        await f.sql(
          "select count(*) as count from public.action_receipts where action_id=$1",
          [actionId],
        )
      ).rows[0].count,
    );
  // Every membership row this account holds anywhere, so a revoked or deleted
  // one is an empty array rather than a silent undefined.
  f.readMembership = async (userId) =>
    (
      await f.sql(
        "select workspace_id,user_id,access,active from public.memberships where user_id=$1 order by workspace_id",
        [userId],
      )
    ).rows;

  // The seed command (tools/admin/seed-cases.mjs) against this workspace, on
  // its own connection and run directory. Each `seed()` is one run: it removes
  // the previous run's cases and help request, then builds a fresh set through
  // the public actions. `close()` ends the connection and removes the run file.
  f.seedRunner = async () => {
    const runDir = await mkdtemp(path.join(tmpdir(), "seed-run-"));
    const client = await openDatabase().catch(async (error) => {
      await rm(runDir, { recursive: true, force: true });
      throw error;
    });
    return {
      seed: async () =>
        seedCases(
          client,
          await resolveSeedTargets(client, {
            workspaceId: f.workspaceId,
            clientAEmail: f.applicantAEmail,
          }),
          { runDir },
        ),
      close: async () => {
        await client.end();
        await rm(runDir, { recursive: true, force: true });
      },
    };
  };

  f.snapshot = async () => {
    const out = {};
    for (const [name, sql] of Object.entries({
      people:
        "select id,person_key,name,capabilities from public.people where workspace_id=$1 order by person_key",
      memberships:
        "select user_id,access,active from public.memberships where workspace_id=$1 order by user_id",
      workspace: "select * from public.workspaces where id=$1",
    }))
      out[name] = (await f.sql(sql, [f.workspaceId])).rows;
    return out;
  };
  f.close = async () => {
    if (!run.active) return;
    // Cleanup is deliberately specific: never enumerate Auth users or select by email.
    await assertTestTarget();
    for (const id of new Set([...run.workspaces, ...run.pendingWorkspaces])) {
      const marker = await f.sql(
        "select run_id from vitally_private.test_workspaces where workspace_id=$1",
        [id],
      );
      if (!marker.rowCount) {
        const existing = await f.sql(
          "select id from public.workspaces where id=$1",
          [id],
        );
        if (!existing.rowCount) {
          run.pendingWorkspaces.delete(id);
          await saveRun(runManifest);
          continue;
        }
      }
      if (marker.rows[0]?.run_id !== runManifest.runId)
        throw Object.assign(new Error("Cleanup workspace marker rejected."), {
          code: "TARGET_REJECTED",
        });
      const deleted = await f.sql(
        "delete from public.workspaces w where w.id=$1 and exists(select 1 from vitally_private.test_workspaces t where t.workspace_id=w.id and t.run_id=$2) returning w.id",
        [id, runManifest.runId],
      );
      if (deleted.rowCount !== 1)
        throw Object.assign(new Error("Cleanup workspace marker rejected."), {
          code: "TARGET_REJECTED",
        });
      run.workspaces.delete(id);
      run.pendingWorkspaces.delete(id);
      await saveRun(runManifest);
    }
    for (const client of clients) await client.auth.signOut({ scope: "local" });
    for (const id of [...run.users]) {
      await assertTestTarget();
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) throw new Error("Tracked Auth cleanup failed.");
      run.users.delete(id);
      await saveRun(runManifest);
    }
    await sqlClient.end();
    await endRun(runManifest);
  };
  // One confirmed synthetic account, tracked for cleanup and signed in.
  const provision = async () => {
    await assertTestTarget();
    const password = randomBytes(32).toString("base64url");
    const email = `${randomUUID()}@vitally.invalid`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !data.user)
      throw new Error("Synthetic Auth provisioning failed.");
    run.users.add(data.user.id);
    await saveRun(runManifest);
    const client = createClient(
      target.apiUrl,
      target.publishableKey,
      options,
    );
    clients.push(client);
    const auth = await client.auth.signInWithPassword({ email, password });
    if (auth.error) throw new Error("Synthetic Auth sign-in failed.");
    return { client, userId: data.user.id, email };
  };
  // A staff member of this run's workspace (OpenSpec change add-staff-identity):
  // a new account, a `staff` membership and a new linked person, made through
  // the one private function the roster command uses. `personKey` is `key`; a
  // repeat with changed values for the same key is refused, so each member a
  // file needs has a key of its own.
  // `workspaceId` names another workspace of this run (see f.initializeOwned).
  f.provision = provision;
  f.staff = async ({ key, name, capabilities, workspaceId = f.workspaceId }) => {
    const { client, userId, email } = await provision();
    await f.withSetupLock(() =>
      f.sql("select vitally_private.add_staff_member($1,$2,$3,$4,$5::text[])", [
        workspaceId,
        userId,
        key,
        name,
        capabilities,
      ]),
    );
    const { rows } = await f.sql(
      "select id from public.people where workspace_id=$1 and person_key=$2",
      [workspaceId, key],
    );
    return { client, userId, personId: rows[0].id, email };
  };
  try {
    // Schema preflight provides the intended RED before any Auth provisioning.
    await f.sql("select id from public.workspaces limit 0");
    for (const actor of [
      "applicantA",
      "applicantB",
      "presenter",
      "outsider",
      "unapproved",
    ]) {
      const { client, userId, email } = await provision();
      f[`${actor}UserId`] = userId;
      // The synthetic address beside the id (Ruling R46). The browser gate
      // types it into the real sign-in form and generates that user's one-time
      // code from it, so the actor a test signs in as is the actor the fixture
      // provisioned. It is never logged, and cleanup still works by id alone.
      f[`${actor}Email`] = email;
      f[actor] = client;
    }
    f.setup = {
      workspaceId: f.workspaceId,
      presenterUserIds: [f.presenterUserId],
      applicantUserIds: [f.applicantAUserId, f.applicantBUserId],
    };
    const initializeOwned = async (setup) => {
      run.pendingWorkspaces.add(setup.workspaceId);
      await saveRun(runManifest);
      return await f.withSetupLock(async () => {
        const result = await initializeWorkspace(setup, {
          afterInitialize: async (connection) => {
            await connection.query(
              "insert into vitally_private.test_workspaces(workspace_id,run_id) values($1,$2)",
              [setup.workspaceId, runManifest.runId],
            );
            if (afterInitialize)
              await afterInitialize({
                workspaceId: setup.workspaceId,
                runId: runManifest.runId,
                userIds: [...run.users],
              });
          },
        });
        run.pendingWorkspaces.delete(setup.workspaceId);
        run.workspaces.add(setup.workspaceId);
        await saveRun(runManifest);
        return result;
      });
    };
    // Workflow tests depend on the shared initializer's permanent people and
    // its default follow-up person; a partial workspace must fail, not skip.
    // It runs before the role accounts are added (below), so the workspace
    // still holds exactly the three demonstration people and Sam is still the
    // default when it checks.
    const initializeVerified = async (setup) => {
      const { people } = await initializeOwned(setup);
      const workspace = (
        await f.sql(
          "select w.default_followup_person_id,(select count(*) from public.people p where p.workspace_id=w.id) as people from public.workspaces w where w.id=$1",
          [setup.workspaceId],
        )
      ).rows[0];
      if (
        !workspace ||
        Number(workspace.people) !== 3 ||
        !people.alex ||
        !people.morgan ||
        workspace.default_followup_person_id !== people.sam
      )
        throw Object.assign(new Error("Workspace prerequisites are missing."), {
          code: "SETUP_INCOMPLETE",
        });
      return people;
    };
    // Another workspace of this run, owned and cleaned up like the foreign one.
    f.initializeOwned = initializeOwned;
    f.people = await initializeVerified(f.setup);
    ({ alex: f.alex, morgan: f.morgan, sam: f.sam } = f.people);
    // The staff accounts the workflow tests act as, one per role, made through
    // the roster's own path. The Site Coordinator is the default follow-up
    // person, as a site's lead would be. Fictional names only.
    f.roleAccounts = {};
    for (const [role, key, name, capabilities] of roleAccounts ? ROLE_ACCOUNTS : []) {
      const member = await f.staff({ key, name, capabilities });
      f.roleAccounts[role] = member;
      f[role] = member.client;
      f[`${role}Id`] = member.personId;
      f[`${role}UserId`] = member.userId;
    }
    if (roleAccounts && siteCoordinatorFollowsUp)
      await f.withSetupLock(() =>
        f.sql("select vitally_private.set_default_followup($1,$2)", [
          f.workspaceId,
          "site_coordinator",
        ]),
      );
    f.foreignPeople = await initializeVerified({
      workspaceId: f.foreignWorkspaceId,
      presenterUserIds: [],
      applicantUserIds: [f.outsiderUserId],
    });
    return f;
  } catch (error) {
    try {
      await f.close();
    } catch {
      await sqlClient.end().catch(() => {});
      throw Object.assign(
        new Error("Fixture failed; tracked cleanup requires attention."),
        { code: "CLEANUP_REQUIRED" },
      );
    }
    throw error;
  }
}
