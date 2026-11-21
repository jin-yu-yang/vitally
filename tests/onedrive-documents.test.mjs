import test from "node:test";
import assert from "node:assert/strict";
import { uploadControls, uploadUrl, uploadReference } from "../src/document-upload.mjs";
import { docCard } from "../src/intake-views.mjs";
import { cardsFor } from "../src/document-cards.mjs";
import { makeSampleAnswers } from "../src/sample-data.mjs";
import { progressScreen } from "../src/client-views.mjs";

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

test("reference naming uses the client number when available, draft ID otherwise", () => {
  assert.equal(uploadReference(record), "VT-GJPY-JAY9");
  assert.equal(uploadReference({ ...record, clientNumber: 47 }), "#047");
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
