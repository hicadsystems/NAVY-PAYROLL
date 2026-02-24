// ══════════════════════════════════════════════════════════
// user-dashboard.js — unified script
// ══════════════════════════════════════════════════════════

// ── Clear payroll class on dashboard load ──────────────────
localStorage.removeItem("current_class");

// ── Encrypt/decrypt ────────────────────────────────────────
function encryptVal(val) {
  return btoa(
    val
      .split("")
      .map((c) => String.fromCharCode(c.charCodeAt(0) + 3))
      .join(""),
  );
}
function decryptVal(val) {
  return atob(val)
    .split("")
    .map((c) => String.fromCharCode(c.charCodeAt(0) - 3))
    .join("");
}

// ── Helper: inject HTML + execute scripts ──────────────────
function injectWithScripts(container, html) {
  container.innerHTML = html;
  container.querySelectorAll("script").forEach(function (oldScript) {
    var newScript = document.createElement("script");
    newScript.textContent = oldScript.textContent;
    oldScript.parentNode.replaceChild(newScript, oldScript);
  });
}

// ══════════════════════════════════════════════════════════
// REAL NAME
// ══════════════════════════════════════════════════════════
var fullName = localStorage.getItem("full_name") || "Officer";

function formatDisplayName(name) {
  var parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] + " " + parts[1];
  return (
    parts[0] + " " + parts[1] + " " + parts[parts.length - 1].charAt(0) + "."
  );
}

var displayName = formatDisplayName(fullName);

var userDisplayEl = document.getElementById("user-display-name");
var headerNameEl = document.getElementById("header-username-text");
if (userDisplayEl) userDisplayEl.textContent = displayName;
if (headerNameEl) headerNameEl.textContent = fullName;

// ══════════════════════════════════════════════════════════
// TIME-BASED GREETING
// ══════════════════════════════════════════════════════════
function applyGreeting() {
  var hour = new Date().getHours();

  var greetings = {
    // 00:00 – 03:59
    midnight: [
      {
        icon: "🌌",
        tag: "Midnight",
        sub: "Burning the midnight oil, Officer.",
      },
      {
        icon: "🌙",
        tag: "Still Awake?",
        sub: "Don't forget to get some rest.",
      },
      {
        icon: "⭐",
        tag: "Late Night",
        sub: "Rest up — tomorrow needs you sharp.",
      },
    ],
    // 04:00 – 11:59
    morning: [
      {
        icon: "🌅",
        tag: "Good Morning",
        sub: "Duty begins with a clear mind.",
      },
      {
        icon: "☀️",
        tag: "Good Morning",
        sub: "Hope your morning is off to a great start.",
      },
      {
        icon: "☕",
        tag: "Rise & Shine",
        sub: "A good cup of coffee and a great day ahead.",
      },
      {
        icon: "🌤️",
        tag: "Good Morning",
        sub: "The early bird is already ahead of the game.",
      },
      { icon: "🌞", tag: "Almost Noon", sub: "Keep the momentum going." },
      {
        icon: "☕",
        tag: "Coffee Hour",
        sub: "Halfway to the afternoon — you're doing great.",
      },
    ],
    // 12:00 – 15:59
    afternoon: [
      {
        icon: "🌤️",
        tag: "Good Afternoon",
        sub: "A productive afternoon makes for a great evening.",
      },
      { icon: "⚓", tag: "Good Afternoon", sub: "Steady as she goes." },
      {
        icon: "🌞",
        tag: "Sunny Afternoon",
        sub: "Keep pushing — the finish line is in sight.",
      },
      {
        icon: "🌇",
        tag: "Good Afternoon",
        sub: "Almost there — finish strong.",
      },
    ],
    // 16:00 – 20:59
    evening: [
      {
        icon: "🌆",
        tag: "Good Evening",
        sub: "Time to wind down after a solid day.",
      },
      { icon: "🌙", tag: "Good Evening", sub: "Rest well — you've earned it." },
      {
        icon: "🌃",
        tag: "Good Evening",
        sub: "Hope the day treated you well.",
      },
    ],
    // 21:00 – 23:59
    night: [
      {
        icon: "🌙",
        tag: "Good Night",
        sub: "Rest up — tomorrow needs you sharp.",
      },
      { icon: "⭐", tag: "Good Night", sub: "Don't forget to get some rest." },
      { icon: "🌌", tag: "Good Night", sub: "Wrap it up — a new day awaits." },
    ],
  };

  var pool;
  if (hour >= 0 && hour < 4) pool = greetings.midnight;
  else if (hour >= 4 && hour < 12) pool = greetings.morning;
  else if (hour >= 12 && hour < 16) pool = greetings.afternoon;
  else if (hour >= 16 && hour < 21) pool = greetings.evening;
  else pool = greetings.night;

  var pick = pool[Math.floor(Math.random() * pool.length)];

  var iconEl = document.getElementById("greeting-icon");
  var textEl = document.getElementById("greeting-text");
  var subEl = document.getElementById("greeting-sub");
  if (iconEl) iconEl.textContent = pick.icon;
  if (textEl) textEl.textContent = pick.tag;
  if (subEl) subEl.textContent = pick.sub;
}

applyGreeting();
setInterval(applyGreeting, 60 * 1000);

// ══════════════════════════════════════════════════════════
// HEADER: logo ↔ username swap
// ══════════════════════════════════════════════════════════
var headerLogo = document.getElementById("header-logo");
var headerUsername = document.getElementById("header-username");

function updateHeaderSlot(pageId) {
  if (!headerLogo || !headerUsername) return;
  if (pageId === "home") {
    headerLogo.classList.remove("hidden-slot");
    headerUsername.classList.remove("visible-slot");
  } else {
    headerLogo.classList.add("hidden-slot");
    headerUsername.classList.add("visible-slot");
  }
}

// ══════════════════════════════════════════════════════════
// PAGE SWITCHER
// ══════════════════════════════════════════════════════════
function showPage(id) {
  document
    .querySelectorAll(".page")
    .forEach((p) => p.classList.remove("active"));
  document
    .querySelectorAll("nav a")
    .forEach((a) => a.classList.remove("active"));

  var pg = document.getElementById("page-" + id);
  var nav = document.getElementById("nav-" + id);
  if (pg) pg.classList.add("active");
  if (nav) nav.classList.add("active");

  updateHeaderSlot(id);
}

// ══════════════════════════════════════════════════════════
// NAV LINKS
// ══════════════════════════════════════════════════════════
document.querySelectorAll("nav a[data-page]").forEach(function (link) {
  link.addEventListener("click", function (e) {
    var page = this.getAttribute("data-page");

    if (page === "logout") {
      e.preventDefault();
      if (typeof logout === "function") logout();
      else window.location.href = "personnel-user-login.html";
      return;
    }

    if (page === "payroll") {
      e.preventDefault();
      var currentClass = localStorage.getItem("current_class");
      if (currentClass) {
        window.location.href = "/dashboard.html";
      } else {
        if (typeof window.openPayrollModal === "function")
          window.openPayrollModal();
      }
      return;
    }

    e.preventDefault();
    if (page === "email") loadEmailPage();
    showPage(page);
  });
});

// Quick action buttons on home page
document.querySelectorAll("button[data-page]").forEach(function (btn) {
  btn.addEventListener("click", function () {
    var page = this.getAttribute("data-page");
    if (page === "email") loadEmailPage();
    showPage(page);
  });
});

// ══════════════════════════════════════════════════════════
// EMAIL — lazy load + unread badge on dashboard init
// ══════════════════════════════════════════════════════════
var emailPageLoaded = false;

function loadEmailPage() {
  if (emailPageLoaded) return;
  fetch("pages/email.html")
    .then((r) => r.text())
    .then(function (html) {
      injectWithScripts(document.getElementById("page-email"), html);
      emailPageLoaded = true;
    })
    .catch(function () {
      document.getElementById("page-email").innerHTML =
        '<p style="color:rgba(200,220,255,0.4);padding:40px;">Failed to load mailbox. Please refresh.</p>';
    });
}

(function fetchEmailBadgeOnLoad() {
  var t = localStorage.getItem("token");
  if (!t) return;
  fetch("/messages/inbox?page=1&limit=1", {
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + t,
    },
  })
    .then((r) => r.json())
    .then(function (data) {
      if (data.unread === undefined) return;
      var navEmail = document.getElementById("nav-email");
      if (!navEmail) return;
      var badge = document.getElementById("nav-mail-badge");
      if (!badge) {
        badge = document.createElement("span");
        badge.id = "nav-mail-badge";
        badge.style.cssText =
          "background:#f5c842;color:#0d1f35;font-size:10px;font-weight:700;padding:2px 6px;border-radius:20px;margin-left:6px;vertical-align:middle;display:none";
        navEmail.appendChild(badge);
      }
      badge.textContent = data.unread > 99 ? "99+" : data.unread;
      badge.style.display = data.unread > 0 ? "inline-block" : "none";
    })
    .catch(function () {});
})();

// ══════════════════════════════════════════════════════════
// ALERT MODAL
// ══════════════════════════════════════════════════════════
const DashAlertModal = {
  modal: null,

  init() {
    const el = document.createElement("div");
    el.id = "dashAlert";
    el.style.cssText = `
      position:fixed;inset:0;background:rgba(4,12,28,0.82);
      backdrop-filter:blur(6px);display:flex;align-items:center;
      justify-content:center;z-index:300;opacity:0;pointer-events:none;
      transition:opacity 0.25s ease;
    `;
    el.innerHTML = `
      <div style="background:#0f2340;border:1px solid rgba(255,255,255,0.10);
        border-radius:14px;padding:36px 40px;max-width:380px;width:100%;
        text-align:center;box-shadow:0 24px 60px rgba(0,0,0,0.5);">
        <p id="dashAlertMsg" style="font-family:'DM Sans',sans-serif;font-size:14px;
          color:rgba(200,220,255,0.85);margin-bottom:24px;line-height:1.6;"></p>
        <button id="dashAlertOk" style="padding:11px 32px;background:#f5c842;
          color:#0d1f35;font-family:'DM Sans',sans-serif;font-size:14px;
          font-weight:600;border:none;border-radius:8px;cursor:pointer;">OK</button>
      </div>
    `;
    document.body.appendChild(el);
    this.modal = el;
    document
      .getElementById("dashAlertOk")
      .addEventListener("click", () => this.close());
  },

  confirm(message, onConfirm, onCancel) {
    document.getElementById("dashAlertMsg").textContent = message;
    const okBtn = document.getElementById("dashAlertOk");
    const wrapper = okBtn.parentNode;

    okBtn.textContent = "Delete";
    okBtn.style.background = "#e74c3c";
    okBtn.style.color = "#fff";
    okBtn.style.marginRight = "12px";
    okBtn.onclick = () => {
      this.close();
      if (onConfirm) onConfirm();
    };

    let cancelBtn = document.getElementById("dashAlertCancel");
    if (!cancelBtn) {
      cancelBtn = document.createElement("button");
      cancelBtn.id = "dashAlertCancel";
      cancelBtn.style.cssText =
        "padding:11px 32px;background:transparent;color:rgba(200,220,255,0.7);font-family:'DM Sans',sans-serif;font-size:14px;font-weight:600;border:1px solid rgba(200,220,255,0.3);border-radius:8px;cursor:pointer;";
      wrapper.appendChild(cancelBtn);
      cancelBtn.addEventListener("click", () => {
        this.close();
        if (onCancel) onCancel();
      });
    }
    cancelBtn.textContent = "Cancel";
    cancelBtn.style.display = "inline-block";

    this.modal.style.opacity = "1";
    this.modal.style.pointerEvents = "all";
  },

  show(message) {
    document.getElementById("dashAlertMsg").textContent = message;
    const okBtn = document.getElementById("dashAlertOk");
    const cancelBtn = document.getElementById("dashAlertCancel");
    okBtn.textContent = "OK";
    okBtn.style.background = "#f5c842";
    okBtn.style.color = "#0d1f35";
    okBtn.style.marginRight = "0";
    okBtn.onclick = () => this.close();
    if (cancelBtn) cancelBtn.style.display = "none";
    this.modal.style.opacity = "1";
    this.modal.style.pointerEvents = "all";
  },

  close() {
    this.modal.style.opacity = "0";
    this.modal.style.pointerEvents = "none";
  },
};

DashAlertModal.init();

// ══════════════════════════════════════════════════════════
// PAYROLL MODAL — load + handle payroll return from logout
// ══════════════════════════════════════════════════════════
fetch("pages/payroll-modal.html")
  .then((r) => r.text())
  .then(function (html) {
    var container = document.createElement("div");
    document.body.appendChild(container);
    injectWithScripts(container, html);

    // If returning from payroll logout, auto-open modal
    if (
      sessionStorage.getItem("_pid") &&
      sessionStorage.getItem("_from_logout")
    ) {
      sessionStorage.removeItem("_from_logout");
      window.openPayrollModal();
    }
  })
  .catch((err) => console.error("Failed to load payroll modal:", err));
