-- Migration: migrate_emol_indexes
-- Created: 2026-04-30T11:35:00.792Z


-- =============================================================================
-- UP
-- =============================================================================
-- Add your schema changes here

START TRANSACTION;

-- -----------------------------------------------------------------------------
-- SECTION 0 — pre-flight row counts
-- Review before proceeding.
-- -----------------------------------------------------------------------------

SELECT 'ef_personalinfos' AS tbl, COUNT(*) AS row_count FROM ef_personalinfos
UNION ALL SELECT 'ef_emolument_forms',   COUNT(*) FROM ef_emolument_forms
UNION ALL SELECT 'ef_form_approvals',    COUNT(*) FROM ef_form_approvals
UNION ALL SELECT 'ef_audit_logs',        COUNT(*) FROM ef_audit_logs
UNION ALL SELECT 'ef_nok',               COUNT(*) FROM ef_nok
UNION ALL SELECT 'ef_spouse',            COUNT(*) FROM ef_spouse
UNION ALL SELECT 'ef_children',          COUNT(*) FROM ef_children
UNION ALL SELECT 'ef_loans',             COUNT(*) FROM ef_loans
UNION ALL SELECT 'ef_allowances',        COUNT(*) FROM ef_allowances
UNION ALL SELECT 'ef_documents',         COUNT(*) FROM ef_documents
UNION ALL SELECT 'ef_personalinfoshist', COUNT(*) FROM ef_personalinfoshist;

COMMIT;


-- -----------------------------------------------------------------------------
-- SECTION 1 — ef_personalinfos
-- -----------------------------------------------------------------------------

-- 1a. ship + Status
SET @idx := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_personalinfos'
      AND INDEX_NAME = 'idx_pi_ship_status'
);
SET @sql := IF(@idx = 0,
    'CREATE INDEX idx_pi_ship_status ON ef_personalinfos (ship, Status) ALGORITHM=INPLACE LOCK=NONE',
    'SELECT ''idx_pi_ship_status already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 1b. ship + Status + emolumentform
SET @idx := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_personalinfos'
      AND INDEX_NAME = 'idx_pi_ship_status_emol'
);
SET @sql := IF(@idx = 0,
    'CREATE INDEX idx_pi_ship_status_emol ON ef_personalinfos (ship, Status, emolumentform) ALGORITHM=INPLACE LOCK=NONE',
    'SELECT ''idx_pi_ship_status_emol already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 1c. command + Status
SET @idx := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_personalinfos'
      AND INDEX_NAME = 'idx_pi_command_status'
);
SET @sql := IF(@idx = 0,
    'CREATE INDEX idx_pi_command_status ON ef_personalinfos (command, Status) ALGORITHM=INPLACE LOCK=NONE',
    'SELECT ''idx_pi_command_status already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 1d. command + Status + emolumentform
SET @idx := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_personalinfos'
      AND INDEX_NAME = 'idx_pi_command_status_emol'
);
SET @sql := IF(@idx = 0,
    'CREATE INDEX idx_pi_command_status_emol ON ef_personalinfos (command, Status, emolumentform) ALGORITHM=INPLACE LOCK=NONE',
    'SELECT ''idx_pi_command_status_emol already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 1e. payrollclass + Status
SET @idx := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_personalinfos'
      AND INDEX_NAME = 'idx_pi_payrollclass_status'
);
SET @sql := IF(@idx = 0,
    'CREATE INDEX idx_pi_payrollclass_status ON ef_personalinfos (payrollclass, Status) ALGORITHM=INPLACE LOCK=NONE',
    'SELECT ''idx_pi_payrollclass_status already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 1f. ship + classes + Status
SET @idx := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_personalinfos'
      AND INDEX_NAME = 'idx_pi_ship_classes_status'
);
SET @sql := IF(@idx = 0,
    'CREATE INDEX idx_pi_ship_classes_status ON ef_personalinfos (ship, classes, Status) ALGORITHM=INPLACE LOCK=NONE',
    'SELECT ''idx_pi_ship_classes_status already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 1g. emolumentform
SET @idx := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_personalinfos'
      AND INDEX_NAME = 'idx_pi_emolumentform'
);
SET @sql := IF(@idx = 0,
    'CREATE INDEX idx_pi_emolumentform ON ef_personalinfos (emolumentform) ALGORITHM=INPLACE LOCK=NONE',
    'SELECT ''idx_pi_emolumentform already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 1h. FULLTEXT on Surname + OtherName
-- NOTE: FULLTEXT cannot use ALGORITHM=INPLACE. It briefly locks writes
-- for a few seconds on 40k rows. Run during off-peak if concerned.
-- After adding, update searchPersonnel to use:
--   MATCH(p.Surname, p.OtherName) AGAINST (? IN BOOLEAN MODE)
SET @idx := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_personalinfos'
      AND INDEX_NAME = 'ft_pi_name'
);
SET @sql := IF(@idx = 0,
    'CREATE FULLTEXT INDEX ft_pi_name ON ef_personalinfos (Surname, OtherName)',
    'SELECT ''ft_pi_name already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;


-- -----------------------------------------------------------------------------
-- SECTION 2 — ef_emolument_forms
-- -----------------------------------------------------------------------------

-- 2a. service_no + ship
SET @idx := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_emolument_forms'
      AND INDEX_NAME = 'idx_ef_service_ship'
);
SET @sql := IF(@idx = 0,
    'CREATE INDEX idx_ef_service_ship ON ef_emolument_forms (service_no, ship) ALGORITHM=INPLACE LOCK=NONE',
    'SELECT ''idx_ef_service_ship already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2b. service_no + form_year
SET @idx := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_emolument_forms'
      AND INDEX_NAME = 'idx_ef_service_year'
);
SET @sql := IF(@idx = 0,
    'CREATE INDEX idx_ef_service_year ON ef_emolument_forms (service_no, form_year) ALGORITHM=INPLACE LOCK=NONE',
    'SELECT ''idx_ef_service_year already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2c. status
SET @idx := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_emolument_forms'
      AND INDEX_NAME = 'idx_ef_status'
);
SET @sql := IF(@idx = 0,
    'CREATE INDEX idx_ef_status ON ef_emolument_forms (status) ALGORITHM=INPLACE LOCK=NONE',
    'SELECT ''idx_ef_status already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2d. service_no + ship + status
SET @idx := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_emolument_forms'
      AND INDEX_NAME = 'idx_ef_service_ship_status'
);
SET @sql := IF(@idx = 0,
    'CREATE INDEX idx_ef_service_ship_status ON ef_emolument_forms (service_no, ship, status) ALGORITHM=INPLACE LOCK=NONE',
    'SELECT ''idx_ef_service_ship_status already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2e. UNIQUE (service_no, form_year)
-- Check for existing duplicates first — this will fail if dupes exist:
--   SELECT service_no, form_year, COUNT(*) AS n
--   FROM ef_emolument_forms GROUP BY service_no, form_year HAVING n > 1;
SET @unique_exists := (
    SELECT COUNT(*) FROM (
        SELECT INDEX_NAME FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_emolument_forms'
          AND NON_UNIQUE = 0
        GROUP BY INDEX_NAME
        HAVING GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'service_no,form_year'
    ) AS tmp
);
SET @sql := IF(@unique_exists = 0,
    'ALTER TABLE ef_emolument_forms ADD CONSTRAINT uq_ef_svcno_year UNIQUE (service_no, form_year)',
    'SELECT ''uq_ef_svcno_year already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;


-- -----------------------------------------------------------------------------
-- SECTION 3 — ef_personalinfoshist
-- -----------------------------------------------------------------------------

-- UNIQUE (serviceNumber, FormYear)
-- Check for existing duplicates first:
--   SELECT serviceNumber, FormYear, COUNT(*) AS n
--   FROM ef_personalinfoshist GROUP BY serviceNumber, FormYear HAVING n > 1;
SET @unique_exists := (
    SELECT COUNT(*) FROM (
        SELECT INDEX_NAME FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_personalinfoshist'
          AND NON_UNIQUE = 0
        GROUP BY INDEX_NAME
        HAVING GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'FormYear,serviceNumber'
    ) AS tmp
);
SET @sql := IF(@unique_exists = 0,
    'ALTER TABLE ef_personalinfoshist ADD CONSTRAINT uq_hist_svcno_year UNIQUE (serviceNumber, FormYear)',
    'SELECT ''uq_hist_svcno_year already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;


-- -----------------------------------------------------------------------------
-- SECTION 4 — ef_form_approvals
-- -----------------------------------------------------------------------------

-- 4a. form_id
SET @idx := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_form_approvals'
      AND INDEX_NAME = 'idx_fa_form_id'
);
SET @sql := IF(@idx = 0,
    'CREATE INDEX idx_fa_form_id ON ef_form_approvals (form_id) ALGORITHM=INPLACE LOCK=NONE',
    'SELECT ''idx_fa_form_id already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4b. performed_by + performed_at
SET @idx := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_form_approvals'
      AND INDEX_NAME = 'idx_fa_performed_by'
);
SET @sql := IF(@idx = 0,
    'CREATE INDEX idx_fa_performed_by ON ef_form_approvals (performed_by, performed_at) ALGORITHM=INPLACE LOCK=NONE',
    'SELECT ''idx_fa_performed_by already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;


-- -----------------------------------------------------------------------------
-- SECTION 5 — ef_audit_logs
-- -----------------------------------------------------------------------------

-- 5a. table_name + action + performed_at
SET @idx := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_audit_logs'
      AND INDEX_NAME = 'idx_al_table_action'
);
SET @sql := IF(@idx = 0,
    'CREATE INDEX idx_al_table_action ON ef_audit_logs (table_name, action, performed_at) ALGORITHM=INPLACE LOCK=NONE',
    'SELECT ''idx_al_table_action already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 5b. performed_by + performed_at
SET @idx := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_audit_logs'
      AND INDEX_NAME = 'idx_al_performed_by'
);
SET @sql := IF(@idx = 0,
    'CREATE INDEX idx_al_performed_by ON ef_audit_logs (performed_by, performed_at) ALGORITHM=INPLACE LOCK=NONE',
    'SELECT ''idx_al_performed_by already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;


-- -----------------------------------------------------------------------------
-- SECTION 6 — child tables
-- -----------------------------------------------------------------------------

-- ef_nok
SET @idx := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_nok'
      AND INDEX_NAME = 'idx_nok_svc'
);
SET @sql := IF(@idx = 0,
    'CREATE INDEX idx_nok_svc ON ef_nok (service_no) ALGORITHM=INPLACE LOCK=NONE',
    'SELECT ''idx_nok_svc already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ef_spouse
SET @idx := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_spouse'
      AND INDEX_NAME = 'idx_spouse_svc'
);
SET @sql := IF(@idx = 0,
    'CREATE INDEX idx_spouse_svc ON ef_spouse (service_no) ALGORITHM=INPLACE LOCK=NONE',
    'SELECT ''idx_spouse_svc already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ef_children
SET @idx := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_children'
      AND INDEX_NAME = 'idx_children_svc'
);
SET @sql := IF(@idx = 0,
    'CREATE INDEX idx_children_svc ON ef_children (service_no) ALGORITHM=INPLACE LOCK=NONE',
    'SELECT ''idx_children_svc already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ef_loans
SET @idx := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_loans'
      AND INDEX_NAME = 'idx_loans_svc'
);
SET @sql := IF(@idx = 0,
    'CREATE INDEX idx_loans_svc ON ef_loans (service_no) ALGORITHM=INPLACE LOCK=NONE',
    'SELECT ''idx_loans_svc already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ef_allowances
SET @idx := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_allowances'
      AND INDEX_NAME = 'idx_allowances_svc'
);
SET @sql := IF(@idx = 0,
    'CREATE INDEX idx_allowances_svc ON ef_allowances (service_no) ALGORITHM=INPLACE LOCK=NONE',
    'SELECT ''idx_allowances_svc already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ef_documents
SET @idx := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_documents'
      AND INDEX_NAME = 'idx_documents_svc'
);
SET @sql := IF(@idx = 0,
    'CREATE INDEX idx_documents_svc ON ef_documents (service_no) ALGORITHM=INPLACE LOCK=NONE',
    'SELECT ''idx_documents_svc already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;


-- -----------------------------------------------------------------------------
-- SECTION 7 — post-migration verification
-- -----------------------------------------------------------------------------

SELECT
    TABLE_NAME,
    INDEX_NAME,
    GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columns,
    INDEX_TYPE,
    NON_UNIQUE
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
      'ef_personalinfos', 'ef_emolument_forms', 'ef_personalinfoshist',
      'ef_form_approvals', 'ef_audit_logs',
      'ef_nok', 'ef_spouse', 'ef_children',
      'ef_loans', 'ef_allowances', 'ef_documents'
  )
GROUP BY TABLE_NAME, INDEX_NAME, INDEX_TYPE, NON_UNIQUE
ORDER BY TABLE_NAME, INDEX_NAME;


-- =============================================================================
-- DOWN
-- =============================================================================

-- Add rollback logic here (reverse of UP)

-- ef_personalinfos
SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_personalinfos' AND INDEX_NAME = 'idx_pi_ship_status');
SET @sql := IF(@idx > 0, 'DROP INDEX idx_pi_ship_status ON ef_personalinfos', 'SELECT ''idx_pi_ship_status not found''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_personalinfos' AND INDEX_NAME = 'idx_pi_ship_status_emol');
SET @sql := IF(@idx > 0, 'DROP INDEX idx_pi_ship_status_emol ON ef_personalinfos', 'SELECT ''idx_pi_ship_status_emol not found''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_personalinfos' AND INDEX_NAME = 'idx_pi_command_status');
SET @sql := IF(@idx > 0, 'DROP INDEX idx_pi_command_status ON ef_personalinfos', 'SELECT ''idx_pi_command_status not found''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_personalinfos' AND INDEX_NAME = 'idx_pi_command_status_emol');
SET @sql := IF(@idx > 0, 'DROP INDEX idx_pi_command_status_emol ON ef_personalinfos', 'SELECT ''idx_pi_command_status_emol not found''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_personalinfos' AND INDEX_NAME = 'idx_pi_payrollclass_status');
SET @sql := IF(@idx > 0, 'DROP INDEX idx_pi_payrollclass_status ON ef_personalinfos', 'SELECT ''idx_pi_payrollclass_status not found''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_personalinfos' AND INDEX_NAME = 'idx_pi_ship_classes_status');
SET @sql := IF(@idx > 0, 'DROP INDEX idx_pi_ship_classes_status ON ef_personalinfos', 'SELECT ''idx_pi_ship_classes_status not found''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_personalinfos' AND INDEX_NAME = 'idx_pi_emolumentform');
SET @sql := IF(@idx > 0, 'DROP INDEX idx_pi_emolumentform ON ef_personalinfos', 'SELECT ''idx_pi_emolumentform not found''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_personalinfos' AND INDEX_NAME = 'ft_pi_name');
SET @sql := IF(@idx > 0, 'DROP INDEX ft_pi_name ON ef_personalinfos', 'SELECT ''ft_pi_name not found''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ef_emolument_forms
SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_emolument_forms' AND INDEX_NAME = 'idx_ef_service_ship');
SET @sql := IF(@idx > 0, 'DROP INDEX idx_ef_service_ship ON ef_emolument_forms', 'SELECT ''idx_ef_service_ship not found''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_emolument_forms' AND INDEX_NAME = 'idx_ef_service_year');
SET @sql := IF(@idx > 0, 'DROP INDEX idx_ef_service_year ON ef_emolument_forms', 'SELECT ''idx_ef_service_year not found''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_emolument_forms' AND INDEX_NAME = 'idx_ef_status');
SET @sql := IF(@idx > 0, 'DROP INDEX idx_ef_status ON ef_emolument_forms', 'SELECT ''idx_ef_status not found''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_emolument_forms' AND INDEX_NAME = 'idx_ef_service_ship_status');
SET @sql := IF(@idx > 0, 'DROP INDEX idx_ef_service_ship_status ON ef_emolument_forms', 'SELECT ''idx_ef_service_ship_status not found''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @index_name := (
    SELECT INDEX_NAME FROM (
        SELECT INDEX_NAME FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_emolument_forms'
          AND NON_UNIQUE = 0
        GROUP BY INDEX_NAME
        HAVING GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'service_no,form_year'
        LIMIT 1
    ) AS tmp
);
SET @sql := IF(@index_name IS NOT NULL,
    CONCAT('ALTER TABLE ef_emolument_forms DROP INDEX ', @index_name),
    'SELECT ''uq_ef_svcno_year not found'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ef_personalinfoshist
SET @index_name := (
    SELECT INDEX_NAME FROM (
        SELECT INDEX_NAME FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_personalinfoshist'
          AND NON_UNIQUE = 0
        GROUP BY INDEX_NAME
        HAVING GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'FormYear,serviceNumber'
        LIMIT 1
    ) AS tmp
);
SET @sql := IF(@index_name IS NOT NULL,
    CONCAT('ALTER TABLE ef_personalinfoshist DROP INDEX ', @index_name),
    'SELECT ''uq_hist_svcno_year not found'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ef_form_approvals
SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_form_approvals' AND INDEX_NAME = 'idx_fa_form_id');
SET @sql := IF(@idx > 0, 'DROP INDEX idx_fa_form_id ON ef_form_approvals', 'SELECT ''idx_fa_form_id not found''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_form_approvals' AND INDEX_NAME = 'idx_fa_performed_by');
SET @sql := IF(@idx > 0, 'DROP INDEX idx_fa_performed_by ON ef_form_approvals', 'SELECT ''idx_fa_performed_by not found''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ef_audit_logs
SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_audit_logs' AND INDEX_NAME = 'idx_al_table_action');
SET @sql := IF(@idx > 0, 'DROP INDEX idx_al_table_action ON ef_audit_logs', 'SELECT ''idx_al_table_action not found''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_audit_logs' AND INDEX_NAME = 'idx_al_performed_by');
SET @sql := IF(@idx > 0, 'DROP INDEX idx_al_performed_by ON ef_audit_logs', 'SELECT ''idx_al_performed_by not found''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- child tables
SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_nok'        AND INDEX_NAME = 'idx_nok_svc');
SET @sql := IF(@idx > 0, 'DROP INDEX idx_nok_svc ON ef_nok',               'SELECT ''idx_nok_svc not found''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_spouse'     AND INDEX_NAME = 'idx_spouse_svc');
SET @sql := IF(@idx > 0, 'DROP INDEX idx_spouse_svc ON ef_spouse',         'SELECT ''idx_spouse_svc not found''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_children'   AND INDEX_NAME = 'idx_children_svc');
SET @sql := IF(@idx > 0, 'DROP INDEX idx_children_svc ON ef_children',     'SELECT ''idx_children_svc not found''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_loans'      AND INDEX_NAME = 'idx_loans_svc');
SET @sql := IF(@idx > 0, 'DROP INDEX idx_loans_svc ON ef_loans',           'SELECT ''idx_loans_svc not found''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_allowances' AND INDEX_NAME = 'idx_allowances_svc');
SET @sql := IF(@idx > 0, 'DROP INDEX idx_allowances_svc ON ef_allowances', 'SELECT ''idx_allowances_svc not found''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ef_documents'  AND INDEX_NAME = 'idx_documents_svc');
SET @sql := IF(@idx > 0, 'DROP INDEX idx_documents_svc ON ef_documents',   'SELECT ''idx_documents_svc not found''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;