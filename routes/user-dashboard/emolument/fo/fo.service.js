/**
 * FILE: routes/user-dashboard/emolument/fo/fo.service.js
 *
 * Business logic for First Officer (FO) approval workflow.
 *
 * FO rules (from old SPs):
 *   Individual approve (UpdatePersonByIdByShipFO):
 *     - Gates on ef_emolument_forms.status = 'DO_REVIEWED'
 *     - Sets fo_name/rank/svcno/date on ef_personalinfos
 *     - Sets ef_personalinfos.Status  = 'CPO'      (legacy)
 *     - Sets ef_emolument_forms.status = 'FO_APPROVED' (clean)
 *
 *   Bulk approve (UpdatePersonByShipFO):
 *     - Filters WHERE Status = 'Filled' AND classes = @classes (old SP exact match)
 *     - One class at a time — Officers OR Ratings, not mixed
 *     - Sets same fo fields on all matching rows
 *     - Writes approval trail for each affected form
 *
 *   Reject:
 *     - Only DO_REVIEWED forms (Status = 'FO')
 *     - Resets both tables to NULL/REJECTED
 *     - Remarks required
 */

"use strict";

const repo = require("./fo.repository");
const { invalidateShipCache } = require("../reports/reports.service");
const {
  FORM_STATUS,
  LEGACY_STATUS,
  toLegacyStatus,
  FO_BULK_FILTER_STATUS,
} = require("../emolument.constants");

// ─────────────────────────────────────────────────────────────
// LIST DO_REVIEWED FORMS
// ─────────────────────────────────────────────────────────────

async function listDoReviewedForms(ship, limit, offset) {
  if (!ship)
    return { success: false, code: 400, message: "Ship name is required." };

  const forms = await repo.getDoReviewedForms(ship, limit, offset);
  return { success: true, data: forms };
}

// ─────────────────────────────────────────────────────────────
// GET FULL FORM
// ─────────────────────────────────────────────────────────────

async function getForm(formId, foShips) {
  const form = await repo.getFormDetail(formId);
  if (!form) {
    return {
      success: false,
      code: 404,
      message: "Form not found or not in DO_REVIEWED status.",
    };
  }

  if (foShips !== "ALL" && !foShips.includes(form.ship)) {
    return {
      success: false,
      code: 403,
      message: "Access denied. This form is not on your assigned ship.",
    };
  }

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
// INDIVIDUAL APPROVE
// fo_svcno always comes from req.user_id
// ─────────────────────────────────────────────────────────────

async function approveForm(formId, foShip, performedBy, ip) {
  const { fo_svcno, fo_name, fo_rank } = performedBy;

  if (!fo_name || !fo_rank) {
    return {
      success: false,
      code: 400,
      message: "fo_name and fo_rank are required.",
    };
  }

  const form = await repo.getFormDetail(formId);
  if (!form) {
    return {
      success: false,
      code: 404,
      message: "Form not found or not in DO_REVIEWED status.",
    };
  }

  if (foShip !== "ALL" && form.ship !== foShip) {
    return {
      success: false,
      code: 403,
      message: "Access denied. This form is not on your assigned ship.",
    };
  }

  // Legacy status for ef_personalinfos
  const legacyStatus = toLegacyStatus(FORM_STATUS.FO_APPROVED); // → 'CPO'

  const updated = await repo.approveSingle(
    form.serviceNumber,
    formId,
    form.ship,
    fo_name,
    fo_rank,
    fo_svcno, // FO's own service number
    legacyStatus,
  );

  if (!updated) {
    return {
      success: false,
      code: 409,
      message:
        "Form could not be approved. It may have already been processed or is not in DO_REVIEWED status.",
    };
  }

  invalidateShipCache(form.ship);

  await repo.insertFormApproval({
    formId: form.form_id,
    action: "FO_APPROVED",
    fromStatus: FORM_STATUS.DO_REVIEWED,
    toStatus: FORM_STATUS.FO_APPROVED,
    performedBy: fo_svcno,
    performerRole: "FO",
    remarks: null,
  });

  await repo.insertAuditLog({
    tableName: "ef_personalinfos",
    action: "UPDATE",
    recordKey: form.serviceNumber,
    oldValues: { Status: LEGACY_STATUS.DO_REVIEWED },
    newValues: {
      Status: legacyStatus,
      fo_name,
      fo_rank,
      fo_svcno,
      fo_date: new Date().toISOString().slice(0, 10), // YYYY-MM-DD
    },
    performedBy: fo_svcno,
    ipAddress: ip,
  });

  return {
    success: true,
    message: "Form approved. Forwarded to CPO.",
    data: {
      formId,
      serviceNumber: form.serviceNumber,
      newStatus: FORM_STATUS.FO_APPROVED,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// BULK APPROVE
// Body: {  selected }
// Matches UpdatePersonByShipFO exactly:
//   WHERE Status = 'Filled' AND ship = @ship AND serviceNumber IN @selected
//
// FO_BULK_FILTER_STATUS = 'Filled' — imported from constants.
// ─────────────────────────────────────────────────────────────

async function approveBulk(ship, body, performedBy, ip) {
  const { selected } = body;
  const { fo_svcno, fo_name, fo_rank } = performedBy;

  if (!selected || !Array.isArray(selected) || selected.length === 0) {
    return {
      success: false,
      code: 400,
      message: "At least one form must be selected for bulk approval.",
    };
  }

  // Legacy status — FO bulk sets 'CPO' on ef_personalinfos
  const legacyStatus = toLegacyStatus(FORM_STATUS.FO_APPROVED); // → 'CPO'

  const { count, serviceNumbers } = await repo.approveBulk(
    ship,
    selected,
    fo_name,
    fo_rank,
    fo_svcno,
    legacyStatus,
  );

  if (count === 0) {
    return {
      success: false,
      code: 404,
      message: `No forms found with Status='${FORM_STATUS.FO_APPROVED}' for ship '${ship}' in ${selected.join(", ")}.`,
    };
  }

  invalidateShipCache(ship);

  // Write approval trail for each affected form
  const formRows = await repo.getFormIdsByServiceNos(serviceNumbers, ship);
  await Promise.all(
    formRows.map((f) =>
      repo.insertFormApproval({
        formId: f.id,
        action: "FO_APPROVED",
        fromStatus: FORM_STATUS.DO_REVIEWED, // bulk came from 'Filled' = SUBMITTED, but for approval trail we show DO_REVIEWED → FO_APPROVED
        toStatus: FORM_STATUS.FO_APPROVED,
        performedBy: fo_svcno,
        performerRole: "FO",
        remarks: `Bulk approval — ship: ${ship} for selected service numbers`,
      }),
    ),
  );

  // Single audit log entry for the bulk operation
  await repo.insertAuditLog({
    tableName: "ef_personalinfos",
    action: "UPDATE",
    recordKey: `BULK:${ship}:serviceNumbers=${selected.join(",")}`,
    oldValues: {
      Status: FORM_STATUS.FO_APPROVED,
      ship,
      serviceNumbers: selected,
    },
    newValues: {
      Status: legacyStatus,
      fo_name,
      fo_rank,
      fo_svcno,
      fo_date: new Date().toISOString().slice(0, 10), // YYYY-MM-DD
      affectedCount: count,
    },
    performedBy: fo_svcno,
    ipAddress: ip,
  });

  return {
    success: true,
    message: `Bulk approval complete. ${count} form(s) approved.`,
    data: {
      ship,
      approved: count,
      newStatus: FORM_STATUS.FO_APPROVED,
      selectedServiceNumbers: selected,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// CLASS APPROVE
// Body: { classes }
// Matches UpdatePersonByShipFO exactly:
//   WHERE Status = 'Filled' AND ship = @ship AND classes = @classes
//
// FO_BULK_FILTER_STATUS = 'Filled' — imported from constants.
// classes: 1 = Officers, 2 = Ratings, 3 = Training
// ─────────────────────────────────────────────────────────────

async function approveClass(ship, body, performedBy, ip) {
  const { classes } = body;
  const { fo_svcno, fo_name, fo_rank } = performedBy;

  if (!fo_name || !fo_rank || !fo_date) {
    return {
      success: false,
      code: 400,
      message: "fo_name, fo_rank, and fo_date are required.",
    };
  }

  if (!classes || ![1, 2, 3].includes(Number(classes))) {
    return {
      success: false,
      code: 400,
      message: "classes must be 1 (Officers), 2 (Ratings), or 3 (Training).",
    };
  }

  // Legacy status — FO bulk sets 'CPO' on ef_personalinfos
  const legacyStatus = toLegacyStatus(FORM_STATUS.FO_APPROVED); // → 'CPO'

  const { count, serviceNumbers } = await repo.approveClass(
    ship,
    Number(classes),
    fo_name,
    fo_rank,
    fo_svcno,
    legacyStatus,
  );

  if (count === 0) {
    return {
      success: false,
      code: 404,
      message: `No forms found with Status='${FORM_STATUS.FO_APPROVED}' for ship '${ship}' and classes=${classes}.`,
    };
  }

  invalidateShipCache(ship);

  // Write approval trail for each affected form
  const formRows = await repo.getFormIdsByServiceNos(serviceNumbers, ship);
  await Promise.all(
    formRows.map((f) =>
      repo.insertFormApproval({
        formId: f.form_id,
        action: "FO_APPROVED",
        fromStatus: FORM_STATUS.DO_REVIEWED, // bulk came from 'Filled' = SUBMITTED, but for approval trail we show DO_REVIEWED → FO_APPROVED
        toStatus: FORM_STATUS.FO_APPROVED,
        performedBy: fo_svcno,
        performerRole: "FO",
        remarks: `Bulk approval — ship: ${ship}, classes: ${classes}`,
      }),
    ),
  );

  // Single audit log entry for the bulk operation
  await repo.insertAuditLog({
    tableName: "ef_personalinfos",
    action: "UPDATE",
    recordKey: `BULK:${ship}:classes=${classes}`,
    oldValues: { Status: FORM_STATUS.FO_APPROVED, ship, classes },
    newValues: {
      Status: legacyStatus,
      fo_name,
      fo_rank,
      fo_svcno,
      fo_date: new Date().toISOString().slice(0, 10), // YYYY-MM-DD
      affectedCount: count,
    },
    performedBy,
    ipAddress: ip,
  });

  return {
    success: true,
    message: `Bulk approval complete. ${count} form(s) approved.`,
    data: {
      ship,
      classes: Number(classes),
      approved: count,
      newStatus: FORM_STATUS.FO_APPROVED,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// REJECT
// Body: { remarks }
// FO can only reject DO_REVIEWED forms (Status = 'FO')
// ─────────────────────────────────────────────────────────────

async function rejectForm(formId, foShip, body, performedBy, ip) {
  const { remarks } = body;
  const { fo_svcno, fo_name, fo_rank } = performedBy;

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
      message: "Form not found or not in DO_REVIEWED status.",
    };
  }

  if (foShip !== "ALL" && form.ship !== foShip) {
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
    fromStatus: FORM_STATUS.DO_REVIEWED,
    toStatus: FORM_STATUS.REJECTED,
    performedBy: fo_svcno,
    performerRole: "FO",
    remarks: remarks.trim(),
  });

  await repo.insertAuditLog({
    tableName: "ef_personalinfos",
    action: "UPDATE",
    recordKey: form.serviceNumber,
    oldValues: { Status: LEGACY_STATUS.DO_REVIEWED },
    newValues: {
      Status: null,
      rejectedBy: fo_svcno,
      remarks: remarks.trim(),
    },
    performedBy: fo_svcno,
    ipAddress: ip,
  });

  const message = `Your emolument form (ID: ${formId}) has been rejected by the Financial Officer (${fo_rank} ${fo_name}).\n\nRemarks: ${remarks.trim()}\n\nPlease re-fill and resubmit the form.`;
  await sendMessage({
    userId: fo_svcno,
    userFullname: fo_name,
    to_user_id: form.serviceNumber,
    subject: "Form Rejected",
    body: message,
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
// LIST APPROVED FORMS
// ─────────────────────────────────────────────────────────────

async function listApprovedForms(ship, svc, limit, offset) {
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

  const forms = await repo.getApprovedForms(ship, svc, limit, offset);

  return { success: true, data: forms };
}

module.exports = {
  listDoReviewedForms,
  listApprovedForms,
  getForm,
  approveForm,
  approveBulk,
  approveClass,
  rejectForm,
  getStatusStats,
};
