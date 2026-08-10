(function () {
  var STAGES = [
    "New Lead",
    "Contacted",
    "Qualified",
    "Proposal Sent",
    "Won",
    "Lost",
  ];
  var CLOSED_STAGES = { Won: true, Lost: true };
  var DUE_SOON_DAYS = 7;

  var statusEl = document.getElementById("leads-status");
  var tbody = document.getElementById("leads-tbody");
  var pipelineBoard = document.getElementById("pipeline-board");
  var listView = document.getElementById("leads-list-view");
  var pipelineView = document.getElementById("leads-pipeline-view");
  var filterStage = document.getElementById("filter-stage");
  var filterAssigned = document.getElementById("filter-assigned");
  var filterFollowUp = document.getElementById("filter-followup");
  var addBtn = document.getElementById("add-lead-btn");
  var modal = document.getElementById("lead-modal");
  var form = document.getElementById("lead-form");
  var modeInput = document.getElementById("lead-mode");
  var modalTitle = document.getElementById("lead-modal-title");
  var modalSubtitle = document.getElementById("lead-modal-subtitle");
  var formError = document.getElementById("lead-form-error");
  var lastUpdatedEl = document.getElementById("lead-last-updated");
  var saveBtn = document.getElementById("lead-save-btn");
  var closeBtn = document.getElementById("lead-modal-close");
  var cancelBtn = document.getElementById("lead-cancel-btn");
  var leadIdInput = document.getElementById("field-leadId");
  var viewTabs = document.querySelectorAll(".view-tab");

  var allLeads = [];
  var leadsById = {};
  /** Authoritative create|edit mode. Do not rely only on #lead-mode — form.reset() restores its default. */
  var currentMode = "create";
  var currentView = "list";
  var stageChangeInFlight = null;

  if (!tbody && !pipelineBoard) {
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

  function todayIsoDate() {
    var now = new Date();
    var y = now.getFullYear();
    var m = String(now.getMonth() + 1).padStart(2, "0");
    var d = String(now.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  function addDaysIso(isoDate, days) {
    var parts = String(isoDate || "").split("-");
    if (parts.length !== 3) return "";
    var date = new Date(
      Number(parts[0]),
      Number(parts[1]) - 1,
      Number(parts[2])
    );
    if (Number.isNaN(date.getTime())) return "";
    date.setDate(date.getDate() + days);
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, "0");
    var d = String(date.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  function parseFollowUpDate(value) {
    var raw = String(value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
    return raw;
  }

  /**
   * Returns "overdue" | "due-soon" | "scheduled" | "" for a lead's nextFollowUp.
   * Closed stages (Won/Lost) are not flagged for attention.
   */
  function followUpUrgency(lead) {
    if (!lead) return "";
    var stage = lead.stage || "";
    if (CLOSED_STAGES[stage]) return "";
    var date = parseFollowUpDate(lead.nextFollowUp);
    if (!date) return "";
    var today = todayIsoDate();
    if (date < today) return "overdue";
    var soonLimit = addDaysIso(today, DUE_SOON_DAYS);
    if (date <= soonLimit) return "due-soon";
    return "scheduled";
  }

  function needsFollowUp(lead) {
    var urgency = followUpUrgency(lead);
    return urgency === "overdue" || urgency === "due-soon";
  }

  function formatFollowUp(value) {
    if (!value) return "—";
    return String(value);
  }

  function formatUpdatedAt(value) {
    if (!value) return "—";
    var raw = String(value).trim();
    // Prefer date portion of ISO timestamps (YYYY-MM-DDTHH:MM:SSZ).
    var datePart = raw.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
      return datePart;
    }
    return raw;
  }

  function followUpBadgeHtml(urgency) {
    if (urgency === "overdue") {
      return '<span class="followup-badge followup-badge-overdue">Overdue</span>';
    }
    if (urgency === "due-soon") {
      return '<span class="followup-badge followup-badge-due-soon">Due soon</span>';
    }
    return "";
  }

  function followUpCellHtml(lead) {
    var urgency = followUpUrgency(lead);
    var badge = followUpBadgeHtml(urgency);
    var dateText = formatFollowUp(lead && lead.nextFollowUp);
    var classes = "followup-cell";
    if (urgency === "overdue") classes += " is-overdue";
    if (urgency === "due-soon") classes += " is-due-soon";
    return (
      '<div class="' +
      classes +
      '">' +
      "<span>" +
      escapeHtml(dateText) +
      "</span>" +
      badge +
      "</div>"
    );
  }

  function formatSavings(value) {
    if (value == null || value === "") return "";
    var num = Number(value);
    if (!Number.isFinite(num)) return String(value);
    return (
      "$" +
      num.toLocaleString(undefined, {
        maximumFractionDigits: 0,
      })
    );
  }

  function companyName(lead) {
    return (lead && (lead.companyName || lead.siteName)) || "—";
  }

  function leadToWritePayload(lead, stageOverride) {
    var payload = {
      LeadID: lead.leadId,
      CompanyName: lead.companyName || lead.siteName || "",
      ContactName: lead.contactName || "",
      ContactEmail: lead.contactEmail || "",
      ContactPhone: lead.contactPhone || "",
      Source: lead.source || "",
      SystemType: lead.systemType || "",
      Stage: stageOverride != null ? stageOverride : lead.stage || "New Lead",
      NextFollowUp: lead.nextFollowUp || "",
      AssignedTo: lead.assignedTo || "",
      Notes: lead.notes || "",
    };
    if (lead.estimatedSavings != null && lead.estimatedSavings !== "") {
      payload.EstimatedSavings = Number(lead.estimatedSavings);
    }
    return payload;
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

  function setLastUpdatedDisplay(lead) {
    if (!lastUpdatedEl) return;
    if (lead && lead.updatedAt) {
      lastUpdatedEl.hidden = false;
      lastUpdatedEl.textContent =
        "Last updated: " + formatUpdatedAt(lead.updatedAt);
    } else {
      lastUpdatedEl.hidden = true;
      lastUpdatedEl.textContent = "";
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
      setLastUpdatedDisplay(lead);
    } else {
      modalTitle.textContent = "Add Lead";
      modalSubtitle.textContent = "Create a new lead in NOVARALeads";
      setFieldValue("field-leadId", nextLeadId());
      setFieldValue("field-stage", "New Lead");
      setLastUpdatedDisplay(null);
    }

    modal.hidden = false;
    document.body.classList.add("modal-open");
    var focusEl =
      mode === "edit"
        ? document.getElementById("field-nextFollowUp")
        : document.getElementById("field-companyName");
    if (focusEl) {
      focusEl.focus();
    }
  }

  function closeModal() {
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove("modal-open");
    setFormError("");
    setLastUpdatedDisplay(null);
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
    }
  }

  function getFilters() {
    return {
      stage: filterStage ? String(filterStage.value || "").trim() : "",
      assignedTo: filterAssigned
        ? String(filterAssigned.value || "").trim()
        : "",
      followUp: filterFollowUp
        ? String(filterFollowUp.value || "").trim()
        : "",
    };
  }

  function matchesFollowUpFilter(lead, followUpFilter) {
    if (!followUpFilter) return true;
    var urgency = followUpUrgency(lead);
    var hasDate = Boolean(parseFollowUpDate(lead && lead.nextFollowUp));

    if (followUpFilter === "needs") {
      return needsFollowUp(lead);
    }
    if (followUpFilter === "overdue") {
      return urgency === "overdue";
    }
    if (followUpFilter === "due-soon") {
      return urgency === "due-soon";
    }
    if (followUpFilter === "none") {
      return !hasDate && !CLOSED_STAGES[lead.stage || ""];
    }
    return true;
  }

  function filteredLeads() {
    var filters = getFilters();
    return allLeads.filter(function (lead) {
      if (filters.stage && (lead.stage || "") !== filters.stage) {
        return false;
      }
      if (filters.assignedTo) {
        var assigned = String(lead.assignedTo || "").trim();
        if (assigned !== filters.assignedTo) {
          return false;
        }
      }
      if (!matchesFollowUpFilter(lead, filters.followUp)) {
        return false;
      }
      return true;
    });
  }

  function rebuildAssignedFilterOptions() {
    if (!filterAssigned) return;
    var previous = filterAssigned.value;
    var names = {};
    allLeads.forEach(function (lead) {
      var name = String(lead.assignedTo || "").trim();
      if (name) {
        names[name] = true;
      }
    });
    var sorted = Object.keys(names).sort(function (a, b) {
      return a.localeCompare(b, undefined, { sensitivity: "base" });
    });
    filterAssigned.innerHTML =
      '<option value="">Anyone</option>' +
      sorted
        .map(function (name) {
          return (
            '<option value="' +
            escapeHtml(name) +
            '">' +
            escapeHtml(name) +
            "</option>"
          );
        })
        .join("");
    if (previous && names[previous]) {
      filterAssigned.value = previous;
    }
  }

  function stageSelectHtml(lead) {
    var current = lead.stage || "New Lead";
    var options = STAGES.map(function (stage) {
      return (
        '<option value="' +
        escapeHtml(stage) +
        '"' +
        (stage === current ? " selected" : "") +
        ">" +
        escapeHtml(stage) +
        "</option>"
      );
    }).join("");
    return (
      '<label class="pipeline-stage-label">' +
      "<span>Move to</span>" +
      '<select class="pipeline-stage-select" data-lead-id="' +
      escapeHtml(lead.leadId) +
      '" aria-label="Move ' +
      escapeHtml(companyName(lead)) +
      ' to another stage">' +
      options +
      "</select>" +
      "</label>"
    );
  }

  function renderList(leads) {
    if (!tbody) return;
    if (!leads.length) {
      tbody.innerHTML =
        '<tr><td colspan="8">No leads match the current filters.</td></tr>';
      return;
    }

    tbody.innerHTML = leads
      .map(function (lead) {
        var contact = lead.contactName || lead.contactEmail || "—";
        var urgency = followUpUrgency(lead);
        var rowClass = "lead-row";
        if (urgency === "overdue") rowClass += " lead-row-overdue";
        if (urgency === "due-soon") rowClass += " lead-row-due-soon";
        return (
          '<tr class="' +
          rowClass +
          '" data-lead-id="' +
          escapeHtml(lead.leadId) +
          '" tabindex="0">' +
          "<td>" +
          escapeHtml(lead.leadId) +
          "</td>" +
          "<td>" +
          escapeHtml(companyName(lead)) +
          "</td>" +
          "<td>" +
          escapeHtml(contact) +
          "</td>" +
          "<td>" +
          escapeHtml(lead.stage || "—") +
          "</td>" +
          "<td>" +
          followUpCellHtml(lead) +
          "</td>" +
          "<td>" +
          escapeHtml(lead.assignedTo || "—") +
          "</td>" +
          '<td class="muted-date">' +
          escapeHtml(formatUpdatedAt(lead.updatedAt)) +
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

  function renderPipeline(leads) {
    if (!pipelineBoard) return;

    var filters = getFilters();
    var stagesToShow = filters.stage ? [filters.stage] : STAGES.slice();
    var byStage = {};
    STAGES.forEach(function (stage) {
      byStage[stage] = [];
    });
    leads.forEach(function (lead) {
      var stage = lead.stage || "New Lead";
      if (!byStage[stage]) {
        byStage[stage] = [];
      }
      byStage[stage].push(lead);
    });

    pipelineBoard.innerHTML = stagesToShow
      .map(function (stage) {
        var columnLeads = byStage[stage] || [];
        var cards = columnLeads.length
          ? columnLeads
              .map(function (lead) {
                var savings = formatSavings(lead.estimatedSavings);
                var urgency = followUpUrgency(lead);
                var cardClass = "pipeline-card";
                if (urgency === "overdue") cardClass += " is-overdue";
                if (urgency === "due-soon") cardClass += " is-due-soon";
                return (
                  '<article class="' +
                  cardClass +
                  '" data-lead-id="' +
                  escapeHtml(lead.leadId) +
                  '">' +
                  '<div class="pipeline-card-header">' +
                  "<strong>" +
                  escapeHtml(companyName(lead)) +
                  "</strong>" +
                  '<button type="button" class="link-btn edit-lead-btn" data-lead-id="' +
                  escapeHtml(lead.leadId) +
                  '">Edit</button>' +
                  "</div>" +
                  '<p class="pipeline-card-contact">' +
                  escapeHtml(lead.contactName || "—") +
                  "</p>" +
                  '<dl class="pipeline-card-meta">' +
                  "<div><dt>Follow-up</dt><dd>" +
                  followUpCellHtml(lead) +
                  "</dd></div>" +
                  (lead.updatedAt
                    ? "<div><dt>Updated</dt><dd class=\"muted-date\">" +
                      escapeHtml(formatUpdatedAt(lead.updatedAt)) +
                      "</dd></div>"
                    : "") +
                  (savings
                    ? "<div><dt>Est. savings</dt><dd class=\"savings-value\">" +
                      escapeHtml(savings) +
                      "</dd></div>"
                    : "") +
                  (lead.assignedTo
                    ? "<div><dt>Assigned</dt><dd>" +
                      escapeHtml(lead.assignedTo) +
                      "</dd></div>"
                    : "") +
                  "</dl>" +
                  stageSelectHtml(lead) +
                  "</article>"
                );
              })
              .join("")
          : '<p class="pipeline-column-empty">No leads</p>';

        return (
          '<section class="pipeline-column" data-stage="' +
          escapeHtml(stage) +
          '">' +
          '<header class="pipeline-column-header">' +
          "<h3>" +
          escapeHtml(stage) +
          "</h3>" +
          '<span class="pipeline-count">' +
          columnLeads.length +
          "</span>" +
          "</header>" +
          '<div class="pipeline-column-body">' +
          cards +
          "</div>" +
          "</section>"
        );
      })
      .join("");
  }

  function followUpFilterLabel(value) {
    if (value === "needs") return "needs follow-up";
    if (value === "overdue") return "overdue";
    if (value === "due-soon") return "due soon";
    if (value === "none") return "no follow-up date";
    return "";
  }

  function updateStatusFromFilters(visibleCount) {
    var filters = getFilters();
    var parts = [];
    if (filters.stage) {
      parts.push(filters.stage);
    }
    if (filters.assignedTo) {
      parts.push("assigned to " + filters.assignedTo);
    }
    var followLabel = followUpFilterLabel(filters.followUp);
    if (followLabel) {
      parts.push(followLabel);
    }
    var suffix = parts.length ? " (" + parts.join(", ") + ")" : "";
    if (!allLeads.length) {
      setStatus("No leads found in NOVARALeads.", false);
      return;
    }
    setStatus(
      visibleCount +
        " lead" +
        (visibleCount === 1 ? "" : "s") +
        " shown" +
        suffix +
        " · " +
        allLeads.length +
        " total",
      false
    );
  }

  function renderViews() {
    leadsById = {};
    allLeads.forEach(function (lead) {
      if (lead && lead.leadId) {
        leadsById[lead.leadId] = lead;
      }
    });
    var visible = filteredLeads();
    renderList(visible);
    renderPipeline(visible);
    updateStatusFromFilters(visible.length);
  }

  function setView(view, options) {
    options = options || {};
    currentView = view === "pipeline" ? "pipeline" : "list";

    viewTabs.forEach(function (tab) {
      var isActive = tab.getAttribute("data-view") === currentView;
      tab.classList.toggle("is-active", isActive);
      tab.setAttribute("aria-selected", isActive ? "true" : "false");
    });

    if (listView) {
      listView.hidden = currentView !== "list";
    }
    if (pipelineView) {
      pipelineView.hidden = currentView !== "pipeline";
    }

    if (!options.skipHash) {
      var desiredHash = currentView === "pipeline" ? "#pipeline" : "";
      var currentHash = window.location.hash || "";
      if (desiredHash && currentHash !== desiredHash) {
        if (history.replaceState) {
          history.replaceState(
            null,
            "",
            window.location.pathname + window.location.search + desiredHash
          );
        } else {
          window.location.hash = "pipeline";
        }
      } else if (!desiredHash && currentHash === "#pipeline") {
        if (history.replaceState) {
          history.replaceState(
            null,
            "",
            window.location.pathname + window.location.search
          );
        }
      }
    }

    // Keep sales nav highlight in sync when switching tabs.
    if (window.NovaraNav && NovaraNav.refreshActive) {
      NovaraNav.refreshActive();
    } else {
      document.dispatchEvent(
        new CustomEvent("novara:viewchange", { detail: { view: currentView } })
      );
    }
  }

  function viewFromHash() {
    var hash = String(window.location.hash || "")
      .replace(/^#/, "")
      .toLowerCase();
    return hash === "pipeline" ? "pipeline" : "list";
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
        allLeads = (data && data.leads) || [];
        rebuildAssignedFilterOptions();
        renderViews();
      })
      .catch(function (err) {
        allLeads = [];
        leadsById = {};
        if (tbody) {
          tbody.innerHTML =
            '<tr><td colspan="8">Unable to load leads.</td></tr>';
        }
        if (pipelineBoard) {
          pipelineBoard.innerHTML =
            '<p class="pipeline-empty is-error">Unable to load pipeline.</p>';
        }
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

  function changeLeadStage(leadId, newStage, selectEl) {
    var lead = leadsById[leadId];
    if (!lead) return;
    var previousStage = lead.stage || "New Lead";
    if (newStage === previousStage) return;

    var api = window.NovaraApi;
    if (!api) {
      setStatus("API client is unavailable.", true);
      if (selectEl) selectEl.value = previousStage;
      return;
    }

    if (stageChangeInFlight === leadId) {
      if (selectEl) selectEl.value = previousStage;
      return;
    }

    stageChangeInFlight = leadId;
    if (selectEl) {
      selectEl.disabled = true;
    }
    setStatus("Moving " + companyName(lead) + " to " + newStage + "…", false);

    api
      .updateLead(leadToWritePayload(lead, newStage))
      .then(function () {
        return loadLeads();
      })
      .catch(function (err) {
        if (selectEl) {
          selectEl.value = previousStage;
        }
        setStatus(err.message || "Failed to update stage", true);
      })
      .finally(function () {
        stageChangeInFlight = null;
        if (selectEl) {
          selectEl.disabled = false;
        }
      });
  }

  function handleEditClick(event) {
    var editBtn = event.target.closest(".edit-lead-btn");
    if (!editBtn) return false;
    event.preventDefault();
    event.stopPropagation();
    var editId = editBtn.getAttribute("data-lead-id");
    if (editId && leadsById[editId]) {
      openModal("edit", leadsById[editId]);
    }
    return true;
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

  viewTabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      setView(tab.getAttribute("data-view") || "list");
    });
  });

  if (filterStage) {
    filterStage.addEventListener("change", renderViews);
  }
  if (filterAssigned) {
    filterAssigned.addEventListener("change", renderViews);
  }
  if (filterFollowUp) {
    filterFollowUp.addEventListener("change", renderViews);
  }

  if (tbody) {
    tbody.addEventListener("click", function (event) {
      handleEditClick(event);
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
  }

  if (pipelineBoard) {
    pipelineBoard.addEventListener("click", function (event) {
      handleEditClick(event);
    });

    pipelineBoard.addEventListener("change", function (event) {
      var select = event.target.closest(".pipeline-stage-select");
      if (!select) return;
      var leadId = select.getAttribute("data-lead-id");
      var newStage = String(select.value || "").trim();
      if (leadId && newStage) {
        changeLeadStage(leadId, newStage, select);
      }
    });
  }

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && modal && !modal.hidden) {
      closeModal();
    }
  });

  window.addEventListener("hashchange", function () {
    setView(viewFromHash(), { skipHash: true });
  });

  setView(viewFromHash(), { skipHash: true });
  loadLeads();
})();
