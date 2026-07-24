DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_extractrec_optimized`$$

CREATE DEFINER=`root`@`localhost` PROCEDURE `sp_extractrec_optimized`(IN `p_globalcoy` VARCHAR(10) CHARSET utf8mb4, IN `p_windicator` VARCHAR(3) CHARSET utf8mb4, IN `p_wcheck` VARCHAR(3) CHARSET utf8mb4, IN `p_user` VARCHAR(100) CHARSET utf8mb4)
BEGIN
    DECLARE v_start DATETIME DEFAULT NOW();
    DECLARE v_year INT;
    DECLARE v_month INT;
    DECLARE v_cutoff DATE;
    DECLARE v_count INT DEFAULT 0;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        INSERT INTO py_performance_log (
            procedure_name, process_year, process_month, status,
            started_at, completed_at, error_details
        ) VALUES (
            'sp_extractrec_optimized', COALESCE(v_year,0), COALESCE(v_month,0), 'FAILED',
            v_start, NOW(), CONCAT('Exception by ', COALESCE(p_user,''))
        );
        UPDATE py_process_control
        SET status='UPDATE_ERROR', error_message='Extract failed'
        WHERE process_year=v_year AND process_month=v_month;
        RESIGNAL;
    END;

    START TRANSACTION;

    -- Step 1: Determine current payroll period (BT05)
    SELECT COALESCE(ord, YEAR(CURDATE())), COALESCE(mth, MONTH(CURDATE()))
    INTO v_year, v_month
    FROM py_stdrate
    WHERE type COLLATE utf8mb4_unicode_ci = 'BT05' COLLATE utf8mb4_unicode_ci
    LIMIT 1;

    IF v_year IS NULL OR v_month IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'BT05 not configured in py_stdrate';
    END IF;

    -- Cutoff = first day of the current processing month.
    SET v_cutoff = STR_TO_DATE(CONCAT(v_year, LPAD(v_month, 2, '0'), '01'), '%Y%m%d');

    -- NAVY rule: anyone who left on ANY day of the current month must NOT be
    -- extracted. Push the cutoff forward to the first day of NEXT month so that
    -- a DateLeft anywhere inside this month fails the `DateLeft >= v_cutoff`
    -- test below and is excluded. DATE_ADD handles the December -> next-January
    -- (and year) rollover automatically, so no manual month/year arithmetic.
    -- Non-NAVY companies keep the original cutoff (first of this month), i.e.
    -- someone who leaves mid-month is still included for them.
    IF p_globalcoy COLLATE utf8mb4_unicode_ci = 'NAVY' COLLATE utf8mb4_unicode_ci THEN
        SET v_cutoff = DATE_ADD(v_cutoff, INTERVAL 1 MONTH);
    END IF;

    -- Step 2: Clear working employee table
    TRUNCATE TABLE py_wkemployees;

    -- Step 3: Extract eligible employees
    INSERT INTO py_wkemployees (
        Empl_ID, Surname, OtherName, Title, TITLEDESC, Sex, JobClass, Jobtitle, MaritalStatus,
        Factory, Location, Birthdate, DateEmpl, DateLeft,
        TELEPHONE, HOMEADDR, nok_name, Bankcode, bankbranch, BankACNumber, InternalACNo,
        StateofOrigin, LocalGovt, TaxCode, NSITFcode, NHFcode, seniorno, command, nok_addr,
        Language1, Fluency1, Language2, Fluency2, Language3, Fluency3, Country, Height, Weight,
        BloodGroup, Genotype, entry_mode, Status, datepmted, dateconfirmed, taxed, gradelevel,
        gradetype, entitlement, town, createdby, datecreated, nok_relation, specialisation,
        accomm_type, qual_allow, sp_qual_allow, rent_subsidy, instruction_allow, command_allow,
        award, payrollclass, taxstate, gsm_number
    )
    SELECT
        e.Empl_ID, e.Surname, e.OtherName, e.Title, e.TITLEDESC, e.Sex, e.JobClass, e.Jobtitle, e.MaritalStatus,
        e.Factory, e.Location, e.Birthdate, e.DateEmpl, e.DateLeft,
        e.TELEPHONE, e.HOMEADDR, e.nok_name, e.Bankcode, e.bankbranch, e.BankACNumber, e.InternalACNo,
        e.StateofOrigin, e.LocalGovt, e.TaxCode, e.NSITFcode, e.NHFcode, e.seniorno, e.command, e.nok_addr,
        e.Language1, e.Fluency1, e.Language2, e.Fluency2, e.Language3, e.Fluency3, e.Country, e.Height, e.Weight,
        e.BloodGroup, e.Genotype, e.entry_mode, e.Status, e.datepmted, e.dateconfirmed, e.taxed, e.gradelevel,
        e.gradetype, e.entitlement, e.town, p_user, NOW(), e.nok_relation, e.specialisation,
        e.accomm_type, e.qual_allow, e.sp_qual_allow, e.rent_subsidy, e.instruction_allow, e.command_allow,
        e.award, e.payrollclass, e.state, e.gsm_number
    FROM hicaddata.hr_employees e
    WHERE e.payrollclass COLLATE utf8mb4_unicode_ci = p_windicator COLLATE utf8mb4_unicode_ci
      AND (
            e.DateLeft IS NULL
         OR e.DateLeft COLLATE utf8mb4_unicode_ci = ''
         OR (
                CASE
                    WHEN e.DateLeft LIKE '%-%' THEN STR_TO_DATE(e.DateLeft, '%Y-%m-%d')
                    WHEN LENGTH(e.DateLeft) = 8 THEN STR_TO_DATE(e.DateLeft, '%Y%m%d')
                    ELSE '2099-12-31'
                END
                >= v_cutoff
             )
          )
      AND (
          p_globalcoy COLLATE utf8mb4_unicode_ci <> 'NAVY' COLLATE utf8mb4_unicode_ci
          OR (e.emolumentform COLLATE utf8mb4_unicode_ci = 'Yes' COLLATE utf8mb4_unicode_ci)
      );

    SET v_count = ROW_COUNT();

    -- Step 4: Update control and log
    INSERT INTO py_process_control (
        process_year, process_month, status, phase, started_by, started_date
    ) VALUES (
        v_year, v_month, 'EXTRACTED', 'EXTRACTION', p_user, NOW()
    )
    ON DUPLICATE KEY UPDATE
        status='EXTRACTED', phase='EXTRACTION', started_by=p_user, started_date=NOW();

    INSERT INTO py_performance_log (
        procedure_name, process_year, process_month, records_processed,
        execution_time_ms, started_at, completed_at, status
    )
    VALUES (
        'sp_extractrec_optimized',
        v_year, v_month, v_count,
        TIMESTAMPDIFF(MICROSECOND, v_start, NOW())/1000,
        v_start, NOW(), 'SUCCESS'
    );

    COMMIT;

    SELECT 'SUCCESS' AS status, v_year AS process_year, v_month AS process_month, v_count AS records_extracted;
END$$

DELIMITER ;
