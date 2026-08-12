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
  var ownerSelect = document.getElementById("field-owner");
  var mgmtCompanySelect = document.getElementById("field-mgmtCompany");

  var sitesById = {};
  var ownersList = [];
  var mgmtCompaniesList = [];
  /** Authoritative create|edit mode. Do not rely only on #site-mode — form.reset() restores its default. */
  var currentMode = "create";
  var photosUI =
    window.NovaraPhotosUI && typeof NovaraPhotosUI.create === "function"
      ? NovaraPhotosUI.create({ idPrefix: "photo", defaultPhotoType: "Property" })
      : null;

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
      text.indexOf("alarm") !== -1 ||
      text.indexOf("maintenance") !== -1
    ) {
      return "status-warning";
    }
    if (text.indexOf("online") !== -1 || text.indexOf("ok") !== -1 || text.indexOf("normal") !== -1) {
      return "status-online";
    }
    return "";
  }

  function updateDerivedFieldHints(site) {
    var systemsHint = document.getElementById("systems-count-hint");
    var statusHint = document.getElementById("site-status-hint");
    var statusSelect = document.getElementById("field-status");
    var count =
      site && site.systems != null && site.systems !== "—"
        ? Number(site.systems)
        : 0;
    if (!Number.isFinite(count)) count = 0;

    if (systemsHint) {
      systemsHint.textContent =
        "Live count of systems linked by SiteID in NOVARASystems";
    }
    if (statusHint) {
      if (count > 0) {
        statusHint.textContent =
          "Derived from linked systems (Offline > Needs Review > Online)";
      } else {
        statusHint.textContent =
          "No linked systems yet — set status manually, or it stays Online";
      }
    }
    if (statusSelect) {
      statusSelect.disabled = count > 0;
    }
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
    var ownerId = fieldValue("field-owner");
    return {
      SiteID: fieldValue("field-siteId"),
      SiteName: fieldValue("field-siteName"),
      Owner: ownerId,
      OwnerID: ownerId,
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

  /** Next sequential SiteID from NOVARASites rows matching SITE###. */
  function nextSiteId() {
    var maxNum = 0;
    var pattern = /^SITE(\d+)$/i;
    Object.keys(sitesById).forEach(function (id) {
      var match = pattern.exec(String(id || "").trim());
      if (!match) return;
      var num = parseInt(match[1], 10);
      if (Number.isFinite(num) && num > maxNum) {
        maxNum = num;
      }
    });
    var next = maxNum + 1;
    var width = Math.max(3, String(next).length);
    return "SITE" + String(next).padStart(width, "0");
  }

  function setSiteIdHint(mode) {
    var hint = document.getElementById("site-id-hint");
    if (!hint) return;
    if (mode === "edit") {
      hint.textContent = "SiteID cannot be changed";
    } else {
      hint.textContent = "Auto-generated from existing sites";
    }
  }

  function resolveLookupId(list, selectedValue, idKey, nameKeys) {
    var value = String(selectedValue == null ? "" : selectedValue).trim();
    if (!value) return "";
    var matchById = list.find(function (row) {
      return String(row[idKey] || "") === value;
    });
    if (matchById) {
      return String(matchById[idKey] || "");
    }
    var matchByName = list.find(function (row) {
      return nameKeys.some(function (key) {
        return String(row[key] || "").trim() === value;
      });
    });
    if (matchByName) {
      return String(matchByName[idKey] || "");
    }
    return value;
  }

  function populateOwnerOptions(selectedOwner) {
    if (!ownerSelect) return;
    var selectedId = resolveLookupId(ownersList, selectedOwner, "ownerId", [
      "name",
      "ownerName",
    ]);
    var options =
      '<option value="">Select owner…</option>' +
      ownersList
        .map(function (owner) {
          var id = owner.ownerId || "";
          var label = owner.name || owner.ownerName || id;
          var selected = selectedId && selectedId === id ? " selected" : "";
          return (
            '<option value="' +
            escapeHtml(id) +
            '"' +
            selected +
            ">" +
            escapeHtml(label) +
            "</option>"
          );
        })
        .join("");
    ownerSelect.innerHTML = options;
    if (selectedId) {
      ownerSelect.value = selectedId;
    }
  }

  function populateMgmtCompanyOptions(selectedCompany) {
    if (!mgmtCompanySelect) return;
    var selectedId = resolveLookupId(
      mgmtCompaniesList,
      selectedCompany,
      "mgmtCompanyId",
      ["name", "mgmtCompanyName"]
    );
    var options =
      '<option value="">Select company…</option>' +
      mgmtCompaniesList
        .map(function (company) {
          var id = company.mgmtCompanyId || "";
          var label = company.name || company.mgmtCompanyName || id;
          var selected = selectedId && selectedId === id ? " selected" : "";
          return (
            '<option value="' +
            escapeHtml(id) +
            '"' +
            selected +
            ">" +
            escapeHtml(label) +
            "</option>"
          );
        })
        .join("");
    mgmtCompanySelect.innerHTML = options;
    if (selectedId) {
      mgmtCompanySelect.value = selectedId;
    }
  }

  function openModal(mode, site) {
    if (!modal || !form) return;
    mode = mode === "edit" ? "edit" : "create";
    setFormError("");
    form.reset();

    // Must set mode AFTER reset — #site-mode defaults to "create" in the HTML.
    currentMode = mode;
    if (modeInput) {
      modeInput.value = mode;
    }

    if (siteIdInput) {
      siteIdInput.readOnly = true;
    }
    setSiteIdHint(mode);

    if (mode === "edit" && site) {
      modalTitle.textContent = "Edit Site";
      modalSubtitle.textContent = "Update " + (site.siteId || "site") + " in NOVARASites";
      setFieldValue("field-siteId", site.siteId);
      setFieldValue("field-siteName", site.siteName || site.name);
      populateOwnerOptions(site.ownerId || site.owner);
      populateMgmtCompanyOptions(site.mgmtCompany);
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
      updateDerivedFieldHints(site);
      if (photosUI) {
        photosUI.bind({ enabled: true, siteId: site.siteId });
      }
    } else {
      modalTitle.textContent = "Add Site";
      modalSubtitle.textContent = "Create a new site in NOVARASites";
      setFieldValue("field-siteId", nextSiteId());
      populateOwnerOptions("");
      populateMgmtCompanyOptions("");
      setFieldValue("field-status", "Online");
      setFieldValue("field-systems", 0);
      updateDerivedFieldHints({ systems: 0 });
      if (photosUI) {
        photosUI.bind({ enabled: false, siteId: "" });
      }
    }

    modal.hidden = false;
    document.body.classList.add("modal-open");
    var focusEl = document.getElementById("field-siteName");
    if (focusEl) {
      focusEl.focus();
    }
  }

  function closeModal() {
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove("modal-open");
    setFormError("");
    if (photosUI) {
      photosUI.clear();
    }
    var statusSelect = document.getElementById("field-status");
    if (statusSelect) {
      statusSelect.disabled = false;
    }
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
    }
  }

  function siteOwnerId(site) {
    var value = site && (site.ownerId || site.owner);
    value = String(value == null ? "" : value).trim();
    return value;
  }

  function siteOwnerName(site) {
    var storedId = siteOwnerId(site);
    var storedOwner = String((site && site.owner) || "").trim();
    if (!storedId && !storedOwner) {
      return "—";
    }
    var match = ownersList.find(function (owner) {
      var id = String(owner.ownerId || "");
      var name = String(owner.name || owner.ownerName || "").trim();
      return (
        (storedId && id === storedId) ||
        (storedOwner && (id === storedOwner || name === storedOwner))
      );
    });
    if (match) {
      return match.name || match.ownerName || storedOwner || storedId;
    }
    return storedOwner || storedId || "—";
  }

  function renderSites(sites) {
    sitesById = {};
    if (!sites.length) {
      tbody.innerHTML =
        '<tr><td colspan="7">No sites found in NOVARASites.</td></tr>';
      return;
    }

    tbody.innerHTML = sites
      .map(function (site) {
        sitesById[site.siteId] = site;
        var cls = statusClass(site.status);
        var statusHtml = cls
          ? '<td class="' + cls + '">' + escapeHtml(site.status) + "</td>"
          : "<td>" + escapeHtml(site.status) + "</td>";
        var ownerId = siteOwnerId(site);
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
          escapeHtml(siteOwnerName(site)) +
          "</td>" +
          "<td>" +
          escapeHtml(ownerId || "—") +
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

  function loadOwners() {
    var api = window.NovaraApi;
    var request = api
      ? api.getOwners()
      : fetch("/api/owners").then(function (response) {
          return response.json().then(function (body) {
            if (!response.ok) {
              var detail = body && (body.detail || body.error);
              throw new Error(detail || "Request failed (" + response.status + ")");
            }
            return body;
          });
        });

    return request.then(function (data) {
      ownersList = (data && data.owners) || [];
      return ownersList;
    });
  }

  function loadMgmtCompanies() {
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

    return request.then(function (data) {
      mgmtCompaniesList = (data && data.mgmtCompanies) || [];
      return mgmtCompaniesList;
    });
  }

  function loadLookups() {
    return Promise.all([
      Promise.resolve(loadOwners()).catch(function () {
        ownersList = ownersList || [];
      }),
      Promise.resolve(loadMgmtCompanies()).catch(function () {
        mgmtCompaniesList = mgmtCompaniesList || [];
      }),
    ]);
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
          '<tr><td colspan="7">Unable to load sites.</td></tr>';
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
          ? api.updateSite(payloadToSave)
          : api.createSite(payloadToSave);

      return request
        .then(function () {
          closeModal();
          return loadSites();
        })
        .catch(function (err) {
          var message = err.message || "Failed to save site";
          // Never retry-as-create while editing — that would insert a new SiteID.
          var isDuplicate =
            mode === "create" &&
            /already exists/i.test(message) &&
            allowRetry;

          if (isDuplicate) {
            return Promise.resolve(loadSites())
              .catch(function () {})
              .then(function () {
                var regenerated = nextSiteId();
                setFieldValue("field-siteId", regenerated);
                payloadToSave.SiteID = regenerated;
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

  function openSiteModal(mode, site) {
    return loadLookups().then(function () {
      openModal(mode, site);
    });
  }

  if (addBtn) {
    addBtn.addEventListener("click", function () {
      addBtn.disabled = true;
      // Refresh NOVARASites so the next SITE### is based on current rows.
      Promise.all([
        Promise.resolve(loadSites()).catch(function () {
          /* keep cached sitesById if refresh fails */
        }),
        loadLookups(),
      ])
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
    form.addEventListener("submit", saveSite);
  }

  tbody.addEventListener("click", function (event) {
    var editBtn = event.target.closest(".edit-site-btn");
    if (editBtn) {
      event.stopPropagation();
      var editId = editBtn.getAttribute("data-site-id");
      if (editId && sitesById[editId]) {
        openSiteModal("edit", sitesById[editId]);
      }
      return;
    }
    var row = event.target.closest("tr.site-row");
    if (!row) return;
    var siteId = row.getAttribute("data-site-id");
    if (siteId && sitesById[siteId]) {
      openSiteModal("edit", sitesById[siteId]);
    }
  });

  tbody.addEventListener("keydown", function (event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    var row = event.target.closest("tr.site-row");
    if (!row) return;
    event.preventDefault();
    var siteId = row.getAttribute("data-site-id");
    if (siteId && sitesById[siteId]) {
      openSiteModal("edit", sitesById[siteId]);
    }
  });

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape" || !modal || modal.hidden) return;
    var lightbox = document.getElementById("photo-lightbox");
    if (lightbox && !lightbox.hidden) {
      return;
    }
    closeModal();
  });

  Promise.all([
    Promise.resolve(loadLookups()).catch(function () {
      ownersList = [];
      mgmtCompaniesList = [];
    }),
    loadSites(),
  ]).then(function () {
    var sites = Object.keys(sitesById).map(function (id) {
      return sitesById[id];
    });
    if (sites.length) {
      renderSites(sites);
    }
  });
})();
