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

// The ceiling admin flag (not the effective capabilities).
export const ceilingAdmin = (principal) => principal?.clearance?.isAdmin === true;

const capitalise = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// One line per thing still missing: the 13615, the photo ID, then each role.
export const missingLines = (clearance) =>
  (clearance?.missing ?? []).map((item) => {
    if (item.kind === "form13615") return "Upload your signed Form 13615.";
    if (item.kind === "photoId") return "Have your photo ID checked.";
    return `${capitalise(item.role)} needs ${item.certificates.join(" and ")}.`;
  });

// Whether a window waits on the setup screen: a staff window whose clearance
// does not say cleared. A missing or unread clearance is never a clearance.
export const awaitingClearance = (state) =>
  state?.principal?.access === "staff" && state.principal.clearance?.cleared !== true;
