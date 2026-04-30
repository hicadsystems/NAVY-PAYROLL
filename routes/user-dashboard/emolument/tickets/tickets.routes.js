// ─────────────────────────────────────────────────────────────
// tickets.router.js
// Mount at:  app.use('/tickets', ticketsRouter)
// ─────────────────────────────────────────────────────────────

const express = require("express");
const router = express.Router();
const svc = require("./tickets.service");

// Middleware assumed available in scope — import as needed:
// const { requireAuth, requireAnyEmolRole } = require('../middleware/auth');

// ─────────────────────────────────────────────────────────────
// USER ROUTES  (any authenticated personnel)
// ─────────────────────────────────────────────────────────────

// POST /tickets — submit a new ticket
router.post("/", requireAuth, async (req, res) => {
  try {
    const { subject, body } = req.body;
    const result = await svc.submitTicket({ user: req.user, subject, body });
    if (!result.success)
      return res.status(result.code).json({ error: result.message });
    return res.status(201).json(result);
  } catch (err) {
    console.error("❌ POST /tickets:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// GET /tickets/mine — logged-in user sees their own tickets
router.get("/mine", requireAuth, async (req, res) => {
  try {
    const user_id = req.user.user_id || req.user.id;
    const result = await svc.myTickets(user_id);
    return res.json(result.data);
  } catch (err) {
    console.error("❌ GET /tickets/mine:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ─────────────────────────────────────────────────────────────
// ADMIN ROUTES  (elevated roles only)
// ─────────────────────────────────────────────────────────────

// GET /tickets — all tickets, with optional ?status=&search=&page=&pageSize=
router.get("/", requireAnyEmolRole, async (req, res) => {
  try {
    const { status, search, page = 1, pageSize = 30 } = req.query;
    const result = await svc.listTickets({
      status,
      search,
      page: Number(page),
      pageSize: Number(pageSize),
    });
    return res.json(result.data);
  } catch (err) {
    console.error("❌ GET /tickets:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// GET /tickets/counts — badge counts for admin dashboard
router.get("/counts", requireAnyEmolRole, async (req, res) => {
  try {
    const result = await svc.counts();
    return res.json(result.data);
  } catch (err) {
    console.error("❌ GET /tickets/counts:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// POST /tickets/:id/respond — admin sends a response
router.post("/:id/respond", requireAnyEmolRole, async (req, res) => {
  try {
    const { response } = req.body;
    const admin_name = req.user.full_name || req.user.name || "Admin";
    const result = await svc.respond({
      id: Number(req.params.id),
      response,
      admin_name,
    });
    if (!result.success)
      return res.status(result.code).json({ error: result.message });
    return res.json({ message: result.message });
  } catch (err) {
    console.error("❌ POST /tickets/:id/respond:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// PATCH /tickets/:id/close — admin closes a ticket
router.patch("/:id/close", requireAnyEmolRole, async (req, res) => {
  try {
    const result = await svc.closeTicket(Number(req.params.id));
    if (!result.success)
      return res.status(result.code).json({ error: result.message });
    return res.json({ message: result.message });
  } catch (err) {
    console.error("❌ PATCH /tickets/:id/close:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;