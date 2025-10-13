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