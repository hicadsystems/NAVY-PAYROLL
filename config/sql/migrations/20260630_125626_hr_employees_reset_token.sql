-- Migration: hr_employees_reset_token
-- Created: 2026-06-30T12:56:26.176Z

-- =========================
-- UP
-- =========================

-- 1. Add column reset_hash ONLY if it does not exist
SET @col_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'hr_employees'
    AND COLUMN_NAME = 'reset_hash'
    AND TABLE_SCHEMA = DATABASE()
);

SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE hr_employees ADD COLUMN reset_hash CHAR(64) NULL;',
  'SELECT "Column reset_hash already exists";'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- 2. Add column reset_expires_at ONLY if it does not exist
SET @col_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'hr_employees'
    AND COLUMN_NAME = 'reset_expires_at'
    AND TABLE_SCHEMA = DATABASE()
);

SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE hr_employees ADD COLUMN reset_expires_at DATETIME NULL;',
  'SELECT "Column reset_expires_at already exists";'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- 3. Index on reset_hash ONLY if it does not exist (speeds up token lookup on verify)
SET @idx_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_NAME = 'hr_employees'
    AND INDEX_NAME = 'idx_hr_employees_reset_hash'
    AND TABLE_SCHEMA = DATABASE()
);

SET @sql = IF(
  @idx_exists = 0,
  'CREATE INDEX idx_hr_employees_reset_hash ON hr_employees (reset_hash);',
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
  WHERE TABLE_NAME = 'hr_employees'
    AND INDEX_NAME = 'idx_hr_employees_reset_hash'
    AND TABLE_SCHEMA = DATABASE()
);

SET @sql = IF(
  @idx_exists > 0,
  'DROP INDEX idx_hr_employees_reset_hash ON hr_employees;',
  'SELECT "Index does not exist";'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- 2. Drop column reset_expires_at ONLY if it exists
SET @col_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'hr_employees'
    AND COLUMN_NAME = 'reset_expires_at'
    AND TABLE_SCHEMA = DATABASE()
);

SET @sql = IF(
  @col_exists > 0,
  'ALTER TABLE hr_employees DROP COLUMN reset_expires_at;',
  'SELECT "Column does not exist";'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- 3. Drop column reset_hash ONLY if it exists
SET @col_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'hr_employees'
    AND COLUMN_NAME = 'reset_hash'
    AND TABLE_SCHEMA = DATABASE()
);

SET @sql = IF(
  @col_exists > 0,
  'ALTER TABLE hr_employees DROP COLUMN reset_hash;',
  'SELECT "Column does not exist";'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;