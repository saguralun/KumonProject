// Shared across every page. Renders the current user + a logout button into
// #authBar (if present), gates nav links by role (hardcoded data-admin-only
// items) and by the configurable role-permission system (data-requires-
// permission items — see database/004_add_roles_permissions.sql and the
// Users page's role editor), and bounces to the login page if the session
// has expired mid-visit.

async function loadSession() {
  const response = await fetch("/api/auth/me");
  const data = await response.json().catch(() => ({}));

  return { user: data.user || null, permissions: data.permissions || [] };
}

function applyRoleVisibility(role) {
  // Driven purely by CSS ([data-role="admin"] [data-admin-only]
  // { display: revert } in each stylesheet) rather than toggling .hidden
  // directly — the page's own JS also toggles .hidden on some of these same
  // elements based on business state (e.g. show Delete only once a student
  // has no enrollments), and that logic runs after this and knows nothing
  // about roles. Fighting over the same class would let a later re-render
  // un-hide a restricted control; a separate CSS layer can't be overridden
  // that way. data-admin-only is deliberately still hardcoded to role=admin
  // this way (never driven by the permission table below) — see the note on
  // the Users/Migration page routes in server.js.
  document.documentElement.dataset.role = role;
}

// The configurable half: every [data-requires-permission="page:xxx"] link
// gets a matching .is-granted class iff that key is in the signed-in role's
// grant set (app-scale.css hides anything with the attribute but not the
// class). admin gets the "*" sentinel from /api/auth/me instead of the app
// enumerating every key for it — see routes/authRoutes.js.
function applyPermissionVisibility(permissions) {
  const granted = new Set(permissions || []);
  const grantsEverything = granted.has("*");

  document.querySelectorAll("[data-requires-permission]").forEach((el) => {
    const key = el.dataset.requiresPermission;

    el.classList.toggle("is-granted", grantsEverything || granted.has(key));
  });
}

function renderAuthBar(user) {
  const bar = document.getElementById("authBar");

  if (!bar) {
    return;
  }

  // Roles beyond these three are admin-defined (see the Users page's role
  // editor) — fall back to the raw role code for those instead of needing a
  // CSS/JS edit every time someone adds one.
  const roleLabels = { admin: "Admin", instructor: "Instructor", staff: "Staff", guest: "Guest" };
  const roleLabel = roleLabels[user.role] || user.role;
  // Guest accounts are for daily front-desk tasks only — an update restarts
  // the server for the whole LAN, so keep that button out of their reach
  // entirely rather than rendering then hiding it.
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
  const { user, permissions } = await loadSession();

  if (!user) {
    window.location.href = "/login.html";
    return;
  }

  applyRoleVisibility(user.role);
  applyPermissionVisibility(permissions);
  renderAuthBar(user);
})();
