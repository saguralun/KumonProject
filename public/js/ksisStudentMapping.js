export function splitKsisStreet(value) {
    const original = String(value || "").trim();
    const numeric = (part) => /^[0-9๐-๙]+$/.test(part);
    if (numeric(original)) return { alley: original, road: "", unparsed: "" };
    if (/^\p{L}/u.test(original)) return { alley: "", road: original, unparsed: "" };
    const combined = original.match(/^([0-9๐-๙]+)\s+(\p{L}.*)$/u);
    if (combined) return { alley: combined[1], road: combined[2], unparsed: "" };
    return { alley: "", road: "", unparsed: original };
}

function bangkokToday() {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const part = (type) => parts.find((item) => item.type === type).value;
    return `${part("year")}-${part("month")}-${part("day")}`;
}

export function ksisPrefixName(birthDate, gender, today = bangkokToday()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate || "") || birthDate > today || !["ชาย", "หญิง"].includes(gender)) return "";
    const [year, month, day] = birthDate.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
    let age = Number(today.slice(0, 4)) - year;
    if (today.slice(5) < birthDate.slice(5)) age--;
    return gender === "ชาย" ? age >= 15 ? "นาย" : "ด.ช." : age >= 15 ? "นางสาว" : "ด.ญ.";
}

export function ksisPreviewFields(student, masters) {
    const gender = masters.genders.find((row) => row.name === student.gender);
    const grade = masters.grades.find((row) => row.label.endsWith(`(${student.grade})`));
    const street = splitKsisStreet(student.addressLine2);
    const prefixName = ksisPrefixName(student.birthDate, student.gender);
    const prefix = (masters.prefixes || []).find((row) => row.name === prefixName);
    return [
        { field: "prefixId", label: "คำนำหน้า", value: prefix?.id || "", display: prefixName },
        { field: "firstName", label: "ชื่อ", value: student.firstName },
        { field: "lastName", label: "นามสกุล", value: student.lastName },
        { field: "birthDate", label: "วันเกิด", value: student.birthDate },
        { field: "genderId", label: "เพศ", value: gender?.id || "", display: student.gender },
        { field: "schoolGradeId", label: "ชั้นเรียน", value: grade?.id || "", display: grade?.label || student.grade },
        { field: "schoolName", label: "โรงเรียน", value: student.schoolName },
        { field: "mobile", label: "เบอร์โทร", value: student.mobile },
        ...(student.emailCandidates?.length
            ? student.emailCandidates.map((item, index) => ({ field: "email", label: `Email (${item.source})`, value: item.email, selected: index === 0, radio: true }))
            : [{ field: "email", label: "Email", value: student.email }]),
        { field: "addressZipcode", label: "รหัสไปรษณีย์", value: student.addressZipcode },
        { field: "addressProvince", label: "จังหวัด", value: student.addressProvince },
        { field: "addressDistrict", label: "อำเภอ", value: student.addressDistrict },
        { field: "addressSubdistrict", label: "ตำบล", value: student.addressSubdistrict },
        { field: "addressNumber", label: "เลขที่", value: student.addressNumber },
        ...(street.alley || street.road ? [
            { field: "addressAlley", label: "ซอย", value: street.alley },
            { field: "addressRoad", label: "ถนน", value: street.road }
        ] : [{ field: "remark", label: "ซอย/ถนน (เก็บในหมายเหตุ)", value: street.unparsed ? `KSIS ซอย/ถนน: ${street.unparsed}` : "" }]),
        { field: null, label: "รหัสคุมอง (ข้อมูลวิชา)", value: "", display: student.kumonStudentId }
    ].map((row) => ({ ...row, value: row.value ?? "" }));
}
