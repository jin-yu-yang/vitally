// What the Exit Form may print for an approved review (#173, design D1-D5).
//
// The reviewer's questionnaire records the return as it stood at approval.
// If the case was sent back with Return to signing after that, the filing
// methods and results can have changed, so only a method that still holds
// (set, and not rejected) is ticked, and everything else is left for the
// office to fill in by hand. No imports: this is a pure rule on the record.

export const RETURN_TO_SIGNING_NOTE_START =
  "The return was corrected after this review (Return to signing). This form prints only what ViTally holds. Fill in by hand: ";

const KINDS = [
  ["federal", "the federal filing method"],
  ["state", "the Pennsylvania filing method"],
];

// A missing or unparsable decidedAt counts every Return to signing as later.
const isLater = (createdAt, decidedAt) => {
  const decided = Date.parse(decidedAt);
  const created = Date.parse(createdAt);
  if (Number.isNaN(decided)) return true;
  return Number.isNaN(created) ? true : created > decided;
};

export function exitFormSource(record, review) {
  if (!review || review.status !== "approved") return null;
  const questionnaire = (record?.reviewerQuestionnaires ?? []).find((q) => q?.reviewId === review.id);
  if (!questionnaire) return null;
  // Without staff history we cannot tell whether the return was corrected.
  if (!Array.isArray(record?.internalHistory)) return null;
  const corrected = record.internalHistory.some(
    (h) => h?.action === "RETURN_TO_SIGNING" && isLater(h.createdAt, review.decidedAt),
  );
  if (!corrected) return { questionnaire, corrected: false, fillByHand: [] };

  const fillByHand = [];
  const groups = {};
  for (const [kind, item] of KINDS) {
    const method = record[`${kind}Method`];
    const settled = method && record[`${kind}Result`] !== "rejected";
    groups[kind] = settled ? { method } : null;
    if (!settled) fillByHand.push(item);
  }
  fillByHand.push("the federal and Pennsylvania refund or amount owed and how it is paid", "Other Tax", "Remarks");
  return {
    questionnaire: { exitForm: { federal: groups.federal, state: groups.state, local: [] }, remarks: "" },
    corrected: true,
    fillByHand,
  };
}

export function exitFormNote(source) {
  return source?.corrected ? `${RETURN_TO_SIGNING_NOTE_START}${source.fillByHand.join("; ")}.` : "";
}
