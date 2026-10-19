import { httpError } from "./httpError.js";

export function normalizeKsisStudentUrl(value) {
    let url;
    try { url = new URL(String(value || "").trim()); } catch { throw httpError(400, "ลิงก์ KSIS ไม่ถูกต้อง"); }
    if (url.origin !== "https://kao.ksis.kumon.com" || url.pathname !== "/kth/"
        || url.username || url.password || url.search
        || !/^#\/student\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(url.hash)) {
        throw httpError(400, "กรุณาใช้ลิงก์หน้าข้อมูลนักเรียน KSIS เท่านั้น");
    }
    return url.href;
}

// Runs inside KSIS. Contact email is optional; never read credentials, IDs, or consent data.
export function readKsisStudentDocument() {
    const value = (id) => document.getElementById(id)?.value?.trim() || "";
    const selected = (id) => document.getElementById(id)?.selectedOptions?.[0]?.textContent?.trim() || "";
    const studentText = document.getElementById("student")?.innerText || "";
    const emailCandidates = [
        ["guardianMother", "มารดา"], ["guardianFather", "บิดา"], ["guardianOther", "ผู้ปกครอง"]
    ].flatMap(([prefix, source]) => {
        const field = document.getElementById(`${prefix}Email`);
        const reason = selected(`${prefix}EmailPresence`);
        if (!field || field.disabled || (reason && reason !== "---")) return [];
        const email = field.value?.trim() || "";
        return email ? [{ source, email }] : [];
    });
    if (value("email")) emailCandidates.push({ source: "นักเรียน", email: value("email") });
    return {
        firstName: value("firstName"), lastName: value("lastName"),
        birthDate: value("dateOfBirth"), gender: selected("gender"),
        grade: selected("gradeLevel"), schoolName: value("schoolName"),
        mobile: value("phoneHP"), email: value("email"), emailCandidates,
        addressNumber: value("studentAddress1"), addressLine2: value("studentAddress2"),
        addressSubdistrict: value("studentAddress3"), addressProvince: selected("studentStateCd"),
        addressDistrict: selected("studentCityCd") || value("studentCityName"),
        addressZipcode: value("studentZipCd"),
        kumonStudentId: studentText.match(/รหัสนักเรียน\s*[:：]\s*([A-Za-z0-9-]+)/)?.[1] || ""
    };
}

export function normalizeKsisBirthDate(value) {
    const text = String(value || "").trim();
    const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!match) return "";
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]) > 2400 ? Number(match[3]) - 543 : Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (year < 1900 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function normalizeKsisStudentData(raw) {
    const text = (field) => String(raw[field] || "").trim().slice(0, 500);
    if (!text("firstName") || !text("lastName")) throw httpError(422, "ยังอ่านชื่อและนามสกุลจาก KSIS ไม่ได้ กรุณารอให้หน้าข้อมูลนักเรียนโหลดครบ");
    const allowedSources = ["มารดา", "บิดา", "ผู้ปกครอง", "นักเรียน"];
    const candidates = Array.isArray(raw.emailCandidates) ? Array.from(raw.emailCandidates) : [];
    const emailCandidates = candidates.filter((item) => allowedSources.includes(item?.source)
        && typeof item.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.email.trim()))
        .map((item) => ({ source: item.source, email: item.email.trim().slice(0, 254) }));
    if (!emailCandidates.length && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text("email"))) emailCandidates.push({ source: "นักเรียน", email: text("email") });
    return {
        firstName: text("firstName"), lastName: text("lastName"),
        birthDate: normalizeKsisBirthDate(raw.birthDate), gender: text("gender"),
        grade: text("grade"), schoolName: text("schoolName"),
        mobile: text("mobile"), email: emailCandidates[0]?.email || "", emailCandidates,
        addressNumber: text("addressNumber"), addressLine2: text("addressLine2"),
        addressSubdistrict: text("addressSubdistrict"), addressProvince: text("addressProvince"),
        addressDistrict: text("addressDistrict"), addressZipcode: text("addressZipcode"),
        kumonStudentId: text("kumonStudentId")
    };
}
