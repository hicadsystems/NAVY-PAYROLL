const express = require("express");
const router = express.Router();
const pool = require("../../config/db");
const verifyToken = require("../../middware/authentication");

// NOTE: No pool.useDatabase() needed here.
// The pool's default/main DB (hicad_messages) handles all queries.
// User is authenticated via Login 1 token — no class scope required.

// ══════════════════════════════════════════════════════════
// POST /api/messages — Send a message
//
// FIX 2: from_email is now fetched fresh from users table at
// send time, so the stored email is always accurate regardless
// of what the token carries. This ensures it always shows in
// the read view even if req.email is empty.
// ══════════════════════════════════════════════════════════
router.post("/", verifyToken, async (req, res) => {
  const { to_user_id, to_name, subject, body } = req.body;

  if (!to_user_id || !subject || !body) {
    return res
      .status(400)
      .json({ error: "Recipient, subject and body are required" });
  }

  try {
    // FIX 2: Always pull sender's email from users table — never rely solely on token
    const [[sender]] = await pool.query(
      "SELECT email FROM users WHERE user_id = ? LIMIT 1",
      [req.user_id],
    );
    const fromEmail = sender && sender.email ? sender.email : req.email || "";

    await pool.query(
      `INSERT INTO user_mails (from_user_id, from_name, from_email, to_user_id, to_name, subject, body)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user_id,
        req.user_fullname,
        fromEmail,
        to_user_id,
        to_name,
        subject,
        body,
      ],
    );

    res.status(201).json({ message: "✅ Message sent" });
  } catch (err) {
    console.error("❌ Send message error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// ══════════════════════════════════════════════════════════
// GET /api/messages/inbox — Get received messages
// Polling mode: pass ?since=DATETIME to get only new ones
// ══════════════════════════════════════════════════════════
router.get("/inbox", verifyToken, async (req, res) => {
  const { since, page = 1, limit = 20 } = req.query;

  try {
    let rows;

    if (since) {
      [rows] = await pool.query(
        `SELECT id, from_user_id, from_name, from_email, subject, body, is_read, sent_at
        FROM user_mails
        WHERE to_user_id = ? AND sent_at > ? AND deleted_by_receiver = FALSE
        ORDER BY sent_at DESC`,
        [req.user_id, since],
      );
    } else {
      const offset = (parseInt(page) - 1) * parseInt(limit);
      [rows] = await pool.query(
        `SELECT id, from_user_id, from_name, from_email, subject, body, is_read, sent_at
        FROM user_mails
        WHERE to_user_id = ? AND deleted_by_receiver = FALSE
        ORDER BY sent_at DESC
        LIMIT ? OFFSET ?`,
        [req.user_id, parseInt(limit), offset],
      );
    }

    const [[{ unread }]] = await pool.query(
      "SELECT COUNT(*) as unread FROM user_mails WHERE to_user_id = ? AND is_read = 0 AND deleted_by_receiver = FALSE",
      [req.user_id],
    );

    res.json({ messages: rows, unread });
  } catch (err) {
    console.error("❌ Inbox error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// ══════════════════════════════════════════════════════════
// GET /api/messages/sent — Get sent messages
// ══════════════════════════════════════════════════════════
router.get("/sent", verifyToken, async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    const [rows] = await pool.query(
      `SELECT id, to_user_id, to_name, subject, body, sent_at
      FROM user_mails
      WHERE from_user_id = ? AND deleted_by_sender = FALSE AND is_notification = FALSE
      ORDER BY sent_at DESC
      LIMIT ? OFFSET ?`,
      [req.user_id, parseInt(limit), offset]
    );

    res.json({ messages: rows });
  } catch (err) {
    console.error("❌ Sent error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// ══════════════════════════════════════════════════════════
// GET /messages/sent-item/:id — Get single sent message (sender view)
// ══════════════════════════════════════════════════════════
router.get("/sent-item/:id", verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM user_mails WHERE id = ? AND from_user_id = ?",
      [req.params.id, req.user_id],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Message not found" });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("❌ Get sent message error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// ══════════════════════════════════════════════════════════
// GET /messages/:id — Open single inbox message + mark as read
// ══════════════════════════════════════════════════════════
router.get("/:id", verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM user_mails WHERE id = ? AND to_user_id = ?",
      [req.params.id, req.user_id],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Message not found" });
    }

    await pool.query("UPDATE user_mails SET is_read = 1 WHERE id = ?", [
      req.params.id,
    ]);

    res.json(rows[0]);
  } catch (err) {
    console.error("❌ Get message error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// ══════════════════════════════════════════════════════════
// DELETE /api/messages/:id — Delete a message
// Sender can delete for self or all;
// receiver can only delete for self
// ══════════════════════════════════════════════════════════
router.delete("/:id", verifyToken, async (req, res) => {
  const mode = req.query.mode || "me"; // 'me' or 'all'

  try {
    // 1. Fetch message details
    const [msgs] = await pool.query(
      "SELECT from_user_id, to_user_id, from_name, deleted_by_receiver FROM user_mails WHERE id = ?",
      [req.params.id],
    );

    if (!msgs.length) {
      return res.status(404).json({ error: "Message not found" });
    }

    const msg        = msgs[0];
    const isSender   = msg.from_user_id === req.user_id;
    const isReceiver = msg.to_user_id   === req.user_id;

    if (!isSender && !isReceiver) {
      return res
        .status(403)
        .json({ error: "Not authorized to delete this message" });
    }

    // 2. Handle receiver deletion (only "delete for me" allowed)
    if (isReceiver && !isSender) {
      await pool.query(
        "UPDATE user_mails SET deleted_by_receiver = TRUE WHERE id = ?",
        [req.params.id],
      );
      return res.json({ message: "✅ Message deleted from your inbox" });
    }

    // 3. Handle sender deletion
    if (isSender) {
      if (mode === "me") {
        await pool.query(
          "UPDATE user_mails SET deleted_by_sender = TRUE WHERE id = ?",
          [req.params.id],
        );
        return res.json({
          message: "✅ Message deleted from your sent folder",
        });
      } else if (mode === "all") {
        // Mark deleted for both parties
        await pool.query(
          "UPDATE user_mails SET deleted_by_sender = TRUE, deleted_by_receiver = TRUE WHERE id = ?",
          [req.params.id],
        );

        // Only notify the receiver if they haven't already deleted the message
        // themselves — no point notifying about a message they've already removed.
        if (!msg.deleted_by_receiver) {
          const [[toUser]] = await pool.query(
            "SELECT full_name FROM users WHERE user_id = ?",
            [msg.to_user_id],
          );

          await pool.query(
            `INSERT INTO user_mails (from_user_id, from_name, to_user_id, to_name, subject, body, is_notification)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              req.user_id,
              req.user_fullname,
              msg.to_user_id,
              toUser ? toUser.full_name : "Recipient",
              "Message Deleted",
              `${req.user_fullname} deleted a message from your conversation`,
              true,
            ],
          );
        }

        return res.json({ message: "✅ Message deleted for all" });
      }
    }
  } catch (err) {
    console.error("❌ Delete message error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// ══════════════════════════════════════════════════════════
// GET /api/messages/users/search?q= — Search recipients
// All users exist in DB_OFFICERS — single DB query, no loop
// ══════════════════════════════════════════════════════════
router.get("/users/search", verifyToken, async (req, res) => {
  const { q } = req.query;

  if (!q || q.trim().length < 2) {
    return res
      .status(400)
      .json({ error: "Search query must be at least 2 characters" });
  }

  try {
    const [rows] = await pool.query(
      `SELECT user_id, full_name, email
       FROM users
       WHERE (full_name LIKE ? OR user_id LIKE ? OR email LIKE ?)
       AND status = 'active'
       AND user_id != ?
       LIMIT 20`,
      [`%${q}%`, `%${q}%`, `%${q}%`, req.user_id],
    );

    res.json({ users: rows });
  } catch (err) {
    console.error("❌ User search error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

module.exports = router;