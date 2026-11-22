// What a signed-in staff member is cleared for, from `principal.clearance`
// (the `vitally_my_clearance` answer). An applicant has no clearance.

// The roster lists a person's roles; the buttons follow what they may do now.
// The signed-in person's own entry carries their effective capabilities.
export const withOwnCapabilities = (people, principal) => {
  const clearance = principal?.clearance;
  const own = principal?.personId ?? null;
  if (!clearance || own == null) return people;
  return people.map((person) =>
    person?.id === own ? { ...person, capabilities: [...clearance.capabilities] } : person,
  );
};

// The workspace admin flag (a site coordinator, or the Admin role this season),
// not the effective capabilities.
export const ceilingAdmin = (principal) => principal?.clearance?.isAdmin === true;

// Whether the signed-in person is a site coordinator (change add-season-settings):
// only they change Season settings, who is a site coordinator, and the Admin role.
export const siteCoordinator = (principal) => principal?.clearance?.isSiteCoordinator === true;

// Whether the signed-in person is a schedule viewer (change
// add-volunteer-schedule, design D11): a workspace admin, or anyone on this
// season's roster with an active account, cleared or not.
export const scheduleViewer = (principal) => principal?.clearance?.scheduleViewer === true;

const capitalise = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// One line per thing still missing: the 13615, the photo ID, each role, then
// a site coordinator's SC certificate.
export const missingLines = (clearance) =>
  (clearance?.missing ?? []).map((item) => {
    if (item.kind === "form13615") return "Upload your signed Form 13615.";
    if (item.kind === "photoId") return "Have your photo ID checked.";
    if (item.kind === "siteCoordinator") return "Site coordinators need the SC certificate.";
    return `${capitalise(item.role)} needs ${item.certificates.join(" and ")}.`;
  });

// Whether a window waits on the setup screen: a staff window whose clearance
// does not say cleared. A missing or unread clearance is never a clearance.
export const awaitingClearance = (state) =>
  state?.principal?.access === "staff" && state.principal.clearance?.cleared !== true;

// The two items that are sent for review (change add-clearance-uploads):
// the document, its line, and when it was sent (null: not yet).
export const uploadItems = (clearance) =>
  (clearance?.missing ?? [])
    .filter((item) => item.kind === "form13615" || item.kind === "photoId")
    .map((item) => ({
      document: item.kind,
      line: missingLines({ missing: [item] })[0],
      sentAt: item.sentAt ?? null,
      reviewedAt: item.reviewedAt ?? null,
      reviewReason: item.reviewReason ?? null,
    }));

// What the office said about a document that came back (change add-my-profile,
// D8), as plain text; views escape it. Null while it waits for review or has
// no reason. Only a Form 13615's exact quick pick is "already on file".
export const reviewLine = ({ document, sentAt, reviewReason }) => {
  if (sentAt || !reviewReason) return null;
  if (document === "form13615" && reviewReason === "Already on file")
    return "Your site coordinator says this is already on file. You don't need to send it again.";
  // One trailing . ! or ? goes, so a note that ends a sentence does not double it.
  const reason = String(reviewReason).trim().replace(/[.!?]$/, "");
  return `Your site coordinator looked at this: ${reason}. Please send it again or ask them.`;
};
