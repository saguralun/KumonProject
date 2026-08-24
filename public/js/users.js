const els = {
  createForm: document.getElementById("createForm"),
  createSubmit: document.getElementById("createSubmit"),
  createMessage: document.getElementById("createMessage"),
  tableWrap: document.getElementById("usersTableWrap"),
  listSubtitle: document.getElementById("listSubtitle"),
  statusLine: document.getElementById("statusLine")
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

async function loadUsers() {
  els.tableWrap.innerHTML = `<div class="empty-state">กำลังโหลด...</div>`;

  try {
    const data = await requestJson("/api/users");
    renderUsers(data.users);
    els.listSubtitle.textContent = `${data.users.length} บัญชี`;
  } catch (error) {
    els.tableWrap.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
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
              <span class="role-badge ${user.role}">${user.role}</span>
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
                <button
                  type="button"
                  class="row-action-button"
                  data-action="toggle-role"
                  data-role="${user.role === "admin" ? "staff" : "admin"}"
                >
                  ${user.role === "admin" ? "→ Staff" : "→ Admin"}
                </button>
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

  els.tableWrap.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => handleRowAction(button));
  });
}

async function handleRowAction(button) {
  const row = button.closest("tr");
  const userId = row.dataset.userId;
  const action = button.dataset.action;

  button.disabled = true;

  try {
    if (action === "toggle-role") {
      await requestJson(`/api/users/${userId}/role`, {
        method: "POST",
        body: JSON.stringify({ role: button.dataset.role })
      });
    } else if (action === "toggle-active") {
      const isCurrentlyActive = !row.classList.contains("is-inactive");
      await requestJson(`/api/users/${userId}/active`, {
        method: "POST",
        body: JSON.stringify({ isActive: !isCurrentlyActive })
      });
    }

    setStatus("บันทึกแล้ว");
    await loadUsers();
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
    els.createForm.elements.role.value = "admin";
    await loadUsers();
  } catch (error) {
    setCreateMessage(error.message);
  } finally {
    els.createSubmit.disabled = false;
  }
});

loadUsers();
