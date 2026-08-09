(function () {
  var statusEl = document.getElementById("sites-status");
  var tbody = document.getElementById("sites-tbody");
  var addBtn = document.getElementById("add-site-btn");
  var modal = document.getElementById("site-modal");
  var form = document.getElementById("site-form");
  var modeInput = document.getElementById("site-mode");
  var modalTitle = document.getElementById("site-modal-title");
  var modalSubtitle = document.getElementById("site-modal-subtitle");
  var formError = document.getElementById("site-form-error");
  var saveBtn = document.getElementById("site-save-btn");
  var closeBtn = document.getElementById("site-modal-close");
  var cancelBtn = document.getElementById("site-cancel-btn");
  var siteIdInput = document.getElementById("field-siteId");

  var sitesById = {};

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

  function statusClass(status) {
    var text = String(status || "").toLowerCase();
    if (text.indexOf("offline") !== -1 || text.indexOf("critical") !== -1) {
      return "status-offline";
    }
    if (
      text.indexOf("warn") !== -1 ||
      text.indexOf("review") !== -1 ||
      text.indexOf("alarm") !== -1
    ) {
      return "status-warning";
    }
    if (text.indexOf("online") !== -1 || text.indexOf("ok") !== -1 || text.indexOf("normal") !== -1) {
      return "status-online";
    }
    return "";
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

  function collectPayload() {
    var systemsRaw = fieldValue("field-systems");
    var systems = systemsRaw === "" ? 0 : Number(systemsRaw);
    return {
      SiteID: fieldValue("field-siteId"),
      SiteName: fieldValue("field-siteName"),
      Owner: fieldValue("field-owner"),
      MgmtCompany: fieldValue("field-mgmtCompany"),
      Address: fieldValue("field-address"),
      City: fieldValue("field-city"),
      State: fieldValue("field-state"),
      Zip: fieldValue("field-zip"),
      SystemType: fieldValue("field-systemType"),
      Status: fieldValue("field-status") || "Online",
      Systems: Number.isFinite(systems) ? systems : systemsRaw,
    };
  }

  function openModal(mode, site) {
    if (!modal || !form) return;
    mode = mode === "edit" ? "edit" : "create";
    modeInput.value = mode;
    setFormError("");
    form.reset();

    if (mode === "edit" && site) {
      modalTitle.textContent = "Edit Site";
      modalSubtitle.textContent = "Update " + (site.siteId || "site") + " in NOVARASites";
      setFieldValue("field-siteId", site.siteId);
      setFieldValue("field-siteName", site.siteName || site.name);
      setFieldValue("field-owner", site.owner);
      setFieldValue("field-mgmtCompany", site.mgmtCompany);
      setFieldValue("field-address", site.address);
      setFieldValue("field-city", site.city);
      setFieldValue("field-state", site.state);
      setFieldValue("field-zip", site.zip);
      setFieldValue("field-systemType", site.systemType || "");
      setFieldValue("field-status", site.status || "Online");
      setFieldValue(
        "field-systems",
        site.systems == null || site.systems === "—" ? 0 : site.systems
      );
      if (siteIdInput) {
        siteIdInput.readOnly = true;
      }
    } else {
      modalTitle.textContent = "Add Site";
      modalSubtitle.textContent = "Create a new site in NOVARASites";
      setFieldValue("field-status", "Online");
      setFieldValue("field-systems", 0);
      if (siteIdInput) {
        siteIdInput.readOnly = false;
      }
    }

    modal.hidden = false;
    document.body.classList.add("modal-open");
    var focusEl = mode === "edit" ? document.getElementById("field-siteName") : siteIdInput;
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

  function renderSites(sites) {
    sitesById = {};
    if (!sites.length) {
      tbody.innerHTML =
        '<tr><td colspan="5">No sites found in NOVARASites.</td></tr>';
      return;
    }

    tbody.innerHTML = sites
      .map(function (site) {
        sitesById[site.siteId] = site;
        var cls = statusClass(site.status);
        var statusHtml = cls
          ? '<td class="' + cls + '">' + escapeHtml(site.status) + "</td>"
          : "<td>" + escapeHtml(site.status) + "</td>";
        return (
          '<tr class="site-row" data-site-id="' +
          escapeHtml(site.siteId) +
          '" tabindex="0">' +
          "<td>" +
          escapeHtml(site.name) +
          "</td>" +
          "<td>" +
          escapeHtml(site.location) +
          "</td>" +
          "<td>" +
          escapeHtml(site.systems) +
          "</td>" +
          statusHtml +
          "<td>" +
          '<button type="button" class="link-btn edit-site-btn" data-site-id="' +
          escapeHtml(site.siteId) +
          '">Edit</button>' +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function loadSites() {
    setStatus("Loading sites…", false);
    var api = window.NovaraApi;
    var request = api
      ? api.getSites()
      : fetch("/api/sites").then(function (response) {
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
        var sites = (data && data.sites) || [];
        renderSites(sites);
        if (!sites.length) {
          setStatus("No sites found in NOVARASites.", false);
        } else {
          setStatus(sites.length + " site" + (sites.length === 1 ? "" : "s"), false);
        }
      })
      .catch(function (err) {
        tbody.innerHTML =
          '<tr><td colspan="5">Unable to load sites.</td></tr>';
        setStatus(err.message || "Failed to load sites", true);
      });
  }

  function saveSite(event) {
    event.preventDefault();
    setFormError("");

    var payload = collectPayload();
    if (!payload.SiteID) {
      setFormError("SiteID is required.");
      if (siteIdInput) siteIdInput.focus();
      return;
    }
    if (!payload.SiteName) {
      setFormError("SiteName is required.");
      var nameEl = document.getElementById("field-siteName");
      if (nameEl) nameEl.focus();
      return;
    }
    if (payload.Systems === "" || !Number.isFinite(Number(payload.Systems))) {
      setFormError("Systems must be a number.");
      return;
    }

    var mode = modeInput.value === "edit" ? "edit" : "create";
    var api = window.NovaraApi;
    if (!api) {
      setFormError("API client is unavailable.");
      return;
    }

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving…";
    }

    var request =
      mode === "edit" ? api.updateSite(payload) : api.createSite(payload);

    request
      .then(function () {
        closeModal();
        return loadSites();
      })
      .catch(function (err) {
        setFormError(err.message || "Failed to save site");
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = "Save";
        }
      });
  }

  if (addBtn) {
    addBtn.addEventListener("click", function () {
      openModal("create");
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
    form.addEventListener("submit", saveSite);
  }

  tbody.addEventListener("click", function (event) {
    var editBtn = event.target.closest(".edit-site-btn");
    if (editBtn) {
      event.stopPropagation();
      var editId = editBtn.getAttribute("data-site-id");
      if (editId && sitesById[editId]) {
        openModal("edit", sitesById[editId]);
      }
      return;
    }
    var row = event.target.closest("tr.site-row");
    if (!row) return;
    var siteId = row.getAttribute("data-site-id");
    if (siteId && sitesById[siteId]) {
      openModal("edit", sitesById[siteId]);
    }
  });

  tbody.addEventListener("keydown", function (event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    var row = event.target.closest("tr.site-row");
    if (!row) return;
    event.preventDefault();
    var siteId = row.getAttribute("data-site-id");
    if (siteId && sitesById[siteId]) {
      openModal("edit", sitesById[siteId]);
    }
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && modal && !modal.hidden) {
      closeModal();
    }
  });

  loadSites();
})();
