-- Migration: ef_ships_openship_update
-- Created: 2026-06-01T11:57:12.633Z


-- ============================================================
-- UP
-- ============================================================

DROP PROCEDURE IF EXISTS migrate_ef_ships_up;

CREATE PROCEDURE migrate_ef_ships_up()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ef_ships'
      AND COLUMN_NAME  = 'openship'
  ) THEN
    ALTER TABLE ef_ships
      ADD COLUMN openship TINYINT(1) NOT NULL DEFAULT 0;
  END IF;
END;

CALL migrate_ef_ships_up();

DROP PROCEDURE IF EXISTS migrate_ef_ships_up;

-- ============================================================
-- DOWN
-- ============================================================

DROP PROCEDURE IF EXISTS migrate_ef_ships_down;

CREATE PROCEDURE migrate_ef_ships_down()
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ef_ships'
      AND COLUMN_NAME  = 'openship'
  ) THEN
    ALTER TABLE ef_ships DROP COLUMN openship;
  END IF;
END;

CALL migrate_ef_ships_down();

DROP PROCEDURE IF EXISTS migrate_ef_ships_down;
