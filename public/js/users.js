const els = {
  createForm: document.getElementById("createForm"),
  createRoleSelect: document.getElementById("createRoleSelect"),
  createSubmit: document.getElementById("createSubmit"),
  createMessage: document.getElementById("createMessage"),
  tableWrap: document.getElementById("usersTableWrap"),
  listSubtitle: document.getElementById("listSubtitle"),
  statusLine: document.getElementById("statusLine"),
  createRoleForm: document.getElementById("createRoleForm"),
  createRoleSubmit: document.getElementById("createRoleSubmit"),
  roleMessage: document.getElementById("roleMessage"),
  matrixWrap: document.getElementById("permissionMatrixWrap")
};

// role_code -> { roleCode, roleName, isSystem, activeUserCount }, in display
// order — kept in state so the account-role <select>s and the permission
// matrix's columns can both be built from one source of truth.
const state = {
  roles: [],
  permissions: [], // permission_master rows, ordered by nav_group/sort_order
  grants: new Map() // role_code -> Set<permission_key>
};

const NAV_GROUP_LABELS = {
  management: "จัดการ",
  warehouse: "คลัง",
  system: "ระบบ (Users/Migration เข้าถึงได้เฉพาะ Admin เสมอ ไม่อยู่ในตารางนี้)"
};

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.success === false) {
    throw new Error(data.error || "เกิดข้อผิดพลาด");
  }

  return data;
}

function setStatus(text, isError = false) {
  els.statusLine.textContent = text;
  els.statusLine.classList.toggle("is-error", isError);
}

function setCreateMessage(text, isSuccess = false) {
  if (!text) {
    els.createMessage.classList.add("hidden");
    return;
  }

  els.createMessage.textContent = text;
  els.createMessage.classList.remove("hidden");
  els.createMessage.classList.toggle("is-success", isSuccess);
}

function setRoleMessage(text, isSuccess = false) {
  if (!text) {
    els.roleMessage.classList.add("hidden");
    return;
  }

  els.roleMessage.textContent = text;
  els.roleMessage.classList.remove("hidden");
  els.roleMessage.classList.toggle("is-success", isSuccess);
}

function formatDate(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  return date.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Roles a real account can be assigned — everything except guest (guest
// isn't a DB account, see services/authService.js).
function assignableRoles() {
  return state.roles.filter((role) => role.role_code !== "guest");
}

// Roles the permission matrix has columns for — same idea, but admin is
// also excluded (it bypasses role_permission entirely and always has
// everything, so there's nothing to toggle for it).
function configurableRoles() {
  return state.roles.filter((role) => role.role_code !== "guest" && role.role_code !== "admin");
}

function populateRoleSelect(select, currentValue) {
  select.innerHTML = assignableRoles().map((role) => `
    <option value="${escapeHtml(role.role_code)}">${escapeHtml(role.role_name)}</option>
  `).join("");

  if (currentValue) {
    select.value = currentValue;
  }
}

async function loadAll() {
  els.tableWrap.innerHTML = `<div class="empty-state">กำลังโหลด...</div>`;
  els.matrixWrap.innerHTML = `<div class="empty-state">กำลังโหลด...</div>`;

  try {
    const [usersData, rolesData] = await Promise.all([
      requestJson("/api/users"),
      requestJson("/api/roles")
    ]);

    state.roles = rolesData.roles;
    state.permissions = rolesData.permissions;
    state.grants = new Map();
    rolesData.grants.forEach((grant) => {
      if (!state.grants.has(grant.role_code)) {
        state.grants.set(grant.role_code, new Set());
      }
      state.grants.get(grant.role_code).add(grant.permission_key);
    });

    populateRoleSelect(els.createRoleSelect);
    renderUsers(usersData.users);
    els.listSubtitle.textContent = `${usersData.users.length} บัญชี`;
    renderPermissionMatrix();
  } catch (error) {
    els.tableWrap.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    els.matrixWrap.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

function roleName(roleCode) {
  return state.roles.find((role) => role.role_code === roleCode)?.role_name || roleCode;
}

function renderUsers(users) {
  if (!users.length) {
    els.tableWrap.innerHTML = `<div class="empty-state">ยังไม่มีบัญชี</div>`;
    return;
  }

  els.tableWrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Username</th>
          <th>ชื่อที่แสดง</th>
          <th>Role</th>
          <th>สถานะ</th>
          <th>Login ล่าสุด</th>
          <th>สร้างเมื่อ</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${users.map((user) => `
          <tr class="${user.is_active ? "" : "is-inactive"}" data-user-id="${user.user_id}">
            <td>${escapeHtml(user.username)}</td>
            <td>${escapeHtml(user.display_name)}</td>
            <td>
              <span class="role-badge ${escapeHtml(user.role)}">${escapeHtml(roleName(user.role))}</span>
            </td>
            <td>
              <span class="status-badge ${user.is_active ? "active" : "inactive"}">
                ${user.is_active ? "Active" : "Inactive"}
              </span>
            </td>
            <td>${formatDate(user.last_login_at)}</td>
            <td>${formatDate(user.created_at)}</td>
            <td>
              <div class="row-actions">
                <select class="role-select" data-action="change-role" aria-label="เปลี่ยน role">
                  ${assignableRoles().map((role) => `
                    <option value="${escapeHtml(role.role_code)}" ${role.role_code === user.role ? "selected" : ""}>
                      ${escapeHtml(role.role_name)}
                    </option>
                  `).join("")}
                </select>
                <button type="button" class="row-action-button" data-action="toggle-active">
                  ${user.is_active ? "ปิดใช้งาน" : "เปิดใช้งาน"}
                </button>
              </div>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  els.tableWrap.querySelectorAll("[data-action=\"toggle-active\"]").forEach((button) => {
    button.addEventListener("click", () => handleToggleActive(button));
  });
  els.tableWrap.querySelectorAll("[data-action=\"change-role\"]").forEach((select) => {
    select.addEventListener("change", () => handleChangeRole(select));
  });
}

async function handleChangeRole(select) {
  const row = select.closest("tr");
  const userId = row.dataset.userId;
  const previousValue = [...select.options].find((option) => option.defaultSelected)?.value;

  select.disabled = true;

  try {
    await requestJson(`/api/users/${userId}/role`, {
      method: "POST",
      body: JSON.stringify({ role: select.value })
    });

    setStatus("บันทึกแล้ว");
    await loadAll();
  } catch (error) {
    setStatus(error.message, true);
    select.disabled = false;

    if (previousValue) {
      select.value = previousValue;
    }
  }
}

async function handleToggleActive(button) {
  const row = button.closest("tr");
  const userId = row.dataset.userId;
  const isCurrentlyActive = !row.classList.contains("is-inactive");

  button.disabled = true;

  try {
    await requestJson(`/api/users/${userId}/active`, {
      method: "POST",
      body: JSON.stringify({ isActive: !isCurrentlyActive })
    });

    setStatus("บันทึกแล้ว");
    await loadAll();
  } catch (error) {
    setStatus(error.message, true);
    button.disabled = false;
  }
}

function renderPermissionMatrix() {
  const roles = configurableRoles();

  if (!roles.length) {
    els.matrixWrap.innerHTML = `<div class="empty-state">ยังไม่มี role ที่ตั้งค่าสิทธิ์ได้ (นอกจาก Admin/Guest)</div>`;
    return;
  }

  const groups = [...new Set(state.permissions.map((permission) => permission.nav_group))];

  els.matrixWrap.innerHTML = `
    <table class="permission-matrix">
      <thead>
        <tr>
          <th>Permission</th>
          ${roles.map((role) => `
            <th>
              <div class="matrix-role-header">
                <span>${escapeHtml(role.role_name)}</span>
                ${role.is_system
                  ? `<span class="matrix-role-note">system</span>`
                  : `
                    <button
                      type="button"
                      class="matrix-delete-role"
                      data-role-code="${escapeHtml(role.role_code)}"
                      title="${role.active_user_count > 0 ? `ลบไม่ได้ — มี ${role.active_user_count} บัญชีใช้ role นี้อยู่` : "ลบ role นี้"}"
                      ${role.active_user_count > 0 ? "disabled" : ""}
                    >🗑️</button>
                  `}
              </div>
            </th>
          `).join("")}
        </tr>
      </thead>
      <tbody>
        ${groups.map((group) => `
          <tr class="matrix-group-row">
            <td colspan="${roles.length + 1}">${escapeHtml(NAV_GROUP_LABELS[group] || group)}</td>
          </tr>
          ${state.permissions.filter((permission) => permission.nav_group === group).map((permission) => `
            <tr>
              <td>${escapeHtml(permission.permission_label)}</td>
              ${roles.map((role) => `
                <td class="matrix-cell">
                  <input
                    type="checkbox"
                    data-role-code="${escapeHtml(role.role_code)}"
                    data-permission-key="${escapeHtml(permission.permission_key)}"
                    ${state.grants.get(role.role_code)?.has(permission.permission_key) ? "checked" : ""}
                  >
                </td>
              `).join("")}
            </tr>
          `).join("")}
        `).join("")}
      </tbody>
    </table>
  `;

  els.matrixWrap.querySelectorAll("input[type=\"checkbox\"]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => handlePermissionToggle(checkbox));
  });
  els.matrixWrap.querySelectorAll(".matrix-delete-role").forEach((button) => {
    button.addEventListener("click", () => handleDeleteRole(button));
  });
}

async function handlePermissionToggle(checkbox) {
  const roleCode = checkbox.dataset.roleCode;
  const permissionKey = checkbox.dataset.permissionKey;
  const currentGrants = state.grants.get(roleCode) || new Set();
  const nextGrants = new Set(currentGrants);

  if (checkbox.checked) {
    nextGrants.add(permissionKey);
  } else {
    nextGrants.delete(permissionKey);
  }

  checkbox.disabled = true;

  try {
    await requestJson(`/api/roles/${encodeURIComponent(roleCode)}/permissions`, {
      method: "PUT",
      body: JSON.stringify({ permissionKeys: [...nextGrants] })
    });

    state.grants.set(roleCode, nextGrants);
    setStatus(`อัพเดทสิทธิ์ ${roleName(roleCode)} แล้ว`);
  } catch (error) {
    checkbox.checked = !checkbox.checked; // revert
    setStatus(error.message, true);
  } finally {
    checkbox.disabled = false;
  }
}

async function handleDeleteRole(button) {
  const roleCode = button.dataset.roleCode;

  if (!window.confirm(`ลบ role "${roleName(roleCode)}" ใช่ไหม?`)) {
    return;
  }

  button.disabled = true;

  try {
    await requestJson(`/api/roles/${encodeURIComponent(roleCode)}`, { method: "DELETE" });
    setStatus(`ลบ role "${roleName(roleCode)}" แล้ว`);
    await loadAll();
  } catch (error) {
    setStatus(error.message, true);
    button.disabled = false;
  }
}

els.createForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setCreateMessage("");
  els.createSubmit.disabled = true;

  try {
    const formData = new FormData(els.createForm);
    await requestJson("/api/users", {
      method: "POST",
      body: JSON.stringify({
        username: formData.get("username"),
        password: formData.get("password"),
        displayName: formData.get("displayName"),
        role: formData.get("role")
      })
    });

    setCreateMessage("บันทึกบัญชีแล้ว", true);
    els.createForm.reset();
    await loadAll();
  } catch (error) {
    setCreateMessage(error.message);
  } finally {
    els.createSubmit.disabled = false;
  }
});

els.createRoleForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setRoleMessage("");
  els.createRoleSubmit.disabled = true;

  try {
    const formData = new FormData(els.createRoleForm);
    await requestJson("/api/roles", {
      method: "POST",
      body: JSON.stringify({
        roleCode: formData.get("roleCode"),
        roleName: formData.get("roleName")
      })
    });

    setRoleMessage("เพิ่ม role แล้ว", true);
    els.createRoleForm.reset();
    await loadAll();
  } catch (error) {
    setRoleMessage(error.message);
  } finally {
    els.createRoleSubmit.disabled = false;
  }
});

loadAll();
