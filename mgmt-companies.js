(function () {
  var statusEl = document.getElementById("mgmt-companies-status");
  var tbody = document.getElementById("mgmt-companies-tbody");
  var addBtn = document.getElementById("add-mgmt-company-btn");
  var modal = document.getElementById("mgmt-company-modal");
  var form = document.getElementById("mgmt-company-form");
  var modeInput = document.getElementById("mgmt-company-mode");
  var modalTitle = document.getElementById("mgmt-company-modal-title");
  var modalSubtitle = document.getElementById("mgmt-company-modal-subtitle");
  var formError = document.getElementById("mgmt-company-form-error");
  var saveBtn = document.getElementById("mgmt-company-save-btn");
  var closeBtn = document.getElementById("mgmt-company-modal-close");
  var cancelBtn = document.getElementById("mgmt-company-cancel-btn");
  var mgmtCompanyIdInput = document.getElementById("field-mgmtCompanyId");

  var companiesById = {};
  /** Authoritative create|edit mode. Do not rely only on #mgmt-company-mode — form.reset() restores its default. */
  var currentMode = "create";

  if (!tbody) {
    return;
  }

  function setStatus(message, isError) {
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.classList.toggle("is-error", Boolean(isError));
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function setFormError(message) {
    if (!formError) return;
    if (!message) {
      formError.hidden = true;
      formError.textContent = "";
      return;
    }
    formError.hidden = false;
    formError.textContent = message;
  }

  function fieldValue(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || "").trim() : "";
  }

  function setFieldValue(id, value) {
    var el = document.getElementById(id);
    if (!el) return;
    el.value = value == null ? "" : String(value);
  }

  function formatPhoneValue(value) {
    if (
      window.NovaraPhone &&
      typeof window.NovaraPhone.formatPhoneUS === "function"
    ) {
      return window.NovaraPhone.formatPhoneUS(value);
    }
    return value == null ? "" : String(value);
  }

  function formatLocation(company) {
    var city = company.city || "";
    var state = company.state || "";
    if (city && state) {
      return city + ", " + state;
    }
    return city || state || company.location || "—";
  }

  function collectPayload() {
    return {
      MgmtCompanyID: fieldValue("field-mgmtCompanyId"),
      Name: fieldValue("field-name"),
      Address: fieldValue("field-address"),
      City: fieldValue("field-city"),
      State: fieldValue("field-state"),
      Zip: fieldValue("field-zip"),
      ContactName: fieldValue("field-contactName"),
      ContactEmail: fieldValue("field-contactEmail"),
      ContactPhone: formatPhoneValue(fieldValue("field-contactPhone")),
      Notes: fieldValue("field-notes"),
    };
  }

  /** Next sequential MgmtCompanyID from NOVARAMgmtCompanies rows matching MGT###. */
  function nextMgmtCompanyId() {
    var maxNum = 0;
    var pattern = /^MGT(\d+)$/i;
    Object.keys(companiesById).forEach(function (id) {
      var match = pattern.exec(String(id || "").trim());
      if (!match) return;
      var num = parseInt(match[1], 10);
      if (Number.isFinite(num) && num > maxNum) {
        maxNum = num;
      }
    });
    var next = maxNum + 1;
    var width = Math.max(3, String(next).length);
    return "MGT" + String(next).padStart(width, "0");
  }

  function setMgmtCompanyIdHint(mode) {
    var hint = document.getElementById("mgmt-company-id-hint");
    if (!hint) return;
    if (mode === "edit") {
      hint.textContent = "MgmtCompanyID cannot be changed";
    } else {
      hint.textContent = "Auto-generated sequentially (MGT001…)";
    }
  }

  function openModal(mode, company) {
    if (!modal || !form) return;
    mode = mode === "edit" ? "edit" : "create";
    setFormError("");
    form.reset();

    // Must set mode AFTER reset — #mgmt-company-mode defaults to "create" in the HTML.
    currentMode = mode;
    if (modeInput) {
      modeInput.value = mode;
    }

    if (mgmtCompanyIdInput) {
      mgmtCompanyIdInput.readOnly = true;
    }
    setMgmtCompanyIdHint(mode);

    if (mode === "edit" && company) {
      modalTitle.textContent = "Edit Management Company";
      modalSubtitle.textContent =
        "Update " +
        (company.mgmtCompanyId || "management company") +
        " in NOVARAMgmtCompanies";
      setFieldValue("field-mgmtCompanyId", company.mgmtCompanyId);
      setFieldValue("field-name", company.name || company.mgmtCompanyName);
      setFieldValue("field-address", company.address || "");
      setFieldValue("field-city", company.city || "");
      setFieldValue("field-state", company.state || "");
      setFieldValue("field-zip", company.zip || "");
      setFieldValue("field-contactName", company.contactName || "");
      setFieldValue("field-contactEmail", company.contactEmail || "");
      setFieldValue(
        "field-contactPhone",
        formatPhoneValue(company.contactPhone || "")
      );
      setFieldValue("field-notes", company.notes || "");
    } else {
      modalTitle.textContent = "Add Management Company";
      modalSubtitle.textContent =
        "Create a new management company in NOVARAMgmtCompanies";
      setFieldValue("field-mgmtCompanyId", nextMgmtCompanyId());
    }

    modal.hidden = false;
    document.body.classList.add("modal-open");
    var focusEl = document.getElementById("field-name");
    if (focusEl) {
      focusEl.focus();
    }
  }

  function closeModal() {
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove("modal-open");
    setFormError("");
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
    }
  }

  function renderCompanies(companies) {
    companiesById = {};
    if (!companies.length) {
      tbody.innerHTML =
        '<tr><td colspan="6">No management companies found in NOVARAMgmtCompanies.</td></tr>';
      return;
    }

    tbody.innerHTML = companies
      .map(function (company) {
        companiesById[company.mgmtCompanyId] = company;
        var contact = company.contactName || company.contactEmail || "—";
        return (
          '<tr class="mgmt-company-row" data-mgmt-company-id="' +
          escapeHtml(company.mgmtCompanyId) +
          '" tabindex="0">' +
          "<td>" +
          escapeHtml(company.mgmtCompanyId) +
          "</td>" +
          "<td>" +
          escapeHtml(company.name || company.mgmtCompanyName) +
          "</td>" +
          "<td>" +
          escapeHtml(formatLocation(company)) +
          "</td>" +
          "<td>" +
          escapeHtml(contact) +
          "</td>" +
          "<td>" +
          escapeHtml(formatPhoneValue(company.contactPhone) || "—") +
          "</td>" +
          "<td>" +
          '<button type="button" class="link-btn edit-mgmt-company-btn" data-mgmt-company-id="' +
          escapeHtml(company.mgmtCompanyId) +
          '">Edit</button>' +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function loadCompanies() {
    setStatus("Loading management companies…", false);
    var api = window.NovaraApi;
    var request = api
      ? api.getMgmtCompanies()
      : fetch("/api/mgmt-companies").then(function (response) {
          return response.json().then(function (body) {
            if (!response.ok) {
              var detail = body && (body.detail || body.error);
              throw new Error(detail || "Request failed (" + response.status + ")");
            }
            return body;
          });
        });

    return request
      .then(function (data) {
        var companies = (data && data.mgmtCompanies) || [];
        renderCompanies(companies);
        if (!companies.length) {
          setStatus("No management companies found in NOVARAMgmtCompanies.", false);
        } else {
          setStatus(
            companies.length +
              " management compan" +
              (companies.length === 1 ? "y" : "ies"),
            false
          );
        }
      })
      .catch(function (err) {
        tbody.innerHTML =
          '<tr><td colspan="6">Unable to load management companies.</td></tr>';
        setStatus(err.message || "Failed to load management companies", true);
      });
  }

  function saveMgmtCompany(event) {
    event.preventDefault();
    setFormError("");

    var payload = collectPayload();
    if (!payload.MgmtCompanyID) {
      setFormError("MgmtCompanyID is required.");
      if (mgmtCompanyIdInput) mgmtCompanyIdInput.focus();
      return;
    }
    if (!payload.Name) {
      setFormError("Name is required.");
      var nameEl = document.getElementById("field-name");
      if (nameEl) nameEl.focus();
      return;
    }

    var mode = currentMode === "edit" ? "edit" : "create";
    if (modeInput) {
      modeInput.value = mode;
    }
    var api = window.NovaraApi;
    if (!api) {
      setFormError("API client is unavailable.");
      return;
    }

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving…";
    }

    function submit(payloadToSave, allowRetry) {
      var request =
        mode === "edit"
          ? api.updateMgmtCompany(payloadToSave)
          : api.createMgmtCompany(payloadToSave);

      return request
        .then(function () {
          closeModal();
          return loadCompanies();
        })
        .catch(function (err) {
          var message = err.message || "Failed to save management company";
          var isDuplicate =
            mode === "create" &&
            /already exists/i.test(message) &&
            allowRetry;

          if (isDuplicate) {
            return Promise.resolve(loadCompanies())
              .catch(function () {})
              .then(function () {
                var regenerated = nextMgmtCompanyId();
                setFieldValue("field-mgmtCompanyId", regenerated);
                payloadToSave.MgmtCompanyID = regenerated;
                return submit(payloadToSave, false);
              });
          }

          setFormError(message);
          if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = "Save";
          }
        });
    }

    submit(payload, true);
  }

  if (addBtn) {
    addBtn.addEventListener("click", function () {
      addBtn.disabled = true;
      Promise.resolve(loadCompanies())
        .catch(function () {})
        .then(function () {
          openModal("create");
        })
        .finally(function () {
          addBtn.disabled = false;
        });
    });
  }
  if (closeBtn) {
    closeBtn.addEventListener("click", closeModal);
  }
  if (cancelBtn) {
    cancelBtn.addEventListener("click", closeModal);
  }
  if (modal) {
    modal.addEventListener("click", function (event) {
      if (event.target === modal) {
        closeModal();
      }
    });
  }
  if (form) {
    form.addEventListener("submit", saveMgmtCompany);
  }

  if (
    window.NovaraPhone &&
    typeof window.NovaraPhone.bindPhoneInput === "function"
  ) {
    window.NovaraPhone.bindPhoneInput(
      document.getElementById("field-contactPhone")
    );
  }

  tbody.addEventListener("click", function (event) {
    var editBtn = event.target.closest(".edit-mgmt-company-btn");
    if (editBtn) {
      event.stopPropagation();
      var editId = editBtn.getAttribute("data-mgmt-company-id");
      if (editId && companiesById[editId]) {
        openModal("edit", companiesById[editId]);
      }
    }
  });

  tbody.addEventListener("keydown", function (event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    var row = event.target.closest("tr.mgmt-company-row");
    if (!row) return;
    event.preventDefault();
    var companyId = row.getAttribute("data-mgmt-company-id");
    if (companyId && companiesById[companyId]) {
      openModal("edit", companiesById[companyId]);
    }
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && modal && !modal.hidden) {
      closeModal();
    }
  });

  loadCompanies();
})();
