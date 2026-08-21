DROP TABLE IF EXISTS worksheet_receive CASCADE;
DROP TABLE IF EXISTS worksheet_do CASCADE;

CREATE TABLE worksheet_do (
  worksheet_do_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  do_no VARCHAR(50) NOT NULL,
  out_date DATE NOT NULL,
  receive_date DATE,
  receive_month SMALLINT NOT NULL,
  receive_year SMALLINT NOT NULL,
  is_stock_processed BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT uq_worksheet_do_no UNIQUE (do_no)
);

CREATE TABLE worksheet_receive (
  worksheet_receive_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  worksheet_do_id INTEGER NOT NULL,
  worksheet_master_id INTEGER NOT NULL,
  quantity SMALLINT NOT NULL,
  CONSTRAINT uq_worksheet_receive_do_worksheet UNIQUE (worksheet_do_id, worksheet_master_id),
  CONSTRAINT fk_worksheet_receive_do FOREIGN KEY (worksheet_do_id) REFERENCES worksheet_do(worksheet_do_id),
  CONSTRAINT fk_worksheet_receive_master FOREIGN KEY (worksheet_master_id) REFERENCES worksheet_master(worksheet_master_id)
);
