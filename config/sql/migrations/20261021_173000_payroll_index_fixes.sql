-- @scope: all   (every payroll database)
-- Migration: payroll_index_fixes
-- Created: 2026-10-21T17:30:00.000Z
-- Payslip Sync plan §6 / §12.2. Runs on every payroll database.
--   1. Guard: stop if py_ipis_payhistory has duplicate or NULL (period, numb, Type)
--   2. py_ipis_payhistory  PRIMARY KEY (period, numb, Type)
--   3. py_webpayslip       INDEX idx_webpayslip_ws_ord_desc (work_station, ord, desc1)
--   4. py_masterpayded / py_mastercum: drop uk_empno_type and
--      idx_mastercum_empno_type (duplicates of the primary key) — only when a PK exists

-- =========================
-- UP
-- =========================

-- 1. Guard. A failing statement here stops the migration before anything changes.
SET @has_tbl = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'py_ipis_payhistory');

SET @has_pk = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'py_ipis_payhistory'
    AND CONSTRAINT_TYPE = 'PRIMARY KEY');

SET @sql = IF(@has_tbl = 1 AND @has_pk = 0,
  'SELECT (SELECT COUNT(*) FROM (SELECT 1 FROM py_ipis_payhistory GROUP BY period, numb, Type HAVING COUNT(*) > 1) d) + (SELECT COUNT(*) FROM py_ipis_payhistory WHERE period IS NULL OR numb IS NULL OR Type IS NULL) INTO @bad',
  'SELECT 0 INTO @bad');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(@bad > 0,
  'SELECT `ABORT_py_ipis_payhistory_has_duplicate_or_null_keys`',
  'SELECT "py_ipis_payhistory key check: clean"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. Primary key on py_ipis_payhistory
SET @sql = IF(@has_tbl = 1 AND @has_pk = 0,
  'ALTER TABLE py_ipis_payhistory ADD PRIMARY KEY (period, numb, Type)',
  'SELECT "py_ipis_payhistory: PK exists or table missing, skipping"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3. Lookup index on py_webpayslip
SET @has_tbl = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'py_webpayslip');
SET @idx = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'py_webpayslip'
    AND INDEX_NAME = 'idx_webpayslip_ws_ord_desc');
SET @sql = IF(@has_tbl = 1 AND @idx = 0,
  'CREATE INDEX idx_webpayslip_ws_ord_desc ON py_webpayslip (work_station, ord, desc1)',
  'SELECT "py_webpayslip: index exists or table missing, skipping"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4a. py_masterpayded.uk_empno_type
SET @pk = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'py_masterpayded' AND CONSTRAINT_TYPE = 'PRIMARY KEY');
SET @idx = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'py_masterpayded' AND INDEX_NAME = 'uk_empno_type');
SET @sql = IF(@pk = 1 AND @idx > 0,
  'ALTER TABLE py_masterpayded DROP INDEX uk_empno_type',
  'SELECT "py_masterpayded.uk_empno_type: absent or no PK, skipping"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4b. py_mastercum.uk_empno_type
SET @pk = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'py_mastercum' AND CONSTRAINT_TYPE = 'PRIMARY KEY');
SET @idx = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'py_mastercum' AND INDEX_NAME = 'uk_empno_type');
SET @sql = IF(@pk = 1 AND @idx > 0,
  'ALTER TABLE py_mastercum DROP INDEX uk_empno_type',
  'SELECT "py_mastercum.uk_empno_type: absent or no PK, skipping"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4c. py_mastercum.idx_mastercum_empno_type
SET @idx = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'py_mastercum' AND INDEX_NAME = 'idx_mastercum_empno_type');
SET @sql = IF(@pk = 1 AND @idx > 0,
  'ALTER TABLE py_mastercum DROP INDEX idx_mastercum_empno_type',
  'SELECT "py_mastercum.idx_mastercum_empno_type: absent or no PK, skipping"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- =========================
-- DOWN
-- =========================

SET @idx = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'py_mastercum' AND INDEX_NAME = 'idx_mastercum_empno_type');
SET @sql = IF(@idx = 0,
  'CREATE INDEX idx_mastercum_empno_type ON py_mastercum (his_empno, his_type)',
  'SELECT "exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'py_mastercum' AND INDEX_NAME = 'uk_empno_type');
SET @sql = IF(@idx = 0,
  'ALTER TABLE py_mastercum ADD UNIQUE KEY uk_empno_type (his_empno, his_type)',
  'SELECT "exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'py_masterpayded' AND INDEX_NAME = 'uk_empno_type');
SET @sql = IF(@idx = 0,
  'ALTER TABLE py_masterpayded ADD UNIQUE KEY uk_empno_type (his_empno, his_type)',
  'SELECT "exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'py_webpayslip' AND INDEX_NAME = 'idx_webpayslip_ws_ord_desc');
SET @sql = IF(@idx > 0,
  'DROP INDEX idx_webpayslip_ws_ord_desc ON py_webpayslip',
  'SELECT "absent"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @pk = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'py_ipis_payhistory' AND CONSTRAINT_TYPE = 'PRIMARY KEY');
SET @sql = IF(@pk > 0,
  'ALTER TABLE py_ipis_payhistory DROP PRIMARY KEY',
  'SELECT "absent"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
