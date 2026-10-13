-- =====================================================================
-- Sync ship / command on SUBMITTED emolument forms from ef_personalinfos
--
-- Run against the OFFICERS database (DB_OFFICERS / config.databases.officers),
-- where ef_emolument_forms and ef_personalinfos live.
--
-- Only rows where:
--   * ef_emolument_forms.status = 'SUBMITTED'
--   * personalinfos ship AND command are both NOT NULL (and not blank)
--   * the form's ship or command differs from personalinfos
--     (<=> is NULL-safe, so a NULL ship/command on the form also counts)
-- =====================================================================

-- 1) PREVIEW — what will change
SELECT
    ef.id            AS form_id,
    ef.service_no,
    ef.ship          AS form_ship,
    p.ship           AS info_ship,
    ef.command       AS form_command,
    p.command        AS info_command,
    ef.submitted_at
FROM ef_emolument_forms ef
JOIN ef_personalinfos p
      ON p.serviceNumber = ef.service_no
WHERE ef.status = 'SUBMITTED'
  AND p.ship    IS NOT NULL AND TRIM(p.ship)    <> ''
  AND p.command IS NOT NULL AND TRIM(p.command) <> ''
  AND (   NOT (ef.ship    <=> p.ship)
       OR NOT (ef.command <=> p.command))
ORDER BY p.ship, ef.service_no;

-- 2) UPDATE
START TRANSACTION;

UPDATE ef_emolument_forms ef
JOIN ef_personalinfos p
      ON p.serviceNumber = ef.service_no
SET ef.ship       = p.ship,
    ef.command    = p.command,
    ef.updated_at = NOW()
WHERE ef.status = 'SUBMITTED'
  AND p.ship    IS NOT NULL AND TRIM(p.ship)    <> ''
  AND p.command IS NOT NULL AND TRIM(p.command) <> ''
  AND (   NOT (ef.ship    <=> p.ship)
       OR NOT (ef.command <=> p.command));

SELECT ROW_COUNT() AS rows_updated;

-- 3) VERIFY — should return 0
SELECT COUNT(*) AS remaining_mismatches
FROM ef_emolument_forms ef
JOIN ef_personalinfos p
      ON p.serviceNumber = ef.service_no
WHERE ef.status = 'SUBMITTED'
  AND p.ship    IS NOT NULL AND TRIM(p.ship)    <> ''
  AND p.command IS NOT NULL AND TRIM(p.command) <> ''
  AND (   NOT (ef.ship    <=> p.ship)
       OR NOT (ef.command <=> p.command));

-- If rows_updated matches the preview and remaining_mismatches = 0:
COMMIT;
-- otherwise:
-- ROLLBACK;
