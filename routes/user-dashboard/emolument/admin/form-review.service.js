/**
 * FILE: routes/user-dashboard/emolument/admin/form-review.service.js
 *
 * Business logic for the admin "Review & Approve" section.
 *
 *   getSettings / updateSettings  → "admins can edit forms" switch
 *   listForms                     → alphabetical list, any status
 *   progressForms                 → move forms ONE stage forward
 *                                   (single from the form view, bulk from the list)
 *   rejectForm                    → reject a Submitted / FO Approved form
 *   saveForm                      → admin edit of every form field
 *
 * Stages, in order:
 *   NOT_FILLED → SUBMITTED → FO_APPROVED → CPO_CONFIRMED → SYNCED
 *
 * Admin rules:
 *   • Approve and reject stop once a form is CPO_CONFIRMED. Pushing a
 *     confirmed form to payroll stays with the Payroll Update section.
 *   • Editing (while the switch is on) is open at every stage until the
 *     form is SYNCED to payroll.
 *   • Not Filled → Submitted (admin submits on the personnel's behalf) is
 *     only done when the caller asks for it, so a bulk approve can never
 *     submit an empty form.
 */

"use strict";

const repo = require("./form-review.repository");
const adminRepo = require("./admin.repository");
const formRepo = require("../form/form.repository");
const formService = require("../form/form.service");
const cpoRepo = require("../cpo/cpo.repository");
const cpoCache = require("../cpo/cpo.cache");
const {
  invalidateShipCache,
  invalidateCommandCache,
} = require("../reports/reports.service");
const { sendMessage } = require("../../email/email.service");
const {
  FORM_STATUS,
  LEGACY_STATUS,
  FILLED_STATUS_VALUES,
  VALID_LOAN_TYPES,
  VALID_ALLOW_TYPES,
  resolveFormType,
  resolveFormNoColumn,
} = require("../emolument.constants");

const SETTING_ADMIN_EDIT = "admin_can_edit_forms";
const CPO_DASH_PREFIX = "cpo:dashboard:";
const MAX_BULK = 500;

// ─────────────────────────────────────────────────────────────
// STAGES
// ─────────────────────────────────────────────────────────────

const STAGE = Object.freeze({
  NOT_FILLED: "NOT_FILLED",
  SUBMITTED: "SUBMITTED",
  FO_APPROVED: "FO_APPROVED",
  CPO_CONFIRMED: "CPO_CONFIRMED",
  SYNCED: "SYNCED",
  OTHER: "OTHER",
});

const STAGE_LABEL = Object.freeze({
  NOT_FILLED: "Not Filled",
  SUBMITTED: "Submitted",
  FO_APPROVED: "FO Approved",
  CPO_CONFIRMED: "Confirmed",
  SYNCED: "Completed",
  OTHER: "Unknown",
});

const NEXT_STAGE = Object.freeze({
  NOT_FILLED: STAGE.SUBMITTED,
  SUBMITTED: STAGE.FO_APPROVED,
  FO_APPROVED: STAGE.CPO_CONFIRMED,
});

// Approve / reject stop at Confirmed; only a form in the review pipeline
// can be sent back.
const REJECTABLE = new Set([STAGE.SUBMITTED, STAGE.FO_APPROVED]);

// Editing stays open until the form has been synced to payroll.
const stageAllowsEdit = (stage) => stage !== STAGE.SYNCED;

/**
 * Where a personnel record sits in the workflow, read from
 * ef_personalinfos (the column every other admin screen shows).
 * The DO-review stage is bypassed in the live workflow, so 'Filled' and
 * 'FO' are both "Submitted" — the same masking personnel.html uses.
 */
function resolveStage(person) {
  const s = String(person?.Status ?? "").trim();
  if (!s) return person?.emolumentform === "Yes" ? STAGE.SYNCED : STAGE.NOT_FILLED;
  if (s === LEGACY_STATUS.SYNCED || s === FORM_STATUS.SYNCED) return STAGE.SYNCED;
  if (s === LEGACY_STATUS.CPO_CONFIRMED || s === FORM_STATUS.CPO_CONFIRMED)
    return STAGE.CPO_CONFIRMED;
  if (s === LEGACY_STATUS.FO_APPROVED || s === FORM_STATUS.FO_APPROVED)
    return STAGE.FO_APPROVED;
  if (FILLED_STATUS_VALUES.includes(s)) return STAGE.SUBMITTED;
  return STAGE.OTHER;
}

function describeStage(person) {
  const stage = resolveStage(person);
  const nextStage = NEXT_STAGE[stage] || null;
  return {
    stage,
    stageLabel:
      stage === STAGE.OTHER ? String(person?.Status ?? "Unknown") : STAGE_LABEL[stage],
    nextStage,
    nextStageLabel: nextStage ? STAGE_LABEL[nextStage] : null,
    canProgress: Boolean(nextStage),
    canReject: REJECTABLE.has(stage),
    // Stage allows editing; the "admins can edit forms" switch is applied
    // on top of this (see getFormStatus / saveForm).
    canEdit: stageAllowsEdit(stage),
  };
}

function fail(code, message) {
  return { success: false, code, message };
}

function fullName(p) {
  return [p?.Surname, p?.OtherName].filter(Boolean).join(" ").trim();
}

// The admin performing the action, as the FO/CPO columns expect it.
function adminIdentity(user) {
  return {
    svcNo: user.svcNo,
    name: user.name || user.svcNo,
    rank: user.rank || null,
  };
}

function invalidateCaches(person) {
  try {
    if (person?.ship) invalidateShipCache(person.ship);
    if (person?.command) invalidateCommandCache(person.command);
    cpoCache.invalidatePrefix(CPO_DASH_PREFIX);
  } catch (err) {
    console.error("⚠️ form-review: cache invalidation failed:", err.message);
  }
}

// FormYear set at submission; falls back to the open processing year.
async function resolveFormYear(person) {
  if (person.FormYear) return String(person.FormYear);
  const isTraining = resolveFormType(person.payrollclass) === "TRAINING";
  const year = await formRepo.getProcessingYear(isTraining);
  return year ? String(year) : null;
}

/**
 * Make sure the cycle's ef_emolument_forms row matches the stage shown on
 * ef_personalinfos. Legacy/migrated submissions can have no row, or a row
 * left at DRAFT — the same gap form.service.loadForm self-heals.
 */
async function ensureFormRow(person, formYear, stage) {
  const wanted =
    stage === STAGE.FO_APPROVED ? [FORM_STATUS.FO_APPROVED] : [FORM_STATUS.SUBMITTED, FORM_STATUS.DO_REVIEWED];

  let row = await repo.getFormRow(person.serviceNumber, formYear);
  if (row && wanted.includes(row.status)) return row;

  console.warn(
    `⚠️ form-review: re-aligning ef_emolument_forms for ${person.serviceNumber} ` +
      `(${formYear}) from ${row?.status ?? "none"} to ${wanted[0]}`,
  );
  await formRepo.upsertEmolumentForm(
    person.serviceNumber,
    formYear,
    person.formNumber != null ? String(person.formNumber) : null,
    person.payrollclass,
    person.ship,
    person.command,
    wanted[0],
  );
  row = await repo.getFormRow(person.serviceNumber, formYear);
  return row && wanted.includes(row.status) ? row : null;
}

async function audit(serviceNo, oldValues, newValues, performedBy, ip) {
  try {
    await adminRepo.insertAuditLog({
      tableName: "ef_personalinfos",
      action: "UPDATE",
      recordKey: serviceNo,
      oldValues,
      newValues,
      performedBy,
      ipAddress: ip,
    });
  } catch (err) {
    console.error(`⚠️ form-review: audit log failed for ${serviceNo}:`, err.message);
  }
}

// ─────────────────────────────────────────────────────────────
// SETTINGS
// ─────────────────────────────────────────────────────────────

async function isAdminEditEnabled() {
  const row = await repo.getSetting(SETTING_ADMIN_EDIT);
  return row?.setting_value === "1";
}

async function getSettings() {
  const row = await repo.getSetting(SETTING_ADMIN_EDIT);
  return {
    success: true,
    data: {
      adminCanEditForms: row?.setting_value === "1",
      updatedBy: row?.updated_by ?? null,
      updatedAt: row?.updated_at ?? null,
    },
  };
}

async function updateSettings(body, user, ip) {
  if (typeof body?.adminCanEditForms !== "boolean")
    return fail(400, "adminCanEditForms must be true or false.");

  const before = await isAdminEditEnabled();
  await repo.setSetting(SETTING_ADMIN_EDIT, body.adminCanEditForms ? "1" : "0", user.svcNo);

  try {
    await adminRepo.insertAuditLog({
      tableName: "ef_settings",
      action: "UPDATE",
      recordKey: SETTING_ADMIN_EDIT,
      oldValues: { adminCanEditForms: before },
      newValues: { adminCanEditForms: body.adminCanEditForms },
      performedBy: user.svcNo,
      ipAddress: ip,
    });
  } catch (err) {
    console.error("⚠️ form-review: settings audit failed:", err.message);
  }

  const result = await getSettings();
  return {
    success: true,
    message: body.adminCanEditForms
      ? "Admins can now edit forms."
      : "Admin form editing is now turned off.",
    data: result.data,
  };
}

// ─────────────────────────────────────────────────────────────
// LIST
// ─────────────────────────────────────────────────────────────

async function listForms(query = {}) {
  const page = Math.max(Number(query.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(query.pageSize) || 25, 1), 200);

  const filters = {
    q: query.q || undefined,
    ship: query.ship || undefined,
    command: query.command || undefined,
    payrollclass: query.payrollclass || undefined,
  };

  const { rows, total } = await repo.listForms(filters, pageSize, (page - 1) * pageSize);

  return {
    success: true,
    data: {
      rows: rows.map((r) => ({ ...r, ...describeStage(r) })),
      searchTerms: repo.splitSearchTerms(filters.q),
      pagination: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    },
  };
}

async function getFormStatus(serviceNo) {
  if (!serviceNo) return fail(400, "Service number is required.");
  const person = await repo.getPersonForReview(serviceNo);
  if (!person) return fail(404, "Personnel record not found.");
  const stage = describeStage(person);
  const adminCanEditForms = await isAdminEditEnabled();
  return {
    success: true,
    data: {
      serviceNumber: person.serviceNumber,
      name: fullName(person),
      rank: person.Rank ?? null,
      ship: person.ship ?? null,
      command: person.command ?? null,
      ...stage,
      adminCanEditForms,
      // What the form view should do: switch on AND not yet synced.
      editable: adminCanEditForms && stage.canEdit,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// PROGRESS
// ─────────────────────────────────────────────────────────────

async function submitOnBehalf(person, admin, remarks, ip) {
  const svc = person.serviceNumber;
  const isTraining = resolveFormType(person.payrollclass) === "TRAINING";
  const formYear = await formRepo.getProcessingYear(isTraining);
  if (!formYear) return fail(500, "Processing year not configured.");

  const mismatch = await formService.checkShipCommand(
    String(person.ship ?? "").trim(),
    String(person.command ?? "").trim(),
  );
  if (mismatch) return fail(400, `${mismatch} Edit the form's ship/command first.`);

  const formNoCol = resolveFormNoColumn(person.payrollclass);
  const formNumber = String(await formRepo.getCurrentFormNumber(formNoCol));

  await repo.markSubmittedByAdmin(svc, formNumber, String(formYear));

  // Same post-commit steps as a personnel submission (form.service.submitForm).
  await formRepo.upsertEmolumentForm(
    svc,
    String(formYear),
    formNumber,
    person.payrollclass,
    person.ship,
    person.command,
    FORM_STATUS.SUBMITTED,
  );
  await formRepo.incrementFormNumber(formNoCol);

  const formId = await formRepo.getEmolumentFormId(svc, String(formYear));
  if (formId) {
    await adminRepo.insertFormApproval({
      formId,
      action: FORM_STATUS.SUBMITTED,
      fromStatus: null,
      toStatus: FORM_STATUS.SUBMITTED,
      performedBy: admin.svcNo,
      performerRole: "EMOL_ADMIN",
      remarks: remarks || "Submitted by admin on behalf of personnel",
    });
  }

  await audit(
    svc,
    { Status: null },
    { Status: LEGACY_STATUS.SUBMITTED, formNumber, FormYear: formYear, by: "EMOL_ADMIN" },
    admin.svcNo,
    ip,
  );
  return { success: true, data: { formId, formNumber } };
}

async function approveAsFo(person, admin, remarks, ip) {
  const formYear = await resolveFormYear(person);
  if (!formYear) return fail(500, "Processing year not configured.");

  const row = await ensureFormRow(person, formYear, STAGE.SUBMITTED);
  if (!row) return fail(409, "No form record found for this cycle.");

  const { formId, fromStatus } = await repo.approveAsFo(
    person.serviceNumber,
    formYear,
    admin,
    remarks || "Approved by admin (Review & Approve)",
  );

  await audit(
    person.serviceNumber,
    { Status: person.Status },
    { Status: LEGACY_STATUS.FO_APPROVED, fo_svcno: admin.svcNo, from: fromStatus },
    admin.svcNo,
    ip,
  );
  return { success: true, data: { formId } };
}

async function confirmAsCpo(person, admin, remarks, ip) {
  const formYear = await resolveFormYear(person);
  if (!formYear) return fail(500, "Processing year not configured.");

  const row = await ensureFormRow(person, formYear, STAGE.FO_APPROVED);
  if (!row) return fail(409, "No form record found for this cycle.");

  // Permanent record of the form at confirmation — built exactly like the
  // CPO confirm does (core + every child table).
  const form = await cpoRepo.getFormDetail(row.id);
  if (!form) return fail(409, "Form is no longer at the FO Approved stage.");

  const svc = person.serviceNumber;
  const [nok, spouse, children, loans, allowances, documents] = await Promise.all([
    cpoRepo.getNok(svc),
    cpoRepo.getSpouse(svc),
    cpoRepo.getChildren(svc),
    cpoRepo.getLoans(svc),
    cpoRepo.getAllowances(svc),
    cpoRepo.getDocuments(svc),
  ]);
  const snapshot = {
    confirmedAt: new Date().toISOString(),
    confirmedBy: admin.svcNo,
    core: form,
    nok,
    spouse,
    children,
    loans,
    allowances,
    documents,
  };

  await repo.confirmAsCpo(
    svc,
    row.id,
    String(form.FormYear || formYear),
    admin,
    snapshot,
    remarks || "Confirmed by admin (Review & Approve)",
  );

  await audit(
    svc,
    { Status: person.Status, emolumentform: person.emolumentform ?? null },
    { Status: LEGACY_STATUS.CPO_CONFIRMED, emolumentform: "Yes", hod_svcno: admin.svcNo },
    admin.svcNo,
    ip,
  );
  return { success: true, data: { formId: row.id } };
}

/**
 * Move one form one stage forward.
 * @param {string}  serviceNo
 * @param {string?} expectedStage  stage the admin saw; a mismatch means the
 *                                 form moved in the meantime → skipped
 * @param {object}  opts           { allowNotFilled, remarks }
 */
async function progressOne(serviceNo, expectedStage, admin, ip, opts = {}) {
  const person = await repo.getPersonForReview(serviceNo);
  if (!person) return fail(404, "Personnel record not found.");

  const stage = resolveStage(person);
  if (expectedStage && expectedStage !== stage)
    return fail(
      409,
      `Status has changed to ${STAGE_LABEL[stage] || person.Status}. Refresh and try again.`,
    );

  try {
    let result;
    switch (stage) {
      case STAGE.NOT_FILLED:
        if (!opts.allowNotFilled)
          return fail(
            409,
            "Form has not been filled. Open the form to submit it on the personnel's behalf.",
          );
        result = await submitOnBehalf(person, admin, opts.remarks, ip);
        break;
      case STAGE.SUBMITTED:
        result = await approveAsFo(person, admin, opts.remarks, ip);
        break;
      case STAGE.FO_APPROVED:
        result = await confirmAsCpo(person, admin, opts.remarks, ip);
        break;
      case STAGE.CPO_CONFIRMED:
      case STAGE.SYNCED:
        return fail(409, "Form is already confirmed. Payroll sync is done from Payroll Update.");
      default:
        return fail(409, `Form status '${person.Status}' is not recognised.`);
    }
    if (!result.success) return result;

    invalidateCaches(person);
    const to = NEXT_STAGE[stage];
    return {
      success: true,
      data: {
        serviceNumber: person.serviceNumber,
        name: fullName(person),
        fromStage: stage,
        toStage: to,
        toStageLabel: STAGE_LABEL[to],
        ...result.data,
      },
    };
  } catch (err) {
    if (err.code === "STALE_STATUS") return fail(409, err.message);
    throw err;
  }
}

/**
 * Body: { items: [{ serviceNumber, stage }], remarks?, allowNotFilled? }
 * Each form is moved in its own transaction, so one failure never blocks
 * the rest; failures come back in `skipped` with the reason.
 */
async function progressForms(body, user, ip) {
  const items = Array.isArray(body?.items) ? body.items : [];
  if (!items.length) return fail(400, "items must be a non-empty array.");
  if (items.length > MAX_BULK)
    return fail(400, `At most ${MAX_BULK} forms can be approved at once.`);

  const admin = adminIdentity(user);
  const seen = new Set();
  const progressed = [];
  const skipped = [];

  for (const item of items) {
    const svc = String(item?.serviceNumber ?? "").trim();
    if (!svc || seen.has(svc)) continue;
    seen.add(svc);

    try {
      const r = await progressOne(svc, item.stage || null, admin, ip, {
        allowNotFilled: body.allowNotFilled === true,
        remarks: typeof body.remarks === "string" ? body.remarks.trim() : null,
      });
      if (r.success) progressed.push(r.data);
      else skipped.push({ serviceNumber: svc, reason: r.message });
    } catch (err) {
      console.error(`❌ form-review progress ${svc}:`, err);
      skipped.push({ serviceNumber: svc, reason: "Server error" });
    }
  }

  if (!progressed.length && skipped.length === 1 && items.length === 1)
    return fail(409, skipped[0].reason);

  return {
    success: true,
    message: `${progressed.length} form(s) approved to the next stage.${
      skipped.length ? ` ${skipped.length} skipped.` : ""
    }`,
    data: { progressed, skipped },
  };
}

// ─────────────────────────────────────────────────────────────
// REJECT — Submitted or FO Approved only (stops at Confirmed)
// ─────────────────────────────────────────────────────────────

async function rejectForm(body, user, ip) {
  const svc = String(body?.serviceNumber ?? "").trim();
  const remarks = String(body?.remarks ?? "").trim();
  if (!svc) return fail(400, "serviceNumber is required.");
  if (!remarks) return fail(400, "Rejection reason (remarks) is required.");

  const person = await repo.getPersonForReview(svc);
  if (!person) return fail(404, "Personnel record not found.");

  const stage = resolveStage(person);
  if (stage === STAGE.NOT_FILLED)
    return fail(409, "Form has not been submitted, so there is nothing to reject.");
  if (stage === STAGE.CPO_CONFIRMED || stage === STAGE.SYNCED)
    return fail(409, "Form is already confirmed, so it can no longer be rejected.");
  if (!REJECTABLE.has(stage))
    return fail(409, `Form status '${person.Status}' is not recognised.`);

  const admin = adminIdentity(user);
  const formYear = await resolveFormYear(person);

  let result;
  try {
    result = await repo.rejectInReview(svc, formYear, admin.svcNo, remarks);
  } catch (err) {
    if (err.code === "STALE_STATUS") return fail(409, err.message);
    throw err;
  }

  invalidateCaches(person);
  await audit(
    svc,
    { Status: person.Status ?? null, emolumentform: person.emolumentform ?? null },
    { Status: null, rejectedBy: admin.svcNo, stage, remarks },
    admin.svcNo,
    ip,
  );

  try {
    await sendMessage({
      userId: admin.svcNo,
      userFullname: admin.name,
      to_user_id: svc,
      subject: "Form Rejected",
      body:
        `Your emolument form has been rejected by the Emolument Administrator ` +
        `(${[admin.rank, admin.name].filter(Boolean).join(" ")}).\n\n` +
        `Remarks: ${remarks}\n\nPlease re-fill and resubmit the form.`,
    });
  } catch (err) {
    console.error(`⚠️ form-review: rejection notice to ${svc} failed:`, err.message);
  }

  return {
    success: true,
    message: `Form for ${fullName(person) || svc} rejected. Personnel will need to re-fill and resubmit.`,
    data: {
      serviceNumber: svc,
      formId: result.formId,
      fromStage: stage,
      newStatus: FORM_STATUS.REJECTED,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// ADMIN EDIT — every field, any status until synced (switch on)
// ─────────────────────────────────────────────────────────────

async function saveForm(serviceNo, body, user, ip) {
  if (!serviceNo) return fail(400, "svcno is required.");
  if (!body || typeof body !== "object" || !body.core)
    return fail(400, "Request body must include a core object.");

  if (!(await isAdminEditEnabled()))
    return fail(
      403,
      "Admin form editing is turned off. Turn it on from the Review & Approve settings.",
    );

  const person = await repo.getPersonForReview(serviceNo);
  if (!person) return fail(404, "Personnel record not found.");
  if (!stageAllowsEdit(resolveStage(person)))
    return fail(409, "Form has been synced to payroll, so it can no longer be edited.");

  formService.mapGcb(body);

  // Ship/command decide which FO/CPO sees the form, so a change must still
  // be a valid pairing. Unchanged values are left alone (legacy rows may
  // already hold a pair that wouldn't pass today's check).
  const storedShip = String(person.ship ?? "").trim();
  const storedCommand = String(person.command ?? "").trim();
  const newShip = String(body.core.ship ?? "").trim() || storedShip;
  const newCommand = String(body.core.command ?? "").trim() || storedCommand;
  const placementChanged = newShip !== storedShip || newCommand !== storedCommand;

  if (placementChanged) {
    const mismatch = await formService.checkShipCommand(newShip, newCommand);
    if (mismatch) return fail(400, mismatch);
  }
  body.core.ship = newShip || null;
  body.core.command = newCommand || null;

  try {
    await repo.saveFormTables(serviceNo, body, VALID_LOAN_TYPES, VALID_ALLOW_TYPES);
  } catch (err) {
    if (err.code === "STALE_STATUS") return fail(409, err.message);
    throw err;
  }

  if (placementChanged) {
    const formYear = await resolveFormYear(person);
    if (formYear) await repo.updateFormRowPlacement(serviceNo, formYear, newShip, newCommand);
    invalidateCaches(person);
    invalidateCaches({ ship: newShip, command: newCommand });
  }

  const admin = adminIdentity(user);
  await audit(
    serviceNo,
    placementChanged ? { ship: storedShip, command: storedCommand } : null,
    {
      action: "ADMIN_FORM_EDIT",
      stage: resolveStage(person),
      ...(placementChanged ? { ship: newShip, command: newCommand } : {}),
    },
    admin.svcNo,
    ip,
  );

  return { success: true, message: "Form changes saved." };
}

module.exports = {
  STAGE,
  STAGE_LABEL,
  resolveStage,
  describeStage,
  getSettings,
  updateSettings,
  isAdminEditEnabled,
  listForms,
  getFormStatus,
  progressForms,
  rejectForm,
  saveForm,
};
