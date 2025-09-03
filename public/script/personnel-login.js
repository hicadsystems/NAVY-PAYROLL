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

    // Save token
    localStorage.setItem("token", data.token);
    localStorage.setItem("user", JSON.stringify(data.user));
    }
    else {
      alert("❌ " + data.error);
    }
  } catch (err) {
    console.error("❌ Login error:", err);
    alert("❌ Server not responding");
  }
});