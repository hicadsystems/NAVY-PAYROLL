/**
 * FILE: routes/user-dashboard/emolument/reports/emolument-reports.config.js
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EDIT THIS FILE FIRST. Everything role/stage-specific — status strings,
 * approval-trail action names, which officer-fields a report shows — lives
 * here. The repository/service/controller are generic and just read this
 * config, so you should not need to touch SQL to fix a wrong status value.
 *
 * Every literal copied verbatim from your existing fo.repository.js /
 * fo.service.js is marked FROM EXISTING CODE. Everything else is a best
 * guess based on the pattern those files establish and is marked CONFIRM.
 * ─────────────────────────────────────────────────────────────────────────
 */

"use strict";

// ─────────────────────────────────────────────────────────────
// SHARED LOOKUPS
// ─────────────────────────────────────────────────────────────

// FROM EXISTING CODE (fo.service.js comment block).
const CLASS_NAMES = { 1: "Officers", 2: "Ratings", 7: "Training" };

// Column groups used to show "who actioned this form" on a report.
// FROM EXISTING CODE: div_off_* and fo_* both appear as real columns on
// ef_personalinfos in fo.repository.js's getFormDetail SELECT.
// CONFIRM: cpo_* — guessed as the same naming pattern; rename if different
// (e.g. if CPO confirmation is tracked only in ef_form_approvals and there
// are no cpo_name/cpo_rank/cpo_svcno/cpo_date columns on ef_personalinfos,
// set OFFICER_FIELD_SETS.CPO to null and the report will omit that block).
const OFFICER_FIELD_SETS = {
  DO: { name: "div_off_name", rank: "div_off_rank", svcno: "div_off_svcno", date: "div_off_date" },
  FO: { name: "fo_name", rank: "fo_rank", svcno: "fo_svcno", date: "fo_date" },
  CPO: { name: "hod_name", rank: "hod_rank", svcno: "hod_svcno", date: "hod_date" }, // CONFIRM
};

// ─────────────────────────────────────────────────────────────
// ROLE STAGE DEFINITIONS
//
// mode: "personalinfos_status" | "approval_trail" | "rejection_trail"
//
// personalinfos_status — form sits in ef_personalinfos at a known Status,
//   optionally gated by ef_emolument_forms.status too. Used for "pending"
//   stages (nothing has been written to the trail tables yet).
//
// approval_trail — form has a row in ef_form_approvals for a given action.
//   Used for "reviewed / approved / confirmed" stages.
//
// rejection_trail — form has a row in ef_form_rejections.
//
// filterByPerformer — when true, restrict rows to fa.performed_by /
//   r.rejected_by = the logged-in officer's own service number (DO/FO's
//   "forms I actioned" framing). When false, show all rows regardless of
//   who performed the action (CPO's global view).
//
// officerFieldSet — which OFFICER_FIELD_SETS entry to render as the
//   "Officer" column on this stage's report. Typically the PRECEDING
//   officer for a "pending" stage (who forwarded it to this role) and
//   THIS role's own fields for the "acted on" stage.
// ─────────────────────────────────────────────────────────────

const ROLE_STAGES = {
  DO: {
    scopeMode: "ship", // DO is ship-scoped, same as FO
    stages: {
      // CONFIRM: DO's own repository isn't in hand — these mirror the
      // shape of FO's pending query but with DO's presumed statuses.
      // Personnel submit a form → it should land here before any DO
      // action. Replace 'SUBMITTED' with whatever ef_personalinfos.Status
      // / ef_emolument_forms.status actually hold at that point.
      pending: {
        mode: "personalinfos_status",
        personalinfoStatus: ["SUBMITTED", "Filled"], // CONFIRM
        formStatus: "SUBMITTED", // CONFIRM — set null to skip this gate
        officerFieldSet: null, // nothing to show yet — first stage
      },
      reviewed: {
        mode: "approval_trail",
        action: "DO_REVIEWED", // CONFIRM
        filterByPerformer: true,
        officerFieldSet: "DO",
      },
      rejected: {
        mode: "rejection_trail",
        filterByPerformer: true,
        officerFieldSet: null, // the rejecting officer is the viewer
      },
    },
  },

  FO: {
    scopeMode: "ship",
    stages: {
      // FROM EXISTING CODE: fo.repository.js getDoReviewedForms —
      //   WHERE p.Status IN ('FO','DO_REVIEWED')
      //     AND (p.emolumentform IS NULL OR p.emolumentform != 'Yes')
      pending: {
        mode: "personalinfos_status",
        personalinfoStatus: ["FO", "DO_REVIEWED", "SUBMITTED", "Filled"], // FROM EXISTING CODE
        formStatus:  "SUBMITTED",
        extraWhere: "(p.emolumentform IS NULL OR p.emolumentform != 'Yes')", // FROM EXISTING CODE
        officerFieldSet: "DO", // shows who (DO) forwarded it
      },
      // FROM EXISTING CODE: fo.repository.js getApprovedForms —
      //   fa.action = 'FO_APPROVED' AND p.fo_svcno = :svc
      approved: {
        mode: "approval_trail",
        action: "FO_APPROVED", // FROM EXISTING CODE
        filterByPerformer: true,
        officerFieldSet: "FO",
      },
      rejected: {
        mode: "rejection_trail",
        filterByPerformer: true,
        officerFieldSet: "DO", // who forwarded it before FO rejected it
      },
    },
  },

  CPO: {
    scopeMode: "global", // command + ship are optional filters, not a gate
    stages: {
      // FROM EXISTING CODE: fo.service.js —
      //   legacyStatus = toLegacyStatus(FORM_STATUS.FO_APPROVED) → 'CPO'
      //   ef_emolument_forms.status set to 'FO_APPROVED' on FO approval.
      // So a form waiting on CPO sits at exactly these two values.
      pending: {
        mode: "personalinfos_status",
        personalinfoStatus: ["CPO","FO_APPROVED"], // FROM EXISTING CODE (legacy status FO sets)
        formStatus: "FO_APPROVED", // FROM EXISTING CODE
        officerFieldSet: "FO", // who (FO) forwarded it
      },
      confirmed: {
        mode: "approval_trail",
        action: "CPO_CONFIRMED", // CONFIRM
        filterByPerformer: false, // CPO is global — show all, not just "my" actions
        officerFieldSet: "CPO",
      },
      rejected: {
        mode: "rejection_trail",
        filterByPerformer: false, // see note above
        officerFieldSet: "FO",
      },
    },
  },
};

// ─────────────────────────────────────────────────────────────
// DISPLAY METADATA — titles/labels only, safe to tweak freely.
// ─────────────────────────────────────────────────────────────

const STAGE_META = {
  DO: {
    pending: { title: "Forms Pending DO Review", dateLabel: "Submitted" },
    reviewed: { title: "Forms Reviewed by DO", dateLabel: "Reviewed" },
    rejected: { title: "Forms Rejected by DO", dateLabel: "Rejected" },
  },
  FO: {
    pending: { title: "Forms Pending FO Approval", dateLabel: "Submitted" },
    approved: { title: "Forms Approved by FO", dateLabel: "Approved" },
    rejected: { title: "Forms Rejected by FO", dateLabel: "Rejected" },
  },
  CPO: {
    pending: { title: "Forms Pending CPO Confirmation", dateLabel: "Forwarded" },
    confirmed: { title: "Forms Confirmed by CPO", dateLabel: "Confirmed" },
    rejected: { title: "Forms Rejected by CPO", dateLabel: "Rejected" },
  },
};

function getStageConfig(role, stage) {
  const roleCfg = ROLE_STAGES[role];
  if (!roleCfg) return null;
  const stageCfg = roleCfg.stages[stage];
  if (!stageCfg) return null;
  return { ...stageCfg, scopeMode: roleCfg.scopeMode };
}

function getStageMeta(role, stage) {
  return (STAGE_META[role] && STAGE_META[role][stage]) || null;
}

function listStages(role) {
  return Object.keys((ROLE_STAGES[role] && ROLE_STAGES[role].stages) || {});
}

module.exports = {
  CLASS_NAMES,
  OFFICER_FIELD_SETS,
  ROLE_STAGES,
  STAGE_META,
  getStageConfig,
  getStageMeta,
  listStages,
};