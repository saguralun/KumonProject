-- =========================================================
-- Subject Master
-- =========================================================
-- =========================================================
-- IMPORTANT
-- subject_id is a system key.
-- 1 = ME
-- 2 = EFL
-- 3 = TRP
-- Do not reorder.
-- =========================================================

INSERT INTO subject_master
(
  subject_id,
  subject_code,
  subject_name,
  kumon_subject_id,
  authorize,
  month_authorize,
  year_authorize
)
VALUES

(1, 'ME',  'Math', '66L01812', TRUE,  6, 2017),
(2, 'EFL', 'English EFL', '66L01814', TRUE,  6, 2017),
(3, 'TRP', 'Thai Reading', '66L01813', FALSE, 6, 2016);

-- =========================================================
-- Level Master
-- =========================================================

INSERT INTO level_master
(level_master_id, subject_id, level_code, level_type, next_level_master_id)
VALUES

-- ME

(1, 1, 'ZI', 2, 2),
(2, 1, 'ZII', 2, NULL),

(3, 1, '6A', 1, 4),
(4, 1, '5A', 1, 5),
(5, 1, '4A', 1, 6),
(6, 1, '3A', 1, 7),
(7, 1, '2A', 1, 8),
(8, 1, 'A', 1, 9),
(9, 1, 'B', 1, 10),
(10, 1, 'C', 1, 11),
(11, 1, 'D', 1, 12),
(12, 1, 'E', 1, 13),
(13, 1, 'F', 1, 14),
(14, 1, 'G', 1, 15),
(15, 1, 'H', 1, 16),
(16, 1, 'I', 1, 17),
(17, 1, 'J', 1, 18),
(18, 1, 'K', 1, 19),
(19, 1, 'L', 1, 20),
(20, 1, 'M', 1, 21),
(21, 1, 'N', 1, 22),
(22, 1, 'O', 1, NULL),

-- EFL

(23, 2, '7A', 1, 24),
(24, 2, '6A', 1, 25),
(25, 2, '5A', 1, 26),
(26, 2, '4A', 1, 27),
(27, 2, '3A', 1, 28),
(28, 2, '2A', 1, 29),
(29, 2, 'A', 1, 30),
(30, 2, 'B', 1, 31),
(31, 2, 'C', 1, 32),
(32, 2, 'D', 1, 33),
(33, 2, 'E', 1, 34),
(34, 2, 'F', 1, 35),
(35, 2, 'G', 1, 36),
(36, 2, 'H', 1, 37),
(37, 2, 'I', 1, 38),
(38, 2, 'J', 1, 39),
(39, 2, 'K', 1, 40),
(40, 2, 'L', 1, 41),
(41, 2, 'M', 1, 42),
(42, 2, 'N', 1, 43),
(43, 2, 'O', 1, NULL),

-- TRP

(44, 3, '7A', 1, 45),
(45, 3, '6A', 1, 46),
(46, 3, '5A', 1, 47),
(47, 3, '4A', 1, 48),
(48, 3, '3A', 1, 49),
(49, 3, '2A', 1, 50),

(50, 3, 'AI', 1, 51),
(51, 3, 'AII', 1, 52),

(52, 3, 'BI', 1, 53),
(53, 3, 'BII', 1, 54),

(54, 3, 'CI', 1, 55),
(55, 3, 'CII', 1, 56),

(56, 3, 'DI', 1, 57),
(57, 3, 'DII', 1, 58),

(58, 3, 'EI', 1, 59),
(59, 3, 'EII', 1, 60),

(60, 3, 'FI', 1, 61),
(61, 3, 'FII', 1, 62),

(62, 3, 'GI', 1, 63),
(63, 3, 'GII', 1, 64),

(64, 3, 'HI', 1, 65),
(65, 3, 'HII', 1, 66),

(66, 3, 'II', 1, 67),
(67, 3, 'III', 1, NULL);

-- =========================================================
-- Worksheet Master
-- =========================================================

DO $$
DECLARE
  v_level RECORD;
  v_ws SMALLINT;
  v_max_ws SMALLINT;
  v_id SMALLINT := 1;
BEGIN

  FOR v_level IN
    SELECT level_master_id, level_type
    FROM level_master
    ORDER BY level_master_id
  LOOP

    IF v_level.level_type = 2 THEN
      v_max_ws := 91;
    ELSE
      v_max_ws := 191;
    END IF;

    v_ws := 1;

    WHILE v_ws <= v_max_ws LOOP

      INSERT INTO worksheet_master (
        worksheet_master_id,
        level_master_id,
        worksheet_no,
        next_worksheet_master_id
      )
      VALUES (
        v_id,
        v_level.level_master_id,
        v_ws,
        NULL
      );

      v_id := v_id + 1;
      v_ws := v_ws + 10;

    END LOOP;

  END LOOP;

END $$;

-- =========================================================
-- Update next worksheet
-- =========================================================

UPDATE worksheet_master w
SET next_worksheet_master_id = n.worksheet_master_id
FROM worksheet_master n
WHERE
  w.level_master_id = n.level_master_id
  AND n.worksheet_no = w.worksheet_no + 10;

-- =========================================================
-- CD Master
-- =========================================================

INSERT INTO cd_master
(cd_master_id, level_master_id, cd_no)
VALUES

-- EFL

(1, 23, 1),
(2, 24, 1),
(3, 25, 1),
(4, 26, 1),
(5, 27, 1),
(6, 28, 1),
(7, 29, 1),
(8, 30, 1),
(9, 31, 1),
(10, 32, 1),
(11, 33, 1),
(12, 34, 1),
(13, 35, 1),
(14, 36, 1),
(15, 37, 1),
(16, 38, 1),
(17, 39, 1),
(18, 40, 1),
(19, 41, 1),
(20, 42, 1),
(21, 43, 1),

-- TRP

(22, 44, 1),
(23, 44, 2),
(24, 44, 3),
(25, 44, 4),

(26, 45, 1),
(27, 45, 2),
(28, 45, 3),
(29, 45, 4),

(30, 46, 1),
(31, 47, 1),
(32, 48, 1),
(33, 49, 1),
(34, 50, 1);

-- =========================================================
-- DT Master
-- =========================================================

INSERT INTO dt_master
(dt_master_id, subject_id, test_level, max_score, max_time)
VALUES

-- ME

(1, 1, 'K2', 15, 5),
(2, 1, 'K1', 11, 10),
(3, 1, 'P1', 60, 10),
(4, 1, 'P2', 70, 10),
(5, 1, 'P3', 70, 10),
(6, 1, 'P4', 60, 15),
(7, 1, 'P5', 50, 15),
(8, 1, 'P6', 50, 20),
(9, 1, 'M1', 50, 25),
(10, 1, 'M2', 40, 25),
(11, 1, 'M3', 40, 30),
(12, 1, 'H', 30, 40),

-- TRP

(13, 3, 'K2', 4, 5),
(14, 3, 'K1', 48, 10),
(15, 3, 'P1', 51, 10),
(16, 3, 'P2', 51, 10),
(17, 3, 'P3', 60, 15),
(18, 3, 'P4', 60, 15),
(19, 3, 'P5', 72, 20),
(20, 3, 'P6', 72, 20),
(21, 3, 'M1', 72, 25),
(22, 3, 'M2', 72, 25),
(23, 3, 'M3', 72, 30),

-- EFL

(24, 2, 'K', 16, 0),
(25, 2, 'PII', 25, 15),
(26, 2, 'PI', 25, 15),
(27, 2, 'M', 30, 15),
(28, 2, 'H', 30, 20);

-- =========================================================
-- DT Result Master
-- =========================================================

INSERT INTO dt_result_master
(dt_result_master_id, dt_master_id, worksheet_master_id)
VALUES

-- =========================================================
-- ME
-- =========================================================

-- K2

(1, 1, fn_get_worksheet_master_id('ME', '6A', 1)),
(2, 1, fn_get_worksheet_master_id('ME', '6A', 101)),
(3, 1, fn_get_worksheet_master_id('ME', '5A', 1)),
(4, 1, fn_get_worksheet_master_id('ME', '5A', 101)),
(5, 1, fn_get_worksheet_master_id('ME', '4A', 1)),

-- K1

(6, 2, fn_get_worksheet_master_id('ME', '4A', 1)),
(7, 2, fn_get_worksheet_master_id('ME', '4A', 101)),
(8, 2, fn_get_worksheet_master_id('ME', '3A', 1)),

-- P1

(9, 3, fn_get_worksheet_master_id('ME', '3A', 1)),
(10, 3, fn_get_worksheet_master_id('ME', '3A', 71)),
(11, 3, fn_get_worksheet_master_id('ME', '2A', 1)),

-- P2

(12, 4, fn_get_worksheet_master_id('ME', '3A', 71)),
(13, 4, fn_get_worksheet_master_id('ME', '2A', 1)),
(14, 4, fn_get_worksheet_master_id('ME', 'A', 1)),

-- P3

(15, 5, fn_get_worksheet_master_id('ME', '3A', 71)),
(16, 5, fn_get_worksheet_master_id('ME', '2A', 1)),
(17, 5, fn_get_worksheet_master_id('ME', 'A', 1)),
(18, 5, fn_get_worksheet_master_id('ME', 'B', 1)),

-- P4

(19, 6, fn_get_worksheet_master_id('ME', '2A', 1)),
(20, 6, fn_get_worksheet_master_id('ME', 'A', 1)),
(21, 6, fn_get_worksheet_master_id('ME', 'B', 1)),
(22, 6, fn_get_worksheet_master_id('ME', 'B', 101)),
(23, 6, fn_get_worksheet_master_id('ME', 'C', 1)),
(24, 6, fn_get_worksheet_master_id('ME', 'C', 51)),

-- P5

(25, 7, fn_get_worksheet_master_id('ME', 'A', 1)),
(26, 7, fn_get_worksheet_master_id('ME', 'B', 1)),
(27, 7, fn_get_worksheet_master_id('ME', 'B', 101)),
(28, 7, fn_get_worksheet_master_id('ME', 'C', 1)),
(29, 7, fn_get_worksheet_master_id('ME', 'C', 51)),
(30, 7, fn_get_worksheet_master_id('ME', 'C', 111)),

-- P6

(31, 8, fn_get_worksheet_master_id('ME', 'B', 1)),
(32, 8, fn_get_worksheet_master_id('ME', 'B', 101)),
(33, 8, fn_get_worksheet_master_id('ME', 'C', 1)),
(34, 8, fn_get_worksheet_master_id('ME', 'C', 51)),
(35, 8, fn_get_worksheet_master_id('ME', 'C', 111)),
(36, 8, fn_get_worksheet_master_id('ME', 'D', 1)),
(37, 8, fn_get_worksheet_master_id('ME', 'D', 51)),

-- M1

(38, 9, fn_get_worksheet_master_id('ME', 'D', 1)),
(39, 9, fn_get_worksheet_master_id('ME', 'D', 51)),
(40, 9, fn_get_worksheet_master_id('ME', 'D', 151)),
(41, 9, fn_get_worksheet_master_id('ME', 'E', 1)),
(42, 9, fn_get_worksheet_master_id('ME', 'E', 21)),

-- M2

(43, 10, fn_get_worksheet_master_id('ME', 'D', 151)),
(44, 10, fn_get_worksheet_master_id('ME', 'E', 1)),
(45, 10, fn_get_worksheet_master_id('ME', 'E', 21)),
(46, 10, fn_get_worksheet_master_id('ME', 'F', 1)),
(47, 10, fn_get_worksheet_master_id('ME', 'F', 61)),

-- M3

(48, 11, fn_get_worksheet_master_id('ME', 'F', 1)),
(49, 11, fn_get_worksheet_master_id('ME', 'F', 61)),
(50, 11, fn_get_worksheet_master_id('ME', 'G', 1)),
(51, 11, fn_get_worksheet_master_id('ME', 'G', 101)),

-- H

(52, 12, fn_get_worksheet_master_id('ME', 'H', 1)),
(53, 12, fn_get_worksheet_master_id('ME', 'I', 1)),
(54, 12, fn_get_worksheet_master_id('ME', 'I', 31)),
(55, 12, fn_get_worksheet_master_id('ME', 'J', 1)),

-- =========================================================
-- TRP
-- =========================================================

-- K2
(56, 13, fn_get_worksheet_master_id('TRP', '7A', 1)),
(57, 13, fn_get_worksheet_master_id('TRP', '6A', 1)),
(58, 13, fn_get_worksheet_master_id('TRP', '5A', 1)),
(59, 13, fn_get_worksheet_master_id('TRP', '4A', 1)),

-- K1

(60, 14, fn_get_worksheet_master_id('TRP', '5A', 1)),
(61, 14, fn_get_worksheet_master_id('TRP', '4A', 1)),
(62, 14, fn_get_worksheet_master_id('TRP', '3A', 1)),

-- P1

(63, 15, fn_get_worksheet_master_id('TRP', '4A', 1)),
(64, 15, fn_get_worksheet_master_id('TRP', '3A', 1)),
(65, 15, fn_get_worksheet_master_id('TRP', '2A', 1)),

-- P2

(66, 16, fn_get_worksheet_master_id('TRP', '3A', 1)),
(67, 16, fn_get_worksheet_master_id('TRP', '2A', 1)),
(68, 16, fn_get_worksheet_master_id('TRP', 'AI', 1)),

-- P3

(69, 17, fn_get_worksheet_master_id('TRP', '2A', 1)),
(70, 17, fn_get_worksheet_master_id('TRP', 'AI', 1)),
(71, 17, fn_get_worksheet_master_id('TRP', 'BI', 1)),

-- P4

(72, 18, fn_get_worksheet_master_id('TRP', 'AI', 1)),
(73, 18, fn_get_worksheet_master_id('TRP', 'BI', 1)),
(74, 18, fn_get_worksheet_master_id('TRP', 'CI', 1)),

-- P5

(75, 19, fn_get_worksheet_master_id('TRP', 'BI', 1)),
(76, 19, fn_get_worksheet_master_id('TRP', 'CI', 1)),
(77, 19, fn_get_worksheet_master_id('TRP', 'DI', 1)),

-- P6

(78, 20, fn_get_worksheet_master_id('TRP', 'CI', 1)),
(79, 20, fn_get_worksheet_master_id('TRP', 'DI', 1)),
(80, 20, fn_get_worksheet_master_id('TRP', 'EI', 1)),

-- M1

(81, 21, fn_get_worksheet_master_id('TRP', 'DI', 1)),
(82, 21, fn_get_worksheet_master_id('TRP', 'EI', 1)),
(83, 21, fn_get_worksheet_master_id('TRP', 'FI', 1)),

-- M2

(84, 22, fn_get_worksheet_master_id('TRP', 'EI', 1)),
(85, 22, fn_get_worksheet_master_id('TRP', 'FI', 1)),
(86, 22, fn_get_worksheet_master_id('TRP', 'GI', 1)),

-- M3

(87, 23, fn_get_worksheet_master_id('TRP', 'FI', 1)),
(88, 23, fn_get_worksheet_master_id('TRP', 'GI', 1)),
(89, 23, fn_get_worksheet_master_id('TRP', 'HI', 1)),

-- =========================================================
-- EFL
-- =========================================================

-- K

(90, 24, fn_get_worksheet_master_id('EFL', '7A', 1)),
(91, 24, fn_get_worksheet_master_id('EFL', '4A', 1)),
(92, 24, fn_get_worksheet_master_id('EFL', '4A', 21)),

-- PII

(93, 25, fn_get_worksheet_master_id('EFL', '7A', 1)),
(94, 25, fn_get_worksheet_master_id('EFL', '4A', 1)),
(95, 25, fn_get_worksheet_master_id('EFL', '4A', 21)),
(96, 25, fn_get_worksheet_master_id('EFL', 'A', 1)),

-- PI

(97, 26, fn_get_worksheet_master_id('EFL', '7A', 1)),
(98, 26, fn_get_worksheet_master_id('EFL', '4A', 1)),
(99, 26, fn_get_worksheet_master_id('EFL', '4A', 21)),
(100, 26, fn_get_worksheet_master_id('EFL', 'A', 1)),
(101, 26, fn_get_worksheet_master_id('EFL', 'D', 1)),

-- M

(102, 27, fn_get_worksheet_master_id('EFL', '4A', 1)),
(103, 27, fn_get_worksheet_master_id('EFL', '4A', 21)),
(104, 27, fn_get_worksheet_master_id('EFL', 'A', 1)),
(105, 27, fn_get_worksheet_master_id('EFL', 'D', 1)),
(106, 27, fn_get_worksheet_master_id('EFL', 'G', 1)),

-- H

(107, 28, fn_get_worksheet_master_id('EFL', 'A', 1)),
(108, 28, fn_get_worksheet_master_id('EFL', 'D', 1)),
(109, 28, fn_get_worksheet_master_id('EFL', 'G', 1)),
(110, 28, fn_get_worksheet_master_id('EFL', 'J', 1));

-- =========================================================
-- AT Master
-- =========================================================

INSERT INTO at_master
(at_master_id, subject_id, level_master_id, max_score, max_time)
VALUES

-- ME

(1, 1, fn_get_level_master_id('ME', '4A'), 70, 10),
(2, 1, fn_get_level_master_id('ME', '3A'), 80, 10),
(3, 1, fn_get_level_master_id('ME', '2A'), 100, 10),
(4, 1, fn_get_level_master_id('ME', 'A'), 100, 10),
(5, 1, fn_get_level_master_id('ME', 'B'), 80, 15),
(6, 1, fn_get_level_master_id('ME', 'C'), 80, 15),
(7, 1, fn_get_level_master_id('ME', 'D'), 70, 25),
(8, 1, fn_get_level_master_id('ME', 'E'), 70, 25),
(9, 1, fn_get_level_master_id('ME', 'F'), 50, 25),
(10, 1, fn_get_level_master_id('ME', 'G'), 50, 25),
(11, 1, fn_get_level_master_id('ME', 'H'), 40, 30),
(12, 1, fn_get_level_master_id('ME', 'I'), 40, 30),
(13, 1, fn_get_level_master_id('ME', 'J'), 30, 50),
(14, 1, fn_get_level_master_id('ME', 'K'), 20, 50),
(15, 1, fn_get_level_master_id('ME', 'L'), 14, 50),
(16, 1, fn_get_level_master_id('ME', 'M'), 18, 52),
(17, 1, fn_get_level_master_id('ME', 'N'), 22, 70),
(62, 1, fn_get_level_master_id('ME', 'O'), 15, 80),

-- EFL

(18, 2, fn_get_level_master_id('EFL', '7A'), 100, 0),
(19, 2, fn_get_level_master_id('EFL', '6A'), 100, 0),
(20, 2, fn_get_level_master_id('EFL', '5A'), 100, 0),
(21, 2, fn_get_level_master_id('EFL', '4A'), 100, 10),
(22, 2, fn_get_level_master_id('EFL', '3A'), 100, 10),
(23, 2, fn_get_level_master_id('EFL', '2A'), 100, 15),
(24, 2, fn_get_level_master_id('EFL', 'A'), 100, 15),
(25, 2, fn_get_level_master_id('EFL', 'B'), 100, 15),
(26, 2, fn_get_level_master_id('EFL', 'C'), 100, 15),
(27, 2, fn_get_level_master_id('EFL', 'D'), 100, 15),
(28, 2, fn_get_level_master_id('EFL', 'E'), 100, 15),
(29, 2, fn_get_level_master_id('EFL', 'F'), 100, 15),
(30, 2, fn_get_level_master_id('EFL', 'G'), 100, 15),
(31, 2, fn_get_level_master_id('EFL', 'H'), 100, 15),
(32, 2, fn_get_level_master_id('EFL', 'I'), 100, 15),
(33, 2, fn_get_level_master_id('EFL', 'J'), 100, 20),
(34, 2, fn_get_level_master_id('EFL', 'K'), 100, 20),
(35, 2, fn_get_level_master_id('EFL', 'L'), 100, 20),
(36, 2, fn_get_level_master_id('EFL', 'M'), 100, 30),
(37, 2, fn_get_level_master_id('EFL', 'N'), 100, 30),
(63, 2, fn_get_level_master_id('EFL', 'O'), 100, 30),

-- TRP

(38, 3, fn_get_level_master_id('TRP', '7A'), 100, 0),
(39, 3, fn_get_level_master_id('TRP', '6A'), 100, 0),
(40, 3, fn_get_level_master_id('TRP', '5A'), 100, 10),
(41, 3, fn_get_level_master_id('TRP', '4A'), 100, 10),
(42, 3, fn_get_level_master_id('TRP', '3A'), 100, 10),
(43, 3, fn_get_level_master_id('TRP', '2A'), 100, 10),
(44, 3, fn_get_level_master_id('TRP', 'AI'), 100, 15),
(45, 3, fn_get_level_master_id('TRP', 'AII'), 100, 15),
(46, 3, fn_get_level_master_id('TRP', 'BI'), 100, 15),
(47, 3, fn_get_level_master_id('TRP', 'BII'), 100, 15),
(48, 3, fn_get_level_master_id('TRP', 'CI'), 100, 15),
(49, 3, fn_get_level_master_id('TRP', 'CII'), 100, 15),
(50, 3, fn_get_level_master_id('TRP', 'DI'), 100, 20),
(51, 3, fn_get_level_master_id('TRP', 'DII'), 100, 20),
(52, 3, fn_get_level_master_id('TRP', 'EI'), 100, 20),
(53, 3, fn_get_level_master_id('TRP', 'EII'), 100, 20),
(54, 3, fn_get_level_master_id('TRP', 'FI'), 100, 20),
(55, 3, fn_get_level_master_id('TRP', 'FII'), 100, 20),
(56, 3, fn_get_level_master_id('TRP', 'GI'), 100, 25),
(57, 3, fn_get_level_master_id('TRP', 'GII'), 100, 25),
(58, 3, fn_get_level_master_id('TRP', 'HI'), 100, 25),
(59, 3, fn_get_level_master_id('TRP', 'HII'), 100, 25),
(60, 3, fn_get_level_master_id('TRP', 'II'), 100, 25),
(61, 3, fn_get_level_master_id('TRP', 'III'), 100, 25);

-- =========================================================
-- Status Master
-- =========================================================

INSERT INTO status_master
(status_id, status_code, status_name, status_group)
VALUES

-- Group 1 : Enrollment Status

(1, 'N',   'New Enrolment',                 1),
(2, 'EO',  'Enrolling in Other Subject',    1),
(3, 'IT',  'Incoming Transfer',             1),
(4, 'OT',  'Outgoing Transfer',             1),
(5, 'R',   'Resumed',                       1),
(6, 'A',   'Absent',                        1),
(7, 'C',   'Continue',                      1),
(8, 'CP',  'Completer',                     1),

-- Group 2 : Special Status

(9,  'F',   'Full Exemption',               2),
(10, 'P',   'Partial Exemption',            2),
(11, 'H',   'Partial Payment (Half Month)', 2),
(12, 'FS',  'Free Study',                   2),
(13, 'FSH', 'Free Student (Half Month)',    2),
(14, 'FRG', 'Free Registration',            2);

-- =========================================================
-- School Grade Master
-- =========================================================

INSERT INTO school_grade_master
(school_grade_id, school_class, school_grade, addition_fee, next_school_grade_id)
VALUES
(1,  'เตรียมอ.', 'PK3', FALSE, NULL),
(2,  'อ.1',      'PK2', FALSE, NULL),
(3,  'อ.2',      'PK1', FALSE, NULL),
(4,  'อ.3',      'K',   FALSE, NULL),
(5,  'ป.1',      '1',   FALSE, NULL),
(6,  'ป.2',      '2',   FALSE, NULL),
(7,  'ป.3',      '3',   FALSE, NULL),
(8,  'ป.4',      '4',   FALSE, NULL),
(9,  'ป.5',      '5',   FALSE, NULL),
(10, 'ป.6',      '6',   FALSE, NULL),
(11, 'ม.1',      '7',   TRUE,  NULL),
(12, 'ม.2',      '8',   TRUE,  NULL),
(13, 'ม.3',      '9',   TRUE,  NULL),
(14, 'ม.4',      '10',  TRUE,  NULL),
(15, 'ม.5',      '11',  TRUE,  NULL),
(16, 'ม.6',      '12',  TRUE,  NULL),
(17, 'Etc',      '13',  TRUE,  NULL);

UPDATE school_grade_master
SET next_school_grade_id = school_grade_id + 1
WHERE school_grade_id <> (
  SELECT MAX(school_grade_id)
  FROM school_grade_master
);

-- =========================================================
-- Center Master
-- =========================================================

INSERT INTO center_master
(
  center_id,
  center_name,
  kumon_province,
  branch,
  instructor,
  area_manager,
  school_year,
  month_open_center,
  year_open_center,
  registration_fee,
  full_tuition,
  addition_full_tuition,
  rate_registration_fee_non_authorize,
  rate_registration_fee_authorize,
  rate_royalty
)
VALUES
(
  '66C00705',
  'UTTARADIT (TT GARDEN)',
  'อุตรดิตถ์',
  'Northern Thailand',
  'LOSONG PORNPHAN',
  'WANLAYA MAKIEW (Kluay)',
  2026,
  6,
  2016,
  535,
  1700,
  100,
  0.45,
  0.40,
  0.50
);

-- =========================================================
-- Prefix Master
-- =========================================================

INSERT INTO prefix_master
(prefix_id, prefix_name, next_prefix_id)
VALUES
(1, 'ด.ช.', 3),
(2, 'ด.ญ.', 4),
(3, 'นาย', NULL),
(4, 'นางสาว', NULL),
(5, 'นาง', NULL);

-- =========================================================
-- Gender Master
-- =========================================================

INSERT INTO gender_master
(gender_id, gender_name)
VALUES
(1, 'ชาย'),
(2, 'หญิง');

-- =========================================================
-- Payment Method Master
-- =========================================================

INSERT INTO payment_method_master
(payment_method_id, payment_method_code, payment_method_name)
VALUES
(1, 'CA', 'Cash'),
(2, 'TR', 'Bank Transfer'),
(3, 'QR', 'QR PromptPay');

-- =========================================================
-- Stock Type Master Data
-- =========================================================

INSERT INTO stock_type_master
(stock_type_id, stock_type_code, stock_type_name)
VALUES

(1, 'WS', 'Worksheet'),
(2, 'CD', 'Compact Disc'),
(3, 'AT', 'Achievement Test'),
(4, 'DT', 'Diagnostic Test');

-- =========================================================
-- Initialize Stock : Worksheet
-- =========================================================

INSERT INTO stock (
    stock_type_id,
    master_id,
    quantity
)
SELECT
    1,
    worksheet_master_id,
    0
FROM worksheet_master;

-- =========================================================
-- Initialize Stock : CD
-- =========================================================

INSERT INTO stock (
    stock_type_id,
    master_id,
    quantity
)
SELECT
    2,
    cd_master_id,
    0
FROM cd_master;

-- =========================================================
-- Initialize Stock : AT
-- =========================================================

INSERT INTO stock (
    stock_type_id,
    master_id,
    quantity
)
SELECT
    3,
    at_master_id,
    0
FROM at_master;

-- =========================================================
-- Initialize Stock : DT
-- =========================================================

INSERT INTO stock (
    stock_type_id,
    master_id,
    quantity
)
SELECT
    4,
    dt_master_id,
    0
FROM dt_master;

-- =========================================================
-- Weekday Master Data
-- =========================================================

INSERT INTO weekday_master
(weekday_id, weekday_code, weekday_name)
VALUES

(1, 'MON', 'จันทร์'),
(2, 'TUE', 'อังคาร'),
(3, 'WED', 'พุธ'),
(4, 'THU', 'พฤหัสบดี'),
(5, 'FRI', 'ศุกร์'),
(6, 'SAT', 'เสาร์'),
(7, 'SUN', 'อาทิตย์');

-- =========================================================
-- Opening Schedule Master Data
-- =========================================================

INSERT INTO opening_schedule
(weekday_id, start_time, end_time)
VALUES

-- Monday
(1,'15:00','16:00'),
(1,'16:00','17:00'),
(1,'17:00','18:00'),
(1,'18:00','19:00'),
(1,'19:00','20:00'),

-- Tuesday
(2,'15:00','16:00'),
(2,'16:00','17:00'),
(2,'17:00','18:00'),
(2,'18:00','19:00'),

-- Thursday
(4,'15:00','16:00'),
(4,'16:00','17:00'),
(4,'17:00','18:00'),
(4,'18:00','19:00'),
(4,'19:00','20:00'),

-- Friday
(5,'15:00','16:00'),
(5,'16:00','17:00'),
(5,'17:00','18:00'),
(5,'18:00','19:00'),
(5,'19:00','20:00'),

-- Saturday
(6,'09:00','10:00'),
(6,'10:00','11:00'),
(6,'11:00','12:00'),
(6,'13:00','14:00'),
(6,'14:00','15:00'),
(6,'15:00','16:00'),
(6,'16:00','17:00');