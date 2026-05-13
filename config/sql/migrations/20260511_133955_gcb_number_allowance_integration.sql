-- Migration: gcb_number_allowance_integration
-- Created: 2026-05-11T13:39:55.967Z

-- UP
-- Add your schema changes here
SET @col_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'ef_allowances'
    AND COLUMN_NAME = 'gcb_number'
    AND TABLE_SCHEMA = DATABASE()
);

SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE ef_allowances ADD COLUMN gcb_number VARCHAR(255) NULL AFTER specify;',
  'SELECT "Column gcb_number already exists";'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- DOWN
-- Add rollback logic here (reverse of UP)

SET @col_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'ef_allowances'
    AND COLUMN_NAME = 'gcb_number'
    AND TABLE_SCHEMA = DATABASE()
);

SET @sql = IF(
  @col_exists > 0,
  'ALTER TABLE ef_allowances DROP COLUMN gcb_number;',
  'SELECT "Column gcb_number does not exist";'
);


PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;