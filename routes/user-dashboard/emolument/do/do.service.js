/**
 * FILE: routes/user-dashboard/emolument/do/do.service.js
 *
 * Business logic for DO review workflow.
 *
 * DO rules (from old SPs):
 *   - Individual review only — no bulk
 *   - Can only act on forms WHERE Status = 'Filled' (SUBMITTED)
 *   - Sets div_off_name/rank/svcno/date on ef_personalinfos
 *   - Sets ef_personalinfos.Status = 'FO'      (legacy)
 *   - Sets ef_emolument_forms.status = 'DO_REVIEWED' (clean)
 *   - Rejection resets Status = NULL on both tables
 */

"use strict";

const repo = require("./do.repository");
const {
  FORM_STATUS,
  LEGACY_STATUS,
  toLegacyStatus,
} = require("../emolument.constants");

// ─────────────────────────────────────────────────────────────
// LIST SUBMITTED FORMS
// ─────────────────────────────────────────────────────────────

async function listSubmittedForms(ship, limit, offset) {
  if (!ship)
    return { success: false, code: 400, message: "Ship name is required." };

  const forms = await repo.getSubmittedForms(ship, limit, offset);
  return { success: true, data: forms };
}

// ─────────────────────────────────────────────────────────────
// GET FULL FORM — for DO to view before reviewing
// ─────────────────────────────────────────────────────────────

async function getForm(formId, doShips) {
  const form = await repo.getFormDetail(formId);
  if (!form) {
    return {
      success: false,
      code: 404,
      message: "Form not found or not in SUBMITTED status.",
    };
  }

  // Verify DO is scoped to this form's ship
  // doShips comes from req.emolRoles filtered for DO — EMOL_ADMIN passes all
  if (doShips !== "ALL" && !doShips.includes(form.ship)) {
    return {
      success: false,
      code: 403,
      message: "Access denied. This form is not on your assigned ship.",
    };
  }

  // Fetch child data in parallel
  const [nok, spouse, children, loans, allowances, documents] =
    await Promise.all([
      repo.getNok(form.serviceNumber),
      repo.getSpouse(form.serviceNumber),
      repo.getChildren(form.serviceNumber),
      repo.getLoans(form.serviceNumber),
      repo.getAllowances(form.serviceNumber),
      repo.getDocuments(form.serviceNumber),
    ]);

  return {
    success: true,
    data: {
      ...form,
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
    },
  };
}

// ─────────────────────────────────────────────────────────────
// REVIEW — DO marks form reviewed
// Body: { do_name, do_rank, do_date }
// do_svcno comes from req.user_id (the DO themselves)
// ─────────────────────────────────────────────────────────────

async function reviewForm(formId, doShip, performedBy, ip) {
  const { do_name, do_rank, do_svcno } = performedBy;

  if (!do_name || !do_rank || !do_svcno) {
    return {
      success: false,
      code: 400,
      message: "do_name, do_rank, and do_svcno are required.",
    };
  }

  // Fetch form to validate it is SUBMITTED and on the correct ship
  const form = await repo.getFormDetail(formId);
  if (!form) {
    return {
      success: false,
      code: 404,
      message: "Form not found or not in SUBMITTED status.",
    };
  }

  if (doShip !== "ALL" && form.ship !== doShip) {
    return {
      success: false,
      code: 403,
      message: "Access denied. This form is not on your assigned ship.",
    };
  }

  // Legacy status to write to ef_personalinfos
  const legacyStatus = toLegacyStatus(FORM_STATUS.DO_REVIEWED); // → 'FO'

  const updated = await repo.markDoReviewed(
    form.serviceNumber,
    formId,
    do_name,
    do_rank,
    do_svcno, // DO's own service number
    legacyStatus,
  );

  if (!updated) {
    return {
      success: false,
      code: 409,
      message:
        "Form could not be reviewed. It may have already been processed or is not in SUBMITTED status.",
    };
  }

  // Approval trail
  await repo.insertFormApproval({
    formId: form.form_id,
    action: "DO_REVIEWED",
    fromStatus: FORM_STATUS.SUBMITTED,
    toStatus: FORM_STATUS.DO_REVIEWED,
    performedBy: do_svcno,
    performerRole: "DO",
    remarks: null,
  });

  await repo.insertAuditLog({
    tableName: "ef_personalinfos",
    action: "UPDATE",
    recordKey: form.serviceNumber,
    oldValues: { Status: LEGACY_STATUS.SUBMITTED },
    newValues: {
      Status: legacyStatus,
      div_off_name: do_name,
      div_off_rank: do_rank,
      div_off_svcno: do_svcno,
      div_off_date: new Date().toISOString().slice(0, 10), // YYYY-MM-DD
    },
    performedBy: do_svcno,
    ipAddress: ip,
  });

  return {
    success: true,
    message: `Form reviewed successfully. Forwarded to FO.`,
    data: {
      formId,
      serviceNumber: form.serviceNumber,
      newStatus: FORM_STATUS.DO_REVIEWED,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// REJECT — DO rejects form, resets to NULL
// Body: { remarks }
// ─────────────────────────────────────────────────────────────

async function rejectForm(formId, doShip, body, performedBy, ip) {
  const { remarks } = body;
  const { do_svcno } = performedBy; // Only need svcno for performedBy in this case, but can expand if needed
  if (!remarks || !remarks.trim()) {
    return {
      success: false,
      code: 400,
      message: "Rejection reason (remarks) is required.",
    };
  }

  const form = await repo.getFormDetail(formId);
  if (!form) {
    return {
      success: false,
      code: 404,
      message: "Form not found or not in SUBMITTED status.",
    };
  }

  if (doShip !== "ALL" && form.ship !== doShip) {
    return {
      success: false,
      code: 403,
      message: "Access denied. This form is not on your assigned ship.",
    };
  }

  const reset = await repo.rejectForm(form.serviceNumber, formId, form.ship);
  if (!reset) {
    return {
      success: false,
      code: 409,
      message:
        "Form could not be rejected. It may have already been processed.",
    };
  }

  await repo.insertFormApproval({
    formId: form.form_id,
    action: "REJECTED",
    fromStatus: FORM_STATUS.SUBMITTED,
    toStatus: FORM_STATUS.REJECTED,
    performedBy: do_svcno,
    performerRole: "DO",
    remarks: remarks.trim(),
  });

  await repo.insertAuditLog({
    tableName: "ef_personalinfos",
    action: "UPDATE",
    recordKey: form.serviceNumber,
    oldValues: { Status: LEGACY_STATUS.SUBMITTED },
    newValues: {
      Status: null,
      rejectedBy: do_svcno,
      remarks: remarks.trim(),
    },
    performedBy: do_svcno,
    ipAddress: ip,
  });

  return {
    success: true,
    message: "Form rejected. Personnel will need to re-fill and resubmit.",
    data: {
      formId,
      serviceNumber: form.serviceNumber,
      newStatus: FORM_STATUS.REJECTED,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// STATUS STATS — for DO dashboard summary
// ─────────────────────────────────────────────────────────────

async function getStatusStats(ship, svc) {
  if (!ship)
    return { success: false, code: 400, message: "Ship name is required." };
  if (!svc)
    return {
      success: false,
      code: 400,
      message: "Service number is required.",
    };

  const stats = await repo.getStatusStats(ship, svc);
  return { success: true, data: stats };
}

// ─────────────────────────────────────────────────────────────
// LIST REVIEWED FORMS
// ─────────────────────────────────────────────────────────────

async function listReviewedForms(ship, svc, limit, offset) {
  if (!ship)
    return { success: false, code: 400, message: "Ship name is required." };
  if (!svc)
    return {
      success: false,
      code: 400,
      message: "Service number is required.",
    };
  if (!limit || !Number.isInteger(limit) || limit < 1) {
    return { success: false, code: 400, message: "Valid limit is required." };
  }
  if (offset === undefined || offset < 0) {
    return { success: false, code: 400, message: "Valid offset is required." };
  }

  const forms = await repo.getReviewedForms(ship, svc, limit, offset);

  return { success: true, data: forms };
}

module.exports = {
  listSubmittedForms,
  listReviewedForms,
  getForm,
  reviewForm,
  rejectForm,
  getStatusStats,
};
