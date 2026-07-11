-- Migration: bank_account_integration_nok
-- Created: 2026-07-11T16:49:21.132Z

-- =========================
-- UP
-- =========================

-- 1. Add column nok_acc ONLY if it does not exist
SET @col_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'ef_nok'
    AND COLUMN_NAME = 'nok_acc'
    AND TABLE_SCHEMA = DATABASE()
);

SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE ef_nok ADD COLUMN nok_acc VARCHAR(100) NULL;',
  'SELECT "Column nok_acc already exists";'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- 2. Add column nok_bank ONLY if it does not exist
SET @col_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'ef_nok'
    AND COLUMN_NAME = 'nok_bank'
    AND TABLE_SCHEMA = DATABASE()
);

SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE ef_nok ADD COLUMN nok_bank VARCHAR(100) NULL;',
  'SELECT "Column nok_bank already exists";'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- =========================
-- DOWN (Rollback)
-- =========================



-- 1. Drop column nok_bank ONLY if it exists
SET @col_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'ef_nok'
    AND COLUMN_NAME = 'nok_bank'
    AND TABLE_SCHEMA = DATABASE()
);

SET @sql = IF(
  @col_exists > 0,
  'ALTER TABLE ef_nok DROP COLUMN nok_bank;',
  'SELECT "Column does not exist";'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- 2. Drop column nok_acc ONLY if it exists
SET @col_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'ef_nok'
    AND COLUMN_NAME = 'nok_acc'
    AND TABLE_SCHEMA = DATABASE()
);

SET @sql = IF(
  @col_exists > 0,
  'ALTER TABLE ef_nok DROP COLUMN nok_acc;',
  'SELECT "Column does not exist";'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;