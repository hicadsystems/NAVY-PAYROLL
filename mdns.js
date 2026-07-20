/**
 * Navy Payroll - mDNS Responder
 * Advertises navypayroll.local on the LAN automatically.
 * Works on WiFi AND Ethernet — no client config needed.
 *
 * Run standalone : node mdns.js
 * Run as service : added automatically via install-service.js
 */

const os = require("os");
const dgram = require("dgram");
const path = require("path");
const dotenv = require("dotenv");

const envFile =
  process.env.NODE_ENV === "production" ? ".env.production" : ".env.local";
dotenv.config({ path: path.resolve(__dirname, envFile) });

const DOMAIN =
  (process.env.LOCAL_DOMAIN || "navypayroll.local").replace(/\.$/, "") + ".";
const MDNS_ADDR = "224.0.0.251";
const MDNS_PORT = 5353;

// ── Get all LAN IPs (IPv4 only, skip loopback) ────────────
function getLanIPs() {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const iface of Object.values(ifaces)) {
    for (const addr of iface) {
      if (addr.family === "IPv4" && !addr.internal) {
        ips.push(addr.address);
      }
    }
  }
  return ips;
}

// ── Build a DNS A-record response packet ──────────────────
function buildResponse(name, ip, id = 0) {
  // Encode DNS name: navypayroll.local. → \x0bnavypayroll\x05local\x00
  const encodeName = (n) => {
    const buf = [];
    for (const label of n.replace(/\.$/, "").split(".")) {
      buf.push(label.length, ...Buffer.from(label));
    }
    buf.push(0);
    return Buffer.from(buf);
  };

  const nameBuf = encodeName(name);
  const ipParts = ip.split(".").map(Number);

  // DNS header (12 bytes)
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0); // Transaction ID
  header.writeUInt16BE(0x8400, 2); // Flags: Response, Authoritative
  header.writeUInt16BE(0, 4); // Questions: 0
  header.writeUInt16BE(1, 6); // Answer RRs: 1
  header.writeUInt16BE(0, 8); // Authority RRs: 0
  header.writeUInt16BE(0, 10); // Additional RRs: 0

  // DNS Answer record
  const rdata = Buffer.from(ipParts); // 4 bytes for IP
  const answer = Buffer.alloc(nameBuf.length + 10 + rdata.length);
  let offset = 0;
  nameBuf.copy(answer, offset);
  offset += nameBuf.length;
  answer.writeUInt16BE(0x0001, offset);
  offset += 2; // Type: A
  answer.writeUInt16BE(0x8001, offset);
  offset += 2; // Class: IN + cache-flush
  answer.writeUInt32BE(120, offset);
  offset += 4; // TTL: 120 seconds
  answer.writeUInt16BE(4, offset);
  offset += 2; // RDLENGTH: 4
  rdata.copy(answer, offset);

  return Buffer.concat([header, answer]);
}

// ── Parse incoming DNS question ───────────────────────────
function parseQuestion(msg) {
  try {
    const qdCount = msg.readUInt16BE(4);
    if (qdCount === 0) return null;

    let offset = 12;
    const labels = [];
    while (offset < msg.length) {
      const len = msg[offset++];
      if (len === 0) break;
      if ((len & 0xc0) === 0xc0) {
        offset++;
        break;
      } // pointer
      labels.push(msg.slice(offset, offset + len).toString());
      offset += len;
    }
    const qtype = msg.readUInt16BE(offset);
    const id = msg.readUInt16BE(0);
    return { name: labels.join(".") + ".", qtype, id };
  } catch {
    return null;
  }
}

// ── Join the multicast group on EVERY LAN interface ───────
// socket.addMembership(addr) with no second argument only joins on
// whichever interface the OS treats as the default route — on a
// dual-homed machine (e.g. Ethernet intranet + Wi-Fi internet) that's
// almost always the Wi-Fi side, since that's where the default gateway
// lives. Queries arriving on Ethernet would then never reach this
// socket at all. Joining explicitly per-interface fixes that.
function joinAllInterfaces(socket, ips) {
  for (const ip of ips) {
    try {
      socket.addMembership(MDNS_ADDR, ip);
      console.log(`[OK] Joined multicast group on ${ip}`);
    } catch (err) {
      // Can happen on virtual/loopback-like adapters that don't
      // support multicast — safe to skip, not fatal.
      console.warn(`⚠️  Could not join multicast on ${ip}: ${err.message}`);
    }
  }
}

// ── Send a response out of a SPECIFIC interface ───────────
// Looping IPs into the DNS payload alone doesn't change which network
// card the UDP packet actually leaves through — that's controlled
// separately by setMulticastInterface(). Both need to be set per-IP
// for replies to actually reach clients on every segment.
function sendOn(socket, ip, id) {
  try {
    socket.setMulticastInterface(ip);
  } catch (err) {
    console.warn(`⚠️  Could not set multicast interface ${ip}: ${err.message}`);
    return;
  }
  const response = buildResponse(DOMAIN, ip, id);
  socket.send(response, 0, response.length, MDNS_PORT, MDNS_ADDR, (err) => {
    if (err) console.error(`❌ Send error (${ip}):`, err.message);
  });
}

// ── Main ──────────────────────────────────────────────────
console.log("Navy Payroll — mDNS Responder");
console.log("==============================");
console.log(`Domain  : ${DOMAIN}`);

const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

socket.on("error", (err) => {
  console.error("❌ mDNS socket error:", err.message);
  if (err.code === "EACCES") {
    console.error("   Port 5353 requires elevated privileges.");
    console.error("   Run this service as Administrator.");
  }
  process.exit(1);
});

socket.on("message", (msg, rinfo) => {
  const q = parseQuestion(msg);
  if (!q) return;

  // Only respond to A-record (1) or ANY (255) queries for our domain
  if (q.qtype !== 1 && q.qtype !== 255) return;
  if (q.name.toLowerCase() !== DOMAIN.toLowerCase()) return;

  const ips = getLanIPs();
  if (ips.length === 0) {
    console.warn("⚠️  No LAN IPs found — skipping response");
    return;
  }

  console.log(
    `[${new Date().toISOString()}] Query from ${rinfo.address} for ${q.name} → responding with ${ips.join(", ")}`,
  );

  // Send one response per interface, explicitly routed out that interface
  for (const ip of ips) {
    sendOn(socket, ip, q.id);
  }
});

socket.bind(MDNS_PORT, () => {
  socket.setMulticastTTL(255);
  socket.setMulticastLoopback(true);

  const ips = getLanIPs();
  console.log(`LAN IPs : ${ips.join(", ") || "none found"}`);
  joinAllInterfaces(socket, ips);
  console.log(`Listening on ${MDNS_ADDR}:${MDNS_PORT}`);
  console.log("");
  console.log("Clients can now reach the server at:");
  console.log(`  https://${DOMAIN.replace(/\.$/, "")}`);
  console.log("");
  console.log("No config needed on any client machine.");
  console.log("Works on WiFi and Ethernet automatically.");
});

// ── Announce presence on startup (unsolicited response) ───
socket.on("listening", () => {
  const ips = getLanIPs();
  // slight delay to let socket + memberships fully initialize
  setTimeout(() => {
    for (const ip of ips) {
      sendOn(socket, ip);
    }
  }, 1000);
});

process.on("SIGINT", () => {
  socket.close();
  process.exit(0);
});
process.on("SIGTERM", () => {
  socket.close();
  process.exit(0);
});
