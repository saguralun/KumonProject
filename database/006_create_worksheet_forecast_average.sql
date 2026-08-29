-- Summary/cache table for Worksheet Forecast.
-- This table is recalculated from worksheet_used and lets the Forecast page
-- avoid scanning the full worksheet history every time.

CREATE TABLE IF NOT EXISTS kumon.worksheet_forecast_average (
  worksheet_forecast_average_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  subject_id SMALLINT NOT NULL,
  level_master_id SMALLINT NOT NULL,
  worksheet_packet_no SMALLINT NOT NULL,

  source_scope VARCHAR(10) NOT NULL,
  student_count INTEGER NOT NULL DEFAULT 0,
  sample_count INTEGER NOT NULL DEFAULT 0,

  avg_days_per_student NUMERIC(8,2),
  avg_cpws_per_student NUMERIC(8,2),

  min_days INTEGER,
  max_days INTEGER,
  min_cpws INTEGER,
  max_cpws INTEGER,

  calculated_from DATE,
  calculated_to DATE,
  calculated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT uq_worksheet_forecast_average
    UNIQUE (subject_id, level_master_id, worksheet_packet_no, source_scope),

  CONSTRAINT ck_worksheet_forecast_average_scope
    CHECK (source_scope IN ('2Y', 'ALL')),

  CONSTRAINT fk_worksheet_forecast_average_subject
    FOREIGN KEY (subject_id)
    REFERENCES kumon.subject_master(subject_id),

  CONSTRAINT fk_worksheet_forecast_average_level
    FOREIGN KEY (level_master_id)
    REFERENCES kumon.level_master(level_master_id)
);

CREATE INDEX IF NOT EXISTS idx_worksheet_forecast_average_lookup
  ON kumon.worksheet_forecast_average
  (subject_id, level_master_id, worksheet_packet_no, source_scope);

CREATE INDEX IF NOT EXISTS idx_worksheet_forecast_average_calculated_at
  ON kumon.worksheet_forecast_average
  (calculated_at);
