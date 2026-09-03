(function () {
  var listEl = document.getElementById("mgmt-sites-list");
  var emptyEl = document.getElementById("mgmt-sites-empty");
  var statusEl = document.getElementById("mgmt-sites-status");
  var titleEl = document.getElementById("mgmt-home-title");
  var subtitleEl = document.getElementById("mgmt-home-subtitle");

  var EMPTY_MESSAGE =
    "No properties linked to this management company yet. Ask AEM to set MgmtCompany on each site and MgmtCompanyID on your user.";

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function currentUser() {
    return (
      (window.NovaraAuth &&
        NovaraAuth.getCurrentUser &&
        NovaraAuth.getCurrentUser()) ||
      null
    );
  }

  function isMgmtScoped() {
    if (window.NovaraAuth && typeof NovaraAuth.isMgmtUser === "function") {
      return NovaraAuth.isMgmtUser(currentUser());
    }
    var user = currentUser();
    if (!user) return false;
    var role = String(user.role || "").toLowerCase();
    if (role === "aem") return false;
    return role === "mgmt" || Boolean(user.mgmtCompanyId);
  }

  function currentMgmtId() {
    if (window.NovaraAuth && typeof NovaraAuth.getMgmtCompanyId === "function") {
      return NovaraAuth.getMgmtCompanyId(currentUser()) || "";
    }
    var user = currentUser();
    return user ? String(user.mgmtCompanyId || "").trim() : "";
  }

  function normalizeId(value) {
    return String(value == null ? "" : value)
      .trim()
      .toLowerCase();
  }

  function siteMgmtId(site) {
    if (!site) return "";
    return String(
      site.mgmtCompanyId ||
        site.mgmtCompany ||
        site.MgmtCompanyID ||
        site.MgmtCompany ||
        ""
    ).trim();
  }

  function siteName(site) {
    return site.name || site.siteName || site.SiteName || site.siteId || site.SiteID || "Site";
  }

  function siteLocation(site) {
    if (site.location) return site.location;
    var parts = [site.city || site.City, site.state || site.State].filter(Boolean);
    return parts.length ? parts.join(", ") : "—";
  }

  function siteStatus(site) {
    return site.status || site.Status || "—";
  }

  function statusClass(status) {
    var s = String(status || "").toLowerCase();
    if (s.indexOf("offline") >= 0) return "is-offline";
    if (s.indexOf("review") >= 0 || s.indexOf("maintenance") >= 0) return "is-review";
    return "";
  }

  function setStatus(message, isError) {
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.classList.toggle("is-error", Boolean(isError));
  }

  function showEmpty(visible) {
    if (emptyEl) {
      emptyEl.hidden = !visible;
      emptyEl.textContent = EMPTY_MESSAGE;
    }
    if (listEl) {
      listEl.hidden = Boolean(visible);
    }
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function companyLookup(companies, user) {
    var id = currentMgmtId();
    var name = user && user.company ? String(user.company).trim() : "";
    var list = Array.isArray(companies) ? companies : [];
    var match = null;
    if (id) {
      match = list.filter(function (c) {
        var cid = String(c.mgmtCompanyId || c.MgmtCompanyID || "").trim();
        return cid === id;
      })[0];
    }
    if (!match && name) {
      var needle = name.toLowerCase();
      match = list.filter(function (c) {
        return String(c.name || c.Name || "").trim().toLowerCase() === needle;
      })[0];
    }
    return match || null;
  }

  function filterSites(sites, companies, user) {
    var list = Array.isArray(sites) ? sites.slice() : [];
    if (!isMgmtScoped()) {
      return list;
    }
    var mgmtId = currentMgmtId();
    var company = companyLookup(companies, user);
    if (company && company.mgmtCompanyId && !mgmtId) {
      mgmtId = String(company.mgmtCompanyId || company.MgmtCompanyID || "").trim();
      if (window.NovaraAuth && NovaraAuth.updateCurrentUser) {
        NovaraAuth.updateCurrentUser({ mgmtCompanyId: mgmtId });
      }
    }
    var companyName = "";
    if (company) {
      companyName = String(company.name || company.Name || "").trim();
    } else if (user && user.company) {
      companyName = String(user.company).trim();
    }

    if (!mgmtId && !companyName) {
      return [];
    }

    return list.filter(function (site) {
      var sid = siteMgmtId(site);
      if (mgmtId && sid && normalizeId(sid) === normalizeId(mgmtId)) {
        return true;
      }
      if (companyName) {
        var siteCompanyName = String(
          site.mgmtCompanyName || site.MgmtCompanyName || sid || ""
        ).trim();
        if (normalizeId(siteCompanyName) === normalizeId(companyName)) {
          return true;
        }
      }
      return false;
    });
  }

  function renderSites(sites) {
    if (!listEl) {
      showEmpty(!sites.length);
      return;
    }
    if (!sites.length) {
      listEl.innerHTML = "";
      showEmpty(true);
      return;
    }
    showEmpty(false);
    listEl.innerHTML = sites
      .map(function (site) {
        var id = site.siteId || site.SiteID || "";
        var href = id
          ? "sites.html?siteId=" + encodeURIComponent(id)
          : "sites.html";
        var status = siteStatus(site);
        var systems = site.systems || site.Systems || 0;
        return (
          '<li class="mgmt-site-item owner-site-item">' +
          '<a href="' +
          escapeHtml(href) +
          '">' +
          "<div><strong>" +
          escapeHtml(siteName(site)) +
          "</strong><span> " +
          escapeHtml(siteLocation(site)) +
          " · " +
          escapeHtml(String(systems)) +
          " system" +
          (Number(systems) === 1 ? "" : "s") +
          "</span></div>" +
          '<span class="status-pill ' +
          statusClass(status) +
          '">' +
          escapeHtml(status) +
          "</span>" +
          "</a>" +
          "</li>"
        );
      })
      .join("");
  }

  function renderKpis(sites) {
    var online = 0;
    var attention = 0;
    var systems = 0;
    sites.forEach(function (site) {
      var status = String(siteStatus(site)).toLowerCase();
      systems += Number(site.systems || site.Systems || 0) || 0;
      if (status.indexOf("offline") >= 0 || status.indexOf("review") >= 0 || status.indexOf("maintenance") >= 0) {
        attention += 1;
      } else {
        online += 1;
      }
    });
    setText("kpi-sites", String(sites.length));
    setText("kpi-systems", String(systems));
    setText("kpi-attention", String(attention));
    setText("kpi-online", String(online));
  }

  function applyCompanyHeading(company, user) {
    var name =
      (company && (company.name || company.Name)) ||
      (user && user.company) ||
      "";
    if (titleEl && name) {
      titleEl.textContent = name;
    }
    if (subtitleEl) {
      subtitleEl.textContent = name
        ? "Portfolio your company operates in NOVARA"
        : "Sites your company operates — status, systems, and savings";
    }
  }

  function ensureMgmtContext() {
    var user = currentUser();
    if (!isMgmtScoped() || currentMgmtId()) {
      return Promise.resolve(user);
    }
    if (!window.NovaraApi || typeof NovaraApi.getSession !== "function") {
      return Promise.resolve(user);
    }
    return NovaraApi.getSession()
      .then(function (result) {
        var next = result && result.user;
        if (next && window.NovaraAuth && NovaraAuth.updateCurrentUser) {
          NovaraAuth.updateCurrentUser(next);
        }
        return currentUser();
      })
      .catch(function () {
        return user;
      });
  }

  function loadCompanies() {
    var api = window.NovaraApi;
    if (!api || typeof api.getMgmtCompanies !== "function") {
      return Promise.resolve([]);
    }
    return api.getMgmtCompanies().then(function (data) {
      return (data && (data.companies || data.mgmtCompanies || data.items)) || [];
    }).catch(function () {
      return [];
    });
  }

  function loadSites() {
    setStatus("Loading managed properties…", false);
    var api = window.NovaraApi;
    if (!api || typeof api.getSites !== "function") {
      showEmpty(true);
      setStatus("API client is unavailable.", true);
      return Promise.resolve();
    }

    var user = currentUser();
    return Promise.all([api.getSites(), loadCompanies()])
      .then(function (results) {
        var sitePayload = results[0] || {};
        var companies = results[1] || [];
        var company = companyLookup(companies, user);
        applyCompanyHeading(company, user);
        var sites = filterSites(sitePayload.sites || [], companies, user);
        renderSites(sites);
        renderKpis(sites);
        if (!sites.length) {
          setStatus(EMPTY_MESSAGE, false);
        } else {
          setStatus(
            sites.length + " managed propert" + (sites.length === 1 ? "y" : "ies"),
            false
          );
        }
      })
      .catch(function (err) {
        showEmpty(true);
        if (emptyEl) {
          emptyEl.textContent = "Unable to load properties.";
        }
        setStatus(err.message || "Failed to load sites", true);
      });
  }

  ensureMgmtContext().then(loadSites);
})();
