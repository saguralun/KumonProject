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
  updateBannerButton: document.getElementById("updateBannerButton")
};

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

// Waits for the server to come back after a git pull (nodemon restarts it
// automatically once files change) before reloading, instead of reloading
// immediately into a brief window where it's still down.
async function waitForServerAndReload() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));

    try {
      const response = await fetch("/api/auth/me");

      if (response.ok) {
        window.location.reload();
        return;
      }
    } catch (error) {
      // Server mid-restart — keep polling.
    }
  }

  // Gave up waiting — reload anyway, the update itself already succeeded.
  window.location.reload();
}

async function checkUpdateStatus() {
  try {
    const response = await fetch("/api/system/update-check");
    const data = await response.json();

    if (!data.checked || data.upToDate) {
      return;
    }

    els.updateBannerMessage.textContent = data.remoteMessage || `commit ${data.remoteCommit}`;
    els.updateBanner.classList.remove("hidden");
  } catch (error) {
    // Non-critical — just skip showing it if the endpoint is unreachable.
  }
}

checkUpdateStatus();

els.updateBannerButton.addEventListener("click", async () => {
  els.updateBannerButton.disabled = true;
  els.updateBannerButton.textContent = "กำลังอัพเดท...";

  try {
    await requestJson("/api/system/update-apply", { method: "POST" });
    els.updateBannerButton.textContent = "สำเร็จ กำลังโหลด...";
    await waitForServerAndReload();
  } catch (error) {
    els.updateBannerMessage.textContent = error.message;
    els.updateBannerButton.disabled = false;
    els.updateBannerButton.textContent = "อัพเดทตอนนี้";
  }
});

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
  setMessage("");

  els.tabs.querySelectorAll(".login-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });

  els.adminForm.classList.toggle("hidden", tab !== "admin");
  els.guestForm.classList.toggle("hidden", tab !== "guest");
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

function redirectForRole(role) {
  window.location.href = role === "admin" ? "/" : "/worksheet.html";
}

els.tabs.addEventListener("click", (event) => {
  const button = event.target.closest(".login-tab");

  if (button) {
    setTab(button.dataset.tab);
  }
});

els.adminForm.addEventListener("submit", async (event) => {
  event.preventDefault();
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
