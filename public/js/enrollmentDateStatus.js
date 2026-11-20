// Shared by browser forms and the server: date changes only adjust the
// half-month variants. Exemptions and other explicitly chosen policies stay.
export function enrollmentMonthStart(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
}

export function canCorrectEnrollmentDateStatus(statusCode, unused = false) {
    return unused === true || ['N', 'EO'].includes(statusCode);
}

export function specialStatusForStartDate(code, dateText) {
    const day = Number(String(dateText || '').slice(8, 10));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText || '') || day < 1 || day > 31) return code;
    if (day >= 11 && day <= 20) {
        if (code === 'FS' || code === 'FSH') return 'FSH';
        return !code || code === 'H' ? 'H' : code;
    }
    return code === 'H' ? '' : code === 'FSH' ? 'FS' : code;
}
