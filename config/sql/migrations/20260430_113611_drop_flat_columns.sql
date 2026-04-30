-- =============================================================================
-- Migration: drop_flat_columns
-- Created: 2026-04-30T11:36:11.507Z
-- PURPOSE:
--   Drop flat NOK/spouse/children/loan/allowance/blob columns from
--   ef_personalinfos and slim down ef_personalinfoshist to a lightweight
--   index/archive table. Full form data lives in ef_emolument_forms.snapshot.
--
-- RUN ORDER:
--   1. Run 20240601_001_backfill_history_snapshots.sql first
--   2. Run 20240602_001_performance_indexes.sql second
--   3. Run this script last
--
-- Safe to re-run: every DROP COLUMN is wrapped in a column-existence check.
--                 Running twice is a no-op — no errors.
--
-- IMPORTANT: Take a full database backup before running UP.
--            DOWN restores the columns as NULLable — data is NOT restored.
-- ============================================================================




-- =============================================================================
-- UP
-- =============================================================================
-- Add your schema changes here

-- -----------------------------------------------------------------------------
-- GATE: abort if snapshots are missing or child tables are empty.
-- Dropping columns on a DB where snapshots haven't been backfilled yet
-- would cause permanent data loss. This check runs inside UP so it fires
-- automatically on every run — no manual pre-flight step needed.
--
-- What is checked:
--   1. ef_emolument_forms must have at least one snapshot
--   2. Zero history rows may be missing a snapshot (backfill must be complete)
--   3. Child tables (ef_nok, ef_spouse, ef_children, ef_loans, ef_allowances,
--      ef_documents) must all have at least one row
--
-- If any check fails the procedure signals an error and the whole script
-- stops. Fix the problem (run the backfill migration first) then re-run.
-- -----------------------------------------------------------------------------

DROP PROCEDURE IF EXISTS preflight_gate;
DELIMITER $$
CREATE PROCEDURE preflight_gate()
BEGIN
    DECLARE v_snapshots       INT DEFAULT 0;
    DECLARE v_missing         INT DEFAULT 0;
    DECLARE v_nok             INT DEFAULT 0;
    DECLARE v_spouse          INT DEFAULT 0;
    DECLARE v_children        INT DEFAULT 0;
    DECLARE v_loans           INT DEFAULT 0;
    DECLARE v_allowances      INT DEFAULT 0;
    DECLARE v_documents       INT DEFAULT 0;

    SELECT COUNT(*)              INTO v_snapshots   FROM ef_emolument_forms WHERE snapshot IS NOT NULL;
    SELECT COUNT(*)              INTO v_nok         FROM ef_nok;
    SELECT COUNT(*)              INTO v_spouse      FROM ef_spouse;
    SELECT COUNT(*)              INTO v_children    FROM ef_children;
    SELECT COUNT(*)              INTO v_loans       FROM ef_loans;
    SELECT COUNT(*)              INTO v_allowances  FROM ef_allowances;
    SELECT COUNT(*)              INTO v_documents   FROM ef_documents;

    SELECT COUNT(*) INTO v_missing
    FROM ef_personalinfoshist h
    LEFT JOIN ef_emolument_forms ef
      ON ef.service_no = h.serviceNumber
     AND ef.form_year  = CAST(h.FormYear AS CHAR)
    WHERE ef.snapshot IS NULL;

    IF v_snapshots = 0 THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'GATE FAILED: ef_emolument_forms has no snapshots. Run 20240601_001_backfill_history_snapshots.sql first.';
    END IF;

    IF v_missing > 0 THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'GATE FAILED: Some history rows have no snapshot yet. Re-run the backfill migration and verify before dropping columns.';
    END IF;

    IF v_nok = 0 THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'GATE FAILED: ef_nok is empty. NOK data has not been migrated to the child table.';
    END IF;

    IF v_spouse = 0 THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'GATE FAILED: ef_spouse is empty. Spouse data has not been migrated to the child table.';
    END IF;

    IF v_children = 0 THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'GATE FAILED: ef_children is empty. Children data has not been migrated to the child table.';
    END IF;

    IF v_loans = 0 THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'GATE FAILED: ef_loans is empty. Loan data has not been migrated to the child table.';
    END IF;

    IF v_allowances = 0 THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'GATE FAILED: ef_allowances is empty. Allowance data has not been migrated to the child table.';
    END IF;

    IF v_documents = 0 THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'GATE FAILED: ef_documents is empty. Document URLs have not been migrated to the child table.';
    END IF;

END$$
DELIMITER ;

CALL preflight_gate();
DROP PROCEDURE IF EXISTS preflight_gate;


-- Helper procedure so we can conditionally drop columns without
-- repeating the information_schema check for every single column.
-- Dropped at the end of the UP block.
DROP PROCEDURE IF EXISTS drop_col_if_exists;
DELIMITER $$
CREATE PROCEDURE drop_col_if_exists(
    IN p_table  VARCHAR(64),
    IN p_column VARCHAR(64)
)
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = p_table
          AND COLUMN_NAME  = p_column
    ) THEN
        SET @_sql = CONCAT('ALTER TABLE `', p_table, '` DROP COLUMN `', p_column, '`');
        PREPARE _stmt FROM @_sql;
        EXECUTE _stmt;
        DEALLOCATE PREPARE _stmt;
    END IF;
END$$
DELIMITER ;


-- -----------------------------------------------------------------------------
-- SECTION 1 — DROP FLAT COLUMNS FROM ef_personalinfos
-- -----------------------------------------------------------------------------

-- NOK primary
CALL drop_col_if_exists('ef_personalinfos', 'nok_name');
CALL drop_col_if_exists('ef_personalinfos', 'nok_relation');
CALL drop_col_if_exists('ef_personalinfos', 'nok_phone');
CALL drop_col_if_exists('ef_personalinfos', 'nok_phone12');
CALL drop_col_if_exists('ef_personalinfos', 'nok_email');
CALL drop_col_if_exists('ef_personalinfos', 'nok_address');
CALL drop_col_if_exists('ef_personalinfos', 'nok_nationalId');

-- NOK alternate
CALL drop_col_if_exists('ef_personalinfos', 'nok_name2');
CALL drop_col_if_exists('ef_personalinfos', 'nok_relation2');
CALL drop_col_if_exists('ef_personalinfos', 'nok_phone2');
CALL drop_col_if_exists('ef_personalinfos', 'nok_phone22');
CALL drop_col_if_exists('ef_personalinfos', 'nok_email2');
CALL drop_col_if_exists('ef_personalinfos', 'nok_address2');
CALL drop_col_if_exists('ef_personalinfos', 'nok_nationalId2');

-- Spouse
CALL drop_col_if_exists('ef_personalinfos', 'sp_name');
CALL drop_col_if_exists('ef_personalinfos', 'sp_phone');
CALL drop_col_if_exists('ef_personalinfos', 'sp_phone2');
CALL drop_col_if_exists('ef_personalinfos', 'sp_email');

-- Children
CALL drop_col_if_exists('ef_personalinfos', 'chid_name');
CALL drop_col_if_exists('ef_personalinfos', 'chid_name2');
CALL drop_col_if_exists('ef_personalinfos', 'chid_name3');
CALL drop_col_if_exists('ef_personalinfos', 'chid_name4');

-- Loans
CALL drop_col_if_exists('ef_personalinfos', 'FGSHLS_loan');
CALL drop_col_if_exists('ef_personalinfos', 'FGSHLS_loanYear');
CALL drop_col_if_exists('ef_personalinfos', 'car_loan');
CALL drop_col_if_exists('ef_personalinfos', 'car_loanYear');
CALL drop_col_if_exists('ef_personalinfos', 'welfare_loan');
CALL drop_col_if_exists('ef_personalinfos', 'welfare_loanYear');
CALL drop_col_if_exists('ef_personalinfos', 'NNNCS_loan');
CALL drop_col_if_exists('ef_personalinfos', 'NNNCS_loanYear');
CALL drop_col_if_exists('ef_personalinfos', 'NNMFBL_loan');
CALL drop_col_if_exists('ef_personalinfos', 'NNMFBL_loanYear');
CALL drop_col_if_exists('ef_personalinfos', 'PPCFS_loan');
CALL drop_col_if_exists('ef_personalinfos', 'PPCFS_loanYear');
CALL drop_col_if_exists('ef_personalinfos', 'Anyother_Loan');
CALL drop_col_if_exists('ef_personalinfos', 'Anyother_LoanYear');
CALL drop_col_if_exists('ef_personalinfos', 'NHFcode');
CALL drop_col_if_exists('ef_personalinfos', 'NHFcodeYear');
CALL drop_col_if_exists('ef_personalinfos', 'NSITFcode');
CALL drop_col_if_exists('ef_personalinfos', 'NSITFcodeYear');

-- Allowances
CALL drop_col_if_exists('ef_personalinfos', 'aircrew_allow');
CALL drop_col_if_exists('ef_personalinfos', 'pilot_allow');
CALL drop_col_if_exists('ef_personalinfos', 'shift_duty_allow');
CALL drop_col_if_exists('ef_personalinfos', 'hazard_allow');
CALL drop_col_if_exists('ef_personalinfos', 'rent_subsidy');
CALL drop_col_if_exists('ef_personalinfos', 'SBC_allow');
CALL drop_col_if_exists('ef_personalinfos', 'special_forces_allow');
CALL drop_col_if_exists('ef_personalinfos', 'call_duty_allow');
CALL drop_col_if_exists('ef_personalinfos', 'other_allow');
CALL drop_col_if_exists('ef_personalinfos', 'other_allowspecify');

-- Photo blobs + old Cloudinary URL flat cols
CALL drop_col_if_exists('ef_personalinfos', 'Passport');
CALL drop_col_if_exists('ef_personalinfos', 'NokPassport');
CALL drop_col_if_exists('ef_personalinfos', 'AltNokPassport');
CALL drop_col_if_exists('ef_personalinfos', 'mypassporturl');
CALL drop_col_if_exists('ef_personalinfos', 'mynokpassporturl');
CALL drop_col_if_exists('ef_personalinfos', 'myalternatenokpassporturl');


-- -----------------------------------------------------------------------------
-- SECTION 2 — SLIM DOWN ef_personalinfoshist
-- Drops all heavy/personal columns. Keeps only listing/filtering columns.
-- Full form data is in ef_emolument_forms.snapshot.
-- -----------------------------------------------------------------------------

-- Personal / bank details
CALL drop_col_if_exists('ef_personalinfoshist', 'Sex');
CALL drop_col_if_exists('ef_personalinfoshist', 'MaritalStatus');
CALL drop_col_if_exists('ef_personalinfoshist', 'Birthdate');
CALL drop_col_if_exists('ef_personalinfoshist', 'religion');
CALL drop_col_if_exists('ef_personalinfoshist', 'gsm_number');
CALL drop_col_if_exists('ef_personalinfoshist', 'gsm_number2');
CALL drop_col_if_exists('ef_personalinfoshist', 'email');
CALL drop_col_if_exists('ef_personalinfoshist', 'home_address');
CALL drop_col_if_exists('ef_personalinfoshist', 'Bankcode');
CALL drop_col_if_exists('ef_personalinfoshist', 'bankbranch');
CALL drop_col_if_exists('ef_personalinfoshist', 'BankACNumber');
CALL drop_col_if_exists('ef_personalinfoshist', 'AccountName');
CALL drop_col_if_exists('ef_personalinfoshist', 'pfacode');
CALL drop_col_if_exists('ef_personalinfoshist', 'specialisation');
CALL drop_col_if_exists('ef_personalinfoshist', 'DateEmpl');
CALL drop_col_if_exists('ef_personalinfoshist', 'DateLeft');
CALL drop_col_if_exists('ef_personalinfoshist', 'seniorityDate');
CALL drop_col_if_exists('ef_personalinfoshist', 'yearOfPromotion');
CALL drop_col_if_exists('ef_personalinfoshist', 'expirationOfEngagementDate');
CALL drop_col_if_exists('ef_personalinfoshist', 'StateofOrigin');
CALL drop_col_if_exists('ef_personalinfoshist', 'LocalGovt');
CALL drop_col_if_exists('ef_personalinfoshist', 'TaxCode');
CALL drop_col_if_exists('ef_personalinfoshist', 'exittype');
CALL drop_col_if_exists('ef_personalinfoshist', 'entry_mode');
CALL drop_col_if_exists('ef_personalinfoshist', 'gradelevel');
CALL drop_col_if_exists('ef_personalinfoshist', 'gradetype');
CALL drop_col_if_exists('ef_personalinfoshist', 'taxed');
CALL drop_col_if_exists('ef_personalinfoshist', 'entitlement');
CALL drop_col_if_exists('ef_personalinfoshist', 'town');
CALL drop_col_if_exists('ef_personalinfoshist', 'accomm_type');
CALL drop_col_if_exists('ef_personalinfoshist', 'AcommodationStatus');
CALL drop_col_if_exists('ef_personalinfoshist', 'AddressofAcommodation');
CALL drop_col_if_exists('ef_personalinfoshist', 'GBC');
CALL drop_col_if_exists('ef_personalinfoshist', 'GBC_Number');
CALL drop_col_if_exists('ef_personalinfoshist', 'qualification');
CALL drop_col_if_exists('ef_personalinfoshist', 'division');
CALL drop_col_if_exists('ef_personalinfoshist', 'appointment');
CALL drop_col_if_exists('ef_personalinfoshist', 'advanceDate');
CALL drop_col_if_exists('ef_personalinfoshist', 'runoutDate');
CALL drop_col_if_exists('ef_personalinfoshist', 'rankId');
CALL drop_col_if_exists('ef_personalinfoshist', 'createdby');
CALL drop_col_if_exists('ef_personalinfoshist', 'datecreated');
CALL drop_col_if_exists('ef_personalinfoshist', 'dateModify');
CALL drop_col_if_exists('ef_personalinfoshist', 'dateVerify');
CALL drop_col_if_exists('ef_personalinfoshist', 'verifyBy');

-- NOK flat cols
CALL drop_col_if_exists('ef_personalinfoshist', 'nok_name');
CALL drop_col_if_exists('ef_personalinfoshist', 'nok_relation');
CALL drop_col_if_exists('ef_personalinfoshist', 'nok_phone');
CALL drop_col_if_exists('ef_personalinfoshist', 'nok_phone12');
CALL drop_col_if_exists('ef_personalinfoshist', 'nok_email');
CALL drop_col_if_exists('ef_personalinfoshist', 'nok_address');
CALL drop_col_if_exists('ef_personalinfoshist', 'nok_nationalId');
CALL drop_col_if_exists('ef_personalinfoshist', 'nok_name2');
CALL drop_col_if_exists('ef_personalinfoshist', 'nok_relation2');
CALL drop_col_if_exists('ef_personalinfoshist', 'nok_phone2');
CALL drop_col_if_exists('ef_personalinfoshist', 'nok_phone22');
CALL drop_col_if_exists('ef_personalinfoshist', 'nok_email2');
CALL drop_col_if_exists('ef_personalinfoshist', 'nok_address2');
CALL drop_col_if_exists('ef_personalinfoshist', 'nok_nationalId2');

-- Spouse flat cols
CALL drop_col_if_exists('ef_personalinfoshist', 'sp_name');
CALL drop_col_if_exists('ef_personalinfoshist', 'sp_phone');
CALL drop_col_if_exists('ef_personalinfoshist', 'sp_phone2');
CALL drop_col_if_exists('ef_personalinfoshist', 'sp_email');

-- Children flat cols
CALL drop_col_if_exists('ef_personalinfoshist', 'chid_name');
CALL drop_col_if_exists('ef_personalinfoshist', 'chid_name2');
CALL drop_col_if_exists('ef_personalinfoshist', 'chid_name3');
CALL drop_col_if_exists('ef_personalinfoshist', 'chid_name4');

-- Loan flat cols
CALL drop_col_if_exists('ef_personalinfoshist', 'FGSHLS_loan');
CALL drop_col_if_exists('ef_personalinfoshist', 'FGSHLS_loanYear');
CALL drop_col_if_exists('ef_personalinfoshist', 'car_loan');
CALL drop_col_if_exists('ef_personalinfoshist', 'car_loanYear');
CALL drop_col_if_exists('ef_personalinfoshist', 'welfare_loan');
CALL drop_col_if_exists('ef_personalinfoshist', 'welfare_loanYear');
CALL drop_col_if_exists('ef_personalinfoshist', 'NNNCS_loan');
CALL drop_col_if_exists('ef_personalinfoshist', 'NNNCS_loanYear');
CALL drop_col_if_exists('ef_personalinfoshist', 'NNMFBL_loan');
CALL drop_col_if_exists('ef_personalinfoshist', 'NNMFBL_loanYear');
CALL drop_col_if_exists('ef_personalinfoshist', 'PPCFS_loan');
CALL drop_col_if_exists('ef_personalinfoshist', 'PPCFS_loanYear');
CALL drop_col_if_exists('ef_personalinfoshist', 'Anyother_Loan');
CALL drop_col_if_exists('ef_personalinfoshist', 'Anyother_LoanYear');
CALL drop_col_if_exists('ef_personalinfoshist', 'NHFcode');
CALL drop_col_if_exists('ef_personalinfoshist', 'NHFcodeYear');
CALL drop_col_if_exists('ef_personalinfoshist', 'NSITFcode');
CALL drop_col_if_exists('ef_personalinfoshist', 'NSITFcodeYear');

-- Allowance flat cols
CALL drop_col_if_exists('ef_personalinfoshist', 'aircrew_allow');
CALL drop_col_if_exists('ef_personalinfoshist', 'pilot_allow');
CALL drop_col_if_exists('ef_personalinfoshist', 'shift_duty_allow');
CALL drop_col_if_exists('ef_personalinfoshist', 'hazard_allow');
CALL drop_col_if_exists('ef_personalinfoshist', 'rent_subsidy');
CALL drop_col_if_exists('ef_personalinfoshist', 'SBC_allow');
CALL drop_col_if_exists('ef_personalinfoshist', 'special_forces_allow');
CALL drop_col_if_exists('ef_personalinfoshist', 'call_duty_allow');
CALL drop_col_if_exists('ef_personalinfoshist', 'other_allow');
CALL drop_col_if_exists('ef_personalinfoshist', 'other_allowspecify');

-- Photo blobs + old Cloudinary URL flat cols
CALL drop_col_if_exists('ef_personalinfoshist', 'Passport');
CALL drop_col_if_exists('ef_personalinfoshist', 'NokPassport');
CALL drop_col_if_exists('ef_personalinfoshist', 'AltNokPassport');
CALL drop_col_if_exists('ef_personalinfoshist', 'mypassporturl');
CALL drop_col_if_exists('ef_personalinfoshist', 'mynokpassporturl');
CALL drop_col_if_exists('ef_personalinfoshist', 'myalternatenokpassporturl');


-- -----------------------------------------------------------------------------
-- SECTION 3 — ADD INDEXES TO ef_personalinfoshist (now lightweight)
-- -----------------------------------------------------------------------------

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_personalinfoshist' AND INDEX_NAME = 'idx_hist_year');
SET @sql := IF(@idx = 0, 'CREATE INDEX idx_hist_year ON ef_personalinfoshist (FormYear) ALGORITHM=INPLACE LOCK=NONE', 'SELECT ''idx_hist_year already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_personalinfoshist' AND INDEX_NAME = 'idx_hist_svcno_year');
SET @sql := IF(@idx = 0, 'CREATE INDEX idx_hist_svcno_year ON ef_personalinfoshist (serviceNumber, FormYear) ALGORITHM=INPLACE LOCK=NONE', 'SELECT ''idx_hist_svcno_year already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_personalinfoshist' AND INDEX_NAME = 'idx_hist_ship_year');
SET @sql := IF(@idx = 0, 'CREATE INDEX idx_hist_ship_year ON ef_personalinfoshist (ship, FormYear) ALGORITHM=INPLACE LOCK=NONE', 'SELECT ''idx_hist_ship_year already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_personalinfoshist' AND INDEX_NAME = 'idx_hist_command_year');
SET @sql := IF(@idx = 0, 'CREATE INDEX idx_hist_command_year ON ef_personalinfoshist (command, FormYear) ALGORITHM=INPLACE LOCK=NONE', 'SELECT ''idx_hist_command_year already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;


-- Cleanup helper procedure
DROP PROCEDURE IF EXISTS drop_col_if_exists;


-- -----------------------------------------------------------------------------
-- SECTION 4 — POST-MIGRATION VERIFICATION
-- -----------------------------------------------------------------------------

-- Should return 0 — confirms all flat columns are gone from ef_personalinfos
SELECT COUNT(*) AS should_be_zero
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME   = 'ef_personalinfos'
  AND COLUMN_NAME  IN (
    'nok_address','nok_name','sp_name','chid_name',
    'FGSHLS_loan','aircrew_allow','Passport','mypassporturl'
  );

-- Remaining columns in ef_personalinfoshist — should only be index/listing cols
SELECT COLUMN_NAME
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME   = 'ef_personalinfoshist'
ORDER BY ORDINAL_POSITION;

-- Snapshot coverage — missing_snapshot should be 0
SELECT
  COUNT(*)                                                       AS total_confirmed,
  SUM(CASE WHEN snapshot IS NOT NULL THEN 1 ELSE 0 END)         AS has_snapshot,
  SUM(CASE WHEN snapshot IS     NULL THEN 1 ELSE 0 END)         AS missing_snapshot
FROM ef_emolument_forms
WHERE status = 'CPO_CONFIRMED';


-- =============================================================================
-- DOWN
-- Add rollback logic here (reverse of UP)
-- Restores all dropped columns as NULLable VARCHAR/TEXT.
-- DATA IS NOT RESTORED — this only brings back the column structure.
-- Use your database backup to restore actual data if needed.
-- =============================================================================

DROP PROCEDURE IF EXISTS add_col_if_missing;
DELIMITER $$
CREATE PROCEDURE add_col_if_missing(
    IN p_table      VARCHAR(64),
    IN p_column     VARCHAR(64),
    IN p_definition VARCHAR(255)
)
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = p_table
          AND COLUMN_NAME  = p_column
    ) THEN
        SET @_sql = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN `', p_column, '` ', p_definition);
        PREPARE _stmt FROM @_sql;
        EXECUTE _stmt;
        DEALLOCATE PREPARE _stmt;
    END IF;
END$$
DELIMITER ;

-- ef_personalinfos — NOK primary
CALL add_col_if_missing('ef_personalinfos', 'nok_name',       'VARCHAR(255) NULL');
CALL add_col_if_missing('ef_personalinfos', 'nok_relation',   'VARCHAR(100) NULL');
CALL add_col_if_missing('ef_personalinfos', 'nok_phone',      'VARCHAR(20)  NULL');
CALL add_col_if_missing('ef_personalinfos', 'nok_phone12',    'VARCHAR(20)  NULL');
CALL add_col_if_missing('ef_personalinfos', 'nok_email',      'VARCHAR(255) NULL');
CALL add_col_if_missing('ef_personalinfos', 'nok_address',    'TEXT         NULL');
CALL add_col_if_missing('ef_personalinfos', 'nok_nationalId', 'VARCHAR(50)  NULL');

-- ef_personalinfos — NOK alternate
CALL add_col_if_missing('ef_personalinfos', 'nok_name2',       'VARCHAR(255) NULL');
CALL add_col_if_missing('ef_personalinfos', 'nok_relation2',   'VARCHAR(100) NULL');
CALL add_col_if_missing('ef_personalinfos', 'nok_phone2',      'VARCHAR(20)  NULL');
CALL add_col_if_missing('ef_personalinfos', 'nok_phone22',     'VARCHAR(20)  NULL');
CALL add_col_if_missing('ef_personalinfos', 'nok_email2',      'VARCHAR(255) NULL');
CALL add_col_if_missing('ef_personalinfos', 'nok_address2',    'TEXT         NULL');
CALL add_col_if_missing('ef_personalinfos', 'nok_nationalId2', 'VARCHAR(50)  NULL');

-- ef_personalinfos — Spouse
CALL add_col_if_missing('ef_personalinfos', 'sp_name',   'VARCHAR(255) NULL');
CALL add_col_if_missing('ef_personalinfos', 'sp_phone',  'VARCHAR(20)  NULL');
CALL add_col_if_missing('ef_personalinfos', 'sp_phone2', 'VARCHAR(20)  NULL');
CALL add_col_if_missing('ef_personalinfos', 'sp_email',  'VARCHAR(255) NULL');

-- ef_personalinfos — Children
CALL add_col_if_missing('ef_personalinfos', 'chid_name',  'VARCHAR(255) NULL');
CALL add_col_if_missing('ef_personalinfos', 'chid_name2', 'VARCHAR(255) NULL');
CALL add_col_if_missing('ef_personalinfos', 'chid_name3', 'VARCHAR(255) NULL');
CALL add_col_if_missing('ef_personalinfos', 'chid_name4', 'VARCHAR(255) NULL');

-- ef_personalinfos — Loans
CALL add_col_if_missing('ef_personalinfos', 'FGSHLS_loan',       'DECIMAL(15,2) NULL');
CALL add_col_if_missing('ef_personalinfos', 'FGSHLS_loanYear',   'YEAR          NULL');
CALL add_col_if_missing('ef_personalinfos', 'car_loan',          'DECIMAL(15,2) NULL');
CALL add_col_if_missing('ef_personalinfos', 'car_loanYear',      'YEAR          NULL');
CALL add_col_if_missing('ef_personalinfos', 'welfare_loan',      'DECIMAL(15,2) NULL');
CALL add_col_if_missing('ef_personalinfos', 'welfare_loanYear',  'YEAR          NULL');
CALL add_col_if_missing('ef_personalinfos', 'NNNCS_loan',        'DECIMAL(15,2) NULL');
CALL add_col_if_missing('ef_personalinfos', 'NNNCS_loanYear',    'YEAR          NULL');
CALL add_col_if_missing('ef_personalinfos', 'NNMFBL_loan',       'DECIMAL(15,2) NULL');
CALL add_col_if_missing('ef_personalinfos', 'NNMFBL_loanYear',   'YEAR          NULL');
CALL add_col_if_missing('ef_personalinfos', 'PPCFS_loan',        'DECIMAL(15,2) NULL');
CALL add_col_if_missing('ef_personalinfos', 'PPCFS_loanYear',    'YEAR          NULL');
CALL add_col_if_missing('ef_personalinfos', 'Anyother_Loan',     'DECIMAL(15,2) NULL');
CALL add_col_if_missing('ef_personalinfos', 'Anyother_LoanYear', 'YEAR          NULL');
CALL add_col_if_missing('ef_personalinfos', 'NHFcode',           'VARCHAR(50)   NULL');
CALL add_col_if_missing('ef_personalinfos', 'NHFcodeYear',       'YEAR          NULL');
CALL add_col_if_missing('ef_personalinfos', 'NSITFcode',         'VARCHAR(50)   NULL');
CALL add_col_if_missing('ef_personalinfos', 'NSITFcodeYear',     'YEAR          NULL');

-- ef_personalinfos — Allowances
CALL add_col_if_missing('ef_personalinfos', 'aircrew_allow',        'TINYINT(1) NULL');
CALL add_col_if_missing('ef_personalinfos', 'pilot_allow',          'TINYINT(1) NULL');
CALL add_col_if_missing('ef_personalinfos', 'shift_duty_allow',     'TINYINT(1) NULL');
CALL add_col_if_missing('ef_personalinfos', 'hazard_allow',         'TINYINT(1) NULL');
CALL add_col_if_missing('ef_personalinfos', 'rent_subsidy',         'TINYINT(1) NULL');
CALL add_col_if_missing('ef_personalinfos', 'SBC_allow',            'TINYINT(1) NULL');
CALL add_col_if_missing('ef_personalinfos', 'special_forces_allow', 'TINYINT(1) NULL');
CALL add_col_if_missing('ef_personalinfos', 'call_duty_allow',      'TINYINT(1) NULL');
CALL add_col_if_missing('ef_personalinfos', 'other_allow',          'TINYINT(1)   NULL');
CALL add_col_if_missing('ef_personalinfos', 'other_allowspecify',   'VARCHAR(255) NULL');

-- ef_personalinfos — Blobs / URLs
CALL add_col_if_missing('ef_personalinfos', 'Passport',                    'LONGBLOB     NULL');
CALL add_col_if_missing('ef_personalinfos', 'NokPassport',                 'LONGBLOB     NULL');
CALL add_col_if_missing('ef_personalinfos', 'AltNokPassport',              'LONGBLOB     NULL');
CALL add_col_if_missing('ef_personalinfos', 'mypassporturl',               'VARCHAR(500) NULL');
CALL add_col_if_missing('ef_personalinfos', 'mynokpassporturl',            'VARCHAR(500) NULL');
CALL add_col_if_missing('ef_personalinfos', 'myalternatenokpassporturl',   'VARCHAR(500) NULL');

-- ef_personalinfoshist — restore all slimmed cols (structure only, no data)
CALL add_col_if_missing('ef_personalinfoshist', 'Sex',                         'VARCHAR(10)   NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'MaritalStatus',               'VARCHAR(20)   NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'Birthdate',                   'DATE          NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'religion',                    'VARCHAR(50)   NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'gsm_number',                  'VARCHAR(20)   NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'gsm_number2',                 'VARCHAR(20)   NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'email',                       'VARCHAR(255)  NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'home_address',                'TEXT          NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'Bankcode',                    'VARCHAR(20)   NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'bankbranch',                  'VARCHAR(100)  NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'BankACNumber',                'VARCHAR(20)   NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'AccountName',                 'VARCHAR(255)  NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'pfacode',                     'VARCHAR(20)   NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'specialisation',              'VARCHAR(100)  NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'DateEmpl',                    'DATE          NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'DateLeft',                    'DATE          NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'seniorityDate',               'DATE          NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'yearOfPromotion',             'YEAR          NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'expirationOfEngagementDate',  'DATE          NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'StateofOrigin',               'VARCHAR(50)   NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'LocalGovt',                   'VARCHAR(100)  NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'TaxCode',                     'VARCHAR(20)   NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'exittype',                    'VARCHAR(50)   NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'entry_mode',                  'VARCHAR(50)   NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'gradelevel',                  'VARCHAR(20)   NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'gradetype',                   'VARCHAR(20)   NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'taxed',                       'TINYINT(1)    NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'entitlement',                 'VARCHAR(100)  NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'town',                        'VARCHAR(100)  NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'accomm_type',                 'VARCHAR(50)   NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'AcommodationStatus',          'VARCHAR(50)   NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'AddressofAcommodation',       'TEXT          NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'GBC',                         'VARCHAR(50)   NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'GBC_Number',                  'VARCHAR(50)   NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'qualification',               'VARCHAR(100)  NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'division',                    'VARCHAR(100)  NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'appointment',                 'VARCHAR(100)  NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'advanceDate',                 'DATE          NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'runoutDate',                  'DATE          NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'rankId',                      'INT           NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'createdby',                   'VARCHAR(100)  NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'datecreated',                 'DATETIME      NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'dateModify',                  'DATETIME      NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'dateVerify',                  'DATETIME      NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'verifyBy',                    'VARCHAR(100)  NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'nok_name',                    'VARCHAR(255)  NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'nok_relation',                'VARCHAR(100)  NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'nok_phone',                   'VARCHAR(20)   NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'nok_phone12',                 'VARCHAR(20)   NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'nok_email',                   'VARCHAR(255)  NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'nok_address',                 'TEXT          NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'nok_nationalId',              'VARCHAR(50)   NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'nok_name2',                   'VARCHAR(255)  NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'nok_relation2',               'VARCHAR(100)  NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'nok_phone2',                  'VARCHAR(20)   NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'nok_phone22',                 'VARCHAR(20)   NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'nok_email2',                  'VARCHAR(255)  NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'nok_address2',                'TEXT          NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'nok_nationalId2',             'VARCHAR(50)   NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'sp_name',                     'VARCHAR(255)  NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'sp_phone',                    'VARCHAR(20)   NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'sp_phone2',                   'VARCHAR(20)   NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'sp_email',                    'VARCHAR(255)  NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'chid_name',                   'VARCHAR(255)  NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'chid_name2',                  'VARCHAR(255)  NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'chid_name3',                  'VARCHAR(255)  NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'chid_name4',                  'VARCHAR(255)  NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'FGSHLS_loan',                 'DECIMAL(15,2) NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'FGSHLS_loanYear',             'YEAR          NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'car_loan',                    'DECIMAL(15,2) NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'car_loanYear',                'YEAR          NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'welfare_loan',                'DECIMAL(15,2) NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'welfare_loanYear',            'YEAR          NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'NNNCS_loan',                  'DECIMAL(15,2) NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'NNNCS_loanYear',              'YEAR          NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'NNMFBL_loan',                 'DECIMAL(15,2) NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'NNMFBL_loanYear',             'YEAR          NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'PPCFS_loan',                  'DECIMAL(15,2) NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'PPCFS_loanYear',              'YEAR          NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'Anyother_Loan',               'DECIMAL(15,2) NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'Anyother_LoanYear',           'YEAR          NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'NHFcode',                     'VARCHAR(50)   NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'NHFcodeYear',                 'YEAR          NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'NSITFcode',                   'VARCHAR(50)   NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'NSITFcodeYear',               'YEAR          NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'aircrew_allow',               'TINYINT(1)    NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'pilot_allow',                 'TINYINT(1)    NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'shift_duty_allow',            'TINYINT(1)    NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'hazard_allow',                'TINYINT(1)    NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'rent_subsidy',                'TINYINT(1)    NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'SBC_allow',                   'TINYINT(1)    NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'special_forces_allow',        'TINYINT(1)    NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'call_duty_allow',             'TINYINT(1)    NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'other_allow',                 'TINYINT(1)    NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'other_allowspecify',          'VARCHAR(255)  NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'Passport',                    'LONGBLOB      NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'NokPassport',                 'LONGBLOB      NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'AltNokPassport',              'LONGBLOB      NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'mypassporturl',               'VARCHAR(500)  NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'mynokpassporturl',            'VARCHAR(500)  NULL');
CALL add_col_if_missing('ef_personalinfoshist', 'myalternatenokpassporturl',   'VARCHAR(500)  NULL');

-- Cleanup helper procedure
DROP PROCEDURE IF EXISTS add_col_if_missing;

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================