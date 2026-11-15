import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import * as PDFLib from "../src/vendor/pdf-lib.mjs";
import {
  EXIT_FORM_FILE,
  EXIT_FORM_LAYOUT,
  buildExitFormPdf,
  exitFormFontFields,
  exitFormMarks,
  exitFormNeedsFont,
} from "../src/exit-form.mjs";
import { DRAFT_FONT_FIXTURES, draftFontFiles, draftFontsFor } from "../src/draft-pdf.mjs";

// Fictional case and answers only.
const CASE = { taxYear: 2025, clientNumber: 31, firstName: "Mei", lastName: "Chen" };
const L = EXIT_FORM_LAYOUT;
const valueAt = (marks, place) => marks.text.find((m) => m.x === place.x && m.y === place.y)?.value;
const ticked = (marks, at) => marks.checks.some((c) => c.x === at[0] && c.y === at[1]);

test("the header comes from the case and today", () => {
  const marks = exitFormMarks({ exitForm: { federal: null, state: null, local: [] } }, CASE, "2026-11-01");
  assert.equal(valueAt(marks, L.taxYear), "2025");
  assert.equal(valueAt(marks, L.date), "11/01/2026");
  assert.equal(valueAt(marks, L.clientNumber), "31");
  assert.equal(valueAt(marks, L.taxpayer), "Mei Chen");
  assert.equal(marks.checks.length, 0);
  assert.equal(marks.fileName, "exit-form-31.pdf");
});

test("a couple is written as taxpayer & spouse", () => {
  const marks = exitFormMarks(
    { exitForm: { federal: null, state: null, local: [] } },
    { ...CASE, spouseFirstName: "Wei", spouseLastName: "Chen" },
    "2026-11-01",
  );
  assert.equal(valueAt(marks, L.taxpayer), "Mei Chen & Wei Chen");
});

test("a refund ticks the method and how it is paid, with the amount as money", () => {
  const q = { exitForm: { federal: { method: "efile", result: "refund", amount: "1234.5", refundBy: "direct_deposit" }, state: null, local: [] } };
  const marks = exitFormMarks(q, CASE, "2026-11-01");
  const g = L.groups.federal;
  assert.equal(valueAt(marks, g.amount), "$1,234.50");
  assert.ok(ticked(marks, g.boxes.efile));
  assert.ok(ticked(marks, g.boxes.direct_deposit));
  assert.equal(marks.checks.length, 2);
});

test("an owed direct debit prints its date", () => {
  const q = {
    exitForm: {
      federal: null,
      state: { method: "paper", result: "owe", amount: "86", oweBy: "direct_debit", debitOn: "2026-04-15" },
      local: [],
    },
  };
  const marks = exitFormMarks(q, CASE, "2026-11-01");
  assert.equal(valueAt(marks, L.groups.state.debitOn), "04/15/2026");
  assert.equal(valueAt(marks, L.groups.state.amount), "$86.00");
  assert.ok(ticked(marks, L.groups.state.boxes.paper));
  assert.ok(ticked(marks, L.groups.state.boxes.direct_debit));
});

test("the header and amounts are bold and larger than the form's 12 pt labels; remarks start at 12 pt", () => {
  const q = { remarks: "Fictional note.", exitForm: { federal: { method: "efile", result: "refund", amount: "10", refundBy: "check" }, state: null, local: [] } };
  const marks = exitFormMarks(q, CASE, "2026-11-01");
  for (const [name, place] of Object.entries({ taxYear: L.taxYear, date: L.date, clientNumber: L.clientNumber, taxpayer: L.taxpayer, amount: L.groups.federal.amount })) {
    const mark = marks.text.find((m) => m.x === place.x && m.y === place.y);
    assert.equal(mark?.bold, true, `${name} is bold`);
    assert.ok(mark.size > 12, `${name} is larger than 12 pt`);
  }
  assert.equal(marks.text.find((m) => m.x === L.remarks.x && m.y === L.remarks.y).size, 12);
});

test("a debit date starts at 9 pt, and Federal, State and Local amounts at 14, 14 and 13 pt, all bold", () => {
  const q = {
    exitForm: {
      federal: { method: "efile", result: "refund", amount: "10", refundBy: "check" },
      state: { method: "paper", result: "owe", amount: "86", oweBy: "direct_debit", debitOn: "2026-04-15" },
      local: [{ type: "NPT", method: "paper", result: "refund", amount: "40", refundBy: "check" }],
    },
  };
  const marks = exitFormMarks(q, CASE, "2026-11-01");
  const at = (x, y) => marks.text.find((m) => m.x === x && m.y === y);
  const T = L.local;
  const localY = T.firstBaseline;
  for (const [name, mark, size] of [
    ["debit date", at(L.groups.state.debitOn.x, L.groups.state.debitOn.y), 9],
    ["Federal amount", at(L.groups.federal.amount.x, L.groups.federal.amount.y), 14],
    ["State amount", at(L.groups.state.amount.x, L.groups.state.amount.y), 14],
    ["Local amount", at(T.amount.x, localY), 13],
  ]) {
    assert.equal(mark?.size, size, `${name} size`);
    assert.equal(mark.bold, true, `${name} is bold`);
  }
});

test("no refund or tax owed ticks only the filing method", () => {
  const q = { exitForm: { federal: { method: "efile", result: "none" }, state: null, local: [] } };
  const marks = exitFormMarks(q, CASE, "2026-11-01");
  assert.deepEqual(marks.checks, [{ x: L.groups.federal.boxes.efile[0], y: L.groups.federal.boxes.efile[1] }]);
  assert.equal(valueAt(marks, L.groups.federal.amount), undefined);
});

// One "Other Tax" row: which of its three boxes are ticked, and the amount.
const T = L.local;
const ROWS = ["NPT", "BIRT", "EET", "SIT", "PAIBWTR"];
const localRow = (marks, type) => {
  const y = T.firstBaseline + ROWS.indexOf(type) * T.pitch;
  const tick = (x) => marks.checks.some((c) => c.x === x + T.box / 2 && c.y === y - T.box / 2 + 0.5);
  return {
    ticked: tick(T.typeBox),
    owe: tick(T.oweBox),
    refund: tick(T.refundBox),
    amount: marks.text.find((m) => m.x === T.amount.x && m.y === y)?.value ?? "",
  };
};

test("Other Tax prints a row for every Local tax, so it can be ticked by hand", () => {
  const marks = exitFormMarks({ exitForm: { federal: null, state: null, local: [] } }, CASE, "2026-11-01");
  for (const type of ROWS) {
    const y = T.firstBaseline + ROWS.indexOf(type) * T.pitch;
    assert.ok(marks.text.some((m) => m.x === T.typeLabel.x && m.y === y && m.value === type && m.embedded), type);
    assert.ok(marks.text.some((m) => m.x === T.oweLabel.x && m.y === y && m.value === "補繳 Owe"), type);
    assert.ok(marks.text.some((m) => m.x === T.refundLabel.x && m.y === y && m.value === "退稅 Refund"), type);
    assert.deepEqual(localRow(marks, type), { ticked: false, owe: false, refund: false, amount: "" });
  }
  assert.equal(marks.squares.length, 15);
  assert.equal(marks.rules.length, 5);
  assert.equal(marks.checks.length, 0);
  assert.deepEqual(marks.covers, T.covers);
  // The section's label is drawn again at the left edge 聯邦稅 and 州稅 use.
  assert.ok(marks.text.some((m) => m.value === "其他稅" && m.x === 50));
  assert.ok(marks.text.some((m) => m.value === "Other Tax:"));
});

test("a Local tax that applies is ticked with its amount and Owe or Refund", () => {
  const q = {
    remarks: "Bring photo ID.",
    exitForm: {
      federal: null,
      state: null,
      local: [
        { type: "NPT", method: "paper", result: "refund", amount: "40", refundBy: "check" },
        { type: "BIRT", method: "paper", result: "owe", amount: "1250", oweBy: "mail_check" },
        { type: "EET", method: "paper", result: "none" },
      ],
    },
  };
  const marks = exitFormMarks(q, CASE, "2026-11-01");
  assert.deepEqual(localRow(marks, "NPT"), { ticked: true, owe: false, refund: true, amount: "40.00" });
  assert.deepEqual(localRow(marks, "BIRT"), { ticked: true, owe: true, refund: false, amount: "1,250.00" });
  assert.deepEqual(localRow(marks, "EET"), { ticked: true, owe: false, refund: false, amount: "" });
  assert.deepEqual(localRow(marks, "SIT"), { ticked: false, owe: false, refund: false, amount: "" });
  assert.equal(valueAt(marks, L.remarks), "Bring photo ID.");
});

test("e-file, direct deposit and direct debit on a Local tax go to the remarks", () => {
  const q = {
    remarks: "Signed in person.",
    exitForm: {
      federal: null,
      state: null,
      local: [{ type: "SIT", method: "efile", result: "owe", amount: "12.3", oweBy: "direct_debit", debitOn: "2026-04-15" }],
    },
  };
  const marks = exitFormMarks(q, CASE, "2026-11-01");
  assert.deepEqual(localRow(marks, "SIT"), { ticked: true, owe: true, refund: false, amount: "12.30" });
  assert.equal(valueAt(marks, L.remarks), "SIT: e-filed, direct debit on 04/15/2026; Signed in person.");
});

test("the filled PDF is one page with a blank author", async () => {
  const q = { remarks: "Signed in person.", exitForm: { federal: { method: "efile", result: "refund", amount: "10", refundBy: "check" }, state: null, local: [] } };
  const marks = exitFormMarks(q, CASE, "2026-11-01");
  const fontFiles = await draftFontFiles(draftFontsFor("zh-t"), exitFormFontFields(marks), {
    fontkit: PDFLib.fontkit,
    fetchFont: (file) => readFile(DRAFT_FONT_FIXTURES[file.url].path),
  });
  const bytes = await buildExitFormPdf({ PDFLib, fontkit: PDFLib.fontkit, formBytes: await readFile(EXIT_FORM_FILE), fontFiles, marks });
  const doc = await PDFLib.PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 1);
  assert.equal(doc.getAuthor() ?? "", "");
});

test("Chinese in a name or the remarks is drawn with the downloaded fonts", async () => {
  const marks = exitFormMarks({ remarks: "已電話確認", exitForm: { federal: null, state: null, local: [] } }, { ...CASE, firstName: "美" }, "2026-11-01");
  assert.equal(exitFormNeedsFont(marks), true);
  await assert.rejects(
    buildExitFormPdf({ PDFLib, fontkit: PDFLib.fontkit, formBytes: await readFile(EXIT_FORM_FILE), marks }),
    /font files/,
  );
  const fontFiles = await draftFontFiles(draftFontsFor("zh-t"), exitFormFontFields(marks), {
    fontkit: PDFLib.fontkit,
    fetchFont: (file) => readFile(DRAFT_FONT_FIXTURES[file.url].path),
  });
  const bytes = await buildExitFormPdf({ PDFLib, fontkit: PDFLib.fontkit, formBytes: await readFile(EXIT_FORM_FILE), fontFiles, marks });
  assert.equal((await PDFLib.PDFDocument.load(bytes)).getPageCount(), 1);
});

// What a built page draws on the line at a place: its text and font sizes.
async function lineAt(marks, place, keep = () => true) {
  const fontFiles = await draftFontFiles(draftFontsFor("zh-t"), exitFormFontFields(marks), {
    fontkit: PDFLib.fontkit,
    fetchFont: (file) => readFile(DRAFT_FONT_FIXTURES[file.url].path),
  });
  const bytes = await buildExitFormPdf({ PDFLib, fontkit: PDFLib.fontkit, formBytes: await readFile(EXIT_FORM_FILE), fontFiles, marks });
  const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const { items } = await (await (await task.promise).getPage(1)).getTextContent();
  await task.destroy();
  const line = items.filter(
    (item) => item.str.trim() && keep(item.str) && Math.abs(item.transform[5] - (792 - place.y)) < 1 && item.transform[4] >= place.x - 1,
  );
  return { text: line.map((item) => item.str).join(""), sizes: line.map((item) => item.transform[0]), fonts: [...new Set(line.map((item) => item.fontName))] };
}

// The Remarks line as the page draws it.
const remarksLine = (remarks, local = []) =>
  lineAt(exitFormMarks({ remarks, exitForm: { federal: null, state: null, local } }, CASE, "2026-11-01"), L.remarks);

test("a short remark is drawn whole at 12 pt", async () => {
  const { text, sizes } = await remarksLine("Bring the corrected W-2.");
  assert.equal(text, "Bring the corrected W-2.");
  assert.ok(sizes.every((size) => Math.abs(size - 12) < 0.01));
});

test("a wider remark is drawn whole and smaller", async () => {
  const remark = "Fictional remark ".repeat(8).trim();
  const { text, sizes } = await remarksLine(remark);
  assert.equal(text, remark);
  assert.ok(sizes.every((size) => size < 12 && size >= 5.99));
});

// Known problem, #122: this records what happens, not what we want.
test("a remark too long for the line is cut at 6 pt, in English and Chinese (#122)", async () => {
  for (const remark of ["Fictional remark ".repeat(120).slice(0, 2000), "虛構備註".repeat(500)]) {
    const { text, sizes } = await remarksLine(remark);
    assert.ok(text.endsWith("…"));
    assert.ok(remark.startsWith(text.slice(0, -1)));
    assert.ok(sizes.every((size) => Math.abs(size - 6) < 0.01));
  }
});

test("a name Helvetica can't draw is not bold, and is drawn whole in the downloaded font", async () => {
  const line = async (firstName) => {
    const marks = exitFormMarks({ exitForm: { federal: null, state: null, local: [] } }, { ...CASE, firstName }, "2026-11-01");
    return lineAt(marks, L.taxpayer);
  };
  const plain = await line("Mei");
  const accented = await line("Nguyễn");
  assert.equal(plain.text, "Mei Chen");
  assert.equal(accented.text, "Nguyễn Chen");
  assert.ok(plain.fonts.length > 0 && accented.fonts.length > 0);
  assert.ok(accented.fonts.every((font) => !plain.fonts.includes(font)), JSON.stringify([plain.fonts, accented.fonts]));
});

// Known problem, #122: this records what happens, not what we want.
test("a State direct debit date is drawn at 6.5 pt, because its place is small (#122)", async () => {
  const q = { exitForm: { federal: null, state: { method: "efile", result: "owe", amount: "86", oweBy: "direct_debit", debitOn: "2027-04-15" }, local: [] } };
  // The template's own words share this baseline, so keep only the date.
  const { text, sizes } = await lineAt(exitFormMarks(q, CASE, "2026-11-01"), L.groups.state.debitOn, (str) => /\d\d\/\d\d\/\d{4}/.test(str));
  assert.match(text, /^\s*04\/15\/2027$/);
  assert.ok(sizes.every((size) => Math.abs(size - 6.5) < 0.01), JSON.stringify(sizes));
});

test("a Local note at the front of the Remarks leaves less room for them (#122)", async () => {
  const remark = "Fictional remark ".repeat(9).trim(); // fits with no note
  assert.equal((await remarksLine(remark)).text, remark);
  const local = [{ type: "SIT", method: "efile", result: "owe", amount: "10", oweBy: "direct_debit", debitOn: "2027-04-15" }];
  const { text } = await remarksLine(remark, local);
  assert.ok(text.startsWith("SIT: e-filed, direct debit on 04/15/2027; Fictional"));
  assert.ok(text.endsWith("…"));
});

test("the template has no document info, and a filled form is titled Exit Form", async () => {
  const template = await PDFLib.PDFDocument.load(await readFile(EXIT_FORM_FILE), { updateMetadata: false });
  assert.equal(template.getAuthor(), undefined);
  assert.equal(template.getTitle(), undefined);
  const marks = exitFormMarks({ exitForm: { federal: null, state: null, local: [] } }, CASE, "2026-11-01");
  const fontFiles = await draftFontFiles(draftFontsFor("zh-t"), exitFormFontFields(marks), {
    fontkit: PDFLib.fontkit,
    fetchFont: (file) => readFile(DRAFT_FONT_FIXTURES[file.url].path),
  });
  const bytes = await buildExitFormPdf({ PDFLib, fontkit: PDFLib.fontkit, formBytes: await readFile(EXIT_FORM_FILE), fontFiles, marks });
  assert.equal((await PDFLib.PDFDocument.load(bytes, { updateMetadata: false })).getTitle(), "Exit Form");
});

test("the reduced questionnaire draws the header and method ticks only", () => {
  const marks = exitFormMarks({ exitForm: { federal: null, state: { method: "efile" }, local: [] }, remarks: "" }, CASE, "2026-11-03");
  assert.ok(ticked(marks, L.groups.state.boxes.efile));
  assert.equal(marks.checks.length, 1);
  for (const place of [L.groups.state.amount, L.groups.state.debitOn, L.groups.federal.amount, L.remarks]) {
    assert.equal(valueAt(marks, place), undefined);
  }
  assert.equal(valueAt(marks, L.taxYear), "2025");
  assert.equal(valueAt(marks, L.date), "11/03/2026");
  assert.equal(valueAt(marks, L.clientNumber), "31");
  assert.equal(valueAt(marks, L.taxpayer), "Mei Chen");
});
