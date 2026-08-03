document.querySelector("form").addEventListener("submit", function (e) {
    e.preventDefault();

    // TODO: Replace this with AWS Cognito authentication.
    // For now, continue to the dashboard.
    window.location.href = "dashboard.html";
});

// Show / Hide Password
const togglePassword = document.getElementById("togglePassword");
const passwordInput = document.getElementById("password");

if (togglePassword && passwordInput) {
  togglePassword.addEventListener("click", function () {
    const type = passwordInput.getAttribute("type") === "password" ? "text" : "password";
    passwordInput.setAttribute("type", type);
    togglePassword.textContent = type === "password" ? "Show" : "Hide";
  });
}
