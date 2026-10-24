// One-time wiring of Payslip Sync into existing NAVY-PAYROLL files.
// Safe to run more than once: each edit is skipped when already present.
// Keeps each file's line endings.
//
//   node scripts/sync-wire-up.js          apply
//   node scripts/sync-wire-up.js --check  only report

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CHECK = process.argv.includes("--check");
let changed = 0;
let problems = 0;

function edit(rel, marker, fn) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) {
    console.log(`✘ ${rel}: not found`);
    problems++;
    return;
  }
  const raw = fs.readFileSync(file, "utf8");
  const crlf = raw.includes("\r\n");
  const text = raw.replace(/\r\n/g, "\n");
  if (text.includes(marker)) {
    console.log(`= ${rel}: already wired`);
    return;
  }
  const out = fn(text);
  if (out == null || out === text) {
    console.log(`✘ ${rel}: anchor not found, edit by hand (look for the ${marker} line in services/sync/README.md)`);
    problems++;
    return;
  }
  if (!CHECK) fs.writeFileSync(file, crlf ? out.replace(/\n/g, "\r\n") : out);
  console.log(`${CHECK ? "would change" : "✔ changed"} ${rel}`);
  changed++;
}

/** Insert `add` after the first line matching `re` (whole line). */
function afterLine(text, re, add) {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => re.test(l));
  if (i < 0) return null;
  lines.splice(i + 1, 0, ...add.split("\n"));
  return lines.join("\n");
}

// 1. Mount /api/sync
edit("routes/index.js", 'require("./sync")', (t) => {
  let out = afterLine(t, /const ippisRoutes = require\(".\/utilities\/ippis-payment"\);/, 'const payslipSyncRoutes = require("./sync"); // Payslip Sync (/api/sync)');
  if (!out) return null;
  return afterLine(out, /app\.use\("\/ippis", ippisRoutes\);/, '  app.use("/api/sync", payslipSyncRoutes);');
});

// 2. Dashboard menu: Utilities → Payslip Sync (after Pull IPPIS Payments)
edit("public/dashboard.html", 'data-section="payslip-sync"', (t) => {
  const re = /(\n([ \t]*)<li>\s*\n\s*<a\s*\n\s*href="#"\s*\n\s*data-section="ippis-payments"[\s\S]*?<\/li>)/;
  const m = t.match(re);
  if (!m) return null;
  const ind = m[2];
  const li = `\n${ind}<li>\n${ind}  <a\n${ind}    href="#"\n${ind}    data-section="payslip-sync"\n${ind}    class="block px-3 py-1 rounded hover:bg-amber-50"\n${ind}    >Payslip Sync</a\n${ind}  >\n${ind}</li>`;
  return t.replace(m[1], m[1] + li);
});

// 3. Menu highlighting + sidebar filter: section belongs to Utilities
edit("public/script/menu-highlighting.js", "'payslip-sync'", (t) =>
  afterLine(t, /^\s*'ippis-payments': 'utilities',/, "      'payslip-sync': 'utilities',"),
);
edit("public/script/sidebar-filter.js", '"payslip-sync"', (t) =>
  afterLine(t, /^\s*"ippis-payments": "utilities",/, '    "payslip-sync": "utilities",'),
);

// 4. Quick access entry
edit("public/script/quick-access.js", 'id: "payslip-sync"', (t) => {
  const re = /(^|\n)([ \t]*)("ippis-payments": \{\n[\s\S]*?\n\2\},)/;
  const m = t.match(re);
  if (!m) return null;
  const ind = m[2];
  const entry = `\n${ind}"payslip-sync": {\n${ind}  id: "payslip-sync",\n${ind}  label: "Payslip Sync",\n${ind}  section: "payslip-sync",\n${ind}  title: "Payslip Sync",\n${ind}},`;
  return t.replace(m[0], m[0] + entry);
});

// 5. Dependency on the shared library + test script
edit("package.json", '"navy-payslip-sync"', (t) => {
  const j = JSON.parse(t);
  j.dependencies = j.dependencies || {};
  j.dependencies["navy-payslip-sync"] = "github:hicadsystems/navy-payslip-sync#v0.1.2";
  j.scripts = j.scripts || {};
  j.scripts["test:sync"] = "node --test --test-concurrency=1 test/sync/e2e.test.js";
  return JSON.stringify(j, null, 2) + "\n";
});

// 6. Settings in .env.example
edit(".env.example", "SYNC_PRIVATE_KEY", (t) =>
  t.replace(/\n*$/, "\n") +
  `
# ── Payslip Sync (/api/sync) ─────────────────────────────
# Website private key: path to website-private.pem (X25519). Keep outside the repo; only the website opens packages.
SYNC_PRIVATE_KEY=
# Restricted MySQL user for sync writes (node scripts/sync-grants.js). Empty = MYSQL_USER.
SYNC_DB_USER=
SYNC_DB_PASSWORD=
# Where uploaded packages are kept until Go live (default uploads/sync)
SYNC_UPLOAD_DIR=
`,
);

// 7. Uploaded packages stay out of git
edit(".gitignore", "uploads/sync", (t) => t.replace(/\n*$/, "\n") + "\n# Payslip Sync uploads\nuploads/sync/\n");

console.log(problems ? `\n${problems} file(s) need a manual edit.` : `\n${changed} file(s) ${CHECK ? "to change" : "changed"}.`);
process.exit(problems ? 1 : 0);
