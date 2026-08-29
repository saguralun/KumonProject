-- =========================================================
-- Kumon Management System
-- Master Tables
-- =========================================================

DROP TABLE IF EXISTS dt_result_master CASCADE;
DROP TABLE IF EXISTS dt_master CASCADE;
DROP TABLE IF EXISTS at_master CASCADE;
DROP TABLE IF EXISTS cd_master CASCADE;

DROP TABLE IF EXISTS worksheet_master CASCADE;
DROP TABLE IF EXISTS level_master CASCADE;

DROP TABLE IF EXISTS prefix_master cascade;
DROP TABLE IF EXISTS gender_master cascade;
DROP TABLE IF EXISTS payment_method_master cascade;
DROP TABLE IF EXISTS stock cascade;
DROP TABLE IF EXISTS stock_type_master cascade;

DROP TABLE IF EXISTS subject_master CASCADE;
DROP TABLE IF EXISTS status_master CASCADE;
DROP TABLE IF EXISTS school_grade_master CASCADE;
DROP TABLE IF EXISTS center_master CASCADE;
DROP TABLE IF EXISTS opening_schedule CASCADE;
DROP TABLE IF EXISTS weekday_master CASCADE;

-- =========================================================
-- Subject Master
-- =========================================================

CREATE TABLE subject_master (

	subject_id SMALLINT PRIMARY KEY,

	subject_code VARCHAR(10) NOT NULL,

	subject_name VARCHAR(100) NOT NULL,

	kumon_subject_id VARCHAR(10) NOT NULL,

	authorize BOOLEAN NOT NULL,

	month_authorize SMALLINT,

	year_authorize SMALLINT,

	CONSTRAINT uq_subject_code
		UNIQUE(subject_code),

	CONSTRAINT uq_kumon_subject_id
		UNIQUE(kumon_subject_id)

);

-- =========================================================
-- Level Master
-- =========================================================

CREATE TABLE level_master (

	level_master_id SMALLINT PRIMARY KEY,

	subject_id SMALLINT NOT NULL,

	level_code VARCHAR(10) NOT NULL,

-- level_type 1 = Normal, 2 = ZUN
	level_type SMALLINT NOT NULL,

	next_level_master_id SMALLINT,

	CONSTRAINT fk_level_subject
		FOREIGN KEY (subject_id)
		REFERENCES subject_master(subject_id),

	CONSTRAINT fk_level_next
		FOREIGN KEY (next_level_master_id)
		REFERENCES level_master(level_master_id),

	CONSTRAINT uq_level_subject_code
    UNIQUE(subject_id, level_code)

);

-- =========================================================
-- Worksheet Master
-- =========================================================

CREATE TABLE worksheet_master (

	worksheet_master_id SMALLINT PRIMARY KEY,

	level_master_id SMALLINT NOT NULL,

	worksheet_no SMALLINT NOT NULL,

	next_worksheet_master_id SMALLINT,

	CONSTRAINT fk_worksheet_level
		FOREIGN KEY (level_master_id)
		REFERENCES level_master(level_master_id),

	CONSTRAINT fk_worksheet_next
		FOREIGN KEY (next_worksheet_master_id)
		REFERENCES worksheet_master(worksheet_master_id),

	constraint uq_worksheet_level_no
		UNIQUE(level_master_id, worksheet_no)

);

-- =========================================================
-- CD Master
-- =========================================================

CREATE TABLE cd_master (

	cd_master_id SMALLINT PRIMARY KEY,

	level_master_id SMALLINT NOT NULL,

	cd_no SMALLINT NOT NULL,

	CONSTRAINT fk_cd_level
		FOREIGN KEY (level_master_id)
		REFERENCES level_master(level_master_id),

	constraint uq_cd_level_no
		UNIQUE(level_master_id, cd_no)

);

-- =========================================================
-- DT Master
-- =========================================================

CREATE TABLE dt_master (

	dt_master_id SMALLINT PRIMARY KEY,

	subject_id SMALLINT NOT NULL,

	test_level VARCHAR(10) NOT NULL,

	max_score SMALLINT NOT NULL,

	max_time SMALLINT NOT NULL,

	CONSTRAINT fk_dt_subject
		FOREIGN KEY (subject_id)
		REFERENCES subject_master(subject_id),

	constraint uq_dt_subject_level
		UNIQUE(subject_id, test_level)

);

-- =========================================================
-- DT Result Master
-- =========================================================

CREATE TABLE dt_result_master (

	dt_result_master_id SMALLINT PRIMARY KEY,

	dt_master_id SMALLINT NOT NULL,

	worksheet_master_id SMALLINT NOT NULL,

	CONSTRAINT fk_dt_result_master
		FOREIGN KEY (dt_master_id)
		REFERENCES dt_master(dt_master_id),

	CONSTRAINT fk_dt_result_worksheet
		FOREIGN KEY (worksheet_master_id)
		REFERENCES worksheet_master(worksheet_master_id)

);

-- =========================================================
-- AT Master
-- =========================================================

CREATE TABLE at_master (

	at_master_id SMALLINT PRIMARY KEY,

	subject_id SMALLINT NOT NULL,

	level_master_id SMALLINT NOT NULL,

	max_score SMALLINT NOT NULL,

	max_time SMALLINT NOT NULL,

	CONSTRAINT fk_at_subject
		FOREIGN KEY (subject_id)
		REFERENCES subject_master(subject_id),

	CONSTRAINT fk_at_level
		FOREIGN KEY (level_master_id)
		REFERENCES level_master(level_master_id),
	
	constraint uq_at_subject_level
		UNIQUE(subject_id, level_master_id)

);

-- =========================================================
-- Status Master
-- =========================================================

CREATE TABLE status_master (

	status_id SMALLINT PRIMARY KEY,

	status_code VARCHAR(10) NOT NULL,

	status_name VARCHAR(100) NOT NULL,

-- status_group 1 = Enrollment Status, 2 = Special Status
	status_group SMALLINT NOT NULL,

	CONSTRAINT uq_status_code
		UNIQUE (status_code)

);

-- =========================================================
-- School Grade Master
-- =========================================================

CREATE TABLE school_grade_master (

	school_grade_id SMALLINT PRIMARY KEY,

	school_class VARCHAR(20) NOT NULL,

	school_grade VARCHAR(5) NOT NULL,

	addition_fee BOOLEAN NOT NULL,

	next_school_grade_id SMALLINT,

	CONSTRAINT uq_school_class
		UNIQUE (school_class),

	CONSTRAINT uq_school_grade
		UNIQUE (school_grade),

	CONSTRAINT fk_next_school_grade
		FOREIGN KEY (next_school_grade_id)
		REFERENCES school_grade_master(school_grade_id)

);

-- =========================================================
-- Center Master
-- =========================================================

CREATE TABLE center_master (

	center_id VARCHAR(10) PRIMARY KEY,

	center_name VARCHAR(100) NOT NULL,

	kumon_province VARCHAR(100) NOT NULL,

	branch VARCHAR(100) NOT NULL,

	instructor VARCHAR(100) NOT NULL,

	area_manager VARCHAR(100) NOT NULL,

	school_year SMALLINT NOT NULL,

	month_open_center SMALLINT NOT NULL,

	year_open_center SMALLINT NOT NULL,

	registration_fee NUMERIC(8,2) NOT NULL,

	full_tuition NUMERIC(8,2) NOT NULL,

	addition_full_tuition NUMERIC(8,2) NOT NULL,

	rate_registration_fee_non_authorize NUMERIC(5,2) NOT NULL,

	rate_registration_fee_authorize NUMERIC(5,2) NOT NULL,

	rate_royalty NUMERIC(5,2) NOT NULL

);

-- =========================================================
-- Prefix Master
-- =========================================================

CREATE TABLE prefix_master (

	prefix_id SMALLINT PRIMARY KEY,

	prefix_name VARCHAR(20) NOT NULL,

	next_prefix_id SMALLINT,

	CONSTRAINT uq_prefix_name
		UNIQUE (prefix_name),

	CONSTRAINT fk_prefix_next
		FOREIGN KEY (next_prefix_id)
		REFERENCES prefix_master(prefix_id)

);

-- =========================================================
-- Gender Master
-- =========================================================

CREATE TABLE gender_master (

	gender_id SMALLINT PRIMARY KEY,

	gender_name VARCHAR(20) NOT NULL,

	CONSTRAINT uq_gender_name
		UNIQUE (gender_name)
		
);

-- =========================================================
-- Payment Method Master
-- =========================================================

CREATE TABLE payment_method_master (

	payment_method_id SMALLINT PRIMARY KEY,

	payment_method_code VARCHAR(10) NOT NULL,

	payment_method_name VARCHAR(50) NOT NULL,

	CONSTRAINT uq_payment_method_code
		UNIQUE (payment_method_code),

	CONSTRAINT uq_payment_method_name
		UNIQUE (payment_method_name)

);

-- =========================================================
-- Stock Type Master
-- =========================================================

CREATE TABLE stock_type_master (

	stock_type_id SMALLINT PRIMARY KEY,

	stock_type_code VARCHAR(10) NOT NULL,

	stock_type_name VARCHAR(100) NOT NULL,

	CONSTRAINT uq_stock_type_code
		UNIQUE (stock_type_code)

);

-- =========================================================
-- Stock
-- =========================================================

CREATE TABLE stock (

	stock_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

	stock_type_id SMALLINT NOT NULL,

	master_id INTEGER NOT NULL,

	quantity INTEGER NOT NULL DEFAULT 0,

	updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

	CONSTRAINT fk_stock_type
		FOREIGN KEY (stock_type_id)
		REFERENCES stock_type_master(stock_type_id),

	CONSTRAINT uq_stock
		UNIQUE (stock_type_id, master_id)

);

-- =========================================================
-- Weekday Master
-- =========================================================

CREATE TABLE weekday_master (

	weekday_id SMALLINT PRIMARY KEY,

	weekday_code VARCHAR(3) NOT NULL,

	weekday_name VARCHAR(20) NOT NULL,

	CONSTRAINT uq_weekday_code
		UNIQUE (weekday_code)

);

-- =========================================================
-- Opening Schedule Master
-- =========================================================

CREATE TABLE opening_schedule (

	opening_schedule_id SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

	weekday_id SMALLINT NOT NULL,

	start_time TIME NOT NULL,

	end_time TIME NOT NULL,

	is_active BOOLEAN NOT NULL DEFAULT TRUE,

	CONSTRAINT fk_opening_schedule_weekday
		FOREIGN KEY (weekday_id)
		REFERENCES weekday_master(weekday_id),

	CONSTRAINT uq_opening_schedule
		UNIQUE (weekday_id, start_time),

	CONSTRAINT ck_opening_schedule_time
		CHECK (start_time < end_time)

);

-- =========================================================
-- Helper Function to get worksheet_master_id by subject, level_code and worksheet_no
-- =========================================================

-- Get Worksheet Master ID

DROP FUNCTION IF EXISTS fn_get_worksheet_master_id(VARCHAR, INTEGER);
DROP FUNCTION IF EXISTS fn_get_worksheet_master_id(VARCHAR, VARCHAR, INTEGER);

CREATE FUNCTION fn_get_worksheet_master_id(
	p_subject_code VARCHAR,
	p_level_code VARCHAR,
	p_worksheet_no INTEGER
)
RETURNS SMALLINT
LANGUAGE SQL
AS $$
	SELECT wm.worksheet_master_id
	FROM worksheet_master wm
	JOIN level_master lm
		ON lm.level_master_id = wm.level_master_id
	JOIN subject_master sm
		ON sm.subject_id = lm.subject_id
	WHERE lm.level_code = p_level_code
		AND sm.subject_code = p_subject_code
		AND wm.worksheet_no = p_worksheet_no;
$$;

-- Get Level Master ID

DROP FUNCTION IF EXISTS fn_get_level_master_id(VARCHAR, VARCHAR);

CREATE FUNCTION fn_get_level_master_id(
	p_subject_code VARCHAR,
	p_level_code   VARCHAR
)
RETURNS SMALLINT
LANGUAGE SQL
AS $$
	SELECT lm.level_master_id
	FROM level_master lm
	JOIN subject_master sm
		ON sm.subject_id = lm.subject_id
	WHERE sm.subject_code = p_subject_code
		AND lm.level_code = p_level_code;
$$;
