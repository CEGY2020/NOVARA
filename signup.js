(function () {
  var form = document.getElementById("signupForm");
  var messageEl = document.getElementById("signupMessage");
  var submitBtn = document.getElementById("signupSubmit");
  var roleInput = document.getElementById("role");
  var loginLink = document.getElementById("loginLink");
  var selectedRole = null;

  if (window.NovaraRole) {
    selectedRole = NovaraRole.captureRoleFromQuery() || "aem";
    NovaraRole.setSelectedRole(selectedRole);

    var roleLabelEl = document.getElementById("selectedRoleLabel");
    if (roleLabelEl) {
      roleLabelEl.textContent =
        "Signing up as " + NovaraRole.getRoleLabel(selectedRole);
      roleLabelEl.hidden = false;
    }

    if (roleInput) {
      roleInput.value = NovaraRole.getRoleLabel(selectedRole);
    }

    if (loginLink) {
      loginLink.href = "login.html?role=" + encodeURIComponent(selectedRole);
    }
  } else if (roleInput) {
    roleInput.value = "AEM";
    selectedRole = "aem";
  }

  function setMessage(text, isError) {
    if (!messageEl) return;
    messageEl.textContent = text || "";
    messageEl.classList.toggle("is-error", Boolean(isError));
    messageEl.classList.toggle("is-success", Boolean(text) && !isError);
  }

  var togglePassword = document.getElementById("togglePassword");
  var passwordInput = document.getElementById("password");
  if (togglePassword && passwordInput) {
    togglePassword.addEventListener("click", function () {
      var type =
        passwordInput.getAttribute("type") === "password" ? "text" : "password";
      passwordInput.setAttribute("type", type);
      togglePassword.textContent = type === "password" ? "Show" : "Hide";
    });
  }

  if (!form) {
    return;
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    setMessage("");

    var fullName = String(
      (document.getElementById("fullName") || {}).value || ""
    ).trim();
    var email = String((document.getElementById("email") || {}).value || "")
      .trim()
      .toLowerCase();
    var password = String(
      (document.getElementById("password") || {}).value || ""
    );
    var confirmPassword = String(
      (document.getElementById("confirmPassword") || {}).value || ""
    );
    var company = String(
      (document.getElementById("company") || {}).value || ""
    ).trim();
    var role =
      (window.NovaraRole &&
        (NovaraRole.getSelectedRole() || selectedRole)) ||
      selectedRole ||
      "aem";

    if (!fullName) {
      setMessage("Full name is required.", true);
      return;
    }
    if (!email || email.indexOf("@") === -1) {
      setMessage("Enter a valid email address.", true);
      return;
    }
    if (password.length < 8) {
      setMessage("Password must be at least 8 characters.", true);
      return;
    }
    if (password !== confirmPassword) {
      setMessage("Password and Confirm Password must match.", true);
      return;
    }

    if (!window.NovaraApi || typeof NovaraApi.signupUser !== "function") {
      setMessage("API client is unavailable.", true);
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Creating…";
    }

    NovaraApi.signupUser({
      FullName: fullName,
      Email: email,
      Password: password,
      Role: role,
      Company: company,
    })
      .then(function (result) {
        var user = result && result.user;
        var status = user && user.status;
        if (status === "Active") {
          setMessage(
            "Account created and activated. You can sign in now.",
            false
          );
          window.setTimeout(function () {
            window.location.href =
              "login.html?role=" + encodeURIComponent(role);
          }, 1200);
          return;
        }
        setMessage(
          "Account created. It is Pending until an AEM admin approves it.",
          false
        );
        form.reset();
        if (roleInput && window.NovaraRole) {
          roleInput.value = NovaraRole.getRoleLabel(role);
        }
        var roleLabelEl = document.getElementById("selectedRoleLabel");
        if (roleLabelEl && window.NovaraRole) {
          roleLabelEl.textContent =
            "Signing up as " + NovaraRole.getRoleLabel(role);
          roleLabelEl.hidden = false;
        }
      })
      .catch(function (err) {
        setMessage((err && err.message) || "Sign-up failed.", true);
      })
      .finally(function () {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Create Account";
        }
      });
  });
})();
