-- Add a role to app_user so DB-backed accounts can be either a full
-- "admin" (everything, including Table Explorer + migration tools) or a
-- "staff" account (everything an admin can do EXCEPT Table Explorer and
-- migration tools). "guest" is still not a stored account — see
-- services/authService.js.

ALTER TABLE app_user
ADD COLUMN IF NOT EXISTS role VARCHAR(10) NOT NULL DEFAULT 'admin';

ALTER TABLE app_user
ADD CONSTRAINT app_user_role_check CHECK (role IN ('admin', 'staff'));
