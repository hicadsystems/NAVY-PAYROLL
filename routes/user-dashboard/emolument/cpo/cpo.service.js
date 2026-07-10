/**
 * FILE: routes/user-dashboard/emolument/cpo/cpo.service.js
 *
 * Business logic for CPO confirmation workflow.
 *
 * CPO rules (from old UpdatePayroll SP):
 *   - Individual confirm only — no bulk
 *   - Gates on ef_personalinfos.Status = 'CPO' (legacy FO_APPROVED)
 *   - Sets emolumentform = 'Yes', exittype = 'Yes', Status = 'Verified'
 *   - Sets hod_svcno = CPO's own service number (confirming officer)
 *   - Writes full JSON snapshot to ef_emolument_forms.snapshot
 *     (fixes the old hardcoded WHERE Id=332 bug)
 *   - Copies record into ef_personalinfoshist (year-on-year archive)
 *   - Rejection resets both tables to NULL/REJECTED
 *
 * Snapshot includes all form data at the moment of confirmation:
 * core, nok, spouse, children, loans, allowances, documents.
 * This snapshot is the permanent record of what was confirmed.
 */

"use strict";

const repo = require("./cpo.repository");
const { invalidateCommandCache } = require("../reports/reports.service");
const {
  FORM_STATUS,
  LEGACY_STATUS,
  toLegacyStatus,
} = require("../emolument.constants");

// ─────────────────────────────────────────────────────────────
// LIST FO_APPROVED FORMS — scoped to CPO's command
// ─────────────────────────────────────────────────────────────

async function listFoApprovedForms(command, limit, offset, search) {
  if (!command)
    return { success: false, code: 400, message: "Command is required." };

  const forms = await repo.getFoApprovedForms(command, limit, offset, search);
  return { success: true, data: forms };
}

// ─────────────────────────────────────────────────────────────
// GET FULL FORM — for CPO to view before confirming
// ─────────────────────────────────────────────────────────────

async function getForm(formId, cpoCommands) {
  const form = await repo.getFormDetail(formId);
  if (!form) {
    return {
      success: false,
      code: 404,
      message: "Form not found or not in FO_APPROVED status.",
    };
  }

  // Scope check — CPO scoped to command
  if (cpoCommands !== "ALL" && !cpoCommands.includes(form.command)) {
    return {
      success: false,
      code: 403,
      message: "Access denied. This form is not under your command.",
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
// CONFIRM FORM
// CPO's service number always comes from req.user_id.
// Snapshot is built from live data at confirm time.
// ─────────────────────────────────────────────────────────────

async function confirmForm(formId, cpoCommand, performedBy, ip) {
  const form = await repo.getFormDetail(formId);
  const { cpo_svcno, cpo_name, cpo_rank } = performedBy;
  if (!form) {
    return {
      success: false,
      code: 404,
      message: "Form not found or not in FO_APPROVED status.",
    };
  }

  if (cpoCommand !== "ALL" && form.command !== cpoCommand) {
    return {
      success: false,
      code: 403,
      message: "Access denied. This form is not under your command.",
    };
  }

  // Build full snapshot from live data at confirm time
  // This is the permanent record — all child tables included
  const [nok, spouse, children, loans, allowances, documents] =
    await Promise.all([
      repo.getNok(form.serviceNumber),
      repo.getSpouse(form.serviceNumber),
      repo.getChildren(form.serviceNumber),
      repo.getLoans(form.serviceNumber),
      repo.getAllowances(form.serviceNumber),
      repo.getDocuments(form.serviceNumber),
    ]);

  const snapshot = {
    confirmedAt: new Date().toISOString(),
    confirmedBy: cpo_svcno,
    core: form,
    nok,
    spouse,
    children,
    loans,
    allowances,
    documents,
  };

  // Legacy status for ef_personalinfos
  const legacyStatus = toLegacyStatus(FORM_STATUS.CPO_CONFIRMED); // → 'Verified'

  const confirmed = await repo.confirmFormWithHistory(
    form.serviceNumber,
    formId,
    form.command,
    cpo_svcno,
    cpo_rank,
    cpo_name,
    legacyStatus,
    snapshot,
    form.FormYear, // ← new param — was passed to insertHistoryRecord before
  );

  if (!confirmed) {
    return {
      success: false,
      code: 409,
      message:
        "Form could not be confirmed. It may have already been confirmed or is not in FO_APPROVED status.",
    };
  }

  invalidateCommandCache(form.command);

  // Write to history archive (ef_personalinfoshist)
  // await repo.insertHistoryRecord(form.serviceNumber, form.FormYear);

  // Approval trail
  await repo.insertFormApproval({
    formId: form.form_id,
    action: "CPO_CONFIRMED",
    fromStatus: FORM_STATUS.FO_APPROVED,
    toStatus: FORM_STATUS.CPO_CONFIRMED,
    performedBy: cpo_svcno,
    performerRole: "CPO",
    remarks: null,
  });

  await repo.insertAuditLog({
    tableName: "ef_personalinfos",
    action: "UPDATE",
    recordKey: form.serviceNumber,
    oldValues: { Status: LEGACY_STATUS.FO_APPROVED, emolumentform: null },
    newValues: {
      Status: legacyStatus,
      emolumentform: "Yes",
      exittype: "Yes",
      hod_svcno: cpo_svcno,
      confirmedBy: cpo_svcno,
    },
    performedBy: cpo_svcno,
    ipAddress: ip,
  });

  return {
    success: true,
    message: "Form confirmed successfully.",
    data: {
      formId: form.form_id,
      serviceNumber: form.serviceNumber,
      formNumber: form.formNumber,
      formYear: form.FormYear,
      newStatus: FORM_STATUS.CPO_CONFIRMED,
      confirmedBy: cpo_svcno,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// REJECT — FO_APPROVED form reset to NULL
// Body: { remarks }
// ─────────────────────────────────────────────────────────────

async function rejectForm(formId, cpoCommand, body, performedBy, ip) {
  const { remarks } = body;
  const { cpo_svcno, cpo_name, cpo_rank } = performedBy;

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
      message: "Form not found or not in FO_APPROVED status.",
    };
  }

  if (cpoCommand !== "ALL" && form.command !== cpoCommand) {
    return {
      success: false,
      code: 403,
      message: "Access denied. This form is not under your command.",
    };
  }

  const reset = await repo.rejectForm(form.serviceNumber, formId, form.command);
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
    fromStatus: FORM_STATUS.FO_APPROVED,
    toStatus: FORM_STATUS.REJECTED,
    performedBy: cpo_svcno,
    performerRole: "CPO",
    remarks: remarks.trim(),
  });

  await repo.insertAuditLog({
    tableName: "ef_personalinfos",
    action: "UPDATE",
    recordKey: form.serviceNumber,
    oldValues: { Status: LEGACY_STATUS.FO_APPROVED },
    newValues: {
      Status: null,
      rejectedBy: cpo_svcno,
      remarks: remarks.trim(),
    },
    performedBy: cpo_svcno,
    ipAddress: ip,
  });

  const message = `Your emolument form (ID: ${formId}) has been rejected by the Central Pay Officer (${cpo_rank} ${cpo_name}).\n\nRemarks: ${remarks.trim()}\n\nPlease re-fill and resubmit the form.`;
  await sendMessage({
    userId: cpo_svcno,
    userFullname: cpo_name,
    to_user_id: form.serviceNumber,
    subject: "Form Rejected",
    body: message,
  });

  return {
    success: true,
    message: "Form rejected. Personnel will need to re-fill and resubmit.",
    data: {
      formId: form.form_id,
      serviceNumber: form.serviceNumber,
      newStatus: FORM_STATUS.REJECTED,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// BULK CONFIRM
// Body: { selected }
// Confirms forms WHERE Status = 'CPO'
//   AND form_id IN @selected AND command = @cpoCommand
//
// Mirrors approveBulk (FO) — same shape, CPO stage.
// ─────────────────────────────────────────────────────────────

async function confirmBulk(body, performedBy, cpoCommand, ip) {
  const { selected } = body;
  const { cpo_svcno, cpo_name, cpo_rank } = performedBy;

  if (!cpo_name || !cpo_rank) {
    return {
      success: false,
      code: 400,
      message: "cpo_name and cpo_rank are required.",
    };
  }

  if (!selected || !Array.isArray(selected) || selected.length === 0) {
    return {
      success: false,
      code: 400,
      message: "At least one form ID must be selected for bulk confirm.",
    };
  }

  // Fetch candidate forms upfront — gives us formId, serviceNumber,
  // command, and FormYear without a second round-trip later.
  const candidateForms = await repo.getFormsByFormIDs(
    selected,
    toLegacyStatus(FORM_STATUS.FO_APPROVED), // 'CPO' (= FO_APPROVED legacy)
  );

  if (candidateForms.length === 0) {
    return {
      success: false,
      code: 404,
      message: `No forms found with Status='${toLegacyStatus(FORM_STATUS.FO_APPROVED)}'.`,
    };
  }

  // Enforce command scope — drop forms outside this CPO's command
  const scopedForms =
    cpoCommand === "ALL"
      ? candidateForms
      : candidateForms.filter((f) => f.command === cpoCommand);

  if (scopedForms.length === 0) {
    return {
      success: false,
      code: 403,
      message: "None of the selected forms are under your command.",
    };
  }

  // Build snapshots in batches of 10 — before the transaction opens
  // so we don't hold locks while doing read-heavy child-table fetches.
  const snapshots = await buildSnapshotsInBatches(scopedForms, cpo_svcno, 10);

  const legacyStatus = toLegacyStatus(FORM_STATUS.CPO_CONFIRMED); // → 'Verified'
  const formYear = new Date().getFullYear(); // fallback; repo uses per-form value

  const { count, confirmedFormIds, skipped } =
    await repo.confirmBulkWithHistory(
      scopedForms,
      snapshots,
      cpo_svcno,
      cpo_name,
      cpo_rank,
      legacyStatus,
    );

  if (count === 0) {
    return {
      success: false,
      code: 409,
      message:
        "No forms could be confirmed. They may already be confirmed or are not in FO_APPROVED status.",
    };
  }

  invalidateCommandCache(cpoCommand);

  // Approval trail — one entry per confirmed form
  await Promise.all(
    confirmedFormIds.map((fId) =>
      repo.insertFormApproval({
        formId: fId,
        action: "CPO_CONFIRMED",
        fromStatus: FORM_STATUS.FO_APPROVED,
        toStatus: FORM_STATUS.CPO_CONFIRMED,
        performedBy: cpo_svcno,
        performerRole: "CPO",
        remarks: `Bulk confirm — command: ${cpoCommand} for selected forms`,
      }),
    ),
  );

  // Single audit log for the bulk operation
  await repo.insertAuditLog({
    tableName: "ef_personalinfos",
    action: "UPDATE",
    recordKey: `BULK_CONFIRM:${cpoCommand}:formIds=${confirmedFormIds.join(",")}`,
    oldValues: {
      Status: toLegacyStatus(FORM_STATUS.FO_APPROVED),
      command: cpoCommand,
      formIds: confirmedFormIds.join(","),
    },
    newValues: {
      Status: legacyStatus,
      cpo_name,
      cpo_rank,
      cpo_svcno,
      hod_date: new Date().toISOString().slice(0, 10),
      affectedCount: count,
      skippedCount: skipped.length,
    },
    performedBy: cpo_svcno,
    ipAddress: ip,
  });

  return {
    success: true,
    message: `Bulk confirm complete. ${count} form(s) confirmed.${skipped.length ? ` ${skipped.length} skipped (stale/already confirmed).` : ""}`,
    data: {
      command: cpoCommand,
      confirmed: count,
      skipped: skipped.length,
      newStatus: FORM_STATUS.CPO_CONFIRMED,
      selectedFormIds: selected,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// CLASS CONFIRM
// Body: { classes }
// Confirms forms WHERE Status = 'CPO'
//   AND classes = @classes AND command = @cpoCommand
//
// Mirrors approveClass (FO) — same shape, CPO stage.
// classes: 1 = Officers, 2 = Ratings, 3 = Training
// ─────────────────────────────────────────────────────────────

async function confirmClass(body, performedBy, cpoCommand, ip) {
  const { classes } = body;
  const { cpo_svcno, cpo_name, cpo_rank } = performedBy;

  if (!cpo_name || !cpo_rank) {
    return {
      success: false,
      code: 400,
      message: "cpo_name and cpo_rank are required.",
    };
  }

  if (!classes || ![1, 2, 3].includes(Number(classes))) {
    return {
      success: false,
      code: 400,
      message: "classes must be 1 (Officers), 2 (Ratings), or 3 (Training).",
    };
  }

  // Fetch candidate forms upfront — command filter applied in SQL
  // when cpoCommand !== 'ALL', otherwise no command filter.
  const candidateForms = await repo.getFormsByClass(
    Number(classes),
    toLegacyStatus(FORM_STATUS.FO_APPROVED), // 'CPO' (= FO_APPROVED legacy)
    cpoCommand, // repo handles 'ALL' → no command clause
  );

  if (candidateForms.length === 0) {
    return {
      success: false,
      code: 404,
      message: `No forms found with Status='${toLegacyStatus(FORM_STATUS.FO_APPROVED)}' for command '${cpoCommand}' and classes=${classes}.`,
    };
  }

  // Build snapshots in batches of 10 before the transaction
  const snapshots = await buildSnapshotsInBatches(
    candidateForms,
    cpo_svcno,
    10,
  );

  const legacyStatus = toLegacyStatus(FORM_STATUS.CPO_CONFIRMED); // → 'Verified'

  const { count, confirmedFormIds, skipped } =
    await repo.confirmBulkWithHistory(
      candidateForms,
      snapshots,
      cpo_svcno,
      cpo_name,
      cpo_rank,
      legacyStatus,
    );

  if (count === 0) {
    return {
      success: false,
      code: 409,
      message:
        "No forms could be confirmed. They may already be confirmed or are not in FO_APPROVED status.",
    };
  }

  invalidateCommandCache(cpoCommand);

  // Approval trail — one entry per confirmed form
  await Promise.all(
    confirmedFormIds.map((fId) =>
      repo.insertFormApproval({
        formId: fId,
        action: "CPO_CONFIRMED",
        fromStatus: FORM_STATUS.FO_APPROVED,
        toStatus: FORM_STATUS.CPO_CONFIRMED,
        performedBy: cpo_svcno,
        performerRole: "CPO",
        remarks: `Bulk confirm — command: ${cpoCommand}, classes: ${classes}`,
      }),
    ),
  );

  // Single audit log for the bulk operation
  await repo.insertAuditLog({
    tableName: "ef_personalinfos",
    action: "UPDATE",
    recordKey: `CLASS_CONFIRM:${cpoCommand}:classes=${classes}`,
    oldValues: {
      Status: FORM_STATUS.CPO_APPROVED,
      command: cpoCommand,
      classes,
    },
    newValues: {
      Status: legacyStatus,
      cpo_name,
      cpo_rank,
      cpo_svcno,
      hod_date: new Date().toISOString().slice(0, 10),
      affectedCount: count,
      skippedCount: skipped.length,
    },
    performedBy: cpo_svcno,
    ipAddress: ip,
  });

  return {
    success: true,
    message: `Class confirm complete. ${count} form(s) confirmed.${skipped.length ? ` ${skipped.length} skipped (stale/already confirmed).` : ""}`,
    data: {
      command: cpoCommand,
      classes: Number(classes),
      confirmed: count,
      skipped: skipped.length,
      newStatus: FORM_STATUS.CPO_CONFIRMED,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// SNAPSHOT HELPER
// Builds a snapshot per form in batches to throttle DB load.
// Returns a Map<formId, snapshot> for O(1) lookup in the repo.
// ─────────────────────────────────────────────────────────────

async function buildSnapshotsInBatches(forms, cpo_svcno, batchSize) {
  const snapshotMap = new Map();

  for (let i = 0; i < forms.length; i += batchSize) {
    const batch = forms.slice(i, i + batchSize);

    await Promise.all(
      batch.map(async (f) => {
        const [nok, spouse, children, loans, allowances, documents] =
          await Promise.all([
            repo.getNok(f.serviceNumber),
            repo.getSpouse(f.serviceNumber),
            repo.getChildren(f.serviceNumber),
            repo.getLoans(f.serviceNumber),
            repo.getAllowances(f.serviceNumber),
            repo.getDocuments(f.serviceNumber),
          ]);

        snapshotMap.set(f.id, {
          confirmedAt: new Date().toISOString(),
          confirmedBy: cpo_svcno,
          core: f,
          nok,
          spouse,
          children,
          loans,
          allowances,
          documents,
        });
      }),
    );
  }

  return snapshotMap;
}

// ─────────────────────────────────────────────────────────────
// STATUS STATS — for CPO dashboard summary
// ─────────────────────────────────────────────────────────────

async function getStatusStats(command, svc) {
  if (!command)
    return { success: false, code: 400, message: "Command is required." };

  if (!svc)
    return {
      success: false,
      code: 400,
      message: "Service number is required.",
    };

  const stats = await repo.getStatusStats(command, svc);
  return { success: true, data: stats };
}

// ─────────────────────────────────────────────────────────────
// LIST CONFIRMED FORMS
// ─────────────────────────────────────────────────────────────

async function listConfirmedForms(command, svc, limit, offset, search) {
  if (!command)
    return { success: false, code: 400, message: "Command is required." };
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

  const forms = await repo.getCPOConfirmedForms(
    command,
    svc,
    limit,
    offset,
    search,
  );

  return { success: true, data: forms };
}

module.exports = {
  listFoApprovedForms,
  listConfirmedForms,
  getForm,
  confirmForm,
  rejectForm,
  confirmBulk,
  confirmClass,
  getStatusStats,
};
