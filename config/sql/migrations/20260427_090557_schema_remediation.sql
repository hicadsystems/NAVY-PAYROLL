-- Migration: schema_remediation
-- Created: 2026-04-27T09:05:57.758Z

-- UP
-- Add your schema changes here
-- =============================================================
-- EMOLUMENT SYSTEM — PHASE 1
-- FILE: 01_schema_remediation.sql
-- DESC: Fix migrated tables — add PKs, constraints, drop junk
-- RUN:  Once against hicaddata (the emolument MySQL database)
-- =============================================================

USE hicaddata;

-- -------------------------------------------------------------
-- SECTION A: DROP JUNK / STAGING TABLES
-- These were migration artifacts or one-time staging tables
-- and should not be part of the new system
-- -------------------------------------------------------------

DROP TABLE IF EXISTS ef_sheet1;
DROP TABLE IF EXISTS ef_checkship;
DROP TABLE IF EXISTS ef_migrationshistory;
DROP TABLE IF EXISTS ef_hr_empl;
DROP TABLE IF EXISTS ef_ships2;           -- duplicate of ef_ships
DROP TABLE IF EXISTS ef_personnellogins;  -- replaced by payroll users table + ef_user_roles
DROP TABLE IF EXISTS ef_nodeusers;        -- replaced by payroll users table + ef_user_roles
-- NOTE: ef_hr_employees kept as READ-ONLY payroll reference
-- NOTE: ef_shiplogins kept temporarily — data will be migrated to ef_user_roles


-- -------------------------------------------------------------
-- SECTION B: FIX LOOKUP / REFERENCE TABLES
-- Add proper PKs, AUTO_INCREMENT, and foreign keys
-- -------------------------------------------------------------

-- ef_states
-- Check if table exists and has proper primary key
SET @table_exists = (
  SELECT COUNT(*) FROM information_schema.tables 
  WHERE table_schema = DATABASE() AND table_name = 'ef_states'
);

SET @has_pk = (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'ef_states'
  AND index_name = 'PRIMARY'
);

SET @sql = IF(
  @table_exists > 0 AND @has_pk = 0,
  'ALTER TABLE ef_states MODIFY COLUMN StateId INT NOT NULL AUTO_INCREMENT, ADD PRIMARY KEY (StateId), MODIFY COLUMN Name VARCHAR(100) NOT NULL, MODIFY COLUMN Code VARCHAR(10) DEFAULT NULL',
  IF(@table_exists > 0, 'SELECT "ef_states: PK already exists, skipping"', 'SELECT "ef_states: Table does not exist"')
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ef_localgovts
ALTER TABLE ef_localgovts
  MODIFY COLUMN Id INT NOT NULL AUTO_INCREMENT,
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (Id),
  MODIFY COLUMN lgaName VARCHAR(150) NOT NULL,
  MODIFY COLUMN code VARCHAR(20) DEFAULT NULL,
  ADD CONSTRAINT fk_lga_state
    FOREIGN KEY (StateId) REFERENCES ef_states(StateId) ON UPDATE CASCADE;

-- ef_banks
ALTER TABLE ef_banks
  MODIFY COLUMN bankcode VARCHAR(50) NOT NULL,
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (bankcode),
  MODIFY COLUMN bankname VARCHAR(150) DEFAULT NULL;

-- ef_branches (Navy branches e.g. Engineering, Supply, Medical)
ALTER TABLE ef_branches
  MODIFY COLUMN Id INT NOT NULL AUTO_INCREMENT,
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (Id),
  MODIFY COLUMN code VARCHAR(20) DEFAULT NULL,
  MODIFY COLUMN branchName VARCHAR(100) DEFAULT NULL;

-- ef_commands
ALTER TABLE ef_commands
  MODIFY COLUMN Id INT NOT NULL AUTO_INCREMENT,
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (Id),
  MODIFY COLUMN code VARCHAR(20) DEFAULT NULL,
  MODIFY COLUMN commandName VARCHAR(150) DEFAULT NULL;

-- ef_ships
SET FOREIGN_KEY_CHECKS = 0;
ALTER TABLE ef_ships
  MODIFY COLUMN Id INT NOT NULL AUTO_INCREMENT,
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (Id),
  MODIFY COLUMN code VARCHAR(20) DEFAULT NULL,
  MODIFY COLUMN shipName VARCHAR(150) DEFAULT NULL,
  MODIFY COLUMN LandSea VARCHAR(20) DEFAULT NULL,
  ADD CONSTRAINT fk_ship_command
    FOREIGN KEY (commandid) REFERENCES ef_commands(Id) ON UPDATE CASCADE;
SET FOREIGN_KEY_CHECKS = 1;

-- ef_relationships (NOK relationship types)
ALTER TABLE ef_relationships
  MODIFY COLUMN Id INT NOT NULL AUTO_INCREMENT,
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (Id),
  MODIFY COLUMN description VARCHAR(100) DEFAULT NULL;

-- ef_specialisationareas
ALTER TABLE ef_specialisationareas
  MODIFY COLUMN Id INT NOT NULL AUTO_INCREMENT,
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (Id),
  MODIFY COLUMN specName VARCHAR(150) DEFAULT NULL;

-- ef_entrymodes
ALTER TABLE ef_entrymodes
  MODIFY COLUMN Id INT NOT NULL AUTO_INCREMENT,
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (Id),
  MODIFY COLUMN Name VARCHAR(100) DEFAULT NULL;


-- -------------------------------------------------------------
-- SECTION C: FIX OPERATIONAL TABLES
-- -------------------------------------------------------------

-- ef_personalinfos — add PK and unique constraint on serviceNumber
-- NOTE: Id was bigint NOT NULL but had no PK defined after migration
ALTER TABLE ef_personalinfos
  MODIFY COLUMN Id BIGINT NOT NULL AUTO_INCREMENT,
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (Id),
  ADD UNIQUE KEY uq_personalinfos_svcno (serviceNumber);
  -- Remove legacy blob passport columns (photos now in ef_documents)
  -- DROP COLUMN Passport,
  -- DROP COLUMN NokPassport,
  -- DROP COLUMN AltNokPassport;

-- ef_personalinfoshist — history/snapshot table
ALTER TABLE ef_personalinfoshist
  MODIFY COLUMN Id INT NOT NULL AUTO_INCREMENT,
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (Id),
  ADD INDEX idx_hist_svcno (serviceNumber),
  ADD INDEX idx_hist_year (FormYear);

-- ef_control — form cycle management
ALTER TABLE ef_control
  MODIFY COLUMN Id INT NOT NULL AUTO_INCREMENT,
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (Id),
  ADD INDEX idx_control_status (status);

-- ef_systeminfos — global system config
ALTER TABLE ef_systeminfos
  MODIFY COLUMN Id INT NOT NULL AUTO_INCREMENT,
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (Id);

-- ef_auditlogs — fix the broken audit table
ALTER TABLE ef_auditlogs
  MODIFY COLUMN Id INT NOT NULL AUTO_INCREMENT,
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (Id),
  ADD INDEX idx_audit_table (TableName(100)),
  ADD INDEX idx_audit_performed_at (PerformedAt),
  ADD INDEX idx_audit_performed_by (PerformedBy(50));

-- ef_contactus
ALTER TABLE ef_contactus
  MODIFY COLUMN Id INT NOT NULL AUTO_INCREMENT,
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (Id);

-- ef_menugroups
ALTER TABLE ef_menugroups
  MODIFY COLUMN Id INT NOT NULL AUTO_INCREMENT,
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (Id);

-- ef_menus
ALTER TABLE ef_menus
  MODIFY COLUMN Id INT NOT NULL AUTO_INCREMENT,
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (Id),
  ADD INDEX idx_menus_group (MenuGroupId);

-- ef_rolemenus
ALTER TABLE ef_rolemenus
  MODIFY COLUMN Id INT NOT NULL AUTO_INCREMENT,
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (Id);

-- DOWN
-- Add rollback logic here (reverse of UP)

-- =============================================================
-- EMOLUMENT SYSTEM — PHASE 1
-- FILE: 01_schema_remediation_down.sql
-- DESC: Rollback schema remediation changes
-- WARNING: This will restore the previous messy state. Run only
--          if you need to completely reverse the migration.
-- =============================================================

USE hicaddata;

-- -------------------------------------------------------------
-- REVERSE SECTION C: OPERATIONAL TABLES
-- -------------------------------------------------------------

-- ef_rolemenus
ALTER TABLE ef_rolemenus
  DROP PRIMARY KEY,
  MODIFY COLUMN Id INT NOT NULL;

-- ef_menus
ALTER TABLE ef_menus
  DROP INDEX idx_menus_group,
  DROP PRIMARY KEY,
  MODIFY COLUMN Id INT NOT NULL;

-- ef_menugroups
ALTER TABLE ef_menugroups
  DROP PRIMARY KEY,
  MODIFY COLUMN Id INT NOT NULL;

-- ef_contactus
ALTER TABLE ef_contactus
  DROP PRIMARY KEY,
  MODIFY COLUMN Id INT NOT NULL;

-- ef_auditlogs
ALTER TABLE ef_auditlogs
  DROP INDEX idx_audit_performed_by,
  DROP INDEX idx_audit_performed_at,
  DROP INDEX idx_audit_table,
  DROP PRIMARY KEY,
  MODIFY COLUMN Id INT NOT NULL;

-- ef_systeminfos
ALTER TABLE ef_systeminfos
  DROP PRIMARY KEY,
  MODIFY COLUMN Id INT NOT NULL;

-- ef_control
ALTER TABLE ef_control
  DROP INDEX idx_control_status,
  DROP PRIMARY KEY,
  MODIFY COLUMN Id INT NOT NULL;

-- ef_personalinfoshist
ALTER TABLE ef_personalinfoshist
  DROP INDEX idx_hist_year,
  DROP INDEX idx_hist_svcno,
  DROP PRIMARY KEY,
  MODIFY COLUMN Id INT NOT NULL;

-- ef_personalinfos
ALTER TABLE ef_personalinfos
  DROP INDEX uq_personalinfos_svcno,
  DROP PRIMARY KEY,
  MODIFY COLUMN Id BIGINT NOT NULL,
  ADD COLUMN Passport BLOB DEFAULT NULL,
  ADD COLUMN NokPassport BLOB DEFAULT NULL,
  ADD COLUMN AltNokPassport BLOB DEFAULT NULL;


-- -------------------------------------------------------------
-- REVERSE SECTION B: LOOKUP / REFERENCE TABLES
-- -------------------------------------------------------------

-- ef_entrymodes
ALTER TABLE ef_entrymodes
  DROP PRIMARY KEY,
  MODIFY COLUMN Id INT NOT NULL;

-- ef_specialisationareas
ALTER TABLE ef_specialisationareas
  DROP PRIMARY KEY,
  MODIFY COLUMN Id INT NOT NULL;

-- ef_relationships
ALTER TABLE ef_relationships
  DROP PRIMARY KEY,
  MODIFY COLUMN Id INT NOT NULL;

-- ef_ships
SET FOREIGN_KEY_CHECKS = 0;
ALTER TABLE ef_ships
  DROP FOREIGN KEY fk_ship_command,
  DROP PRIMARY KEY,
  MODIFY COLUMN Id INT NOT NULL;
SET FOREIGN_KEY_CHECKS = 1;

-- ef_commands
ALTER TABLE ef_commands
  DROP PRIMARY KEY,
  MODIFY COLUMN Id INT NOT NULL;

-- ef_branches
ALTER TABLE ef_branches
  DROP PRIMARY KEY,
  MODIFY COLUMN Id INT NOT NULL;

-- ef_banks
ALTER TABLE ef_banks
  DROP PRIMARY KEY,
  MODIFY COLUMN bankcode VARCHAR(50) DEFAULT NULL;

-- ef_localgovts
ALTER TABLE ef_localgovts
  DROP FOREIGN KEY fk_lga_state,
  DROP PRIMARY KEY,
  MODIFY COLUMN Id INT NOT NULL;

-- ef_states
ALTER TABLE ef_states
  DROP PRIMARY KEY,
  MODIFY COLUMN StateId INT NOT NULL;


-- -------------------------------------------------------------
-- REVERSE SECTION A: NOTE ABOUT DROPPED TABLES
-- -------------------------------------------------------------
-- The following tables were dropped in the UP migration.
-- They CANNOT be automatically restored by this down migration.
-- If you need them back, restore from database backup:
--   - ef_sheet1
--   - ef_checkship
--   - ef_migrationshistory
--   - ef_hr_empl
--   - ef_ships2
--   - ef_personnellogins
--   - ef_nodeusers
-- -------------------------------------------------------------

SELECT 
  'WARNING: Dropped tables cannot be automatically restored.' AS notice,
  'Restore from backup if needed: ef_sheet1, ef_checkship, ef_migrationshistory, ef_hr_empl, ef_ships2, ef_personnellogins, ef_nodeusers' AS tables;