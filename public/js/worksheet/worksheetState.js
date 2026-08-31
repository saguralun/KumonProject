// Shared els/state singletons for the WS Input page. Every other module in
// this folder imports these two from here instead of each holding its own
// copy — ES modules cache a module's exports, so every importer gets the
// exact same els/state object references, which is what keeps a change
// made in one file (e.g. worksheetSearch.js setting state.context) visible
// to every other file (e.g. worksheetPreview.js reading it), exactly like
// when everything lived in one file.
export const els = {
    subjectButtons: document.getElementById("subjectButtons"),
    searchMode: document.getElementById("searchMode"),
    studentSearch: document.getElementById("studentSearch"),
    searchResults: document.getElementById("searchResults"),
    statusLine: document.getElementById("statusLine"),
    studentStrip: document.getElementById("studentStrip"),
    studentName: document.getElementById("studentName"),
    studentMeta: document.getElementById("studentMeta"),
    studentSubjectSelect: document.getElementById("studentSubjectSelect"),
    receiveDate: document.getElementById("receiveDate"),
    receiveWeekday: document.getElementById("receiveWeekday"),
    datePrev: document.getElementById("datePrev"),
    dateNext: document.getElementById("dateNext"),
    patternButtons: document.getElementById("patternButtons"),
    worksheetProgressRing: document.getElementById("worksheetProgressRing"),
    worksheetProgressTabs: document.getElementById("worksheetProgressTabs"),
    worksheetProgressLevel: document.getElementById("worksheetProgressLevel"),
    worksheetProgressValue: document.getElementById("worksheetProgressValue"),
    worksheetProgressCaption: document.getElementById("worksheetProgressCaption"),
    gradeSyncBadge: document.getElementById("gradeSyncBadge"),
    worksheetInputs: document.getElementById("worksheetInputs"),
    previewCount: document.getElementById("previewCount"),
    previewList: document.getElementById("previewList"),
    saveButton: document.getElementById("saveButton"),
    completeWsLevel: document.getElementById("completeWsLevel"),
    completeZunLevel: document.getElementById("completeZunLevel"),
    receiveCd: document.getElementById("receiveCd"),
    findIncompleteWs: document.getElementById("findIncompleteWs"),
    historyLimit: document.getElementById("historyLimit"),
    historySubtitle: document.getElementById("historySubtitle"),
    historyMonthSummary: document.getElementById("historyMonthSummary"),
    worksheetPacketSummary: document.getElementById("worksheetPacketSummary"),
    historyTableWrap: document.getElementById("historyTableWrap"),
    atModal: document.getElementById("atModal"),
    atForm: document.getElementById("atForm"),
    atModalTitle: document.getElementById("atModalTitle"),
    atModalSubtitle: document.getElementById("atModalSubtitle"),
    atCancel: document.getElementById("atCancel"),
    atEnrollmentId: document.getElementById("atEnrollmentId"),
    atSubject: document.getElementById("atSubject"),
    atLevel: document.getElementById("atLevel"),
    atDate: document.getElementById("atDate"),
    atScore: document.getElementById("atScore"),
    atMaxScore: document.getElementById("atMaxScore"),
    atTime: document.getElementById("atTime"),
    atMaxTime: document.getElementById("atMaxTime"),
    atGroup: document.getElementById("atGroup"),
    atPassControl: document.getElementById("atPassControl"),
    atEditLatest: document.getElementById("atEditLatest"),
    atSaveButton: document.getElementById("atSaveButton"),
    incompleteWsModal: document.getElementById("incompleteWsModal"),
    incompleteWsClose: document.getElementById("incompleteWsClose"),
    incompleteWsSubtitle: document.getElementById("incompleteWsSubtitle"),
    incompleteWsTableWrap: document.getElementById("incompleteWsTableWrap")
};

export const state = {
    subjectFilter: "ALL",
    searchMode: "id",
    searchResults: [],
    activeResultIndex: -1,
    searchRequestId: 0,
    searchTimer: null,
    // The page auto-focuses the search box on load for convenience, but
    // that shouldn't pop the results dropdown open before the user has
    // actually typed or clicked anything — skip just that one search.
    suppressInitialSearch: false,
    // True once the box shows a confirmed "#id ชื่อ" selection rather than
    // a query the user is actively typing — lets focus tell those apart.
    hasConfirmedSelection: false,
    context: null,
    history: [],
    worksheetPacketSummary: null,
    worksheetMonthSummary: null,
    patterns: [],
    patternCode: "daily10",
    progressKind: "main",
    isSaving: false,
    isCompletingLevel: false,
    isCompletingZun: false,
    atModal: {
        editingAtUsedId: null,
        isPass: true,
        source: null
    }
};

export function setStatus(message, type = "neutral") {
    els.statusLine.textContent = message;
    els.statusLine.classList.toggle("is-error", type === "error");
    els.statusLine.classList.toggle("is-success", type === "success");
}
