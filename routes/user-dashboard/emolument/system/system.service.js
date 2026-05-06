"use strict";

/**
 * FILE: routes/user-dashboard/emolument/system/system.service.js
 *
 * Business logic for ef_control CRUD.
 *
 * Functions:
 *   listControlRows       → all ef_control rows
 *   getControlRow         → single row by Id
 *   createControlRow      → add a new cycle row
 *   updateControlRow      → edit an existing cycle row
 *   deleteControlRow      → remove a cycle row
 *   resolveEffectiveStatus → check open/close state for a ship + formtype
 */

const repo = require("./system.repository");

const VALID_STATUSES = ["Open", "Reopen", "Close"];
const VALID_FORMTYPES = ["ALL", "OFFICERS", "RATINGS", "TRAINING"];
const YEAR_RE = /^\d{4}$/;

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function fail(code, message) {
  return { success: false, code, message };
}

function ok(data, message) {
  return { success: true, data, message };
}

function validatePayload({
  processingyear,
  ship,
  formtype,
  startdate,
  enddate,
  status,
}) {
  if (!processingyear || !YEAR_RE.test(String(processingyear))) {
    return "processingyear must be a 4-digit year.";
  }
  if (!startdate || !enddate) {
    return "startdate and enddate are required.";
  }
  if (new Date(enddate) <= new Date(startdate)) {
    return "enddate must be after startdate.";
  }
  if (status && !VALID_STATUSES.includes(status)) {
    return `status must be one of: ${VALID_STATUSES.join(", ")}.`;
  }
  if (formtype && !VALID_FORMTYPES.includes(formtype)) {
    return `formtype must be one of: ${VALID_FORMTYPES.join(", ")}.`;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// LIST
// ─────────────────────────────────────────────────────────────

async function listControlRows() {
  const rows = await repo.getAllControlRows();
  return ok(rows);
}

// ─────────────────────────────────────────────────────────────
// SINGLE ROW
// ─────────────────────────────────────────────────────────────

async function getControlRow(id) {
  const row = await repo.getControlRowById(id);
  if (!row) return fail(404, `Control row not found: ${id}`);
  return ok(row);
}

// ─────────────────────────────────────────────────────────────
// CREATE
// ─────────────────────────────────────────────────────────────

async function createControlRow(payload, performedBy, ip) {
  const err = validatePayload(payload);
  if (err) return fail(400, err);

  const { processingyear, ship, formtype, startdate, enddate, status, notes } =
    payload;

  const insertId = await repo.createControlRow({
    processingyear,
    ship: ship || "All",
    formtype: formtype || "ALL",
    startdate,
    enddate,
    status: status || "Open",
    notes: notes || null,
    createdby: performedBy,
  });

  await repo.insertAuditLog({
    tableName: "ef_control",
    action: "INSERT",
    recordKey: String(insertId),
    oldValues: null,
    newValues: {
      processingyear,
      ship,
      formtype,
      startdate,
      enddate,
      status,
      notes,
    },
    performedBy,
    ipAddress: ip,
  });

  const created = await repo.getControlRowById(insertId);
  return ok(created, "Cycle control row created.");
}

// ─────────────────────────────────────────────────────────────
// UPDATE
// ─────────────────────────────────────────────────────────────

async function updateControlRow(id, payload, performedBy, ip) {
  const existing = await repo.getControlRowById(id);
  if (!existing) return fail(404, `Control row not found: ${id}`);

  const err = validatePayload(payload);
  if (err) return fail(400, err);

  const { processingyear, ship, formtype, startdate, enddate, status, notes } =
    payload;

  const changed = await repo.updateControlRow(id, {
    processingyear,
    ship: ship || "All",
    formtype: formtype || "ALL",
    startdate,
    enddate,
    status: status || "Open",
    notes: notes || null,
    updatedby: performedBy,
  });

  if (!changed) return fail(500, "Failed to update control row.");

  await repo.insertAuditLog({
    tableName: "ef_control",
    action: "UPDATE",
    recordKey: String(id),
    oldValues: existing,
    newValues: {
      processingyear,
      ship,
      formtype,
      startdate,
      enddate,
      status,
      notes,
    },
    performedBy,
    ipAddress: ip,
  });

  const updated = await repo.getControlRowById(id);
  return ok(updated, "Cycle control row updated.");
}

// ─────────────────────────────────────────────────────────────
// DELETE
// ─────────────────────────────────────────────────────────────

async function deleteControlRow(id, performedBy, ip) {
  const existing = await repo.getControlRowById(id);
  if (!existing) return fail(404, `Control row not found: ${id}`);

  const removed = await repo.deleteControlRow(id);
  if (!removed) return fail(500, "Failed to delete control row.");

  await repo.insertAuditLog({
    tableName: "ef_control",
    action: "DELETE",
    recordKey: String(id),
    oldValues: existing,
    newValues: null,
    performedBy,
    ipAddress: ip,
  });

  return ok(null, "Cycle control row deleted.");
}

// ─────────────────────────────────────────────────────────────
// RESOLVE EFFECTIVE STATUS
// Used by form-submission routes to check if a ship/formtype is open.
//
// Returns:
//   { isOpen: true,  row: <winning ef_control row> }
//   { isOpen: false, row: <winning ef_control row> | null }
// ─────────────────────────────────────────────────────────────

async function resolveEffectiveStatus(shipName, formtype = "ALL") {
  const row = await repo.resolveEffectiveStatus(shipName, formtype);
  if (!row) return { isOpen: false, row: null };
  const isOpen = row.status === "Open" || row.status === "Reopen";
  return { isOpen, row };
}

module.exports = {
  listControlRows,
  getControlRow,
  createControlRow,
  updateControlRow,
  deleteControlRow,
  resolveEffectiveStatus,
};
