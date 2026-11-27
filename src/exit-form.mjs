// The Exit Form: PCDC's one-page bilingual hand-out for the client, filled
// from the reviewer's questionnaire (its Exit Form groups and remarks) and
// the case (tax year, client number, taxpayer name). The template has no
// form fields, so every value is drawn at a fixed place on the page.
// exitFormMarks says what goes where; buildExitFormPdf draws it.
import { oneLine, usDate } from "./draft-form.mjs";
import { needsEmbeddedFont, patchSubsetPadding, printable } from "./draft-pdf.mjs";
import { LOCAL_TYPES } from "./questionnaires.mjs";

// The Local taxes, in the questionnaire's order: a row each under Other Tax.
const LOCAL_TAXES = Object.freeze(LOCAL_TYPES.map(([type]) => type));

// The tax year a case's Exit Form shows: the season is the year the return is
// filed, so the tax year is one earlier. A case without a season uses the
// workspace's current season; with neither, null leaves the field blank.
export function exitFormTaxYear(record, workspace) {
  if (Number.isInteger(record?.season)) return record.season - 1;
  if (Number.isInteger(workspace?.currentSeason)) return workspace.currentSeason - 1;
  return null;
}

export const EXIT_FORM_FILE = "src/forms/exit-form-pcdc.pdf";

const PAGE_HEIGHT = 792;
// What the system fills in is drawn in bold and larger than the form's own
// labels, so it reads at a glance.
const TEXT_SIZE = 15;
const AMOUNT_SIZE = 14;
const SMALL_SIZE = 9;
const ROW_SIZE = 11;
const MIN_SIZE = 6;

// Places on the template, in points from the page's top-left corner (as a
// PDF reader measures them); buildExitFormPdf turns them into PDF space.
// A text place is { x, y, width } with y its baseline; a box is its centre.
export const EXIT_FORM_LAYOUT = Object.freeze({
  taxYear: { x: 226, y: 141, width: 80 },
  date: { x: 134, y: 174, width: 190 },
  clientNumber: { x: 500, y: 174, width: 100 },
  taxpayer: { x: 252, y: 204, width: 310 },
  remarks: { x: 130, y: 557, width: 432 },
  // "Other Tax": the template's own boxes are covered and replaced by one
  // row per Local tax, printed whether or not it applies, so the form can
  // still be ticked by hand: ☐ NPT $____  ☐ 補繳 Owe  ☐ 退稅 Refund.
  local: {
    // The whole Other Tax section of the template, its own label included:
    // the label is drawn again at the left edge 聯邦稅 and 州稅 use.
    covers: [{ x: 47, y: 422.5, width: 538, height: 97.5 }],
    label: { zh: { x: 50, y: 447, size: 14 }, en: { x: 95, y: 447, size: 12 } },
    firstBaseline: 447,
    pitch: 17,
    box: 9,
    typeBox: 163,
    typeLabel: { x: 177, width: 56 },
    dollar: { x: 246, width: 10 },
    amount: { x: 258, width: 74, ruleFrom: 256, ruleTo: 334 },
    oweBox: 352,
    oweLabel: { x: 366, width: 64 },
    refundBox: 440,
    refundLabel: { x: 454, width: 100 },
  },
  groups: {
    federal: {
      amount: { x: 503, y: 246, width: 76 },
      debitOn: { x: 388, y: 299, width: 45.5 },
      boxes: {
        efile: [174, 241], paper: [281, 241],
        direct_deposit: [134, 267], check: [444, 267],
        direct_debit: [132.5, 293], mail_check: [445, 293],
      },
    },
    state: {
      amount: { x: 467, y: 350, width: 95 },
      debitOn: { x: 388, y: 403, width: 45.5 },
      boxes: {
        efile: [147.5, 345], paper: [254.5, 345],
        direct_deposit: [134, 371], check: [444, 371],
        direct_debit: [132.5, 397], mail_check: [445, 397],
      },
    },
  },
});

const money = (amount) => {
  const [whole, cents = ""] = String(amount).split(".");
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${cents.padEnd(2, "0")}`;
};

const OWE_LABEL = "補繳 Owe";
const REFUND_LABEL = "退稅 Refund";
const HOW_NOTE = Object.freeze({ direct_deposit: "direct deposit", direct_debit: "direct debit" });

// What a Local entry needs said beyond its row (rare: e-file, direct
// deposit, direct debit), for the front of the remarks.
function localNote(entry) {
  const parts = [];
  if (entry.method === "efile") parts.push("e-filed");
  const how = entry.result === "refund" ? entry.refundBy : entry.result === "owe" ? entry.oweBy : null;
  if (HOW_NOTE[how]) parts.push(`${HOW_NOTE[how]}${entry.debitOn ? ` on ${usDate(entry.debitOn)}` : ""}`);
  return parts.length ? `${entry.type}: ${parts.join(", ")}` : "";
}

function groupMarks(layout, entry, out) {
  if (!entry) return;
  const box = (name) => {
    const at = layout.boxes[name];
    if (at) out.checks.push({ x: at[0], y: at[1] });
  };
  box(entry.method);
  if (entry.result === "none") return;
  if (entry.amount != null) out.text.push({ ...layout.amount, value: money(entry.amount), size: AMOUNT_SIZE, bold: true });
  if (entry.result === "refund") box(entry.refundBy);
  if (entry.result === "owe") {
    box(entry.oweBy);
    if (entry.oweBy === "direct_debit" && entry.debitOn)
      out.text.push({ ...layout.debitOn, value: usDate(entry.debitOn), size: SMALL_SIZE, bold: true });
  }
}

/**
 * What the Exit Form shows, from the reviewer's questionnaire and the case.
 * `case` is { taxYear, clientNumber, firstName, lastName, spouseFirstName,
 * spouseLastName } (the spouse's only for a couple); `today` is
 * 'YYYY-MM-DD'. Returns { text: [{x, y, width, value, size}], checks:
 * [{x, y}], covers and squares: [{x, y, width, height}], rules: [{from, to,
 * y}], fileName }. "Other Tax" has a row for each Local tax; the ones that
 * apply are ticked with their amount and Owe or Refund. Nothing about a bank
 * account is ever drawn.
 */
export function exitFormMarks(
  questionnaire,
  { taxYear, clientNumber, firstName, lastName, spouseFirstName, spouseLastName } = {},
  today,
) {
  const L = EXIT_FORM_LAYOUT;
  const out = { text: [], checks: [], covers: [...L.local.covers], squares: [], rules: [] };
  const put = (place, value, size = TEXT_SIZE) => {
    const text = oneLine(value);
    if (text) out.text.push({ ...place, value: text, size, bold: true });
  };
  put(L.taxYear, taxYear ?? "", 16);
  put(L.date, usDate(today));
  put(L.clientNumber, clientNumber ?? "", 16);
  const name = (first, last) => [first, last].map(oneLine).filter(Boolean).join(" ");
  put(L.taxpayer, [name(firstName, lastName), name(spouseFirstName, spouseLastName)].filter(Boolean).join(" & "));

  const exit = questionnaire?.exitForm ?? {};
  groupMarks(L.groups.federal, exit.federal, out);
  groupMarks(L.groups.state, exit.state, out);
  const T = L.local;
  // Drawn in the downloaded Noto Sans, the nearest match to the form's own type.
  const row = (place, value, size = ROW_SIZE) => out.text.push({ ...place, value, size, embedded: true });
  row({ ...T.label.zh, width: 44 }, "其他稅", T.label.zh.size);
  row({ ...T.label.en, width: 60 }, "Other Tax:", T.label.en.size);
  const entries = new Map((exit.local ?? []).map((entry) => [entry.type, entry]));
  const notes = [];
  LOCAL_TAXES.forEach((type, i) => {
    const y = T.firstBaseline + i * T.pitch;
    const square = (x) => {
      out.squares.push({ x, y: y - T.box + 0.5, width: T.box, height: T.box });
      return { x: x + T.box / 2, y: y - T.box / 2 + 0.5 };
    };
    const typeBox = square(T.typeBox);
    row({ ...T.typeLabel, y }, type);
    row({ ...T.dollar, y }, "$");
    out.rules.push({ from: T.amount.ruleFrom, to: T.amount.ruleTo, y: y + 2 });
    const oweBox = square(T.oweBox);
    row({ ...T.oweLabel, y }, OWE_LABEL);
    const refundBox = square(T.refundBox);
    row({ ...T.refundLabel, y }, REFUND_LABEL);

    const entry = entries.get(type);
    if (!entry) return;
    out.checks.push(typeBox);
    if (entry.result === "owe") out.checks.push(oweBox);
    if (entry.result === "refund") out.checks.push(refundBox);
    if (entry.result !== "none" && entry.amount != null) put({ ...T.amount, y }, money(entry.amount).slice(1), 13);
    const note = localNote(entry);
    if (note) notes.push(note);
  });
  put(L.remarks, [...notes, oneLine(questionnaire?.remarks ?? "")].filter(Boolean).join("; "), 12);

  const ref = String(clientNumber ?? "").replace(/[^A-Za-z0-9-]/g, "");
  out.fileName = `exit-form${ref ? `-${ref}` : ""}.pdf`;
  return out;
}

/** The values exitFormMarks will draw, in the shape draftFontFiles reads. */
export const exitFormFontFields = (marks) => ({
  text: Object.fromEntries(marks.text.map((mark, i) => [String(i), mark.value])),
});

/** Whether any drawn value needs the downloaded CJK fonts. */
export const exitFormNeedsFont = (marks) => marks.text.some((mark) => mark.embedded || needsEmbeddedFont(mark.value));

/**
 * The filled Exit Form's bytes. `fontFiles` (draftFontFiles' result) is
 * needed only when exitFormNeedsFont(marks). A value too wide for its place
 * is drawn smaller, down to 6 pt, and then cut with "…".
 */
export async function buildExitFormPdf({ PDFLib, fontkit, formBytes, fontFiles = [], marks }) {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const doc = await PDFDocument.load(formBytes);
  const page = doc.getPage(0);
  const color = rgb(0, 0, 0);
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fonts = [];
  if (exitFormNeedsFont(marks)) {
    if (!fontFiles.length) throw new Error("The Exit Form needs its font files.");
    doc.registerFontkit(fontkit);
    patchSubsetPadding(fontkit, fontFiles.at(-1));
    for (const bytes of fontFiles) fonts.push(await doc.embedFont(bytes, { subset: true }));
  }
  const fontFor = (ch) =>
    fonts.find((font) => font.getCharacterSet().includes(ch.codePointAt(0))) ?? fonts[0];

  // [text, font] runs: Helvetica for a value it can draw, else per character.
  // Noto has no bold here, so Chinese in a filled value is drawn regular.
  const runsOf = (text, embedded = false, bold = false) => {
    if (!embedded && !needsEmbeddedFont(text)) return [[text, bold ? helveticaBold : helvetica]];
    const runs = [];
    for (const ch of printable(text, fonts)) {
      const font = fontFor(ch);
      if (runs.length && runs.at(-1)[1] === font) runs.at(-1)[0] += ch;
      else runs.push([ch, font]);
    }
    return runs;
  };
  const widthOf = (runs, size) => runs.reduce((sum, [text, font]) => sum + font.widthOfTextAtSize(text, size), 0);

  // White boxes over the parts of the template this fill replaces.
  for (const c of marks.covers ?? [])
    page.drawRectangle({ x: c.x, y: PAGE_HEIGHT - c.y - c.height, width: c.width, height: c.height, color: rgb(1, 1, 1) });
  for (const q of marks.squares ?? [])
    page.drawRectangle({ x: q.x, y: PAGE_HEIGHT - q.y - q.height, width: q.width, height: q.height, borderColor: color, borderWidth: 0.75 });
  for (const r of marks.rules ?? [])
    page.drawLine({ start: { x: r.from, y: PAGE_HEIGHT - r.y }, end: { x: r.to, y: PAGE_HEIGHT - r.y }, thickness: 0.6, color });

  for (const mark of marks.text) {
    let text = mark.value;
    let size = mark.size;
    const fit = (t) => runsOf(t, mark.embedded, mark.bold);
    while (size > MIN_SIZE && widthOf(fit(text), size) > mark.width) size -= 0.5;
    while (text.length > 1 && widthOf(fit(text), size) > mark.width) text = `${[...text].slice(0, -2).join("")}…`;
    const runs = fit(text);
    let x = mark.align === "right" ? mark.x + mark.width - widthOf(runs, size) : mark.x;
    const y = PAGE_HEIGHT - mark.y;
    for (const [run, font] of runs) {
      page.drawText(run, { x, y, size, font, color });
      x += font.widthOfTextAtSize(run, size);
    }
  }
  // A tick as an X inside the box.
  for (const { x, y } of marks.checks) {
    const cy = PAGE_HEIGHT - y;
    const r = 3;
    page.drawLine({ start: { x: x - r, y: cy - r }, end: { x: x + r, y: cy + r }, thickness: 1.3, color });
    page.drawLine({ start: { x: x - r, y: cy + r }, end: { x: x + r, y: cy - r }, thickness: 1.3, color });
  }
  doc.setTitle("Exit Form");
  doc.setAuthor("");
  doc.setProducer("ViTally");
  doc.setCreator("ViTally");
  return doc.save();
}
