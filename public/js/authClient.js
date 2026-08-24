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

  bar.innerHTML = `
    <div class="auth-user">
      <span class="auth-role auth-role-${user.role}">${roleLabel}</span>
      <span class="auth-name"></span>
    </div>
    <button type="button" class="auth-logout" id="authLogoutButton">ออกจากระบบ</button>
  `;
  bar.querySelector(".auth-name").textContent = user.displayName;

  document.getElementById("authLogoutButton").addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login.html";
  });
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
