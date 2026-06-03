-- Migration: ef_audit_logs_update
-- Created: 2026-06-01T10:42:48.019Z

-- ============================================================
-- UP 
-- Extend action enum to include RESPONDED and CLOSED
-- InnoDB does not support IF NOT EXISTS for MODIFY COLUMN,
-- so we use a procedure guard to make it rerunnable.
-- ============================================================

DROP PROCEDURE IF EXISTS migrate_ef_audit_logs_up;

DELIMITER $$

CREATE PROCEDURE migrate_ef_audit_logs_up()
BEGIN
  -- Check current column type; only alter if RESPONDED/CLOSED are missing
  IF NOT EXISTS (
    SELECT 1
    FROM   information_schema.COLUMNS
    WHERE  TABLE_SCHEMA = DATABASE()
      AND  TABLE_NAME   = 'ef_audit_logs'
      AND  COLUMN_NAME  = 'action'
      AND  COLUMN_TYPE LIKE '%RESPONDED%'
  ) THEN
    ALTER TABLE ef_audit_logs
      MODIFY COLUMN action ENUM(
        'INSERT', 'UPDATE', 'DELETE',
        'RESPONDED', 'CLOSED'
      ) NOT NULL;
  END IF;
END$$

DELIMITER ;

CALL migrate_ef_audit_logs_up();
DROP PROCEDURE IF EXISTS migrate_ef_audit_logs_up;

-- ============================================================
-- DOWN — Remove RESPONDED and CLOSED from action enum
-- ============================================================

DROP PROCEDURE IF EXISTS migrate_ef_audit_logs_down;

DELIMITER $$

CREATE PROCEDURE migrate_ef_audit_logs_down()
BEGIN
  IF EXISTS (
    SELECT 1
    FROM   information_schema.COLUMNS
    WHERE  TABLE_SCHEMA = DATABASE()
      AND  TABLE_NAME   = 'ef_audit_logs'
      AND  COLUMN_NAME  = 'action'
      AND  COLUMN_TYPE LIKE '%RESPONDED%'
  ) THEN
    ALTER TABLE ef_audit_logs
      MODIFY COLUMN action ENUM(
        'INSERT', 'UPDATE', 'DELETE'
      ) NOT NULL;
  END IF;
END$$

DELIMITER ;

CALL migrate_ef_audit_logs_down();
DROP PROCEDURE IF EXISTS migrate_ef_audit_logs_down;