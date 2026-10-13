-- !! NOT NEEDED: ef_emolument_forms already has UNIQUE(service_no, form_year) (uq_form_person_year). Do not run. !!
-- =====================================================================
-- Duplicate ef_emolument_forms rows per (service_no, form_year)
-- Cause: ON DUPLICATE KEY upserts with no UNIQUE(service_no, form_year)
-- -> submit inserted a 2nd row; the original stayed DRAFT (e.g. 13294).
-- Run against the OFFICERS database. Run BEFORE fix_form_status_out_of_sync.sql.
-- =====================================================================

-- 0) Confirm for NN/3298 and check the key
SELECT id, service_no, form_year, status, submitted_at, updated_at
FROM ef_emolument_forms WHERE service_no = 'NN/3298' ORDER BY id;
SHOW INDEX FROM ef_emolument_forms;

-- 1) PREVIEW: duplicate groups
SELECT service_no, form_year, COUNT(*) AS n_rows,
       GROUP_CONCAT(CONCAT(id, ':', status) ORDER BY id) AS rows_
FROM ef_emolument_forms
GROUP BY service_no, form_year
HAVING COUNT(*) > 1;

-- 2) Pick the row to KEEP per group: most advanced status, newest id.
DROP TEMPORARY TABLE IF EXISTS tmp_keep;
CREATE TEMPORARY TABLE tmp_keep AS
SELECT service_no, form_year, id AS keep_id
FROM (
  SELECT ef.*,
         ROW_NUMBER() OVER (
           PARTITION BY service_no, form_year
           ORDER BY FIELD(status,'SYNCED','CPO_CONFIRMED','FO_APPROVED',
                                 'DO_REVIEWED','SUBMITTED','REJECTED','DRAFT'),
                    id DESC) AS rn
  FROM ef_emolument_forms ef
) t
WHERE rn = 1
  AND (service_no, form_year) IN (
        SELECT service_no, form_year FROM ef_emolument_forms
        GROUP BY service_no, form_year HAVING COUNT(*) > 1);

DROP TEMPORARY TABLE IF EXISTS tmp_drop;
CREATE TEMPORARY TABLE tmp_drop AS
SELECT ef.id AS drop_id, k.keep_id
FROM ef_emolument_forms ef
JOIN tmp_keep k ON k.service_no = ef.service_no AND k.form_year = ef.form_year
WHERE ef.id <> k.keep_id;

SELECT * FROM tmp_drop;   -- review

-- 3) Re-point child rows, then delete the duplicates
START TRANSACTION;

UPDATE ef_form_approvals a  JOIN tmp_drop d ON a.form_id = d.drop_id SET a.form_id = d.keep_id;
UPDATE ef_form_rejections r JOIN tmp_drop d ON r.form_id = d.drop_id SET r.form_id = d.keep_id;

DELETE ef FROM ef_emolument_forms ef JOIN tmp_drop d ON ef.id = d.drop_id;
SELECT ROW_COUNT() AS rows_deleted;   -- should equal COUNT(*) of tmp_drop

COMMIT;
-- ROLLBACK;

-- 4) Prevent it happening again (run after step 3 succeeds)
ALTER TABLE ef_emolument_forms
  ADD UNIQUE KEY uq_ef_service_year (service_no, form_year);
