// ─────────────────────────────────────────────────────────────
// tickets.service.js
// Business logic between routes and repo.
// ─────────────────────────────────────────────────────────────

const repo = require("./tickets.repository");

// ── Submit ticket (user) ─────────────────────────────────────
// Pulls identity from the decoded JWT user object so the
// frontend cannot spoof name / ship / rank.
async function submitTicket({ user, subject, body }) {
  if (!subject || !subject.trim()) {
    return { success: false, code: 400, message: "Subject is required." };
  }
  if (!body || !body.trim()) {
    return { success: false, code: 400, message: "Description is required." };
  }

  const id = await repo.createTicket({
    user_id: user.user_id || user.id || "",
    full_name: user.full_name || user.name || "",
    ship: user.ship || "",
    email: user.email || "",
    phone: user.phone || "",
    subject: subject.trim(),
    body: body.trim(),
  });

  return { success: true, data: { id } };
}

// ── My tickets (user self-service) ───────────────────────────
async function myTickets(user_id) {
  const rows = await repo.getUserTickets(user_id);
  return { success: true, data: rows };
}

// ── All tickets (admin) ───────────────────────────────────────
async function listTickets({ status, search, page, pageSize } = {}) {
  const result = await repo.getAllTickets({ status, search, page, pageSize });
  return { success: true, data: result };
}

// ── Respond to ticket (admin) ─────────────────────────────────
async function respond({ id, response, admin_name }) {
  if (!response || !response.trim()) {
    return { success: false, code: 400, message: "Response text is required." };
  }
  const affected = await repo.respondToTicket({
    id,
    response: response.trim(),
    responded_by: admin_name || "Admin",
  });
  if (!affected) {
    return { success: false, code: 404, message: "Ticket not found." };
  }
  return { success: true, message: "Response sent." };
}

// ── Close ticket (admin) ──────────────────────────────────────
async function closeTicket(id) {
  const affected = await repo.closeTicket(id);
  if (!affected) {
    return { success: false, code: 404, message: "Ticket not found." };
  }
  return { success: true, message: "Ticket closed." };
}

// ── Counts (admin dashboard badge) ───────────────────────────
async function counts() {
  const data = await repo.getTicketCounts();
  return { success: true, data };
}

module.exports = {
  submitTicket,
  myTickets,
  listTickets,
  respond,
  closeTicket,
  counts,
};
