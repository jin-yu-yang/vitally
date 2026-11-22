// What the Exit Form may print for an approved review (#173, design D1-D5).
//
// The reviewer's questionnaire records the return as it stood at approval.
// If the case was sent back with Return to signing after that, the filing
// methods and results can have changed, so only a method that still holds
// (set, and not rejected) is ticked, and everything else is left for the
// office to fill in by hand. Since #203 a Return to signing can also store the
// corrected Exit Form values, which are printed and only the gaps are left
// for the office. No imports: this is a pure rule on the record.

export const RETURN_TO_SIGNING_NOTE_START =
  "The return was corrected after this review (Return to signing). This form prints only what ViTally holds. Fill in by hand: ";

const KINDS = [
  ["federal", "the federal filing method", "the federal refund or amount owed and how it is paid"],
  ["state", "the Pennsylvania filing method", "the Pennsylvania refund or amount owed and how it is paid"],
];

// A missing or unparsable decidedAt counts every Return to signing as later.
const isLater = (createdAt, decidedAt) => {
  const decided = Date.parse(decidedAt);
  const created = Date.parse(createdAt);
  if (Number.isNaN(decided)) return true;
  return Number.isNaN(created) ? true : created > decided;
};

/**
 * The last RETURN_TO_SIGNING event and the corrected Exit Form values stored
 * with it (#203). `values` is null when the event carries no row id or the
 * record holds no such row.
 */
export function latestReturnToSigning(record) {
  const history = Array.isArray(record?.internalHistory) ? record.internalHistory : [];
  const event = history.findLast((h) => h?.action === "RETURN_TO_SIGNING");
  if (!event) return null;
  const id = event.detail?.exitFormId;
  const values = id ? ((record.returnToSigningExitForms ?? []).find((row) => row?.id === id) ?? null) : null;
  return { event, values };
}

/** The filing method stored at the latest Return to signing, while that return is rejected. */
export function plannedMethod(record, kind) {
  if (record?.[`${kind}Result`] !== "rejected") return null;
  return latestReturnToSigning(record)?.values?.exitForm?.[kind]?.method ?? null;
}

// Stored values (#203): groups come from the row, the case's method wins once
// it is settled, and only what is still missing is listed for the office.
function fromStoredValues(record, values) {
  const stored = values.exitForm ?? {};
  const remarks = typeof values.remarks === "string" ? values.remarks : "";
  const groups = {};
  const methodGaps = [];
  const amountGaps = [];
  for (const [kind, methodItem, amountItem] of KINDS) {
    const method = record[`${kind}Method`];
    const settled = Boolean(method) && record[`${kind}Result`] !== "rejected";
    const group = stored[kind] ?? null;
    groups[kind] = group ? (settled ? { ...group, method } : group) : settled ? { method } : null;
    if (!method) continue;
    if (!settled && !group) methodGaps.push(methodItem);
    if (!group) amountGaps.push(amountItem);
  }
  const fillByHand = [...methodGaps, ...amountGaps];
  if (!remarks.trim()) fillByHand.push("Remarks");
  return {
    questionnaire: {
      exitForm: { federal: groups.federal, state: groups.state, local: Array.isArray(stored.local) ? stored.local : [] },
      remarks,
    },
    fillByHand,
  };
}

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

  const latest = latestReturnToSigning(record);
  if (latest?.values) {
    return { ...fromStoredValues(record, latest.values), corrected: true, fromStored: true, recordedAt: latest.event.createdAt ?? null };
  }

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
    recordedAt: null,
  };
}

const noteDate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { timeZone: "America/New_York", month: "long", day: "numeric", year: "numeric" });
};

export function exitFormNote(source) {
  if (!source?.corrected) return "";
  if (source.fromStored) {
    const when = source.recordedAt ? noteDate(source.recordedAt) : "";
    const base = `The return was corrected after this review (Return to signing). This form was filled from the corrected values recorded ${when ? `on ${when}` : "at Return to signing"}.`;
    return source.fillByHand.length ? `${base} Fill in by hand: ${source.fillByHand.join("; ")}.` : base;
  }
  return `${RETURN_TO_SIGNING_NOTE_START}${source.fillByHand.join("; ")}.`;
}
