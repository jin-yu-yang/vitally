import { createAppError } from "./errors.mjs";
import { isAuthTransportError } from "./auth.mjs";

// The one data adapter. Everything the browser knows about the database goes
// through this file: the five application RPCs, the RLS-scoped SELECT reads,
// the Realtime subscription, and the single snake_case → camelCase mapping
// that turns rows into the objects `src/contracts.mjs` documents. No DOM, no
// controller state, no auth. The Supabase client is injected (Ruling R33).
//
// Two rules this file keeps:
//
//   * **An applicant read never names a staff table.** RLS would refuse those
//     rows anyway, but asking is already a mistake: the adapter decides what to
//     fetch from the caller's own membership, so a client screen cannot request
//     findings, internal history or contact attempts by accident.
//   * **Every failure is mapped once.** `createAppError` in `src/errors.mjs` is
//     the only mapper, for `{error}` returned by supabase-js and for a thrown
//     transport failure alike, so the browser only ever sees a domain code.

// The tables each principal may watch, which are exactly the tables it may
// read. `subscribe` and the read paths share this one list.
const CLIENT_TABLES = Object.freeze([
  "cases",
  "document_requests",
  "documents",
  "client_events",
  "workspaces",
  "case_contacts",
  "case_document_cards",
]);
const STAFF_TABLES = Object.freeze([
  ...CLIENT_TABLES,
  "people",
  "preparation_participants",
  "admin_followups",
  "contact_log",
  "contact_log_versions",
  "case_events",
  "assistance_items",
  "reviews",
  "case_materials",
  "preparer_questionnaires",
  "reviewer_questionnaires",
  "preparer_shaded_fields",
]);
export const SUBSCRIBED_TABLES = Object.freeze({
  applicant: CLIENT_TABLES,
  presenter: STAFF_TABLES,
  // Staff read exactly what presenters read (migration 038, D9).
  staff: STAFF_TABLES,
});

// The two accesses that work cases: a presenter, and a signed-in staff member.
const isStaffAccess = (access) => access === "presenter" || access === "staff";

// INSERT and UPDATE only. A deleted row is never announced, and a refresh is
// how the browser learns that.
const WATCHED_EVENTS = Object.freeze(["INSERT", "UPDATE"]);

const CONNECTION_STATES = Object.freeze({
  SUBSCRIBED: "online",
  TIMED_OUT: "reconnecting",
  CHANNEL_ERROR: "reconnecting",
  CLOSED: "offline",
});

const camelKey = (key) => key.replace(/_([a-z])/g, (_, l) => l.toUpperCase());

// Whole-row camelCase, for the tables whose every column is client-safe.
export const camelRow = (row) =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => [camelKey(key), value]),
  );

// The Case scalars of `contracts.mjs`. Deliberately narrower than the row:
// origin and the created_by columns are storage detail and are
// not part of the browser Case.
export const mapCase = (row) => ({
  id: row.id,
  reference: row.reference,
  workspaceId: row.workspace_id,
  ownerUserId: row.owner_user_id,
  stage: row.stage,
  revision: Number(row.revision),
  preparationVersion: Number(row.preparation_version),
  answers: row.answers,
  intakeVerified: row.intake_verified,
  preparerId: row.preparer_id,
  reviewerId: row.reviewer_id,
  season: row.season ?? null,
  clientNumber: row.client_number ?? null,
  lastRemindedAt: row.last_reminded_at,
  lastRemindedByPersonId: row.last_reminded_by_person_id,
  // When the case was created, and when the last accepted action committed
  // (migration 008). Both mappers get them, because both start here.
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  // Always 2 (migration 023).
  intakeVersion: Number(row.intake_version),
  // The sub-steps the client has opened (migration 017); [] before it.
  intakeVisited: Array.isArray(row.intake_visited) ? [...row.intake_visited] : [],
  // How the client will sign Form 8879 and the appointment's wall-clock time
  // (migration 033); null until a questionnaire approval sets them.
  signingPlan: row.signing_plan ?? null,
  signingAppointmentAt: row.signing_appointment_at ?? null,
  // How each return was filed ('efile' or 'paper') and the answer to it
  // (migration 035); null until the case is filed, and until answered.
  federalMethod: row.federal_method ?? null,
  stateMethod: row.state_method ?? null,
  federalResult: row.federal_result ?? null,
  stateResult: row.state_result ?? null,
  // Where the case was when documents were asked for or it went on hold, and
  // why it closed (migration 036); null when none applies.
  documentsOrigin: row.documents_origin ?? null,
  holdOrigin: row.hold_origin ?? null,
  closingReason: row.closing_reason ?? null,
});

// The filing history (migration 035), staff only: one entry per time the case
// was filed, newest first, with that filing's returns (federal then state) and
// the fix notes recorded after a rejection (oldest first). The rows arrive in
// those orders; this only groups them.
export const mapFilingAttempts = (attempts = [], returns = [], notes = []) =>
  attempts.map((row) => ({
    attempt: Number(row.attempt),
    filedAt: row.filed_at,
    returns: returns
      .filter((entry) => Number(entry.attempt) === Number(row.attempt))
      .map((entry) => ({
        returnKind: entry.return_kind,
        method: entry.method,
        result: entry.result ?? null,
        answeredOn: entry.answered_on ?? null,
        rejectCode: entry.reject_code ?? null,
      })),
    notes: notes
      .filter((entry) => Number(entry.attempt) === Number(row.attempt))
      .map((entry) => ({
        note: entry.note,
        recordedBy: entry.recorded_by,
        recordedAt: entry.recorded_at,
      })),
  }));

// The case's contact details (migration 011), or null when it has no row: a
// case nobody has saved a contact for.
export const mapContact = (row) =>
  row
    ? {
        phone: row.phone,
        spousePhone: row.spouse_phone,
        bestContactTime: row.best_contact_time,
        bestContactNote: row.best_contact_note,
      }
    : null;

// One document card the client or staff has acted on (migration 017). The row
// names no person: both principals read it, and realtime sends it whole.
export const mapDocumentCard = (row) => ({
  slotId: row.slot_id,
  status: row.status,
  groupOverride: row.group_override,
  changedAt: row.changed_at,
});

// The materials the site has received (migration 013). Staff only.
export const mapMaterial = (row) => ({
  item: row.item,
  receivedAt: row.received_at,
  recordedByPersonId: row.recorded_by_person_id,
});

export const mapPerson = (row) => ({
  id: row.id,
  name: row.name,
  capabilities: row.capabilities,
  // A person a staff account has claimed acts only through that account, so a
  // presenter may not choose them as a persona (staff identity, D9).
  linked: row.user_id != null,
});

// Review attempts oldest first. Findings and resolutions are internal staff
// text; they live here and reach no client-readable row.
export const mapReview = (row) => ({
  id: row.id,
  preparationVersion: Number(row.preparation_version),
  reviewerId: row.reviewer_person_id,
  status: row.status,
  findings: row.findings,
  resolution: row.resolution,
  clientContactStatus: row.client_contact_status,
  clientContactOutcome: row.client_contact_outcome,
  clientContactNote: row.client_contact_note,
  createdAt: row.created_at,
  decidedAt: row.decided_at,
  clientContactedAt: row.client_contacted_at,
});

// Each follow-up is its own row; its calls live in the contact log, which the
// case carries as `contacts`.
export const mapFollowup = (row) => ({
  id: row.id,
  requestId: row.request_id,
  assigneeId: row.assignee_person_id,
  purpose: row.purpose ?? "request_documents",
  status: row.status,
  reason: row.reason,
  resolutionOutcome: row.resolution_outcome,
  resolutionNote: row.resolution_note,
  createdByPersonId: row.created_by_person_id,
  createdAt: row.created_at,
  resolvedAt: row.resolved_at,
});

// The fields of a contact that an edit can change; a version holds only these.
const contactFields = (row) => ({
  direction: row.direction,
  contactedAt: row.contacted_at,
  withWhom: row.with_whom,
  otherName: row.other_name,
  method: row.method,
  purpose: row.purpose,
  outcome: row.outcome,
  note: row.note,
});

export const mapContactVersion = (row) => ({
  version: Number(row.version),
  createdAt: row.created_at,
  editedByPersonId: row.edited_by_person_id,
  ...contactFields(row),
});

// One contact log entry with all its versions (oldest first).
export const mapContactEntry = (row, versionRows = []) => ({
  id: row.id,
  caseId: row.case_id,
  followupId: row.followup_id,
  revision: Number(row.revision),
  loggedAt: row.logged_at,
  editedAt: row.edited_at,
  loggedByPersonId: row.logged_by_person_id,
  ...contactFields(row),
  versions: versionRows
    .filter((version) => version.contact_id === row.id)
    .map(mapContactVersion),
});

export const mapAssistance = (row) => ({
  id: row.id,
  caseId: row.case_id,
  title: row.title,
  status: row.status,
  revision: Number(row.revision),
  assigneeId: row.assignee_person_id,
  resolutionNote: row.resolution_note,
  language: row.language,
  contactPreference: row.contact_preference,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// The columns of the three client-readable related tables that the client's
// own screens read, and the whole of what an applicant's payload carries.
// Exported so a test can pin them: what is missing here matters more than what
// is present — no `submitted_by_user_id`, no staff person id, no internal
// column that a later migration might add to one of these tables.
export const CLIENT_COLUMNS = Object.freeze({
  document_requests: "id,case_id,title,message,status,created_at,updated_at",
  documents: "id,case_id,request_id,filename,source,created_at",
  client_events: "id,case_id,action,message,created_at",
  case_contacts: "case_id,phone,spouse_phone,best_contact_time,best_contact_note",
  case_document_cards: "slot_id,status,group_override,changed_at",
});

// The staff read's named columns, where it does not take the whole row.
export const STAFF_COLUMNS = Object.freeze({
  case_materials: "case_id,item,received_at,recorded_by_person_id",
});

// The Case an applicant sees: their own case plus the four client-readable
// related tables, and nothing else.
export const mapClientCase = ({
  row,
  requests,
  documents,
  history,
  contacts = [],
  cards = [],
}) => ({
  ...mapCase(row),
  contact: mapContact(contacts[0]),
  documentCards: cards.map(mapDocumentCard),
  requests: requests.map(camelRow),
  documents: documents.map(camelRow),
  history: history.map(camelRow),
});

// The staff Case: the client sections plus participation, follow-ups with
// the contact log, review attempts, the materials received and the internal
// history.
export const mapStaffCase = ({
  row,
  participants,
  requests,
  documents,
  followups,
  contactLog = [],
  contactVersions = [],
  reviews,
  history,
  internalHistory,
  contacts = [],
  cards = [],
  materials = [],
  preparerQuestionnaires = [],
  reviewerQuestionnaires = [],
  preparerShadedFields = [],
  filingAttempts = [],
  filingReturns = [],
  filingNotes = [],
}) => ({
  ...mapClientCase({ row, requests, documents, history, contacts, cards }),
  participants: participants.map((participant) => participant.person_id),
  reviews: reviews.map(mapReview),
  followups: followups.map(mapFollowup),
  contacts: contactLog.map((entry) => mapContactEntry(entry, contactVersions)),
  materials: materials.map(mapMaterial),
  internalHistory: internalHistory.map(camelRow),
  preparerQuestionnaires: preparerQuestionnaires.map(camelRow),
  reviewerQuestionnaires: reviewerQuestionnaires.map(camelRow),
  // One row at most (case_id is unique): `[row]`, or `[]` before the first save.
  preparerShadedFields: preparerShadedFields.map(camelRow),
  filingAttempts: mapFilingAttempts(filingAttempts, filingReturns, filingNotes),
});

export function createStore(client) {
  // supabase-js reports API failures as `{error}` and transport failures by
  // throwing. Both go through the one shared mapper, so a caller only ever
  // handles a domain code.
  const settled = async (call) => {
    let result;
    try {
      result = await call;
    } catch (cause) {
      throw createAppError(cause);
    }
    if (result?.error) throw createAppError(result.error);
    return result?.data;
  };

  const read = async (query) => (await settled(query)) ?? [];

  const call = (name, args) => settled(client.rpc(name, args));

  // Rows of one case-scoped table, in the order the history and lists are
  // shown: oldest first, with a stable tiebreak.
  const relatedRows = (table, caseId, tiebreak = "id", columns = "*") =>
    read(
      client
        .from(table)
        .select(columns)
        .eq("case_id", caseId)
        .order("created_at")
        .order(tiebreak),
    );

  // The caller's own membership row. RLS returns exactly the caller's active
  // row, so reading it is both the access check and the workspace lookup.
  const membership = async () => {
    const rows = await read(client.from("memberships").select("*"));
    if (!rows.length) throw createAppError({ code: "VT001" });
    return rows[0];
  };

  const access = async () => (await membership()).access;

  // Presenter or staff: the work board's reads.
  const requireStaffAccess = async () => {
    if (!isStaffAccess(await access())) throw createAppError({ code: "VT001" });
  };

  // The person an RPC names. A staff member names nobody: the database
  // resolves them from the signed-in account and refuses any other id (D3).
  // Everyone else passes the person the request carries. The one place this
  // is decided, so no call can forget it.
  const actingPerson = async (request) =>
    (await access()) === "staff" ? null : (request.personId ?? null);

  // The action id is the server's replay key. The caller normally supplies it;
  // when it does not, one is minted and kept **on the caller's action object**,
  // so retrying a timed-out request re-sends the identical envelope and the
  // server answers with the stored receipt instead of acting twice.
  const actionId = (request) => {
    if (!request.actionId) request.actionId = crypto.randomUUID();
    return request.actionId;
  };

  return {
    async getPrincipal() {
      let identity;
      try {
        identity = await client.auth.getUser();
      } catch (cause) {
        throw createAppError(cause);
      }
      // An Auth call reports an unreachable server by *returning* the failure,
      // not by throwing it, and that error carries no database code — so the
      // shared mapper turns it into OFFLINE, which is what a transport failure
      // is. This branch is what keeps a signed-out visitor out of that path:
      // their session error is equally code-less and must stay FORBIDDEN.
      if (isAuthTransportError(identity?.error))
        throw createAppError(identity.error);
      const user = identity?.data?.user ?? null;
      // No session and no active membership are the same answer: this account
      // has no access, and nothing about the workspace is revealed.
      if (!user) throw createAppError({ code: "VT001" });
      const row = await membership();
      // A staff member is one person of the roster, linked through their
      // account; the screens act as, and show, that person.
      let person = null;
      if (row.access === "staff")
        person =
          (await read(client.from("people").select("*").eq("user_id", user.id)))[0] ??
          null;
      return {
        userId: user.id,
        workspaceId: row.workspace_id,
        access: row.access,
        email: user.email ?? null,
        personId: person?.id ?? null,
        personName: person?.name ?? null,
      };
    },

    // The caller's own workspace row. RLS returns exactly the one workspace
    // they are a member of.
    async getWorkspace() {
      const rows = await read(client.from("workspaces").select("*"));
      const row = rows[0];
      if (!row) throw createAppError({ code: "VT002" });
      return {
        id: row.id,
        defaultFollowupPersonId: row.default_followup_person_id,
        currentSeason: row.current_season == null ? null : Number(row.current_season),
        // The version a new application starts at (spec 2026-09-30 §4.2):
        // always 2 (migration 023).
        defaultIntakeVersion: Number(row.default_intake_version),
      };
    },

    async listPeople() {
      await requireStaffAccess();
      return (
        await read(client.from("people").select("*").order("person_key"))
      ).map(mapPerson);
    },

    // A client's list is their own cases and nothing more. A presenter's or staff
    // member's list is a work board, and a board that cannot say who is already on a case,
    // what is waiting on a client, or who owes somebody a call is only a list
    // of references. Those three answers, the client's phone for the masked
    // column and the reviewer's call status come from five grouped reads over
    // the same RLS-scoped tables the case screen uses — not from the rows
    // themselves, which carry no related record at all (Ruling R56).
    async listCases() {
      const staff = isStaffAccess(await access());
      const cases = (
        await read(client.from("cases").select("*").order("reference"))
      ).map(mapCase);
      if (!staff || !cases.length) return cases;
      const ids = cases.map((record) => record.id);
      const participants = await read(
        client
          .from("preparation_participants")
          .select("case_id,person_id")
          .in("case_id", ids)
          .order("person_id"),
      );
      const followups = await read(
        client
          .from("admin_followups")
          .select("case_id,assignee_person_id,purpose,reason")
          .in("case_id", ids)
          .eq("status", "open"),
      );
      const requests = await read(
        client
          .from("document_requests")
          .select("case_id")
          .in("case_id", ids)
          .eq("status", "open"),
      );
      // The client's phone, for the list's masked column (D5). The phone
      // alone: the case page reads the rest of the contact row.
      const contacts = await read(
        client
          .from("case_contacts")
          .select("case_id,phone")
          .in("case_id", ids),
      );
      // The reviewer's call with the client, for Follow-ups' Mark ready to
      // e-file (brainstorm Q12): the latest approved review's status alone.
      const approvals = await read(
        client
          .from("reviews")
          .select("case_id,client_contact_status,created_at")
          .in("case_id", ids)
          .eq("status", "approved")
          .order("created_at"),
      );
      // The newest fix note of each case, for Follow-ups' Rejected row (staff
      // only; the filing attempts themselves stay on the case page's read).
      const fixNotes = await read(
        client
          .from("filing_notes")
          .select("case_id,note")
          .in("case_id", ids)
          .order("recorded_at")
          .order("id"),
      );
      const forCase = (rows, id) => rows.filter((row) => row.case_id === id);
      return cases.map((record) => {
        const open = forCase(followups, record.id);
        return {
          ...record,
          participants: forCase(participants, record.id).map((row) => row.person_id),
          openFollowups: open.length,
          // D13: Mark ready to e-file waits while the office's go-over is open.
          goOverOpen: open.some((row) => row.purpose === "go_over_return"),
          // Follow-ups' Withdrawn row: the office's own job, not a call.
          openWithdrawalNotices: open.filter((row) => row.purpose === "withdrawal_notice").length,
          // The first notice's own text, which says whom the office tells what.
          withdrawalNoticeReason: open.find((row) => row.purpose === "withdrawal_notice")?.reason ?? null,
          // Who owes this client a call, without the tasks themselves: the
          // board names people, and the case screen holds the work.
          followupAssigneeIds: [
            ...new Set(open.map((row) => row.assignee_person_id)),
          ],
          openRequests: forCase(requests, record.id).length,
          phone: forCase(contacts, record.id)[0]?.phone ?? null,
          // "pending", "completed", or null when no review has been approved.
          reviewContactStatus:
            forCase(approvals, record.id).at(-1)?.client_contact_status ?? null,
          latestFixNote: forCase(fixNotes, record.id).at(-1)?.note ?? null,
        };
      });
    },

    async getCase(id) {
      const staff = isStaffAccess(await access());
      const rows = await read(client.from("cases").select("*").eq("id", id));
      const row = rows[0];
      // Absent, another workspace's and another applicant's case are one
      // answer, with no reference, name or revision behind it.
      if (!row) throw createAppError({ code: "VT002" });
      // Row-level security decides which *rows* a client may read; it says
      // nothing about which columns of them are their business. `select("*")`
      // hands the browser whatever the table happens to hold — a staff-recorded
      // document carries the presenter's Auth user id and the office person who
      // recorded it — so the applicant's reads name their columns instead. The
      // staff path keeps `*`: its screens read the rest of them.
      const columns = (table) => (staff ? "*" : CLIENT_COLUMNS[table]);
      const client_ = {
        row,
        requests: await relatedRows(
          "document_requests",
          id,
          "id",
          columns("document_requests"),
        ),
        documents: await relatedRows("documents", id, "id", columns("documents")),
        history: await relatedRows(
          "client_events",
          id,
          "id",
          columns("client_events"),
        ),
        // One row at most (case_id is its key), and no created_at to order by.
        // Both principals name its columns.
        contacts: await read(
          client
            .from("case_contacts")
            .select(CLIENT_COLUMNS.case_contacts)
            .eq("case_id", id),
        ),
        // Both principals, by named columns (the row carries no person).
        cards: await read(
          client
            .from("case_document_cards")
            .select(CLIENT_COLUMNS.case_document_cards)
            .eq("case_id", id)
            .order("slot_id"),
        ),
      };
      if (!staff) return mapClientCase(client_);
      return mapStaffCase({
        ...client_,
        participants: await relatedRows(
          "preparation_participants",
          id,
          "person_id",
        ),
        followups: await relatedRows("admin_followups", id),
        // Staff only: the applicant path above never names these tables.
        contactLog: await read(
          client
            .from("contact_log")
            .select("*")
            .eq("case_id", id)
            .order("contacted_at")
            .order("logged_at")
            .order("id"),
        ),
        contactVersions: await read(
          client
            .from("contact_log_versions")
            .select("*")
            .eq("case_id", id)
            .order("contact_id")
            .order("version"),
        ),
        reviews: await relatedRows("reviews", id),
        // Staff only: the applicant path above never names this table.
        materials: await read(
          client
            .from("case_materials")
            .select(STAFF_COLUMNS.case_materials)
            .eq("case_id", id)
            .order("item"),
        ),
        internalHistory: await relatedRows("case_events", id),
        // Staff only: the applicant path above never names these tables.
        preparerQuestionnaires: await relatedRows("preparer_questionnaires", id),
        reviewerQuestionnaires: await relatedRows("reviewer_questionnaires", id),
        // Staff only (migration 038), and never named on the applicant path.
        preparerShadedFields: await relatedRows("preparer_shaded_fields", id),
        // Staff only (migration 035). These tables have no created_at, so they
        // are ordered by their own keys rather than through relatedRows.
        filingAttempts: await read(
          client
            .from("filing_attempts")
            .select("*")
            .eq("case_id", id)
            .order("attempt", { ascending: false }),
        ),
        filingReturns: await read(
          client
            .from("filing_returns")
            .select("*")
            .eq("case_id", id)
            .order("attempt")
            .order("return_kind"),
        ),
        filingNotes: await read(
          client
            .from("filing_notes")
            .select("*")
            .eq("case_id", id)
            .order("recorded_at")
            .order("id"),
        ),
      });
    },

    async createCase(request) {
      return await call("vitally_create_case", {
        p_action_id: actionId(request),
        p_mode: request.mode,
        p_person_id: await actingPerson(request),
        p_answers: request.answers,
      });
    },

    async act(action) {
      return await call("vitally_apply_action", {
        p_action_id: actionId(action),
        p_case_id: action.caseId,
        p_expected_revision: action.expectedRevision,
        p_person_id: await actingPerson(action),
        p_type: action.type,
        p_payload: action.payload,
      });
    },

    async logContact(request) {
      return await call("vitally_log_contact", {
        p_action_id: actionId(request),
        p_case_id: request.caseId,
        p_person_id: await actingPerson(request),
        p_followup_id: request.followupId ?? null,
        p_entry: request.entry,
      });
    },

    // Season end: close every listed unsigned case as Dismissed, or none.
    async closeUnsigned(request) {
      return await call("vitally_close_unsigned", {
        p_action_id: actionId(request),
        p_person_id: await actingPerson(request),
        p_cases: request.cases,
        p_confirmed: request.confirmed === true,
      });
    },

    async editContact(request) {
      return await call("vitally_edit_contact", {
        p_action_id: actionId(request),
        p_contact_id: request.contactId,
        p_expected_revision: request.expectedRevision,
        p_person_id: await actingPerson(request),
        p_entry: request.entry,
      });
    },

    async listAssistance() {
      await requireStaffAccess();
      return (
        await read(
          client
            .from("assistance_items")
            .select("*")
            .order("created_at")
            .order("id"),
        )
      ).map(mapAssistance);
    },

    async actAssistance(request) {
      await call("vitally_assistance_action", {
        p_action_id: actionId(request),
        p_item_id: request.itemId,
        p_expected_revision: request.expectedRevision,
        p_person_id: await actingPerson(request),
        p_type: request.type,
        p_note: request.note ?? null,
      });
    },

    // One channel per subscription, over the tables this principal may read.
    // A change carries identifiers only — never a row's contents — because the
    // browser reacts by refetching through the same RLS-scoped reads.
    subscribe({ onChange, onConnection } = {}) {
      let channel = null;
      let stopped = false;
      const connection = (status) => {
        const state = CONNECTION_STATES[status];
        if (state) onConnection?.(state);
      };
      const announce = (table, payload) => {
        const row = payload?.new ?? payload?.old ?? {};
        const id = row.id ?? null;
        onChange?.({
          table,
          eventType: payload?.eventType ?? null,
          id,
          caseId: table === "cases" ? id : (row.case_id ?? null),
        });
      };
      const open = async () => {
        const tables = SUBSCRIBED_TABLES[await access()] ?? CLIENT_TABLES;
        if (stopped) return;
        const live = client.channel(`vitally:${crypto.randomUUID()}`);
        for (const table of tables)
          for (const event of WATCHED_EVENTS)
            live.on("postgres_changes", { event, schema: "public", table }, (payload) =>
              announce(table, payload),
            );
        channel = live;
        live.subscribe(connection);
      };
      // The channel cannot open before the membership read answers; a failure
      // there is reported as a lost connection rather than thrown at a caller
      // that has already been handed its unsubscribe function.
      open().catch(() => connection("CLOSED"));
      return () => {
        if (stopped) return;
        stopped = true;
        const live = channel;
        channel = null;
        if (live) client.removeChannel(live);
      };
    },
  };
}
