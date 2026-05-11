-- =============================================================================
-- Migration: drop_flat_columns
-- Created: 2026-04-30T11:36:11.507Z
-- PURPOSE:
--   Drop flat NOK/spouse/children/loan/allowance/blob columns from
--   ef_personalinfos and slim down ef_personalinfoshist to a lightweight
--   index/archive table. Full form data lives in ef_emolument_forms.snapshot.
--
-- COMPATIBILITY:
--   Written for Node.js mysql2 driver (or any programmatic client).
--   NO DELIMITER commands — those are mysql CLI-only.
--   NO DROP/ADD COLUMN IF EXISTS — unreliable in multi-column ALTERs.
--   All conditional DDL uses information_schema + PREPARE/EXECUTE.
--
-- RUN ORDER:
--   1. Run 20240601_001_backfill_history_snapshots.sql first
--   2. Run 20240602_001_performance_indexes.sql second
--   3. Run this script last
--
-- Safe to re-run: every DROP/ADD COLUMN is wrapped in an existence check.
--                 Running twice is a no-op — no errors.
--
-- IMPORTANT: Take a full database backup before running UP.
--            DOWN restores the columns as NULLable — data is NOT restored.
-- =============================================================================




-- =============================================================================
-- UP
-- =============================================================================

-- -----------------------------------------------------------------------------
-- GATE 1: ef_emolument_forms must have at least one snapshot.
-- This uses CAST trick to intentionally error on failure — the driver will
-- surface the error and abort the migration.
-- -----------------------------------------------------------------------------

SELECT
  CASE
    WHEN (
      SELECT COUNT(*) FROM ef_emolument_forms WHERE snapshot IS NOT NULL
    ) = 0
    THEN CAST('GATE FAILED: ef_emolument_forms has no snapshots. Run 20240601_001_backfill_history_snapshots.sql first.' AS SIGNED)
    ELSE 1
  END AS snapshot_gate;


-- -----------------------------------------------------------------------------
-- GATE 2: No history row may be missing a snapshot.
-- -----------------------------------------------------------------------------

SELECT
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM ef_personalinfoshist h
      LEFT JOIN ef_emolument_forms ef
        ON ef.service_no  = h.serviceNumber
       AND ef.form_year   = CAST(h.FormYear AS CHAR)
      WHERE ef.snapshot IS NULL
    )
    THEN CAST('GATE FAILED: Some history rows have no snapshot yet. Re-run the backfill migration first.' AS SIGNED)
    ELSE 1
  END AS history_gate;


-- -----------------------------------------------------------------------------
-- GATE 3: Child tables must not be empty.
-- -----------------------------------------------------------------------------

SELECT
  CASE WHEN (SELECT COUNT(*) FROM ef_nok)        = 0 THEN CAST('GATE FAILED: ef_nok is empty.'        AS SIGNED) ELSE 1 END AS nok_gate,
  CASE WHEN (SELECT COUNT(*) FROM ef_spouse)      = 0 THEN CAST('GATE FAILED: ef_spouse is empty.'     AS SIGNED) ELSE 1 END AS spouse_gate,
  CASE WHEN (SELECT COUNT(*) FROM ef_children)    = 0 THEN CAST('GATE FAILED: ef_children is empty.'   AS SIGNED) ELSE 1 END AS children_gate,
  CASE WHEN (SELECT COUNT(*) FROM ef_loans)       = 0 THEN CAST('GATE FAILED: ef_loans is empty.'      AS SIGNED) ELSE 1 END AS loans_gate,
  CASE WHEN (SELECT COUNT(*) FROM ef_allowances)  = 0 THEN CAST('GATE FAILED: ef_allowances is empty.' AS SIGNED) ELSE 1 END AS allowances_gate,
  CASE WHEN (SELECT COUNT(*) FROM ef_documents)   = 0 THEN CAST('GATE FAILED: ef_documents is empty.'  AS SIGNED) ELSE 1 END AS documents_gate;


-- =============================================================================
-- HELPER: drop_col_if_exists
-- Drops a column only when it exists. Safe to call on a column that is
-- already gone — becomes a no-op.
--
-- NOTE FOR DRIVER CALLERS:
--   Send this CREATE PROCEDURE block as ONE query call (no DELIMITER needed).
--   Then CALL drop_col_if_exists(...) for each column.
--   Then DROP PROCEDURE IF EXISTS drop_col_if_exists; at the end.
-- =============================================================================

DROP PROCEDURE IF EXISTS drop_col_if_exists;

CREATE PROCEDURE drop_col_if_exists(
    IN p_table  VARCHAR(64),
    IN p_column VARCHAR(64)
)
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = p_table
          AND COLUMN_NAME  = p_column
    ) THEN
        SET @_drop_sql = CONCAT(
            'ALTER TABLE `', p_table, '` DROP COLUMN `', p_column, '`'
        );
        PREPARE _drop_stmt FROM @_drop_sql;
        EXECUTE _drop_stmt;
        DEALLOCATE PREPARE _drop_stmt;
    END IF;
END;


-- =============================================================================
-- HELPER: add_col_if_not_exists
-- Adds a column only when it does not already exist. Used by DOWN.
-- =============================================================================

DROP PROCEDURE IF EXISTS add_col_if_not_exists;

CREATE PROCEDURE add_col_if_not_exists(
    IN p_table      VARCHAR(64),
    IN p_column     VARCHAR(64),
    IN p_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = p_table
          AND COLUMN_NAME  = p_column
    ) THEN
        SET @_add_sql = CONCAT(
            'ALTER TABLE `', p_table, '` ADD COLUMN `', p_column, '` ', p_definition
        );
        PREPARE _add_stmt FROM @_add_sql;
        EXECUTE _add_stmt;
        DEALLOCATE PREPARE _add_stmt;
    END IF;
END;


-- =============================================================================
-- SECTION 1 — DROP FLAT COLUMNS FROM ef_personalinfos
-- =============================================================================

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
-- CALL drop_col_if_exists('ef_personalinfos', 'NHFcode');
-- CALL drop_col_if_exists('ef_personalinfos', 'NHFcodeYear');
-- CALL drop_col_if_exists('ef_personalinfos', 'NSITFcode');
-- CALL drop_col_if_exists('ef_personalinfos', 'NSITFcodeYear');

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

-- Photos / blob URLs
CALL drop_col_if_exists('ef_personalinfos', 'Passport');
CALL drop_col_if_exists('ef_personalinfos', 'NokPassport');
CALL drop_col_if_exists('ef_personalinfos', 'AltNokPassport');
CALL drop_col_if_exists('ef_personalinfos', 'mypassporturl');
CALL drop_col_if_exists('ef_personalinfos', 'mynokpassporturl');
CALL drop_col_if_exists('ef_personalinfos', 'myalternatenokpassporturl');


-- =============================================================================
-- SECTION 2 — SLIM DOWN ef_personalinfoshist
-- Keeps only listing/filtering columns. Full form data lives in
-- ef_emolument_forms.snapshot.
-- =============================================================================

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

-- NOK
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

-- Spouse
CALL drop_col_if_exists('ef_personalinfoshist', 'sp_name');
CALL drop_col_if_exists('ef_personalinfoshist', 'sp_phone');
CALL drop_col_if_exists('ef_personalinfoshist', 'sp_phone2');
CALL drop_col_if_exists('ef_personalinfoshist', 'sp_email');

-- Children
CALL drop_col_if_exists('ef_personalinfoshist', 'chid_name');
CALL drop_col_if_exists('ef_personalinfoshist', 'chid_name2');
CALL drop_col_if_exists('ef_personalinfoshist', 'chid_name3');
CALL drop_col_if_exists('ef_personalinfoshist', 'chid_name4');

-- Loans
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

-- Allowances
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

-- Photos / URLs
CALL drop_col_if_exists('ef_personalinfoshist', 'Passport');
CALL drop_col_if_exists('ef_personalinfoshist', 'NokPassport');
CALL drop_col_if_exists('ef_personalinfoshist', 'AltNokPassport');
CALL drop_col_if_exists('ef_personalinfoshist', 'mypassporturl');
CALL drop_col_if_exists('ef_personalinfoshist', 'mynokpassporturl');
CALL drop_col_if_exists('ef_personalinfoshist', 'myalternatenokpassporturl');


-- =============================================================================
-- SECTION 3 — INDEX on ef_personalinfoshist(FormYear)
-- MySQL has no CREATE INDEX IF NOT EXISTS before 8.0.29.
-- Use the information_schema check pattern instead.
-- =============================================================================

SET @idx_count := (
    SELECT COUNT(*)
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ef_personalinfoshist'
      AND INDEX_NAME   = 'idx_hist_year'
);

SET @idx_sql := IF(
    @idx_count = 0,
    'CREATE INDEX idx_hist_year ON ef_personalinfoshist (FormYear)',
    "SELECT 'idx_hist_year already exists'"
);

PREPARE _idx_stmt FROM @idx_sql;
EXECUTE _idx_stmt;
DEALLOCATE PREPARE _idx_stmt;


-- =============================================================================
-- SECTION 4 — VERIFICATION
-- should_be_zero must equal 0 after UP runs successfully.
-- =============================================================================

SELECT COUNT(*) AS should_be_zero
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME   = 'ef_personalinfos'
  AND COLUMN_NAME IN (
      'nok_name', 'sp_name', 'chid_name',
      'FGSHLS_loan', 'aircrew_allow', 'Passport'
  );


-- =============================================================================
-- CLEANUP — remove helper procedures
-- =============================================================================

DROP PROCEDURE IF EXISTS drop_col_if_exists;
DROP PROCEDURE IF EXISTS add_col_if_not_exists;


-- =============================================================================
-- DOWN
-- Restores all dropped columns as NULLable.
-- DATA IS NOT RESTORED — this only brings back column structure.
-- Use your database backup to restore actual data if needed.
-- =============================================================================

-- Recreate helpers for DOWN block
DROP PROCEDURE IF EXISTS add_col_if_not_exists;

CREATE PROCEDURE add_col_if_not_exists(
    IN p_table      VARCHAR(64),
    IN p_column     VARCHAR(64),
    IN p_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = p_table
          AND COLUMN_NAME  = p_column
    ) THEN
        SET @_add_sql = CONCAT(
            'ALTER TABLE `', p_table, '` ADD COLUMN `', p_column, '` ', p_definition
        );
        PREPARE _add_stmt FROM @_add_sql;
        EXECUTE _add_stmt;
        DEALLOCATE PREPARE _add_stmt;
    END IF;
END;


-- ef_personalinfos — restore NOK primary
CALL add_col_if_not_exists('ef_personalinfos', 'nok_name',       'VARCHAR(255) NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'nok_relation',   'VARCHAR(100) NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'nok_phone',      'VARCHAR(20) NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'nok_phone12',    'VARCHAR(20) NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'nok_email',      'VARCHAR(255) NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'nok_address',    'TEXT NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'nok_nationalId', 'VARCHAR(50) NULL');

-- NOK alternate
CALL add_col_if_not_exists('ef_personalinfos', 'nok_name2',       'VARCHAR(255) NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'nok_relation2',   'VARCHAR(100) NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'nok_phone2',      'VARCHAR(20) NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'nok_phone22',     'VARCHAR(20) NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'nok_email2',      'VARCHAR(255) NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'nok_address2',    'TEXT NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'nok_nationalId2', 'VARCHAR(50) NULL');

-- Spouse
CALL add_col_if_not_exists('ef_personalinfos', 'sp_name',   'VARCHAR(255) NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'sp_phone',  'VARCHAR(20) NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'sp_phone2', 'VARCHAR(20) NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'sp_email',  'VARCHAR(255) NULL');

-- Children
CALL add_col_if_not_exists('ef_personalinfos', 'chid_name',  'VARCHAR(255) NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'chid_name2', 'VARCHAR(255) NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'chid_name3', 'VARCHAR(255) NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'chid_name4', 'VARCHAR(255) NULL');

-- Loans
CALL add_col_if_not_exists('ef_personalinfos', 'FGSHLS_loan',       'VARCHAR(100) NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'FGSHLS_loanYear',   'VARCHAR(10) NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'car_loan',           'VARCHAR(100) NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'car_loanYear',       'VARCHAR(10) NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'welfare_loan',       'VARCHAR(100) NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'welfare_loanYear',   'VARCHAR(10) NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'NNNCS_loan',         'VARCHAR(100) NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'NNNCS_loanYear',     'VARCHAR(10) NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'NNMFBL_loan',        'VARCHAR(100) NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'NNMFBL_loanYear',    'VARCHAR(10) NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'PPCFS_loan',         'VARCHAR(100) NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'PPCFS_loanYear',     'VARCHAR(10) NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'Anyother_Loan',      'VARCHAR(100) NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'Anyother_LoanYear',  'VARCHAR(10) NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'NHFcode',            'VARCHAR(50) NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'NHFcodeYear',        'VARCHAR(10) NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'NSITFcode',          'VARCHAR(50) NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'NSITFcodeYear',      'VARCHAR(10) NULL');

-- Allowances
CALL add_col_if_not_exists('ef_personalinfos', 'aircrew_allow',       'VARCHAR(50) NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'pilot_allow',         'VARCHAR(50) NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'shift_duty_allow',    'VARCHAR(50) NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'hazard_allow',        'VARCHAR(50) NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'rent_subsidy',        'VARCHAR(50) NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'SBC_allow',           'VARCHAR(50) NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'special_forces_allow','VARCHAR(50) NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'call_duty_allow',     'VARCHAR(50) NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'other_allow',         'VARCHAR(50) NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'other_allowspecify',  'VARCHAR(255) NULL');

-- Photos / URLs
CALL add_col_if_not_exists('ef_personalinfos', 'Passport',                   'LONGBLOB NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'NokPassport',                'LONGBLOB NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'AltNokPassport',             'LONGBLOB NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'mypassporturl',              'VARCHAR(500) NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'mynokpassporturl',           'VARCHAR(500) NULL');
CALL add_col_if_not_exists('ef_personalinfos', 'myalternatenokpassporturl',  'VARCHAR(500) NULL');


-- ef_personalinfoshist — restore personal
CALL add_col_if_not_exists('ef_personalinfoshist', 'Sex',                         'VARCHAR(10) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'MaritalStatus',               'VARCHAR(20) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'Birthdate',                   'DATE NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'religion',                    'VARCHAR(50) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'gsm_number',                  'VARCHAR(20) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'gsm_number2',                 'VARCHAR(20) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'email',                       'VARCHAR(255) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'home_address',                'TEXT NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'Bankcode',                    'VARCHAR(20) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'bankbranch',                  'VARCHAR(100) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'BankACNumber',                'VARCHAR(50) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'AccountName',                 'VARCHAR(255) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'pfacode',                     'VARCHAR(20) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'specialisation',              'VARCHAR(100) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'DateEmpl',                    'DATE NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'DateLeft',                    'DATE NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'seniorityDate',               'DATE NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'yearOfPromotion',             'VARCHAR(10) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'expirationOfEngagementDate',  'DATE NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'StateofOrigin',               'VARCHAR(100) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'LocalGovt',                   'VARCHAR(100) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'TaxCode',                     'VARCHAR(50) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'exittype',                    'VARCHAR(50) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'entry_mode',                  'VARCHAR(50) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'gradelevel',                  'VARCHAR(20) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'gradetype',                   'VARCHAR(20) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'taxed',                       'VARCHAR(10) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'entitlement',                 'VARCHAR(100) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'town',                        'VARCHAR(100) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'accomm_type',                 'VARCHAR(50) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'AcommodationStatus',          'VARCHAR(50) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'AddressofAcommodation',       'TEXT NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'GBC',                         'VARCHAR(20) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'GBC_Number',                  'VARCHAR(50) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'qualification',               'VARCHAR(100) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'division',                    'VARCHAR(100) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'appointment',                 'VARCHAR(100) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'advanceDate',                 'DATE NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'runoutDate',                  'DATE NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'rankId',                      'INT NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'createdby',                   'VARCHAR(100) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'datecreated',                 'DATETIME NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'dateModify',                  'DATETIME NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'dateVerify',                  'DATETIME NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'verifyBy',                    'VARCHAR(100) NULL');

-- NOK
CALL add_col_if_not_exists('ef_personalinfoshist', 'nok_name',       'VARCHAR(255) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'nok_relation',   'VARCHAR(100) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'nok_phone',      'VARCHAR(20) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'nok_phone12',    'VARCHAR(20) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'nok_email',      'VARCHAR(255) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'nok_address',    'TEXT NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'nok_nationalId', 'VARCHAR(50) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'nok_name2',       'VARCHAR(255) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'nok_relation2',   'VARCHAR(100) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'nok_phone2',      'VARCHAR(20) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'nok_phone22',     'VARCHAR(20) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'nok_email2',      'VARCHAR(255) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'nok_address2',    'TEXT NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'nok_nationalId2', 'VARCHAR(50) NULL');

-- Spouse
CALL add_col_if_not_exists('ef_personalinfoshist', 'sp_name',   'VARCHAR(255) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'sp_phone',  'VARCHAR(20) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'sp_phone2', 'VARCHAR(20) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'sp_email',  'VARCHAR(255) NULL');

-- Children
CALL add_col_if_not_exists('ef_personalinfoshist', 'chid_name',  'VARCHAR(255) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'chid_name2', 'VARCHAR(255) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'chid_name3', 'VARCHAR(255) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'chid_name4', 'VARCHAR(255) NULL');

-- Loans
CALL add_col_if_not_exists('ef_personalinfoshist', 'FGSHLS_loan',       'VARCHAR(100) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'FGSHLS_loanYear',   'VARCHAR(10) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'car_loan',           'VARCHAR(100) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'car_loanYear',       'VARCHAR(10) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'welfare_loan',       'VARCHAR(100) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'welfare_loanYear',   'VARCHAR(10) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'NNNCS_loan',         'VARCHAR(100) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'NNNCS_loanYear',     'VARCHAR(10) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'NNMFBL_loan',        'VARCHAR(100) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'NNMFBL_loanYear',    'VARCHAR(10) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'PPCFS_loan',         'VARCHAR(100) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'PPCFS_loanYear',     'VARCHAR(10) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'Anyother_Loan',      'VARCHAR(100) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'Anyother_LoanYear',  'VARCHAR(10) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'NHFcode',            'VARCHAR(50) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'NHFcodeYear',        'VARCHAR(10) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'NSITFcode',          'VARCHAR(50) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'NSITFcodeYear',      'VARCHAR(10) NULL');

-- Allowances
CALL add_col_if_not_exists('ef_personalinfoshist', 'aircrew_allow',        'VARCHAR(50) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'pilot_allow',          'VARCHAR(50) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'shift_duty_allow',     'VARCHAR(50) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'hazard_allow',         'VARCHAR(50) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'rent_subsidy',         'VARCHAR(50) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'SBC_allow',            'VARCHAR(50) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'special_forces_allow', 'VARCHAR(50) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'call_duty_allow',      'VARCHAR(50) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'other_allow',          'VARCHAR(50) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'other_allowspecify',   'VARCHAR(255) NULL');

-- Photos / URLs
CALL add_col_if_not_exists('ef_personalinfoshist', 'Passport',                  'LONGBLOB NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'NokPassport',               'LONGBLOB NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'AltNokPassport',            'LONGBLOB NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'mypassporturl',             'VARCHAR(500) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'mynokpassporturl',          'VARCHAR(500) NULL');
CALL add_col_if_not_exists('ef_personalinfoshist', 'myalternatenokpassporturl', 'VARCHAR(500) NULL');


-- Restore the index (DOWN: drop it)
SET @drop_idx := (
    SELECT COUNT(*)
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ef_personalinfoshist'
      AND INDEX_NAME   = 'idx_hist_year'
);

SET @drop_idx_sql := IF(
    @drop_idx > 0,
    'DROP INDEX idx_hist_year ON ef_personalinfoshist',
    "SELECT 'idx_hist_year does not exist, nothing to drop'"
);

PREPARE _didx FROM @drop_idx_sql;
EXECUTE _didx;
DEALLOCATE PREPARE _didx;


-- DOWN cleanup
DROP PROCEDURE IF EXISTS add_col_if_not_exists;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================