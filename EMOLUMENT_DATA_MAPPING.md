# Annual Data Collection Form — UI Label → Backend Variable Mapping

> Reference document for mapping HTML form labels to backend payload variables.
>
> Structure is based on the `prefillFields()` and `buildBody()` functions.

---

# 1. Passport Photographs

| UI Label                    | HTML ID / Component | Backend Variable               |
| --------------------------- | ------------------- | ------------------------------ |
| Personnel Passport Photo    | `preview-passport`  | `documents.passport.url`       |
| Next of Kin Photo           | `preview-nok`       | `documents.nokPassport.url`    |
| Alternate Next of Kin Photo | `preview-altnok`    | `documents.altNokPassport.url` |

---

# 2. Personal Information

| UI Label                              | HTML ID         | Backend Variable |
| ------------------------------------- | --------------- | ---------------- |
| Surname                               | `Surname`       | `Surname`        |
| Other Names                           | `OtherName`     | `OtherName`      |
| Rank / Title                          | `Rank`          | `Rank`           |
| Service Number                        | `serviceNumber` | `serviceNumber`  |
| NIN                                   | `NIN`           | `NIN`            |
| Marital Status                        | `MaritalStatus` | `MaritalStatus`  |
| Date of Birth                         | `Birthdate`     | `Birthdate`      |
| Religion                              | `religion`      | `religion`       |
| Phone (Primary)                       | `gsm_number`    | `gsm_number`     |
| Phone (Secondary)                     | `gsm_number2`   | `gsm_number2`    |
| Email Address                         | `email`         | `email`          |
| Home Address                          | `home_address`  | `home_address`   |
| State of Origin                       | `StateofOrigin` | `StateofOrigin`  |
| LGA of Origin                         | `LocalGovt`     | `LocalGovt`      |
| Qualification *(hidden / deprecated)* | `qualification` | `qualification`  |

---

# 3. Next of Kin (NOK)

## 3.1 Primary NOK

| UI Label     | HTML ID                    | Backend Variable           |
| ------------ | -------------------------- | -------------------------- |
| Full Name    | `nok_primary_full_name`    | `nok.primary.full_name`    |
| Relationship | `nok_primary_relationship` | `nok.primary.relationship` |
| National ID  | `nok_primary_national_id`  | `nok.primary.national_id`  |
| Phone 1      | `nok_primary_phone1`       | `nok.primary.phone1`       |
| Phone 2      | `nok_primary_phone2`       | `nok.primary.phone2`       |
| Email        | `nok_primary_email`        | `nok.primary.email`        |
| Address      | `nok_primary_address`      | `nok.primary.address`      |

## 3.2 Alternate NOK

| UI Label     | HTML ID                | Backend Variable             |
| ------------ | ---------------------- | ---------------------------- |
| Full Name    | `nok_alt_full_name`    | `nok.alternate.full_name`    |
| Relationship | `nok_alt_relationship` | `nok.alternate.relationship` |
| National ID  | `nok_alt_national_id`  | `nok.alternate.national_id`  |
| Phone 1      | `nok_alt_phone1`       | `nok.alternate.phone1`       |
| Phone 2      | `nok_alt_phone2`       | `nok.alternate.phone2`       |
| Email        | `nok_alt_email`        | `nok.alternate.email`        |
| Address      | `nok_alt_address`      | `nok.alternate.address`      |

---

# 4. Spouse & Children

## 4.1 Spouse

| UI Label  | HTML ID        | Backend Variable   |
| --------- | -------------- | ------------------ |
| Full Name | `sp_full_name` | `spouse.full_name` |
| Phone 1   | `sp_phone1`    | `spouse.phone1`    |
| Phone 2   | `sp_phone2`    | `spouse.phone2`    |
| Email     | `sp_email`     | `spouse.email`     |

## 4.2 Children

| UI Label | HTML ID   | Backend Variable         |
| -------- | --------- | ------------------------ |
| Child 1  | `child_1` | `children[0].child_name` |
| Child 2  | `child_2` | `children[1].child_name` |
| Child 3  | `child_3` | `children[2].child_name` |
| Child 4  | `child_4` | `children[3].child_name` |

---

# 5. Service Details

| UI Label                                   | HTML ID          | Backend Variable |
| ------------------------------------------ | ---------------- | ---------------- |
| Date of Enlistment                         | `DateEmpl`       | `DateEmpl`       |
| Seniority Date                             | `seniorityDate`  | `seniorityDate`  |
| Date of Commissioning                      | `advanceDate`    | `advanceDate`    |
| Run-Out Date                               | `runoutDate`     | `runoutDate`     |
| Command                                    | `command`        | `command`        |
| Branch                                     | `branch`         | `branch`         |
| Ship / Unit                                | `ship`           | `ship`           |
| Specialisation                             | `specialisation` | `specialisation` |
| Type Of Commissioning                      | `entry_mode`     | `entry_mode`     |
| Appointment / Entitlement *(Officer Only)* | `entitlement`    | `entitlement`    |
| Division *(Officer Only)*                  | `division`       | `division`       |
| Nature Of Appointment *(Officer Only)*     | `confirmedBy`    | `confirmedBy`    |

## Hidden / Deprecated Service Fields

| UI Label                                             | HTML ID      | Backend Variable             |
| ---------------------------------------------------- | ------------ | ---------------------------- |
| Grade Level                                          | `gradelevel` | `gradelevel`                 |
| Tax Code                                             | `TaxCode`    | `TaxCode`                    |
| Taxed                                                | `taxed`      | `taxed`                      |
| Expiration Of Engagement Date *(No Active UI Field)* | —            | `expirationOfEngagementDate` |

---

# 6. Bank & Financial Details

| UI Label                            | HTML ID        | Backend Variable |
| ----------------------------------- | -------------- | ---------------- |
| Account Number                      | `BankACNumber` | `BankACNumber`   |
| Bank                                | `Bankcode`     | `Bankcode`       |
| Account Name                        | `AccountName`  | `AccountName`    |
| Bank Branch *(hidden / deprecated)* | `bankbranch`   | `bankbranch`     |
| PFA Code *(hidden / deprecated)*    | `pfacode`      | `pfacode`        |
| NSITF Code *(hidden / deprecated)*  | `NSITFcode`    | `NSITFcode`      |
| NHF Code *(hidden / deprecated)*    | `NHFcode`      | `NHFcode`        |

---

# 7. Accommodation

| UI Label                           | HTML ID                 | Backend Variable        |
| ---------------------------------- | ----------------------- | ----------------------- |
| Accommodation Status               | `AcommodationStatus`    | `AcommodationStatus`    |
| Address of Accommodation           | `AddressofAcommodation` | `AddressofAcommodation` |
| GBC *(hidden / deprecated)*        | `GBC`                   | `GBC`                   |
| GBC Number *(hidden / deprecated)* | `GBC_Number`            | `GBC_Number`            |

---

# 8. Allowances

## 8.1 Allowance Payload Structure

```json
allowances: {
  KEY: {
    is_active: boolean,
    specify: string | null,
    gcb_number: string | null
  }
}
```

## 8.2 Shared Allowance Fields

| Purpose                     | Backend Variable            |
| --------------------------- | --------------------------- |
| Active Status               | `allowances[KEY].is_active` |
| Other Allowance Description | `allowances.OTHER.specify`  |
| GCB Number                  | `allowances.GCB.gcb_number` |

## 8.3 OFFICER Allowances

| Allowance Label          | Key              |
| ------------------------ | ---------------- |
| Aircrew Allowance        | `AIRCREW`        |
| Pilot Allowance          | `PILOT`          |
| Shift Duty Allowance     | `SHIFT_DUTY`     |
| Hazard Allowance         | `HAZARD`         |
| Rent Subsidy             | `RENT_SUBSIDY`   |
| SBS Allowance            | `SBC`            |
| Special Forces Allowance | `SPECIAL_FORCES` |
| Other Allowance          | `OTHER`          |

## 8.4 RATING Allowances

| Allowance Label          | Key              |
| ------------------------ | ---------------- |
| Aircrew Allowance        | `AIRCREW`        |
| Shift Duty Allowance     | `SHIFT_DUTY`     |
| Call Duty Allowance      | `CALL_DUTY`      |
| Hazard Allowance         | `HAZARD`         |
| Rent Subsidy             | `RENT_SUBSIDY`   |
| SBC Allowance            | `SBC`            |
| Special Forces Allowance | `SPECIAL_FORCES` |
| Other Allowance          | `OTHER`          |
| GCB Allowance            | `GCB`            |

## 8.5 TRAINING Allowances

| Allowance Label      | Key            |
| -------------------- | -------------- |
| Aircrew Allowance    | `AIRCREW`      |
| Shift Duty Allowance | `SHIFT_DUTY`   |
| Hazard Allowance     | `HAZARD`       |
| Rent Subsidy         | `RENT_SUBSIDY` |
| SBC Allowance        | `SBC`          |
| Other Allowance      | `OTHER`        |

---

# 9. Loans

## 9.1 Loan Payload Structure

```json
loans: {
  KEY: {
    amount: number | null,
    year_taken: string | null,
    tenor: number | null,
    balance: number | null,
    specify: string | null
  }
}
```

## 9.2 Loan Field Mapping

| UI Label                  | Backend Variable        |
| ------------------------- | ----------------------- |
| Amount                    | `loans[KEY].amount`     |
| Year Taken                | `loans[KEY].year_taken` |
| Tenor                     | `loans[KEY].tenor`      |
| Balance                   | `loans[KEY].balance`    |
| Specify (Other Loan Only) | `loans.OTHER.specify`   |

## 9.3 Loan Types

| Loan Label     | Key       |
| -------------- | --------- |
| FGSHLS Loan    | `FGSHLS`  |
| Car Loan       | `CAR`     |
| Welfare Loan   | `WELFARE` |
| NNMCS Loan     | `NNNCS`   |
| NNMFBL Loan    | `NNMFBL`  |
| PPCFS Loan     | `PPCFS`   |
| Any Other Loan | `OTHER`   |

---

# Officer vs NCO / Rating Notes

## Officer-only Fields

These fields are only displayed when:

```js
formType === 'OFFICER'
```

Fields:

* `entitlement`
* `division`
* `confirmedBy`
* `entry_mode`

## Rating-specific Allowance

Only Ratings include:

* `GCB`

## Recommended NCO / Rating Export Exclusions

If generating a simplified NCO mapping document, consider excluding:

* Appointment / Entitlement
* Division
* Nature Of Appointment
* Type Of Commissioning
* Pilot Allowance

---

# Backend Payload Overview

```json
{
  core: {},
  nok: {
    primary: {},
    alternate: {}
  },
  spouse: {},
  children: [],
  loans: {},
  allowances: {}
}
```
