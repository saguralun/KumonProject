// WS Graph — the level-progress chart + its curriculum-ladder math (see
// planRangeForLadderIndex's comment for how the dashed Plan line is
// derived). Extracted out of student-manager.js as the first, most
// self-contained cluster in that file: it only reaches out for a handful
// of generic helpers (escapeHtml/formatDate/requestJson/selectedEnrollment)
// plus the shared els/state, and nothing outside this file needs anything
// from it except the three entry points below — imported back into
// student-manager.js the same circular-import way worksheet.js's
// search/AT/incomplete-ws modules import loadEnrollmentContext from
// worksheet.js (safe because these three are only ever called from event
// handlers, never at module-load time).
import { els, escapeHtml, formatDate, requestJson, selectedEnrollment, state } from "./student-manager.js";

export function updateWsGraphButtonVisibility() {
    const canShow = Boolean(state.selectedStudentId && state.historyType === "ws");

    els.wsGraphButton.classList.toggle("hidden", !canShow);
    els.wsGraphButton.disabled = !canShow;
}

function subjectColor(subjectCode) {
    return {
        ME: "#2563eb",
        EFL: "#0f8a5f",
        TRP: "#d97706"
    }[subjectCode] || "#64748b";
}

function monthYearLabel(dateText) {
    const [year, month] = String(dateText || "").slice(0, 7).split("-");

    if (!year || !month) {
        return "";
    }

    return `${month}/${String(year).slice(-2)}`;
}

// Only used for range "all" now — the numbered ranges (3/6/12) get a fixed
// window with one tick per real calendar month instead (see
// monthStartsInRange), so there's no need to thin those out.
function wsGraphTickLimit(totalTicks) {
    return Math.min(6, totalTicks);
}

function pickEvenlySpacedTicks(ticks, maxTicks) {
    if (ticks.length <= maxTicks) {
        return ticks;
    }

    if (maxTicks <= 1) {
        return ticks.slice(0, 1);
    }

    const pickedIndexes = new Set();

    for (let index = 0; index < maxTicks; index += 1) {
        const rawIndex = Math.round((index * (ticks.length - 1)) / (maxTicks - 1));
        let tickIndex = rawIndex;

        while (pickedIndexes.has(tickIndex) && tickIndex < ticks.length - 1) {
            tickIndex += 1;
        }

        while (pickedIndexes.has(tickIndex) && tickIndex > 0) {
            tickIndex -= 1;
        }

        pickedIndexes.add(tickIndex);
    }

    return [...pickedIndexes]
        .sort((left, right) => left - right)
        .map((index) => ticks[index]);
}

function localDateTime(dateText) {
    return new Date(`${dateText}T00:00:00`).getTime();
}

function isoDateFromTime(time) {
    const date = new Date(time);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

// N months before `time`, day-of-month clamped to whatever the target month
// actually has (plain Date#setMonth rolls Mar 31 - 1 month into early April
// instead of clamping to Feb 28/29 — this avoids that).
function monthsAgo(time, months) {
    const from = new Date(time);
    const targetMonthIndex = from.getMonth() - months;
    const target = new Date(from.getFullYear(), targetMonthIndex, 1);
    const daysInTargetMonth = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();

    target.setDate(Math.min(from.getDate(), daysInTargetMonth));

    return target.getTime();
}

// One tick per calendar-month boundary that falls inside [minDate, maxDate]
// — used for a fixed N-month window so the grid always reads "one column per
// month" regardless of how much (or little) WS data the student actually has
// in that window.
function monthStartsInRange(minDate, maxDate) {
    const ticks = [];
    const first = new Date(minDate);
    const cursor = new Date(first.getFullYear(), first.getMonth(), 1);

    while (cursor.getTime() <= maxDate) {
        if (cursor.getTime() >= minDate) {
            ticks.push({ date: isoDateFromTime(cursor.getTime()) });
        }

        cursor.setMonth(cursor.getMonth() + 1);
    }

    return ticks;
}

function academicYearForTime(time) {
    const date = new Date(time);
    const month = date.getMonth() + 1;

    return month >= 5 ? date.getFullYear() : date.getFullYear() - 1;
}

// Mirrors services/worksheetService.js's GRADE_LEVEL_GROUPS_BY_SUBJECT —
// keep these two in sync if the curriculum pacing ever changes. This is
// now the ONE source both the Y-axis level order AND the dashed Plan line
// derive from (see subjectLevelOrder/planRangeForLadderIndex below),
// instead of a separate hand-typed table that could silently drift out of
// sync with it — which is exactly what caused ME to show a "AI"/"7A"
// level it doesn't actually have (those came from a level-order array
// shared across ME/EFL/TRP instead of being derived per-subject from here).
const GRADE_LEVEL_GROUPS_BY_SUBJECT = {
    ME: [
        { schoolClass: "เตรียมอ.", levels: ["6A", "5A"] },
        { schoolClass: "อ.1", levels: ["4A"] },
        { schoolClass: "อ.2", levels: ["3A"] },
        { schoolClass: "อ.3", levels: ["2A"] },
        { schoolClass: "ป.1", levels: ["A"] },
        { schoolClass: "ป.2", levels: ["B"] },
        { schoolClass: "ป.3", levels: ["C"] },
        { schoolClass: "ป.4", levels: ["D"] },
        { schoolClass: "ป.5", levels: ["E"] },
        { schoolClass: "ป.6", levels: ["F"] },
        { schoolClass: "ม.1", levels: ["G"] },
        { schoolClass: "ม.2", levels: ["H"] },
        { schoolClass: "ม.3", levels: ["I"] },
        { schoolClass: "ม.4", levels: ["J", "K"] },
        { schoolClass: "ม.5", levels: ["L", "M"] },
        { schoolClass: "ม.6", levels: ["N", "O"] }
    ],
    EFL: [
        { schoolClass: "เตรียมอ.", levels: ["7A", "6A", "5A"] },
        { schoolClass: "อ.1", levels: ["4A"] },
        { schoolClass: "อ.2", levels: ["3A"] },
        { schoolClass: "อ.3", levels: ["2A"] },
        { schoolClass: "ป.1", levels: ["A"] },
        { schoolClass: "ป.2", levels: ["B"] },
        { schoolClass: "ป.3", levels: ["C"] },
        { schoolClass: "ป.4", levels: ["D"] },
        { schoolClass: "ป.5", levels: ["E"] },
        { schoolClass: "ป.6", levels: ["F"] },
        { schoolClass: "ม.1", levels: ["G"] },
        { schoolClass: "ม.2", levels: ["H"] },
        { schoolClass: "ม.3", levels: ["I"] },
        { schoolClass: "ม.4", levels: ["J", "K"] },
        { schoolClass: "ม.5", levels: ["L", "M"] },
        { schoolClass: "ม.6", levels: ["N", "O"] }
    ]
};

// TRP's own real level codes (AI/AII/BI/BII/...) — kept separate from the
// table above because TRP's plan already shows each grade's own two
// levels directly (AI->AII) rather than looking ahead to the next grade,
// and because TRP has no plan before ป.1 (TRP_PLAN_GRADE_RANGES only goes
// 1-9) — both pre-existing, unchanged.
const TRP_PLAN_LEVEL_ORDER = [
    "AI",
    "AII",
    "BI",
    "BII",
    "CI",
    "CII",
    "DI",
    "DII",
    "EI",
    "EII",
    "FI",
    "FII",
    "GI",
    "GII",
    "HI",
    "HII",
    "I",
    "II",
    "III"
];

const TRP_PLAN_GRADE_RANGES = {
    1: { startLevelCode: "AI", endLevelCode: "AII", endWorksheetNo: 191 },
    2: { startLevelCode: "BI", endLevelCode: "BII", endWorksheetNo: 191 },
    3: { startLevelCode: "CI", endLevelCode: "CII", endWorksheetNo: 191 },
    4: { startLevelCode: "DI", endLevelCode: "DII", endWorksheetNo: 191 },
    5: { startLevelCode: "EI", endLevelCode: "EII", endWorksheetNo: 191 },
    6: { startLevelCode: "FI", endLevelCode: "FII", endWorksheetNo: 191 },
    7: { startLevelCode: "GI", endLevelCode: "GII", endWorksheetNo: 191 },
    8: { startLevelCode: "HI", endLevelCode: "HII", endWorksheetNo: 191 },
    9: { startLevelCode: "II", endLevelCode: "III", endWorksheetNo: 191 }
};

// Y-axis / gap-filling level order, derived per-subject from the
// authoritative table above instead of one array shared across subjects.
function subjectLevelOrder(subjectCode) {
    if (String(subjectCode || "").toUpperCase() === "TRP") {
        return TRP_PLAN_LEVEL_ORDER;
    }

    const groups = GRADE_LEVEL_GROUPS_BY_SUBJECT[String(subjectCode || "").toUpperCase()]
        || GRADE_LEVEL_GROUPS_BY_SUBJECT.ME;

    return groups.flatMap((group) => group.levels);
}

function ladderIndexForSchoolClass(schoolClass) {
    const compactClass = String(schoolClass || "").replace(/\s+/g, "");

    if (/เตรียม/.test(compactClass)) {
        return 0;
    }

    const kindergarten = compactClass.match(/(?:อ\.?|อนุบาล)([1-3])/);

    if (kindergarten) {
        return Number(kindergarten[1]); // อ.1 -> 1, อ.2 -> 2, อ.3 -> 3
    }

    const primary = compactClass.match(/(?:ป\.?|ประถม|p)([1-6])/i);

    if (primary) {
        return 3 + Number(primary[1]); // ป.1 -> 4 ... ป.6 -> 9
    }

    const secondary = compactClass.match(/(?:ม\.?|มัธยม|m)([1-6])/i);

    if (secondary) {
        return 9 + Number(secondary[1]); // ม.1 -> 10 ... ม.6 -> 15
    }

    return null;
}

// Single source of truth for "what's the plan bracket for this grade" —
// used both for the student's actual current grade (yearOffset 0) and for
// every other year shown on the graph (see shiftPlanSegment). For ME/EFL,
// each grade's segment runs from its own first level to the NEXT grade's
// first level — that's the level a student should be starting once this
// year ends, which is why adjacent segments always connect (เตรียม's own
// levels are 6A,5A, but its segment is 6A->4A because อ.1 starts at 4A;
// ม.4's own levels are J,K, but its segment is J->L because ม.5 starts at
// L — the in-between own-second-level is intentionally not a checkpoint
// here). The very last grade (ม.6) has no next grade to look ahead to, so
// it uses its own two levels directly, reaching worksheet 191 (the final
// worksheet) instead of just starting the next level.
function planRangeForLadderIndex(ladderIndex, subjectCode) {
    const subject = String(subjectCode || "").toUpperCase();

    if (subject === "TRP") {
        if (typeof ladderIndex !== "number" || ladderIndex < 4) {
            return null;
        }

        const trpRange = TRP_PLAN_GRADE_RANGES[ladderIndex - 3];

        return trpRange ? { ...trpRange, planGradeIndex: ladderIndex } : null;
    }

    const groups = GRADE_LEVEL_GROUPS_BY_SUBJECT[subject] || GRADE_LEVEL_GROUPS_BY_SUBJECT.ME;

    if (typeof ladderIndex !== "number" || ladderIndex < 0 || ladderIndex >= groups.length) {
        return null;
    }

    const group = groups[ladderIndex];
    const nextGroup = groups[ladderIndex + 1];

    return {
        startLevelCode: group.levels[0],
        endLevelCode: nextGroup ? nextGroup.levels[0] : group.levels[group.levels.length - 1],
        endWorksheetNo: nextGroup ? 1 : 191,
        planGradeIndex: ladderIndex
    };
}

function planLevelRangeForSchoolClass(subjectCode) {
    const subject = String(subjectCode || selectedEnrollment()?.subjectCode || "").toUpperCase();
    const ladderIndex = ladderIndexForSchoolClass(state.profile?.student?.schoolClass);

    return planRangeForLadderIndex(ladderIndex, subject);
}

function levelSortValue(levelCode, subjectCode) {
    const code = String(levelCode || "").toUpperCase();
    const index = subjectLevelOrder(subjectCode).indexOf(code);

    return index >= 0 ? index : 999;
}

function planLevelCodesBetween(subjectCode, startLevelCode, endLevelCode) {
    const order = subjectLevelOrder(subjectCode);
    const startIndex = order.indexOf(String(startLevelCode || "").toUpperCase());
    const endIndex = order.indexOf(String(endLevelCode || "").toUpperCase());

    if (startIndex < 0 || endIndex < 0) {
        return [startLevelCode, endLevelCode].filter(Boolean);
    }

    const from = Math.min(startIndex, endIndex);
    const to = Math.max(startIndex, endIndex);

    return order.slice(from, to + 1);
}

// A past/future year is just a different rung of the same ladder
// (planGradeIndex, set by planRangeForLadderIndex/planLevelRangeForSchoolClass)
// — moving yearOffset years shifts that many rungs, and each rung already
// carries its own correct bracket, so there's no separate math here beyond
// the lookup itself. This is also why every segment connects to the next:
// PLAN_GRADE_LADDER was built so each entry's end is the next one's start.
function shiftPlanSegment(subjectCode, planRange, yearOffset) {
    if (typeof planRange?.planGradeIndex !== "number") {
        return null;
    }

    return planRangeForLadderIndex(planRange.planGradeIndex + yearOffset, subjectCode);
}

function planSegmentsForRange(subjectCode, planRange, minTime, maxTime) {
    if (!planRange?.startLevelCode || !planRange?.endLevelCode) {
        return [];
    }

    const currentAcademicYear = academicYearForTime(Date.now());
    const startAcademicYear = academicYearForTime(minTime);
    const endAcademicYear = academicYearForTime(maxTime);
    const segments = [];

    for (let year = startAcademicYear; year <= endAcademicYear; year += 1) {
        const yearOffset = year - currentAcademicYear;
        const shiftedRange = shiftPlanSegment(subjectCode, planRange, yearOffset);

        if (!shiftedRange) {
            continue;
        }

        segments.push({
            academicYear: year,
            startDate: `${year}-05-01`,
            endDate: `${year + 1}-04-30`,
            startLevelCode: shiftedRange.startLevelCode,
            endLevelCode: shiftedRange.endLevelCode,
            endWorksheetNo: shiftedRange.endWorksheetNo || 1
        });
    }

    return segments;
}

function visibleLevelCodesBetween(subjectCode, levels) {
    const order = subjectLevelOrder(subjectCode);
    const indexes = levels
        .map((level) => order.indexOf(String(level.levelCode || "").toUpperCase()))
        .filter((index) => index >= 0);

    if (!indexes.length) {
        return [];
    }

    return order.slice(Math.min(...indexes), Math.max(...indexes) + 1);
}

function renderWsGraph(data) {
    const rows = data.rows || [];

    const width = 900;
    const height = 430;
    const margin = {
        top: 22,
        right: 28,
        bottom: 52,
        left: 74
    };
    const activeEnrollment = selectedEnrollment();
    const activeSubjectCode = activeEnrollment?.subjectCode || "ME";
    const planRange = planLevelRangeForSchoolClass(activeEnrollment?.subjectCode);
    const dates = rows.map((row) => localDateTime(row.date));
    const hasRows = dates.length > 0;

    if (!dates.length && planRange?.startLevelCode && planRange?.endLevelCode) {
        const fallbackAcademicYear = academicYearForTime(Date.now());

        dates.push(
            localDateTime(`${fallbackAcademicYear}-05-01`),
            localDateTime(`${fallbackAcademicYear + 1}-04-30`)
        );
    }

    if (!dates.length) {
        els.wsGraphWrap.innerHTML = `<div class="empty-state">ยังไม่มีข้อมูล WS และยังทำ Plan ไม่ได้ เพราะไม่พบชั้นเรียนของนักเรียน</div>`;
        return;
    }

    // For a numbered range (3/6/12 months) the X axis is fixed to that full
    // trailing window from today — regardless of how much WS data actually
    // falls inside it — instead of stretching to fit just whatever dates the
    // student happens to have. "all" has no natural fixed window, so it
    // keeps auto-fitting to the data's own span like before.
    const requestedRange = data.range || state.wsGraphRange;
    const fixedRangeMonths = ["3", "6", "12"].includes(String(requestedRange))
        ? Number(requestedRange)
        : null;
    let minDate;
    let maxDate;

    if (fixedRangeMonths) {
        maxDate = localDateTime(isoDateFromTime(Date.now()));
        minDate = monthsAgo(maxDate, fixedRangeMonths);
    } else {
        minDate = Math.min(...dates);
        maxDate = Math.max(...dates);
    }

    const planSegments = planSegmentsForRange(activeSubjectCode, planRange, minDate, maxDate);
    const levelFirstDate = new Map();

    rows.forEach((row) => {
        const key = `${row.enrollmentId}-${row.levelMasterId || row.levelCode}`;
        const current = levelFirstDate.get(key);
        const time = localDateTime(row.date);

        if (!current || time < current.time) {
            levelFirstDate.set(key, {
                key,
                time,
                levelCode: row.levelCode,
                subjectCode: row.subjectCode,
                enrollmentId: row.enrollmentId
            });
        }
    });
    let levelOrder = [...levelFirstDate.values()]
        .sort((a, b) => a.time - b.time || String(a.levelCode).localeCompare(String(b.levelCode)))
        .map((item, index) => [item.key, index]);
    const levelIndexByKey = new Map(levelOrder);
    const levelLabels = [...levelFirstDate.values()]
        .sort((a, b) => (levelIndexByKey.get(a.key) || 0) - (levelIndexByKey.get(b.key) || 0));
    const ensurePlanLevel = (levelCode) => {
        if (!levelCode || levelLabels.some((level) => level.levelCode === levelCode)) {
            return;
        }

        const key = `plan-${levelCode}`;
        levelIndexByKey.set(key, levelLabels.length);
        levelLabels.push({
            key,
            levelCode,
            subjectCode: activeEnrollment?.subjectCode || "ME",
            enrollmentId: "plan"
        });
    };
    planSegments.forEach((segment) => {
        planLevelCodesBetween(activeSubjectCode, segment.startLevelCode, segment.endLevelCode)
            .forEach((levelCode) => ensurePlanLevel(levelCode));
    });
    visibleLevelCodesBetween(activeSubjectCode, levelLabels)
        .forEach((levelCode) => ensurePlanLevel(levelCode));
    levelLabels.sort((a, b) =>
        levelSortValue(a.levelCode, activeSubjectCode) - levelSortValue(b.levelCode, activeSubjectCode)
        || String(a.levelCode).localeCompare(String(b.levelCode))
    );
    levelIndexByKey.clear();
    levelLabels.forEach((level, index) => {
        levelIndexByKey.set(level.key, index);
    });
    const maxProgress = Math.max(191, (levelLabels.length - 1) * 200 + 191);
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const progressValue = (row) => {
        const key = `${row.enrollmentId}-${row.levelMasterId || row.levelCode}`;
        const levelIndex = levelIndexByKey.get(key) || 0;

        return levelIndex * 200 + Number(row.worksheetNo || 1);
    };
    const xForDate = (dateText) => {
        const time = localDateTime(dateText);

        if (maxDate === minDate) {
            return margin.left + plotWidth / 2;
        }

        return margin.left + ((time - minDate) / (maxDate - minDate)) * plotWidth;
    };
    const yForProgress = (value) =>
        margin.top + plotHeight - ((Number(value) - 1) / (maxProgress - 1)) * plotHeight;
    const planProgressForTime = (time, segment) => {
        const planStartTime = localDateTime(segment.startDate);
        const planEndTime = localDateTime(segment.endDate);
        const ratio = Math.min(1, Math.max(0, (time - planStartTime) / (planEndTime - planStartTime)));
        const currentKey = levelLabels.find((level) => level.levelCode === segment.startLevelCode)?.key;
        const nextKey = levelLabels.find((level) => level.levelCode === segment.endLevelCode)?.key;

        if (!currentKey || !nextKey) {
            return null;
        }

        const currentIndex = levelIndexByKey.get(currentKey) || 0;
        const nextIndex = levelIndexByKey.get(nextKey) || 0;
        const startProgress = currentIndex * 200 + 1;
        const endProgress = nextIndex * 200 + (segment.endWorksheetNo || 1);

        return startProgress + (endProgress - startProgress) * ratio;
    };
    const yTicks = levelLabels.flatMap((level, index) => [
        {
            value: index * 200 + 1,
            label: `${level.levelCode}1`
        }
    ]);
    let monthTicks;

    if (fixedRangeMonths) {
        // Fixed window — one grid line per real calendar month it spans,
        // whether or not the student has any WS records in that month.
        monthTicks = monthStartsInRange(minDate, maxDate);
    } else {
        const monthTickRows = [...rows];

        if (!hasRows && planSegments.length) {
            const firstSegment = planSegments[0];
            const lastSegment = planSegments[planSegments.length - 1];

            monthTickRows.push(
                { date: firstSegment.startDate },
                { date: lastSegment.endDate }
            );
        }

        const allMonthTicks = [...new Map(monthTickRows.map((row) => [
            String(row.date).slice(0, 7),
            row
        ])).values()];

        monthTicks = pickEvenlySpacedTicks(allMonthTicks, wsGraphTickLimit(allMonthTicks.length));
    }
    const grouped = new Map();

    rows.forEach((row) => {
        const key = `${row.enrollmentId}-${row.worksheetType}`;

        if (!grouped.has(key)) {
            grouped.set(key, []);
        }
        grouped.get(key).push(row);
    });

    const lines = [...grouped.values()].map((groupRows) => {
        const points = groupRows
            .map((row) => `${xForDate(row.date).toFixed(1)},${yForProgress(progressValue(row)).toFixed(1)}`)
            .join(" ");
        const color = subjectColor(groupRows[0]?.subjectCode);

        return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" opacity="0.42" />`;
    }).join("");
    const planLine = planSegments.length
        ? planSegments.map((segment) => {
            const currentKey = levelLabels.find((level) => level.levelCode === segment.startLevelCode)?.key;
            const nextKey = levelLabels.find((level) => level.levelCode === segment.endLevelCode)?.key;

            if (!currentKey || !nextKey) {
                return "";
            }

            const planStartTime = localDateTime(segment.startDate);
            const planEndTime = localDateTime(segment.endDate);
            const visibleStartTime = Math.max(minDate, planStartTime);
            const visibleEndTime = Math.min(maxDate, planEndTime);

            if (visibleEndTime < visibleStartTime) {
                return "";
            }

            const startDate = isoDateFromTime(visibleStartTime);
            const endDate = isoDateFromTime(visibleEndTime);
            const startProgress = planProgressForTime(visibleStartTime, segment);
            const endProgress = planProgressForTime(visibleEndTime, segment);

            if (startProgress === null || endProgress === null) {
                return "";
            }

            const startX = xForDate(startDate);
            const endX = xForDate(endDate);
            const startY = yForProgress(startProgress);
            const endY = yForProgress(endProgress);

            return `
                <line x1="${startX.toFixed(1)}" y1="${startY.toFixed(1)}" x2="${endX.toFixed(1)}" y2="${endY.toFixed(1)}" stroke="#dc2626" stroke-width="2.5" stroke-dasharray="8 5"></line>
                <circle cx="${startX.toFixed(1)}" cy="${startY.toFixed(1)}" r="4" fill="#dc2626"></circle>
                <circle cx="${endX.toFixed(1)}" cy="${endY.toFixed(1)}" r="4" fill="#dc2626"></circle>
            `;
        }).join("")
        : "";
    const points = rows.map((row) => {
        const color = row.isKumonConnect ? "#7c3aed" : subjectColor(row.subjectCode);
        const label = `${row.subjectCode} ${row.levelCode}${row.worksheetNo} • ${formatDate(row.date)}${row.isKumonConnect ? " • KC" : ""}`;

        return `
            <circle
                cx="${xForDate(row.date).toFixed(1)}"
                cy="${yForProgress(progressValue(row)).toFixed(1)}"
                r="${row.cpws ? 4.5 : 3.6}"
                fill="${color}"
                opacity="${row.isStockProcessed ? "0.62" : "0.95"}"
            >
                <title>${escapeHtml(label)}</title>
            </circle>
        `;
    }).join("");
    const legendSubjects = [...new Set(rows.map((row) => row.subjectCode))];

    els.wsGraphWrap.innerHTML = `
        <svg class="ws-graph-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="WS graph">
            <rect x="0" y="0" width="${width}" height="${height}" rx="10" fill="#ffffff"></rect>
            ${yTicks.map((tick) => `
                <line x1="${margin.left}" y1="${yForProgress(tick.value).toFixed(1)}" x2="${width - margin.right}" y2="${yForProgress(tick.value).toFixed(1)}" stroke="#e2e8f0"></line>
                <text x="${margin.left - 12}" y="${(yForProgress(tick.value) + 4).toFixed(1)}" text-anchor="end">${escapeHtml(tick.label)}</text>
            `).join("")}
            ${monthTicks.map((row) => `
                <line x1="${xForDate(row.date).toFixed(1)}" y1="${margin.top}" x2="${xForDate(row.date).toFixed(1)}" y2="${height - margin.bottom}" stroke="#e2e8f0" stroke-width="1" opacity="0.72"></line>
                <text x="${xForDate(row.date).toFixed(1)}" y="${height - 18}" text-anchor="middle">${escapeHtml(monthYearLabel(row.date))}</text>
            `).join("")}
            <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}" stroke="#94a3b8"></line>
            <line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" stroke="#94a3b8"></line>
            ${planLine}
            ${lines}
            ${points}
        </svg>
        <div class="ws-graph-legend">
            ${legendSubjects.map((subject) => `
                <span><i style="background:${subjectColor(subject)}"></i>${escapeHtml(subject)}</span>
            `).join("")}
            ${rows.some((row) => row.isKumonConnect) ? `<span><i style="background:#7c3aed"></i>KC</span>` : ""}
            ${planLine ? `<span><i style="background:#dc2626"></i>Plan</span>` : ""}
            <span>รวม ${rows.length} records</span>
        </div>
        ${planLine ? `<div class="ws-graph-plan-note">Plan: ชั้น ${escapeHtml(state.profile.student.schoolClass)} เดินหน้า/ถอยหลังปีละ 1 level ตามช่วง WS ที่แสดง</div>` : ""}
    `;
}

export async function loadWsGraph() {
    if (!state.selectedStudentId) {
        return;
    }

    els.wsGraphWrap.innerHTML = `<div class="empty-state">กำลังโหลดกราฟ...</div>`;
    const params = new URLSearchParams({
        range: state.wsGraphRange
    });

    if (state.selectedEnrollmentId) {
        params.set("enrollmentId", String(state.selectedEnrollmentId));
    }

    try {
        const data = await requestJson(
            `/api/students/${encodeURIComponent(state.selectedStudentId)}/ws-graph?${params.toString()}`
        );
        const enrollment = selectedEnrollment();
        const rangeLabel = state.wsGraphRange === "all"
            ? "ทั้งหมด"
            : `${state.wsGraphRange} เดือน`;

        els.wsGraphSubtitle.textContent = `${enrollment ? `${enrollment.subjectCode} #${enrollment.enrollmentId}` : "ทุกวิชา"} • ${rangeLabel} • ${data.rows.length} records`;
        renderWsGraph(data);
    } catch (error) {
        els.wsGraphWrap.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    }
}

const WS_GRAPH_DEFAULT_RANGE = "3";

export function openWsGraphModal() {
    if (!state.selectedStudentId) {
        return;
    }

    // Always reopen on the default range instead of carrying over
    // whatever was last picked (e.g. "12 เดือน" from a previous student)
    // — every fresh open of the graph should start at 3 months.
    state.wsGraphRange = WS_GRAPH_DEFAULT_RANGE;
    els.wsGraphModal.querySelectorAll("[data-ws-graph-range]").forEach((item) => {
        item.classList.toggle("active", item.dataset.wsGraphRange === WS_GRAPH_DEFAULT_RANGE);
    });

    els.wsGraphModal.classList.remove("hidden");
    loadWsGraph();
}

export function closeWsGraphModal() {
    els.wsGraphModal.classList.add("hidden");
}
