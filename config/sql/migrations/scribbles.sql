-- =============================================================================
-- Migration: drop_flat_columns
-- MySQL: 8.0.44+
-- PURPOSE:
--   Remove legacy flat columns after normalization migration.
--
-- SAFE RERUN:
--   Uses native MySQL 8:
--     - DROP COLUMN IF EXISTS
--     - ADD COLUMN IF NOT EXISTS
--
-- IMPORTANT:
--   Run snapshot/backfill migrations BEFORE this migration.
-- =============================================================================


-- =============================================================================
-- UP
-- =============================================================================


-- -----------------------------------------------------------------------------
-- PRE-FLIGHT VALIDATION
-- Abort if snapshots are missing.
-- No stored procedures.
-- No DELIMITER.
-- Compatible with mysql2 / Prisma-style runners.
-- -----------------------------------------------------------------------------

SELECT
  CASE
    WHEN (
      SELECT COUNT(*)
      FROM ef_emolument_forms
      WHERE snapshot IS NOT NULL
    ) = 0
    THEN CAST('GATE FAILED: ef_emolument_forms has no snapshots' AS SIGNED)
    ELSE 1
  END AS snapshot_gate;

SELECT
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM ef_personalinfoshist h
      LEFT JOIN ef_emolument_forms ef
        ON ef.service_no = h.serviceNumber
       AND ef.form_year  = CAST(h.FormYear AS CHAR)
      WHERE ef.snapshot IS NULL
    )
    THEN CAST('GATE FAILED: history rows missing snapshots' AS SIGNED)
    ELSE 1
  END AS history_gate;


-- =============================================================================
-- ef_personalinfos
-- =============================================================================

ALTER TABLE ef_personalinfos

-- NOK primary
DROP COLUMN IF EXISTS nok_name,
DROP COLUMN IF EXISTS nok_relation,
DROP COLUMN IF EXISTS nok_phone,
DROP COLUMN IF EXISTS nok_phone12,
DROP COLUMN IF EXISTS nok_email,
DROP COLUMN IF EXISTS nok_address,
DROP COLUMN IF EXISTS nok_nationalId,

-- NOK alternate
DROP COLUMN IF EXISTS nok_name2,
DROP COLUMN IF EXISTS nok_relation2,
DROP COLUMN IF EXISTS nok_phone2,
DROP COLUMN IF EXISTS nok_phone22,
DROP COLUMN IF EXISTS nok_email2,
DROP COLUMN IF EXISTS nok_address2,
DROP COLUMN IF EXISTS nok_nationalId2,

-- Spouse
DROP COLUMN IF EXISTS sp_name,
DROP COLUMN IF EXISTS sp_phone,
DROP COLUMN IF EXISTS sp_phone2,
DROP COLUMN IF EXISTS sp_email,

-- Children
DROP COLUMN IF EXISTS chid_name,
DROP COLUMN IF EXISTS chid_name2,
DROP COLUMN IF EXISTS chid_name3,
DROP COLUMN IF EXISTS chid_name4,

-- Loans
DROP COLUMN IF EXISTS FGSHLS_loan,
DROP COLUMN IF EXISTS FGSHLS_loanYear,
DROP COLUMN IF EXISTS car_loan,
DROP COLUMN IF EXISTS car_loanYear,
DROP COLUMN IF EXISTS welfare_loan,
DROP COLUMN IF EXISTS welfare_loanYear,
DROP COLUMN IF EXISTS NNNCS_loan,
DROP COLUMN IF EXISTS NNNCS_loanYear,
DROP COLUMN IF EXISTS NNMFBL_loan,
DROP COLUMN IF EXISTS NNMFBL_loanYear,
DROP COLUMN IF EXISTS PPCFS_loan,
DROP COLUMN IF EXISTS PPCFS_loanYear,
DROP COLUMN IF EXISTS Anyother_Loan,
DROP COLUMN IF EXISTS Anyother_LoanYear,
DROP COLUMN IF EXISTS NHFcode,
DROP COLUMN IF EXISTS NHFcodeYear,
DROP COLUMN IF EXISTS NSITFcode,
DROP COLUMN IF EXISTS NSITFcodeYear,

-- Allowances
DROP COLUMN IF EXISTS aircrew_allow,
DROP COLUMN IF EXISTS pilot_allow,
DROP COLUMN IF EXISTS shift_duty_allow,
DROP COLUMN IF EXISTS hazard_allow,
DROP COLUMN IF EXISTS rent_subsidy,
DROP COLUMN IF EXISTS SBC_allow,
DROP COLUMN IF EXISTS special_forces_allow,
DROP COLUMN IF EXISTS call_duty_allow,
DROP COLUMN IF EXISTS other_allow,
DROP COLUMN IF EXISTS other_allowspecify,

-- Photos / URLs
DROP COLUMN IF EXISTS Passport,
DROP COLUMN IF EXISTS NokPassport,
DROP COLUMN IF EXISTS AltNokPassport,
DROP COLUMN IF EXISTS mypassporturl,
DROP COLUMN IF EXISTS mynokpassporturl,
DROP COLUMN IF EXISTS myalternatenokpassporturl;


-- =============================================================================
-- ef_personalinfoshist
-- =============================================================================

ALTER TABLE ef_personalinfoshist

-- Personal
DROP COLUMN IF EXISTS Sex,
DROP COLUMN IF EXISTS MaritalStatus,
DROP COLUMN IF EXISTS Birthdate,
DROP COLUMN IF EXISTS religion,
DROP COLUMN IF EXISTS gsm_number,
DROP COLUMN IF EXISTS gsm_number2,
DROP COLUMN IF EXISTS email,
DROP COLUMN IF EXISTS home_address,
DROP COLUMN IF EXISTS Bankcode,
DROP COLUMN IF EXISTS bankbranch,
DROP COLUMN IF EXISTS BankACNumber,
DROP COLUMN IF EXISTS AccountName,
DROP COLUMN IF EXISTS pfacode,
DROP COLUMN IF EXISTS specialisation,
DROP COLUMN IF EXISTS DateEmpl,
DROP COLUMN IF EXISTS DateLeft,
DROP COLUMN IF EXISTS seniorityDate,
DROP COLUMN IF EXISTS yearOfPromotion,
DROP COLUMN IF EXISTS expirationOfEngagementDate,
DROP COLUMN IF EXISTS StateofOrigin,
DROP COLUMN IF EXISTS LocalGovt,
DROP COLUMN IF EXISTS TaxCode,
DROP COLUMN IF EXISTS exittype,
DROP COLUMN IF EXISTS entry_mode,
DROP COLUMN IF EXISTS gradelevel,
DROP COLUMN IF EXISTS gradetype,
DROP COLUMN IF EXISTS taxed,
DROP COLUMN IF EXISTS entitlement,
DROP COLUMN IF EXISTS town,
DROP COLUMN IF EXISTS accomm_type,
DROP COLUMN IF EXISTS AcommodationStatus,
DROP COLUMN IF EXISTS AddressofAcommodation,
DROP COLUMN IF EXISTS GBC,
DROP COLUMN IF EXISTS GBC_Number,
DROP COLUMN IF EXISTS qualification,
DROP COLUMN IF EXISTS division,
DROP COLUMN IF EXISTS appointment,
DROP COLUMN IF EXISTS advanceDate,
DROP COLUMN IF EXISTS runoutDate,
DROP COLUMN IF EXISTS rankId,
DROP COLUMN IF EXISTS createdby,
DROP COLUMN IF EXISTS datecreated,
DROP COLUMN IF EXISTS dateModify,
DROP COLUMN IF EXISTS dateVerify,
DROP COLUMN IF EXISTS verifyBy,

-- NOK
DROP COLUMN IF EXISTS nok_name,
DROP COLUMN IF EXISTS nok_relation,
DROP COLUMN IF EXISTS nok_phone,
DROP COLUMN IF EXISTS nok_phone12,
DROP COLUMN IF EXISTS nok_email,
DROP COLUMN IF EXISTS nok_address,
DROP COLUMN IF EXISTS nok_nationalId,
DROP COLUMN IF EXISTS nok_name2,
DROP COLUMN IF EXISTS nok_relation2,
DROP COLUMN IF EXISTS nok_phone2,
DROP COLUMN IF EXISTS nok_phone22,
DROP COLUMN IF EXISTS nok_email2,
DROP COLUMN IF EXISTS nok_address2,
DROP COLUMN IF EXISTS nok_nationalId2,

-- Spouse
DROP COLUMN IF EXISTS sp_name,
DROP COLUMN IF EXISTS sp_phone,
DROP COLUMN IF EXISTS sp_phone2,
DROP COLUMN IF EXISTS sp_email,

-- Children
DROP COLUMN IF EXISTS chid_name,
DROP COLUMN IF EXISTS chid_name2,
DROP COLUMN IF EXISTS chid_name3,
DROP COLUMN IF EXISTS chid_name4,

-- Loans
DROP COLUMN IF EXISTS FGSHLS_loan,
DROP COLUMN IF EXISTS FGSHLS_loanYear,
DROP COLUMN IF EXISTS car_loan,
DROP COLUMN IF EXISTS car_loanYear,
DROP COLUMN IF EXISTS welfare_loan,
DROP COLUMN IF EXISTS welfare_loanYear,
DROP COLUMN IF EXISTS NNNCS_loan,
DROP COLUMN IF EXISTS NNNCS_loanYear,
DROP COLUMN IF EXISTS NNMFBL_loan,
DROP COLUMN IF EXISTS NNMFBL_loanYear,
DROP COLUMN IF EXISTS PPCFS_loan,
DROP COLUMN IF EXISTS PPCFS_loanYear,
DROP COLUMN IF EXISTS Anyother_Loan,
DROP COLUMN IF EXISTS Anyother_LoanYear,
DROP COLUMN IF EXISTS NHFcode,
DROP COLUMN IF EXISTS NHFcodeYear,
DROP COLUMN IF EXISTS NSITFcode,
DROP COLUMN IF EXISTS NSITFcodeYear,

-- Allowances
DROP COLUMN IF EXISTS aircrew_allow,
DROP COLUMN IF EXISTS pilot_allow,
DROP COLUMN IF EXISTS shift_duty_allow,
DROP COLUMN IF EXISTS hazard_allow,
DROP COLUMN IF EXISTS rent_subsidy,
DROP COLUMN IF EXISTS SBC_allow,
DROP COLUMN IF EXISTS special_forces_allow,
DROP COLUMN IF EXISTS call_duty_allow,
DROP COLUMN IF EXISTS other_allow,
DROP COLUMN IF EXISTS other_allowspecify,

-- Photos / URLs
DROP COLUMN IF EXISTS Passport,
DROP COLUMN IF EXISTS NokPassport,
DROP COLUMN IF EXISTS AltNokPassport,
DROP COLUMN IF EXISTS mypassporturl,
DROP COLUMN IF EXISTS mynokpassporturl,
DROP COLUMN IF EXISTS myalternatenokpassporturl;


-- =============================================================================
-- INDEXES
-- MySQL still lacks CREATE INDEX IF NOT EXISTS.
-- =============================================================================

SET @idx := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ef_personalinfoshist'
    AND INDEX_NAME = 'idx_hist_year'
);

SET @sql := IF(
  @idx = 0,
  'CREATE INDEX idx_hist_year ON ef_personalinfoshist(FormYear)',
  'SELECT ''idx_hist_year exists'''
);

PREPARE stmt1 FROM @sql;
EXECUTE stmt1;
DEALLOCATE PREPARE stmt1;


-- =============================================================================
-- VERIFICATION
-- =============================================================================

SELECT COUNT(*) AS should_be_zero
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'ef_personalinfos'
  AND COLUMN_NAME IN (
    'nok_name',
    'sp_name',
    'chid_name',
    'FGSHLS_loan',
    'aircrew_allow',
    'Passport'
  );


-- =============================================================================
-- DOWN
-- =============================================================================

ALTER TABLE ef_personalinfos

ADD COLUMN IF NOT EXISTS nok_name       VARCHAR(255) NULL,
ADD COLUMN IF NOT EXISTS nok_relation   VARCHAR(100) NULL,
ADD COLUMN IF NOT EXISTS nok_phone      VARCHAR(20) NULL,
ADD COLUMN IF NOT EXISTS nok_phone12    VARCHAR(20) NULL,
ADD COLUMN IF NOT EXISTS nok_email      VARCHAR(255) NULL,
ADD COLUMN IF NOT EXISTS nok_address    TEXT NULL,
ADD COLUMN IF NOT EXISTS nok_nationalId VARCHAR(50) NULL,

ADD COLUMN IF NOT EXISTS sp_name        VARCHAR(255) NULL,
ADD COLUMN IF NOT EXISTS sp_phone       VARCHAR(20) NULL,
ADD COLUMN IF NOT EXISTS sp_phone2      VARCHAR(20) NULL,
ADD COLUMN IF NOT EXISTS sp_email       VARCHAR(255) NULL,

ADD COLUMN IF NOT EXISTS Passport       LONGBLOB NULL,
ADD COLUMN IF NOT EXISTS mypassporturl  VARCHAR(500) NULL;


ALTER TABLE ef_personalinfoshist

ADD COLUMN IF NOT EXISTS Sex            VARCHAR(10) NULL,
ADD COLUMN IF NOT EXISTS MaritalStatus  VARCHAR(20) NULL,
ADD COLUMN IF NOT EXISTS Birthdate      DATE NULL,
ADD COLUMN IF NOT EXISTS gsm_number     VARCHAR(20) NULL,
ADD COLUMN IF NOT EXISTS email          VARCHAR(255) NULL,

ADD COLUMN IF NOT EXISTS nok_name       VARCHAR(255) NULL,
ADD COLUMN IF NOT EXISTS sp_name        VARCHAR(255) NULL,
ADD COLUMN IF NOT EXISTS chid_name      VARCHAR(255) NULL,

ADD COLUMN IF NOT EXISTS Passport       LONGBLOB NULL,
ADD COLUMN IF NOT EXISTS mypassporturl  VARCHAR(500) NULL;


-- =============================================================================
-- END
-- =============================================================================