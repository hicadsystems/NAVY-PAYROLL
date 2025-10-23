1. DAILY/ONGOING TABLES (Source - Need to exist):
   ├─ py_masterpayded  → Stores current payments/deductions
   └─ py_mastercum     → Stores cumulative net pay

2. MONTH-END PROCESSING (Runs monthly):
   ├─ Reads from: py_masterpayded & py_mastercum
   └─ Writes to: py_payment_history & py_netpay_summary

3. HISTORICAL TABLES (Destination - We created these):
   ├─ py_payment_history     → Historical payment records
   ├─ py_netpay_summary      → Historical net pay
   └─ py_monthend_processing_log → Processing audit trail

┌────────────────────────────┐
│   py_masterpayded          │
│  (raw monthly payments)    │
└──────────┬─────────────────┘
           │
           ▼
  INSERT → py_payment_history
           │
           ▼
  JOIN → py_mastercum → py_netpay_summary
           │
           ▼
     Calculate totals
           │
           ▼
  COMMIT → py_monthend_processing_log (status=COMPLETED)

Error Handling Example

If a table is missing, or a key constraint fails:

MySQL triggers the SQLEXCEPTION handler.

ROLLBACK undoes everything (no partial saves).

Log row is updated to FAILED.

p_status and p_message return failure text to Node.js.

🧠 In plain English

“When you click Process Month-End, this procedure:”

Starts a new log entry as RUNNING.

Copies all active payments & deductions from py_masterpayded → py_payment_history.

Copies net pay from py_mastercum → py_netpay_summary.

Calculates totals (gross, allowances, deductions).

Commits everything.

Updates the log as COMPLETED with performance stats.

If any part fails, rolls everything back and marks FAILED.

🧮 Step-by-step Derivation

Your stored procedure writes to two main tables:

Table	Role	Contains
py_payment_history	Detailed line-by-line breakdown	Each allowance, pay item, or deduction (PY, AL, DED, etc.)
py_netpay_summary	One record per employee per month	Computed totals (gross pay, total allowances, total deductions, net pay)
① py_payment_history – All individual pay components

Each row here represents one earning or deduction item.

For example, for employee EMP001 in October 2025, it could look like:

payment_type	amount_this_month	meaning
PY_BASIC	150000	Basic Pay
AL_TRANSPORT	30000	Allowance
AL_HOUSING	40000	Allowance
DED_TAX	25000	Deduction
DED_PFUND	10000	Deduction

All these together make up gross pay, allowances, and deductions.

② py_netpay_summary – Computed totals per employee

Later in the procedure, this table is updated with these computed fields:

UPDATE py_netpay_summary ns
SET 
    gross_this_month = (SUM of PY + AL),
    total_allowances = (SUM of AL),
    total_deductions = (SUM of DED)
WHERE year = p_year AND month = p_month;


and originally inserted with:

net_this_month, net_to_date


copied from py_mastercum.

So each employee’s record for a month in py_netpay_summary will look like:

empno	gross_this_month	total_allowances	total_deductions	net_this_month	bank_account_number
EMP001	220000	70000	35000	185000	0123456789
✅ So the final amount received (take-home pay) is:
👉 net_this_month
Formula (in logical terms):
net_this_month = gross_this_month - total_deductions


where:

gross_this_month = (Sum of all PY + AL payment_history)
total_deductions  = (Sum of all DED payment_history)


In your procedure, net_this_month is originally sourced from py_mastercum.his_netmth —
meaning it’s already pre-calculated at the time of processing payroll,
and then cross-verified with the totals computed later.

🔗 Summary of Data Flow
Step	Table	Purpose	Key Field for Final Pay
1	py_masterpayded	Base data of payments/deductions	→ used for gross & deductions
2	py_payment_history	Historical record of all items	—
3	py_mastercum	Holds precomputed net pay (his_netmth)	→ inserted into net_this_month
4	py_netpay_summary	Summary for month-end (per employee)	✅ net_this_month = final received amount
🏦 Example End Result

For October 2025 — employee EMP001 might have this record:

Field	Value
gross_this_month	220,000
total_allowances	70,000
total_deductions	35,000
net_this_month (take-home)	185,000
bank_code	GTB
bank_branch	Surulere
bank_account_number	0123456789
payment_status	PROCESSED
💡 In simple words:

The final amount received by an employee after month-end processing is stored in
py_netpay_summary.net_this_month,
which represents their net salary (take-home pay) for that month.

// Payded workflow
1. Select Employee Name (dropdown/search)
   → Auto-populates Service No
```

### **Step 2: Payment/Deduction Setup**
```
2. Select Description (dropdown)
   - Shows existing payment/deduction codes
   - Example: "2ND WELFARE LOAN ../PL/322"
   
3. Select Indicator (dropdown)
   - Options: F, H, L, P, T, X (from py_payind table)
   - Determines payment type/behavior
```

### **Step 3: Annual Payable Configuration**
```
4. Delete Maker (dropdown: Yes/No)
   - Default: "No" (active)
   - "Yes" = mark for deletion/deactivation
   
5. Amount Payable (input field)
   - IF Delete Maker = "No" → Enter deduction amount
   - IF Delete Maker = "Yes" → Set to 0 (auto or manual)
   - This amount deducts per pay period
```

### **Step 4: Cumulative Tracking (Usually Auto-calculated)**
```
6. Delete Maker (display/readonly?)
   - Shows status: "Yes" or "No"
   
7. Amount To Date (calculated/readonly)
   - Auto-calculates: SUM of all previous Amount Payable
   - Preserved even when Delete Maker = "Yes"
```

### **Step 5: Action Buttons**
```
8. Click appropriate button:
   - Add: Save new payment/deduction
   - Modify: Edit existing record
   - Update: Save changes
   - Delete: Remove record (after approval?)
   - Select: Query/view records
   - Close: Exit form

┌─────────────────────────────────────────────────────────┐
│              MONTHLY PAYROLL CYCLE                      │
└─────────────────────────────────────────────────────────┘

STEP 1: DATA ENTRY (Throughout the Month)
├─ Users add/modify deductions
├─ mak1 = 'No' → Active deduction
├─ mak1 = 'Yes' → Inactive/Stop deduction
└─ All entries go directly into py_payded

STEP 2: PAYROLL CALCULATION (Month End)
├─ System reads ONLY records where mak1 = 'No'
├─ Calculates total deductions per employee
├─ Generates payslips
└─ THIS IS THE "APPROVAL" STEP
    (Running payroll = implicit approval)

STEP 3: MONTH END PROCESSING (After Payroll Approval)
├─ Updates py_payded:
│   ├─ amttd = amttd + amtp (add monthly amount to total)
│   ├─ amtad = amtad + amtp (track cumulative)
│   ├─ nomth = nomth - 1 (decrease remaining months)
│   └─ IF nomth = 0 THEN mak1 = 'Yes' (auto-stop)
└─ This locks in the deductions for that month


// There's NO separate approval workflow
// The approval happens when you:
1. Review payroll calculations
2. Approve/Run payroll for the month
3. Month-end processing updates py_payded

// So the workflow is:
Entry → Review in Payroll → Approve Payroll → Process Updates
```

## **What Does `mak2` Do?**

Looking at the field names and VB pattern:
```
┌─────────────────────────────────────────────────────────┐
│         UNDERSTANDING mak1 vs mak2                      |    
└─────────────────────────────────────────────────────────┘

mak1 (Delete Maker Annual) - Controls CURRENT MONTH
├─ 'No' = Active, will be processed THIS month
├─ 'Yes' = Inactive, SKIP this month
└─ Controls: amtp (Amount Payable this period)

mak2 (Delete Maker Cumulative) - Controls HISTORY/CUMULATIVE
├─ 'No' = Keep cumulative history
├─ 'Yes' = Stop tracking cumulative (rare)
└─ Controls: amttd (Amount To Date cumulative)

TYPICAL SCENARIOS:

Scenario 1: Normal Active Deduction
mak1 = 'No', mak2 = 'No'
→ Deduct this month, track cumulative

Scenario 2: Temporarily Stop (1 month)
mak1 = 'Yes', mak2 = 'No'
→ Skip this month, but keep history
→ Can reactivate next month

Scenario 3: Permanently Stop
mak1 = 'Yes', mak2 = 'Yes'
→ Stop processing, freeze history
→ Mark as "completed" or "cancelled"

Scenario 4: End of Loan
nomth = 0 → mak1 = 'Yes', mak2 stays 'No'
→ Loan completed, preserve history

-- BEGINNING OF MONTH (Day 1-25: Data Entry Period)
-- Users can add/edit/delete deductions
INSERT INTO py_payded VALUES (..., mak1='No', amtp=5000, amttd=0, nomth=12);

-- MONTH END (Day 26-30: Payroll Processing)

-- STEP 1: Generate Payroll (READ ONLY)
SELECT Empl_id, SUM(amtp) as total_deductions
FROM py_payded
WHERE mak1 = 'No'  -- Only active deductions
GROUP BY Empl_id;

-- STEP 2: Review & Approve Payroll
-- (Human reviews the payroll report)
-- If approved, proceed to Step 3

-- STEP 3: Month-End Processing (UPDATE py_payded)
UPDATE py_payded
SET 
    amttd = amttd + amtp,           -- Add to cumulative
    amtad = amtad + amtp,           -- Add to already deducted
    nomth = CASE 
        WHEN nomth > 0 THEN nomth - 1 
        ELSE 0 
    END,
    mak1 = CASE 
        WHEN nomth <= 1 THEN 'Yes'  -- Auto-stop when done
        ELSE mak1 
    END
WHERE mak1 = 'No'                   -- Only active records
  AND mak2 = 'No';                  -- Only tracking cumulative

-- Records with mak2 = 'Yes' are NOT updated (frozen)
```

## **Real-World Example:**
```
JANUARY:
Employee NN/001 - Welfare Loan
├─ amt = 60,000 (total loan)
├─ amtp = 5,000 (monthly payment)
├─ nomth = 12 (months remaining)
├─ mak1 = 'No' (active)
├─ mak2 = 'No' (tracking)
├─ amttd = 0 (nothing paid yet)
└─ amtad = 0

MONTH-END JANUARY PROCESSING:
├─ Payroll deducts 5,000
└─ UPDATE: amttd = 5,000, nomth = 11, amtad = 5,000

FEBRUARY:
├─ Employee requests to pause loan (hardship)
├─ Admin sets: mak1 = 'Yes'
└─ Payroll skips this deduction (no update)

MARCH:
├─ Employee resumes loan
├─ Admin sets: mak1 = 'No'
├─ Payroll deducts 5,000 again
└─ UPDATE: amttd = 10,000, nomth = 10, amtad = 10,000

DECEMBER (12th payment):
├─ Before: nomth = 1, amttd = 55,000
├─ Payroll deducts final 5,000
└─ UPDATE: nomth = 0, amttd = 60,000, mak1 = 'Yes' (AUTO)
    (Loan completed!)

LATER:
├─ To hide completed loans from reports:
└─ Admin sets: mak2 = 'Yes' (freeze/archive)

// NO separate approval table needed!
// The workflow:

1. Data Entry (anytime)
   └─ Add/Edit py_payded directly

2. Payroll Calculation (month-end)
   └─ Read py_payded WHERE mak1='No'
   └─ Generate payroll report
   └─ HUMAN REVIEWS THIS REPORT (This is the approval!)

3. After Approval, Run Month-End Processing
   └─ Update py_payded (add to cumulative, decrease months)
   └─ This "locks in" the deductions for history

4. Next Month
   └─ Repeat cycle