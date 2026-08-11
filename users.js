(function () {
  var statusEl = document.getElementById("users-status");
  var pendingBody = document.getElementById("pending-users-tbody");
  var allBody = document.getElementById("all-users-tbody");
  var refreshBtn = document.getElementById("refresh-users-btn");

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
    // Keep YYYY-MM-DD HH:MM from ISO timestamps.
    return text.replace("T", " ").replace("Z", " UTC").slice(0, 19);
  }

  function statusBadge(status) {
    var normalized = String(status || "Pending");
    var cls = "status-badge status-" + normalized.toLowerCase();
    return '<span class="' + cls + '">' + escapeHtml(normalized) + "</span>";
  }

  function ensureAemAccess() {
    var role =
      (window.NovaraAuth &&
        NovaraAuth.getCurrentUser &&
        (NovaraAuth.getCurrentUser() || {}).role) ||
      (window.NovaraRole && NovaraRole.getSelectedRole && NovaraRole.getSelectedRole()) ||
      document.body.getAttribute("data-role") ||
      "";
    if (String(role).toLowerCase() !== "aem") {
      setStatus("Users admin is available to AEM accounts only.", true);
      if (pendingBody) {
        pendingBody.innerHTML =
          '<tr><td colspan="6">AEM access required.</td></tr>';
      }
      if (allBody) {
        allBody.innerHTML =
          '<tr><td colspan="6">AEM access required.</td></tr>';
      }
      return false;
    }
    return true;
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
      allBody.innerHTML = '<tr><td colspan="6">No users found.</td></tr>';
      return;
    }
    allBody.innerHTML = users
      .map(function (user) {
        return (
          "<tr>" +
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
          "</tr>"
        );
      })
      .join("");
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
        renderPending(users);
        renderAll(users);
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
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Failed to load users.", true);
        if (pendingBody) {
          pendingBody.innerHTML =
            '<tr><td colspan="6">Failed to load users.</td></tr>';
        }
        if (allBody) {
          allBody.innerHTML =
            '<tr><td colspan="6">Failed to load users.</td></tr>';
        }
      });
  }

  function updateStatus(userId, status) {
    if (!window.NovaraApi || typeof NovaraApi.updateUserStatus !== "function") {
      setStatus("API client is unavailable.", true);
      return;
    }
    setStatus(
      (status === "Active" ? "Approving" : "Rejecting") + " " + userId + "…"
    );
    NovaraApi.updateUserStatus(userId, status)
      .then(function () {
        loadUsers();
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Failed to update user.", true);
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
        updateStatus(userId, "Rejected");
      }
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener("click", loadUsers);
  }

  loadUsers();
})();
