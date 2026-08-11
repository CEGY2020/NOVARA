// Capture role from directory (?role=) and keep the existing login page.
var selectedRole = null;
var loginMessage = document.getElementById("loginMessage");
var loginSubmit = document.getElementById("loginSubmit");

function setLoginMessage(text, isError) {
  if (!loginMessage) return;
  loginMessage.textContent = text || "";
  loginMessage.classList.toggle("is-error", Boolean(isError));
  loginMessage.classList.toggle("is-success", Boolean(text) && !isError);
}

if (window.NovaraRole) {
  selectedRole = NovaraRole.captureRoleFromQuery();

  var roleLabelEl = document.getElementById("selectedRoleLabel");
  if (roleLabelEl && selectedRole) {
    roleLabelEl.textContent = "Signing in as " + NovaraRole.getRoleLabel(selectedRole);
    roleLabelEl.hidden = false;
  }
}

// Login form — authenticate against NOVARAUsers; only Active users may enter.
var loginForm = document.getElementById("loginForm") || document.querySelector("form");
if (loginForm) {
  loginForm.addEventListener("submit", function (e) {
    e.preventDefault();
    setLoginMessage("");

    var email = String((document.getElementById("email") || {}).value || "")
      .trim()
      .toLowerCase();
    var password = String((document.getElementById("password") || {}).value || "");

    if (!email || !password) {
      setLoginMessage("Email and password are required.", true);
      return;
    }

    if (!window.NovaraApi || typeof NovaraApi.loginUser !== "function") {
      setLoginMessage("API client is unavailable.", true);
      return;
    }

    if (loginSubmit) {
      loginSubmit.disabled = true;
      loginSubmit.textContent = "Signing in…";
    }

    var rememberEl = document.getElementById("rememberMe");
    var remember = Boolean(rememberEl && rememberEl.checked);

    NovaraApi.loginUser({ Email: email, Password: password })
      .then(function (result) {
        var user = result && result.user;
        if (!user) {
          throw new Error("Login succeeded but no user was returned.");
        }
        if (!result.token) {
          throw new Error("Login succeeded but no session token was returned.");
        }

        if (window.NovaraAuth && NovaraAuth.setCurrentUser) {
          NovaraAuth.setCurrentUser(user, {
            token: result.token,
            expiresAt: result.expiresAt || "",
            remember: remember,
          });
        }

        var role = user.role;
        if (window.NovaraRole) {
          role = NovaraRole.setSelectedRole(role) || role || selectedRole || "aem";
          window.location.href = NovaraRole.getHomeForRole(role);
          return;
        }

        window.location.href = "dashboard.html";
      })
      .catch(function (err) {
        setLoginMessage((err && err.message) || "Sign-in failed.", true);
      })
      .finally(function () {
        if (loginSubmit) {
          loginSubmit.disabled = false;
          loginSubmit.textContent = "Sign In";
        }
      });
  });
}

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
