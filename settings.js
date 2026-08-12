(function () {
  var form = document.getElementById("utilityapi-form");
  var keyInput = document.getElementById("field-utilityapi-key");
  var baseUrlInput = document.getElementById("field-utilityapi-base-url");
  var accountIdInput = document.getElementById("field-utilityapi-account-id");
  var authorizationIdInput = document.getElementById(
    "field-utilityapi-authorization-id"
  );
  var keyHint = document.getElementById("utilityapi-key-hint");
  var formError = document.getElementById("utilityapi-form-error");
  var formStatus = document.getElementById("utilityapi-form-status");
  var saveBtn = document.getElementById("utilityapi-save-btn");

  if (!form) {
    return;
  }

  var api = window.NovaraApi;
  var DEFAULT_BASE_URL = "https://utilityapi.com/api/v2";

  function setError(message) {
    if (!formError) return;
    if (!message) {
      formError.hidden = true;
      formError.textContent = "";
      return;
    }
    formError.hidden = false;
    formError.textContent = message;
  }

  function setStatus(message, isError) {
    if (!formStatus) return;
    formStatus.textContent = message || "";
    formStatus.classList.toggle("is-error", Boolean(isError));
  }

  function fieldValue(el) {
    return el ? String(el.value || "").trim() : "";
  }

  function applySettings(settings) {
    var data = settings || {};
    if (baseUrlInput) {
      baseUrlInput.value = data.baseUrl || DEFAULT_BASE_URL;
    }
    if (accountIdInput) {
      accountIdInput.value = data.accountId || "";
    }
    if (authorizationIdInput) {
      authorizationIdInput.value = data.authorizationId || "";
    }
    if (keyInput) {
      keyInput.value = "";
      if (data.apiKeyConfigured) {
        keyInput.placeholder = "Leave blank to keep the saved key";
      } else {
        keyInput.placeholder = "Enter API key";
      }
    }
    if (keyHint) {
      if (data.apiKeyConfigured) {
        keyHint.textContent =
          "Saved key " +
          (data.apiKeyMasked || "••••") +
          ". Leave blank to keep it, or enter a new key to replace it.";
      } else {
        keyHint.textContent =
          "Stored securely. The full key is never shown after save.";
      }
    }
  }

  function loadSettings() {
    if (!api || typeof api.getUtilityApiSettings !== "function") {
      setStatus("API client is not available.", true);
      return;
    }
    setStatus("Loading UtilityAPI settings…");
    setError("");
    api
      .getUtilityApiSettings()
      .then(function (payload) {
        applySettings(payload && payload.settings);
        setStatus("");
      })
      .catch(function (err) {
        applySettings({ baseUrl: DEFAULT_BASE_URL });
        setStatus(
          (err && err.message) || "Failed to load UtilityAPI settings.",
          true
        );
      });
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (!api || typeof api.saveUtilityApiSettings !== "function") {
      setError("API client is not available.");
      return;
    }
    setError("");
    setStatus("Saving…");
    if (saveBtn) saveBtn.disabled = true;

    var payload = {
      BaseUrl: fieldValue(baseUrlInput) || DEFAULT_BASE_URL,
      AccountId: fieldValue(accountIdInput),
      AuthorizationId: fieldValue(authorizationIdInput),
    };
    var apiKey = fieldValue(keyInput);
    if (apiKey) {
      payload.ApiKey = apiKey;
    }

    api
      .saveUtilityApiSettings(payload)
      .then(function (result) {
        applySettings(result && result.settings);
        setStatus("UtilityAPI settings saved.");
      })
      .catch(function (err) {
        setStatus("");
        setError((err && err.message) || "Failed to save UtilityAPI settings.");
      })
      .then(function () {
        if (saveBtn) saveBtn.disabled = false;
      });
  });

  loadSettings();
})();
