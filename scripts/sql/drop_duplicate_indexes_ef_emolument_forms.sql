-- =====================================================================
-- Drop redundant indexes on ef_emolument_forms (OFFICERS database)
--
-- Kept:
--   PRIMARY (id)
--   uq_form_person_year          (service_no, form_year)   UNIQUE
--   idx_form_status              (status)
--   idx_form_ship                (ship)
--   idx_form_command             (command)
--   idx_form_year                (form_year)
--   idx_ef_service_ship_status   (service_no, ship, status)
--
-- Dropped (each is identical to, or a left-prefix of, a kept index):
--   uq_ef_svcno_year     = uq_form_person_year
--   idx_ef_service_year  = uq_form_person_year
--   idx_form_svcno       ⊂ uq_form_person_year / idx_ef_service_ship_status
--   idx_ef_service_ship  ⊂ idx_ef_service_ship_status
--   idx_ef_status        = idx_form_status
--
-- If a FOREIGN KEY uses service_no, MySQL can still use the kept
-- uq_form_person_year / idx_ef_service_ship_status, so the drop is allowed.
-- =====================================================================

-- Before
SHOW INDEX FROM ef_emolument_forms;

ALTER TABLE ef_emolument_forms
  DROP INDEX uq_ef_svcno_year,
  DROP INDEX idx_ef_service_year,
  DROP INDEX idx_form_svcno,
  DROP INDEX idx_ef_service_ship,
  DROP INDEX idx_ef_status,
  ALGORITHM = INPLACE, LOCK = NONE;

-- After
SHOW INDEX FROM ef_emolument_forms;

-- ---------------------------------------------------------------------
-- ROLLBACK (recreate if ever needed)
-- ALTER TABLE ef_emolument_forms
--   ADD UNIQUE KEY uq_ef_svcno_year (service_no, form_year),
--   ADD INDEX idx_ef_service_year  (service_no, form_year),
--   ADD INDEX idx_form_svcno       (service_no),
--   ADD INDEX idx_ef_service_ship  (service_no, ship),
--   ADD INDEX idx_ef_status        (status);
-- ---------------------------------------------------------------------
