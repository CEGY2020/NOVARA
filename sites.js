(function () {
  var statusEl = document.getElementById("sites-status");
  var tbody = document.getElementById("sites-tbody");

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

  function renderSites(sites) {
    if (!sites.length) {
      tbody.innerHTML =
        '<tr><td colspan="4">No sites found in NOVARASites.</td></tr>';
      return;
    }

    tbody.innerHTML = sites
      .map(function (site) {
        var cls = statusClass(site.status);
        var statusHtml = cls
          ? '<td class="' + cls + '">' + escapeHtml(site.status) + "</td>"
          : "<td>" + escapeHtml(site.status) + "</td>";
        return (
          "<tr>" +
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
          "</tr>"
        );
      })
      .join("");
  }

  function loadSites() {
    setStatus("Loading sites…", false);
    return fetch("/api/sites")
      .then(function (response) {
        return response.json().then(function (body) {
          if (!response.ok) {
            var detail = body && (body.detail || body.error);
            throw new Error(detail || "Request failed (" + response.status + ")");
          }
          return body;
        });
      })
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
          '<tr><td colspan="4">Unable to load sites.</td></tr>';
        setStatus(err.message || "Failed to load sites", true);
      });
  }

  loadSites();
})();
