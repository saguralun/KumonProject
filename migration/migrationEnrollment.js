import path from "path";
import { fileURLToPath } from "url";
import pool from "../config/db.js";
import {
    buildNewOnlySummary,
    buildPagination,
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
const ZUN_FALLBACK_SUBJECT_CODE = "ME";
const COMPLETER_LEVEL_BY_SUBJECT = {
    ME: "O",
    EFL: "O",
    TRP: "III"
};

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

function masterKey(...parts) {
    return parts.map((part) => lookupKey(part)).join("|");
}

function studentKey(firstName, lastName) {
    return masterKey(firstName, lastName);
}

function enrollmentKey(firstName, lastName, subjectCode) {
    return masterKey(firstName, lastName, subjectCode);
}

function toBoolean(value) {
    const text = lookupKey(value);

    return ["true", "t", "yes", "y", "1"].includes(text);
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
        return { value: null, error: "Date is required." };
    }

    let day;
    let month;
    let year;

    // Trailing " H:MM:SS" (Access datetime export) is ignored — the date
    // portion is all this function ever cared about.
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

function parseRequiredInteger(value, label) {
    const text = clean(value);

    if (!text) {
        return {
            value: null,
            error: `${label} is required.`
        };
    }

    if (!/^\d+$/.test(text)) {
        return {
            value: null,
            error: `${label} must be a positive integer.`
        };
    }

    const numberValue = Number(text);

    if (!Number.isSafeInteger(numberValue) || numberValue < 1) {
        return {
            value: null,
            error: `${label} must be a positive integer.`
        };
    }

    return {
        value: numberValue,
        error: null
    };
}

function parseOpeningTime(value) {
    const text = clean(value);

    if (!text) {
        return {
            value: null,
            hasInput: false,
            warning: null
        };
    }

    if (
        /^0{1,2}[/-]0?1[/-]1900$/.test(text) ||
        /^0{1,2}:00(?::00)?$/.test(text)
    ) {
        return {
            value: null,
            hasInput: false,
            isPlaceholder: true,
            warning: null
        };
    }

    // Access "Export - Text File" writes Date/Time fields as a full
    // datetime — a blank time comes through as its date-only epoch
    // (e.g. 30/12/1899, or 00/01/1900 from other export paths) glued to a
    // literal 0:00:00. Nobody has a class at midnight, so a zero time here
    // means "nothing was entered", not a real 00:00 slot.
    const dateTimeMatch = text.match(
        /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/
    );

    if (dateTimeMatch) {
        const hour = Number(dateTimeMatch[1]);
        const minute = Number(dateTimeMatch[2]);

        if (hour === 0 && minute === 0) {
            return {
                value: null,
                hasInput: false,
                isPlaceholder: true,
                warning: null
            };
        }

        if (hour > 23 || minute > 59) {
            return {
                value: null,
                hasInput: true,
                warning: `Invalid opening time: ${text}`
            };
        }

        return {
            value: `${pad2(hour)}:${pad2(minute)}`,
            hasInput: true,
            isPlaceholder: false,
            warning: null
        };
    }

    const timeMatch = text.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);

    if (!timeMatch) {
        return {
            value: null,
            hasInput: true,
            warning: `Unsupported opening time format: ${text}`
        };
    }

    const hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2]);

    if (hour > 23 || minute > 59) {
        return {
            value: null,
            hasInput: true,
            warning: `Invalid opening time: ${text}`
        };
    }

    return {
        value: `${pad2(hour)}:${pad2(minute)}`,
        hasInput: true,
        isPlaceholder: false,
        warning: null
    };
}

function normalizePgTime(value) {
    const text = clean(value);
    const match = text.match(/^(\d{1,2}):(\d{2})/);

    if (!match) {
        return text;
    }

    return `${pad2(Number(match[1]))}:${pad2(Number(match[2]))}`;
}

function addIssue(issueMap, value, enrollment, message) {
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
            csv_row: enrollment.csvRow,
            source_id: nullable(enrollment.record?.ID),
            name: `${clean(enrollment.firstName)} ${clean(enrollment.lastName)}`.trim(),
            subject: clean(enrollment.subjectCode),
            message
        });
    }
}

function addBlockingIssue(issues, blockingRows, category, value, enrollment, message) {
    addIssue(issues[category], value, enrollment, message);
    blockingRows.add(enrollment.key);
}

function addWarningIssue(warnings, warningRows, category, value, enrollment, message) {
    addIssue(warnings[category], value, enrollment, message);
    warningRows.add(enrollment.key);
}

function issueList(issueMap) {
    return [...issueMap.values()]
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

function issueCount(issueMap) {
    return [...issueMap.values()]
        .reduce((sum, issue) => sum + issue.count, 0);
}

function buildPreviewStudentIds(records) {
    const previewStudentIds = new Map();

    for (const record of records) {
        const firstName = clean(record.FirstName);
        const lastName = clean(record.LastName);

        if (!firstName || !lastName) {
            continue;
        }

        const key = studentKey(firstName, lastName);

        if (!previewStudentIds.has(key)) {
            previewStudentIds.set(key, previewStudentIds.size + 1);
        }
    }

    return previewStudentIds;
}

function sortedLevelCodes(levels) {
    return levels
        .map((level) => level.level_code)
        .sort((a, b) => b.length - a.length || a.localeCompare(b));
}

async function loadMasterData(records, db = pool) {
    const [
        subjectResult,
        levelResult,
        worksheetResult,
        statusResult,
        openingScheduleResult,
        studentResult,
        enrollmentResult
    ] = await Promise.all([
        db.query(`
            SELECT subject_id, subject_code, subject_name
            FROM subject_master
            ORDER BY subject_id
        `),
        db.query(`
            SELECT lm.level_master_id,
                   lm.subject_id,
                   sm.subject_code,
                   lm.level_code,
                   lm.level_type
            FROM level_master lm
            JOIN subject_master sm
                ON sm.subject_id = lm.subject_id
            ORDER BY lm.subject_id, LENGTH(lm.level_code) DESC, lm.level_code
        `),
        db.query(`
            SELECT wm.worksheet_master_id,
                   lm.subject_id,
                   sm.subject_code,
                   lm.level_code,
                   wm.worksheet_no
            FROM worksheet_master wm
            JOIN level_master lm
                ON lm.level_master_id = wm.level_master_id
            JOIN subject_master sm
                ON sm.subject_id = lm.subject_id
            ORDER BY lm.subject_id, lm.level_master_id, wm.worksheet_no
        `),
        db.query(`
            SELECT status_id, status_code, status_name, status_group
            FROM status_master
            ORDER BY status_id
        `),
        db.query(`
            SELECT os.opening_schedule_id,
                   wm.weekday_code,
                   wm.weekday_name,
                   os.start_time,
                   os.end_time
            FROM opening_schedule os
            JOIN weekday_master wm
                ON wm.weekday_id = os.weekday_id
            ORDER BY wm.weekday_id, os.start_time
        `),
        db.query(`
            SELECT student_id, first_name, last_name
            FROM student
            ORDER BY student_id
        `),
        db.query(`
            SELECT enrollment_id, student_id, subject_id
            FROM enrollment
            ORDER BY enrollment_id
        `)
    ]);

    const levelsBySubjectId = new Map();
    const zunLevelsBySubjectId = new Map();

    for (const level of levelResult.rows) {
        if (!levelsBySubjectId.has(level.subject_id)) {
            levelsBySubjectId.set(level.subject_id, []);
        }

        levelsBySubjectId.get(level.subject_id).push(level);

        if (level.level_type === 2) {
            if (!zunLevelsBySubjectId.has(level.subject_id)) {
                zunLevelsBySubjectId.set(level.subject_id, []);
            }

            zunLevelsBySubjectId.get(level.subject_id).push(level);
        }
    }

    const studentsByName = new Map();

    for (const student of studentResult.rows) {
        const key = studentKey(student.first_name, student.last_name);
        const matches = studentsByName.get(key) || [];

        matches.push(student);
        studentsByName.set(key, matches);
    }

    return {
        subjectsByCode: new Map(
            subjectResult.rows.map((subject) => [
                lookupKey(subject.subject_code),
                subject
            ])
        ),
        levelsBySubjectAndCode: new Map(
            levelResult.rows.map((level) => [
                masterKey(level.subject_id, level.level_code),
                level
            ])
        ),
        worksheetsBySubjectLevelNo: new Map(
            worksheetResult.rows.map((worksheet) => [
                masterKey(
                    worksheet.subject_id,
                    worksheet.level_code,
                    worksheet.worksheet_no
                ),
                worksheet
            ])
        ),
        statusGroup1ByName: new Map(
            statusResult.rows
                .filter((status) => status.status_group === 1)
                .map((status) => [
                    lookupKey(status.status_name),
                    status
                ])
        ),
        statusGroup2ByName: new Map(
            statusResult.rows
                .filter((status) => status.status_group === 2)
                .map((status) => [
                    lookupKey(status.status_name),
                    status
                ])
        ),
        openingScheduleByDayTime: new Map(
            openingScheduleResult.rows.flatMap((schedule) => {
                const time = normalizePgTime(schedule.start_time);

                return [
                    [
                        masterKey(schedule.weekday_name, time),
                        schedule
                    ],
                    [
                        masterKey(schedule.weekday_code, time),
                        schedule
                    ]
                ];
            })
        ),
        openingScheduleByDay: new Map(
            openingScheduleResult.rows.flatMap((schedule, index, schedules) => {
                const firstScheduleForDay = schedules.find((item) =>
                    item.weekday_code === schedule.weekday_code
                );

                if (firstScheduleForDay !== schedule) {
                    return [];
                }

                return [
                    [
                        masterKey(schedule.weekday_name),
                        schedule
                    ],
                    [
                        masterKey(schedule.weekday_code),
                        schedule
                    ]
                ];
            })
        ),
        levelCodesBySubjectId: new Map(
            [...levelsBySubjectId.entries()].map(([subjectId, levels]) => [
                subjectId,
                sortedLevelCodes(levels)
            ])
        ),
        zunLevelCodesBySubjectId: new Map(
            [...zunLevelsBySubjectId.entries()].map(([subjectId, levels]) => [
                subjectId,
                sortedLevelCodes(levels)
            ])
        ),
        fallbackZunSubject: subjectResult.rows.find(
            (subject) => subject.subject_code === ZUN_FALLBACK_SUBJECT_CODE
        ),
        previewStudentIds: buildPreviewStudentIds(records),
        studentsByName,
        enrollmentsById: new Map(
            enrollmentResult.rows.map((enrollment) => [
                String(enrollment.enrollment_id),
                enrollment
            ])
        ),
        enrollmentsByStudentSubject: new Map(
            enrollmentResult.rows.map((enrollment) => [
                masterKey(enrollment.student_id, enrollment.subject_id),
                enrollment
            ])
        ),
        importedStudentCount: studentResult.rows.length
    };
}

function parseLevelCode(value, candidateCodes) {
    const text = clean(value).toUpperCase();

    if (!text) {
        return {
            levelCode: null,
            error: "Level is required."
        };
    }

    for (const code of candidateCodes) {
        if (text === code) {
            return {
                levelCode: code,
                error: null
            };
        }

        const suffix = text.slice(code.length);

        if (text.startsWith(code) && /^\d+$/.test(suffix)) {
            return {
                levelCode: code,
                error: null
            };
        }
    }

    const completerMatch = text.match(/^CP\d*$/);

    if (completerMatch) {
        return {
            levelCode: "CP",
            error: null
        };
    }

    return {
        levelCode: null,
        error: `Cannot derive level code from: ${text}`
    };
}

function parseWorksheetReference(value, candidateCodes) {
    const text = clean(value).toUpperCase();

    if (!text) {
        return {
            levelCode: null,
            worksheetNo: null,
            error: "Starting worksheet is required."
        };
    }

    for (const code of candidateCodes) {
        const suffix = text.slice(code.length);

        if (text.startsWith(code) && /^\d+$/.test(suffix)) {
            return {
                levelCode: code,
                worksheetNo: Number(suffix),
                error: null
            };
        }
    }

    return {
        levelCode: null,
        worksheetNo: null,
        error: `Cannot derive level and worksheet number from: ${text}`
    };
}

function resolveStudentId(enrollment, masters, issues, blockingRows, options = {}) {
    const key = studentKey(enrollment.firstName, enrollment.lastName);

    if (!enrollment.firstName || !enrollment.lastName) {
        addBlockingIssue(
            issues,
            blockingRows,
            "student",
            `${enrollment.firstName || "(blank)"} ${enrollment.lastName || "(blank)"}`,
            enrollment,
            "Student first_name and last_name are required to resolve student_id."
        );

        return null;
    }

    if (masters.importedStudentCount === 0 && !options.requireImportedStudents) {
        const previewStudentId = masters.previewStudentIds.get(key);

        if (!previewStudentId) {
            addBlockingIssue(
                issues,
                blockingRows,
                "student",
                `${enrollment.firstName} ${enrollment.lastName}`,
                enrollment,
                "No matching preview student_id could be derived."
            );
        }

        return previewStudentId || null;
    }

    const matches = masters.studentsByName.get(key) || [];

    if (matches.length === 1) {
        return matches[0].student_id;
    }

    addBlockingIssue(
        issues,
        blockingRows,
        "student",
        `${enrollment.firstName} ${enrollment.lastName}`,
        enrollment,
        matches.length === 0
            ? "No matching imported student found by first_name + last_name."
            : "Multiple imported students matched first_name + last_name."
    );

    return null;
}

function resolveSubject(enrollment, masters, issues, blockingRows) {
    const subjectCode = clean(enrollment.subjectCode);
    const subject = masters.subjectsByCode.get(lookupKey(subjectCode));

    if (!subject) {
        addBlockingIssue(
            issues,
            blockingRows,
            "subject",
            subjectCode,
            enrollment,
            "No matching subject_master.subject_code. enrollment.subject_id is required."
        );
    }

    return subject || null;
}

function resolveCurrentLevel(enrollment, subject, masters, issues, blockingRows) {
    if (!subject) {
        return {
            id: null,
            code: null
        };
    }

    const rawLevel = clean(enrollment.record.Level).toUpperCase();

    if (/^CP\d*$/.test(rawLevel)) {
        const completerLevelCode =
            COMPLETER_LEVEL_BY_SUBJECT[subject.subject_code];

        const level = masters.levelsBySubjectAndCode.get(
            masterKey(subject.subject_id, completerLevelCode)
        );

        if (!level) {
            addBlockingIssue(
                issues,
                blockingRows,
                "currentLevel",
                `${subject.subject_code} / ${rawLevel} -> ${completerLevelCode}`,
                enrollment,
                "No matching final completer level in level_master."
            );

            return {
                id: null,
                code: completerLevelCode || rawLevel
            };
        }

        return {
            id: level.level_master_id,
            code: completerLevelCode
        };
    }
    
    const candidateCodes =
        masters.levelCodesBySubjectId.get(subject.subject_id) || [];

    const parsed = parseLevelCode(
        enrollment.record.Level,
        candidateCodes
    );

    if (parsed.error) {
        addBlockingIssue(
            issues,
            blockingRows,
            "currentLevel",
            `${subject.subject_code} / ${clean(enrollment.record.Level)}`,
            enrollment,
            parsed.error
        );

        return {
            id: null,
            code: null
        };
    }

    const level = masters.levelsBySubjectAndCode.get(
        masterKey(subject.subject_id, parsed.levelCode)
    );

    if (!level) {
        addBlockingIssue(
            issues,
            blockingRows,
            "currentLevel",
            `${subject.subject_code} / ${clean(enrollment.record.Level)} -> ${parsed.levelCode}`,
            enrollment,
            "No matching level_master row for current_level_master_id."
        );

        return {
            id: null,
            code: parsed.levelCode
        };
    }

    return {
        id: level.level_master_id,
        code: parsed.levelCode
    };

}

function resolveZunLevel(enrollment, subject, masters, warnings, warningRows) {
    const rawLevelZ = clean(enrollment.record.LevelZ);

    if (!rawLevelZ || !subject || !masters.fallbackZunSubject) {
        return {
            id: null
        };
    }

    const fallbackSubject = masters.fallbackZunSubject;
    const candidateCodes = masters.zunLevelCodesBySubjectId.get(fallbackSubject.subject_id) || [];
    const parsed = parseLevelCode(rawLevelZ, candidateCodes);

    if (parsed.error) {
        addWarningIssue(
            warnings,
            warningRows,
            "zunLevel",
            rawLevelZ,
            enrollment,
            parsed.error
        );

        return {
            id: null
        };
    }

    const level = masters.levelsBySubjectAndCode.get(
        masterKey(fallbackSubject.subject_id, parsed.levelCode)
    );

    if (!level) {
        addWarningIssue(
            warnings,
            warningRows,
            "zunLevel",
            `${rawLevelZ} -> ${parsed.levelCode}`,
            enrollment,
            "No matching ZUN level_master row. current_zun_level_master_id will be null."
        );

        return {
            id: null
        };
    }

    return {
        id: level.level_master_id
    };
}

function resolveStartingWorksheet(enrollment, subject, masters, issues, blockingRows) {
    if (!subject) {
        return {
            id: null,
            levelCode: null,
            worksheetNo: null
        };
    }

    const candidateCodes = masters.levelCodesBySubjectId.get(subject.subject_id) || [];
    const parsed = parseWorksheetReference(enrollment.record.StartLevel, candidateCodes);

    if (parsed.error) {
        addBlockingIssue(
            issues,
            blockingRows,
            "startingWorksheet",
            enrollment.record.StartLevel,
            enrollment,
            parsed.error
        );

        return {
            id: null,
            levelCode: parsed.levelCode,
            worksheetNo: parsed.worksheetNo
        };
    }

    const worksheet = masters.worksheetsBySubjectLevelNo.get(
        masterKey(subject.subject_id, parsed.levelCode, parsed.worksheetNo)
    );

    if (!worksheet) {
        addBlockingIssue(
            issues,
            blockingRows,
            "startingWorksheet",
            `${subject.subject_code} / ${enrollment.record.StartLevel} -> ${parsed.levelCode} ${parsed.worksheetNo}`,
            enrollment,
            "No matching worksheet_master row for starting_worksheet_master_id."
        );

        return {
            id: null,
            levelCode: parsed.levelCode,
            worksheetNo: parsed.worksheetNo
        };
    }

    return {
        id: worksheet.worksheet_master_id,
        levelCode: parsed.levelCode,
        worksheetNo: parsed.worksheetNo
    };
}

function resolveStartDate(enrollment, issues, blockingRows) {
    const startDate = parseDateToAd(enrollment.record.StartDate);

    if (startDate.error) {
        addBlockingIssue(
            issues,
            blockingRows,
            "startDate",
            enrollment.record.StartDate,
            enrollment,
            startDate.error
        );
    }

    return startDate.value;
}

function resolveOpeningSchedule(enrollment, dayValue, timeValue, slot, masters, warnings, warningRows) {
    const day = clean(dayValue);
    const time = parseOpeningTime(timeValue);

    if (!day && (!time.hasInput || time.isPlaceholder)) {
        return {
            id: null,
            source: null
        };
    }

    const source = `${day || "(blank)"} ${clean(timeValue) || "(blank)"}`;

    if (!time.hasInput || time.isPlaceholder) {
        return {
            id: null,
            source: day ? `${day} (blank time)` : null
        };
    }

    if (!day) {
        addWarningIssue(
            warnings,
            warningRows,
            "openingSchedule",
            source,
            enrollment,
            `Opening schedule ${slot} has time but no weekday.`
        );

        return {
            id: null,
            source
        };
    }

    if (time.warning) {
        addWarningIssue(
            warnings,
            warningRows,
            "openingSchedule",
            source,
            enrollment,
            `${time.warning}. opening_schedule_id${slot} will be null.`
        );

        return {
            id: null,
            source
        };
    }

    const schedule = time.value
        ? masters.openingScheduleByDayTime.get(masterKey(day, time.value))
        : masters.openingScheduleByDay.get(masterKey(day));

    if (!schedule) {
        addWarningIssue(
            warnings,
            warningRows,
            "openingSchedule",
            source,
            enrollment,
            time.warning ||
                `No matching opening_schedule row for opening_schedule_id${slot}.`
        );

        return {
            id: null,
            source
        };
    }

    const resolvedTime = normalizePgTime(schedule.start_time);

    return {
        id: schedule.opening_schedule_id,
        source: time.value
            ? `${day} ${time.value}`
            : `${source} -> ${resolvedTime}`
    };
}

function normalizeStatusGroup1Name(statusValue) {
    const status = clean(statusValue);

    if (/^paid month\s+[78]$/i.test(status)) {
        return "Continue";
    }

    if (lookupKey(status) === "new enrollment") {
        return "New Enrolment";
    }

    return status;
}

function resolveStatusGroup1(enrollment, masters, issues, blockingRows) {
    const statusName = normalizeStatusGroup1Name(enrollment.record.Status);
    const status = masters.statusGroup1ByName.get(lookupKey(statusName));

    if (!status) {
        addBlockingIssue(
            issues,
            blockingRows,
            "statusGroup1",
            enrollment.record.Status,
            enrollment,
            "No matching status_master.status_name with status_group = 1."
        );
    }

    return status || null;
}

function resolveStatusGroup2(enrollment, masters, issues, blockingRows) {
    const isFullExemption = toBoolean(enrollment.record.FullExemption);

    if (!isFullExemption) {
        return null;
    }

    const statusName = "Full Exemption";
    const status = masters.statusGroup2ByName.get(lookupKey(statusName));

    if (!status) {
        addBlockingIssue(
            issues,
            blockingRows,
            "statusGroup2",
            statusName,
            enrollment,
            "No matching status_master.status_name with status_group = 2."
        );
    }

    return status || null;
}

function resolveSourceEnrollmentId(enrollment, issues, blockingRows) {
    const sourceEnrollmentId = parseRequiredInteger(
        enrollment.record.ID,
        "Enrollment ID"
    );

    if (sourceEnrollmentId.error) {
        addBlockingIssue(
            issues,
            blockingRows,
            "sourceId",
            enrollment.record.ID,
            enrollment,
            sourceEnrollmentId.error
        );
    }

    return sourceEnrollmentId.value;
}

function validateExistingEnrollmentMatch(
    enrollment,
    sourceEnrollmentId,
    studentId,
    subject,
    masters,
    issues,
    blockingRows
) {
    const subjectId = subject?.subject_id || null;

    if (!sourceEnrollmentId || !studentId || !subjectId) {
        return;
    }

    const existingById = masters.enrollmentsById.get(String(sourceEnrollmentId));
    const existingByStudentSubject = masters.enrollmentsByStudentSubject.get(
        masterKey(studentId, subjectId)
    );

    if (existingByStudentSubject) {
        return;
    }

    if (existingById) {
        addBlockingIssue(
            issues,
            blockingRows,
            "sourceId",
            sourceEnrollmentId,
            enrollment,
            "Access ID already exists in enrollment but points to a different student_id or subject_id."
        );
    }

}

function buildEnrollmentPreview(enrollment, masters, issues, warnings, blockingRows, warningRows, options = {}) {
    const subject = resolveSubject(enrollment, masters, issues, blockingRows);
    const studentId = resolveStudentId(enrollment, masters, issues, blockingRows, options);
    const sourceEnrollmentId = resolveSourceEnrollmentId(enrollment, issues, blockingRows);
    const currentLevel = resolveCurrentLevel(enrollment, subject, masters, issues, blockingRows);
    const zunLevel = resolveZunLevel(enrollment, subject, masters, warnings, warningRows);
    const startingWorksheet = resolveStartingWorksheet(enrollment, subject, masters, issues, blockingRows);
    const enStartDate = resolveStartDate(enrollment, issues, blockingRows);
    const openingSchedule1 = resolveOpeningSchedule(
        enrollment,
        enrollment.record.Day1,
        enrollment.record.Time1,
        1,
        masters,
        warnings,
        warningRows
    );
    const openingSchedule2 = resolveOpeningSchedule(
        enrollment,
        enrollment.record.Day2,
        enrollment.record.Time2,
        2,
        masters,
        warnings,
        warningRows
    );
    const statusGroup1 = resolveStatusGroup1(enrollment, masters, issues, blockingRows);
    const statusGroup2 = resolveStatusGroup2(
        enrollment,
        masters,
        issues,
        blockingRows
    );

    validateExistingEnrollmentMatch(
        enrollment,
        sourceEnrollmentId,
        studentId,
        subject,
        masters,
        issues,
        blockingRows
    );

    return {
        _preview_key: enrollment.key,
        enrollment_id: sourceEnrollmentId,
        csv_row: enrollment.csvRow,
        student_id: studentId,
        student_name: `${enrollment.firstName} ${enrollment.lastName}`,
        subject_id: subject?.subject_id || null,
        subject_code: subject?.subject_code || clean(enrollment.subjectCode) || null,
        kumon_student_id: nullable(enrollment.record.IDKumonStudent),
        current_level_master_id: currentLevel.id,
        current_level_code: currentLevel.code,
        current_zun_level_master_id: zunLevel.id,
        starting_worksheet_master_id: startingWorksheet.id,
        starting_level_code: startingWorksheet.levelCode,
        starting_worksheet_no: startingWorksheet.worksheetNo,
        en_start_date: enStartDate,
        opening_schedule_id1: openingSchedule1.id,
        opening_schedule_source1: openingSchedule1.source,
        opening_schedule_id2: openingSchedule2.id,
        opening_schedule_source2: openingSchedule2.source,
        current_status_group1_id: statusGroup1?.status_id || null,
        current_status_group1_name: statusGroup1?.status_name || null,
        current_status_group2_id: statusGroup2?.status_id || null,
        current_status_group2_name: statusGroup2?.status_name || null,
        remark: nullable(enrollment.record.Detail),
        created_at: null,
        updated_at: null
    };
}

function validationItem(label, count, warningCount = 0) {
    if (count > 0) {
        return {
            label,
            status: "ERROR",
            errors: count
        };
    }

    if (warningCount > 0) {
        return {
            label,
            status: "WARNING",
            errors: 0,
            warnings: warningCount
        };
    }

    return {
        label,
        status: "READY",
        errors: 0
    };
}

const ENROLLMENT_COLUMNS = [
    { key: "row_number", label: "#" },
    { key: "enrollment_id", label: "Enrollment ID" },
    { key: "csv_row", label: "CSV Row" },
    { key: "student_id", label: "Student ID" },
    { key: "student_name", label: "Student" },
    { key: "subject_id", label: "Subject ID" },
    { key: "subject_code", label: "Subject" },
    { key: "kumon_student_id", label: "Kumon Student ID" },
    { key: "current_level_master_id", label: "Current Level ID" },
    { key: "current_level_code", label: "Current Level" },
    { key: "current_zun_level_master_id", label: "ZUN Level ID" },
    { key: "starting_worksheet_master_id", label: "Start Worksheet ID" },
    { key: "starting_level_code", label: "Start Level" },
    { key: "starting_worksheet_no", label: "Start WS No." },
    { key: "en_start_date", label: "Start Date" },
    { key: "opening_schedule_id1", label: "Schedule 1 ID" },
    { key: "opening_schedule_source1", label: "Schedule 1 Source" },
    { key: "opening_schedule_id2", label: "Schedule 2 ID" },
    { key: "opening_schedule_source2", label: "Schedule 2 Source" },
    { key: "current_status_group1_id", label: "Status 1 ID" },
    { key: "current_status_group1_name", label: "Status 1" },
    { key: "current_status_group2_id", label: "Status 2 ID" },
    { key: "current_status_group2_name", label: "Status 2" },
    { key: "remark", label: "Remark" },
    { key: "created_at", label: "Created At", defaultValue: "DB default" },
    { key: "updated_at", label: "Updated At", defaultValue: "DB default" }
];

function hasValidationErrors(previewResult) {
    return previewResult.validation.some((item) =>
        String(item.status || "").toUpperCase() === "ERROR"
    );
}

async function syncEnrollmentIdentitySequence(client) {
    const sequenceResult = await client.query(`
        SELECT pg_get_serial_sequence('kumon.enrollment', 'enrollment_id') AS sequence_name
    `);
    const sequenceName = sequenceResult.rows[0]?.sequence_name;

    if (!sequenceName) {
        throw new Error(
            "enrollment.enrollment_id has no identity sequence. Recreate enrollment with GENERATED ALWAYS AS IDENTITY before importing."
        );
    }

    const valueResult = await client.query(`
        SELECT
            COALESCE(MAX(enrollment_id), 1)::bigint AS sequence_value,
            COUNT(*) > 0 AS has_rows
        FROM "kumon"."enrollment"
    `);
    const { sequence_value: sequenceValue, has_rows: hasRows } = valueResult.rows[0];

    await client.query(
        "SELECT setval($1, $2, $3)",
        [sequenceName, sequenceValue, hasRows]
    );
}

async function prepareEnrollmentPreviewData(db = pool, options = {}) {
    const records = readSourceRecords(csvPath, SOURCE_COLUMNS);

    const masters = await loadMasterData(records, db);
    const enrollments = new Map();

    const issues = {
        sourceId: new Map(),
        student: new Map(),
        subject: new Map(),
        currentLevel: new Map(),
        startingWorksheet: new Map(),
        startDate: new Map(),
        statusGroup1: new Map(),
        statusGroup2: new Map()
    };
    const warnings = {
        duplicate: new Map(),
        zunLevel: new Map(),
        openingSchedule: new Map()
    };
    const blockingRows = new Set();
    const warningRows = new Set();

    let duplicateCount = 0;
    let missingNameCount = 0;
    let missingSubjectCount = 0;
    const sourceIds = new Map();

    for (const [index, record] of records.entries()) {
        const firstName = clean(record.FirstName);
        const lastName = clean(record.LastName);
        const subjectCode = clean(record.Subject);
        const csvRow = index + 2;
        const item = {
            key: `${csvRow}`,
            csvRow,
            firstName,
            lastName,
            subjectCode,
            record
        };

        if (!firstName || !lastName) {
            missingNameCount++;
            addBlockingIssue(
                issues,
                blockingRows,
                "student",
                `${firstName || "(blank)"} ${lastName || "(blank)"}`,
                item,
                "Missing FirstName or LastName."
            );

            continue;
        }

        if (!subjectCode) {
            missingSubjectCount++;
            addBlockingIssue(
                issues,
                blockingRows,
                "subject",
                subjectCode,
                item,
                "Missing Subject."
            );

            continue;
        }

        const key = enrollmentKey(firstName, lastName, subjectCode);

        item.key = key;

        const sourceEnrollmentId = parseRequiredInteger(
            record.ID,
            "Enrollment ID"
        );

        if (sourceEnrollmentId.error) {
            addBlockingIssue(
                issues,
                blockingRows,
                "sourceId",
                record.ID,
                item,
                sourceEnrollmentId.error
            );

            continue;
        }

        item.sourceEnrollmentId = sourceEnrollmentId.value;

        const sourceIdKey = String(sourceEnrollmentId.value);
        const existingSourceItem = sourceIds.get(sourceIdKey);

        if (existingSourceItem) {
            addBlockingIssue(
                issues,
                blockingRows,
                "sourceId",
                sourceEnrollmentId.value,
                existingSourceItem,
                "Duplicate Access enrollment ID in CSV."
            );
            addBlockingIssue(
                issues,
                blockingRows,
                "sourceId",
                sourceEnrollmentId.value,
                item,
                "Duplicate Access enrollment ID in CSV."
            );
        } else {
            sourceIds.set(sourceIdKey, item);
        }

        if (enrollments.has(key)) {
            duplicateCount++;
            addWarningIssue(
                warnings,
                warningRows,
                "duplicate",
                `${firstName} ${lastName} / ${subjectCode}`,
                item,
                "Duplicate student + subject row skipped for preview because enrollment has a unique constraint."
            );

            continue;
        }

        enrollments.set(key, item);
    }

    const previewRows = [...enrollments.values()].map((enrollment) =>
        buildEnrollmentPreview(
            enrollment,
            masters,
            issues,
            warnings,
            blockingRows,
            warningRows,
            options
        )
    );

    const classifiedRows = previewRows.map((row, index) => {
        const previewStatus = blockingRows.has(row._preview_key)
            ? "ERROR"
            : warningRows.has(row._preview_key)
                ? "WARNING"
                : "READY";
        const { _preview_key: _previewKey, ...publicRow } = row;
        const existingByStudentSubject = publicRow.student_id && publicRow.subject_id
            ? masters.enrollmentsByStudentSubject.get(
                masterKey(publicRow.student_id, publicRow.subject_id)
            )
            : null;
        const importAction = previewStatus === "ERROR"
            ? "BLOCK"
            : existingByStudentSubject
                ? "SKIP"
                : "INSERT";

        return {
            row_number: index + 1,
            import_action: importAction,
            preview_status: previewStatus,
            ...publicRow
        };
    });

    const errorCounts = {
        sourceId: issueCount(issues.sourceId),
        student: issueCount(issues.student),
        subject: issueCount(issues.subject),
        currentLevel: issueCount(issues.currentLevel),
        startingWorksheet: issueCount(issues.startingWorksheet),
        startDate: issueCount(issues.startDate),
        statusGroup1: issueCount(issues.statusGroup1),
        statusGroup2: issueCount(issues.statusGroup2)
    };
    const warningCounts = {
        duplicate: issueCount(warnings.duplicate),
        zunLevel: issueCount(warnings.zunLevel),
        openingSchedule: issueCount(warnings.openingSchedule)
    };
    const errorTotal = Object.values(errorCounts)
        .reduce((sum, count) => sum + count, 0);
    const warningTotal = Object.values(warningCounts)
        .reduce((sum, count) => sum + count, 0);
    const blockedPreviewRows = classifiedRows
        .filter((row) => row.preview_status === "ERROR")
        .length;
    const insertRows = classifiedRows
        .filter((row) => row.import_action === "INSERT")
    const existingCount = classifiedRows
        .filter((row) => row.import_action === "SKIP")
        .length;
    const skippedCount = existingCount + duplicateCount;
    const validRows = classifiedRows.length - blockedPreviewRows;
    const rows = insertRows.map(({ import_action, preview_status, ...row }, index) => ({
        ...row,
        row_number: index + 1
    }));
    const status = statusFromIssueCounts(errorTotal, warningTotal);

    const result = {
        module: "enrollment",
        title: "Enrollment",
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
                { label: "Valid Source Rows", value: validRows },
                { label: "Missing Name", value: missingNameCount },
                { label: "Missing Subject", value: missingSubjectCount }
            ]
        }),

        validation: [
            validationItem("Access Enrollment ID", errorCounts.sourceId),
            validationItem("Student Link", errorCounts.student),
            validationItem("Subject Master", errorCounts.subject),
            validationItem("Current Level Master", errorCounts.currentLevel),
            validationItem("Starting Worksheet Master", errorCounts.startingWorksheet),
            validationItem("Start Date", errorCounts.startDate),
            validationItem("Status Group 1", errorCounts.statusGroup1),
            validationItem("Status Group 2", errorCounts.statusGroup2),
            validationItem("ZUN Level", 0, warningCounts.zunLevel),
            validationItem("Opening Schedule", 0, warningCounts.openingSchedule),
            validationItem("Duplicate Student + Subject", 0, warningCounts.duplicate)
        ],

        columns: ENROLLMENT_COLUMNS,
        rows,
        pagination: buildPagination(rows),

        csvRecords: records.length,
        uniqueEnrollments: enrollments.size,
        duplicateCount,
        missingNameCount,
        missingSubjectCount,
        blockedRows: blockedPreviewRows,
        warningRows: warningRows.size,
        lookupErrors: errorCounts,
        lookupWarnings: warningCounts,
        issueDetails: {
            errors: Object.fromEntries(
                Object.entries(issues).map(([key, value]) => [
                    key,
                    issueList(value)
                ])
            ),
            warnings: Object.fromEntries(
                Object.entries(warnings).map(([key, value]) => [
                    key,
                    issueList(value)
                ])
            )
        },
        previewRows: rows
    };

    return {
        result,
        rows,
        records,
        enrollments
    };
}

export async function previewEnrollment() {
    const { result } = await prepareEnrollmentPreviewData();

    return result;
}

export async function importEnrollment() {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const { result, rows } = await prepareEnrollmentPreviewData(
            client,
            { requireImportedStudents: true }
        );

        if (hasValidationErrors(result)) {
            await client.query("ROLLBACK");

            const errorCount = result.lookupErrors
                ? Object.values(result.lookupErrors).reduce((sum, count) => sum + count, 0)
                : 1;

            return {
                module: "enrollment",
                title: "Enrollment Import",
                status: "ERROR",
                message: "Enrollment import stopped because preview validation has blocking errors.",
                summary: [
                    { label: "Inserted", value: 0 },
                    { label: "Skipped", value: 0 },
                    { label: "Errors", value: errorCount },
                    { label: "Preview Rows", value: rows.length }
                ],
                validation: result.validation,
                columns: ENROLLMENT_COLUMNS,
                rows: [],
                pagination: buildPagination([]),
                insertedCount: 0,
                skippedCount: 0,
                errorCount
            };
        }

        const existingResult = await client.query(`
            SELECT enrollment_id, student_id, subject_id
            FROM enrollment
            ORDER BY enrollment_id
        `);
        const existingByStudentSubject = new Map(
            existingResult.rows.map((enrollment) => [
                masterKey(enrollment.student_id, enrollment.subject_id),
                enrollment
            ])
        );
        const existingByEnrollmentId = new Map(
            existingResult.rows.map((enrollment) => [
                String(enrollment.enrollment_id),
                enrollment
            ])
        );
        const importRows = [];
        let insertedCount = 0;
        let skippedCount = 0;
        const previewSkippedCount =
            result.summary.find((item) => item.label === "Skipped")?.value || 0;

        for (const row of rows) {
            const key = masterKey(row.student_id, row.subject_id);
            const existingEnrollment = existingByStudentSubject.get(key);
            const existingEnrollmentById = existingByEnrollmentId.get(
                String(row.enrollment_id)
            );

            if (
                existingEnrollment &&
                existingEnrollmentById &&
                Number(existingEnrollment.enrollment_id) === Number(existingEnrollmentById.enrollment_id)
            ) {
                skippedCount++;
                importRows.push({
                    row_number: importRows.length + 1,
                    action: "SKIP",
                    enrollment_id: existingEnrollment.enrollment_id,
                    student_id: row.student_id,
                    subject_id: row.subject_id,
                    subject_code: row.subject_code,
                    message: "Existing enrollment matched by Access enrollment_id and student_id + subject_id."
                });
                continue;
            }

            const insertResult = await client.query(
                `
                    INSERT INTO enrollment (
                        enrollment_id,
                        student_id,
                        subject_id,
                        kumon_student_id,
                        current_level_master_id,
                        current_zun_level_master_id,
                        starting_worksheet_master_id,
                        en_start_date,
                        opening_schedule_id1,
                        opening_schedule_id2,
                        current_status_group1_id,
                        current_status_group2_id,
                        remark
                    )
                    OVERRIDING SYSTEM VALUE
                    VALUES (
                        $1, $2, $3, $4, $5, $6,
                        $7, $8, $9, $10, $11, $12,
                        $13
                    )
                    RETURNING enrollment_id
                `,
                [
                    row.enrollment_id,
                    row.student_id,
                    row.subject_id,
                    row.kumon_student_id,
                    row.current_level_master_id,
                    row.current_zun_level_master_id,
                    row.starting_worksheet_master_id,
                    row.en_start_date,
                    row.opening_schedule_id1,
                    row.opening_schedule_id2,
                    row.current_status_group1_id,
                    row.current_status_group2_id,
                    row.remark
                ]
            );
            const insertedEnrollment = insertResult.rows[0];

            insertedCount++;
            existingByStudentSubject.set(key, {
                enrollment_id: insertedEnrollment.enrollment_id,
                student_id: row.student_id,
                subject_id: row.subject_id
            });
            existingByEnrollmentId.set(String(insertedEnrollment.enrollment_id), {
                enrollment_id: insertedEnrollment.enrollment_id,
                student_id: row.student_id,
                subject_id: row.subject_id
            });
            importRows.push({
                row_number: importRows.length + 1,
                action: "INSERT",
                enrollment_id: insertedEnrollment.enrollment_id,
                student_id: row.student_id,
                subject_id: row.subject_id,
                subject_code: row.subject_code,
                message: "Inserted missing enrollment."
            });
        }

        await syncEnrollmentIdentitySequence(client);
        await client.query("COMMIT");

        return {
            module: "enrollment",
            title: "Enrollment Import",
            status: "READY",
            summary: [
                { label: "Inserted", value: insertedCount },
                { label: "Skipped", value: previewSkippedCount + skippedCount },
                { label: "Errors", value: 0 },
                { label: "Preview Rows", value: rows.length }
            ],
            validation: [
                { label: "Preview Validation", status: "READY", errors: 0 },
                { label: "Transaction", status: "READY", errors: 0 },
                { label: "Enrollment Identity Sequence", status: "READY", errors: 0 }
            ],
            columns: [
                { key: "row_number", label: "#" },
                { key: "action", label: "Action" },
                { key: "enrollment_id", label: "Enrollment ID" },
                { key: "student_id", label: "Student ID" },
                { key: "subject_id", label: "Subject ID" },
                { key: "subject_code", label: "Subject" },
                { key: "message", label: "Message" }
            ],
            rows: importRows,
            pagination: buildPagination(importRows),
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
