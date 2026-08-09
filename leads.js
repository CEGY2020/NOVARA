(function () {
  var statusEl = document.getElementById("leads-status");
  var tbody = document.getElementById("leads-tbody");
  var addBtn = document.getElementById("add-lead-btn");
  var modal = document.getElementById("lead-modal");
  var form = document.getElementById("lead-form");
  var modeInput = document.getElementById("lead-mode");
  var modalTitle = document.getElementById("lead-modal-title");
  var modalSubtitle = document.getElementById("lead-modal-subtitle");
  var formError = document.getElementById("lead-form-error");
  var saveBtn = document.getElementById("lead-save-btn");
  var closeBtn = document.getElementById("lead-modal-close");
  var cancelBtn = document.getElementById("lead-cancel-btn");
  var leadIdInput = document.getElementById("field-leadId");

  var leadsById = {};
  /** Authoritative create|edit mode. Do not rely only on #lead-mode — form.reset() restores its default. */
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

  function formatFollowUp(value) {
    if (!value) return "—";
    return String(value);
  }

  function collectPayload() {
    var payload = {
      LeadID: fieldValue("field-leadId"),
      CompanyName: fieldValue("field-companyName"),
      ContactName: fieldValue("field-contactName"),
      ContactEmail: fieldValue("field-contactEmail"),
      ContactPhone: fieldValue("field-contactPhone"),
      Source: fieldValue("field-source"),
      SystemType: fieldValue("field-systemType"),
      Stage: fieldValue("field-stage") || "New Lead",
      NextFollowUp: fieldValue("field-nextFollowUp"),
      AssignedTo: fieldValue("field-assignedTo"),
      Notes: fieldValue("field-notes"),
    };
    var savings = fieldValue("field-estimatedSavings");
    if (savings !== "") {
      payload.EstimatedSavings = Number(savings);
    }
    return payload;
  }

  /** Next sequential LeadID from NOVARALeads rows matching LD###. */
  function nextLeadId() {
    var maxNum = 0;
    var pattern = /^LD(\d+)$/i;
    Object.keys(leadsById).forEach(function (id) {
      var match = pattern.exec(String(id || "").trim());
      if (!match) return;
      var num = parseInt(match[1], 10);
      if (Number.isFinite(num) && num > maxNum) {
        maxNum = num;
      }
    });
    var next = maxNum + 1;
    var width = Math.max(3, String(next).length);
    return "LD" + String(next).padStart(width, "0");
  }

  function setLeadIdHint(mode) {
    var hint = document.getElementById("lead-id-hint");
    if (!hint) return;
    if (mode === "edit") {
      hint.textContent = "LeadID cannot be changed";
    } else {
      hint.textContent = "Auto-generated sequentially (LD001…)";
    }
  }

  function openModal(mode, lead) {
    if (!modal || !form) return;
    mode = mode === "edit" ? "edit" : "create";
    setFormError("");
    form.reset();

    // Must set mode AFTER reset — #lead-mode defaults to "create" in the HTML.
    currentMode = mode;
    if (modeInput) {
      modeInput.value = mode;
    }

    if (leadIdInput) {
      leadIdInput.readOnly = true;
    }
    setLeadIdHint(mode);

    if (mode === "edit" && lead) {
      modalTitle.textContent = "Edit Lead";
      modalSubtitle.textContent =
        "Update " + (lead.leadId || "lead") + " in NOVARALeads";
      setFieldValue("field-leadId", lead.leadId);
      setFieldValue(
        "field-companyName",
        lead.companyName || lead.siteName || ""
      );
      setFieldValue("field-contactName", lead.contactName || "");
      setFieldValue("field-contactEmail", lead.contactEmail || "");
      setFieldValue("field-contactPhone", lead.contactPhone || "");
      setFieldValue("field-source", lead.source || "");
      setFieldValue("field-systemType", lead.systemType || "");
      setFieldValue("field-stage", lead.stage || "New Lead");
      setFieldValue("field-nextFollowUp", lead.nextFollowUp || "");
      setFieldValue("field-assignedTo", lead.assignedTo || "");
      setFieldValue(
        "field-estimatedSavings",
        lead.estimatedSavings == null ? "" : lead.estimatedSavings
      );
      setFieldValue("field-notes", lead.notes || "");
    } else {
      modalTitle.textContent = "Add Lead";
      modalSubtitle.textContent = "Create a new lead in NOVARALeads";
      setFieldValue("field-leadId", nextLeadId());
      setFieldValue("field-stage", "New Lead");
    }

    modal.hidden = false;
    document.body.classList.add("modal-open");
    var focusEl = document.getElementById("field-companyName");
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

  function renderLeads(leads) {
    leadsById = {};
    if (!leads.length) {
      tbody.innerHTML =
        '<tr><td colspan="7">No leads found in NOVARALeads.</td></tr>';
      return;
    }

    tbody.innerHTML = leads
      .map(function (lead) {
        leadsById[lead.leadId] = lead;
        var contact = lead.contactName || lead.contactEmail || "—";
        return (
          '<tr class="lead-row" data-lead-id="' +
          escapeHtml(lead.leadId) +
          '" tabindex="0">' +
          "<td>" +
          escapeHtml(lead.leadId) +
          "</td>" +
          "<td>" +
          escapeHtml(lead.companyName || lead.siteName || "—") +
          "</td>" +
          "<td>" +
          escapeHtml(contact) +
          "</td>" +
          "<td>" +
          escapeHtml(lead.stage || "—") +
          "</td>" +
          "<td>" +
          escapeHtml(formatFollowUp(lead.nextFollowUp)) +
          "</td>" +
          "<td>" +
          escapeHtml(lead.assignedTo || "—") +
          "</td>" +
          "<td>" +
          '<button type="button" class="link-btn edit-lead-btn" data-lead-id="' +
          escapeHtml(lead.leadId) +
          '">Edit</button>' +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function loadLeads() {
    setStatus("Loading leads…", false);
    var api = window.NovaraApi;
    var request = api
      ? api.getLeads()
      : fetch("/api/leads").then(function (response) {
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
        var leads = (data && data.leads) || [];
        renderLeads(leads);
        if (!leads.length) {
          setStatus("No leads found in NOVARALeads.", false);
        } else {
          setStatus(
            leads.length + " lead" + (leads.length === 1 ? "" : "s"),
            false
          );
        }
      })
      .catch(function (err) {
        tbody.innerHTML =
          '<tr><td colspan="7">Unable to load leads.</td></tr>';
        setStatus(err.message || "Failed to load leads", true);
      });
  }

  function saveLead(event) {
    event.preventDefault();
    setFormError("");

    var payload = collectPayload();
    if (!payload.LeadID) {
      setFormError("LeadID is required.");
      if (leadIdInput) leadIdInput.focus();
      return;
    }
    if (!payload.CompanyName) {
      setFormError("CompanyName / SiteName is required.");
      var nameEl = document.getElementById("field-companyName");
      if (nameEl) nameEl.focus();
      return;
    }
    if (
      payload.EstimatedSavings != null &&
      !Number.isFinite(payload.EstimatedSavings)
    ) {
      setFormError("EstimatedSavings must be a number.");
      var savingsEl = document.getElementById("field-estimatedSavings");
      if (savingsEl) savingsEl.focus();
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
          ? api.updateLead(payloadToSave)
          : api.createLead(payloadToSave);

      return request
        .then(function () {
          closeModal();
          return loadLeads();
        })
        .catch(function (err) {
          var message = err.message || "Failed to save lead";
          var isDuplicate =
            mode === "create" &&
            /already exists/i.test(message) &&
            allowRetry;

          if (isDuplicate) {
            return Promise.resolve(loadLeads())
              .catch(function () {})
              .then(function () {
                var regenerated = nextLeadId();
                setFieldValue("field-leadId", regenerated);
                payloadToSave.LeadID = regenerated;
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
      Promise.resolve(loadLeads())
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
    form.addEventListener("submit", saveLead);
  }

  tbody.addEventListener("click", function (event) {
    var editBtn = event.target.closest(".edit-lead-btn");
    if (editBtn) {
      event.stopPropagation();
      var editId = editBtn.getAttribute("data-lead-id");
      if (editId && leadsById[editId]) {
        openModal("edit", leadsById[editId]);
      }
    }
  });

  tbody.addEventListener("keydown", function (event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    var row = event.target.closest("tr.lead-row");
    if (!row) return;
    event.preventDefault();
    var leadId = row.getAttribute("data-lead-id");
    if (leadId && leadsById[leadId]) {
      openModal("edit", leadsById[leadId]);
    }
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && modal && !modal.hidden) {
      closeModal();
    }
  });

  loadLeads();
})();
