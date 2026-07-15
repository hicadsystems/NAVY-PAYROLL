-- Migration: ef_form_rejection_init
-- Created: 2026-07-15T09:42:41.754Z

-- UP
CREATE TABLE IF NOT EXISTS ef_form_rejections (
  id                INT NOT NULL AUTO_INCREMENT,
  form_id           INT NOT NULL,                 
  service_number    VARCHAR(20)  NOT NULL,
  rejected_by    VARCHAR(20)  NOT NULL,
  remarks           TEXT       ,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_form_id (form_id),
  KEY idx_service_number (service_number),
  KEY idx_rejected_by (rejected_by)
);

-- DOWN
DROP TABLE IF EXISTS ef_form_rejections;