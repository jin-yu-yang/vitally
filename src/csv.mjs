// Shared CSV encoder (design D7). #256 reuses it, so spreadsheet guarding and quoting
// live in one place.
//
// Each cell is guarded against spreadsheet formula injection first (a leading = + - @
// tab or CR gets a ' prefix, phone numbers included), then quoted when it holds a
// quote, comma, CR or LF. The file starts with a UTF-8 BOM so Excel reads it as UTF-8
// and ends every line with CR LF.

const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

function encodeCell(value) {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  if (NEEDS_QUOTES.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(header, rows) {
  const lines = [header, ...rows].map((row) => row.map(encodeCell).join(","));
  return `﻿${lines.map((line) => `${line}\r\n`).join("")}`;
}
