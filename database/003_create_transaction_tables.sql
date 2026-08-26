DROP TABLE IF EXISTS at_used CASCADE;
DROP TABLE IF EXISTS dt_used CASCADE;
DROP TABLE IF EXISTS cd_used CASCADE;
DROP TABLE IF EXISTS worksheet_used CASCADE;
DROP TABLE IF EXISTS billing_detail CASCADE;
DROP TABLE IF EXISTS billing CASCADE;
DROP TABLE IF EXISTS enrollment_status CASCADE;
DROP TABLE IF EXISTS enrollment CASCADE;
DROP TABLE IF EXISTS student CASCADE;
DROP TABLE IF EXISTS session;
DROP TABLE IF EXISTS app_user CASCADE;
DROP TABLE IF EXISTS stock_receive CASCADE;
DROP TABLE IF EXISTS stock_do CASCADE;

-- =========================================================
-- Student
-- =========================================================

CREATE TABLE student (

  student_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  prefix_id SMALLINT NOT NULL,

  first_name VARCHAR(100) NOT NULL,

  last_name VARCHAR(100) NOT NULL,

  nickname VARCHAR(100),

  gender_id SMALLINT,

  birth_date DATE,

  school_grade_id SMALLINT,

  school_name VARCHAR(150),

  mobile VARCHAR(20),

  email VARCHAR(150),

  address_number VARCHAR(50),

  address_village VARCHAR(100),

  address_alley VARCHAR(100),

  address_road VARCHAR(100),

  address_subdistrict VARCHAR(100),

  address_district VARCHAR(100),

  address_province VARCHAR(100),

  address_zipcode VARCHAR(10),

  remark TEXT,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_student_school_grade
    FOREIGN KEY (school_grade_id)
    REFERENCES school_grade_master(school_grade_id),

  CONSTRAINT fk_student_prefix
    FOREIGN KEY (prefix_id)
    REFERENCES prefix_master(prefix_id),

  CONSTRAINT fk_student_gender
    FOREIGN KEY (gender_id)
    REFERENCES gender_master(gender_id)
);

-- =========================================================
-- Enrollment
-- =========================================================

CREATE TABLE enrollment (

  enrollment_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  student_id INTEGER NOT NULL,

  subject_id SMALLINT NOT NULL,

  kumon_student_id VARCHAR(20),

  is_kumon_connect BOOLEAN NOT NULL DEFAULT FALSE,

  current_level_master_id SMALLINT NOT NULL,

  current_zun_level_master_id SMALLINT,

  starting_worksheet_master_id SMALLINT NOT NULL,

  en_start_date DATE NOT NULL,

  opening_schedule_id1 SMALLINT,

  opening_schedule_id2 SMALLINT,

  current_status_group1_id SMALLINT NOT NULL,

  current_status_group2_id SMALLINT,

  remark TEXT,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT uq_enrollment_student_subject
    UNIQUE (student_id, subject_id),

  CONSTRAINT fk_enrollment_student
    FOREIGN KEY (student_id)
    REFERENCES student(student_id),

  CONSTRAINT fk_enrollment_subject
    FOREIGN KEY (subject_id)
    REFERENCES subject_master(subject_id),

  CONSTRAINT fk_enrollment_current_level
    FOREIGN KEY (current_level_master_id)
    REFERENCES level_master(level_master_id),

  CONSTRAINT fk_enrollment_current_zun
    FOREIGN KEY (current_zun_level_master_id)
    REFERENCES level_master(level_master_id),

  CONSTRAINT fk_enrollment_starting_worksheet
    FOREIGN KEY (starting_worksheet_master_id)
    REFERENCES worksheet_master(worksheet_master_id),

  CONSTRAINT fk_enrollment_schedule1
    FOREIGN KEY (opening_schedule_id1)
    REFERENCES opening_schedule(opening_schedule_id),

  CONSTRAINT fk_enrollment_schedule2
    FOREIGN KEY (opening_schedule_id2)
    REFERENCES opening_schedule(opening_schedule_id),

  CONSTRAINT fk_enrollment_status_group1
    FOREIGN KEY (current_status_group1_id)
    REFERENCES status_master(status_id),

  CONSTRAINT fk_enrollment_status_group2
    FOREIGN KEY (current_status_group2_id)
    REFERENCES status_master(status_id)

);

-- =========================================================
-- Enrollment Status History
-- =========================================================

CREATE TABLE enrollment_status (

  enrollment_status_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  enrollment_id INTEGER NOT NULL,

  status_id SMALLINT NOT NULL,

  status_month SMALLINT NOT NULL,

  status_year SMALLINT NOT NULL,

  CONSTRAINT fk_enrollment_status_enrollment
    FOREIGN KEY (enrollment_id)
    REFERENCES enrollment(enrollment_id),

  CONSTRAINT fk_enrollment_status_status
    FOREIGN KEY (status_id)
    REFERENCES status_master(status_id)

);

-- =========================================================
-- Billing
-- =========================================================

CREATE TABLE billing (

  billing_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  receipt_book SMALLINT NOT NULL,

  receipt_no INTEGER NOT NULL,

  student_id INTEGER NOT NULL,

  billing_date DATE NOT NULL,

  payment_method_id SMALLINT NOT NULL,

  total_amount NUMERIC(10,2) NOT NULL DEFAULT 0,

  discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0,

  net_amount NUMERIC(10,2) NOT NULL DEFAULT 0,

  billing_month SMALLINT NOT NULL,

  billing_year SMALLINT NOT NULL,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT uq_billing_receipt
    UNIQUE (receipt_book, receipt_no),

  CONSTRAINT fk_billing_student
    FOREIGN KEY (student_id)
    REFERENCES student(student_id),

  CONSTRAINT fk_billing_payment_method
    FOREIGN KEY (payment_method_id)
    REFERENCES payment_method_master(payment_method_id)

);

-- =========================================================
-- Billing Detail
-- =========================================================

CREATE TABLE billing_detail (

  billing_detail_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  billing_id INTEGER NOT NULL,

  enrollment_id INTEGER NOT NULL,

  current_level_master_id SMALLINT NOT NULL,

  current_zun_level_master_id SMALLINT,

  status_group1_id SMALLINT NOT NULL,

  status_group2_id SMALLINT,

  tuition_fee NUMERIC(10,2) NOT NULL DEFAULT 0,

  registration_fee NUMERIC(10,2) NOT NULL DEFAULT 0,

  additional_fee NUMERIC(10,2) NOT NULL DEFAULT 0,

  discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0,

  net_amount NUMERIC(10,2) NOT NULL DEFAULT 0,

  CONSTRAINT uq_billing_detail
    UNIQUE (billing_id, enrollment_id),

  CONSTRAINT fk_billing_detail_billing
    FOREIGN KEY (billing_id)
    REFERENCES billing(billing_id),

  CONSTRAINT fk_billing_detail_enrollment
    FOREIGN KEY (enrollment_id)
    REFERENCES enrollment(enrollment_id),

  CONSTRAINT fk_billing_detail_level
    FOREIGN KEY (current_level_master_id)
    REFERENCES level_master(level_master_id),

  CONSTRAINT fk_billing_detail_zun
    FOREIGN KEY (current_zun_level_master_id)
    REFERENCES level_master(level_master_id),

  CONSTRAINT fk_billing_detail_status_group1
    FOREIGN KEY (status_group1_id)
    REFERENCES status_master(status_id),

  CONSTRAINT fk_billing_detail_status_group2
    FOREIGN KEY (status_group2_id)
    REFERENCES status_master(status_id)

);

-- =========================================================
-- Worksheet Used
-- =========================================================

CREATE TABLE worksheet_used (

  worksheet_used_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  enrollment_id INTEGER NOT NULL,

  worksheet_master_id INTEGER NOT NULL,

  actual_worksheet_no SMALLINT NOT NULL,

  worksheet_date DATE NOT NULL,

  worksheet_month SMALLINT NOT NULL,

  worksheet_year SMALLINT NOT NULL,

  cpws BOOLEAN NOT NULL DEFAULT TRUE,

  is_stock_processed BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_worksheet_used_enrollment
    FOREIGN KEY (enrollment_id)
    REFERENCES enrollment(enrollment_id),

  CONSTRAINT fk_worksheet_used_worksheet
    FOREIGN KEY (worksheet_master_id)
    REFERENCES worksheet_master(worksheet_master_id)

);

-- =========================================================
-- CD Used
-- =========================================================

CREATE TABLE cd_used (

  cd_used_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  enrollment_id INTEGER NOT NULL,

  cd_master_id SMALLINT NOT NULL,

  cd_date DATE NOT NULL,

  cd_month SMALLINT NOT NULL,

  cd_year SMALLINT NOT NULL,

  cpcd BOOLEAN NOT NULL DEFAULT TRUE,

  is_stock_processed BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_cd_used_enrollment
    FOREIGN KEY (enrollment_id)
    REFERENCES enrollment(enrollment_id),

  CONSTRAINT fk_cd_used_master
    FOREIGN KEY (cd_master_id)
    REFERENCES cd_master(cd_master_id)

);

-- =========================================================
-- DT Used
-- =========================================================

CREATE TABLE dt_used (

  dt_used_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  enrollment_id INTEGER NOT NULL,

  dt_master_id SMALLINT NOT NULL,

  dt_date DATE NOT NULL,

  score SMALLINT NOT NULL,

  used_time SMALLINT NOT NULL,

  starting_worksheet_master_id INTEGER NOT NULL,

  CONSTRAINT fk_dt_used_enrollment
    FOREIGN KEY (enrollment_id)
    REFERENCES enrollment(enrollment_id),

  CONSTRAINT fk_dt_used_master
    FOREIGN KEY (dt_master_id)
    REFERENCES dt_master(dt_master_id),

  CONSTRAINT fk_dt_used_starting_worksheet
    FOREIGN KEY (starting_worksheet_master_id)
    REFERENCES worksheet_master(worksheet_master_id)

);

-- =========================================================
-- Achievement Test (AT) Used
-- =========================================================

CREATE TABLE at_used (

  at_used_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  enrollment_id INTEGER NOT NULL,

  at_master_id SMALLINT NOT NULL,

  at_date DATE NOT NULL,

  score SMALLINT NOT NULL,

  used_time SMALLINT NOT NULL,

  at_group SMALLINT NOT NULL,

  is_pass BOOLEAN NOT NULL,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_at_used_enrollment
    FOREIGN KEY (enrollment_id)
    REFERENCES enrollment(enrollment_id),

  CONSTRAINT fk_at_used_master
    FOREIGN KEY (at_master_id)
    REFERENCES at_master(at_master_id)

);

-- =========================================================
-- Auth: Admin/Staff users
-- =========================================================
-- Only "admin"/"staff" accounts live in the database. "guest" is not a
-- stored account — guests log in with a shared PIN (kept in server
-- config, not the DB) plus a free-text display name, and get a
-- restricted session. See services/authService.js.

CREATE TABLE app_user (

  user_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  username VARCHAR(50) NOT NULL UNIQUE,

  password_hash VARCHAR(200) NOT NULL,

  display_name VARCHAR(100) NOT NULL,

  role VARCHAR(10) NOT NULL DEFAULT 'admin',

  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  last_login_at TIMESTAMP,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT app_user_role_check
    CHECK (role IN ('admin', 'staff'))

);

-- Session store for express-session (connect-pg-simple). This table's
-- shape is dictated by connect-pg-simple itself; created here so the
-- app never needs createTableIfMissing at runtime.
CREATE TABLE session (
  sid VARCHAR NOT NULL COLLATE "default" PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);

CREATE INDEX idx_session_expire ON session (expire);

-- =========================================================
-- Stock receiving (DO)
-- =========================================================
-- One shared DO system for every stock type it's used with (WS, CD, ...) —
-- mirrors how the `stock` table itself works: stock_type_id + master_id
-- together say which master table a row means (master_id carries no FK of
-- its own, it's polymorphic). See services/stockReceiveService.js.

CREATE TABLE stock_do (
  stock_do_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  do_no VARCHAR(50) NOT NULL,
  out_date DATE NOT NULL,
  receive_date DATE,
  receive_month SMALLINT NOT NULL,
  receive_year SMALLINT NOT NULL,
  is_stock_processed BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT uq_stock_do_no UNIQUE (do_no)
);

CREATE TABLE stock_receive (
  stock_receive_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stock_do_id INTEGER NOT NULL,
  stock_type_id SMALLINT NOT NULL,
  master_id INTEGER NOT NULL,
  quantity SMALLINT NOT NULL,
  CONSTRAINT uq_stock_receive_do_type_master UNIQUE (stock_do_id, stock_type_id, master_id),
  CONSTRAINT fk_stock_receive_do FOREIGN KEY (stock_do_id) REFERENCES stock_do(stock_do_id),
  CONSTRAINT fk_stock_receive_type FOREIGN KEY (stock_type_id) REFERENCES stock_type_master(stock_type_id)
);

-- =========================================================
-- Bootstrap admin account
-- =========================================================
-- So day-one setup doesn't require a separate `npm run create-admin`
-- step. Password: 123456 (bcryptjs, 10 rounds — see services/authService.js).
-- CHANGE THIS PASSWORD after first login in any environment other than
-- local dev. ON CONFLICT DO NOTHING makes this safe to re-run: it won't
-- clobber an admin account you've since renamed/repassworded via the
-- Users page.

INSERT INTO app_user (username, password_hash, display_name, role, is_active)
VALUES (
  'admin',
  '$2b$10$N9q8XcqSHUNdbyuVWU/y9.k3goIllqAxKuare5bo2JQRGvKq6xmny',
  'Admin',
  'admin',
  TRUE
)
ON CONFLICT (username) DO NOTHING;
