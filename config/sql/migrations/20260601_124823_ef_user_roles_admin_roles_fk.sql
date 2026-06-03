-- Migration: ef_user_roles_admin_roles_fk
-- Created: 2026-06-01T12:48:23.393Z


-- ============================================================
-- UP
-- ============================================================

DROP PROCEDURE IF EXISTS migrate_ef_user_roles_up;

CREATE PROCEDURE migrate_ef_user_roles_up()
BEGIN
  -- Add column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ef_user_roles'
      AND COLUMN_NAME  = 'admin_role_id'
  ) THEN
    ALTER TABLE ef_user_roles
      ADD COLUMN admin_role_id INT NULL;
  END IF;

  -- Add FK constraint
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA    = DATABASE()
      AND TABLE_NAME      = 'ef_user_roles'
      AND CONSTRAINT_NAME = 'fk_ef_user_roles_admin_roles'
      AND CONSTRAINT_TYPE = 'FOREIGN KEY'
  ) THEN
    ALTER TABLE ef_user_roles
      ADD CONSTRAINT fk_ef_user_roles_admin_roles
      FOREIGN KEY (admin_role_id)
      REFERENCES ef_admin_roles(id)
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END;

CALL migrate_ef_user_roles_up();

DROP PROCEDURE IF EXISTS migrate_ef_user_roles_up;

-- ============================================================
-- DOWN
-- ============================================================

DROP PROCEDURE IF EXISTS migrate_ef_user_roles_down;

CREATE PROCEDURE migrate_ef_user_roles_down()
BEGIN
  -- Drop FK constraint first (must drop before dropping column)
  IF EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA    = DATABASE()
      AND TABLE_NAME      = 'ef_user_roles'
      AND CONSTRAINT_NAME = 'fk_ef_user_roles_admin_roles'
      AND CONSTRAINT_TYPE = 'FOREIGN KEY'
  ) THEN
    ALTER TABLE ef_user_roles
      DROP FOREIGN KEY fk_ef_user_roles_admin_roles;
  END IF;

  -- Drop column
  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ef_user_roles'
      AND COLUMN_NAME  = 'admin_role_id'
  ) THEN
    ALTER TABLE ef_user_roles
      DROP COLUMN admin_role_id;
  END IF;
END;

CALL migrate_ef_user_roles_down();

DROP PROCEDURE IF EXISTS migrate_ef_user_roles_down;