-- Migration: unified_auth_migration
-- Created: 2026-04-27T09:23:11.991Z

-- UP
-- ═══════════════════════════════════════════════════════════════════════════════
-- EMOLUMENT SYSTEM — PHASE 1: Unified Authentication
-- FILE: 03c_unified_auth_migration.sql (FINAL)
-- DESC: Unified auth via hr_employees as password source.
--       PRODUCTION SAFE: All operations check existence before executing
--
-- RUN ORDER:
--   01_schema_remediation.sql
--   02_new_tables.sql
--   03_seed_migration.sql   (NOK/children/loans/allowances/photos)
--   03b_seed_migration_fix.sql  (truncation fixes)
--   THIS FILE
-- ═══════════════════════════════════════════════════════════════════════════════

USE hicaddata;


-- =============================================================
-- EMOLUMENT SYSTEM
-- DESC: Add authentication columns to hr_employees
-- PRODUCTION SAFE: Checks for existing columns before adding
-- =============================================================

-- Add token column if it doesn't exist
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'hr_employees' AND column_name = 'token'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE hr_employees ADD COLUMN token TEXT DEFAULT NULL COMMENT "Current JWT — cleared on logout, replaced on new login"',
  'SELECT "hr_employees: token column exists, skipping"');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Add index for token lookups
SET @idx_exists = (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'hr_employees' AND index_name = 'idx_hr_empl_id_token'
);
SET @sql = IF(@idx_exists = 0,
  'ALTER TABLE hr_employees ADD INDEX idx_hr_empl_id_token (Empl_ID)',
  'SELECT "hr_employees: Index idx_hr_empl_id_token exists, skipping"');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─────────────────────────────────────────────────────────────
-- SECTION A: ADD PASSWORD COLUMNS TO hr_employees
-- Single source of truth for ALL personnel authentication.
-- PRODUCTION SAFE: Checks for existing columns before adding
-- ─────────────────────────────────────────────────────────────

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'hr_employees' AND column_name = 'password'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE hr_employees ADD COLUMN password VARCHAR(255) DEFAULT NULL COMMENT "Unified password — initial value is BankACNumber"',
  'SELECT "hr_employees: password column exists, skipping"');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'hr_employees' AND column_name = 'password_changed_at'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE hr_employees ADD COLUMN password_changed_at DATETIME DEFAULT NULL COMMENT "Set when user changes from default password"',
  'SELECT "hr_employees: password_changed_at column exists, skipping"');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'hr_employees' AND column_name = 'force_change'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE hr_employees ADD COLUMN force_change TINYINT(1) DEFAULT 1 COMMENT "1 = must change password on next login"',
  'SELECT "hr_employees: force_change column exists, skipping"');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─────────────────────────────────────────────────────────────
-- SECTION B: SEED PASSWORDS — ONE FAST BATCH UPDATE
--
-- Priority order:
--   1. BankACNumber  (what old system used)
--   2. Empl_ID       (fallback if no account number)
--
-- No cross-database queries. No subqueries. Single UPDATE.
-- PRODUCTION SAFE: Only updates rows where password is still NULL
-- ─────────────────────────────────────────────────────────────

SET SQL_SAFE_UPDATES = 0;
UPDATE hr_employees
SET
  password = CASE
    WHEN BankACNumber IS NOT NULL
      AND TRIM(BankACNumber) != ''
    THEN TRIM(BankACNumber)
    ELSE Empl_ID
  END,
  force_change = 1
WHERE password IS NULL;
SET SQL_SAFE_UPDATES = 1;

-- How many got seeded?
SELECT
  'Passwords seeded (re-run safe)' AS status,
  COUNT(*) AS total,
  SUM(CASE WHEN BankACNumber IS NOT NULL AND TRIM(BankACNumber) != '' THEN 1 ELSE 0 END) AS from_bank_account,
  SUM(CASE WHEN BankACNumber IS NULL OR TRIM(BankACNumber) = '' THEN 1 ELSE 0 END) AS from_empl_id
FROM hr_employees
WHERE password IS NOT NULL;


-- ─────────────────────────────────────────────────────────────
-- SECTION C: FIX WRONG EMOL_ADMIN SEEDING
-- The previous 03_seed_migration.sql wrongly made everyone from
-- ef_nodeusers an EMOL_ADMIN. nodeusers = 40k personnel, not admins.
-- Delete all migration-seeded EMOL_ADMINs.
-- ─────────────────────────────────────────────────────────────

DELETE FROM ef_user_roles
WHERE role = 'EMOL_ADMIN'
  AND assigned_by IN ('SYSTEM_MIGRATION', 'BOOTSTRAP');

SELECT 'EMOL_ADMINs after cleanup' AS status, COUNT(*) AS count
FROM ef_user_roles WHERE role = 'EMOL_ADMIN';
-- Should return 0. Real admins inserted below.


-- ─────────────────────────────────────────────────────────────
-- SECTION D: BOOTSTRAP REAL EMOL_ADMINs
--
-- !! ACTION REQUIRED !!
-- Get the service numbers of the 2-3 real system admins from
-- the client. Uncomment and fill in below before running.
-- These are the CPO office staff who managed the old system.
-- ─────────────────────────────────────────────────────────────

/*
INSERT INTO ef_user_roles
  (user_id, role, scope_type, scope_value, assigned_by)
VALUES
  ('NN/XXXXX', 'EMOL_ADMIN', 'GLOBAL', NULL, 'SYSTEM_SETUP'),
  ('NN/XXXXX', 'EMOL_ADMIN', 'GLOBAL', NULL, 'SYSTEM_SETUP');
  -- Add more rows as needed
*/


-- ─────────────────────────────────────────────────────────────
-- SECTION E: VERIFY SHIP OFFICERS STILL INTACT
-- (seeded from ef_shiplogins in 03_seed_migration.sql)
-- ─────────────────────────────────────────────────────────────

SELECT
  role,
  scope_type,
  COUNT(*) AS count
FROM ef_user_roles
WHERE role IN ('DO', 'FO', 'CPO')
  AND is_active = 1
GROUP BY role, scope_type;


-- ─────────────────────────────────────────────────────────────
-- SECTION F: DROP OLD REDUNDANT TABLES
-- ef_nodeusers data has been accounted for (personnel = ef_personalinfos)
-- ef_shiplogins data migrated to ef_user_roles in 03_seed_migration
-- ef_personnellogins replaced by hr_employees + ef_user_roles
-- ─────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS ef_nodeusers;
DROP TABLE IF EXISTS ef_personnellogins;
-- ef_shiplogins already dropped in 03_seed_migration.sql
-- if it still exists here, drop it:
DROP TABLE IF EXISTS ef_shiplogins;


-- ─────────────────────────────────────────────────────────────
-- FINAL AUDIT
-- Run this after everything to confirm state is correct
-- ─────────────────────────────────────────────────────────────

SELECT
  '── FINAL AUTH STATE ──'                                           AS '',
  NULL                                                               AS count;

SELECT 'hr_employees with password'   AS check_name,
       COUNT(*)                        AS count
FROM hr_employees WHERE password IS NOT NULL;

SELECT 'hr_employees WITHOUT password' AS check_name,
       COUNT(*)                         AS count
FROM hr_employees WHERE password IS NULL;
-- Should be 0

SELECT 'payroll users (users table)'  AS check_name,
       COUNT(*)                        AS count
FROM users;
-- Should be the small number of payroll staff only (~100-500)
-- NOT 40k

SELECT 'emolument personnel'          AS check_name,
       COUNT(*)                        AS count
FROM ef_personalinfos;

SELECT 'EMOL_ADMINs'                  AS check_name,
       COUNT(*)                        AS count
FROM ef_user_roles WHERE role = 'EMOL_ADMIN' AND is_active = 1;
-- Should be 2-3 after manual bootstrap

SELECT 'Ship officers (DO/FO/CPO)'    AS check_name,
       COUNT(*)                        AS count
FROM ef_user_roles
WHERE role IN ('DO','FO','CPO') AND is_active = 1;

-- Personnel in ef_personalinfos but NOT in hr_employees
-- (these people can do emolument but NOT payslip)
SELECT 'In emolument but not payroll HR' AS check_name,
       COUNT(*)                           AS count
FROM ef_personalinfos p
WHERE NOT EXISTS (
  SELECT 1 FROM hr_employees h WHERE h.Empl_ID = p.serviceNumber
);

-- Drop password column from users table since payroll is now unified with hr_employees
SET @col_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'password'
);

SET @sql := IF(@col_exists > 0,
  'ALTER TABLE users DROP COLUMN password',
  'SELECT "Column does not exist"'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- DOWN
-- Add rollback logic here (reverse of UP)

