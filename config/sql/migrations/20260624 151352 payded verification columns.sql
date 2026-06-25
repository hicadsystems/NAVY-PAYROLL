-- Migration: payded_verification_columns
-- Created: 2026-06-24
-- Purpose: Support Payment/Deductions Validation flow (BT05.sat staged lock/verify)
--   - verifiedby   : full name of user who verified a py_payded row (NULL = pending)
--   - dateverified  : timestamp the row was verified
-- Note: modification is done inline in the same modal as verify (no separate
-- modifiedby audit column requested), so it is intentionally NOT added here.

-- =========================
-- UP
-- =========================

-- 1. Add column verifiedby ONLY if it does not exist
SET @col_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'py_payded'
    AND COLUMN_NAME = 'verifiedby'
    AND TABLE_SCHEMA = DATABASE()
);

SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE py_payded ADD COLUMN verifiedby VARCHAR(100) NULL;',
  'SELECT "Column verifiedby already exists";'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- 2. Add column dateverified ONLY if it does not exist
SET @col_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'py_payded'
    AND COLUMN_NAME = 'dateverified'
    AND TABLE_SCHEMA = DATABASE()
);

SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE py_payded ADD COLUMN dateverified DATETIME NULL;',
  'SELECT "Column dateverified already exists";'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- 3. Index on verifiedby ONLY if it does not exist (speeds up pending/verified tab filtering)
SET @idx_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_NAME = 'py_payded'
    AND INDEX_NAME = 'idx_py_payded_verifiedby'
    AND TABLE_SCHEMA = DATABASE()
);

SET @sql = IF(
  @idx_exists = 0,
  'CREATE INDEX idx_py_payded_verifiedby ON py_payded (verifiedby);',
  'SELECT "Index already exists";'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- =========================
-- DOWN (Rollback)
-- =========================

-- 1. Drop index ONLY if it exists
SET @idx_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_NAME = 'py_payded'
    AND INDEX_NAME = 'idx_py_payded_verifiedby'
    AND TABLE_SCHEMA = DATABASE()
);

SET @sql = IF(
  @idx_exists > 0,
  'DROP INDEX idx_py_payded_verifiedby ON py_payded;',
  'SELECT "Index does not exist";'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- 2. Drop column dateverified ONLY if it exists
SET @col_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'py_payded'
    AND COLUMN_NAME = 'dateverified'
    AND TABLE_SCHEMA = DATABASE()
);

SET @sql = IF(
  @col_exists > 0,
  'ALTER TABLE py_payded DROP COLUMN dateverified;',
  'SELECT "Column does not exist";'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- 3. Drop column verifiedby ONLY if it exists
SET @col_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'py_payded'
    AND COLUMN_NAME = 'verifiedby'
    AND TABLE_SCHEMA = DATABASE()
);

SET @sql = IF(
  @col_exists > 0,
  'ALTER TABLE py_payded DROP COLUMN verifiedby;',
  'SELECT "Column does not exist";'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;