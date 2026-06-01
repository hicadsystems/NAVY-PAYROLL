-- Migration: ef_admin_role_create
-- Created: 2026-06-01T10:36:22.378Z

-- ============================================================
-- UP
-- ============================================================

CREATE TABLE IF NOT EXISTS ef_admin_roles (
  id          INT            PRIMARY KEY AUTO_INCREMENT,
  name        VARCHAR(255)   NOT NULL,
  description TEXT,
  created_at  TIMESTAMP      DEFAULT CURRENT_TIMESTAMP,
  created_by  VARCHAR(255),
  updated_at  TIMESTAMP      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by  VARCHAR(255),
  is_active   BOOLEAN        DEFAULT TRUE
) DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- DOWN
-- ============================================================

DROP TABLE IF EXISTS ef_admin_roles;