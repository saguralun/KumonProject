-- =========================================================
-- Record Count
-- =========================================================

SELECT 'subject_master' AS table_name, COUNT(*) AS total FROM subject_master
UNION ALL
SELECT 'level_master', COUNT(*) FROM level_master
UNION ALL
SELECT 'worksheet_master', COUNT(*) FROM worksheet_master
UNION ALL
SELECT 'cd_master', COUNT(*) FROM cd_master
UNION ALL
SELECT 'dt_master', COUNT(*) FROM dt_master
UNION ALL
SELECT 'dt_result_master', COUNT(*) FROM dt_result_master
UNION ALL
SELECT 'at_master', COUNT(*) FROM at_master
UNION ALL
SELECT 'status_master', COUNT(*) FROM status_master
UNION ALL
SELECT 'school_grade_master', COUNT(*) FROM school_grade_master
UNION ALL
SELECT 'center_master', COUNT(*) FROM center_master
UNION ALL
SELECT 'prefix_master', COUNT(*) FROM prefix_master
UNION ALL
SELECT 'gender_master', COUNT(*) FROM gender_master
UNION ALL
SELECT 'payment_method_master', COUNT(*) FROM payment_method_master
UNION ALL
SELECT 'stock_type_master', COUNT(*) FROM stock_type_master
UNION ALL
SELECT 'stock', COUNT(*) FROM stock
;

-- Worksheet ซ้ำหรือไม่
SELECT level_master_id, worksheet_no, COUNT(*)
FROM worksheet_master
GROUP BY level_master_id, worksheet_no
HAVING COUNT(*) > 1;

-- DT Result ซ้ำหรือไม่
SELECT dt_master_id, worksheet_master_id, COUNT(*)
FROM dt_result_master
GROUP BY dt_master_id, worksheet_master_id
HAVING COUNT(*) > 1;

-- CD ซ้ำหรือไม่
SELECT level_master_id, cd_no, COUNT(*)
FROM cd_master
GROUP BY level_master_id, cd_no
HAVING COUNT(*) > 1;

-- Level ซ้ำ
SELECT subject_id, level_code, COUNT(*)
FROM level_master
GROUP BY subject_id, level_code
HAVING COUNT(*) > 1;

-- AT ซ้ำ
SELECT level_master_id, COUNT(*)
FROM at_master
GROUP BY level_master_id
HAVING COUNT(*) > 1;

-- School Grade ซ้ำ
SELECT school_grade, COUNT(*)
FROM school_grade_master
GROUP BY school_grade
HAVING COUNT(*) > 1;

-- Worksheet -> Level
SELECT *
FROM worksheet_master wm
LEFT JOIN level_master lm
ON lm.level_master_id = wm.level_master_id
WHERE lm.level_master_id IS NULL;

-- CD -> Level
SELECT *
FROM cd_master c
LEFT JOIN level_master l
ON l.level_master_id = c.level_master_id
WHERE l.level_master_id IS NULL;

-- AT -> Level
SELECT *
FROM at_master a
LEFT JOIN level_master l
ON l.level_master_id = a.level_master_id
WHERE l.level_master_id IS NULL;

-- DT -> Subject
SELECT *
FROM dt_master d
LEFT JOIN subject_master s
ON s.subject_id = d.subject_id
WHERE s.subject_id IS NULL;

SELECT *
FROM level_master
WHERE level_code IN ('O','III','ZII')
AND next_level_master_id IS NOT NULL;

SELECT *
FROM worksheet_master
WHERE worksheet_no = 191
AND next_worksheet_master_id IS NOT NULL;

SELECT *
FROM school_grade_master
WHERE school_class = 'Etc'
AND next_school_grade_id IS NOT NULL;