/**
 * FILE: routes/user-dashboard/emolument/form/form.service.js
 *
 * Business logic for emolument form lifecycle.
 */

"use strict";

const pool = require("../../../../config/db");
const repo = require("./form.repository");
const {
  FORM_STATUS,
  VALID_LOAN_TYPES,
  VALID_ALLOW_TYPES,
  toLegacyStatus,
  toFormStatus,
  resolveFormType,
  resolveFormNoColumn,
} = require("../emolument.constants");

const controlService = require("../system/system.service");

// ─────────────────────────────────────────────────────────────
// GCB MAPPING
// The frontend sends GCB inside allowances.GCB, but it is stored on
// ef_personalinfos as GBC / GBC_Number. Move it into body.core and
// remove it from allowances so it isn't inserted into ef_allowances.
// ─────────────────────────────────────────────────────────────

function mapGcb(body) {
  const gcb = body?.allowances?.GCB;
  if (gcb) {
    body.core = body.core || {};
    body.core.GBC = gcb.is_active ? 1 : null; // adjust if your column type differs
    body.core.GBC_Number = gcb.is_active ? gcb.gcb_number || null : null;
    delete body.allowances.GCB;
  }
  return body;
}

// ─────────────────────────────────────────────────────────────
// GATE CHECK
// ─────────────────────────────────────────────────────────────

async function checkFormEligibility(person) {
  const formType = resolveFormType(person.payrollclass);

  const { isOpen } = await controlService.resolveEffectiveStatus(
    person.ship || "All",
    formType,
  );

  if (!isOpen) {
    return {
      allowed: false,
      reason:
        "The emolument form collection is currently closed for your ship/unit.",
    };
  }

  if (person.emolumentform === "Yes") {
    return {
      allowed: false,
      reason: "Your form has already been completed and confirmed.",
    };
  }

  const currentFormStatus = toFormStatus(person.Status);
  if (currentFormStatus !== FORM_STATUS.DRAFT) {
    return {
      allowed: false,
      reason: `Your form is currently under review (status: ${person.Status ?? "submitted"}). You cannot edit it at this stage.`,
    };
  }

  return { allowed: true, reason: null };
}

// ─────────────────────────────────────────────────────────────
// LOAD FORM
// ─────────────────────────────────────────────────────────────

async function loadForm(serviceNo) {
  let person = await repo.getPersonCore(serviceNo);

  // ── First-timer path ─────────────────────────────────────
  if (!person) {
    const hrEmp = await repo.getFromHrEmployees(serviceNo);

    if (!hrEmp) {
      // Either not in hr_employees at all, or already confirmed (emolumentform='Yes')
      return {
        success: false,
        code: 404,
        message: "Personnel record not found or form already completed.",
      };
    }

    // Create the bare ef_personalinfos row from hr_employees data
    await repo.initPersonnelFromHr(hrEmp);

    person = await repo.getPersonCore(serviceNo);
    if (!person) {
      return {
        success: false,
        code: 500,
        message:
          "Failed to initialise personnel record. Contact administrator.",
      };
    }
  }

  const formType = resolveFormType(person.payrollclass);
  const isTraining = formType === "TRAINING";

  const [core, nok, spouse, children, loans, allowances, documents, formYear] =
    await Promise.all([
      repo.loadPersonCore(serviceNo),
      repo.loadNok(serviceNo),
      repo.loadSpouse(serviceNo),
      repo.loadChildren(serviceNo),
      repo.loadLoans(serviceNo),
      repo.loadAllowances(serviceNo),
      repo.loadDocuments(serviceNo),
      repo.getProcessingYear(isTraining),
    ]);

  if (!core)
    return {
      success: false,
      code: 404,
      message: "Personnel record not found.",
    };

  const eligibility = await checkFormEligibility(person);
  const currentFormStatus = toFormStatus(person.Status);

  let formId = core.formId;
  if (formYear && currentFormStatus === FORM_STATUS.DRAFT) {
    formId = await repo.initDraftForm(
      serviceNo,
      formYear,
      person.payrollclass,
      person.ship,
      person.command,
    );
  }

  return {
    success: true,
    data: {
      ...core,
      formId,
      formStatus: currentFormStatus,
      nok,
      spouse,
      children,
      loans,
      allowances,
      documents: {
        passport: documents["PASSPORT"] || null,
        nokPassport: documents["NOK_PASSPORT"] || null,
        altNokPassport: documents["ALT_NOK_PASSPORT"] || null,
      },
      formYear,
      formType,
      canEdit: eligibility.allowed,
      editBlocked: eligibility.reason,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// LOAD FORM OPTIONS
// ─────────────────────────────────────────────────────────────

async function loadFormOptions() {
  const options = await repo.getFormOptions();

  return {
    success: true,
    data: options,
    message: "Options Retrieved Successfully",
  };
}

// ─────────────────────────────────────────────────────────────
// LOAD HISTORICAL FORM
// ─────────────────────────────────────────────────────────────

async function loadFormHistory(serviceNo, year) {
  const formData = await repo.loadHistoricalForm(serviceNo, year);
  if (!formData) {
    return {
      success: false,
      code: 404,
      message: `No confirmed form found for year ${year}.`,
    };
  }

  return {
    success: true,
    data: formData,
    notice: formData.hasSnapshot
      ? null
      : "Full form data not available for this year. Only confirmation metadata is shown.",
  };
}

// ─────────────────────────────────────────────────────────────
// SAVE DRAFT
// ─────────────────────────────────────────────────────────────

async function saveDraft(serviceNo, body, performedBy, ip) {
  const person = await repo.getPersonCore(serviceNo);
  if (!person)
    return {
      success: false,
      code: 404,
      message: "Personnel record not found.",
    };

  const eligibility = await checkFormEligibility(person);
  if (!eligibility.allowed)
    return { success: false, code: 403, message: eligibility.reason };

  mapGcb(body);

  await repo.savePersonCore(serviceNo, body.core || {});
  await repo.saveNok(serviceNo, body.nok?.primary, body.nok?.alternate);
  await repo.saveSpouse(serviceNo, body.spouse);
  await repo.saveChildren(serviceNo, body.children);
  await repo.saveLoans(serviceNo, body.loans, VALID_LOAN_TYPES);
  await repo.saveAllowances(serviceNo, body.allowances, VALID_ALLOW_TYPES);

  await repo.insertAuditLog({
    tableName: "ef_personalinfos",
    action: "UPDATE",
    recordKey: serviceNo,
    oldValues: null,
    newValues: { action: "DRAFT_SAVED" },
    performedBy,
    ipAddress: ip,
  });

  return { success: true, message: "Draft saved successfully." };
}

// ─────────────────────────────────────────────────────────────
// SUBMIT FORM
// ─────────────────────────────────────────────────────────────

async function submitForm(serviceNo, body, performedBy, ip) {
  const person = await repo.getPersonCore(serviceNo);
  if (!person)
    return {
      success: false,
      code: 404,
      message: "Personnel record not found.",
    };

  const eligibility = await checkFormEligibility(person);
  if (!eligibility.allowed)
    return { success: false, code: 403, message: eligibility.reason };

  const formType = resolveFormType(person.payrollclass);
  const isTraining = formType === "TRAINING";
  const formYear = await repo.getProcessingYear(isTraining);

  if (!formYear) {
    return {
      success: false,
      code: 500,
      message: "Processing year not configured. Contact administrator.",
    };
  }

  mapGcb(body);

  const formNoCol = resolveFormNoColumn(person.payrollclass);
  const formNumber = await repo.getCurrentFormNumber(formNoCol);

  const legacyStatus = toLegacyStatus(FORM_STATUS.SUBMITTED); // → 'Filled'
  const formStatus = FORM_STATUS.SUBMITTED;

  // ── Atomic write — everything rolls back on any failure ───
  try {
    await pool.smartTransaction(async (conn) => {
      return repo.submitAllTables(
        conn,
        serviceNo,
        body,
        String(formNumber),
        formYear,
        legacyStatus,
        VALID_LOAN_TYPES,
        VALID_ALLOW_TYPES,
      );
    });
  } catch (err) {
    if (err.message === "ALREADY_SUBMITTED") {
      return {
        success: false,
        code: 409,
        message:
          "Form could not be submitted. It may already be in review or completed.",
      };
    }
    console.error("❌ submitForm transaction failed:", err.message);
    return {
      success: false,
      code: 500,
      message: "Form submission failed. Please try again.",
    };
  }
  // ── Transaction committed ─────────────────────────────────

  await repo.upsertEmolumentForm(
    serviceNo,
    formYear,
    String(formNumber),
    person.payrollclass,
    person.ship,
    person.command,
    formStatus,
  );

  const formId = await repo.getEmolumentFormId(serviceNo, formYear);

  await repo.incrementFormNumber(formNoCol);

  if (formId) {
    await repo.insertFormApproval({
      formId,
      action: "SUBMITTED",
      fromStatus: null,
      toStatus: formStatus,
      performedBy,
      performerRole: "PERSONNEL",
      remarks: null,
    });
  }

  await repo.insertAuditLog({
    tableName: "ef_personalinfos",
    action: "UPDATE",
    recordKey: serviceNo,
    oldValues: { Status: null },
    newValues: {
      Status: legacyStatus,
      formNumber: String(formNumber),
      FormYear: formYear,
    },
    performedBy,
    ipAddress: ip,
  });

  return {
    success: true,
    message: "Form submitted successfully.",
    data: { formNumber: String(formNumber), formYear, status: formStatus },
  };
}

// ─────────────────────────────────────────────────────────────
// OPEN NEW CYCLE
// NOTE: repo.archiveAndResetCycle is not defined in form.repository.js.
// Add it there (or import it from where it lives) before using this.
// ─────────────────────────────────────────────────────────────

async function openNewCycle(previousYear, performedBy, ip) {
  if (!previousYear || !/^\d{4}$/.test(String(previousYear))) {
    return {
      success: false,
      code: 400,
      message: "previousYear must be a 4-digit year.",
    };
  }

  const resetCount = await repo.archiveAndResetCycle(
    String(previousYear),
    performedBy,
  );

  await repo.insertAuditLog({
    tableName: "ef_personalinfos",
    action: "UPDATE",
    recordKey: `NEW_CYCLE:prev=${previousYear}`,
    oldValues: { Status: "various", FormYear: previousYear },
    newValues: { Status: null, FormYear: null, resetCount },
    performedBy,
    ipAddress: ip,
  });

  return {
    success: true,
    message: `New cycle opened. ${resetCount} personnel record(s) archived and reset for year ${previousYear}.`,
    data: { previousYear, resetCount },
  };
}

module.exports = {
  loadForm,
  loadFormHistory,
  saveDraft,
  submitForm,
  loadFormOptions,
  openNewCycle,
};
