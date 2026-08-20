/*
 * NOVARA Authentication
 * Amazon Cognito managed login
 */

(function () {
  "use strict";

  // Amazon Cognito configuration
  const COGNITO_DOMAIN =
    "https://us-west-2ztzcbgehz.auth.us-west-2.amazoncognito.com";

  const CLIENT_ID =
    "4dcudd58k6s3t8uf4bfiabflk0";

  const REDIRECT_URI =
    "https://cegy2020.github.io/NOVARA/";

  /*
   * Build the Cognito managed-login URL.
   */
  function getCognitoLoginUrl() {
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: "code",
      scope: "openid email phone",
      redirect_uri: REDIRECT_URI
    });

    return COGNITO_DOMAIN + "/oauth2/authorize?" + params.toString();
  }

  /*
   * Send user to Amazon Cognito.
   */
  function signInWithCognito() {
    window.location.href = getCognitoLoginUrl();
  }

  /*
   * Preserve NOVARA role selection, if one was supplied
   * in the page URL.
   */
  function saveSelectedRole() {
    try {
      const params = new URLSearchParams(window.location.search);
      const role = params.get("role");

      if (role) {
        sessionStorage.setItem("novaraSelectedRole", role);
      }
    } catch (err) {
      console.warn("Unable to save NOVARA role.", err);
    }
  }

  /*
   * Login page
   */
  const loginForm = document.getElementById("loginForm");

  if (loginForm) {
    saveSelectedRole();

    loginForm.addEventListener("submit", function (event) {
      event.preventDefault();
      signInWithCognito();
    });
  }

  /*
   * Password show/hide button.
   * This is retained so the existing page does not break,
   * although Cognito will now handle the actual password entry.
   */
  const togglePassword = document.getElementById("togglePassword");
  const passwordInput = document.getElementById("password");

  if (togglePassword && passwordInput) {
    togglePassword.addEventListener("click", function () {
      const isPassword = passwordInput.type === "password";

      passwordInput.type = isPassword ? "text" : "password";
      togglePassword.textContent = isPassword ? "Hide" : "Show";
    });
  }

  /*
   * Forgot password.
   * Send the user to Cognito, where password recovery is handled.
   */
  const forgotPassword = document.getElementById("forgotPassword");

  if (forgotPassword) {
    forgotPassword.addEventListener("click", function (event) {
      event.preventDefault();
      signInWithCognito();
    });
  }
  /*
   * Complete Cognito login after Cognito redirects back to NOVARA.
   */
  async function handleCognitoCallback() {
    const query = new URLSearchParams(window.location.search);
    const code = query.get("code");

    if (!code) return;

    try {
      const response = await fetch(COGNITO_DOMAIN + "/oauth2/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: CLIENT_ID,
          code: code,
          redirect_uri: REDIRECT_URI
        })
      });

      if (!response.ok) {
        throw new Error("Unable to complete Cognito login.");
      }

      const tokens = await response.json();

      const base64Url = tokens.id_token.split(".")[1];
const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
const padded = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, "=");
const payload = JSON.parse(atob(padded));

      const user = {
        userId: payload.sub || "",
        email: payload.email || "",
        fullName: payload.name || payload.email || "",
        role: "aem",
        status: "Active"
      };

      sessionStorage.setItem("novaraUser", JSON.stringify(user));
      sessionStorage.setItem("novaraToken", tokens.access_token);
      sessionStorage.setItem(
        "novaraTokenExpires",
        String(Date.now() + (tokens.expires_in * 1000))
      );

      window.history.replaceState({}, document.title, REDIRECT_URI);
      window.location.replace("dashboard.html");

    } catch (error) {
      console.error("Cognito callback error:", error);
      alert("NOVARA sign-in completed, but the session could not be created.");
    }
  }

  handleCognitoCallback();
  /*
   * Make Cognito sign-in available to other NOVARA pages.
   */
  window.NovaraCognito = {
    signIn: signInWithCognito,
    loginUrl: getCognitoLoginUrl
  };
})();
