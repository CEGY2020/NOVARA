(function () {
  "use strict";

  var emailEl = document.getElementById("sales-report-email");
  var saveBtn = document.getElementById("save-sales-report-email");
  var statusEl = document.getElementById("sales-report-email-status");
  if (!emailEl || !saveBtn || !statusEl || !window.NovaraApi) return;

  function setStatus(message, isError) {
    statusEl.textContent = message || "";
    statusEl.classList.toggle("is-error", Boolean(isError));
  }

  function load() {
    setStatus("Loading your report email…", false);
    window.NovaraApi.fetchJson("/api/sales-reports/me")
      .then(function (data) {
        emailEl.value = data.reportEmail || data.loginEmail || "";
        setStatus("", false);
      })
      .catch(function (err) {
        setStatus(err.message || "Unable to load your report email.", true);
      });
  }

  function save() {
    var value = emailEl.value.trim();
    if (!value || value.indexOf("@") < 1) {
      setStatus("Enter a valid email address.", true);
      return;
    }
    saveBtn.disabled = true;
    setStatus("Saving your report email…", false);
    window.NovaraApi.sendJson("/api/sales-reports/me", "PUT", { reportEmail: value })
      .then(function (data) {
        emailEl.value = data.reportEmail || value;
        setStatus("Your daily lead report email is saved.", false);
      })
      .catch(function (err) {
        setStatus(err.message || "Unable to save your report email.", true);
      })
      .finally(function () {
        saveBtn.disabled = false;
      });
  }

  saveBtn.addEventListener("click", save);
  load();
})();
