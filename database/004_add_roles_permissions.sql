-- =========================================================
-- Roles & Permissions
-- =========================================================
-- Unlike 001/003, this file is ADDITIVE ONLY — no DROP TABLE, no data
-- loss. It is safe to run against the live, already-populated database,
-- and safe to re-run (every statement is idempotent). Run it once with:
--   psql -U <user> -d <database> -f database/004_add_roles_permissions.sql
--
-- What this adds:
--   role_master       - every role that exists (admin/guest are fixed
--                        "system" roles; instructor/staff and anything an
--                        admin adds later via the Users page are ordinary
--                        rows, freely renamable/deletable).
--   permission_master - the catalog of gate-able pages (nav_group ties
--                        each one to a nav flyout group: management/
--                        warehouse/system). WS Input and Students are
--                        deliberately NOT in this table — they stay
--                        available to every logged-in role, guest
--                        included, same as before this feature.
--   role_permission   - which roles are granted which permission keys.
--                        admin bypasses this table entirely (hardcoded
--                        full access — see middleware/auth.js). The
--                        Users and Migration pages also stay hardcoded
--                        admin-only and never appear here, so granting
--                        permissions can never be used to grant more
--                        permissions.
--
-- Existing accounts stored role='staff' under the OLD two-tier model,
-- meaning "everything except ระบบ" — that's exactly what "instructor"
-- means now, so existing accounts are renamed to it below. Their actual
-- access does not change. "staff" is freed up as a new, more restricted
-- role that starts with zero accounts on it.

CREATE TABLE IF NOT EXISTS role_master (
  role_code VARCHAR(20) PRIMARY KEY,
  role_name VARCHAR(100) NOT NULL,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS permission_master (
  permission_key VARCHAR(50) PRIMARY KEY,
  permission_label VARCHAR(100) NOT NULL,
  nav_group VARCHAR(50) NOT NULL,
  sort_order SMALLINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS role_permission (
  role_code VARCHAR(20) NOT NULL REFERENCES role_master(role_code) ON DELETE CASCADE,
  permission_key VARCHAR(50) NOT NULL REFERENCES permission_master(permission_key) ON DELETE CASCADE,
  PRIMARY KEY (role_code, permission_key)
);

INSERT INTO role_master (role_code, role_name, is_system, sort_order) VALUES
  ('admin', 'Admin', TRUE, 0),
  ('instructor', 'Instructor', FALSE, 1),
  ('staff', 'Staff', FALSE, 2),
  ('guest', 'Guest', TRUE, 3)
ON CONFLICT (role_code) DO NOTHING;

UPDATE app_user SET role = 'instructor' WHERE role = 'staff';

-- role can now be any role_master row, not just a hardcoded 'admin'/'staff'
-- pair — widen it to match role_master.role_code's length and point it at
-- that table instead of the old fixed CHECK.
ALTER TABLE app_user ALTER COLUMN role TYPE VARCHAR(20);
ALTER TABLE app_user DROP CONSTRAINT IF EXISTS app_user_role_check;
ALTER TABLE app_user DROP CONSTRAINT IF EXISTS fk_app_user_role;
ALTER TABLE app_user
  ADD CONSTRAINT fk_app_user_role FOREIGN KEY (role) REFERENCES role_master(role_code);

INSERT INTO permission_master (permission_key, permission_label, nav_group, sort_order) VALUES
  ('page:payment', 'Payment', 'management', 1),
  ('page:report', 'Report', 'management', 2),
  ('page:progress-chart', 'Progress Chart', 'management', 3),
  ('page:statistics', 'Statistics', 'management', 4),
  ('page:stock', 'Stock', 'warehouse', 1),
  ('page:stock-receive', 'Stock Receive', 'warehouse', 2),
  ('page:stock-cut', 'Stock Cut', 'warehouse', 3),
  ('page:forecast', 'Forecast & Order', 'warehouse', 4),
  ('page:tables', 'Tables', 'system', 1),
  ('page:opening-schedule', 'Opening Schedule', 'system', 2)
ON CONFLICT (permission_key) DO NOTHING;

-- Default grants matching what was asked for:
--   instructor = everything except the ระบบ (system) group
--   staff      = everything except ระบบ AND จัดการ (management)
-- All freely editable afterward from the Users page.
INSERT INTO role_permission (role_code, permission_key)
SELECT 'instructor', permission_key FROM permission_master WHERE nav_group IN ('management', 'warehouse')
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_code, permission_key)
SELECT 'staff', permission_key FROM permission_master WHERE nav_group = 'warehouse'
ON CONFLICT DO NOTHING;
