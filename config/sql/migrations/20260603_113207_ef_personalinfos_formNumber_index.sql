-- Migration: ef_personalinfos_formNumber_index
-- Created: 2026-06-03T11:32:07.377Z

-- ─────────────────────────────────────────────────────────────
-- UP
-- ─────────────────────────────────────────────────────────────

SET @idx_exists = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'ef_personalinfos'
    AND INDEX_NAME   = 'idx_personalinfos_formNumber'
);

SET @add_idx = IF(
  @idx_exists = 0,
  'ALTER TABLE ef_personalinfos ADD INDEX idx_personalinfos_formNumber (formNumber)',
  'SELECT ''idx_personalinfos_formNumber already exists — skipping ADD INDEX'''
);

PREPARE stmt FROM @add_idx;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- ─────────────────────────────────────────────────────────────
-- DOWN
-- ─────────────────────────────────────────────────────────────

-- Drop index if it exists
SET @idx_exists = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'ef_personalinfos'
    AND INDEX_NAME   = 'idx_personalinfos_formNumber'
);

SET @drop_idx = IF(
  @idx_exists > 0,
  'ALTER TABLE ef_personalinfos DROP INDEX idx_personalinfos_formNumber',
  'SELECT ''idx_personalinfos_formNumber does not exist — skipping DROP INDEX'''
);

PREPARE stmt FROM @drop_idx;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
