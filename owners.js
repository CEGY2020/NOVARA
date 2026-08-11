(function () {
  var statusEl = document.getElementById("owners-status");
  var tbody = document.getElementById("owners-tbody");
  var addBtn = document.getElementById("add-owner-btn");
  var modal = document.getElementById("owner-modal");
  var form = document.getElementById("owner-form");
  var modeInput = document.getElementById("owner-mode");
  var modalTitle = document.getElementById("owner-modal-title");
  var modalSubtitle = document.getElementById("owner-modal-subtitle");
  var formError = document.getElementById("owner-form-error");
  var saveBtn = document.getElementById("owner-save-btn");
  var closeBtn = document.getElementById("owner-modal-close");
  var cancelBtn = document.getElementById("owner-cancel-btn");
  var ownerIdInput = document.getElementById("field-ownerId");

  var ownersById = {};
  /** Authoritative create|edit mode. Do not rely only on #owner-mode — form.reset() restores its default. */
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

  function formatLocation(owner) {
    var city = owner.city || "";
    var state = owner.state || "";
    if (city && state) {
      return city + ", " + state;
    }
    return city || state || owner.location || "—";
  }

  function collectPayload() {
    return {
      OwnerID: fieldValue("field-ownerId"),
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

  /** Next sequential OwnerID from NOVARAOwners rows matching OWN###. */
  function nextOwnerId() {
    var maxNum = 0;
    var pattern = /^OWN(\d+)$/i;
    Object.keys(ownersById).forEach(function (id) {
      var match = pattern.exec(String(id || "").trim());
      if (!match) return;
      var num = parseInt(match[1], 10);
      if (Number.isFinite(num) && num > maxNum) {
        maxNum = num;
      }
    });
    var next = maxNum + 1;
    var width = Math.max(3, String(next).length);
    return "OWN" + String(next).padStart(width, "0");
  }

  function setOwnerIdHint(mode) {
    var hint = document.getElementById("owner-id-hint");
    if (!hint) return;
    if (mode === "edit") {
      hint.textContent = "OwnerID cannot be changed";
    } else {
      hint.textContent = "Auto-generated sequentially (OWN001…)";
    }
  }

  function openModal(mode, owner) {
    if (!modal || !form) return;
    mode = mode === "edit" ? "edit" : "create";
    setFormError("");
    form.reset();

    // Must set mode AFTER reset — #owner-mode defaults to "create" in the HTML.
    currentMode = mode;
    if (modeInput) {
      modeInput.value = mode;
    }

    if (ownerIdInput) {
      ownerIdInput.readOnly = true;
    }
    setOwnerIdHint(mode);

    if (mode === "edit" && owner) {
      modalTitle.textContent = "Edit Owner";
      modalSubtitle.textContent =
        "Update " + (owner.ownerId || "owner") + " in NOVARAOwners";
      setFieldValue("field-ownerId", owner.ownerId);
      setFieldValue("field-name", owner.name || owner.ownerName);
      setFieldValue("field-address", owner.address || "");
      setFieldValue("field-city", owner.city || "");
      setFieldValue("field-state", owner.state || "");
      setFieldValue("field-zip", owner.zip || "");
      setFieldValue("field-contactName", owner.contactName || "");
      setFieldValue("field-contactEmail", owner.contactEmail || "");
      setFieldValue(
        "field-contactPhone",
        formatPhoneValue(owner.contactPhone || "")
      );
      setFieldValue("field-notes", owner.notes || "");
    } else {
      modalTitle.textContent = "Add Owner";
      modalSubtitle.textContent = "Create a new owner in NOVARAOwners";
      setFieldValue("field-ownerId", nextOwnerId());
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

  function renderOwners(owners) {
    ownersById = {};
    if (!owners.length) {
      tbody.innerHTML =
        '<tr><td colspan="6">No owners found in NOVARAOwners.</td></tr>';
      return;
    }

    tbody.innerHTML = owners
      .map(function (owner) {
        ownersById[owner.ownerId] = owner;
        var contact =
          owner.contactName || owner.contactEmail || "—";
        return (
          '<tr class="owner-row" data-owner-id="' +
          escapeHtml(owner.ownerId) +
          '" tabindex="0">' +
          "<td>" +
          escapeHtml(owner.ownerId) +
          "</td>" +
          "<td>" +
          escapeHtml(owner.name || owner.ownerName) +
          "</td>" +
          "<td>" +
          escapeHtml(formatLocation(owner)) +
          "</td>" +
          "<td>" +
          escapeHtml(contact) +
          "</td>" +
          "<td>" +
          escapeHtml(formatPhoneValue(owner.contactPhone) || "—") +
          "</td>" +
          "<td>" +
          '<button type="button" class="link-btn edit-owner-btn" data-owner-id="' +
          escapeHtml(owner.ownerId) +
          '">Edit</button>' +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function loadOwners() {
    setStatus("Loading owners…", false);
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

    return request
      .then(function (data) {
        var owners = (data && data.owners) || [];
        renderOwners(owners);
        if (!owners.length) {
          setStatus("No owners found in NOVARAOwners.", false);
        } else {
          setStatus(
            owners.length + " owner" + (owners.length === 1 ? "" : "s"),
            false
          );
        }
      })
      .catch(function (err) {
        tbody.innerHTML =
          '<tr><td colspan="6">Unable to load owners.</td></tr>';
        setStatus(err.message || "Failed to load owners", true);
      });
  }

  function saveOwner(event) {
    event.preventDefault();
    setFormError("");

    var payload = collectPayload();
    if (!payload.OwnerID) {
      setFormError("OwnerID is required.");
      if (ownerIdInput) ownerIdInput.focus();
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
          ? api.updateOwner(payloadToSave)
          : api.createOwner(payloadToSave);

      return request
        .then(function () {
          closeModal();
          return loadOwners();
        })
        .catch(function (err) {
          var message = err.message || "Failed to save owner";
          var isDuplicate =
            mode === "create" &&
            /already exists/i.test(message) &&
            allowRetry;

          if (isDuplicate) {
            return Promise.resolve(loadOwners())
              .catch(function () {})
              .then(function () {
                var regenerated = nextOwnerId();
                setFieldValue("field-ownerId", regenerated);
                payloadToSave.OwnerID = regenerated;
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
      Promise.resolve(loadOwners())
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
    form.addEventListener("submit", saveOwner);
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
    var editBtn = event.target.closest(".edit-owner-btn");
    if (editBtn) {
      event.stopPropagation();
      var editId = editBtn.getAttribute("data-owner-id");
      if (editId && ownersById[editId]) {
        openModal("edit", ownersById[editId]);
      }
    }
  });

  tbody.addEventListener("keydown", function (event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    var row = event.target.closest("tr.owner-row");
    if (!row) return;
    event.preventDefault();
    var ownerId = row.getAttribute("data-owner-id");
    if (ownerId && ownersById[ownerId]) {
      openModal("edit", ownersById[ownerId]);
    }
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && modal && !modal.hidden) {
      closeModal();
    }
  });

  loadOwners();
})();
