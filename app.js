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

    // Forgot Password (temporary)
const forgotPassword = document.getElementById("forgotPassword");

if (forgotPassword) {
  forgotPassword.addEventListener("click", function (e) {
    e.preventDefault();
    alert("Password reset is coming soon. For now, please contact support.");
  });
}
  togglePassword.addEventListener("click", function () {
    const type = passwordInput.getAttribute("type") === "password" ? "text" : "password";
    passwordInput.setAttribute("type", type);
    togglePassword.textContent = type === "password" ? "Show" : "Hide";
  });
}
