/**
 * NOVARA login — custom user API (signup → pending → admin approve → login).
 */
(function () {
  "use strict";

  var form = document.getElementById("loginForm");
  var messageEl = document.getElementById("loginMessage");
  var submitBtn = document.getElementById("loginSubmit");
  var emailInput = document.getElementById("email");
  var passwordInput = document.getElementById("password");
  var rememberInput = document.getElementById("rememberMe");
  var togglePassword = document.getElementById("togglePassword");

  var selectedRole = null;
  if (window.NovaraRole) {
    selectedRole = NovaraRole.captureRoleFromQuery();
    var roleLabelEl = document.getElementById("selectedRoleLabel");
    if (roleLabelEl && selectedRole) {
      roleLabelEl.textContent = "Signing in as " + NovaraRole.getRoleLabel(selectedRole);
      roleLabelEl.hidden = false;
    }
  }

  function setMessage(text, isError) {
    if (!messageEl) return;
    messageEl.textContent = text || "";
    messageEl.classList.toggle("is-error", Boolean(isError));
    messageEl.classList.toggle("is-success", Boolean(text) && !isError);
  }

  if (togglePassword && passwordInput) {
    togglePassword.addEventListener("click", function () {
      var show = passwordInput.type === "password";
      passwordInput.type = show ? "text" : "password";
      togglePassword.textContent = show ? "Hide" : "Show";
    });
  }

  var forgot = document.getElementById("forgotPassword");
  if (forgot) {
    forgot.addEventListener("click", function (e) {
      e.preventDefault();
      setMessage(
        "Password reset is not wired yet. Ask an AEM admin to reset the account.",
        true
      );
    });
  }

  if (!form) return;

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    setMessage("");

    var email = String((emailInput && emailInput.value) || "")
      .trim()
      .toLowerCase();
    var password = String((passwordInput && passwordInput.value) || "");
    var remember = Boolean(rememberInput && rememberInput.checked);

    if (!email || email.indexOf("@") === -1) {
      setMessage("Enter a valid email address.", true);
      return;
    }
    if (!password) {
      setMessage("Enter your password.", true);
      return;
    }
    if (!window.NovaraApi || typeof NovaraApi.loginUser !== "function") {
      setMessage("API client is unavailable.", true);
      return;
    }
    if (!window.NOVARA_API_BASE && !/localhost|127\.0\.0\.1/.test(location.hostname)) {
      setMessage(
        "API base URL is empty. Set window.NOVARA_API_BASE in api-config.js to the Lambda / Amplify API.",
        true
      );
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Signing in…";
    }

    NovaraApi.loginUser({ Email: email, Password: password })
      .then(function (result) {
        var user = (result && (result.user || result)) || {};
        var token = result.token || result.accessToken || result.Token || "";
        var expiresAt = result.expiresAt || result.ExpiresAt || "";

        if (!window.NovaraAuth || typeof NovaraAuth.setCurrentUser !== "function") {
          throw new Error("Auth helper is unavailable.");
        }

        var saved = NovaraAuth.setCurrentUser(user, {
          token: token,
          expiresAt: expiresAt,
          remember: remember,
        });
        if (!saved) {
          throw new Error("Login succeeded but the session could not be saved.");
        }

        var role = saved.role || selectedRole || "aem";
        var home =
          window.NovaraRole && NovaraRole.getHomeForRole
            ? NovaraRole.getHomeForRole(role)
            : "dashboard.html";
        window.location.href = home;
      })
      .catch(function (err) {
        setMessage((err && err.message) || "Invalid email or password.", true);
      })
      .finally(function () {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Sign In";
        }
      });
  });
})();
