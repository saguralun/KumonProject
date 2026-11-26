const requestApi = (url, options) => requestJson(url, options, "เกิดข้อผิดพลาด");
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
  matrixWrap: document.getElementById("permissionMatrixWrap"),
  resetDialog: document.getElementById('resetPasswordDialog'),
  resetForm: document.getElementById('resetPasswordForm'),
  resetUsername: document.getElementById('resetPasswordUsername'),
  resetValue: document.getElementById('resetPasswordValue'),
  resetSubmit: document.getElementById('resetPasswordSubmit'),
  resetCancel: document.getElementById('resetPasswordCancel'),
  resetMessage: document.getElementById('resetPasswordMessage')
};
const setStatus = createStatusSetter(els.statusLine);

// role_code -> { roleCode, roleName, isSystem, activeUserCount }, in display
// order — kept in state so the account-role <select>s and the permission
// matrix's columns can both be built from one source of truth.
const state = {
  users: [],
  roles: [],
  permissions: [], // permission_master rows, ordered by nav_group/sort_order
  grants: new Map() // role_code -> Set<permission_key>
};
const savingPermissionRoles = new Set();
const permissionRevisions = new Map();
let usersLoadRequest = 0;
let resetTarget = null, resettingPassword = false;

const NAV_GROUP_LABELS = {
  management: "จัดการ",
  warehouse: "คลัง",
  system: "ระบบ (Users/Migration เข้าถึงได้เฉพาะ Admin เสมอ ไม่อยู่ในตารางนี้)"
};

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
  const requestId = ++usersLoadRequest;
  const revisions = new Map(permissionRevisions);
  const pendingRoles = new Set(savingPermissionRoles);
  els.tableWrap.innerHTML = `<div class="empty-state">กำลังโหลด...</div>`;
  els.matrixWrap.innerHTML = `<div class="empty-state">กำลังโหลด...</div>`;

  try {
    const [usersData, rolesData] = await Promise.all([
      requestApi("/api/users"),
      requestApi("/api/roles")
    ]);
    if (requestId !== usersLoadRequest) return;

    state.roles = rolesData.roles;
    state.users = usersData.users;
    state.permissions = rolesData.permissions;
    const grants = new Map();
    rolesData.grants.forEach((grant) => {
      if (!grants.has(grant.role_code)) {
        grants.set(grant.role_code, new Set());
      }
      grants.get(grant.role_code).add(grant.permission_key);
    });
    for (const role of state.roles) {
      const code = role.role_code;
      if (pendingRoles.has(code) || savingPermissionRoles.has(code) || revisions.get(code) !== permissionRevisions.get(code)) {
        grants.set(code, new Set(state.grants.get(code) || []));
      }
    }
    state.grants = grants;

    populateRoleSelect(els.createRoleSelect, els.createRoleSelect.value);
    renderUsers(usersData.users);
    els.listSubtitle.textContent = `${usersData.users.length} บัญชี`;
    renderPermissionMatrix();
    return true;
  } catch (error) {
    if (requestId !== usersLoadRequest) return;
    els.tableWrap.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    els.matrixWrap.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    return false;
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
                <button type="button" class="row-action-button" data-action="reset-password" data-username="${escapeHtml(user.username)}">รีเซ็ตรหัสผ่าน</button>
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
  els.tableWrap.querySelectorAll('[data-action="reset-password"]').forEach(button => button.addEventListener('click', () => {
    if (resettingPassword) return;
    resetTarget = { userId: button.closest('tr').dataset.userId, username: button.dataset.username };
    els.resetForm.reset(); els.resetUsername.value = resetTarget.username;
    els.resetMessage.textContent = ''; els.resetMessage.classList.add('hidden');
    els.resetDialog.showModal(); els.resetValue.focus();
  }));
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
    await requestApi(`/api/users/${userId}/role`, {
      method: "POST",
      body: JSON.stringify({ role: select.value })
    });

    setStatus("บันทึกแล้ว");
    await loadAll();
  } catch (error) {
    setStatus(error.message, "error");
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
    await requestApi(`/api/users/${userId}/active`, {
      method: "POST",
      body: JSON.stringify({ isActive: !isCurrentlyActive })
    });

    setStatus("บันทึกแล้ว");
    await loadAll();
  } catch (error) {
    setStatus(error.message, "error");
    button.disabled = false;
  }
}

function roleUsage(role) {
  const accounts = state.users.filter(user => user.role === role.role_code);
  const validCount = value => value !== null && value !== undefined && value !== '' && Number.isSafeInteger(Number(value)) && Number(value) >= 0;
  const active = validCount(role.active_user_count) ? Number(role.active_user_count) : accounts.filter(user => user.is_active).length;
  const total = validCount(role.total_user_count) ? Number(role.total_user_count) : Math.max(active, accounts.length);
  const inactive = validCount(role.inactive_user_count) ? Number(role.inactive_user_count) : Math.max(0, total - active);
  return { active, inactive, total };
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
          ${roles.map((role) => {
            const usage = roleUsage(role);
            return `
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
                      title="${usage.total > 0 ? `ลบไม่ได้ — ใช้งาน ${usage.active} / ปิดใช้งาน ${usage.inactive} บัญชี ต้องเปลี่ยน role ของทุกบัญชีก่อน` : "ลบ role นี้ (ไม่มีบัญชีใช้งาน)"}"
                      ${usage.total > 0 ? "disabled" : ""}
                    >🗑️</button>
                  `}
              </div>
              <div class="matrix-role-usage">ใช้งาน ${usage.active} / ปิดใช้งาน ${usage.inactive}</div>
            </th>
          `; }).join("")}
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
                    ${savingPermissionRoles.has(role.role_code) ? 'disabled' : ''}
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
  if (savingPermissionRoles.has(roleCode)) { checkbox.checked = currentGrants.has(permissionKey); return; }
  const nextGrants = new Set(currentGrants);

  if (checkbox.checked) {
    nextGrants.add(permissionKey);
  } else {
    nextGrants.delete(permissionKey);
  }

  savingPermissionRoles.add(roleCode);
  permissionRevisions.set(roleCode, (permissionRevisions.get(roleCode) || 0) + 1);
  for (const input of els.matrixWrap.querySelectorAll('input[data-role-code]')) if (input.dataset.roleCode === roleCode) input.disabled = true;

  try {
    const data = await requestApi(`/api/roles/${encodeURIComponent(roleCode)}/permissions`, {
      method: "PUT",
      body: JSON.stringify({ permissionKeys: [...nextGrants], expectedPermissionKeys: [...currentGrants] })
    });

    state.grants.set(roleCode, new Set(data.permissions || nextGrants));
    setStatus(`อัพเดทสิทธิ์ ${roleName(roleCode)} แล้ว`);
  } catch (error) {
    savingPermissionRoles.delete(roleCode);
    permissionRevisions.set(roleCode, (permissionRevisions.get(roleCode) || 0) + 1);
    const refreshed = await loadAll();
    setStatus(`${error.message}${refreshed ? ' • แสดงค่าล่าสุดแล้ว กรุณาตรวจก่อนกดใหม่' : ' • โหลดค่าล่าสุดไม่สำเร็จ กรุณาโหลดหน้าใหม่'}`, "error");
  } finally {
    savingPermissionRoles.delete(roleCode);
    for (const input of els.matrixWrap.querySelectorAll('input[data-role-code]')) if (input.dataset.roleCode === roleCode) {
      input.disabled = false;
      input.checked = Boolean(state.grants.get(roleCode)?.has(input.dataset.permissionKey));
    }
  }
}

async function handleDeleteRole(button) {
  const roleCode = button.dataset.roleCode;
  const canDelete = () => {
    const role = state.roles.find(row => row.role_code === roleCode);
    return role && !role.is_system && roleUsage(role).total === 0;
  };
  if (button.disabled || !canDelete()) return;

  if (!await confirmAction(`ลบ role "${roleName(roleCode)}" ใช่ไหม?`)) {
    return;
  }
  if (!button.isConnected || !canDelete()) return;

  button.disabled = true;

  try {
    await requestApi(`/api/roles/${encodeURIComponent(roleCode)}`, { method: "DELETE" });
    setStatus(`ลบ role "${roleName(roleCode)}" แล้ว`);
    await loadAll();
  } catch (error) {
    setStatus(error.message, "error");
    const refreshed = await loadAll();
    if (!refreshed && button.isConnected) button.disabled = false;
  }
}

els.createForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setCreateMessage("");
  els.createSubmit.disabled = true;

  try {
    const formData = new FormData(els.createForm);
    await requestApi("/api/users", {
      method: "POST",
      body: JSON.stringify({
        username: formData.get("username"),
        password: formData.get("password"),
        displayName: formData.get("displayName"),
        role: formData.get("role")
      })
    });

    setCreateMessage("สร้างบัญชีแล้ว", true);
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
    await requestApi("/api/roles", {
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

function clearPasswordReset() {
  els.resetForm.reset();
  resetTarget = null;
  els.resetMessage.textContent = '';
  els.resetMessage.classList.add('hidden');
}

function closePasswordReset() {
  // The native close event is queued; clear secrets before returning control.
  clearPasswordReset();
  els.resetDialog.close();
}

els.resetCancel.addEventListener('click', () => { if (!resettingPassword) closePasswordReset(); });
els.resetDialog.addEventListener('cancel', event => {
  if (resettingPassword) event.preventDefault();
  else clearPasswordReset();
});
els.resetDialog.addEventListener('close', () => {
  // A previous close event must not clear a dialog that was already reopened.
  if (!els.resetDialog.open) clearPasswordReset();
});
els.resetForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (resettingPassword || !resetTarget) return;
  const target = resetTarget, password = els.resetValue.value;
  if (password.length < 6) { els.resetMessage.textContent = 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร'; els.resetMessage.classList.remove('hidden'); return; }
  resettingPassword = true;
  els.resetSubmit.disabled = els.resetCancel.disabled = els.resetValue.disabled = true;
  els.resetMessage.classList.add('hidden');
  try {
    await requestApi(`/api/users/${encodeURIComponent(target.userId)}/password`, { method: 'POST', body: JSON.stringify({ password }) });
    closePasswordReset();
    setStatus(`รีเซ็ตรหัสผ่านของ ${target.username} แล้ว บัญชีนี้ต้องเข้าสู่ระบบใหม่ทุกเครื่อง`);
  } catch (error) {
    els.resetMessage.textContent = error.message; els.resetMessage.classList.remove('hidden');
  } finally {
    resettingPassword = false;
    els.resetSubmit.disabled = els.resetCancel.disabled = els.resetValue.disabled = false;
  }
});
loadAll();
