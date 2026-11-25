// A preview is not a reserved receipt number. Compare it again under the
// ledger lock before payment, including when another cashier has saved first.
export function receiptSnapshot(receipt) {
    const number = value => Number(value || 0);
    const money = value => Math.round(number(value) * 100);
    const text = value => String(value ?? '');
    return JSON.stringify({
        version: 1,
        student: number(receipt.studentId),
        name: text(receipt.studentName),
        center: text(receipt.center?.centerName),
        book: number(receipt.receiptBook),
        no: number(receipt.receiptNo),
        date: text(receipt.billingDate),
        month: number(receipt.billingMonth),
        year: number(receipt.billingYear),
        method: number(receipt.paymentMethodId),
        total: money(receipt.totalAmount),
        discount: money(receipt.discountAmount),
        net: money(receipt.netAmount),
        details: (receipt.receiptDetails || []).map(detail => ({
            enrollment: number(detail.enrollmentId),
            subject: text(detail.subjectCode),
            level: text(detail.currentLevelCode),
            zun: text(detail.currentZunLevelCode),
            special: text(detail.statusGroup2Name),
            tuition: money(detail.tuitionFee),
            registration: money(detail.registrationFee),
            additional: money(detail.additionalFee),
            discount: money(detail.discountAmount),
            net: money(detail.netAmount)
        })).sort((a, b) => a.enrollment - b.enrollment)
    });
}
