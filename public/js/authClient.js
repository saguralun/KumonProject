// Shared across every page. Renders the current user + a logout button into
// #authBar (if present), gates nav links by role (hardcoded data-admin-only
// items) and by the configurable role-permission system (data-requires-
// permission items — see role_master/permission_master/role_permission in
// database/001_create_master_tables.sql and database/002_insert_master_data.sql,
// plus the Users page's role editor), and bounces to the login page if the
// session has expired mid-visit.

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

// Runs after the two functions above so every link's final CSS-driven
// display is already settled. A role with none of a flyout's items granted
// (e.g. a custom role with no page:tables/page:opening-schedule, so every
// item under "ระบบ" is hidden) still had that flyout's trigger button show
// — hovering it opened a visibly empty dropdown with nothing inside. Rather
// than re-deriving which of data-admin-only/data-staff-up/data-requires-
// permission hid a given link, just check the one thing that actually
// matters: did it end up rendered at all. Checks computed style, not a
// specific class, so it stays correct regardless of which mechanism (or a
// future one) hid the items.
function hideEmptyFlyouts() {
  document.querySelectorAll(".nav-flyout").forEach((flyout) => {
    const links = flyout.querySelectorAll(".nav-flyout-menu .home-link");
    const hasVisibleLink = [...links].some((link) => getComputedStyle(link).display !== "none");

    flyout.classList.toggle("nav-flyout-empty", !hasVisibleLink);
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

function showUpdateComplete(button, message) {
  button.textContent = "✅ กำลังเปิดใหม่";
  button.title = "โปรแกรมจะ restart อัตโนมัติ";
  alert(message || "อัพเดทสำเร็จแล้ว โปรแกรมจะ restart อัตโนมัติในอีกสักครู่");
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

      showUpdateComplete(button, data.message);
      return;
    } catch (error) {
      // The currently running copy on older installs may still restart while
      // applying this update, cutting the response before it reaches the
      // browser. Treat that fetch drop as "probably updated; restart the app"
      // instead of sending the user into a reload loop.
      if (!(error instanceof TypeError)) {
        alert(error.message);
        button.disabled = false;
        button.textContent = "🔄 อัพเดท";
        return;
      }
    }

    showUpdateComplete(
      button,
      "การเชื่อมต่อหลุดระหว่างอัพเดท ซึ่งมักเกิดตอนโปรแกรมกำลัง restart ถ้าโปรแกรมไม่เปิดกลับมาเองในสักครู่ ค่อยปิดแล้วเปิดใหม่"
    );
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
  hideEmptyFlyouts();
  renderAuthBar(user);
})();
