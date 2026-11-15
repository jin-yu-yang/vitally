import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PDFDocument, PDFCheckBox, PDFTextField } from "pdf-lib";
import { FORM_FILES } from "../src/draft-form.mjs";
import {
  SHADED_FIELDS, SHADED_PAIRS, shadedName, shadedNames, readShaded, checkShaded, shadedPrint, shadedLabel,
  NO_VALUES_MESSAGE, PREVIEW_SAVED_NOTE, PREVIEW_WARNING, uploadRefusal, reviewRows,
  householdRows, visibleShaded, shadedCaseRules,
} from "../src/shaded-fields.mjs";

const read = (raw, opts) => readShaded({ [shadedName("household1QualifyingChild")]: raw }, opts);
const one = (key, raw, opts = {}) => readShaded({ [shadedName(key, opts.form)]: raw }, opts);

test("the table names every shaded field in all three forms", async () => {
  assert.equal(SHADED_FIELDS.length, 106);
  assert.equal(new Set(SHADED_FIELDS.map((f) => f.key)).size, 106);
  assert.equal(new Set(SHADED_FIELDS.map((f) => f.label)).size, 106, "labels are unique");
  assert.equal(SHADED_PAIRS.length, 4);
  for (const form of Object.keys(FORM_FILES)) {
    const pdf = await PDFDocument.load(await readFile(new URL(`../${FORM_FILES[form]}`, import.meta.url)), { updateMetadata: false });
    const pdfForm = pdf.getForm();
    const names = shadedNames(form);
    assert.equal(names.length, 106);
    assert.equal(new Set(names).size, 106, form);
    for (const field of SHADED_FIELDS) {
      const pdfField = pdfForm.getField(shadedName(field.key, form));
      const want = field.kind === "box" ? PDFCheckBox : PDFTextField;
      assert.ok(pdfField instanceof want, `${form} ${field.key}`);
    }
  }
});

test("the one name that differs", () => {
  assert.ok(shadedName("infoEnergyImprovement", "en").endsWith("efficientHomeImprovement[0].efficientHomeImprovement[0]"));
  for (const form of ["zh-s", "zh-t"]) {
    assert.ok(shadedName("infoEnergyImprovement", form).endsWith("informationToReport[0].efficientHomeImprovement[0]"), form);
  }
  const differing = SHADED_FIELDS.filter((f) => f.en !== f.zh).map((f) => f.key);
  assert.deepEqual(differing, ["infoEnergyImprovement"]);
});

test("cells", () => {
  for (const [typed, stored] of [["y", "yes"], ["Yes", "yes"], ["N", "no"], ["no", "no"], ["n/a", "na"], ["NA", "na"]]) {
    const { values, errors } = read(typed);
    assert.deepEqual(errors, [], typed);
    assert.equal(values.household1QualifyingChild, stored, typed);
  }
  const bad = read("maybe");
  assert.deepEqual(bad.values, {});
  assert.equal(bad.errors.length, 1);
  assert.equal(bad.errors[0].key, "household1QualifyingChild");
  assert.match(bad.errors[0].message, /^Row 1: Qualifying child or dependent must be Yes, No or N\/A\.$/);
  assert.equal(shadedPrint("household1QualifyingChild", "na"), "N/A");
  assert.equal(shadedPrint("household1QualifyingChild", "yes"), "Yes");
});

test("any export value ticks", () => {
  for (const v of ["Yes", "On", "1", true, "/Choice1"]) assert.deepEqual(one("incomeW2s", v).values, { incomeW2s: true }, String(v));
  for (const v of ["Off", false, "", null]) {
    const r = one("incomeW2s", v);
    assert.deepEqual(r.values, {}, String(v));
    assert.deepEqual(r.errors, []);
  }
});

test("counts", () => {
  assert.deepEqual(one("incomeW2sCount", "02").values, { incomeW2sCount: 2 });
  assert.equal(typeof one("incomeW2sCount", "02").values.incomeW2sCount, "number");
  for (const v of ["120", "2.0", "-1"]) {
    const r = one("incomeW2sCount", v);
    assert.deepEqual(r.values, {}, v);
    assert.equal(r.errors.length, 1, v);
    assert.match(r.errors[0].message, /W-2s #/);
  }
});

test("amounts", () => {
  assert.deepEqual(one("incomeRefundAmount", "$1,250.50").values, { incomeRefundAmount: "1250.50" });
  for (const v of ["1000000", "12.345"]) assert.equal(one("incomeRefundAmount", v).errors.length, 1, v);
  assert.match(one("incomeRefundAmount", "12.345").errors[0].message, /Refund \$/);
});

test("vin, year, reason", () => {
  assert.equal(one("infoVin", "1HGCM82633A004352").errors.length, 0);
  assert.equal(one("infoVin", "1HGCM82633A0043521").errors.length, 1);
  const opts = { season: 2026 };
  assert.deepEqual(one("infoDisallowedYear", "2025", opts).values, { infoDisallowedYear: "2025" });
  assert.equal(one("infoDisallowedYear", "2026", opts).errors.length, 1);
  assert.equal(one("infoDisallowedYear", "1999", opts).errors.length, 1);
  assert.equal(one("infoDisallowedYear", "2026").errors.length, 0, "no season: only 4 digits and 2000+");
  assert.equal(one("infoDisallowedYear", "99").errors.length, 1);
  assert.equal(one("infoDisallowedReason", "x".repeat(120)).errors.length, 0);
  assert.equal(one("infoDisallowedReason", "x".repeat(121)).errors.length, 1);
});

test("notes", () => {
  const ok = "a\nb\r\n".repeat(100).slice(0, 500);
  assert.equal(one("incomeNotes", ok).errors.length, 0);
  assert.equal(one("incomeNotes", "x".repeat(501)).errors.length, 1);
  const zh = "收入说明：一份 W-2";
  assert.equal(one("incomeNotes", zh).values.incomeNotes, zh);
  assert.deepEqual(checkShaded({ incomeNotes: zh }), []);
  assert.equal(shadedLabel("incomeNotes"), "Income notes");
  assert.equal(shadedLabel("deductionNotes"), "Standard or itemized deductions notes");
  assert.equal(shadedLabel("expenseNotes"), "Expenses to report notes");
  assert.equal(shadedLabel("infoNotes"), "Information to report notes");
});

test("blank means absent", () => {
  for (const key of ["household1QualifyingChild", "incomeW2sCount", "incomeNotes"]) {
    const r = one(key, "   ");
    assert.deepEqual(r.values, {}, key);
    assert.deepEqual(r.errors, [], key);
  }
});

test("pairs", () => {
  for (const [yes, no] of SHADED_PAIRS) {
    const errors = checkShaded({ [yes]: true, [no]: true });
    assert.equal(errors.length, 1, yes);
    assert.match(errors[0].message, /Yes and No cannot both be ticked/);
    assert.deepEqual(checkShaded({ [yes]: true }), []);
  }
  const { errors } = readShaded({ [shadedName("itemizedLastYearYes")]: "Yes", [shadedName("itemizedLastYearNo")]: "Yes" });
  assert.match(errors[0].message, /^Itemized last year: Yes and No/);
});

test("empty rows", () => {
  const { errors } = readShaded({ [shadedName("household3QualifyingChild")]: "y" }, { householdSize: 2 });
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /Row 3/);
  assert.equal(readShaded({ [shadedName("household2QualifyingChild")]: "y" }, { householdSize: 2 }).errors.length, 0);
  assert.equal(readShaded({ [shadedName("household3QualifyingChild")]: "y" }).errors.length, 0, "no size: rule skipped");
  assert.equal(SHADED_FIELDS.filter((f) => f.block === "household").length, 20);
  assert.equal(SHADED_FIELDS.some((f) => /^household[5-9]/.test(f.key)), false);
});

test("unknown keys", () => {
  const errors = checkShaded({ nope: true });
  assert.deepEqual(errors.map((e) => [e.key, e.label]), [["nope", "nope"]]);
});

test("readShaded reads the Chinese form names and ignores other fields", () => {
  const raw = { [shadedName("infoEnergyImprovement", "zh-s")]: "Yes", "form1[0].page1[0].somethingElse[0]": "x" };
  assert.deepEqual(readShaded(raw, { form: "zh-s" }), { values: { infoEnergyImprovement: true }, errors: [] });
});

test("stored text counts characters, not UTF-16 units, and is never blank", () => {
  const astral = "\u{1F600}"; // one character, two UTF-16 units
  const reasonKey = "infoDisallowedReason";
  assert.deepEqual(checkShaded({ incomeNotes: astral.repeat(500) }), []);
  assert.equal(checkShaded({ incomeNotes: astral.repeat(501) }).length, 1);
  assert.deepEqual(checkShaded({ [reasonKey]: astral.repeat(120) }), []);
  assert.equal(checkShaded({ [reasonKey]: astral.repeat(121) }).length, 1);
  assert.equal(readShaded({ [shadedName(reasonKey)]: astral.repeat(121) }).errors.length, 1);
  assert.equal(readShaded({ [shadedName("incomeNotes")]: astral.repeat(501) }).errors.length, 1);
  for (const key of [reasonKey, "incomeNotes"]) {
    for (const blank of ["", " ", "\n", " \t\r\n "])
      assert.equal(checkShaded({ [key]: blank }).length, 1, `${key} ${JSON.stringify(blank)}`);
  }
});

test("uploadRefusal says no values were found, with the Preview note when it applies", () => {
  assert.equal(uploadRefusal({ values: {}, preview: false }), NO_VALUES_MESSAGE);
  assert.equal(uploadRefusal({ values: {}, preview: true }), NO_VALUES_MESSAGE + " This copy was saved by macOS Preview.");
  assert.equal(PREVIEW_SAVED_NOTE, " This copy was saved by macOS Preview.");
  assert.match(PREVIEW_WARNING, /^This copy was saved by macOS Preview, which can drop or change values\. Check them before saving\.$/);
  assert.equal(uploadRefusal({ values: { incomeW2s: true } }), null);
});

test("zero is a value, blank is not", () => {
  const count = readShaded({ [shadedName("incomeW2sCount")]: "0" });
  assert.deepEqual(count.values, { incomeW2sCount: 0 });
  assert.equal(uploadRefusal({ values: count.values }), null);
  const note = readShaded({ [shadedName("incomeNotes")]: "   " });
  assert.deepEqual(note.values, {});
  assert.equal(uploadRefusal({ values: note.values }), NO_VALUES_MESSAGE);
});

test("reviewRows lists the values in table order with plain words", () => {
  const rows = reviewRows({ incomeNotes: "a\nb", incomeW2sCount: 2, household1QualifyingChild: "na", incomeW2s: true });
  assert.deepEqual(rows.map((r) => r.key), ["household1QualifyingChild", "incomeW2s", "incomeW2sCount", "incomeNotes"]);
  assert.deepEqual(rows.map((r) => r.value), ["N/A", "ticked", "2", "a\nb"]);
  assert.deepEqual(rows.map((r) => r.label), rows.map((r) => shadedLabel(r.key)));
});

const KEPT = [{ first_name: "Lin" }, { first_name: "Kai" }];
const members = (n) => Array.from({ length: n }, (_, i) => ({ first_name: `M${i}` }));
test("householdRows follows the household answer and caps at 4", () => {
  assert.equal(householdRows({}), 0);
  assert.equal(householdRows({ has_household_members: "no", hh: KEPT }), 0);
  assert.equal(householdRows({ has_household_members: "yes", hh: [] }), 0);
  assert.equal(householdRows({ has_household_members: "yes", hh: members(1) }), 1);
  assert.equal(householdRows({ has_household_members: "yes", hh: members(3) }), 3);
  assert.equal(householdRows({ has_household_members: "yes", hh: members(4) }), 4);
  assert.equal(householdRows({ has_household_members: "yes", hh: members(6) }), 4);
  assert.equal(householdRows({ has_household_members: "yes", hh: "x" }), 0);
  assert.equal(householdRows({ has_household_members: "yes", hh: KEPT }, { version: 2 }), 2);
});
test("visibleShaded drops cells on hidden rows only", () => {
  const stored = { household1QualifyingChild: "yes", household2OwnSupport: "no", household3LowIncome: "na", incomeW2s: true };
  assert.deepEqual(visibleShaded(stored, { has_household_members: "no", hh: KEPT }), { incomeW2s: true });
  assert.deepEqual(visibleShaded(stored, { has_household_members: "yes", hh: KEPT }),
    { household1QualifyingChild: "yes", household2OwnSupport: "no", incomeW2s: true });
  assert.deepEqual(visibleShaded(null, {}), {});
});
test("the case's rules refuse row 1 once the answer is No", () => {
  const record = { answers: { has_household_members: "no", hh: KEPT }, intakeVersion: 2, season: 2026 };
  const { errors } = readShaded({ [shadedName("household1QualifyingChild")]: "yes" }, shadedCaseRules(record, null));
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /^Row 1 has no household member/);
});
test("hidden stored cells never block a Save with no change", () => {
  const stored = { household1QualifyingChild: "yes", incomeW2s: true };
  const record = { answers: { has_household_members: "no", hh: KEPT }, intakeVersion: 2, season: 2026 };
  const shown = visibleShaded(stored, record.answers, { version: record.intakeVersion });
  const raw = Object.fromEntries(Object.entries(shown).map(([k, v]) => [shadedName(k), v === true ? "On" : v]));
  assert.deepEqual(readShaded(raw, shadedCaseRules(record, null)), { values: { incomeW2s: true }, errors: [] });
});
