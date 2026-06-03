-- Migration: ef_tickets_create
-- Created: 2026-06-01T10:39:31.085Z

-- ============================================================
-- UP
-- ============================================================

CREATE TABLE IF NOT EXISTS ef_tickets (
  id           INT           PRIMARY KEY AUTO_INCREMENT,
  user_id      VARCHAR(255)  NOT NULL,
  full_name    VARCHAR(255)  NOT NULL,
  ship         VARCHAR(255)  NOT NULL,
  email        VARCHAR(50)   NOT NULL,
  phone        VARCHAR(255)  NOT NULL,
  subject      TEXT          NOT NULL,
  body         TEXT,
  status       ENUM('OPEN', 'RESPONDED', 'CLOSED') NOT NULL DEFAULT 'OPEN',
  response     TEXT,
  responded_by VARCHAR(255),
  responded_at TIMESTAMP     NULL,
  created_at   TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_user_id (user_id),
  INDEX idx_status  (status)
) DEFAULT CHARSET=utf8mb4;
DROP PROCEDURE IF EXISTS migrate_ef_tickets_create_up;

CREATE PROCEDURE migrate_ef_tickets_create_up()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ef_tickets'
      AND INDEX_NAME   = 'idx_created'
  ) THEN
    ALTER TABLE ef_tickets ADD INDEX idx_created (created_at DESC);
  END IF;
END;

CALL migrate_ef_tickets_create_up();

DROP PROCEDURE IF EXISTS migrate_ef_tickets_create_up;


-- ============================================================
-- DOWN
-- ============================================================

DROP TABLE IF EXISTS ef_tickets;