-- Migration: py_payded_constraint
-- Created: 2026-02-11T11:17:03.669Z

-- UP
-- Add your schema changes here

START TRANSACTION;

-- ------------------------------------------------
-- 1️⃣ Remove duplicates (keep lowest id)
-- ------------------------------------------------
DELETE t1
FROM py_payded t1
INNER JOIN py_payded t2
  ON t1.Empl_ID = t2.Empl_ID
  AND t1.type = t2.type
  AND t1.datecreated < t2.datecreated;


-- ------------------------------------------------
-- 2️⃣ Check if UNIQUE already exists by columns
-- ------------------------------------------------
SET @unique_exists := (
    SELECT COUNT(*) FROM (
        SELECT index_name
        FROM information_schema.statistics
        WHERE table_schema = DATABASE()
          AND table_name = 'py_payded'
          AND non_unique = 0
        GROUP BY index_name
        HAVING GROUP_CONCAT(column_name ORDER BY seq_in_index)
               = 'Empl_ID,type'
    ) AS tmp
);

-- ------------------------------------------------
-- 3️⃣ Add UNIQUE only if missing
-- ------------------------------------------------
SET @sql := IF(
    @unique_exists = 0,
    'ALTER TABLE py_payded ADD CONSTRAINT uq_emp_type UNIQUE (Empl_ID, type)',
    'SELECT "UNIQUE constraint already exists"'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

COMMIT;

-- DOWN
-- Add rollback logic here (reverse of UP)
SET @index_name := (
    SELECT index_name FROM (
        SELECT index_name
        FROM information_schema.statistics
        WHERE table_schema = DATABASE()
          AND table_name = 'py_payded'
          AND non_unique = 0
        GROUP BY index_name
        HAVING GROUP_CONCAT(column_name ORDER BY seq_in_index)
               = 'Empl_ID,type'
        LIMIT 1
    ) AS tmp
);

SET @sql := IF(
    @index_name IS NOT NULL,
    CONCAT('ALTER TABLE py_payded DROP INDEX ', @index_name),
    'SELECT "No UNIQUE constraint found"'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;