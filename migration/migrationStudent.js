import path from "path";
import { fileURLToPath } from "url";
import pool from "../config/db.js";
import {
    buildNewOnlySummary,
    buildPagination,
    DEFAULT_PAGE_SIZE,
    PAGE_SIZE_OPTIONS,
    statusFromIssueCounts
} from "./migrationPreviewCommon.js";
import { readSourceRecords } from "./migrationImportCommon.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const csvPath = path.join(__dirname, "tblKumonData.txt");

// tblKumonData.txt has no header row (Access "Export - Text File" export) —
// this is the column order from the original tblKumonData.csv header.
const SOURCE_COLUMNS = [
    "ID",
    "Prefix",
    "FirstName",
    "LastName",
    "NickName",
    "IDKumonStudent",
    "BirthDate",
    "EnrolmentDate",
    "Sex",
    "School",
    "Class",
    "Grade",
    "Telephone",
    "Kumon",
    "Day1",
    "Time1",
    "Day2",
    "Time2",
    "StartDate",
    "StartLevel",
    "Subject",
    "Level",
    "LevelZ",
    "FreeStudy",
    "IDFreeStudy",
    "FullExemption",
    "Parents",
    "ParentStatus",
    "Address1",
    "Address2",
    "Address3",
    "Address_Number",
    "Address_Village",
    "Address_Alley",
    "Address_Road",
    "Address_District1",
    "Address_District2",
    "Address_Province",
    "Address_Zipcode",
    "Status",
    "MonthStatus",
    "YearStatus",
    "DTTest",
    "TestDate",
    "Detail"
];

const ISSUE_SAMPLE_COUNT = 5;
const STUDENT_TEXT_LIMITS = [
    { key: "first_name", label: "First Name", max: 100 },
    { key: "last_name", label: "Last Name", max: 100 },
    { key: "nickname", label: "Nickname", max: 100 },
    { key: "school_name", label: "School", max: 150 },
    { key: "mobile", label: "Mobile", max: 20 },
    { key: "email", label: "Email", max: 150 },
    { key: "address_number", label: "Address No.", max: 50 },
    { key: "address_village", label: "Village", max: 100 },
    { key: "address_alley", label: "Alley", max: 100 },
    { key: "address_road", label: "Road", max: 100 },
    { key: "address_subdistrict", label: "Subdistrict", max: 100 },
    { key: "address_district", label: "District", max: 100 },
    { key: "address_province", label: "Province", max: 100 },
    { key: "address_zipcode", label: "Zipcode", max: 10 }
];

function clean(value) {
    if (value === undefined || value === null) {
        return "";
    }

    return String(value)
        .replace(/\uFEFF/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function nullable(value) {
    const text = clean(value);

    return text || null;
}

function lookupKey(value) {
    return clean(value).toLowerCase();
}

function studentKey(firstName, lastName) {
    return `${lookupKey(firstName)}|${lookupKey(lastName)}`;
}

function pad2(value) {
    return String(value).padStart(2, "0");
}

function isValidDate(year, month, day) {
    const date = new Date(Date.UTC(year, month - 1, day));

    return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
    );
}

function parseDateToAd(value) {
    const text = clean(value);

    if (!text) {
        return { value: null, error: null };
    }

    let day;
    let month;
    let year;

    const dmyMatch = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/);
    const ymdMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/);

    if (dmyMatch) {
        day = Number(dmyMatch[1]);
        month = Number(dmyMatch[2]);
        year = Number(dmyMatch[3]);
    } else if (ymdMatch) {
        year = Number(ymdMatch[1]);
        month = Number(ymdMatch[2]);
        day = Number(ymdMatch[3]);
    } else {
        return {
            value: null,
            error: `Unsupported date format: ${text}`
        };
    }

    if (year < 100) {
        year += year >= 70 ? 1900 : 2000;
    }

    if (year > 2400) {
        year -= 543;
    }

    if (!isValidDate(year, month, day)) {
        return {
            value: null,
            error: `Invalid date: ${text}`
        };
    }

    return {
        value: `${year}-${pad2(month)}-${pad2(day)}`,
        error: null
    };
}

function addIssue(issueMap, value, student, message) {
    const issueValue = clean(value) || "(blank)";
    let issue = issueMap.get(issueValue);

    if (!issue) {
        issue = {
            value: issueValue,
            count: 0,
            examples: []
        };

        issueMap.set(issueValue, issue);
    }

    issue.count++;

    if (issue.examples.length < ISSUE_SAMPLE_COUNT) {
        issue.examples.push({
            csv_row: student.csvRow,
            name: `${student.firstName} ${student.lastName}`,
            message
        });
    }
}

function issueList(issueMap) {
    return [...issueMap.values()]
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

function issueCount(issueMap) {
    return [...issueMap.values()]
        .reduce((sum, issue) => sum + issue.count, 0);
}

function issueMessage(issueMap) {
    const list = issueList(issueMap).slice(0, ISSUE_SAMPLE_COUNT);

    if (list.length === 0) {
        return "";
    }

    return list
        .map((issue) => {
            const rows = issue.examples
                .map((example) => example.csv_row)
                .join(", ");

            return `${issue.value} (${issue.count} rows; CSV row ${rows})`;
        })
        .join(" | ");
}

function truncateTextLengths(row, student, issues) {
    for (const limit of STUDENT_TEXT_LIMITS) {
        const value = row[limit.key];

        if (!value || String(value).length <= limit.max) {
            continue;
        }

        const text = String(value);

        addIssue(
            issues.textLength,
            `${limit.label}: ${text.slice(0, 80)}`,
            student,
            `${limit.label} was truncated from ${text.length} to ${limit.max} characters.`
        );

        row[limit.key] = text.slice(0, limit.max);
    }
}

async function loadMasterData(db = pool) {
    const [
        prefixResult,
        genderResult,
        schoolGradeResult,
        studentResult
    ] = await Promise.all([
        db.query(`
            SELECT prefix_id, prefix_name
            FROM prefix_master
            ORDER BY prefix_id
        `),
        db.query(`
            SELECT gender_id, gender_name
            FROM gender_master
            ORDER BY gender_id
        `),
        db.query(`
            SELECT school_grade_id, school_class, school_grade
            FROM school_grade_master
            ORDER BY school_grade_id
        `),
        db.query(`
            SELECT student_id, first_name, last_name
            FROM student
            ORDER BY student_id
        `)
    ]);

    return {
        prefixes: prefixResult.rows,
        genders: genderResult.rows,
        schoolGrades: schoolGradeResult.rows,
        prefixByName: new Map(
            prefixResult.rows.map((row) => [
                lookupKey(row.prefix_name),
                row.prefix_id
            ])
        ),
        genderByName: new Map(
            genderResult.rows.map((row) => [
                lookupKey(row.gender_name),
                row.gender_id
            ])
        ),
        schoolGradeByClass: new Map(
            schoolGradeResult.rows.map((row) => [
                lookupKey(row.school_class),
                row.school_grade_id
            ])
        ),
        schoolGradeByGrade: new Map(
            schoolGradeResult.rows.map((row) => [
                lookupKey(row.school_grade),
                row.school_grade_id
            ])
        ),
        studentsByName: new Map(
            studentResult.rows.map((student) => [
                studentKey(student.first_name, student.last_name),
                student
            ])
        )
    };
}

function resolvePrefixId(record, student, masters, issues, blockingRows) {
    const prefix = clean(record.Prefix);
    const prefixId = masters.prefixByName.get(lookupKey(prefix));

    if (!prefixId) {
        addIssue(
            issues.prefix,
            prefix,
            student,
            "No matching prefix_master.prefix_name. student.prefix_id is required."
        );

        blockingRows.add(student.key);

        return null;
    }

    return prefixId;
}

function resolveGenderId(record, student, masters, issues) {
    const gender = clean(record.Sex);

    if (!gender) {
        return null;
    }

    const genderId = masters.genderByName.get(lookupKey(gender));

    if (!genderId) {
        addIssue(
            issues.gender,
            gender,
            student,
            "No matching gender_master.gender_name."
        );

        return null;
    }

    return genderId;
}

function resolveSchoolGradeId(record, student, masters, issues) {
    const schoolClass = clean(record.Class);
    const schoolGrade = clean(record.Grade);
    const classId = schoolClass
        ? masters.schoolGradeByClass.get(lookupKey(schoolClass))
        : null;
    const gradeId = schoolGrade
        ? masters.schoolGradeByGrade.get(lookupKey(schoolGrade))
        : null;

    if (classId && gradeId && classId !== gradeId) {
        addIssue(
            issues.schoolGrade,
            `${schoolClass} / ${schoolGrade}`,
            student,
            "CSV Class and Grade match different school_grade_master rows."
        );

        return null;
    }

    if (classId) {
        return classId;
    }

    if (gradeId) {
        return gradeId;
    }

    if (schoolClass || schoolGrade) {
        addIssue(
            issues.schoolGrade,
            `${schoolClass || "(blank)"} / ${schoolGrade || "(blank)"}`,
            student,
            "No matching school_grade_master.school_class or school_grade."
        );
    }

    return null;
}

function buildStudentPreview(student, masters, issues, blockingRows) {
    const record = student.record;
    const birthDate = parseDateToAd(record.BirthDate);

    if (birthDate.error) {
        addIssue(
            issues.birthDate,
            record.BirthDate,
            student,
            birthDate.error
        );
    }

    const row = {
        prefix_id: resolvePrefixId(record, student, masters, issues, blockingRows),
        first_name: student.firstName,
        last_name: student.lastName,
        nickname: nullable(record.NickName),
        gender_id: resolveGenderId(record, student, masters, issues),
        birth_date: birthDate.value,
        school_grade_id: resolveSchoolGradeId(record, student, masters, issues),
        school_name: nullable(record.School),
        mobile: nullable(record.Telephone),
        email: null,
        address_number: nullable(record.Address_Number),
        address_village: nullable(record.Address_Village),
        address_alley: nullable(record.Address_Alley),
        address_road: nullable(record.Address_Road),
        address_subdistrict: nullable(record.Address_District1),
        address_district: nullable(record.Address_District2),
        address_province: nullable(record.Address_Province),
        address_zipcode: nullable(record.Address_Zipcode),
        remark: nullable(record.Detail)
    };

    truncateTextLengths(row, student, issues);

    return row;
}

function printIssueSection(title, issues) {
    const list = issueList(issues);

    console.log(`${title}: ${list.reduce((sum, issue) => sum + issue.count, 0)}`);

    if (list.length === 0) {
        return;
    }

    console.dir(list, { depth: null });
}

const STUDENT_COLUMNS = [
    { key: "row_number", label: "#" },
    { key: "prefix_id", label: "Prefix" },
    { key: "first_name", label: "First Name" },
    { key: "last_name", label: "Last Name" },
    { key: "nickname", label: "Nickname" },
    { key: "gender_id", label: "Gender" },
    { key: "birth_date", label: "Birth Date" },
    { key: "school_grade_id", label: "Grade" },
    { key: "school_name", label: "School" },
    { key: "mobile", label: "Mobile" },
    { key: "email", label: "Email" },
    { key: "address_number", label: "Address No." },
    { key: "address_village", label: "Village" },
    { key: "address_alley", label: "Alley" },
    { key: "address_road", label: "Road" },
    { key: "address_subdistrict", label: "Subdistrict" },
    { key: "address_district", label: "District" },
    { key: "address_province", label: "Province" },
    { key: "address_zipcode", label: "Zipcode" },
    { key: "remark", label: "Remark" },
    { key: "created_at", label: "Created At", defaultValue: "DB default" },
    { key: "updated_at", label: "Updated At", defaultValue: "DB default" }
];

function hasValidationErrors(previewResult) {
    return previewResult.validation.some((item) =>
        String(item.status || "").toUpperCase() === "ERROR"
    );
}

function validationErrorCount(previewResult) {
    return previewResult.validation
        .filter((item) => String(item.status || "").toUpperCase() === "ERROR")
        .reduce((sum, item) => sum + Number(item.errors || 0), 0);
}

async function prepareStudentPreviewData(db = pool) {
    const records = readSourceRecords(csvPath, SOURCE_COLUMNS);

    const masters = await loadMasterData(db);
    const students = new Map();

    let duplicateCount = 0;
    let missingNameCount = 0;

    for (const [index, record] of records.entries()) {
        const firstName = clean(record.FirstName);
        const lastName = clean(record.LastName);

        if (!firstName || !lastName) {
            missingNameCount++;
            continue;
        }

        const key = studentKey(firstName, lastName);

        if (students.has(key)) {
            duplicateCount++;
            continue;
        }

        students.set(key, {
            key,
            csvRow: index + 2,
            firstName,
            lastName,
            record
        });
    }

    const issues = {
        prefix: new Map(),
        gender: new Map(),
        schoolGrade: new Map(),
        birthDate: new Map(),
        textLength: new Map()
    };
    const blockingRows = new Set();
    const studentItems = [...students.values()];
    const previewRows = studentItems.map((student) =>
        buildStudentPreview(student, masters, issues, blockingRows)
    );

    const lookupErrors = {
        prefix: issueCount(issues.prefix),
        gender: issueCount(issues.gender),
        schoolGrade: issueCount(issues.schoolGrade),
        birthDate: issueCount(issues.birthDate),
        textLength: issueCount(issues.textLength)
    };

    const errorTotal = [
        lookupErrors.prefix,
        lookupErrors.gender,
        lookupErrors.schoolGrade,
        lookupErrors.birthDate,
        missingNameCount
    ].reduce((sum, count) => sum + count, 0);
    const warningTotal = lookupErrors.textLength;

    const classifiedRows = previewRows.map((row, index) => {
        const student = studentItems[index];
        const existingStudent = masters.studentsByName.get(student.key);
        const hasBlockingError = blockingRows.has(student.key);
        const importAction = hasBlockingError
            ? "BLOCK"
            : existingStudent
                ? "SKIP"
                : "INSERT";

        return {
            row_number: index + 1,
            import_action: importAction,
            preview_status: hasBlockingError ? "ERROR" : "READY",
            existing_student_id: existingStudent?.student_id || null,
            ...row
        };
    });
    const insertRows = classifiedRows.filter((row) =>
        row.import_action === "INSERT"
    );
    const existingCount = classifiedRows.filter((row) =>
        row.import_action === "SKIP"
    ).length;
    const blockedRowCount = classifiedRows.filter((row) =>
        row.import_action === "BLOCK"
    ).length;
    const skippedCount = existingCount + duplicateCount;
    const rows = insertRows.map(({ import_action, preview_status, existing_student_id, ...row }, index) => ({
        ...row,
        row_number: index + 1
    }));
    const status = statusFromIssueCounts(errorTotal, warningTotal);

    const result = {
        module: "student",
        title: "Student",
        status,

        summary: buildNewOnlySummary({
            records: records.length,
            newRows: rows.length,
            skipped: skippedCount,
            errors: errorTotal,
            warnings: warningTotal,
            details: [
                { label: "Existing", value: existingCount },
                { label: "Duplicate", value: duplicateCount },
                { label: "Blocked", value: blockedRowCount },
                { label: "Missing Name", value: missingNameCount }
            ]
        }),

        validation: [
            { label: "Prefix Master", status: lookupErrors.prefix === 0 ? "READY" : "ERROR", errors: lookupErrors.prefix },
            { label: "Gender Master", status: lookupErrors.gender === 0 ? "READY" : "ERROR", errors: lookupErrors.gender },
            { label: "School Grade Master", status: lookupErrors.schoolGrade === 0 ? "READY" : "ERROR", errors: lookupErrors.schoolGrade },
            { label: "Birth Date", status: lookupErrors.birthDate === 0 ? "READY" : "ERROR", errors: lookupErrors.birthDate },
            {
                label: "Column Length Truncation",
                status: lookupErrors.textLength === 0 ? "READY" : "WARNING",
                errors: 0,
                warnings: lookupErrors.textLength,
                message: issueMessage(issues.textLength)
            }
        ],

        columns: STUDENT_COLUMNS,
        rows,
        pagination: buildPagination(rows),

        csvRecords: records.length,
        uniqueStudents: students.size,
        duplicateCount,
        missingNameCount,
        blockedRows: blockedRowCount,
        lookupErrors,
        previewRows: rows
    };

    return {
        result,
        rows,
        records,
        students
    };
}

export async function previewStudent() {
    const { result } = await prepareStudentPreviewData();

    return result;
}

export async function importStudent() {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const { result, rows } = await prepareStudentPreviewData(client);

        if (hasValidationErrors(result)) {
            await client.query("ROLLBACK");
            const errorCount = validationErrorCount(result) || 1;

            return {
                module: "student",
                title: "Student Import",
                status: "ERROR",
                message: "Student import stopped because preview validation has blocking errors.",
                summary: [
                    { label: "Inserted", value: 0 },
                    { label: "Skipped", value: 0 },
                    { label: "Errors", value: errorCount },
                    { label: "Preview Rows", value: rows.length }
                ],
                validation: result.validation,
                columns: STUDENT_COLUMNS,
                rows: [],
                pagination: {
                    page: 1,
                    pageSize: DEFAULT_PAGE_SIZE,
                    pageSizeOptions: PAGE_SIZE_OPTIONS,
                    totalRows: 0,
                    totalPages: 0,
                    startRow: 0,
                    endRow: 0
                },
                insertedCount: 0,
                skippedCount: 0,
                errorCount
            };
        }

        const existingResult = await client.query(`
            SELECT student_id, first_name, last_name
            FROM student
            ORDER BY student_id
        `);
        const existingByKey = new Map(
            existingResult.rows.map((student) => [
                studentKey(student.first_name, student.last_name),
                student
            ])
        );
        const importRows = [];
        let insertedCount = 0;
        let skippedCount = 0;
        const previewSkippedCount =
            result.summary.find((item) => item.label === "Skipped")?.value || 0;

        for (const row of rows) {
            const key = studentKey(row.first_name, row.last_name);
            const existingStudent = existingByKey.get(key);

            if (existingStudent) {
                skippedCount++;
                importRows.push({
                    row_number: importRows.length + 1,
                    action: "SKIP",
                    student_id: existingStudent.student_id,
                    first_name: row.first_name,
                    last_name: row.last_name,
                    message: "Existing student matched by normalized first_name + last_name."
                });
                continue;
            }

            const insertResult = await client.query(
                `
                    INSERT INTO student (
                        prefix_id,
                        first_name,
                        last_name,
                        nickname,
                        gender_id,
                        birth_date,
                        school_grade_id,
                        school_name,
                        mobile,
                        email,
                        address_number,
                        address_village,
                        address_alley,
                        address_road,
                        address_subdistrict,
                        address_district,
                        address_province,
                        address_zipcode,
                        remark
                    )
                    VALUES (
                        $1, $2, $3, $4, $5,
                        $6, $7, $8, $9, $10,
                        $11, $12, $13, $14, $15,
                        $16, $17, $18, $19
                    )
                    RETURNING student_id
                `,
                [
                    row.prefix_id,
                    row.first_name,
                    row.last_name,
                    row.nickname,
                    row.gender_id,
                    row.birth_date,
                    row.school_grade_id,
                    row.school_name,
                    row.mobile,
                    row.email,
                    row.address_number,
                    row.address_village,
                    row.address_alley,
                    row.address_road,
                    row.address_subdistrict,
                    row.address_district,
                    row.address_province,
                    row.address_zipcode,
                    row.remark
                ]
            );
            const insertedStudent = insertResult.rows[0];

            insertedCount++;
            existingByKey.set(key, {
                student_id: insertedStudent.student_id,
                first_name: row.first_name,
                last_name: row.last_name
            });
            importRows.push({
                row_number: importRows.length + 1,
                action: "INSERT",
                student_id: insertedStudent.student_id,
                first_name: row.first_name,
                last_name: row.last_name,
                message: "Inserted missing student."
            });
        }

        await client.query("COMMIT");

        return {
            module: "student",
            title: "Student Import",
            status: "READY",
            summary: [
                { label: "Inserted", value: insertedCount },
                { label: "Skipped", value: previewSkippedCount + skippedCount },
                { label: "Errors", value: 0 },
                { label: "Preview Rows", value: rows.length }
            ],
            validation: [
                { label: "Preview Validation", status: "READY", errors: 0 },
                { label: "Transaction", status: "READY", errors: 0 }
            ],
            columns: [
                { key: "row_number", label: "#" },
                { key: "action", label: "Action" },
                { key: "student_id", label: "Student ID" },
                { key: "first_name", label: "First Name" },
                { key: "last_name", label: "Last Name" },
                { key: "message", label: "Message" }
            ],
            rows: importRows,
            pagination: {
                page: 1,
                pageSize: DEFAULT_PAGE_SIZE,
                pageSizeOptions: PAGE_SIZE_OPTIONS,
                totalRows: importRows.length,
                totalPages: Math.ceil(importRows.length / DEFAULT_PAGE_SIZE),
                startRow: importRows.length > 0 ? 1 : 0,
                endRow: Math.min(DEFAULT_PAGE_SIZE, importRows.length)
            },
            insertedCount,
            skippedCount: previewSkippedCount + skippedCount,
            errorCount: 0
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}
