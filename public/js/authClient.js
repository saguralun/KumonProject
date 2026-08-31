// Shared across worksheet.html / student-manager.html / index.html.
// Renders the current user + a logout button into #authBar (if present),
// hides any element marked data-admin-only when the session is a guest,
// and bounces to the login page if the session has expired mid-visit.

async function loadSession() {
  const response = await fetch("/api/auth/me");
  const data = await response.json().catch(() => ({}));
  return data.user || null;
}

function applyRoleVisibility(role) {
  // Driven purely by CSS ([data-role="admin"] [data-admin-only] / [data-staff-up]
  // { display: revert } in each stylesheet) rather than toggling .hidden
  // directly — the page's own JS also toggles .hidden on some of these same
  // elements based on business state (e.g. show Delete only once a student
  // has no enrollments), and that logic runs after this and knows nothing
  // about roles. Fighting over the same class would let a later re-render
  // un-hide a restricted control; a separate CSS layer can't be overridden
  // that way.
  document.documentElement.dataset.role = role;
}

function renderAuthBar(user) {
  const bar = document.getElementById("authBar");

  if (!bar) {
    return;
  }

  const roleLabels = { admin: "Admin", staff: "Staff", guest: "Guest" };
  const roleLabel = roleLabels[user.role] || user.role;
  // Guest accounts are for daily front-desk tasks only — an update restarts
  // the server for the whole LAN, so keep that button out of their reach
  // entirely rather than fighting the data-staff-up/.hidden cascade over it.
  const updateButtonHtml = user.role === "guest"
    ? ""
    : `<button type="button" class="auth-update-button hidden" id="authUpdateButton">🔄 อัพเดท</button>`;

  bar.innerHTML = `
    <div class="auth-user">
      <span class="auth-role auth-role-${user.role}">${roleLabel}</span>
      <span class="auth-name"></span>
      ${updateButtonHtml}
    </div>
    <button type="button" class="auth-logout" id="authLogoutButton">ออกจากระบบ</button>
  `;
  bar.querySelector(".auth-name").textContent = user.displayName;

  document.getElementById("authLogoutButton").addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login.html";
  });

  bindUpdateButton();
}

// Same idea as the update banner on the login page, but reachable from every
// page a staff/admin is already working on — no need to log out first just
// to notice and pull an update.
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

  window.location.reload();
}

function bindUpdateButton() {
  const button = document.getElementById("authUpdateButton");

  if (!button) {
    return;
  }

  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "⏳ กำลังอัพเดท...";

    try {
      const response = await fetch("/api/system/update-apply", { method: "POST" });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.success === false) {
        throw new Error(data.error || "อัพเดทไม่สำเร็จ");
      }
    } catch (error) {
      // `git pull` changes files, so nodemon often restarts the server before
      // the HTTP response makes it back — fetch then rejects with a
      // TypeError ("Failed to fetch") even though the update itself already
      // ran. Treat that as "restarting" and wait for it to come back. A
      // genuine refusal (wrong branch, uncommitted changes, git pull
      // failed) arrives as a proper HTTP error with a message instead.
      if (!(error instanceof TypeError)) {
        alert(error.message);
        button.disabled = false;
        button.textContent = "🔄 อัพเดท";
        return;
      }
    }

    button.textContent = "สำเร็จ";
    await waitForServerAndReload();
  });

  checkForUpdateAndShowButton(button);
}

async function checkForUpdateAndShowButton(button) {
  try {
    const response = await fetch("/api/system/update-check");
    const data = await response.json().catch(() => ({}));

    if (data.checked && !data.upToDate) {
      button.title = data.remoteMessage || `commit ${data.remoteCommit}`;
      button.classList.remove("hidden");
    }
  } catch (error) {
    // Non-critical — just skip showing it if the endpoint is unreachable.
  }
}

(async function initAuth() {
  const user = await loadSession();

  if (!user) {
    window.location.href = "/login.html";
    return;
  }

  applyRoleVisibility(user.role);
  renderAuthBar(user);
})();
