const els = {
  tabs: document.getElementById("loginTabs"),
  message: document.getElementById("loginMessage"),
  adminForm: document.getElementById("adminForm"),
  guestForm: document.getElementById("guestForm"),
  adminSubmit: document.getElementById("adminSubmit"),
  guestSubmit: document.getElementById("guestSubmit"),
  lanInfo: document.getElementById("loginLanInfo"),
  updateBanner: document.getElementById("updateBanner"),
  updateBannerMessage: document.getElementById("updateBannerMessage"),
  updateButton: document.getElementById('loginUpdateButton')
};
let updating = false;
const localUpdate = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
els.updateButton.disabled = !localUpdate;
if (!localUpdate) els.updateButton.title = 'กรุณาอัปเดตจากเครื่องที่เปิดโปรแกรม KumonDB';

async function loadLanInfo() {
  try {
    const response = await fetch("/api/server-info");
    const data = await response.json();
    const addresses = data.lanAddresses || [];

    if (!addresses.length) {
      return;
    }

    const urls = addresses.map((address) => `http://${address}:${data.port}`);

    els.lanInfo.innerHTML = `
      <div>เข้าจากเครื่องอื่นในวง LAN เดียวกัน ใช้ address นี้:</div>
      ${urls.map((url) => `<div class="login-lan-url">${url}</div>`).join("")}
    `;
    els.lanInfo.classList.remove("hidden");
  } catch (error) {
    // Non-critical — just skip showing it if the endpoint is unreachable.
  }
}

loadLanInfo();

import('./updateMonitor.js?v=20261023-update-anytime').then(({ startUpdateMonitor }) => {
  startUpdateMonitor((data) => {
    els.updateBannerMessage.textContent = data.preparationRequired ? 'อัปเดตยังไม่เสร็จ ต้องตรวจและเตรียมฐานข้อมูลก่อน' : data.remoteMessage || `commit ${data.remoteCommit}`;
    els.updateBanner.classList.toggle('hidden', data.upToDate);
  }, { isBusy: () => updating });
}).catch(() => {});

function setMessage(text) {
  if (!text) {
    els.message.classList.add("hidden");
    els.message.textContent = "";
    return;
  }

  els.message.textContent = text;
  els.message.classList.remove("hidden");
}

function setTab(tab) {
  if (updating) return;
  setMessage("");

  els.tabs.querySelectorAll(".login-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });

  els.adminForm.classList.toggle("hidden", tab !== "admin");
  els.guestForm.classList.toggle("hidden", tab !== "guest");
}

els.updateButton.addEventListener('click', async () => {
  if (updating || !localUpdate) return;
  try { await updateProgram(); }
  catch (error) { setMessage(error.message); }
});

async function updateProgram() {
  if (!await confirmAction('อัปเดตและรีสตาร์ต KumonDB ใช่ไหม? ระบบจะตรวจฐานข้อมูลและสำรองก่อนปรับส่วนที่ขาด รวมถึงสำรองไฟล์ที่โปรแกรมสร้างก่อนจัดการไฟล์ค้าง กรุณาตรวจว่าไม่มีงานที่ยังไม่บันทึกในโปรแกรมหรือ KSIS')) return;
  updating = true;
  els.updateButton.disabled = els.adminSubmit.disabled = els.guestSubmit.disabled = true;
  try {
    setMessage('กำลังอัปเดตและตรวจฐานข้อมูล หากต้องปรับจะสำรองก่อน กรุณารอ...');
    const { getRuntimeInstanceId, waitForUpdatedServer } = await import('./updateRestart.js?v=20261023-schema-update');
    let previousInstanceId = await getRuntimeInstanceId();
    let recoveredFiles = 0;
    try {
      const data = await requestJson('/api/system/update-apply', { method: 'POST', body: JSON.stringify({ confirm: true }) });
      previousInstanceId = data.previousInstanceId || previousInstanceId;
      recoveredFiles = Array.isArray(data.fileRecovery?.files) ? data.fileRecovery.files.length : 0;
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
    setMessage(`${recoveredFiles ? `สำรองไฟล์สร้างอัตโนมัติแล้ว ${recoveredFiles} ไฟล์ • ` : ''}กำลังรอโปรแกรมเปิดใหม่...`);
    await waitForUpdatedServer(previousInstanceId);
    window.location.reload();
  } finally {
    updating = false;
    els.updateButton.disabled = els.adminSubmit.disabled = els.guestSubmit.disabled = false;
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.success === false) {
    throw new Error(data.error || "เข้าสู่ระบบไม่สำเร็จ");
  }

  return data;
}

function redirectForRole() {
  window.location.href = "/worksheet.html";
}

els.tabs.addEventListener("click", (event) => {
  const button = event.target.closest(".login-tab");

  if (button) {
    setTab(button.dataset.tab);
  }
});

els.adminForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (updating) return;
  setMessage("");
  els.adminSubmit.disabled = true;

  try {
    const formData = new FormData(els.adminForm);
    const data = await requestJson("/api/auth/login/admin", {
      method: "POST",
      body: JSON.stringify({
        username: formData.get("username"),
        password: formData.get("password")
      })
    });

    redirectForRole(data.user.role);
  } catch (error) {
    setMessage(error.message);
    els.adminSubmit.disabled = false;
  }
});

els.guestForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (updating) return;
  setMessage("");
  els.guestSubmit.disabled = true;

  try {
    const formData = new FormData(els.guestForm);
    const data = await requestJson("/api/auth/login/guest", {
      method: "POST",
      body: JSON.stringify({
        displayName: formData.get("displayName"),
        pin: formData.get("pin")
      })
    });

    redirectForRole(data.user.role);
  } catch (error) {
    setMessage(error.message);
    els.guestSubmit.disabled = false;
  }
});
