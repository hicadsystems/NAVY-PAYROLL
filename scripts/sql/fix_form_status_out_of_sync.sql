-- =====================================================================
-- Re-sync ef_emolument_forms.status with ef_personalinfos.Status
-- (e.g. NN/3298: personalinfos = 'FO' but form row = 'DRAFT')
--
-- Run against the OFFICERS database.
-- Legacy -> clean mapping (emolument.constants.js):
--   Filled -> SUBMITTED | FO -> DO_REVIEWED | CPO -> FO_APPROVED | Verified -> CPO_CONFIRMED
-- The form row is matched on the year the person submitted for (p.FormYear).
-- =====================================================================

-- 0) Inspect one person: every form row they have
SELECT id, service_no, form_year, status, ship, command, submitted_at, updated_at
FROM ef_emolument_forms
WHERE service_no = 'NN/3298'
ORDER BY form_year, id;

-- 1) PREVIEW — out-of-sync rows that will be fixed
SELECT ef.id AS form_id, ef.service_no, ef.form_year,
       ef.status AS form_status, p.Status AS info_status,
       CASE p.Status
         WHEN 'Filled'   THEN 'SUBMITTED'
         WHEN 'FO'       THEN 'DO_REVIEWED'
         WHEN 'CPO'      THEN 'FO_APPROVED'
         WHEN 'Verified' THEN 'CPO_CONFIRMED'
       END AS new_status,
       p.ship, p.command
FROM ef_emolument_forms ef
JOIN ef_personalinfos p
      ON p.serviceNumber = ef.service_no
     AND ef.form_year    = p.FormYear
WHERE p.Status IN ('Filled','FO','CPO','Verified')
  AND ef.status IN ('DRAFT','SUBMITTED','DO_REVIEWED','FO_APPROVED')
  AND ef.status <> CASE p.Status
         WHEN 'Filled'   THEN 'SUBMITTED'
         WHEN 'FO'       THEN 'DO_REVIEWED'
         WHEN 'CPO'      THEN 'FO_APPROVED'
         WHEN 'Verified' THEN 'CPO_CONFIRMED'
       END
ORDER BY ef.service_no;

-- 1b) REPORT ONLY — in review per personalinfos but NO form row for that year
SELECT p.serviceNumber, p.Status, p.FormYear, p.ship, p.command
FROM ef_personalinfos p
LEFT JOIN ef_emolument_forms ef
       ON ef.service_no = p.serviceNumber
      AND ef.form_year  = p.FormYear
WHERE p.Status IN ('Filled','FO','CPO','Verified')
  AND ef.id IS NULL;

-- 2) UPDATE
START TRANSACTION;

UPDATE ef_emolument_forms ef
JOIN ef_personalinfos p
      ON p.serviceNumber = ef.service_no
     AND ef.form_year    = p.FormYear
SET ef.status       = CASE p.Status
                        WHEN 'Filled'   THEN 'SUBMITTED'
                        WHEN 'FO'       THEN 'DO_REVIEWED'
                        WHEN 'CPO'      THEN 'FO_APPROVED'
                        WHEN 'Verified' THEN 'CPO_CONFIRMED'
                      END,
    ef.submitted_at = COALESCE(ef.submitted_at, p.datecreated, NOW()),
    ef.ship         = COALESCE(NULLIF(TRIM(p.ship), ''), ef.ship),
    ef.command      = COALESCE(NULLIF(TRIM(p.command), ''), ef.command),
    ef.form_number  = COALESCE(ef.form_number, p.formNumber),
    ef.updated_at   = NOW()
WHERE p.Status IN ('Filled','FO','CPO','Verified')
  AND ef.status IN ('DRAFT','SUBMITTED','DO_REVIEWED','FO_APPROVED')
  AND ef.status <> CASE p.Status
         WHEN 'Filled'   THEN 'SUBMITTED'
         WHEN 'FO'       THEN 'DO_REVIEWED'
         WHEN 'CPO'      THEN 'FO_APPROVED'
         WHEN 'Verified' THEN 'CPO_CONFIRMED'
       END;

SELECT ROW_COUNT() AS rows_updated;   -- should equal the preview count

COMMIT;
-- ROLLBACK;   -- use instead of COMMIT if the count is wrong
