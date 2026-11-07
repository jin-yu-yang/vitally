// Every public application entry point installed so far, with a valid argument
// shape, the exact receipt it answers with, and the member allowed to call it.
// The database suite asserts this list matches exactly what the database
// exposes, calls each one anonymously, and then calls the same shape as a
// member so blanket denial cannot pass. Later migrations add their entry point
// here as they install it.
export const RPC_SIGNATURES = Object.freeze([
  Object.freeze({
    name: "vitally_create_case",
    signature: "vitally_create_case(uuid,text,uuid,jsonb)",
    authorized: (f) => f.applicantA,
    receiptKeys: Object.freeze(["actionId", "caseId", "reference", "revision"]),
    args: () => ({
      p_action_id: crypto.randomUUID(),
      p_mode: "client",
      p_person_id: null,
      p_answers: {},
    }),
  }),
  Object.freeze({
    name: "vitally_apply_action",
    signature: "vitally_apply_action(uuid,uuid,bigint,uuid,text,jsonb)",
    authorized: (f) => f.applicantA,
    receiptKeys: Object.freeze(["actionId", "caseId", "reference", "revision"]),
    // The draft in `context` is the caller's own, so this shape is a legitimate
    // request: only the missing session makes the anonymous call fail.
    args: (context) => ({
      p_action_id: crypto.randomUUID(),
      p_case_id: context.draftCaseId,
      p_expected_revision: context.draftRevision,
      p_person_id: null,
      p_type: "SAVE_ANSWERS",
      p_payload: { answers: { addr_city: "Pittsburgh" } },
    }),
  }),
  Object.freeze({
    name: "vitally_assistance_action",
    signature: "vitally_assistance_action(uuid,uuid,bigint,uuid,text,text)",
    // Assistance is presenter work, so its positive control is the presenter
    // with the workspace's `assist` person claiming the open item.
    authorized: (f) => f.presenter,
    receiptKeys: Object.freeze(["actionId", "itemId", "revision"]),
    args: (context) => ({
      p_action_id: crypto.randomUUID(),
      p_item_id: context.assistanceItemId,
      p_expected_revision: context.assistanceRevision,
      p_person_id: context.assistPersonId,
      p_type: "CLAIM",
      p_note: "",
    }),
  }),
  // The contact log (OpenSpec change add-contact-log): presenter work on any
  // case a presenter can open, under any persona.
  Object.freeze({
    name: "vitally_log_contact",
    signature: "vitally_log_contact(uuid,uuid,uuid,uuid,jsonb)",
    authorized: (f) => f.presenter,
    receiptKeys: Object.freeze(["actionId", "contactId", "caseId", "revision"]),
    args: (context) => ({
      p_action_id: crypto.randomUUID(),
      p_case_id: context.contactCaseId,
      p_person_id: context.assistPersonId,
      p_followup_id: null,
      p_entry: context.contactEntry,
    }),
  }),
  // The season-end close (OpenSpec change adjust-filing-to-pcdc): an admin
  // closes the listed signing cases. An approved case is the target.
  Object.freeze({
    name: "vitally_close_unsigned",
    signature: "vitally_close_unsigned(uuid,uuid,jsonb,boolean)",
    authorized: (f) => f.presenter,
    receiptKeys: Object.freeze(["actionId", "cases"]),
    args: (context) => ({
      p_action_id: crypto.randomUUID(),
      p_person_id: context.assistPersonId,
      p_cases: [{ caseId: context.exitCaseId, revision: context.exitCaseRevision }],
      p_confirmed: true,
    }),
  }),
  Object.freeze({
    name: "vitally_edit_contact",
    signature: "vitally_edit_contact(uuid,uuid,bigint,uuid,jsonb)",
    authorized: (f) => f.presenter,
    receiptKeys: Object.freeze(["actionId", "contactId", "caseId", "revision"]),
    // The entry in `context` was logged by the same persona at revision 1.
    args: (context) => ({
      p_action_id: crypto.randomUUID(),
      p_contact_id: context.contactId,
      p_expected_revision: 1,
      p_person_id: context.assistPersonId,
      p_entry: { ...context.contactEntry, note: "Corrected." },
    }),
  }),
]);

// The private roster functions (OpenSpec change add-staff-identity, design D6).
// They are not entry points: only the roster command calls them, over the
// database connection, so no public signature changes. The database suite calls
// each one through PostgREST, under its name in the public schema and in the
// private schema, as the anonymous client and as the presenter, and expects a
// refusal that leaves nothing behind: no permission (42501), or no such
// function or exposed schema (PGRST202, PGRST106).
export const PRIVATE_SETUP_DENIALS = Object.freeze(["42501", "PGRST202", "PGRST106"]);
export const PRIVATE_SETUP_FUNCTIONS = Object.freeze([
  Object.freeze({
    name: "add_staff_member",
    signature: "add_staff_member(uuid,uuid,text,text,text[])",
    // A legitimate request for an account with no membership yet.
    args: (context) => ({
      p_workspace_id: context.workspaceId,
      p_user_id: context.userId,
      p_person_key: "mallory",
      p_name: "Mallory Stone",
      p_capabilities: ["admin", "followup"],
    }),
  }),
  Object.freeze({
    name: "set_default_followup",
    signature: "set_default_followup(uuid,text)",
    args: (context) => ({
      p_workspace_id: context.workspaceId,
      p_person_key: context.personKey,
    }),
  }),
]);
