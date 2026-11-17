// The shaded section of Form 13614-C ("To be completed by certified volunteer"):
// the 106 fields, their stable keys, their names in the three forms, and the
// rules each value follows (shaded-section spec).
//
// Pure: no DOM, no PDF library. The table is explicit; the database repeats the
// keys, and the draft fill, the editing copy, the upload and the editor all
// build on it. The browser applies the rules before sending and names the
// field it refuses; the database stays the authority.

import { visibleAnswers } from "./intake-catalogue.mjs";

export const COUNT_MAX = 99;
export const AMOUNT = /^(0|[1-9][0-9]{0,5})(\.[0-9]{1,2})?$/;
export const VIN = /^[A-Za-z0-9]{1,17}$/;
export const REASON_MAX = 120;
export const NOTE_MAX = 500;
export const YEAR_MIN = 2000;

const PREFIX = "form1[0].";
const ENERGY_KEY = "infoEnergyImprovement";
const ENERGY_EN = "page3.informationToReport.efficientHomeImprovement.efficientHomeImprovement";
const ENERGY_ZH = "page3.informationToReport.efficientHomeImprovement";

// "page1.namesOf.Row1.ownSupport" -> "form1[0].page1[0].namesOf[0].Row1[0].ownSupport[0]"
const full = (path) => PREFIX + path.split(".").map((part) => `${part}[0]`).join(".");

const HOUSEHOLD_COLUMNS = [
  ["QualifyingChild", "qualifyingChildDependent", "Qualifying child or dependent"],
  ["OwnSupport", "ownSupport", "Provided over 50% of own support"],
  ["LowIncome", "lessThanIncome", "Income under $5,200"],
  ["SupportProvided", "supportForPerson", "Taxpayer provided over 50% of support"],
  ["CostOfHome", "costMaintainingHome", "Taxpayer paid over half of home costs"],
];

// [block, key, path under page2/page3 (or the full page path), kind, label]
const INCOME = "page2.incomeIncluded.";
const DEDUCTION = "page3.stndardItemizedDeductions.";
const EXPENSE = "page3.expensesToReport.";
const INFO = "page3.informationToReport.";
const ROWS = [
  ["income", "incomeW2s", INCOME + "formW2s", "box", "W-2s"],
  ["income", "incomeW2sCount", INCOME + "formW2sNumber", "count", "W-2s #"],
  ["income", "incomeTips", INCOME + "tipsBasicReported", "box", "Tips"],
  ["income", "income1099R", INCOME + "form1099R", "box", "1099-R"],
  ["income", "income1099RCount", INCOME + "form1099RNumber", "count", "1099-R #"],
  ["income", "incomeQcd", INCOME + "qualifiedCharitableDistribution", "box", "Qualified charitable distribution"],
  ["income", "incomeQcdAmount", INCOME + "qualifiedCharitableAmount", "amount", "Qualified charitable distribution $"],
  ["income", "incomeDisability", INCOME + "disabilityBenefits", "box", "Disability benefits"],
  ["income", "incomeDisabilityCount", INCOME + "disabilityBenefitsNumber", "count", "Disability benefits #"],
  ["income", "incomeSsaRrb", INCOME + "ssaRRB1099", "box", "SSA-1099, RRB-1099"],
  ["income", "incomeSsaRrbCount", INCOME + "ssaRRB1099Number", "count", "SSA-1099, RRB-1099 #"],
  ["income", "income1099G", INCOME + "form1099G", "box", "1099-G"],
  ["income", "income1099GCount", INCOME + "form1099GNumber", "count", "1099-G #"],
  ["income", "incomeRefund", INCOME + "refund.refund", "box", "Refund"],
  ["income", "incomeRefundAmount", INCOME + "refund.refundAmount", "amount", "Refund $"],
  ["income", "itemizedLastYear", INCOME + "itemizedLastYear.itemizedLastYear", "box", "Itemized last year"],
  ["income", "itemizedLastYearYes", INCOME + "itemizedLastYear.itemizedYes", "box", "Itemized last year: Yes"],
  ["income", "itemizedLastYearNo", INCOME + "itemizedLastYear.itemizedNo", "box", "Itemized last year: No"],
  ["income", "income1099Int", INCOME + "form1099INTDIV.form1099INT", "box", "1099-INT"],
  ["income", "income1099IntCount", INCOME + "form1099INTDIV.form1099INTNumber", "count", "1099-INT #"],
  ["income", "income1099Div", INCOME + "form1099INTDIV.form1099DIV", "box", "1099-DIV"],
  ["income", "income1099DivCount", INCOME + "form1099INTDIV.form1099DIVNumber", "count", "1099-DIV #"],
  ["income", "income1099B", INCOME + "form1099B.form1099B", "box", "1099-B"],
  ["income", "income1099BCount", INCOME + "form1099B.form1099BNumber", "count", "1099-B #"],
  ["income", "capitalLossCarryover", INCOME + "form1099B.capitalLossCarryover.capitalLossCarryover", "box", "Capital loss carryover"],
  ["income", "capitalLossCarryoverYes", INCOME + "form1099B.capitalLossCarryover.capitalLossCarryoverYes", "box", "Capital loss carryover: Yes"],
  ["income", "capitalLossCarryoverNo", INCOME + "form1099B.capitalLossCarryover.capitalLossCarryoverNo", "box", "Capital loss carryover: No"],
  ["income", "incomeAlimony", INCOME + "alimonyIncome.alimonyIncome", "box", "Alimony"],
  ["income", "incomeAlimonyAmount", INCOME + "alimonyIncome.alimonyAmount", "amount", "Alimony $"],
  ["income", "alimonyExcludedYes", INCOME + "alimonyIncome.excludedYes", "box", "Alimony excluded from income: Yes"],
  ["income", "alimonyExcludedNo", INCOME + "alimonyIncome.excludedNo", "box", "Alimony excluded from income: No"],
  ["income", "incomeRental", INCOME + "rentalIncome.rentalIncome", "box", "Rental income"],
  ["income", "incomeRentalExpense", INCOME + "rentalIncome.rentalExpense", "box", "Rental expense"],
  ["income", "incomeRentalExpenseAmount", INCOME + "rentalIncome.rentalExpenseAmount", "amount", "Rental expense $"],
  ["income", "incomeW2G", INCOME + "formW2G.formW2G", "box", "W-2G or gambling winnings"],
  ["income", "incomeW2GCount", INCOME + "formW2G.formW2GNumber", "count", "W-2G or gambling winnings #"],
  ["income", "incomeScheduleC", INCOME + "scheduleC", "box", "Schedule C"],
  ["income", "income1099Misc", INCOME + "form1099MISC", "box", "1099-MISC"],
  ["income", "income1099MiscCount", INCOME + "form1099MISCNumber", "count", "1099-MISC #"],
  ["income", "income1099Nec", INCOME + "form1099NEC", "box", "1099-NEC"],
  ["income", "income1099NecCount", INCOME + "form1099NECNumber", "count", "1099-NEC #"],
  ["income", "income1099K", INCOME + "form1099K", "box", "1099-K"],
  ["income", "income1099KCount", INCOME + "form1099KNumber", "count", "1099-K #"],
  ["income", "incomeReportedElsewhere", INCOME + "otherInomceReported", "box", "Other income reported elsewhere"],
  ["income", "incomeScheduleCExpenses", INCOME + "scheduleCExpenses", "box", "Schedule C expenses"],
  ["income", "incomeScheduleCExpensesAmount", INCOME + "scheduleCExpensesAmount", "amount", "Schedule C expenses $"],
  ["income", "incomeOther", INCOME + "otherIncome.otherIncome", "box", "Other income"],
  ["income", "incomeNotes", "page2.IncomeIncludedComment.IncomeIncludedComments", "note", "Income notes"],
  ["deduction", "deduction1098", DEDUCTION + "form1098", "box", "1098"],
  ["deduction", "deduction1098Count", DEDUCTION + "form1098Number", "count", "1098 #"],
  ["deduction", "deductionStandard", DEDUCTION + "standardDeduction", "box", "Standard deduction"],
  ["deduction", "deductionItemized", DEDUCTION + "itemizedDeduction", "box", "Itemized deduction"],
  ["deduction", "deductionNotes", "page3.stndardItemizedComments.stndardItemizedComments", "note", "Standard or itemized deductions notes"],
  ["expense", "expense1098E", EXPENSE + "form1098E", "box", "1098-E"],
  ["expense", "expenseChildCare", EXPENSE + "childDependentCare", "box", "Child and dependent care credit"],
  ["expense", "expenseIra", EXPENSE + "iraBasicRoth", "box", "IRA"],
  ["expense", "expenseEducator", EXPENSE + "educatorExpensesDeduction", "box", "Educator expenses deduction"],
  ["expense", "expenseEducatorAmount", EXPENSE + "educatorExpensesDeductionAmount", "amount", "Educator expenses deduction $"],
  ["expense", "expenseAlimony", EXPENSE + "alimonyPayments.alimonyPayments", "box", "Alimony payments"],
  ["expense", "expenseAlimonyAmount", EXPENSE + "alimonyPayments.alimonyPaymentsAmount", "amount", "Alimony payments $"],
  ["expense", "alimonyAdjustmentYes", EXPENSE + "alimonyPayments.adjustementYes", "box", "Alimony adjustment to income: Yes"],
  ["expense", "alimonyAdjustmentNo", EXPENSE + "alimonyPayments.adjustementNo", "box", "Alimony adjustment to income: No"],
  ["expense", "expenseNotes", "page3.expensesReportComments.expensesReportComments", "note", "Expenses to report notes"],
  ["info", "infoScholarship", INFO + "taxableScholarshipIncome", "box", "Taxable scholarship income"],
  ["info", "info1098T", INFO + "form1098T", "box", "1098-T"],
  ["info", "infoEducationCredit", INFO + "educationCreditTuition", "box", "Education credit or tuition and fees deduction"],
  ["info", "infoHomeSale", INFO + "saleOfHome", "box", "Sale of home (1099-S)"],
  ["info", "infoHsaContributions", INFO + "hsaContributions", "box", "HSA contributions"],
  ["info", "infoHsaDistributions", INFO + "hsaDistributions", "box", "HSA distributions"],
  ["info", "info1095A", INFO + "form1095A", "box", "1095-A"],
  ["info", ENERGY_KEY, ENERGY_EN, "box", "Energy efficient home improvement credit"],
  ["info", "infoVehicleCredit", INFO + "vinNumber.numberVIN", "box", "Vehicle credit"],
  ["info", "infoVin", INFO + "vinNumber.vinNumber", "vin", "VIN"],
  ["info", "info1099C", INFO + "form1099C", "box", "1099-C"],
  ["info", "info1099A", INFO + "form1099A", "box", "1099-A"],
  ["info", "infoDisasterRelief", INFO + "disasterReliefImpacts", "box", "Disaster relief impacts return"],
  ["info", "infoDisallowed", INFO + "disallowedPreviousYear", "box", "EITC, CTC, AOTC or HOH disallowed in a previous year"],
  ["info", "infoDisallowedYear", INFO + "YearDisallowedReason.yearDisallowed", "year", "Year disallowed"],
  ["info", "infoDisallowedReason", INFO + "YearDisallowedReason.reasonDisallowed", "reason", "Reason disallowed"],
  ["info", "infoLitcReferral", INFO + "eligibleLITCReferral", "box", "Eligible for Low Income Taxpayer Clinic referral"],
  ["info", "infoEstimatedPayments", INFO + "estimatedTaxPayments.estimatedTaxPayments", "box", "Estimated tax payments"],
  ["info", "infoEstimatedPaymentsAmount", INFO + "estimatedTaxPayments.taxPaymentsAmount", "amount", "Estimated tax payments $"],
  ["info", "infoPriorRefundApplied", INFO + "lastYearsRefund.lastYearsRefund", "box", "Last year's refund applied to this year"],
  ["info", "infoPriorRefundAppliedAmount", INFO + "lastYearsRefund.refundAmount", "amount", "Last year's refund applied to this year $"],
  ["info", "infoLastReturnAvailable", INFO + "lastReturnAvailable", "box", "Last year's return available"],
  ["info", "infoNotes", "page3.informationReportComment.informationReportComment", "note", "Information to report notes"],
];

const household = [];
for (let n = 1; n <= 4; n++) {
  for (const [suffix, name, column] of HOUSEHOLD_COLUMNS) {
    household.push(["household", `household${n}${suffix}`, `page1.namesOf.Row${n}.${name}`, "cell", `Row ${n}: ${column}`]);
  }
}

export const SHADED_FIELDS = Object.freeze(
  [...household, ...ROWS].map(([block, key, path, kind, label]) => Object.freeze({
    key,
    en: full(path),
    zh: full(key === ENERGY_KEY ? ENERGY_ZH : path),
    kind,
    label,
    block,
  })),
);

export const SHADED_PAIRS = Object.freeze([
  ["itemizedLastYearYes", "itemizedLastYearNo"],
  ["capitalLossCarryoverYes", "capitalLossCarryoverNo"],
  ["alimonyExcludedYes", "alimonyExcludedNo"],
  ["alimonyAdjustmentYes", "alimonyAdjustmentNo"],
].map((p) => Object.freeze(p)));

const BY_KEY = new Map(SHADED_FIELDS.map((f) => [f.key, f]));

const FORMS = ["en", "zh-s", "zh-t"];
const nameOf = (field, form) => {
  if (!FORMS.includes(form)) throw new Error(`Unknown form: ${form}`);
  return form === "en" ? field.en : field.zh;
};

export function shadedName(key, form = "en") {
  const field = BY_KEY.get(key);
  if (!field) throw new Error(`Unknown shaded field: ${key}`);
  return nameOf(field, form);
}

export const shadedNames = (form = "en") => SHADED_FIELDS.map((f) => nameOf(f, form));

export const shadedLabel = (key) => BY_KEY.get(key)?.label ?? key;

const CELL_WORDS = Object.freeze({ y: "yes", yes: "yes", n: "no", no: "no", na: "na", "n/a": "na" });
const CELL_PRINT = Object.freeze({ yes: "Yes", no: "No", na: "N/A" });

export function shadedPrint(key, value) {
  const field = BY_KEY.get(key);
  if (field?.kind === "cell" && Object.hasOwn(CELL_PRINT, value)) return CELL_PRINT[value];
  return String(value);
}

const isBlank = (v) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
const OFF = new Set(["", "off", "false", "0"]);

// Normalise one raw value to its stored form. Returns { value } (value may be
// undefined for "absent") or { bad: true } when the text breaks the rule.
function normalise(field, raw) {
  if (field.kind === "box") {
    if (raw === true) return { value: true };
    if (typeof raw === "string" && !OFF.has(raw.trim().toLowerCase())) return { value: true };
    if (typeof raw === "number" && raw !== 0) return { value: true };
    return {};
  }
  if (isBlank(raw)) return {};
  const text = typeof raw === "string" ? raw : String(raw);
  const trimmed = text.trim();
  switch (field.kind) {
    case "cell": {
      const word = CELL_WORDS[trimmed.toLowerCase()];
      return word ? { value: word } : { bad: true };
    }
    case "count": {
      if (!/^[0-9]{1,6}$/.test(trimmed)) return { bad: true };
      const n = Number(trimmed);
      return n <= COUNT_MAX ? { value: n } : { bad: true };
    }
    case "amount": {
      const amount = trimmed.replace(/[$,\s]/g, "");
      return AMOUNT.test(amount) ? { value: amount } : { bad: true };
    }
    case "vin":
      return VIN.test(trimmed) ? { value: trimmed } : { bad: true };
    case "year":
      return /^[0-9]{4}$/.test(trimmed) ? { value: trimmed } : { bad: true };
    case "reason":
      return [...trimmed].length <= REASON_MAX ? { value: trimmed } : { bad: true };
    default: {
      const note = text.replace(/\r\n?/g, "\n");
      return [...note].length <= NOTE_MAX ? { value: note } : { bad: true };
    }
  }
}

const rowOf = (key) => {
  const m = /^household([1-4])/.exec(key);
  return m ? Number(m[1]) : 0;
};

export const HOUSEHOLD_ROWS = 4;

// How many household rows the case shows: the household answer, only while
// the catalogue shows it (has_household_members = yes), capped at 4.
export function householdRows(answers, { version = 2 } = {}) {
  const hh = visibleAnswers(version, answers ?? {}).hh;
  return Array.isArray(hh) ? Math.min(hh.length, HOUSEHOLD_ROWS) : 0;
}

// The stored cells without those on rows the case no longer shows.
export function visibleShaded(values, answers, { version = 2 } = {}) {
  const rows = householdRows(answers, { version });
  return Object.fromEntries(
    Object.entries(values ?? {}).filter(([key]) => rowOf(key) <= rows),
  );
}

// What readShaded needs from the case: its household size (rows past it
// take no cell) and its season (the year rule), else the workspace's.
export function shadedCaseRules(record, workspace) {
  const season = Number.isInteger(record?.season)
    ? record.season
    : Number.isInteger(workspace?.currentSeason)
      ? workspace.currentSeason
      : undefined;
  return {
    form: "en",
    householdSize: householdRows(record?.answers, { version: record?.intakeVersion ?? 2 }),
    season,
  };
}

function rule(field, season) {
  const label = field.label;
  switch (field.kind) {
    case "cell": return `${label} must be Yes, No or N/A.`;
    case "box": return `${label} must be ticked or left blank.`;
    case "count": return `${label} must be a whole number from 0 to ${COUNT_MAX}.`;
    case "amount": return `${label} must be dollars from 0 to 999999, with up to two decimals.`;
    case "vin": return `${label} must be 1 to 17 letters and digits.`;
    case "year": return Number.isInteger(season)
      ? `${label} must be a four-digit year from ${YEAR_MIN} to ${season - 1}.`
      : `${label} must be a four-digit year from ${YEAR_MIN}.`;
    case "reason": return `${label} must be 1 to ${REASON_MAX} characters.`;
    default: return `${label} must be 1 to ${NOTE_MAX} characters.`;
  }
}

// Length is in characters (code points), as the database counts them. A stored
// text that is only space, tab, line break, form feed or vertical tab is blank,
// and blank means absent, so it is refused.
const chars = (s) => [...s].length;
const storedText = (value, max) =>
  typeof value === "string" && !/^[ \t\n\r\f\v]*$/.test(value) && chars(value) <= max;

// Does a stored-shape value satisfy its field's own rule?
function valid(field, value, season) {
  switch (field.kind) {
    case "cell": return value === "yes" || value === "no" || value === "na";
    case "box": return value === true;
    case "count": return Number.isInteger(value) && value >= 0 && value <= COUNT_MAX;
    case "amount": return typeof value === "string" && AMOUNT.test(value);
    case "vin": return typeof value === "string" && VIN.test(value);
    case "year": {
      if (typeof value !== "string" || !/^[0-9]{4}$/.test(value)) return false;
      const year = Number(value);
      return year >= YEAR_MIN && (!Number.isInteger(season) || year < season);
    }
    case "reason": return storedText(value, REASON_MAX);
    default: return storedText(value, NOTE_MAX);
  }
}

export function checkShaded(values, { householdSize, season } = {}) {
  const errors = [];
  const source = values ?? {};
  for (const key of Object.keys(source)) {
    const field = BY_KEY.get(key);
    if (!field) {
      errors.push({ key, label: key, message: `${key} is not a field of the shaded section.` });
      continue;
    }
    if (!valid(field, source[key], season)) {
      errors.push({ key, label: field.label, message: rule(field, season) });
      continue;
    }
    const row = rowOf(key);
    if (row && Number.isInteger(householdSize) && row > householdSize) {
      errors.push({ key, label: field.label, message: `Row ${row} has no household member, so ${field.label} must be blank.` });
    }
  }
  for (const [yes, no] of SHADED_PAIRS) {
    if (source[yes] === true && source[no] === true) {
      const label = BY_KEY.get(yes).label.replace(/: Yes$/, "");
      errors.push({ key: yes, label, message: `${label}: Yes and No cannot both be ticked.` });
    }
  }
  return errors;
}

export function readShaded(raw, { form = "en", householdSize, season } = {}) {
  const byName = new Map(SHADED_FIELDS.map((f) => [nameOf(f, form), f]));
  const values = {};
  const errors = [];
  for (const [name, rawValue] of Object.entries(raw ?? {})) {
    const field = byName.get(name);
    if (!field) continue;
    const result = normalise(field, rawValue);
    if (result.bad) errors.push({ key: field.key, label: field.label, message: rule(field, season) });
    else if (result.value !== undefined) values[field.key] = result.value;
  }
  errors.push(...checkShaded(values, { householdSize, season }));
  return { values, errors };
}

// ---------------------------------------------------------------------------
// The upload's refusal and review words (staff text)
// ---------------------------------------------------------------------------

export const NO_VALUES_MESSAGE =
  "No filled values were found in this copy. If you filled it in macOS Preview, fill it again in Chrome or Adobe Acrobat Reader.";
export const PREVIEW_SAVED_NOTE = " This copy was saved by macOS Preview.";
export const PREVIEW_WARNING =
  "This copy was saved by macOS Preview, which can drop or change values. Check them before saving.";

// The sentence that refuses a copy with nothing filled in; null when it has a value.
export function uploadRefusal({ values, preview } = {}) {
  if (Object.keys(values ?? {}).length > 0) return null;
  return NO_VALUES_MESSAGE + (preview ? PREVIEW_SAVED_NOTE : "");
}

// The values as the review lists them, in the table's order.
export function reviewRows(values) {
  return SHADED_FIELDS.filter((f) => Object.hasOwn(values ?? {}, f.key)).map((f) => ({
    key: f.key,
    label: f.label,
    value: f.kind === "box" ? "ticked" : shadedPrint(f.key, values[f.key]),
  }));
}
