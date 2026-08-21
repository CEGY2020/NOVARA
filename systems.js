(function () {
  var statusEl = document.getElementById("systems-status");
  var tbody = document.getElementById("systems-tbody");
  var addBtn = document.getElementById("add-system-btn");
  var modal = document.getElementById("system-modal");
  var form = document.getElementById("system-form");
  var modeInput = document.getElementById("system-mode");
  var modalTitle = document.getElementById("system-modal-title");
  var modalSubtitle = document.getElementById("system-modal-subtitle");
  var formError = document.getElementById("system-form-error");
  var saveBtn = document.getElementById("system-save-btn");
  var closeBtn = document.getElementById("system-modal-close");
  var cancelBtn = document.getElementById("system-cancel-btn");
  var systemIdInput = document.getElementById("field-systemId");
  var siteSelect = document.getElementById("field-siteId");
  var siteIdDisplay = document.getElementById("field-siteIdDisplay");

  var systemsById = {};
  var sitesList = [];
  var lastSystems = [];
  /** Authoritative create|edit mode. Do not rely only on #system-mode — form.reset() restores its default. */
  var currentMode = "create";
  var photosUI =
    window.NovaraPhotosUI && typeof NovaraPhotosUI.create === "function"
      ? NovaraPhotosUI.create({ idPrefix: "photo", defaultPhotoType: "System" })
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
    var equipmentRaw = fieldValue("field-equipmentCount");
    var equipment = equipmentRaw === "" ? 0 : Number(equipmentRaw);
    return {
      SystemID: fieldValue("field-systemId"),
      SiteID: fieldValue("field-siteId"),
      SystemName: fieldValue("field-systemName"),
      SystemType: fieldValue("field-systemType"),
      Status: fieldValue("field-status") || "Online",
      EquipmentCount: Number.isFinite(equipment) ? equipment : equipmentRaw,
      InstallDate: fieldValue("field-installDate"),
      Notes: fieldValue("field-notes"),
    };
  }

  /** Next sequential SystemID from NOVARASystems rows matching SYS###. */
  function nextSystemId() {
    var maxNum = 0;
    var pattern = /^SYS(\d+)$/i;
    Object.keys(systemsById).forEach(function (id) {
      var match = pattern.exec(String(id || "").trim());
      if (!match) return;
      var num = parseInt(match[1], 10);
      if (Number.isFinite(num) && num > maxNum) {
        maxNum = num;
      }
    });
    var next = maxNum + 1;
    var width = Math.max(3, String(next).length);
    return "SYS" + String(next).padStart(width, "0");
  }

  function setSystemIdHint(mode) {
    var hint = document.getElementById("system-id-hint");
    if (!hint) return;
    if (mode === "edit") {
      hint.textContent = "SystemID cannot be changed";
    } else {
      hint.textContent = "Auto-generated sequentially (SYS001…)";
    }
  }

  function syncLookupIdDisplay(selectEl, displayEl) {
    if (!displayEl) return;
    displayEl.value = selectEl && selectEl.value ? String(selectEl.value) : "";
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

  function siteOptionLabel(site) {
    return site.name || site.siteName || site.siteId || "";
  }

  function ensureSelectValue(selectEl, value) {
    if (!selectEl) return;
    var text = String(value == null ? "" : value);
    if (!text) return;
    var found = Array.prototype.some.call(selectEl.options, function (opt) {
      return opt.value === text;
    });
    if (!found) {
      var option = document.createElement("option");
      option.value = text;
      option.textContent = text;
      selectEl.appendChild(option);
    }
    selectEl.value = text;
  }

  function populateSiteOptions(selectedSite) {
    if (!siteSelect) return;
    var list = sitesList.slice().sort(function (a, b) {
      return String(siteOptionLabel(a))
        .toLowerCase()
        .localeCompare(String(siteOptionLabel(b)).toLowerCase());
    });
    var selectedId = resolveLookupId(list, selectedSite, "siteId", [
      "name",
      "siteName",
    ]);
    var seen = {};
    var options = '<option value="">Select site…</option>';
    list.forEach(function (site) {
      var id = site.siteId || "";
      if (!id || seen[id]) return;
      seen[id] = true;
      var label = siteOptionLabel(site) || id;
      var selected = selectedId && selectedId === id ? " selected" : "";
      options +=
        '<option value="' +
        escapeHtml(id) +
        '"' +
        selected +
        ">" +
        escapeHtml(label) +
        "</option>";
    });
    if (selectedId && !seen[selectedId]) {
      options +=
        '<option value="' +
        escapeHtml(selectedId) +
        '" selected>' +
        escapeHtml(selectedId) +
        "</option>";
    }
    siteSelect.innerHTML = options;
    if (selectedId) {
      siteSelect.value = selectedId;
    }
    syncLookupIdDisplay(siteSelect, siteIdDisplay);
  }

  function openModal(mode, system) {
    if (!modal || !form) return;
    mode = mode === "edit" ? "edit" : "create";
    setFormError("");
    form.reset();

    // Must set mode AFTER reset — #system-mode defaults to "create" in the HTML.
    currentMode = mode;
    if (modeInput) {
      modeInput.value = mode;
    }

    if (systemIdInput) {
      systemIdInput.readOnly = true;
    }
    setSystemIdHint(mode);

    if (mode === "edit" && system) {
      modalTitle.textContent = "Edit System";
      modalSubtitle.textContent =
        "Update " + (system.systemId || "system") + " in NOVARASystems";
      setFieldValue("field-systemId", system.systemId);
      populateSiteOptions(system.siteId || system.siteName || "");
      setFieldValue("field-systemName", system.systemName || system.name);
      ensureSelectValue(
        document.getElementById("field-systemType"),
        system.systemType || ""
      );
      ensureSelectValue(
        document.getElementById("field-status"),
        system.status || "Online"
      );
      setFieldValue(
        "field-equipmentCount",
        system.equipmentCount == null ? 0 : system.equipmentCount
      );
      setFieldValue("field-installDate", system.installDate || "");
      setFieldValue("field-notes", system.notes || "");
      if (photosUI) {
        photosUI.bind({
          enabled: true,
          siteId: system.siteId || "",
          systemId: system.systemId || "",
        });
      }
    } else {
      modalTitle.textContent = "Add System";
      modalSubtitle.textContent = "Create a new system in NOVARASystems";
      setFieldValue("field-systemId", nextSystemId());
      populateSiteOptions("");
      setFieldValue("field-status", "Online");
      setFieldValue("field-equipmentCount", 0);
      if (photosUI) {
        photosUI.bind({ enabled: false, siteId: "", systemId: "" });
      }
    }

    modal.hidden = false;
    document.body.classList.add("modal-open");
    var focusEl = document.getElementById("field-siteId");
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
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
    }
  }

  function systemSiteId(system) {
    var value = system && (system.siteId || system.SiteID);
    return String(value == null ? "" : value).trim();
  }

  function systemDetailHref(system) {
    return (
      "system-detail.html?systemId=" +
      encodeURIComponent((system && system.systemId) || "") +
      "&siteId=" +
      encodeURIComponent(systemSiteId(system))
    );
  }

  function openSystemDetail(system) {
    if (!system) return;
    window.location.assign(systemDetailHref(system));
  }

  function systemSiteName(system) {
    var storedId = systemSiteId(system);
    var storedName = String((system && system.siteName) || "").trim();
    if (!storedId && !storedName) {
      return "—";
    }
    var match = sitesList.find(function (site) {
      var id = String(site.siteId || "");
      var name = String(site.name || site.siteName || "").trim();
      return (
        (storedId && id === storedId) ||
        (storedName && (id === storedName || name === storedName))
      );
    });
    if (match) {
      return match.name || match.siteName || storedName || storedId;
    }
    return storedName || storedId || "—";
  }

  function renderSystems(systems) {
    lastSystems = Array.isArray(systems) ? systems : [];
    systemsById = {};
    if (!lastSystems.length) {
      tbody.innerHTML =
        '<tr><td colspan="8">No systems found in NOVARASystems.</td></tr>';
      return;
    }

    tbody.innerHTML = lastSystems
      .map(function (system) {
        systemsById[system.systemId] = system;
        var cls = statusClass(system.status);
        var statusHtml = cls
          ? '<td class="' + cls + '">' + escapeHtml(system.status) + "</td>"
          : "<td>" + escapeHtml(system.status) + "</td>";
        var siteId = systemSiteId(system);
        var detailHref = systemDetailHref(system);
        return (
          '<tr class="system-row" data-system-id="' +
          escapeHtml(system.systemId) +
          '" tabindex="0">' +
          "<td>" +
          '<a href="' +
          escapeHtml(detailHref) +
          '" title="View temperature trends">' +
          escapeHtml(system.systemId) +
          "</a>" +
          "</td>" +
          "<td>" +
          escapeHtml(systemSiteName(system)) +
          "</td>" +
          "<td>" +
          escapeHtml(siteId || "—") +
          "</td>" +
          "<td>" +
          escapeHtml(system.systemName || system.name) +
          "</td>" +
          "<td>" +
          escapeHtml(system.systemType || "—") +
          "</td>" +
          statusHtml +
          "<td>" +
          escapeHtml(
            system.equipmentCount == null ? 0 : system.equipmentCount
          ) +
          "</td>" +
          "<td>" +
          '<button type="button" class="link-btn edit-system-btn" data-system-id="' +
          escapeHtml(system.systemId) +
          '">Edit</button>' +
          ' <button type="button" class="link-btn danger-link-btn delete-system-btn" data-system-id="' +
          escapeHtml(system.systemId) +
          '">Delete</button>' +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function deleteSystem(systemId) {
    var system = systemsById[systemId];
    if (!system) return;
    var label = system.systemName || system.name || systemId;
    var confirmed = window.confirm(
      "Delete system " + systemId + " (" + label + ")?\n\nThis removes it from NOVARASystems and updates the linked site count."
    );
    if (!confirmed) return;

    var api = window.NovaraApi;
    if (!api || !api.deleteSystem) {
      setStatus("API client is unavailable.", true);
      return;
    }

    setStatus("Deleting " + systemId + "…", false);
    api
      .deleteSystem(systemId)
      .then(function () {
        return loadSystems();
      })
      .catch(function (err) {
        setStatus(err.message || "Failed to delete system", true);
      });
  }

  function loadSites() {
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

    return request.then(function (data) {
      var sites = (data && data.sites) || [];
      if (
        window.NovaraAuth &&
        typeof NovaraAuth.isOwnerUser === "function" &&
        NovaraAuth.isOwnerUser()
      ) {
        var ownerId = NovaraAuth.getOwnerId() || "";
        sites = ownerId
          ? sites.filter(function (site) {
              var id = String((site && (site.ownerId || site.owner)) || "").trim();
              return id === ownerId;
            })
          : [];
      }
      sitesList = sites;
      return sitesList;
    });
  }

  function loadSystems() {
    setStatus("Loading systems…", false);
    var api = window.NovaraApi;
    var request = api
      ? api.getSystems()
      : fetch("/api/systems").then(function (response) {
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
        var systems = (data && data.systems) || [];
        renderSystems(systems);
        if (!systems.length) {
          setStatus("No systems found in NOVARASystems.", false);
        } else {
          setStatus(
            systems.length + " system" + (systems.length === 1 ? "" : "s"),
            false
          );
        }
      })
      .catch(function (err) {
        tbody.innerHTML =
          '<tr><td colspan="8">Unable to load systems.</td></tr>';
        setStatus(err.message || "Failed to load systems", true);
      });
  }

  function saveSystem(event) {
    event.preventDefault();
    setFormError("");

    var payload = collectPayload();
    if (!payload.SystemID) {
      setFormError("SystemID is required.");
      if (systemIdInput) systemIdInput.focus();
      return;
    }
    if (!payload.SiteID) {
      setFormError("SiteID is required.");
      if (siteSelect) siteSelect.focus();
      return;
    }
    if (!payload.SystemName) {
      setFormError("SystemName is required.");
      var nameEl = document.getElementById("field-systemName");
      if (nameEl) nameEl.focus();
      return;
    }
    if (!payload.SystemType) {
      setFormError("SystemType is required.");
      var typeEl = document.getElementById("field-systemType");
      if (typeEl) typeEl.focus();
      return;
    }
    if (
      payload.EquipmentCount === "" ||
      !Number.isFinite(Number(payload.EquipmentCount))
    ) {
      setFormError("EquipmentCount must be a number.");
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
          ? api.updateSystem(payloadToSave)
          : api.createSystem(payloadToSave);

      return request
        .then(function () {
          closeModal();
          return loadSystems();
        })
        .catch(function (err) {
          var message = err.message || "Failed to save system";
          // Never retry-as-create while editing — that would insert a new SystemID.
          var isDuplicate =
            mode === "create" &&
            /already exists/i.test(message) &&
            allowRetry;

          if (isDuplicate) {
            return Promise.resolve(loadSystems())
              .catch(function () {})
              .then(function () {
                var regenerated = nextSystemId();
                setFieldValue("field-systemId", regenerated);
                payloadToSave.SystemID = regenerated;
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

  function openSystemModal(mode, system) {
    return Promise.resolve(loadSites())
      .catch(function () {})
      .then(function () {
        openModal(mode, system);
      });
  }

  if (addBtn) {
    addBtn.addEventListener("click", function () {
      addBtn.disabled = true;
      Promise.all([
        Promise.resolve(loadSystems()).catch(function () {}),
        Promise.resolve(loadSites()).catch(function () {}),
      ])
        .then(function () {
          if (!sitesList.length) {
            setFormError("");
            openModal("create");
            setFormError(
              "No sites found in NOVARASites. Add a site before creating a system."
            );
            return;
          }
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
    form.addEventListener("submit", saveSystem);
  }
  if (siteSelect) {
    siteSelect.addEventListener("change", function () {
      syncLookupIdDisplay(siteSelect, siteIdDisplay);
    });
  }

  tbody.addEventListener("click", function (event) {
    var deleteBtn = event.target.closest(".delete-system-btn");
    if (deleteBtn) {
      event.stopPropagation();
      var deleteId = deleteBtn.getAttribute("data-system-id");
      if (deleteId) {
        deleteSystem(deleteId);
      }
      return;
    }
    var editBtn = event.target.closest(".edit-system-btn");
    if (editBtn) {
      event.stopPropagation();
      var editId = editBtn.getAttribute("data-system-id");
      if (editId && systemsById[editId]) {
        openSystemModal("edit", systemsById[editId]);
      }
      return;
    }
    // Primary click (row or System ID link) always opens Temperature Trends.
    // Let the native <a> navigate; JS handles clicks on the rest of the row.
    if (event.target.closest("a")) {
      return;
    }
    var row = event.target.closest("tr.system-row");
    if (!row) return;
    var rowId = row.getAttribute("data-system-id");
    if (rowId && systemsById[rowId]) {
      openSystemDetail(systemsById[rowId]);
    }
  });

  tbody.addEventListener("keydown", function (event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    // Let Edit/Delete buttons and the System ID link keep native keyboard behavior.
    if (event.target.closest("a, button, input, select, textarea")) {
      return;
    }
    var row = event.target.closest("tr.system-row");
    if (!row) return;
    event.preventDefault();
    var systemId = row.getAttribute("data-system-id");
    if (systemId && systemsById[systemId]) {
      openSystemDetail(systemsById[systemId]);
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
    Promise.resolve(loadSites()).catch(function () {
      sitesList = [];
    }),
    loadSystems(),
  ]).then(function () {
    if (lastSystems.length) {
      renderSystems(lastSystems);
    }
  });
})();
