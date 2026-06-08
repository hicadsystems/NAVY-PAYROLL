-- Migration: ef_control_form_number_integrate
-- Created: 2026-06-08T09:01:56.258Z

-- ─────────────────────────────────────────────────────────────
-- UP
-- ─────────────────────────────────────────────────────────────

SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'ef_control'
    AND COLUMN_NAME   = 'OfficersFormNo'
);

SET @add_col = IF(
  @col_exists = 0,
  'ALTER TABLE ef_control ADD COLUMN OfficersFormNo INT',
  'SELECT ''OfficersFormNo already exists — skipping ADD COLUMN'''
);

PREPARE stmt FROM @add_col;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'ef_control'
    AND COLUMN_NAME   = 'RatingsFormNo'
);

SET @add_col = IF(
  @col_exists = 0,
  'ALTER TABLE ef_control ADD COLUMN RatingsFormNo INT',
  'SELECT ''RatingsFormNo already exists — skipping ADD COLUMN'''
);

PREPARE stmt FROM @add_col;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'ef_control'
    AND COLUMN_NAME   = 'TrainingFormNo'
);

SET @add_col = IF(
  @col_exists = 0,
  'ALTER TABLE ef_control ADD COLUMN TrainingFormNo INT',
  'SELECT ''TrainingFormNo already exists — skipping ADD COLUMN'''
);

PREPARE stmt FROM @add_col;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- ─────────────────────────────────────────────────────────────
-- DOWN
-- ─────────────────────────────────────────────────────────────

-- Drop columns if it exists
SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'ef_control'
    AND COLUMN_NAME   = 'OfficersFormNo'
);

SET @drop_col = IF(
  @col_exists > 0,
  'ALTER TABLE ef_control DROP COLUMN OfficersFormNo',
  'SELECT ''OfficersFormNo does not exist — skipping DROP COLUMN'''
);

PREPARE stmt FROM @drop_col;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'ef_control'
    AND COLUMN_NAME   = 'RatingsFormNo'
);

SET @drop_col = IF(
  @col_exists > 0,
  'ALTER TABLE ef_control DROP COLUMN RatingsFormNo',
  'SELECT ''RatingsFormNo does not exist — skipping DROP COLUMN'''
);

PREPARE stmt FROM @drop_col;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'ef_control'
    AND COLUMN_NAME   = 'TrainingFormNo'
);

SET @drop_col = IF(
  @col_exists > 0,
  'ALTER TABLE ef_control DROP COLUMN TrainingFormNo',
  'SELECT ''TrainingFormNo does not exist — skipping DROP COLUMN'''
);

PREPARE stmt FROM @drop_col;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
