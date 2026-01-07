┌─────────────────────────────────────────────────────────────┐
│                    FULL PAYROLL CYCLE                       │
└─────────────────────────────────────────────────────────────┘

═══════════════════════════════════════════════════════════════
PHASE 1: DATA ENTRY (Throughout the Month)
═══════════════════════════════════════════════════════════════

1. MASTER TABLES (Source of Truth)
   ├─ py_payded (Empl_id, type) - PK
   │  ├─ User adds/modifies deductions
   │  ├─ mak1='No' → Active, mak1='Yes' → Inactive
   │  ├─ amtp = Total amount payable
   │  ├─ amttd = Amount to date (cumulative)
   │  └─ nomth = Months remaining
   │
   ├─ py_overtime (Empl_id, type) - Overtime hours
   ├─ py_operative (Empl_id, type) - Operative work hours
   └─ py_header (Empl_id) - Employee payroll header info

═══════════════════════════════════════════════════════════════
PHASE 2: BACKUP (Before Calculation)
═══════════════════════════════════════════════════════════════

2. BACKUP PROCESS (py_calc_backup)
   ├─ DROP/CREATE backup tables:
   │  ├─ py_bakinppayded ← py_payded
   │  ├─ py_bakinpover ← py_overtime
   │  ├─ py_bakinpoperative ← py_operative
   │  ├─ py_bakinpheader ← py_header
   │  ├─ py_bakstdrate ← py_stdrate
   │  ├─ py_b4kmaspayded ← py_masterpayded
   │  ├─ py_b4kmascum ← py_mastercum
   │  └─ py_bakelement ← py_elementtype
   └─ Purpose: Allow ROLLBACK if calculation fails

═══════════════════════════════════════════════════════════════
PHASE 3: PAYROLL CALCULATION (Month-End Day 1)
═══════════════════════════════════════════════════════════════

3. EXTRACT EMPLOYEES (py_extractrec)
   ├─ Filters active employees based on:
   │  ├─ payrollclass (Officers vs Men)
   │  ├─ dateleft is null or > current period
   │  └─ emolumentform='Yes' (for NAVY)
   └─ Creates: py_wkemployees (working table)

4. UPDATE PAYROLL FILES (py_update_payrollfiles)
   ├─ py_updatepayroll_00: Create missing records
   │  └─ For all bpay='Yes' elements, ensure records exist
   │
   ├─ py_updatepayroll_02: Transfer py_payded → py_masterpayded
   │  ├─ Reads py_payded (user entries)
   │  ├─ Writes to py_masterpayded (calculation table)
   │  └─ Archives to py_inputhistory (audit trail)
   │
   ├─ py_updatepayroll_05: Salary scale calculations
   │  ├─ Reads py_salaryscale (salary matrix)
   │  ├─ Calculates based on grade + step + years
   │  └─ Updates py_masterpayded.amtthismth
   │
   ├─ py_updatepayroll_01: Overtime/hourly calculations
   │  ├─ Reads py_overtime, py_operative
   │  ├─ Calculates hours × rates
   │  └─ Updates py_masterpayded + py_masterover
   │
   ├─ py_updatepayroll_03: Transfer cumulative data
   │  ├─ Reads py_cumulated (tax cards)
   │  └─ Writes to py_mastercum (previous month)
   │
   └─ py_updatepayroll_04: Dependent calculations
       ├─ perc='P' (Percentage): X% of another payment
       ├─ perc='D' (Division): X divided by Y
       ├─ perc='S' (Standard): Fixed amount
       └─ perc='R' (Rank-based): From py_payperrank

5. MAIN CALCULATION (py_calc_pay → py_calculate_01)
   ├─ FOR EACH EMPLOYEE:
   │  ├─ Reads py_masterpayded (all payment types)
   │  ├─ Calculates:
   │  │  ├─ Payments (BP*, PT*, FP*)
   │  │  ├─ Deductions (PR*, PL*)
   │  │  ├─ Loans (payindic='L')
   │  │  ├─ Tax (py_calculate_tax)
   │  │  └─ Net Pay
   │  └─ Writes to py_mastercum (employee totals)
   │
   └─ CRITICAL CALCULATION LOGIC:
      ├─ payindic='L' (Loan): 
      │  └─ thismth = (amtp × kmth / nmth) + (loan × std / 1200)
      │     [installment + interest]
      │
      ├─ payindic='T' (Temporary):
      │  └─ thismth = (amtp × kmth / nmth) + hisvar
      │
      ├─ payindic='P' (Permanent):
      │  └─ thismth = (amtp / 12) + (amtp × noofmth / 264)
      │
      └─ payindic='X' (Independent):
         └─ thismth = (amtp / 12) + (amtp × noofmth / 264)

6. RECONCILIATION (py_calculate_02)
   ├─ Creates py_tempsumm (summary by location/factory)
   └─ Aggregates payments/deductions for reports

═══════════════════════════════════════════════════════════════
PHASE 4: REVIEW & APPROVAL (Month-End Day 2-3)
═══════════════════════════════════════════════════════════════

7. GENERATE PAYSLIPS (py_collate_payslip)
   ├─ Reads py_masterpayded + py_mastercum
   ├─ Formats for display
   └─ Writes to py_webpayslip (for web viewing)

8. HUMAN REVIEW
   ├─ HR/Payroll Manager reviews reports
   ├─ Checks totals, anomalies
   └─ THIS IS THE "APPROVAL" STEP!

9. IF ISSUES FOUND → RESTORE (py_calc_restore)
   ├─ DROP py_masterpayded, py_mastercum, etc.
   ├─ RESTORE from backup tables
   └─ Fix data, re-run calculation

═══════════════════════════════════════════════════════════════
PHASE 5: MONTH-END PROCESSING (After Approval)
═══════════════════════════════════════════════════════════════

10. MONTH-END UPDATE (py_py37Monthend)
    ├─ FOR EACH DEDUCTION in py_masterpayded:
    │  ├─ Archive to py_payhistory (12-column structure)
    │  │  └─ Updates: amtthismth1-12, totamtpayable1-12, etc.
    │  │
    │  └─ UPDATE py_payded (master table):
    │     ├─ amttd = amttd + amtp (cumulative)
    │     ├─ nomth = nomth - 1 (decrement)
    │     └─ IF nomth = 0 THEN mak1 = 'Yes' (auto-complete)
    │
    └─ Archives net pay to py_payhistory (type='PY01')

═══════════════════════════════════════════════════════════════
PHASE 6: PAYMENT & COMMUNICATION
═══════════════════════════════════════════════════════════════

11. GENERATE BANK FILES
    └─ Export net pay to banks

12. SMS NOTIFICATIONS (py_SendPaySMS)
    ├─ Reads py_mastercum.his_netmth
    ├─ Creates messages with net pay amount
    └─ Inserts into fl_pendingSMS

13. IPPIS INTEGRATION (py_pullippis_payments)
    └─ Stores IPPIS payments to py_ipis_payhistory
```

## **KEY TABLES & THEIR ROLES**
```
┌─────────────────────────────────────────────────────────────┐
│                    TABLE ARCHITECTURE                       │
└─────────────────────────────────────────────────────────────┘

INPUT TABLES (User Entry):
├─ py_payded → Master deductions (persistent)
├─ py_overtime → Monthly overtime hours
├─ py_operative → Operative work hours
└─ py_header → Employee adjustments

WORKING TABLES (Cleared/Rebuilt Monthly):
├─ py_wkemployees → Active employees for this cycle
├─ py_masterpayded → Calculated payments/deductions
├─ py_mastercum → Employee monthly totals (tax, net)
├─ py_masterover → Overtime calculations
└─ py_masterope → Operative calculations

HISTORY TABLES (Permanent Archive):
├─ py_payhistory → 12-column structure (NIGHTMARE!)
│  └─ amtthismth1, amtthismth2...amtthismth12
├─ py_inputhistory → Input audit trail
└─ py_ipis_payhistory → IPPIS integration data

BACKUP TABLES (Rollback Safety):
├─ py_bakinppayded, py_bakmaspayded
├─ py_b4kmaspayded, py_b4kmascum
└─ 8+ backup tables total

CONFIGURATION TABLES:
├─ py_elementtype → Payment/deduction definitions
├─ py_salaryscale → Salary matrices
├─ py_payperrank → Rank-based amounts
├─ py_tax → Tax brackets
└─ py_stdrate → System settings (BT05 = current month)



CRITICAL INSIGHTS
1. The "Approval" is NOT a database field:
-- There's NO approval_status column!
-- Approval happens by:
A. Backup data (py_calc_backup)
B. Run calculation (py_calc_pay)
C. Human reviews reports
D. IF OK → Run month-end (py_py37Monthend)
E. IF NOT OK → Restore (py_calc_restore) & repeat


2. py_masterpayded is TEMPORARY:
-- Gets cleared and rebuilt EVERY month!
-- NOT persistent storage
-- Just a calculation workspace


3. The 12-Column Horror:
-- py_payhistory has 120+ columns!
-- amtthismth1, amtthismth2...amtthismth12
-- totamtpayable1, totamtpayable2...totamtpayable12
-- IMPOSSIBLE to query "show me all January data"


-- ============================================
-- OPTIMIZED PAYROLL SYSTEM FOR 100K+ USERS
-- Hybrid: Keeps VB flow, adds speed optimizations
-- Target: 10-100x faster processing
-- ============================================

-- ============================================
-- STEP 1: OPTIMIZE EXISTING TABLE STRUCTURES
-- ============================================

-- Add critical indexes to existing tables
CREATE INDEX idx_payded_active ON py_payded(mak1, mak2) WHERE mak1='No';
CREATE INDEX idx_payded_empl_type ON py_payded(Empl_id, type, mak1);
CREATE INDEX idx_masterpayded_empl ON py_masterpayded(his_empno, his_type);
CREATE INDEX idx_masterpayded_calc ON py_masterpayded(his_empno) WHERE amtthismth > 0;
CREATE INDEX idx_mastercum_period ON py_mastercum(his_type, his_empno);
CREATE INDEX idx_wkemployees_class ON py_wkemployees(payrollclass, empl_id);

-- Partitioning for py_payhistory_v2 (optional but recommended)
-- CREATE INDEX idx_history_partition ON py_payhistory_v2(process_year, process_month, empl_id);

