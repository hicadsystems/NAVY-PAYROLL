-- Migration: update_ef_ranks_rank_type
-- Created: 2026-06-10T13:12:33.827Z

-- ─────────────────────────────────────────────────────────────
-- UP
-- ─────────────────────────────────────────────────────────────

-- Add column if missing
SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ef_ranks'
    AND COLUMN_NAME = 'rankType'
);

SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE ef_ranks ADD COLUMN rankType TEXT',
  'SELECT ''rankType already exists — skipping'''
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- Check if ANY primary key exists
SET @pk_exists = (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ef_ranks'
    AND CONSTRAINT_TYPE = 'PRIMARY KEY'
);

-- Check if Id is already the PK column
SET @id_is_pk = (
  SELECT COUNT(*)
  FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ef_ranks'
    AND COLUMN_NAME = 'Id'
    AND CONSTRAINT_NAME = 'PRIMARY'
);

-- Add PK only if table has no PK at all
SET @sql = IF(
  @pk_exists = 0,
  'ALTER TABLE ef_ranks ADD PRIMARY KEY (Id), MODIFY COLUMN Id INT NOT NULL AUTO_INCREMENT',
  'SELECT ''PK already exists — skipping'''
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ─────────────────────────────────────────────────────────────
-- DOWN
-- ─────────────────────────────────────────────────────────────

-- Drop column safely
SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ef_ranks'
    AND COLUMN_NAME = 'rankType'
);

SET @sql = IF(
  @col_exists > 0,
  'ALTER TABLE ef_ranks DROP COLUMN rankType',
  'SELECT ''rankType does not exist — skipping'''
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- Check PK existence (correct way)
SET @pk_exists = (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ef_ranks'
    AND CONSTRAINT_TYPE = 'PRIMARY KEY'
);

-- Check if Id is part of PK
SET @id_is_pk = (
  SELECT COUNT(*)
  FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ef_ranks'
    AND COLUMN_NAME = 'Id'
    AND CONSTRAINT_NAME = 'PRIMARY'
);

-- Only drop PK if Id was actually the PK AND PK exists
SET @sql = IF(
  @pk_exists > 0 AND @id_is_pk > 0,
  'ALTER TABLE ef_ranks DROP PRIMARY KEY',
  'SELECT ''PK not managed by this migration — skipping'''
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;