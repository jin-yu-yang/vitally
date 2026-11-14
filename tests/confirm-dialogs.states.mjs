// The states the golden confirmation test renders. Shared by the one-time
// capture (plan Task 1) and tests/confirm-dialogs.test.mjs, so both render
// exactly the same inputs. Fictional references only.

export const STATES = Object.freeze({
  closeIdle: ["closeCaseDialogBody", { savedCase: { reference: "VT-TEST-0001" } }],
  closeBusy: ["closeCaseDialogBody", { savedCase: { reference: "VT-TEST-0001" }, busy: true }],
  readyToEfile: [
    "markReadyToEfileDialogBody",
    {
      savedCase: {
        reference: "VT-TEST-0002",
        answers: { tp_first_name: "Mei", tp_last_name: "Chen" },
      },
    },
  ],
  efiledNameless: ["markEfiledDialogBody", { savedCase: { reference: "VT-TEST-0003", answers: {} } }],
  recordFilingResult: [
    "recordFilingResultDialogBody",
    {
      savedCase: {
        reference: "VT-TEST-0004",
        stage: "efiled",
        federalMethod: "efile",
        stateMethod: "efile",
        answers: { tp_first_name: "Mei", tp_last_name: "Chen" },
      },
    },
  ],
  returnToSigning: [
    "returnToSigningDialogBody",
    {
      savedCase: {
        reference: "VT-TEST-0005",
        answers: { tp_first_name: "Mei", tp_last_name: "Chen" },
      },
    },
  ],
  requestDocuments: [
    "requestDocumentsDialogBody",
    {
      savedCase: {
        reference: "VT-TEST-0006",
        answers: { tp_first_name: "Mei", tp_last_name: "Chen" },
      },
    },
  ],
  putOnHold: [
    "putOnHoldDialogBody",
    {
      savedCase: {
        reference: "VT-TEST-0007",
        answers: { tp_first_name: "Mei", tp_last_name: "Chen" },
      },
    },
  ],
  resumeFromHold: [
    "resumeFromHoldDialogBody",
    {
      savedCase: {
        reference: "VT-TEST-0008",
        answers: { tp_first_name: "Mei", tp_last_name: "Chen" },
      },
    },
  ],
  corrections: ["correctionsDialogBody", {}],
  correctionsRetry: [
    "correctionsDialogBody",
    { error: { code: "CONFLICT", message: "This case changed." }, retryable: true },
  ],
  correctionsRefused: [
    "correctionsDialogBody",
    { error: { code: "FORBIDDEN", message: "Not allowed." }, retryable: false },
  ],
  regenerateEn: ["dialog", { dialog: "regenerate" }],
  regenerateZh: ["dialog", { dialog: "regenerate", lang: "zh-Hans" }],
  leaveAddCase: ["dialog", { dialog: "leave-add-case", dialogContext: { to: "open-board" } }],
  // Posted updates (change add-posted-updates): new confirmations, captured
  // from the code that added them. The title carries HTML and quotes.
  unpublishUpdate: [
    "dialog",
    {
      dialog: "unpublish-update",
      dialogContext: { updateId: "r-1" },
      postedUpdates: [{ id: "r-1", status: "posted", title: 'Office <closed> & "early"', revision: 2 }],
    },
  ],
  deleteUpdate: [
    "dialog",
    {
      dialog: "delete-update",
      dialogContext: { updateId: "r-2" },
      postedUpdates: [{ id: "r-2", status: "draft", title: 'Office <closed> & "early"', revision: 1 }],
    },
  ],
});
