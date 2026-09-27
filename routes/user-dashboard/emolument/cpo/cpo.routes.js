/**
 * FILE: routes/user-dashboard/emolument/cpo/cpo.routes.js
 *
 * Routes for CPO confirmation workflow.
 *
 * All routes: verifyToken + requireFormRole('CPO') or requireEmolRole('CPO')
 * EMOL_ADMIN passes all guards automatically.
 *
 * CPO is scoped by COMMAND — they see all ships under their command.
 *
 * ─── ROUTE MAP ───────────────────────────────────────────────
 *
 *  GET  /cpo/pending                     → list FO_APPROVED forms (by command)
 *  GET  /cpo/pending/:command            → list FO_APPROVED for specific command
 *  GET  /cpo/forms/:form_id             → view full form detail
 *  POST /cpo/forms/:form_id/confirm     → confirm → CPO_CONFIRMED + snapshot
 *  POST /cpo/forms/:form_id/reject      → reject → reset to NULL
 */

"use strict";

const express = require("express");
const router = express.Router();
const pool = require("../../../../config/db");
const config = require("../../../../config");
const verifyToken = require("../../../../middware/authentication");
const {
  requireEmolRole,
  requireFormRole,
} = require("../../../../middware/emolumentAuth");
const cpoService = require("./cpo.service");

const DB = () => process.env.DB_OFFICERS || config.databases.officers;

// Set DB context for all routes in this module
router.use((req, res, next) => {
  pool.useDatabase(DB());
  next();
});

// All routes require authentication
router.use(verifyToken);

// ─────────────────────────────────────────────────────────────
// HELPER — extract CPO's assigned commands from req.emolRoles
// Returns array of command codes, or 'ALL' if EMOL_ADMIN.
// ─────────────────────────────────────────────────────────────

// function resolveCpoCommands(req) {
//   if (req.isEmolAdmin) return "ALL";
//   return (req.emolRoles || [])
//     .filter(
//       (r) => r.role === "CPO" && r.scope_type === "COMMAND" && r.scope_value,
//     )
//     .map((r) => r.scope_value);
// }

function resolveCpoCommands(req) {
  if (req.isEmolAdmin) return "ALL";
  const hasCpo = (req.emolRoles || []).some((r) => r.role === "CPO");
  return hasCpo ? "ALL" : [];
}

// ─────────────────────────────────────────────────────────────
// GET /cpo/pending
// List all FO_APPROVED forms across all CPO's commands.
// requireEmolRole('CPO') — scope comes from the CPO's roles.
// ─────────────────────────────────────────────────────────────

// router.get("/pending", requireEmolRole("CPO"), async (req, res) => {
//   const commands = resolveCpoCommands(req);

//   // For scoped CPOs — collect all their commands and merge results
//   // For EMOL_ADMIN — query needs a command; return 400 if none scoped
//   if (commands !== "ALL" && commands.length === 0) {
//     return res.status(403).json({ error: "No command scope assigned." });
//   }

//   try {
//     // If EMOL_ADMIN, they should use /pending/:command to scope the query
//     if (commands === "ALL") {
//       return res.status(400).json({
//         error: "Please specify a command: GET /cpo/pending/:command",
//       });
//     }

//     // Fetch for all assigned commands in parallel
//     const results = await Promise.all(
//       commands.map((cmd) => cpoService.listFoApprovedForms(cmd)),
//     );

//     const merged = results.flatMap((r) => (r.success ? r.data : []));
//     return res.json(merged);
//   } catch (err) {
//     console.error("❌ GET /cpo/pending:", err);
//     return res.status(500).json({ error: "Server error" });
//   }
// });

router.get("/pending", requireEmolRole("CPO"), async (req, res) => {
  if (resolveCpoCommands(req).length === 0) {
    return res.status(403).json({ error: "No CPO role assigned." });
  }

  const {
    command = "",
    ship = "",
    classes = "",
    search = "",
    page = 1,
    limit,
  } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  try {
    const result = await cpoService.listFoApprovedForms(
      command,
      Number(limit),
      offset,
      search,
      ship,
      classes,
    );
    if (!result.success)
      return res.status(result.code).json({ error: result.message });
    return res.json(result.data);
  } catch (err) {
    console.error("❌ GET /cpo/pending:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /cpo/pending/:command
// List FO_APPROVED forms for a specific command.
// Used by EMOL_ADMIN and CPOs who want to filter by command.
// requireEmolRole('CPO') with command in params.
// INACTIVE
// ─────────────────────────────────────────────────────────────

router.get("/pending/:command", requireEmolRole("CPO"), async (req, res) => {
  const { command } = req.params;
  const cpoCommands = resolveCpoCommands(req);

  const { limit, page = 1, search = "", ship = "", classes = "" } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  if (cpoCommands !== "ALL" && !cpoCommands.includes(command)) {
    return res.status(403).json({
      error: `Access denied. Command '${command}' is not under your scope.`,
    });
  }

  try {
    const result = await cpoService.listFoApprovedForms(
      command,
      Number(limit),
      offset,
      search,
      ship,
      classes,
    );
    if (!result.success)
      return res.status(result.code).json({ error: result.message });
    return res.json(result.data);
  } catch (err) {
    console.error("❌ GET /cpo/pending/:command:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /cpo/forms/:form_id
// View full form detail before confirming.
// requireFormRole resolves command from ef_emolument_forms.
// ─────────────────────────────────────────────────────────────

router.get("/forms/:form_id", requireFormRole("CPO"), async (req, res) => {
  const formId = Number(req.params.form_id);
  const cpoCommands = resolveCpoCommands(req);

  if (!Number.isInteger(formId) || formId < 1) {
    return res.status(400).json({ error: "Invalid form ID." });
  }

  try {
    const result = await cpoService.getForm(formId, cpoCommands);
    if (!result.success)
      return res.status(result.code).json({ error: result.message });
    return res.json(result.data);
  } catch (err) {
    console.error("❌ GET /cpo/forms/:form_id:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /cpo/forms/:form_id/confirm
// Confirm form. CPO's svcno comes from req.user_id.
// Writes full snapshot to ef_emolument_forms.snapshot.
// No body required — CPO identity is the confirmation.
// ─────────────────────────────────────────────────────────────

router.post(
  "/forms/:form_id/confirm",
  requireFormRole("CPO"),
  async (req, res) => {
    const formId = Number(req.params.form_id);

    if (!Number.isInteger(formId) || formId < 1) {
      return res.status(400).json({ error: "Invalid form ID." });
    }

    // For scoped CPO — resolve command from formScope attached by requireFormRole
    const cpoCommand = req.isEmolAdmin ? "ALL" : req.formScope?.command || null;

    if (!cpoCommand) {
      return res
        .status(403)
        .json({ error: "Command scope could not be resolved." });
    }

    try {
      const result = await cpoService.confirmForm(
        formId,
        cpoCommand,
        {
          cpo_svcno: req.user_id,
          cpo_name: req.user_name,
          cpo_rank: req.user_rank,
        },
        req.ip,
      );
      if (!result.success)
        return res.status(result.code).json({ error: result.message });
      return res.json({ message: result.message, data: result.data });
    } catch (err) {
      console.error("❌ POST /cpo/forms/:form_id/confirm:", err);
      return res.status(500).json({ error: "Server error" });
    }
  },
);

// ─────────────────────────────────────────────────────────────
// POST /cpo/forms/:form_id/reject
// Reject a FO_APPROVED form. Resets to NULL.
// Body: { remarks }
// ─────────────────────────────────────────────────────────────

router.post(
  "/forms/:form_id/reject",
  requireFormRole("CPO"),
  async (req, res) => {
    const formId = Number(req.params.form_id);

    if (!Number.isInteger(formId) || formId < 1) {
      return res.status(400).json({ error: "Invalid form ID." });
    }

    if (!req.body?.remarks?.trim()) {
      return res
        .status(400)
        .json({ error: "Rejection reason (remarks) is required." });
    }

    const cpoCommand = req.isEmolAdmin ? "ALL" : req.formScope?.command || null;

    if (!cpoCommand) {
      return res
        .status(403)
        .json({ error: "Command scope could not be resolved." });
    }

    try {
      const result = await cpoService.rejectForm(
        formId,
        cpoCommand,
        req.body,
        {
          cpo_svcno: req.user_id,
          cpo_name: req.user_name,
          cpo_rank: req.user_rank,
        },
        req.ip,
      );
      if (!result.success)
        return res.status(result.code).json({ error: result.message });
      return res.json({ message: result.message, data: result.data });
    } catch (err) {
      console.error("❌ POST /cpo/forms/:form_id/reject:", err);
      return res.status(500).json({ error: "Server error" });
    }
  },
);

// ─────────────────────────────────────────────────────────────
// BULK CONFIRM — selected form numbers
// POST /cpo/:command/confirm/bulk [OLD]
// POST /cpo/confirm/bulk
// Body: { selected: string[] }
// ─────────────────────────────────────────────────────────────

// router.post(
//   "/:command/confirm/bulk",
//   requireEmolRole("CPO"),
//   async (req, res) => {
//     const command = req.params.command;

//     const cpoCommand = req.params.command || req.formScope?.command;

//     if (!cpoCommand) {
//       return res
//         .status(403)
//         .json({ error: "Command scope could not be resolved." });
//     }

//     try {
//       const result = await cpoService.confirmBulk(
//         req.body,
//         {
//           cpo_svcno: req.user_id,
//           cpo_name: req.user_name,
//           cpo_rank: req.user_rank,
//         },
//         cpoCommand,
//         req.ip,
//       );
//       if (!result.success)
//         return res.status(result.code).json({ error: result.message });
//       return res.json({ message: result.message, data: result.data });
//     } catch (err) {
//       console.error("❌ POST /cpo/ships/:ship/confirm/bulk:", err);
//       return res.status(500).json({ error: "Server error" });
//     }
//   },
// );

router.post("/confirm/bulk", requireEmolRole("CPO"), async (req, res) => {
  try {
    const result = await cpoService.confirmBulk(
      req.body,
      {
        cpo_svcno: req.user_id,
        cpo_name: req.user_name,
        cpo_rank: req.user_rank,
      },
      "ALL",
      req.ip,
    );
    if (!result.success)
      return res.status(result.code).json({ error: result.message });
    return res.json({ message: result.message, data: result.data });
  } catch (err) {
    console.error("❌ POST /cpo/confirm/bulk:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ─────────────────────────────────────────────────────────────
// CLASS CONFIRM — all forms of a given class
// POST /cpo/:command/confirm/class[OLD]
// POST /cpo/confirm/class
// Body: { classes: 1 | 2 | 3 }
// ─────────────────────────────────────────────────────────────

// router.post(
//   "/:command/confirm/class",
//   requireEmolRole("CPO"),
//   async (req, res) => {
//     const command = req.params.command || req.formScope?.command;

//     const cpoCommand = req.params.command || req.formScope?.command;

//     if (!cpoCommand) {
//       return res
//         .status(403)
//         .json({ error: "Command scope could not be resolved." });
//     }

//     try {
//       const result = await cpoService.confirmClass(
//         command,
//         req.body,
//         {
//           cpo_svcno: req.user_id,
//           cpo_name: req.user_name,
//           cpo_rank: req.user_rank,
//         },
//         cpoCommand,
//         req.ip,
//       );
//       if (!result.success)
//         return res.status(result.code).json({ error: result.message });
//       return res.json({ message: result.message, data: result.data });
//     } catch (err) {
//       console.error("❌ POST /cpo/ships/:ship/confirm/class:", err);
//       return res.status(500).json({ error: "Server error" });
//     }
//   },
// );

router.post("/confirm/class", requireEmolRole("CPO"), async (req, res) => {
  try {
    const result = await cpoService.confirmClass(
      req.body, // { classes, command? }
      {
        cpo_svcno: req.user_id,
        cpo_name: req.user_name,
        cpo_rank: req.user_rank,
      },
      "ALL",
      req.ip,
    );
    if (!result.success)
      return res.status(result.code).json({ error: result.message });
    return res.json({ message: result.message, data: result.data });
  } catch (err) {
    console.error("❌ POST /cpo/confirm/class:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /cpo/confirmed
// List all FO_APPROVED forms across all CPO's commands.
// requireEmolRole('CPO') — scope comes from the CPO's roles.
// ─────────────────────────────────────────────────────────────

// router.get("/confirmed", requireEmolRole("CPO"), async (req, res) => {
//   const commands = resolveCpoCommands(req);

//   const { limit, page = 1 } = req.query;
//   const offset = (Number(page) - 1) * Number(limit);

//   // For scoped CPOs — collect all their commands and merge results
//   // For EMOL_ADMIN — query needs a command; return 400 if none scoped
//   if (commands !== "ALL" && commands.length === 0) {
//     return res.status(403).json({ error: "No command scope assigned." });
//   }

//   try {
//     // If EMOL_ADMIN, they should use /confirmed/:command to scope the query
//     if (commands === "ALL") {
//       return res.status(400).json({
//         error: "Please specify a command: GET /cpo/confirmed/:command",
//       });
//     }

//     // Fetch for all assigned commands in parallel
//     const results = await Promise.all(
//       commands.map((cmd) =>
//         cpoService.listFoApprovedForms(cmd, Number(limit), offset),
//       ),
//     );

//     const merged = results.flatMap((r) => (r.success ? r.data : []));
//     return res.json(merged);
//   } catch (err) {
//     console.error("❌ GET /cpo/confirmed:", err);
//     return res.status(500).json({ error: "Server error" });
//   }
// });

router.get("/confirmed", requireEmolRole("CPO"), async (req, res) => {
  const {
    command = "",
    ship = "",
    classes = "",
    search = "",
    page = 1,
    limit,
  } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  try {
    const result = await cpoService.listConfirmedForms(
      command,
      Number(limit),
      offset,
      search,
      ship,
      classes,
    );
    if (!result.success)
      return res.status(result.code).json({ error: result.message });
    return res.json(result.data);
  } catch (err) {
    console.error("❌ GET /cpo/confirmed:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /cpo/confirmed/:command[OLD]
// GET /cpo/confirmed
// List FO_APPROVED forms for a specific command.
// Used by EMOL_ADMIN and CPOs who want to filter by command.
// requireEmolRole('CPO') with command in params.
// INACTIVE
// ─────────────────────────────────────────────────────────────

// router.get("/confirmed/:command", requireEmolRole("CPO"), async (req, res) => {
//   const { command } = req.params;
//   const cpoCommands = resolveCpoCommands(req);
//   const svc = req.user_id;

//   const { limit, page = 1, search = "", ship = "", classes = "" } = req.query;
//   const offset = (Number(page) - 1) * Number(limit);

//   if (cpoCommands !== "ALL" && !cpoCommands.includes(command)) {
//     return res.status(403).json({
//       error: `Access denied. Command '${command}' is not under your scope.`,
//     });
//   }

//   try {
//     const result = await cpoService.listConfirmedForms(
//       command,
//       svc,
//       Number(limit),
//       offset,
//       search,
//       ship,
//       classes,
//     );
//     if (!result.success)
//       return res.status(result.code).json({ error: result.message });
//     return res.json(result.data);
//   } catch (err) {
//     console.error("❌ GET /cpo/confirmed/:command:", err);
//     return res.status(500).json({ error: "Server error" });
//   }
// });

router.get("/confirmed", requireEmolRole("CPO"), async (req, res) => {
  const {
    command = "",
    ship = "",
    classes = "",
    search = "",
    page = 1,
    limit,
  } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const svc = req.user_id;

  try {
    const result = await cpoService.listConfirmedForms(
      command,
      svc,
      Number(limit),
      offset,
      search,
      ship,
      classes,
    );
    if (!result.success)
      return res.status(result.code).json({ error: result.message });
    return res.json(result.data);
  } catch (err) {
    console.error("❌ GET /cpo/confirmed:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /cpo/command/:command/stats  [OLD]
// GET /cpo/stats
// List status statistics for forms in a command.
// requireEmolRole('CPO') with command in params.
// ─────────────────────────────────────────────────────────────

// router.get(
//   "/command/:command/stats",
//   requireEmolRole("CPO"),
//   async (req, res) => {
//     const { command } = req.params;
//     const svc = req.user_id; // Use CPO's service number to get their specific stats if needed
//     try {
//       const result = await cpoService.getStatusStats(command, svc);
//       if (!result.success)
//         return res.status(result.code).json({ error: result.message });
//       return res.json(result.data);
//     } catch (err) {
//       console.error("❌ GET /cpo/command/:command/stats:", err);
//       return res.status(500).json({ error: "Server error" });
//     }
//   },
// );

router.get("/stats", requireEmolRole("CPO"), async (req, res) => {
  // const { command = "" } = req.query;
  const svc = req.user_id;
  try {
    const result = await cpoService.getStatusStats(svc);
    if (!result.success)
      return res.status(result.code).json({ error: result.message });
    return res.json(result.data);
  } catch (err) {
    console.error("❌ GET /cpo/stats:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /cpo/dashboard
// List dashboard statistics for forms in all commands.
// requireEmolRole('CPO') with command in params.
// ─────────────────────────────────────────────────────────────

router.get("/dashboard", requireEmolRole("CPO"), async (req, res) => {
  try {
    const result = await cpoService.getDashboard();
    if (!result.success)
      return res.status(result.code).json({ error: result.message });
    return res.json(result.data);
  } catch (err) {
    console.error("❌ GET /cpo/dashboard:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
