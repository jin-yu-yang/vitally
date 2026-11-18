// Case labels: the browser's eligibility rules. They only decide what is
// shown; the database decides what is allowed.

export const LABEL_COLORS = Object.freeze(["sky", "amber", "pink", "green", "violet", "slate"]);

const capabilitiesOf = (person) => (Array.isArray(person?.capabilities) ? person.capabilities : []);

export const canManageLabels = (person) => capabilitiesOf(person).includes("admin");

export function canLabelCase(record, person) {
  if (!record || !person || record.stage === "closed") return false;
  const capabilities = capabilitiesOf(person);
  return (
    capabilities.includes("admin") ||
    capabilities.includes("followup") ||
    (person.id != null && (person.id === record.preparerId || person.id === record.reviewerId))
  );
}

export const sortLabels = (labels) =>
  [...labels].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

export const labelNameTaken = (labels, name, exceptId = null) => {
  const wanted = String(name).trim().toLowerCase();
  return labels.some((label) => label.id !== exceptId && label.name.trim().toLowerCase() === wanted);
};
