const els = {
    billingMonth: document.getElementById("billingMonth"),
    billingYear: document.getElementById("billingYear"),
    paymentSearch: document.getElementById("paymentSearch"),
    refreshButton: document.getElementById("refreshButton"),
    pageSubtitle: document.getElementById("pageSubtitle"),
    statusLine: document.getElementById("statusLine"),
    totalStudents: document.getElementById("totalStudents"),
    paidStudents: document.getElementById("paidStudents"),
    partialStudents: document.getElementById("partialStudents"),
    unpaidStudents: document.getElementById("unpaidStudents"),
    totalNetAmount: document.getElementById("totalNetAmount"),
    expectedNetAmount: document.getElementById("expectedNetAmount"),
    unpaidNetAmount: document.getElementById("unpaidNetAmount"),
    progressPaidSegment: document.getElementById("progressPaidSegment"),
    progressPartialSegment: document.getElementById("progressPartialSegment"),
    progressUnpaidSegment: document.getElementById("progressUnpaidSegment"),
    resultSubtitle: document.getElementById("resultSubtitle"),
    paymentTableWrap: document.getElementById("paymentTableWrap"),
    printUnpaidButton: document.getElementById("printUnpaidButton"),
    exportUnpaidButton: document.getElementById("exportUnpaidButton"),
    receiptModal: document.getElementById("receiptModal"),
    receiptModalSubtitle: document.getElementById("receiptModalSubtitle"),
    receiptClose: document.getElementById("receiptClose"),
    receiptPaymentControls: document.getElementById("receiptPaymentControls"),
    receiptPaymentMethod: document.getElementById("receiptPaymentMethod"),
    receiptSubjectPicker: document.getElementById("receiptSubjectPicker"),
    receiptPaper: document.getElementById("receiptPaper"),
    receiptCancelPayment: document.getElementById("receiptCancelPayment"),
    receiptPrint: document.getElementById("receiptPrint"),
    receiptReceivePayment: document.getElementById("receiptReceivePayment")
};

const state = {
    rows: [],
    searchTimer: null,
    selectedRow: null,
    receipt: null,
    paymentMethods: [],
    isReceivingPayment: false,
    isCancellingPayment: false,
    // The sidebar Subject/Status <select> filters were removed as
    // unnecessary; status filtering still lives in the quick-filter
    // buttons above the table, backed by this instead of a hidden select.
    statusFilter: "all"
};

function selectInputText(input) {
    if (!input) {
        return;
    }

    input.select();
}

function bindSelectAllInput(input, onFocus = null) {
    if (!input) {
        return;
    }

    input.addEventListener("focus", () => {
        selectInputText(input);
        onFocus?.();
    });
    input.addEventListener("mousedown", (event) => {
        if (document.activeElement === input) {
            event.preventDefault();
            selectInputText(input);
        }
    });
    input.addEventListener("click", () => selectInputText(input));
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

async function requestJson(url, options = {}) {
    const response = await fetch(url, {
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
        },
        ...options
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || data.success === false) {
        throw new Error(data.error || "Request failed");
    }

    return data;
}

function setStatus(message, type = "neutral") {
    els.statusLine.textContent = message;
    els.statusLine.classList.toggle("is-error", type === "error");
}

function todayIsoDate() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

function kumonPeriodFromDate(dateText) {
    const [year, month, day] = dateText.split("-").map(Number);
    const nextMonth = day > 20 ? month + 1 : month;

    if (nextMonth > 12) {
        return {
            billingMonth: 1,
            billingYear: year + 1
        };
    }

    return {
        billingMonth: nextMonth,
        billingYear: year
    };
}

function monthName(month) {
    return [
        "",
        "มกราคม",
        "กุมภาพันธ์",
        "มีนาคม",
        "เมษายน",
        "พฤษภาคม",
        "มิถุนายน",
        "กรกฎาคม",
        "สิงหาคม",
        "กันยายน",
        "ตุลาคม",
        "พฤศจิกายน",
        "ธันวาคม"
    ][Number(month)] || month;
}

function formatDateDisplay(dateText) {
    const value = String(dateText || "").slice(0, 10);
    const [year, month, day] = value.split("-");

    if (!year || !month || !day) {
        return value || "-";
    }

    return `${day}/${month}/${Number(year) + 543}`;
}

function formatTimeDisplay(dateTimeText) {
    const date = new Date(dateTimeText);

    if (Number.isNaN(date.getTime())) {
        return "";
    }

    return date.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", hour12: false });
}

// Only for the printed receipt — the plain formatMoney() below is used
// all over the page (summary cards, table cells, CSV export) where a
// "บาท" suffix isn't wanted.
function formatReceiptMoney(value) {
    return `${formatMoney(value)} บาท`;
}

function formatMoney(value) {
    return Number(value || 0).toLocaleString("th-TH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function setupMonthSelect(select) {
    select.innerHTML = Array.from({ length: 12 }, (_, index) => {
        const month = index + 1;

        return `<option value="${month}">${monthName(month)}</option>`;
    }).join("");
}

function setDefaultPeriod() {
    const period = kumonPeriodFromDate(todayIsoDate());

    els.billingMonth.value = String(period.billingMonth);
    els.billingYear.value = String(period.billingYear);
}

function selectedPeriod() {
    return {
        billingMonth: Number(els.billingMonth.value),
        billingYear: Number(els.billingYear.value)
    };
}

function renderSummary(summary) {
    const total = summary.totalStudents || 0;
    const paid = summary.paidStudents || 0;
    const partial = summary.partialStudents || 0;
    const unpaid = summary.unpaidStudents || 0;

    els.totalStudents.textContent = total;
    els.paidStudents.textContent = paid;
    els.partialStudents.textContent = partial;
    els.unpaidStudents.textContent = unpaid;
    els.totalNetAmount.textContent = formatMoney(summary.totalNetAmount || 0);
    els.expectedNetAmount.textContent = formatMoney(summary.expectedNetAmount || 0);
    els.unpaidNetAmount.textContent = formatMoney(summary.unpaidNetAmount || 0);

    // At-a-glance payment-progress bar under the status cards.
    const pct = (count) => (total > 0 ? `${(count / total) * 100}%` : "0%");

    els.progressPaidSegment.style.width = pct(paid);
    els.progressPartialSegment.style.width = pct(partial);
    els.progressUnpaidSegment.style.width = pct(unpaid);
}

function syncQuickFilterButtons() {
    document.querySelectorAll("[data-status-filter]").forEach((button) => {
        button.classList.toggle("is-active", button.dataset.statusFilter === state.statusFilter);
    });
}

function rowNetAmount(row) {
    if (row.isPaid) {
        return row.netAmount;
    }

    return row.isPartial ? row.unpaidNetAmount : row.expectedNetAmount;
}

function paymentStateText(row) {
    if (row.isPaid) {
        return "จ่ายแล้ว";
    }

    return row.isPartial ? "จ่ายบางส่วน" : "ยังไม่จ่าย";
}

function receiptButtonText(row) {
    if (row.isPaid) {
        return "🖨️ พิมพ์ซ้ำ";
    }

    return row.isPartial ? "💵 รับเงินเพิ่ม" : "💵 รับเงิน";
}

function renderSubjectBadges(subjects) {
    const values = String(subjects || "")
        .split(",")
        .map((subject) => subject.trim())
        .filter(Boolean);

    if (!values.length) {
        return "-";
    }

    return `
        <div class="subject-badges">
            ${values.map((subject) => {
                const isPaid = subject.endsWith(" paid");
                const label = isPaid ? subject.slice(0, -" paid".length) : subject;

                return `
                    <span class="subject-badge ${isPaid ? "is-paid" : ""}">
                        ${escapeHtml(label)}${isPaid ? ` <small>จ่ายแล้ว</small>` : ""}
                    </span>
                `;
            }).join("")}
        </div>
    `;
}

function renderLatestBilling(row) {
    if (!row.latestReceiptBook) {
        return "";
    }

    return `
        <div class="subtle">
            ล่าสุด: ${escapeHtml(monthName(row.latestBillingMonth))} ${escapeHtml(row.latestBillingYear)}
            • ${escapeHtml(row.latestReceiptBook)}/${escapeHtml(row.latestReceiptNo)}
            • ${formatMoney(row.latestNetAmount)}
        </div>
    `;
}

function renderRows(rows) {
    if (!rows.length) {
        els.paymentTableWrap.innerHTML = `<div class="empty-state">ไม่พบรายการในเงื่อนไขนี้</div>`;
        return;
    }

    els.paymentTableWrap.innerHTML = `
        <table class="payment-table">
            <thead>
                <tr>
                    <th>Status</th>
                    <th>Student</th>
                    <th>Subjects</th>
                    <th>Receipt</th>
                    <th>Date</th>
                    <th>Payment</th>
                    <th>Net</th>
                    <th>Action</th>
                </tr>
            </thead>
            <tbody>
                ${rows.map((row, index) => `
                    <tr class="is-${escapeHtml(row.paymentState || (row.isPaid ? "paid" : "unpaid"))}">
                        <td>
                            <span class="status-pill is-${escapeHtml(row.paymentState || (row.isPaid ? "paid" : "unpaid"))}">
                                ${paymentStateText(row)}
                            </span>
                        </td>
                        <td>
                            <strong>#${escapeHtml(row.studentId)} ${escapeHtml(row.studentName)}</strong>
                            ${row.nickname ? `<div class="subtle">น้อง${escapeHtml(row.nickname)}</div>` : ""}
                        </td>
                        <td>${renderSubjectBadges(row.subjects)}</td>
                        <td>${row.receiptBook ? `${escapeHtml(row.receiptBook)}/${escapeHtml(row.receiptNo)}` : "-"}</td>
                        <td>${row.billingDate ? escapeHtml(formatDateDisplay(row.billingDate)) : "-"}</td>
                        <td>${escapeHtml(row.paymentMethodName || "-")}</td>
                        <td>
                            <strong>${formatMoney(rowNetAmount(row))}</strong>
                            ${row.isPartial ? `<div class="subtle">ยอดค้าง ${formatMoney(row.unpaidNetAmount || 0)} • จ่ายแล้ว ${formatMoney(row.netAmount || 0)}</div>` : ""}
                            ${!row.isPaid && !row.isPartial ? `<div class="subtle">ยอดที่ควรเก็บ</div>` : ""}
                            ${renderLatestBilling(row)}
                        </td>
                        <td>
                            <button
                                type="button"
                                class="receipt-button"
                                data-receipt-row-index="${escapeHtml(index)}"
                            >
                                ${receiptButtonText(row)}
                            </button>
                        </td>
                    </tr>
                `).join("")}
            </tbody>
        </table>
    `;
}

async function loadPaymentStatus() {
    const period = selectedPeriod();
    const params = new URLSearchParams({
        billingMonth: String(period.billingMonth),
        billingYear: String(period.billingYear),
        subject: "ALL",
        status: state.statusFilter,
        query: els.paymentSearch.value.trim(),
        limit: "1000"
    });

    setStatus("กำลังโหลด...");
    els.resultSubtitle.textContent = "กำลังโหลด...";

    try {
        const data = await requestJson(`/api/payment/status?${params.toString()}`);

        state.rows = data.rows || [];
        renderSummary(data.summary || {});
        renderRows(state.rows);
        syncQuickFilterButtons();
        els.pageSubtitle.textContent = `ค่าเรียน ${monthName(data.billingMonth)} ${data.billingYear}`;
        els.resultSubtitle.textContent = `แสดง ${state.rows.length} รายการ`;
        setStatus("พร้อมใช้งาน");
    } catch (error) {
        els.paymentTableWrap.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
        setStatus(error.message, "error");
    }
}

function renderPaymentMethods(paymentMethods, selectedPaymentMethodId) {
    if (Array.isArray(paymentMethods) && paymentMethods.length) {
        state.paymentMethods = paymentMethods;
    }

    const rows = state.paymentMethods.length
        ? state.paymentMethods
        : [{
            paymentMethodId: selectedPaymentMethodId || 1,
            paymentMethodName: "Cash"
        }];

    els.receiptPaymentMethod.innerHTML = rows.map((method) => `
        <option
            value="${escapeHtml(method.paymentMethodId)}"
            ${Number(method.paymentMethodId) === Number(selectedPaymentMethodId) ? "selected" : ""}
        >
            ${escapeHtml(method.paymentMethodName)}
        </option>
    `).join("");
}

function selectedReceiptEnrollmentIds() {
    return Array.from(els.receiptSubjectPicker.querySelectorAll("[data-receipt-enrollment]:checked:not(:disabled)"))
        .map((checkbox) => Number(checkbox.value))
        .filter((id) => Number.isInteger(id) && id > 0);
}

function recalculateReceiptTotals(receipt) {
    const selectedIds = new Set(selectedReceiptEnrollmentIds());

    receipt.details = (receipt.details || []).map((detail) => ({
        ...detail,
        isSelected: detail.isPaid ? false : selectedIds.has(Number(detail.enrollmentId))
    }));
    receipt.receiptDetails = receipt.details.filter((detail) => detail.isSelected);
    receipt.discountAmount = receipt.receiptDetails.reduce((sum, detail) => sum + Number(detail.discountAmount || 0), 0);
    receipt.netAmount = receipt.receiptDetails.reduce((sum, detail) => sum + Number(detail.netAmount || 0), 0);
    receipt.totalAmount = receipt.netAmount + receipt.discountAmount;
}

function renderReceiptSubjectPicker(receipt) {
    const hasBilling = Boolean(receipt.billingId);

    if (!receipt.details?.length) {
        els.receiptSubjectPicker.innerHTML = "";
        return;
    }

    els.receiptSubjectPicker.innerHTML = `
        <div class="receipt-picker-title">เลือกวิชาที่รับเงิน</div>
        <div class="receipt-picker-list">
            ${receipt.details.map((detail) => {
                const checked = detail.isPaid || detail.isSelected;
                const disabled = hasBilling || detail.isPaid;
                const note = detail.isPaid
                    ? `จ่ายแล้ว ${detail.paidReceiptBook ? `(${detail.paidReceiptBook}/${detail.paidReceiptNo})` : ""}`
                    : formatMoney(detail.netAmount);

                return `
                    <label class="receipt-subject-option ${detail.isPaid ? "is-paid" : ""}">
                        <input
                            type="checkbox"
                            data-receipt-enrollment
                            value="${escapeHtml(detail.enrollmentId)}"
                            ${checked ? "checked" : ""}
                            ${disabled ? "disabled" : ""}
                        >
                        <span>
                            ${escapeHtml(detail.subjectCode)}
                            (#${escapeHtml(detail.enrollmentId)} • ${escapeHtml(detail.subjectName)} level ${escapeHtml(detail.currentLevelCode)})
                        </span>
                        <strong>${escapeHtml(note)}</strong>
                    </label>
                `;
            }).join("")}
        </div>
    `;
}

function renderReceipt(receipt) {
    const paidText = receipt.billingId
        ? `<div class="receipt-paid-stamp">PAID • Billing #${escapeHtml(receipt.billingId)}</div>`
        : "";
    const latestText = state.selectedRow?.latestReceiptBook
        ? ` • ล่าสุด ${monthName(state.selectedRow.latestBillingMonth)} ${state.selectedRow.latestBillingYear} (${state.selectedRow.latestReceiptBook}/${state.selectedRow.latestReceiptNo})`
        : "";

    els.receiptModalSubtitle.textContent = `เล่ม ${receipt.receiptBook} เลขที่ ${receipt.receiptNo}${latestText}`;
    const hasBilling = Boolean(receipt.billingId);

    els.receiptCancelPayment.classList.toggle("hidden", !hasBilling);
    els.receiptCancelPayment.disabled = !hasBilling || state.isCancellingPayment;
    els.receiptCancelPayment.textContent = state.isCancellingPayment ? "⏳ กำลังยกเลิก" : "↩️ Cancel Receipt";
    els.receiptPaymentControls.classList.toggle("hidden", hasBilling);
    els.receiptSubjectPicker.classList.toggle("hidden", hasBilling);
    els.receiptReceivePayment.classList.toggle("hidden", hasBilling);
    els.receiptReceivePayment.disabled = hasBilling || state.isReceivingPayment || !receipt.receiptDetails?.length;
    els.receiptReceivePayment.textContent = receipt.billingId ? "✅ รับเงินแล้ว" : "💵 รับเงิน";
    renderReceiptSubjectPicker(receipt);
    els.receiptPaper.innerHTML = `
        <div class="receipt-center">
            <div class="receipt-title">KUMON</div>
            <div>${escapeHtml(receipt.center?.centerName || "KumonDB")}</div>
            <div>Receipt</div>
        </div>
        <div class="receipt-line"></div>
        <div class="receipt-row">
            <span>Book/No</span>
            <strong>${escapeHtml(receipt.receiptBook)}/${escapeHtml(receipt.receiptNo)}</strong>
        </div>
        <div class="receipt-row">
            <span>Date</span>
            <strong>${escapeHtml(formatDateDisplay(receipt.billingDate))}${receipt.billingTime ? ` ${escapeHtml(formatTimeDisplay(receipt.billingTime))}` : ""}</strong>
        </div>
        <div>Student: ${escapeHtml(receipt.studentName)}</div>
        <div>Student ID: ${escapeHtml(receipt.studentId)}</div>
        <div>Tuition: ${escapeHtml(monthName(receipt.billingMonth))} ${escapeHtml(receipt.billingYear)}</div>
        <div>Payment: ${escapeHtml(receipt.paymentMethodName)}</div>
        <div class="receipt-line"></div>
        ${(receipt.receiptDetails || []).map((detail) => `
            <div class="receipt-item">
                <div class="receipt-item-name">
                    ${escapeHtml(detail.subjectCode)}
                    (#${escapeHtml(detail.enrollmentId)} • ${escapeHtml(detail.subjectName)} level ${escapeHtml(detail.currentLevelCode)}${detail.currentZunLevelCode ? ` • Zun ${escapeHtml(detail.currentZunLevelCode)}` : ""})
                </div>
                <div class="receipt-row">
                    <span>Tuition</span>
                    <span>${formatReceiptMoney(detail.tuitionFee)}</span>
                </div>
                ${Number(detail.additionalFee) > 0 ? `
                    <div class="receipt-row">
                        <span>Additional</span>
                        <span>${formatReceiptMoney(detail.additionalFee)}</span>
                    </div>
                ` : ""}
                ${Number(detail.registrationFee) > 0 ? `
                    <div class="receipt-row">
                        <span>Registration</span>
                        <span>${formatReceiptMoney(detail.registrationFee)}</span>
                    </div>
                ` : ""}
                ${Number(detail.discountAmount) > 0 ? `
                    <div class="receipt-row">
                        <span>Discount</span>
                        <span>-${formatReceiptMoney(detail.discountAmount)}</span>
                    </div>
                ` : ""}
                ${detail.statusGroup2Name ? `<div>${escapeHtml(detail.statusGroup2Name)}</div>` : ""}
                <div class="receipt-row">
                    <span>Subtotal</span>
                    <strong>${formatReceiptMoney(detail.netAmount)}</strong>
                </div>
            </div>
        `).join("")}
        ${!(receipt.receiptDetails || []).length ? `<div class="empty-state">เลือกอย่างน้อย 1 วิชาที่ยังไม่ได้จ่าย</div>` : ""}
        <div class="receipt-line"></div>
        <div class="receipt-row">
            <span>Total</span>
            <span>${formatReceiptMoney(receipt.totalAmount)}</span>
        </div>
        <div class="receipt-row">
            <span>Discount</span>
            <span>${formatReceiptMoney(receipt.discountAmount)}</span>
        </div>
        <div class="receipt-row receipt-total">
            <span>Net</span>
            <span>${formatReceiptMoney(receipt.netAmount)}</span>
        </div>
        ${paidText}
        <div class="receipt-line"></div>
        <div class="receipt-center">Thank you</div>
    `;
}

async function refreshReceiptPreview({
    existingBillingId = null,
    selectedEnrollmentIds = null
} = {}) {
    if (!state.selectedRow) {
        return;
    }

    const period = selectedPeriod();

    setStatus("กำลังเตรียมใบเสร็จ...");

    try {
        const data = await requestJson("/api/worksheet/receipt/preview", {
            method: "POST",
            body: JSON.stringify({
                enrollmentId: state.selectedRow.sourceEnrollmentId,
                billingDate: todayIsoDate(),
                billingMonth: period.billingMonth,
                billingYear: period.billingYear,
                paymentMethodId: els.receiptPaymentMethod.value || undefined,
                existingBillingId,
                selectedEnrollmentIds
            })
        });

        if (data.receipt.alreadyPaid && !data.receipt.billingId) {
            await refreshReceiptPreview({
                existingBillingId: data.receipt.existingBillingId,
                selectedEnrollmentIds
            });
            return;
        }

        state.receipt = data.receipt;
        renderPaymentMethods(data.paymentMethods, state.receipt.paymentMethodId);
        renderReceipt(state.receipt);
        els.receiptModal.classList.remove("hidden");
        setStatus("พร้อมพิมพ์ใบเสร็จ");
    } catch (error) {
        setStatus(error.message, "error");
    }
}

function openReceipt(row) {
    state.selectedRow = row;
    state.receipt = null;
    // row.billingId is the billing record for whatever HAS been paid this
    // period — for a fully-paid row that's the whole receipt (reprint/cancel
    // it), but for a partial row it only covers the already-paid subject.
    // Passing it through unconditionally made buildReceiptPreview treat a
    // partial row as "existing receipt" too, which locks every subject
    // (including the still-unpaid one) and hides the pay button behind a
    // "Cancel Receipt"-only view. Only reuse it when the row is fully paid.
    refreshReceiptPreview({
        existingBillingId: row.isPaid ? (row.billingId || null) : null
    });
}

function closeReceipt() {
    els.receiptModal.classList.add("hidden");
}

async function receivePayment() {
    if (!state.selectedRow || !state.receipt || state.isReceivingPayment) {
        return;
    }

    const confirmMessage = [
        "รับเงินและบันทึกใบเสร็จนี้ใช่ไหม?",
        `นักเรียน: ${state.receipt.studentName}`,
        `ค่าเรียน: ${monthName(state.receipt.billingMonth)} ${state.receipt.billingYear}`,
        `จำนวนวิชา: ${state.receipt.receiptDetails?.length || 0}`,
        `ยอดสุทธิ: ${formatMoney(state.receipt.netAmount)}`,
        `วิธีจ่าย: ${els.receiptPaymentMethod.options[els.receiptPaymentMethod.selectedIndex]?.textContent || state.receipt.paymentMethodName}`
    ].join("\n");

    if (!window.confirm(confirmMessage)) {
        return;
    }

    state.isReceivingPayment = true;
    els.receiptReceivePayment.disabled = true;
    els.receiptReceivePayment.textContent = "⏳ กำลังบันทึก";

    try {
        const data = await requestJson("/api/worksheet/receipt/payment", {
            method: "POST",
            body: JSON.stringify({
                enrollmentId: state.selectedRow.sourceEnrollmentId,
                billingDate: state.receipt.billingDate,
                billingMonth: state.receipt.billingMonth,
                billingYear: state.receipt.billingYear,
                paymentMethodId: els.receiptPaymentMethod.value || state.receipt.paymentMethodId,
                selectedEnrollmentIds: selectedReceiptEnrollmentIds()
            })
        });

        state.receipt = data.receipt;
        renderReceipt(state.receipt);
        setStatus(`รับเงินแล้ว Billing #${data.billingId}`);
        await loadPaymentStatus();
    } catch (error) {
        setStatus(error.message, "error");
    } finally {
        state.isReceivingPayment = false;
        renderReceipt(state.receipt);
    }
}

async function cancelPayment() {
    if (!state.selectedRow || !state.receipt?.billingId || state.isCancellingPayment) {
        return;
    }

    const confirmMessage = [
        "ยกเลิกใบเสร็จนี้ใช่ไหม?",
        `ใบเสร็จ: ${state.receipt.receiptBook}/${state.receipt.receiptNo}`,
        `นักเรียน: ${state.receipt.studentName}`,
        `ค่าเรียน: ${monthName(state.receipt.billingMonth)} ${state.receipt.billingYear}`,
        "ระบบจะลบใบเสร็จนี้, ลบ history status ของรอบนี้ และคืน status enrollment กลับ"
    ].join("\n");

    if (!window.confirm(confirmMessage)) {
        return;
    }

    state.isCancellingPayment = true;
    renderReceipt(state.receipt);

    try {
        const data = await requestJson("/api/worksheet/receipt/cancel", {
            method: "POST",
            body: JSON.stringify({
                billingId: state.receipt.billingId
            })
        });

        setStatus(`ยกเลิกใบเสร็จ ${data.receiptBook}/${data.receiptNo} แล้ว`);
        closeReceipt();
        await loadPaymentStatus();
    } catch (error) {
        setStatus(error.message, "error");
    } finally {
        state.isCancellingPayment = false;
        if (state.receipt?.billingId) {
            renderReceipt(state.receipt);
        }
    }
}

function currentRowsForExport() {
    return state.rows.filter((row) => !row.isPaid);
}

function csvCell(value) {
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function exportUnpaidCsv() {
    const rows = currentRowsForExport();

    if (!rows.length) {
        setStatus("ไม่มีรายการค้างจ่ายให้ export");
        return;
    }

    const period = selectedPeriod();
    const header = [
        "student_id",
        "student_name",
        "nickname",
        "subjects",
        "expected_net",
        "latest_receipt",
        "latest_period"
    ];
    const lines = [
        header.map(csvCell).join(","),
        ...rows.map((row) => [
            row.studentId,
            row.studentName,
            row.nickname ? `น้อง${row.nickname}` : "",
            row.subjects || "",
            formatMoney(row.isPartial ? row.unpaidNetAmount : row.expectedNetAmount || 0),
            row.latestReceiptBook ? `${row.latestReceiptBook}/${row.latestReceiptNo}` : "",
            row.latestBillingMonth ? `${monthName(row.latestBillingMonth)} ${row.latestBillingYear}` : ""
        ].map(csvCell).join(","))
    ];
    const blob = new Blob([`\uFEFF${lines.join("\n")}`], {
        type: "text/csv;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `kumon-unpaid-${period.billingYear}-${String(period.billingMonth).padStart(2, "0")}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus(`Export รายชื่อค้างจ่าย ${rows.length} รายการแล้ว`);
}

function printUnpaidList() {
    const rows = currentRowsForExport();

    if (!rows.length) {
        setStatus("ไม่มีรายการค้างจ่ายให้ print");
        return;
    }

    const period = selectedPeriod();
    const printWindow = window.open("", "_blank", "width=900,height=700");

    if (!printWindow) {
        setStatus("Browser บล็อกหน้าต่าง print", "error");
        return;
    }

    printWindow.document.write(`
        <!doctype html>
        <html lang="th">
        <head>
            <meta charset="utf-8">
            <title>Unpaid ${monthName(period.billingMonth)} ${period.billingYear}</title>
            <style>
                body { font-family: Arial, sans-serif; color: #111827; }
                h1 { font-size: 20px; margin: 0 0 4px; }
                .subtle { color: #64748b; margin-bottom: 14px; }
                table { width: 100%; border-collapse: collapse; font-size: 12px; }
                th, td { border: 1px solid #d8e2ee; padding: 6px 8px; text-align: left; }
                th { background: #f1f5f9; }
                .money { text-align: right; }
            </style>
        </head>
        <body>
            <h1>รายชื่อค้างจ่าย</h1>
            <div class="subtle">ค่าเรียน ${monthName(period.billingMonth)} ${period.billingYear} • ${rows.length} รายการ</div>
            <table>
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Student</th>
                        <th>Subjects</th>
                        <th>Expected Net</th>
                        <th>Latest</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map((row) => `
                        <tr>
                            <td>#${escapeHtml(row.studentId)}</td>
                            <td>${escapeHtml(row.studentName)}${row.nickname ? `<br>น้อง${escapeHtml(row.nickname)}` : ""}</td>
                            <td>${escapeHtml(row.subjects || "-")}</td>
                            <td class="money">${formatMoney(row.isPartial ? row.unpaidNetAmount : row.expectedNetAmount || 0)}</td>
                            <td>${row.latestReceiptBook ? `${escapeHtml(monthName(row.latestBillingMonth))} ${escapeHtml(row.latestBillingYear)} • ${escapeHtml(row.latestReceiptBook)}/${escapeHtml(row.latestReceiptNo)}` : "-"}</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        </body>
        </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    setStatus(`เตรียม print รายชื่อค้างจ่าย ${rows.length} รายการ`);
}

function bindEvents() {
    [
        els.billingMonth,
        els.billingYear
    ].forEach((element) => element.addEventListener("change", () => {
        syncQuickFilterButtons();
        loadPaymentStatus();
    }));

    els.paymentSearch.addEventListener("input", () => {
        clearTimeout(state.searchTimer);
        state.searchTimer = setTimeout(loadPaymentStatus, 180);
    });
    bindSelectAllInput(els.paymentSearch);
    els.refreshButton.addEventListener("click", loadPaymentStatus);
    els.printUnpaidButton.addEventListener("click", printUnpaidList);
    els.exportUnpaidButton.addEventListener("click", exportUnpaidCsv);
    document.querySelectorAll("[data-status-filter]").forEach((button) => {
        button.addEventListener("click", () => {
            state.statusFilter = button.dataset.statusFilter;
            syncQuickFilterButtons();
            loadPaymentStatus();
        });
    });
    els.paymentTableWrap.addEventListener("click", (event) => {
        const button = event.target.closest("[data-receipt-row-index]");

        if (!button) {
            return;
        }

        const row = state.rows[Number(button.dataset.receiptRowIndex)];

        if (row) {
            openReceipt(row);
        }
    });
    els.receiptClose.addEventListener("click", closeReceipt);
    els.receiptModal.addEventListener("mousedown", (event) => {
        if (event.target === els.receiptModal) {
            closeReceipt();
        }
    });
    els.receiptPrint.addEventListener("click", () => window.print());
    els.receiptCancelPayment.addEventListener("click", cancelPayment);
    els.receiptReceivePayment.addEventListener("click", receivePayment);
    els.receiptSubjectPicker.addEventListener("change", (event) => {
        if (!event.target.matches("[data-receipt-enrollment]") || !state.receipt?.details) {
            return;
        }

        recalculateReceiptTotals(state.receipt);
        renderReceipt(state.receipt);
    });
    els.receiptPaymentMethod.addEventListener("change", () => {
        if (state.receipt?.billingId) {
            return;
        }

        refreshReceiptPreview({
            selectedEnrollmentIds: selectedReceiptEnrollmentIds()
        });
    });
}

function init() {
    setupMonthSelect(els.billingMonth);
    setDefaultPeriod();
    bindEvents();
    syncQuickFilterButtons();
    loadPaymentStatus();
}

init();
