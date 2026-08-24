const els = {
    billingMonth: document.getElementById("billingMonth"),
    billingYear: document.getElementById("billingYear"),
    subjectFilter: document.getElementById("subjectFilter"),
    paymentStatus: document.getElementById("paymentStatus"),
    paymentSearch: document.getElementById("paymentSearch"),
    refreshButton: document.getElementById("refreshButton"),
    pageSubtitle: document.getElementById("pageSubtitle"),
    statusLine: document.getElementById("statusLine"),
    totalStudents: document.getElementById("totalStudents"),
    paidStudents: document.getElementById("paidStudents"),
    unpaidStudents: document.getElementById("unpaidStudents"),
    totalNetAmount: document.getElementById("totalNetAmount"),
    expectedNetAmount: document.getElementById("expectedNetAmount"),
    unpaidNetAmount: document.getElementById("unpaidNetAmount"),
    resultSubtitle: document.getElementById("resultSubtitle"),
    paymentTableWrap: document.getElementById("paymentTableWrap"),
    printUnpaidButton: document.getElementById("printUnpaidButton"),
    exportUnpaidButton: document.getElementById("exportUnpaidButton"),
    receiptModal: document.getElementById("receiptModal"),
    receiptModalSubtitle: document.getElementById("receiptModalSubtitle"),
    receiptClose: document.getElementById("receiptClose"),
    receiptPaymentMethod: document.getElementById("receiptPaymentMethod"),
    receiptPaper: document.getElementById("receiptPaper"),
    receiptPrint: document.getElementById("receiptPrint"),
    receiptReceivePayment: document.getElementById("receiptReceivePayment")
};

const state = {
    rows: [],
    searchTimer: null,
    selectedRow: null,
    receipt: null,
    paymentMethods: [],
    isReceivingPayment: false
};

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
    els.totalStudents.textContent = summary.totalStudents || 0;
    els.paidStudents.textContent = summary.paidStudents || 0;
    els.unpaidStudents.textContent = summary.unpaidStudents || 0;
    els.totalNetAmount.textContent = formatMoney(summary.totalNetAmount || 0);
    els.expectedNetAmount.textContent = formatMoney(summary.expectedNetAmount || 0);
    els.unpaidNetAmount.textContent = formatMoney(summary.unpaidNetAmount || 0);
}

function syncQuickFilterButtons() {
    document.querySelectorAll("[data-status-filter]").forEach((button) => {
        button.classList.toggle("is-active", button.dataset.statusFilter === els.paymentStatus.value);
    });
}

function rowNetAmount(row) {
    return row.isPaid ? row.netAmount : row.expectedNetAmount;
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
            ${values.map((subject) => `<span class="subject-badge">${escapeHtml(subject)}</span>`).join("")}
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
                ${rows.map((row) => `
                    <tr class="${row.isPaid ? "is-paid" : "is-unpaid"}">
                        <td>
                            <span class="status-pill ${row.isPaid ? "is-paid" : "is-unpaid"}">
                                ${row.isPaid ? "จ่ายแล้ว" : "ยังไม่จ่าย"}
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
                            ${!row.isPaid ? `<div class="subtle">ยอดที่ควรเก็บ</div>` : ""}
                            ${renderLatestBilling(row)}
                        </td>
                        <td>
                            <button
                                type="button"
                                class="receipt-button"
                                data-receipt-student-id="${escapeHtml(row.studentId)}"
                            >
                                ${row.isPaid ? "🖨️ พิมพ์ซ้ำ" : "💵 รับเงิน"}
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
        subject: els.subjectFilter.value,
        status: els.paymentStatus.value,
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

function renderReceipt(receipt) {
    const paidText = receipt.billingId
        ? `<div class="receipt-paid-stamp">PAID • Billing #${escapeHtml(receipt.billingId)}</div>`
        : "";
    const latestText = state.selectedRow?.latestReceiptBook
        ? ` • ล่าสุด ${monthName(state.selectedRow.latestBillingMonth)} ${state.selectedRow.latestBillingYear} (${state.selectedRow.latestReceiptBook}/${state.selectedRow.latestReceiptNo})`
        : "";

    els.receiptModalSubtitle.textContent = `เล่ม ${receipt.receiptBook} เลขที่ ${receipt.receiptNo}${latestText}`;
    els.receiptReceivePayment.disabled = Boolean(receipt.billingId) || state.isReceivingPayment;
    els.receiptReceivePayment.textContent = receipt.billingId ? "✅ รับเงินแล้ว" : "💵 รับเงิน";
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
            <strong>${escapeHtml(formatDateDisplay(receipt.billingDate))}</strong>
        </div>
        <div>Student: ${escapeHtml(receipt.studentName)}</div>
        <div>Student ID: ${escapeHtml(receipt.studentId)}</div>
        <div>Tuition: ${escapeHtml(monthName(receipt.billingMonth))} ${escapeHtml(receipt.billingYear)}</div>
        <div>Payment: ${escapeHtml(receipt.paymentMethodName)}</div>
        <div class="receipt-line"></div>
        ${receipt.details.map((detail) => `
            <div class="receipt-item">
                <div class="receipt-item-name">
                    ${escapeHtml(detail.subjectCode)}
                    (#${escapeHtml(detail.enrollmentId)} • ${escapeHtml(detail.subjectName)} level ${escapeHtml(detail.currentLevelCode)}${detail.currentZunLevelCode ? ` • Zun ${escapeHtml(detail.currentZunLevelCode)}` : ""})
                </div>
                <div class="receipt-row">
                    <span>Tuition</span>
                    <span>${formatMoney(detail.tuitionFee)}</span>
                </div>
                ${Number(detail.additionalFee) > 0 ? `
                    <div class="receipt-row">
                        <span>Additional</span>
                        <span>${formatMoney(detail.additionalFee)}</span>
                    </div>
                ` : ""}
                ${Number(detail.registrationFee) > 0 ? `
                    <div class="receipt-row">
                        <span>Registration</span>
                        <span>${formatMoney(detail.registrationFee)}</span>
                    </div>
                ` : ""}
                ${Number(detail.discountAmount) > 0 ? `
                    <div class="receipt-row">
                        <span>Discount</span>
                        <span>-${formatMoney(detail.discountAmount)}</span>
                    </div>
                ` : ""}
                ${detail.statusGroup2Name ? `<div>${escapeHtml(detail.statusGroup2Name)}</div>` : ""}
                <div class="receipt-row">
                    <span>Subtotal</span>
                    <strong>${formatMoney(detail.netAmount)}</strong>
                </div>
            </div>
        `).join("")}
        <div class="receipt-line"></div>
        <div class="receipt-row">
            <span>Total</span>
            <span>${formatMoney(receipt.totalAmount)}</span>
        </div>
        <div class="receipt-row">
            <span>Discount</span>
            <span>${formatMoney(receipt.discountAmount)}</span>
        </div>
        <div class="receipt-row receipt-total">
            <span>Net</span>
            <span>${formatMoney(receipt.netAmount)}</span>
        </div>
        ${paidText}
        <div class="receipt-line"></div>
        <div class="receipt-center">Thank you</div>
    `;
}

async function refreshReceiptPreview({
    existingBillingId = null,
    skipPaidConfirm = false
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
                existingBillingId
            })
        });

        if (data.receipt.alreadyPaid && !data.receipt.billingId && !skipPaidConfirm) {
            const shouldReprint = window.confirm(
                `น้องคนนี้จ่ายเงินค่าเรียนเดือน ${monthName(data.receipt.billingMonth)} ${data.receipt.billingYear} แล้ว ต้องการ print ใหม่ไหม?`
            );

            if (!shouldReprint) {
                setStatus("ยกเลิกการพิมพ์ซ้ำ");
                return;
            }

            await refreshReceiptPreview({
                existingBillingId: data.receipt.existingBillingId,
                skipPaidConfirm: true
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
    refreshReceiptPreview();
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
                paymentMethodId: els.receiptPaymentMethod.value || state.receipt.paymentMethodId
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
            formatMoney(row.expectedNetAmount || 0),
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
                            <td class="money">${formatMoney(row.expectedNetAmount || 0)}</td>
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
        els.billingYear,
        els.subjectFilter,
        els.paymentStatus
    ].forEach((element) => element.addEventListener("change", () => {
        syncQuickFilterButtons();
        loadPaymentStatus();
    }));

    els.paymentSearch.addEventListener("input", () => {
        clearTimeout(state.searchTimer);
        state.searchTimer = setTimeout(loadPaymentStatus, 180);
    });
    els.refreshButton.addEventListener("click", loadPaymentStatus);
    els.printUnpaidButton.addEventListener("click", printUnpaidList);
    els.exportUnpaidButton.addEventListener("click", exportUnpaidCsv);
    document.querySelectorAll("[data-status-filter]").forEach((button) => {
        button.addEventListener("click", () => {
            els.paymentStatus.value = button.dataset.statusFilter;
            loadPaymentStatus();
        });
    });
    els.paymentTableWrap.addEventListener("click", (event) => {
        const button = event.target.closest("[data-receipt-student-id]");

        if (!button) {
            return;
        }

        const row = state.rows.find((item) => Number(item.studentId) === Number(button.dataset.receiptStudentId));

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
    els.receiptReceivePayment.addEventListener("click", receivePayment);
    els.receiptPaymentMethod.addEventListener("change", () => refreshReceiptPreview({ skipPaidConfirm: true }));
}

function init() {
    setupMonthSelect(els.billingMonth);
    setDefaultPeriod();
    bindEvents();
    syncQuickFilterButtons();
    loadPaymentStatus();
}

init();
