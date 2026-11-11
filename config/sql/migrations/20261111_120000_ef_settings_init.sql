-- @scope: master   (hicaddata (officers) only)
-- Migration: ef_settings_init
-- Created: 2026-11-11T12:00:00.000Z
--
-- Key/value switches for the emolument module, toggled from the admin UI.
-- First key: 'admin_can_edit_forms' ('1' / '0') — lets EMOL_ADMIN edit any
-- field of any personnel's form from the Review & Approve section.

-- UP
CREATE TABLE IF NOT EXISTS ef_settings (
  setting_key    VARCHAR(64)  NOT NULL,
  setting_value  VARCHAR(255) NULL,
  updated_by     VARCHAR(50)  NULL,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                              ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (setting_key)
);

INSERT IGNORE INTO ef_settings (setting_key, setting_value)
VALUES ('admin_can_edit_forms', '0');

-- DOWN
DROP TABLE IF EXISTS ef_settings;
