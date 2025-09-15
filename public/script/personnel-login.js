async function loadPayrollClasses() {
  try {
    const res = await fetch("/classes");
    const classes = await res.json();

    const select = document.getElementById("payroll-class");

    classes.forEach(cls => {
      const opt = document.createElement("option");
      opt.value = cls.id;   // backend DB id (e.g. hicaddata3)
      opt.textContent = cls.name; // label (e.g. RATINGS A)
      select.appendChild(opt);
    });
  } catch (err) {
    console.error("❌ Failed to load payroll classes:", err);
  }
}

document.addEventListener("DOMContentLoaded", loadPayrollClasses);


document.getElementById('login-form').addEventListener('submit', async function(e) {
  e.preventDefault();

  const formData = new FormData(this);
  const loginData = Object.fromEntries(formData.entries());

  console.log(">>> Sending payload:", loginData); // ✅ Debug

  try {
    const res = await fetch('/api/users/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loginData)
    });

    const data = await res.json();
    console.log(">>> Server response:", data);

    if (res.ok) {
    // Show popup
    const popup = document.getElementById("loginSuccessPopup");
    const spinner = document.getElementById("loginSpinner");
    const message = document.getElementById("loginMessage");

    popup.classList.remove("hidden");
    spinner.classList.remove("hidden");
    message.textContent = "Logging you in...";

    setTimeout(() => {
        spinner.classList.add("hidden");
        message.innerHTML = `<span class="text-green-600">✔ Login successful!</span>`;
    }, 1200);

    setTimeout(() => {
        popup.classList.add("hidden");
        window.location.href = "/dashboard.html"; // redirect
    }, 2500);

    // Save token & user info
    localStorage.setItem("token", data.token);
    localStorage.setItem("user_id", data.user.user_id);
    localStorage.setItem("full_name", data.user.full_name);
    localStorage.setItem("role", data.user.role);
    localStorage.setItem("class", data.user.primary_class);

    }
    else {
      alert("❌ " + data.error);
    }
  } catch (err) {
    console.error("❌ Login error:", err);
    alert("❌ Server not responding");
  }
});

const passwordInput = document.getElementById("loginPassword");
const togglePassword = document.getElementById("togglePassword");
const eyeOpen = document.getElementById("eyeOpen");
const eyeClosed = document.getElementById("eyeClosed");

togglePassword.addEventListener("click", () => {
  const isPassword = passwordInput.type === "password";
  passwordInput.type = isPassword ? "text" : "password";
  
  // Toggle SVG display
  eyeOpen.style.display = isPassword ? "none" : "inline";
  eyeClosed.style.display = isPassword ? "inline" : "none";
});