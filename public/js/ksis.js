import { setupKsisDraft } from "./reportKsisDraft.js?v=20261023-ws-recovery";
import { setupKsisMatching } from "./reportKsisMatching.js?v=20261022-workspace";
import { setupKsisAudit } from "./ksisAudit.js?v=20261023-shared";
import { setupKsisDesktop } from "./ksisDesktop.js?v=20261023-unified-app";
import { setupKsisAt } from './ksisAt.js?v=20261023-shared';
import { createKsisSharedWorkspace } from './ksisSharedWorkspace.js?v=20261023-ws-recovery';
import { setupKsisAtAudit } from './ksisAtAudit.js?v=20261023-at-audit';

const get = (id) => document.getElementById(id);
const month = get("reportMonth"), year = get("reportYear");
const months = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
const setStatus = createStatusSetter(get("statusLine"));
setupKsisDesktop({ setStatus });
const locks = new Set();
month.innerHTML = months.map((name, index) => `<option value="${index + 1}">${name}</option>`).join("");
const query = new URLSearchParams(location.search), today = new Date();
month.value = String(Number(query.get("month")) >= 1 && Number(query.get("month")) <= 12 ? Number(query.get("month")) : today.getMonth() + 1);
year.value = String(Number(query.get("year")) >= 2000 && Number(query.get("year")) <= 2600 ? Number(query.get("year")) : today.getFullYear());
const getPeriod = () => ({ month: Number(month.value), year: Number(year.value) });
const periodLabel = () => { get("ksisPeriodLabel").textContent = `${months[Number(month.value) - 1] || ""} ${year.value}`; };
periodLabel();
for (const input of [month, year]) input.addEventListener("change", periodLabel);

function lock(source, active) {
  if (active) locks.add(source); else locks.delete(source);
  month.disabled = year.disabled = locks.size > 0;
  document.querySelectorAll("[data-ksis-tab]").forEach((button) => { button.disabled = locks.size > 0; });
}
function open(view, force = false) {
  if (locks.size && !force) return;
  document.querySelectorAll("[data-ksis-view]").forEach((panel) => panel.classList.toggle("hidden", panel.dataset.ksisView !== view));
  document.querySelectorAll("[data-ksis-tab]").forEach((button) => {
    const selected = button.dataset.ksisTab === view;
    button.setAttribute("aria-selected", String(selected)); button.tabIndex = selected ? 0 : -1;
  });
}
const shared = createKsisSharedWorkspace({ setStatus, applyContext: (state) => {
  const tool = state.tools[state.activeView];
  if (tool?.period?.month >= 1 && tool.period.month <= 12 && Number.isInteger(tool.period.year)) {
    month.value = String(tool.period.month); year.value = String(tool.period.year); periodLabel();
  }
  if (state.activeView) open(state.activeView, true);
  lock('shared', state.busy || state.connection?.pendingDraft === true);
} });
setupKsisDraft({ shared, open: () => open("draft"), setStatus, getPeriod, onStateChange: ({ busy, pending }) => lock("draft", busy || pending) });
setupKsisMatching({ open: () => open("matching"), setStatus, onStateChange: ({ busy }) => lock("matching", busy) });
get("ksisAuditButton").addEventListener("click", () => open("audit"));
get('ksisAtAuditButton').addEventListener('click', () => open('atAudit'));
document.querySelector(".ksis-tabs").addEventListener("keydown", (event) => {
  if (locks.size || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = [...document.querySelectorAll("[data-ksis-tab]")];
  const index = tabs.indexOf(event.target);
  if (index < 0) return;
  const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault(); tabs[next].click(); tabs[next].focus();
});
setupKsisAudit({ shared, setStatus, getPeriod, onStateChange: ({ busy }) => lock("audit", busy) });
setupKsisAt({ shared, open: () => open('at'), setStatus, getPeriod, onStateChange: ({ busy, pending }) => lock('at', busy || pending) });
setupKsisAtAudit({ shared, setStatus, getPeriod, onStateChange: ({ busy }) => lock('atAudit', busy) });
open("draft");
void shared.refresh(true);
