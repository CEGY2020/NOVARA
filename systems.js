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

  var systemsById = {};
  var sitesList = [];
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

  function populateSiteOptions(selectedSiteId) {
    if (!siteSelect) return;
    var options =
      '<option value="">Select site…</option>' +
      sitesList
        .map(function (site) {
          var id = site.siteId || "";
          var label = (site.name || site.siteName || id) + " (" + id + ")";
          var selected = selectedSiteId && selectedSiteId === id ? " selected" : "";
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
    siteSelect.innerHTML = options;
    if (selectedSiteId) {
      siteSelect.value = selectedSiteId;
    }
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
      populateSiteOptions(system.siteId || "");
      setFieldValue("field-systemName", system.systemName || system.name);
      setFieldValue("field-systemType", system.systemType || "");
      setFieldValue("field-status", system.status || "Online");
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

  function renderSystems(systems) {
    systemsById = {};
    if (!systems.length) {
      tbody.innerHTML =
        '<tr><td colspan="7">No systems found in NOVARASystems.</td></tr>';
      return;
    }

    tbody.innerHTML = systems
      .map(function (system) {
        systemsById[system.systemId] = system;
        var cls = statusClass(system.status);
        var statusHtml = cls
          ? '<td class="' + cls + '">' + escapeHtml(system.status) + "</td>"
          : "<td>" + escapeHtml(system.status) + "</td>";
        var siteLabel = system.siteName
          ? system.siteName
          : system.siteId || "—";
        var detailHref =
          "system-detail.html?systemId=" +
          encodeURIComponent(system.systemId || "") +
          "&siteId=" +
          encodeURIComponent(system.siteId || "");
        return (
          '<tr class="system-row" data-system-id="' +
          escapeHtml(system.systemId) +
          '" tabindex="0">' +
          "<td>" +
          '<a href="' +
          escapeHtml(detailHref) +
          '">' +
          escapeHtml(system.systemId) +
          "</a>" +
          "</td>" +
          "<td>" +
          escapeHtml(system.systemName || system.name) +
          "</td>" +
          "<td>" +
          escapeHtml(siteLabel) +
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
          '<tr><td colspan="7">Unable to load systems.</td></tr>';
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
      Promise.resolve(loadSites())
        .catch(function () {})
        .then(function () {
          if (editId && systemsById[editId]) {
            openModal("edit", systemsById[editId]);
          }
        });
      return;
    }
    // Ignore clicks on the detail link; otherwise open Edit like Sites rows.
    if (event.target.closest("a")) {
      return;
    }
    var row = event.target.closest("tr.system-row");
    if (!row) return;
    var rowId = row.getAttribute("data-system-id");
    Promise.resolve(loadSites())
      .catch(function () {})
      .then(function () {
        if (rowId && systemsById[rowId]) {
          openModal("edit", systemsById[rowId]);
        }
      });
  });

  tbody.addEventListener("keydown", function (event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    var row = event.target.closest("tr.system-row");
    if (!row) return;
    event.preventDefault();
    var systemId = row.getAttribute("data-system-id");
    Promise.resolve(loadSites())
      .catch(function () {})
      .then(function () {
        if (systemId && systemsById[systemId]) {
          openModal("edit", systemsById[systemId]);
        }
      });
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
  ]);
})();
