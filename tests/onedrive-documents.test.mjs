import test from "node:test";
import assert from "node:assert/strict";
import { uploadControls, uploadUrl, uploadReference } from "../src/document-upload.mjs";
import { docCard } from "../src/intake-views.mjs";
import { cardsFor } from "../src/document-cards.mjs";
import { makeSampleAnswers } from "../src/sample-data.mjs";
import { progressScreen } from "../src/client-views.mjs";
import { documentChecklist } from "../src/staff-views.mjs";

const record = { reference: "VT-GJPY-JAY9", clientNumber: null };
const link = "https://example.org/upload?x=1&y=2";
const card = cardsFor(makeSampleAnswers(), []).find(c => c.slotId === "w2.household");

test("uploads open only an HTTPS OneDrive link in a protected new tab", () => {
  assert.equal(uploadUrl("javascript:alert(1)"), null);
  assert.equal(uploadUrl("http://example.com/"), null);
  assert.equal(uploadUrl("https://test.example/a b"), null);
  const html = uploadControls({ url: link, record, action: 'data-action="mark-card"' });
  assert.match(html, /href="https:\/\/example.org\/upload\?x=1&amp;y=2"/);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /VT-GJPY-JAY9 W-2/);
  assert.match(html, /I&#39;ve uploaded it/);
  assert.doesNotMatch(html, /<input[^>]*type="file"/);
});

test("without an upload link, neither upload link nor confirmation is shown", () => {
  const html = uploadControls({ url: null, record, action: 'data-action="mark-card"' });
  assert.match(html, /bring the document to the PCDC office/);
  assert.doesNotMatch(html, /<a |<button /);
  const cardHtml = docCard(card, { uploadLink: null, record });
  assert.doesNotMatch(cardHtml, /data-status="sent"|Upload to PCDC/);
});

test("document cards record sent separately from received and verified", () => {
  for (const status of ["sent", "received", "verified"]) {
    const row = cardsFor(makeSampleAnswers(), [{ slotId: card.slotId, status }]).find(c => c.slotId === card.slotId);
    assert.equal(row.status, status);
    const html = docCard(row, { uploadLink: link, record });
    assert.match(html, new RegExp(`is-${status}`));
    assert.doesNotMatch(html, /data-status="sent"/);
  }
  const notDone = docCard(card, { uploadLink: link, record });
  assert.match(notDone, /data-status="sent"/);
});

test("progress request confirmation requires a configured URL", () => {
  const state = { savedCase: { ...record, id: "case-a", stage: "preparing", answers: {},
    requests: [{ id: "request-1", title: "W-2", message: "Send it", status: "open" }],
    documents: [], history: [] }, openPanels: [], busy: false };
  const absent = progressScreen(state);
  assert.doesNotMatch(absent, /data-case-action="RESPOND_DOCUMENT"/);
  const available = progressScreen({ ...state, clientDocumentsUrl: link });
  assert.match(available, /data-case-action="RESPOND_DOCUMENT"/);
  assert.doesNotMatch(available, /demo-mileage-record|Simulate an upload failure/);
});

test("the file-name hint uses the case reference, never the season's client number", () => {
  assert.equal(uploadReference(record), "VT-GJPY-JAY9");
  assert.equal(uploadReference({ ...record, clientNumber: 47 }), "VT-GJPY-JAY9");
  assert.equal(uploadReference({ clientNumber: 47 }), "");
});

test("a client can take back an upload they reported, until staff confirm it", () => {
  const at = (status) =>
    docCard(cardsFor(makeSampleAnswers(), [{ slotId: card.slotId, status }]).find((c) => c.slotId === card.slotId), {
      uploadLink: link,
      record,
    });
  const sent = at("sent");
  for (const status of ["later", "none", "not_done"]) assert.match(sent, new RegExp(`data-status="${status}"`));
  for (const status of ["received", "verified"]) {
    const html = at(status);
    for (const value of ["later", "none", "not_done", "sent"])
      assert.doesNotMatch(html, new RegExp(`data-status="${value}"`), `${status} offers ${value}`);
  }
});

test("staff can undo a mark one step, and get no upload-folder link", () => {
  const checklist = (status) =>
    documentChecklist(
      { answers: makeSampleAnswers(), documentCards: [{ slotId: card.slotId, status, changedAt: "2026-02-12T15:00:00Z", reportedAt: "2026-02-10T15:00:00Z" }] },
      { markDocumentCard: { allowed: true } },
      { clientDocumentsUrl: link },
    );
  const row = (status) => {
    const html = checklist(status);
    const start = html.indexOf(`data-slot="${card.slotId}"`);
    return html.slice(start, html.indexOf("</article>", start));
  };
  assert.match(row("sent"), /data-status="received"[^>]*>Mark received/);
  assert.match(row("received"), /data-status="sent"[^>]*>Undo received/);
  assert.match(row("received"), /data-status="verified"[^>]*>Mark verified/);
  assert.match(row("verified"), /data-status="received"[^>]*>Undo verified/);
  assert.doesNotMatch(row("verified"), /Mark verified/);
  // The note dates the client's report, not the last mark (Feb 12).
  for (const status of ["sent", "received", "verified"]) assert.match(row(status), /Client reported it Feb 10/);
  const unreported = documentChecklist(
    { answers: makeSampleAnswers(), documentCards: [{ slotId: card.slotId, status: "received", changedAt: "2026-02-12T15:00:00Z", reportedAt: null }] },
    { markDocumentCard: { allowed: true } },
  );
  assert.doesNotMatch(unreported, /Client reported it/);
  for (const status of ["sent", "received", "verified"]) {
    const html = checklist(status);
    assert.doesNotMatch(html, /Open upload folder/);
    assert.doesNotMatch(html, /example\.org\/upload/);
  }
});
