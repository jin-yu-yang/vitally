// Every public application entry point installed so far, with a valid argument
// shape, the exact receipt it answers with, and the member allowed to call it.
// The database suite asserts this list matches exactly what the database
// exposes, calls each one anonymously, and then calls the same shape as a
// member so blanket denial cannot pass. Later migrations add their entry point
// here as they install it.
export const RPC_SIGNATURES = Object.freeze([
  Object.freeze({
    name: "vitally_create_case",
    signature: "vitally_create_case(uuid,text,jsonb)",
    authorized: (f) => f.applicantA,
    receiptKeys: Object.freeze(["actionId", "caseId", "reference", "revision"]),
    args: () => ({
      p_action_id: crypto.randomUUID(),
      p_mode: "client",
      p_answers: {},
    }),
  }),
  Object.freeze({
    name: "vitally_apply_action",
    signature: "vitally_apply_action(uuid,uuid,bigint,text,jsonb)",
    authorized: (f) => f.applicantA,
    receiptKeys: Object.freeze(["actionId", "caseId", "reference", "revision"]),
    // The draft in `context` is the caller's own, so this shape is a legitimate
    // request: only the missing session makes the anonymous call fail.
    args: (context) => ({
      p_action_id: crypto.randomUUID(),
      p_case_id: context.draftCaseId,
      p_expected_revision: context.draftRevision,
      p_type: "SAVE_ANSWERS",
      p_payload: { answers: { addr_city: "Pittsburgh" } },
    }),
  }),
  Object.freeze({
    name: "vitally_assistance_action",
    signature: "vitally_assistance_action(uuid,uuid,bigint,text,text)",
    // Assistance is staff work, so its positive control is the Site
    // Coordinator, who holds `assist`, claiming the open item.
    authorized: (f) => f.siteCoordinator,
    receiptKeys: Object.freeze(["actionId", "itemId", "revision"]),
    args: (context) => ({
      p_action_id: crypto.randomUUID(),
      p_item_id: context.assistanceItemId,
      p_expected_revision: context.assistanceRevision,
      p_type: "CLAIM",
      p_note: "",
    }),
  }),
  // The contact log (OpenSpec change add-contact-log): staff work on any case
  // a staff member can open.
  Object.freeze({
    name: "vitally_log_contact",
    signature: "vitally_log_contact(uuid,uuid,uuid,jsonb)",
    authorized: (f) => f.siteCoordinator,
    receiptKeys: Object.freeze(["actionId", "contactId", "caseId", "revision"]),
    args: (context) => ({
      p_action_id: crypto.randomUUID(),
      p_case_id: context.contactCaseId,
      p_followup_id: null,
      p_entry: context.contactEntry,
    }),
  }),
  // The season-end close (OpenSpec change adjust-filing-to-pcdc): an admin
  // closes the listed signing cases. An approved case is the target.
  Object.freeze({
    name: "vitally_close_unsigned",
    signature: "vitally_close_unsigned(uuid,jsonb,boolean)",
    authorized: (f) => f.siteCoordinator,
    receiptKeys: Object.freeze(["actionId", "cases"]),
    args: (context) => ({
      p_action_id: crypto.randomUUID(),
      p_cases: [{ caseId: context.exitCaseId, revision: context.exitCaseRevision }],
      p_confirmed: true,
    }),
  }),
  Object.freeze({
    name: "vitally_edit_contact",
    signature: "vitally_edit_contact(uuid,uuid,bigint,jsonb)",
    authorized: (f) => f.siteCoordinator,
    receiptKeys: Object.freeze(["actionId", "contactId", "caseId", "revision"]),
    // The entry in `context` was logged by the same staff member at revision 1.
    args: (context) => ({
      p_action_id: crypto.randomUUID(),
      p_contact_id: context.contactId,
      p_expected_revision: 1,
      p_entry: { ...context.contactEntry, note: "Corrected." },
    }),
  }),
  // The volunteer Roster (OpenSpec change add-volunteer-roster-records): an
  // admin adds a volunteer with no sign-in.
  Object.freeze({
    name: "vitally_save_volunteer",
    signature: "vitally_save_volunteer(uuid,uuid,bigint,jsonb)",
    authorized: (f) => f.siteCoordinator,
    receiptKeys: Object.freeze(["actionId", "personId", "revision"]),
    args: () => ({
      p_action_id: crypto.randomUUID(),
      p_volunteer_id: null,
      p_expected_revision: null,
      p_volunteer: {
        name: "Sample Volunteer", email: `v-${crypto.randomUUID()}@example.org`, phone: null,
        works: "on_site", languages: ["english"], otherLanguage: null, roles: ["greeter"], certificates: ["vsc"],
        isNew: false, photoIdChecked: false,
      },
    }),
  }),
  // A staff member's own clearance (OpenSpec change add-volunteer-clearance).
  Object.freeze({
    name: "vitally_my_clearance",
    signature: "vitally_my_clearance()",
    authorized: (f) => f.siteCoordinator,
    receiptKeys: Object.freeze(["capabilities", "cleared", "isAdmin", "missing", "siteCoordinatorName"]),
    args: () => ({}),
  }),
  // Sign-in accounts (OpenSpec change add-account-invitations). An entry's
  // optional `context(f)` adds the targets its arguments name; the suite calls
  // it before the anonymous call.
  // The read-only check: inviting an address nobody holds.
  Object.freeze({
    name: "vitally_prepare_account",
    signature: "vitally_prepare_account(text,jsonb)",
    authorized: (f) => f.siteCoordinator,
    receiptKeys: Object.freeze(["accountRevision", "email", "op", "reusableUserId", "volunteerId"]),
    args: () => ({
      p_op: "invite",
      p_target: { email: `invite-${crypto.randomUUID()}@example.org` },
    }),
  }),
  // Inviting a client: a confirmed auth user with no account, as the Edge
  // Function would have created it.
  Object.freeze({
    name: "vitally_record_account",
    signature: "vitally_record_account(uuid,text,jsonb,uuid)",
    authorized: (f) => f.siteCoordinator,
    receiptKeys: Object.freeze(["accountRevision", "actionId", "email", "status"]),
    context: async (f) => {
      const { userId, email } = await f.provision();
      return { inviteUserId: userId, inviteEmail: email };
    },
    args: (context) => ({
      p_action_id: crypto.randomUUID(),
      p_op: "invite",
      p_target: { email: context.inviteEmail },
      p_user_id: context.inviteUserId,
    }),
  }),
  // Deactivating a staff member with no open work, at their account revision.
  Object.freeze({
    name: "vitally_deactivate_account",
    signature: "vitally_deactivate_account(uuid,uuid,bigint)",
    authorized: (f) => f.siteCoordinator,
    receiptKeys: Object.freeze(["accountRevision", "actionId", "status"]),
    context: async (f) => {
      const key = `sig_off_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
      const { personId } = await f.staff({ key, name: "Morgan Hale", capabilities: ["prepare"], cleared: false });
      return { accountVolunteerId: personId, accountRevision: 1 };
    },
    args: (context) => ({
      p_action_id: crypto.randomUUID(),
      p_volunteer_id: context.accountVolunteerId,
      p_expected_revision: context.accountRevision,
    }),
  }),
  // Reactivating a staff member whose account is deactivated.
  Object.freeze({
    name: "vitally_reactivate_account",
    signature: "vitally_reactivate_account(uuid,uuid,bigint)",
    authorized: (f) => f.siteCoordinator,
    receiptKeys: Object.freeze(["accountRevision", "actionId", "status"]),
    context: async (f) => {
      const key = `sig_on_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
      const { personId } = await f.staff({ key, name: "Quinn Darby", capabilities: ["prepare"], cleared: false });
      const { data, error } = await f.siteCoordinator.rpc("vitally_deactivate_account", {
        p_action_id: crypto.randomUUID(),
        p_volunteer_id: personId,
        p_expected_revision: 1,
      });
      if (error) throw new Error(`deactivate for the reactivate shape: ${error.code}`);
      return { accountVolunteerId: personId, accountRevision: data.accountRevision };
    },
    args: (context) => ({
      p_action_id: crypto.randomUUID(),
      p_volunteer_id: context.accountVolunteerId,
      p_expected_revision: context.accountRevision,
    }),
  }),
  // The office panel's client list: an array, each element of this shape.
  Object.freeze({
    name: "vitally_client_invitations",
    signature: "vitally_client_invitations()",
    authorized: (f) => f.siteCoordinator,
    receiptKeys: Object.freeze(["accountRevision", "activatedAt", "email", "invitedAt", "status"]),
    args: () => ({}),
  }),
]);

// The private roster functions (OpenSpec change add-staff-identity, design D6).
// They are not entry points: only the roster command calls them, over the
// database connection, so no public signature changes. The database suite calls
// each one through PostgREST, under its name in the public schema and in the
// private schema, as the anonymous client and as a staff member, and expects a
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
