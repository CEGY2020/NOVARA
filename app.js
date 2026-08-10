// Capture role from directory (?role=) and keep the existing login page.
var selectedRole = null;

if (window.NovaraRole) {
  selectedRole = NovaraRole.captureRoleFromQuery();

  var roleLabelEl = document.getElementById("selectedRoleLabel");
  if (roleLabelEl && selectedRole) {
    roleLabelEl.textContent = "Signing in as " + NovaraRole.getRoleLabel(selectedRole);
    roleLabelEl.hidden = false;
  }
}

// Login form
document.querySelector("form").addEventListener("submit", function (e) {
  e.preventDefault();

  // TODO: Replace this with AWS Cognito authentication.
  // For now, continue to the home page for the selected role.
  var role = window.NovaraRole
    ? NovaraRole.getSelectedRole() || selectedRole || "aem"
    : "aem";

  if (window.NovaraRole) {
    NovaraRole.setSelectedRole(role);
    window.location.href = NovaraRole.getHomeForRole(role);
    return;
  }

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

// Forgot Password (temporary)
const forgotPassword = document.getElementById("forgotPassword");

if (forgotPassword) {
  forgotPassword.addEventListener("click", function (e) {
    e.preventDefault();
    alert("Password reset is coming soon. For now, please contact support.");
  });
}
