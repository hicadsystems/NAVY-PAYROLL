/**
 * FILE: routes/user-dashboard/emolument/reports/emolument-reports.repository.js
 *
 * One query builder for all nine (role × stage) report datasets, driven by
 * emolument-reports.config.js. See that file first if a status/action
 * string is wrong — this file should not need SQL changes for that.
 *
 * Scoping:
 *   DO / FO  → always scoped to a ship (existing behaviour, unchanged).
 *   CPO      → global; command and/or ship are optional narrowing filters.
 *              Per spec: if both are given, command narrows first (ship
 *              list itself is already filtered to that command by the
 *              front end); ship and command can otherwise be given
 *              independently. Neither given = all commands/ships.
 */

"use strict";

const pool = require("../../../../config/db");
const config = require("../../../../config");
const { getStageConfig, OFFICER_FIELD_SETS } = require("./reports.config");

const DB = () => process.env.DB_OFFICERS || config.databases.officers;

const BASE_COLS = `
  p.serviceNumber, p.Surname, p.OtherName, p.Rank, p.classes, p.FormYear, p.ship, p.command`;

function officerCols(fieldSetKey) {
  const set = fieldSetKey && OFFICER_FIELD_SETS[fieldSetKey];
  if (!set) {
    return {
      select: "NULL AS officer_name, NULL AS officer_rank, NULL AS officer_svcno, NULL AS officer_date",
    };
  }
  return {
    select: `p.${set.name} AS officer_name, p.${set.rank} AS officer_rank, p.${set.svcno} AS officer_svcno, p.${set.date} AS officer_date`,
  };
}

// Builds the WHERE fragment + params for ship/command scoping.
// tableAlias is the alias of ef_personalinfos in the current query ("p").
function buildScopeClause({ scopeMode, ship, command }) {
  const clauses = [];
  const params = [];

  if (scopeMode === "ship") {
    // DO/FO — ship is mandatory, enforced by the service layer before we
    // get here, but guard anyway.
    if (ship) {
      clauses.push("p.ship = ?");
      params.push(ship);
    }
  } else {
    // CPO — both optional, independent unless both supplied.
    if (command) {
      clauses.push("p.command = ?");
      params.push(command);
    }
    if (ship) {
      clauses.push("p.ship = ?");
      params.push(ship);
    }
  }

  return { clause: clauses.length ? `AND ${clauses.join(" AND ")}` : "", params };
}

async function getReportRows({ role, stage, ship, command, performedBy }) {
  const stageCfg = getStageConfig(role, stage);
  if (!stageCfg) throw new Error(`Unknown report: role=${role} stage=${stage}`);

  pool.useDatabase(DB());

  const { clause: scopeClause, params: scopeParams } = buildScopeClause({
    scopeMode: stageCfg.scopeMode,
    ship,
    command,
  });

  const officer = officerCols(stageCfg.officerFieldSet);
  let sql;
  let params;

  if (stageCfg.mode === "personalinfos_status") {
    const statusPlaceholders = stageCfg.personalinfoStatus.map(() => "?").join(",");
    const formStatusClause = stageCfg.formStatus ? "AND ef.status = ?" : "";
    const extraWhere = stageCfg.extraWhere ? `AND ${stageCfg.extraWhere}` : "";

    sql = `
      SELECT ${BASE_COLS}, ${officer.select},
             ef.submitted_at AS action_date,
             NULL            AS remarks
        FROM ef_personalinfos p
        LEFT JOIN ef_emolument_forms ef
               ON ef.service_no = p.serviceNumber
              AND ef.ship       = p.ship
       WHERE p.Status IN (${statusPlaceholders})
         ${formStatusClause}
         ${extraWhere}
         ${scopeClause}
       ORDER BY p.classes ASC, p.Surname ASC, p.OtherName ASC`;

    params = [
      ...stageCfg.personalinfoStatus,
      ...(stageCfg.formStatus ? [stageCfg.formStatus] : []),
      ...scopeParams,
    ];
  } else if (stageCfg.mode === "approval_trail") {
    const performerClause = stageCfg.filterByPerformer ? "AND fa.performed_by = ?" : "";

    sql = `
      SELECT ${BASE_COLS}, ${officer.select},
             fa.performed_at AS action_date,
             NULL            AS remarks
        FROM ef_form_approvals fa
        JOIN ef_emolument_forms ef ON ef.id = fa.form_id
        JOIN ef_personalinfos   p  ON p.serviceNumber = ef.service_no
                                   AND p.ship          = ef.ship
       WHERE fa.action = ?
         ${performerClause}
         ${scopeClause}
       ORDER BY p.classes ASC, p.Surname ASC, p.OtherName ASC`;

    params = [
      stageCfg.action,
      ...(stageCfg.filterByPerformer ? [performedBy] : []),
      ...scopeParams,
    ];
  } else if (stageCfg.mode === "rejection_trail") {
    const performerClause = stageCfg.filterByPerformer ? "AND r.rejected_by = ?" : "";

    sql = `
      SELECT ${BASE_COLS}, ${officer.select},
             r.rejected_at AS action_date,
             r.remarks     AS remarks
        FROM ef_form_rejections r
        JOIN ef_emolument_forms ef ON ef.id = r.form_id
        JOIN ef_personalinfos   p  ON p.serviceNumber = r.service_number
                                   AND p.ship          = ef.ship
       WHERE 1 = 1
         ${performerClause}
         ${scopeClause}
       ORDER BY p.classes ASC, p.Surname ASC, p.OtherName ASC`;
    // CONFIRM: ef_form_rejections is assumed to have a `rejected_at`
    // timestamp column (see fo.reports note in an earlier revision).
    // Rename here if yours differs (e.g. created_at).

    params = [
      ...(stageCfg.filterByPerformer ? [performedBy] : []),
      ...scopeParams,
    ];
  } else {
    throw new Error(`Unhandled report mode: ${stageCfg.mode}`);
  }

  const [rows] = await pool.query(sql, params);
  return rows;
}

// ─────────────────────────────────────────────────────────────
// FILTER OPTIONS — commands (CPO) and ships (CPO, optionally by
// command; DO/FO, restricted to the officer's own assigned ships
// by the service layer before calling this).
// ─────────────────────────────────────────────────────────────

// FROM EXISTING CODE: ef_commands + commandName confirmed via the join in
// fo.repository.js's getFormDetail ("LEFT JOIN ef_commands cmd ON cmd.code = p.command").
async function getCommands() {
  pool.useDatabase(DB());
  const [rows] = await pool.query(
    `SELECT code, commandName AS name FROM ef_commands ORDER BY commandName ASC`,
  );
  return rows;
}

// Ships aren't backed by their own lookup table anywhere in the code seen
// so far — p.ship is a plain string column on ef_personalinfos. Deriving
// the distinct list from there avoids guessing a table that may not
// exist; swap this for a real ef_ships table if you have one.
async function getShips({ command } = {}) {
  pool.useDatabase(DB());
  const params = [];
  let clause = "WHERE p.ship IS NOT NULL AND p.ship != ''";
  if (command) {
    clause += " AND p.command = ?";
    params.push(command);
  }
  const [rows] = await pool.query(
    `SELECT DISTINCT p.ship AS ship, p.command AS command
       FROM ef_personalinfos p
       ${clause}
      ORDER BY p.ship ASC`,
    params,
  );
  return rows;
}

module.exports = { getReportRows, getCommands, getShips };