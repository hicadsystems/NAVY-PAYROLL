-- @scope: all   (every payroll database)
-- Migration: py_ipis_payhistory_everywhere
-- Created: 2026-10-22T18:45:00.000Z
-- The payslip procedure reads py_ipis_payhistory for every payroll class, so the
-- table must exist in every payroll database even when it is empty (hicaddata5,
-- juniorTrainee, had none). Created with the same structure and primary key as
-- hicaddata.py_ipis_payhistory. Nothing happens where the table already exists.
-- Agreed with Dev A (navy-payslip-sync v0.1.2: py_ipis_payhistory is optional per
-- database in a package; the website keeps the table anyway).

-- =========================
-- UP
-- =========================

SET @has_tbl = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'py_ipis_payhistory');

SET @sql = IF(@has_tbl = 0,
  'CREATE TABLE py_ipis_payhistory LIKE hicaddata.py_ipis_payhistory',
  'SELECT "py_ipis_payhistory already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- =========================
-- DOWN
-- =========================

-- Intentionally does nothing: the table may hold IPPIS rows by the time of a rollback.
SELECT "py_ipis_payhistory is kept";
