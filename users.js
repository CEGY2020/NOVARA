(function () {
  var statusEl = document.getElementById("users-status");
  var pendingBody = document.getElementById("pending-users-tbody");
  var allBody = document.getElementById("all-users-tbody");
  var refreshBtn = document.getElementById("refresh-users-btn");
  var preapprovedList = document.getElementById("preapproved-list");
  var preapprovedForm = document.getElementById("preapproved-form");
  var preapprovedInput = document.getElementById("preapproved-email-input");
  var adminAlertEmailEl = document.getElementById("admin-alert-email");

  var rejectModal = document.getElementById("reject-modal");
  var rejectForm = document.getElementById("reject-form");
  var rejectUserId = document.getElementById("reject-user-id");
  var rejectUserLabel = document.getElementById("reject-user-label");
  var rejectReason = document.getElementById("reject-reason");
  var rejectSendEmail = document.getElementById("reject-send-email");
  var rejectFormError = document.getElementById("reject-form-error");
  var rejectCloseBtn = document.getElementById("reject-modal-close");
  var rejectCancelBtn = document.getElementById("reject-cancel-btn");

  var latestUsers = [];
  var deepLinkHandled = false;

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

  function roleLabel(role) {
    if (window.NovaraRole && NovaraRole.getRoleLabel) {
      return NovaraRole.getRoleLabel(role) || role || "—";
    }
    return role || "—";
  }

  function formatWhen(value) {
    if (!value) return "—";
    var text = String(value);
    return text.replace("T", " ").replace("Z", " UTC").slice(0, 19);
  }

  function statusBadge(status) {
    var normalized = String(status || "Pending");
    var cls = "status-badge status-" + normalized.toLowerCase();
    return '<span class="' + cls + '">' + escapeHtml(normalized) + "</span>";
  }

  function queryParam(name) {
    try {
      return new URLSearchParams(window.location.search).get(name);
    } catch (e) {
      return null;
    }
  }

  // TEMPORARY: allow Users admin without an approved AEM session so the
  // first accounts can be approved. Set to false after bootstrap to
  // re-lock this page to AEM-only.
  var ALLOW_USERS_ADMIN_BOOTSTRAP = true;

  function ensureAemAccess() {
    var loggedIn =
      (window.NovaraAuth &&
        NovaraAuth.getCurrentUser &&
        NovaraAuth.getCurrentUser()) ||
      null;
    var role =
      (loggedIn && loggedIn.role) ||
      (window.NovaraRole &&
        NovaraRole.getSelectedRole &&
        NovaraRole.getSelectedRole()) ||
      document.body.getAttribute("data-role") ||
      "";

    if (String(role).toLowerCase() === "aem") {
      return true;
    }

    // Bootstrap: no Active session yet — ignore directory role selection
    // so /users.html remains usable for first-account approval.
    if (ALLOW_USERS_ADMIN_BOOTSTRAP && !loggedIn) {
      return true;
    }

    setStatus("Users admin is available to AEM accounts only.", true);
    if (pendingBody) {
      pendingBody.innerHTML =
        '<tr><td colspan="6">AEM access required.</td></tr>';
    }
    if (allBody) {
      allBody.innerHTML =
        '<tr><td colspan="7">AEM access required.</td></tr>';
    }
    if (preapprovedList) {
      preapprovedList.innerHTML = "<li>AEM access required.</li>";
    }
    return false;
  }

  function renderPending(users) {
    if (!pendingBody) return;
    var pending = (users || []).filter(function (row) {
      return String(row.status || "") === "Pending";
    });
    if (!pending.length) {
      pendingBody.innerHTML =
        '<tr><td colspan="6">No pending users right now.</td></tr>';
      return;
    }
    pendingBody.innerHTML = pending
      .map(function (user) {
        var id = escapeHtml(user.userId);
        return (
          "<tr data-user-id=\"" +
          id +
          "\">" +
          "<td>" +
          escapeHtml(user.fullName || "—") +
          "</td>" +
          "<td>" +
          escapeHtml(user.email || "—") +
          "</td>" +
          "<td>" +
          escapeHtml(roleLabel(user.role)) +
          "</td>" +
          "<td>" +
          escapeHtml(user.company || "—") +
          "</td>" +
          "<td>" +
          escapeHtml(formatWhen(user.createdAt)) +
          "</td>" +
          "<td class=\"users-actions\">" +
          '<button type="button" class="primary-btn user-approve-btn" data-user-id="' +
          id +
          '">Approve</button> ' +
          '<button type="button" class="secondary-btn user-reject-btn" data-user-id="' +
          id +
          '">Reject</button>' +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function renderAll(users) {
    if (!allBody) return;
    if (!users || !users.length) {
      allBody.innerHTML = '<tr><td colspan="7">No users found.</td></tr>';
      return;
    }
    allBody.innerHTML = users
      .map(function (user) {
        var note = "—";
        if (String(user.status || "") === "Rejected" && user.rejectionReason) {
          note = user.rejectionReason;
        }
        return (
          "<tr data-user-id=\"" +
          escapeHtml(user.userId || "") +
          "\">" +
          "<td>" +
          escapeHtml(user.userId || "—") +
          "</td>" +
          "<td>" +
          escapeHtml(user.fullName || "—") +
          "</td>" +
          "<td>" +
          escapeHtml(user.email || "—") +
          "</td>" +
          "<td>" +
          escapeHtml(roleLabel(user.role)) +
          "</td>" +
          "<td>" +
          escapeHtml(user.company || "—") +
          "</td>" +
          "<td>" +
          statusBadge(user.status) +
          "</td>" +
          "<td class=\"users-notes\">" +
          escapeHtml(note) +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function renderPreapproved(emails) {
    if (!preapprovedList) return;
    var list = emails || [];
    if (!list.length) {
      preapprovedList.innerHTML =
        "<li class=\"preapproved-empty\">No pre-approved emails yet.</li>";
      return;
    }
    preapprovedList.innerHTML = list
      .map(function (email) {
        var safe = escapeHtml(email);
        return (
          '<li class="preapproved-item">' +
          "<span>" +
          safe +
          "</span>" +
          '<button type="button" class="link-btn danger-link-btn preapproved-remove-btn" data-email="' +
          safe +
          '">Remove</button>' +
          "</li>"
        );
      })
      .join("");
  }

  function openRejectModal(user) {
    if (!rejectModal || !user) return;
    if (rejectUserId) rejectUserId.value = user.userId || "";
    if (rejectUserLabel) {
      rejectUserLabel.value =
        (user.fullName || "Applicant") +
        " · " +
        (user.email || "") +
        " · " +
        roleLabel(user.role);
    }
    if (rejectReason) rejectReason.value = "";
    if (rejectSendEmail) rejectSendEmail.checked = true;
    if (rejectFormError) {
      rejectFormError.hidden = true;
      rejectFormError.textContent = "";
    }
    rejectModal.hidden = false;
    document.body.classList.add("modal-open");
    if (rejectReason) rejectReason.focus();
  }

  function closeRejectModal() {
    if (!rejectModal) return;
    rejectModal.hidden = true;
    document.body.classList.remove("modal-open");
  }

  function findUser(userId) {
    return (latestUsers || []).find(function (row) {
      return String(row.userId || "") === String(userId || "");
    });
  }

  function loadUsers() {
    if (!ensureAemAccess()) {
      return;
    }
    if (!window.NovaraApi || typeof NovaraApi.getUsers !== "function") {
      setStatus("API client is unavailable.", true);
      return;
    }
    setStatus("Loading users…");
    NovaraApi.getUsers()
      .then(function (payload) {
        var users = (payload && payload.users) || [];
        latestUsers = users;
        renderPending(users);
        renderAll(users);
        renderPreapproved((payload && payload.preapprovedEmails) || []);
        if (adminAlertEmailEl && payload && payload.adminAlertEmail) {
          adminAlertEmailEl.textContent = payload.adminAlertEmail;
        }
        var pendingCount = users.filter(function (row) {
          return String(row.status || "") === "Pending";
        }).length;
        setStatus(
          "Loaded " +
            users.length +
            " user" +
            (users.length === 1 ? "" : "s") +
            " (" +
            pendingCount +
            " pending)."
        );
        maybeHandleDeepLink();
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Failed to load users.", true);
        if (pendingBody) {
          pendingBody.innerHTML =
            '<tr><td colspan="6">Failed to load users.</td></tr>';
        }
        if (allBody) {
          allBody.innerHTML =
            '<tr><td colspan="7">Failed to load users.</td></tr>';
        }
      });
  }

  function clearDeepLinkParams() {
    try {
      var url = new URL(window.location.href);
      ["approve", "reject", "focus"].forEach(function (key) {
        url.searchParams.delete(key);
      });
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    } catch (e) {
      // Ignore history API failures.
    }
  }

  function maybeHandleDeepLink() {
    if (deepLinkHandled) return;
    var approveId = queryParam("approve");
    var rejectId = queryParam("reject");
    var focusId = queryParam("focus") || approveId || rejectId;
    if (!focusId) return;
    deepLinkHandled = true;
    var row = document.querySelector('tr[data-user-id="' + focusId + '"]');
    if (row && row.scrollIntoView) {
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      row.classList.add("users-row-focus");
    }
    if (approveId) {
      clearDeepLinkParams();
      updateStatus(approveId, "Active");
      return;
    }
    if (rejectId) {
      clearDeepLinkParams();
      openRejectModal(findUser(rejectId) || { userId: rejectId });
      return;
    }
    clearDeepLinkParams();
  }

  function updateStatus(userId, status, options) {
    if (!window.NovaraApi || typeof NovaraApi.updateUserStatus !== "function") {
      setStatus("API client is unavailable.", true);
      return Promise.reject(new Error("API client is unavailable."));
    }
    setStatus(
      (status === "Active" ? "Approving" : "Rejecting") + " " + userId + "…"
    );
    return NovaraApi.updateUserStatus(userId, status, options || {})
      .then(function () {
        closeRejectModal();
        loadUsers();
      })
      .catch(function (err) {
        var message = (err && err.message) || "Failed to update user.";
        setStatus(message, true);
        if (rejectFormError && status === "Rejected") {
          rejectFormError.hidden = false;
          rejectFormError.textContent = message;
        }
        throw err;
      });
  }

  if (pendingBody) {
    pendingBody.addEventListener("click", function (event) {
      var target = event.target;
      if (!target || !target.getAttribute) return;
      var userId = target.getAttribute("data-user-id");
      if (!userId) return;
      if (target.classList.contains("user-approve-btn")) {
        updateStatus(userId, "Active");
      } else if (target.classList.contains("user-reject-btn")) {
        openRejectModal(findUser(userId) || { userId: userId });
      }
    });
  }

  if (preapprovedList) {
    preapprovedList.addEventListener("click", function (event) {
      var target = event.target;
      if (!target || !target.classList.contains("preapproved-remove-btn")) {
        return;
      }
      var email = target.getAttribute("data-email");
      if (!email || !window.NovaraApi) return;
      if (!window.confirm("Remove " + email + " from the pre-approved list?")) {
        return;
      }
      setStatus("Removing " + email + "…");
      NovaraApi.removePreapprovedEmail(email)
        .then(function (payload) {
          renderPreapproved((payload && payload.preapprovedEmails) || []);
          setStatus("Removed " + email + " from pre-approved list.");
        })
        .catch(function (err) {
          setStatus((err && err.message) || "Failed to remove email.", true);
        });
    });
  }

  if (preapprovedForm) {
    preapprovedForm.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!window.NovaraApi) return;
      var email = String((preapprovedInput && preapprovedInput.value) || "")
        .trim()
        .toLowerCase();
      if (!email || email.indexOf("@") === -1) {
        setStatus("Enter a valid email to pre-approve.", true);
        return;
      }
      setStatus("Adding " + email + "…");
      NovaraApi.addPreapprovedEmail(email)
        .then(function (payload) {
          renderPreapproved((payload && payload.preapprovedEmails) || []);
          if (preapprovedInput) preapprovedInput.value = "";
          setStatus("Added " + email + " to pre-approved list.");
        })
        .catch(function (err) {
          setStatus((err && err.message) || "Failed to add email.", true);
        });
    });
  }

  if (rejectForm) {
    rejectForm.addEventListener("submit", function (event) {
      event.preventDefault();
      var userId = rejectUserId ? rejectUserId.value : "";
      var reason = rejectReason ? String(rejectReason.value || "").trim() : "";
      if (!userId) return;
      if (!reason) {
        if (rejectFormError) {
          rejectFormError.hidden = false;
          rejectFormError.textContent = "A rejection reason is required.";
        }
        return;
      }
      updateStatus(userId, "Rejected", {
        rejectionReason: reason,
        sendRejectionEmail: !!(rejectSendEmail && rejectSendEmail.checked),
      });
    });
  }

  function onRejectDismiss() {
    closeRejectModal();
  }
  if (rejectCloseBtn) rejectCloseBtn.addEventListener("click", onRejectDismiss);
  if (rejectCancelBtn) rejectCancelBtn.addEventListener("click", onRejectDismiss);
  if (rejectModal) {
    rejectModal.addEventListener("click", function (event) {
      if (event.target === rejectModal) closeRejectModal();
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener("click", loadUsers);
  }

  loadUsers();
})();
