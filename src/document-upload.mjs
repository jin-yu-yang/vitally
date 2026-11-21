// External OneDrive upload only. No file bytes or Microsoft credentials enter ViTally.
import { esc, icon } from "./ui.mjs";
import { t } from "./client-text.mjs";

export const uploadUrl = (value) =>
  typeof value === "string" && /^https:\/\/[^\s]+$/i.test(value) ? value : null;

export const uploadReference = (record) =>
  record?.clientNumber != null
    ? `#${String(record.clientNumber).padStart(3, "0")}`
    : record?.reference ?? "";

export function uploadControls({ url, record, lang = "en", sent = false, off = "", action = "" } = {}) {
  const say = (key, values = {}) => esc(t(key, values, lang));
  const link = uploadUrl(url);
  if (!link) return `<p class="doc-note">${say("doc.no_upload_link")}</p>`;
  const reference = uploadReference(record);
  const naming = reference ? `<p class="doc-note">${say("doc.upload_name", { reference })}</p>` : "";
  const open = `<a class="btn secondary" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${icon("upload")} ${say("doc.upload_to_pcdc")}</a>`;
  const confirm = sent ? ""
    : action ? `<button type="button" class="btn secondary" ${action}${off}>${say("doc.upload_confirm")}</button>` : "";
  return `<div class="doc-upload">${open}${confirm}</div>${naming}<p class="doc-note">${say("doc.upload_explained")}</p>`;
}
