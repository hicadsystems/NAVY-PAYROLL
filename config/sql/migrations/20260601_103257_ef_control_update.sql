-- Migration: ef_control_update
-- Created: 2026-06-01T10:32:57.883Z

-- ============================================================
-- UP
-- ============================================================

DROP PROCEDURE IF EXISTS migrate_ef_control_up;

DELIMITER $$

CREATE PROCEDURE migrate_ef_control_up()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ef_control'
      AND COLUMN_NAME  = 'formtype'
  ) THEN
    ALTER TABLE ef_control
      ADD COLUMN formtype ENUM('ALL', 'OFFICERS', 'TRAINEES', 'RATINGS') NOT NULL DEFAULT 'ALL';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ef_control'
      AND COLUMN_NAME  = 'notes'
  ) THEN
    ALTER TABLE ef_control
      ADD COLUMN notes TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ef_control'
      AND COLUMN_NAME  = 'updatedby'
  ) THEN
    ALTER TABLE ef_control
      ADD COLUMN updatedby VARCHAR(50);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ef_control'
      AND COLUMN_NAME  = 'updatedat'
  ) THEN
    ALTER TABLE ef_control
      ADD COLUMN updatedat DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
  END IF;
END$$

DELIMITER ;

CALL migrate_ef_control_up();
DROP PROCEDURE IF EXISTS migrate_ef_control_up;

-- ============================================================
-- DOWN
-- ============================================================

DROP PROCEDURE IF EXISTS migrate_ef_control_down;

DELIMITER $$

CREATE PROCEDURE migrate_ef_control_down()
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ef_control'
      AND COLUMN_NAME  = 'formtype'
  ) THEN
    ALTER TABLE ef_control DROP COLUMN formtype;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ef_control'
      AND COLUMN_NAME  = 'notes'
  ) THEN
    ALTER TABLE ef_control DROP COLUMN notes;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ef_control'
      AND COLUMN_NAME  = 'updatedby'
  ) THEN
    ALTER TABLE ef_control DROP COLUMN updatedby;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ef_control'
      AND COLUMN_NAME  = 'updatedat'
  ) THEN
    ALTER TABLE ef_control DROP COLUMN updatedat;
  END IF;
END$$

DELIMITER ;

CALL migrate_ef_control_down();
DROP PROCEDURE IF EXISTS migrate_ef_control_down;