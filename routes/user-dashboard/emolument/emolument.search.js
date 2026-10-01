/**
 * FILE: routes/user-dashboard/emolument/emolument.search.js
 *
 * Shared free-text search helpers for the emolument module.
 *
 * ─── WHY THIS EXISTS ───────────────────────────────────────
 * The admin search boxes (personnel.html "Search / Update" + "List",
 * accept-verified.html filter bar) used to guess whether the typed text
 * was a name or a service number with `/^[A-Za-z]\d/i` and then filter on
 * exactly ONE column.  Real service numbers are typed in several shapes:
 *
 *     NN/0001      NN0001      nn-0001      000001
 *
 * None of the first three satisfy that regex (second character is a letter,
 * not a digit) and the last one does not start with a letter, so every
 * service-number search silently degraded into a name lookup and came back
 * empty.
 *
 * Every search box now sends a single `q` parameter and the SQL built here
 * matches it against the name columns AND the service number at the same
 * time, normalising both sides so the separator style the admin happens to
 * type is irrelevant.
 *
 * ─── CONVENTIONS ───────────────────────────────────────────
 * • Names  → substring LIKE on Surname and OtherName, the same convention
 *            fo.repository.js and accept-verified.repository.js already use
 *            (so 'Adam' still finds OtherName = 'John Adam').
 * • Svc no → prefix LIKE on the raw column (keeps the serviceNumber index
 *            usable) PLUS a prefix/suffix LIKE on a separator-stripped,
 *            upper-cased copy of the column.
 * • User input is LIKE-escaped, so a typed '%' or '_' is matched literally
 *   instead of acting as a wildcard.
 */

"use strict";

// Characters treated as formatting noise inside a service number.
// MUST stay in sync with normalizedServiceNumberSql() below — the JS side
// normalises the search term, the SQL side normalises the stored value, and
// the two have to agree or the comparison silently misses.
const SVC_NO_SEPARATORS = [" ", "/", "-", ".", "_"];

// ─────────────────────────────────────────────────────────────
// PRIMITIVES
// ─────────────────────────────────────────────────────────────

/**
 * Escape LIKE wildcards in user-supplied text.
 * MySQL's default LIKE escape character is the backslash.
 *
 * @param {*} value
 * @returns {string}
 */
function escapeLike(value) {
  return String(value ?? "").replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Reduce a service number to the core used for comparison.
 *
 *   'NN/0001'   → 'NN0001'
 *   'nn - 0001' → 'NN0001'
 *   '000001'    → '000001'
 *
 * @param {*} value
 * @returns {string}
 */
function normalizeServiceNumber(value) {
  let out = String(value ?? "").trim().toUpperCase();
  for (const sep of SVC_NO_SEPARATORS) out = out.split(sep).join("");
  return out;
}

/**
 * SQL expression that normalises the STORED service number exactly the way
 * normalizeServiceNumber() normalises the search term.
 *
 * Nested REPLACE() rather than REGEXP_REPLACE() so it also works on
 * MySQL 5.7 / MariaDB deployments.
 *
 * @param {string} [alias='p'] — table alias carrying `serviceNumber`
 * @returns {string}
 */
function normalizedServiceNumberSql(alias = "p") {
  return SVC_NO_SEPARATORS.reduce(
    (expr, sep) => `REPLACE(${expr}, '${sep}', '')`,
    `UPPER(${alias}.serviceNumber)`,
  );
}

// ─────────────────────────────────────────────────────────────
// FRAGMENT BUILDERS
// Each returns { parts: string[], params: any[] } so the public helpers
// below can freely combine name and service-number branches.
// ─────────────────────────────────────────────────────────────

function nameFragments(term, alias) {
  const raw = String(term ?? "").trim();
  if (!raw) return { parts: [], params: [] };

  const like = `%${escapeLike(raw)}%`;
  return {
    parts: [`${alias}.Surname LIKE ?`, `${alias}.OtherName LIKE ?`],
    params: [like, like],
  };
}

function serviceNumberFragments(term, alias) {
  const raw = String(term ?? "").trim();
  if (!raw) return { parts: [], params: [] };

  // Branch 1 — the column exactly as stored/typed. Prefix match so the
  // serviceNumber index can still be chosen when the admin types the
  // stored shape.
  const parts = [`${alias}.serviceNumber LIKE ?`];
  const params = [`${escapeLike(raw)}%`];

  // Branch 2 — separators ignored, so NN/0001, NN0001 and nn-0001 all
  // resolve to the same row whichever shape is stored.
  const normalized = normalizeServiceNumber(raw);
  if (normalized) {
    const column = normalizedServiceNumberSql(alias);
    const like = escapeLike(normalized);

    if (/^\d+$/.test(normalized)) {
      // Pure digits ('000001') are normally the numeric tail of a prefixed
      // number ('NN/000001'), so match either end of the normalized value.
      parts.push(`${column} LIKE ?`, `${column} LIKE ?`);
      params.push(`${like}%`, `%${like}`);
    } else {
      parts.push(`${column} LIKE ?`);
      params.push(`${like}%`);
    }
  }

  return { parts, params };
}

// ─────────────────────────────────────────────────────────────
// PUBLIC HELPERS
//
// All three return { sql, params } where `sql` is '' for an empty term, so
// callers can build a condition list without special-casing blanks.
// ─────────────────────────────────────────────────────────────

/**
 * One search box → matches name OR service number.
 * This is what `?q=` means on /admin/personnel.
 *
 * @param {string} term
 * @param {string} [alias='p']
 * @returns {{ sql: string, params: any[] }}
 */
function buildNameOrServiceNumberClause(term, alias = "p") {
  const names = nameFragments(term, alias);
  const svcNos = serviceNumberFragments(term, alias);
  const parts = [...names.parts, ...svcNos.parts];
  if (!parts.length) return { sql: "", params: [] };

  return { sql: `(${parts.join(" OR ")})`, params: [...names.params, ...svcNos.params] };
}

/**
 * Service-number-only filter (`?serviceNumber=`).
 * Separator-tolerant, unlike a plain prefix LIKE.
 *
 * @param {string} value
 * @param {string} [alias='p']
 * @returns {{ sql: string, params: any[] }}
 */
function buildServiceNumberClause(value, alias = "p") {
  const { parts, params } = serviceNumberFragments(value, alias);
  if (!parts.length) return { sql: "", params: [] };
  return { sql: `(${parts.join(" OR ")})`, params };
}

/**
 * Name-only filter (`?surname=`), matched against both name columns.
 *
 * @param {string} value
 * @param {string} [alias='p']
 * @returns {{ sql: string, params: any[] }}
 */
function buildNameClause(value, alias = "p") {
  const { parts, params } = nameFragments(value, alias);
  if (!parts.length) return { sql: "", params: [] };
  return { sql: `(${parts.join(" OR ")})`, params };
}

module.exports = {
  escapeLike,
  normalizeServiceNumber,
  normalizedServiceNumberSql,
  buildNameOrServiceNumberClause,
  buildServiceNumberClause,
  buildNameClause,
};
