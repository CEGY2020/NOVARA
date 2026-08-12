(function () {
  var listEl = document.getElementById("owner-sites-list");
  var emptyEl = document.getElementById("owner-sites-empty");
  var statusEl = document.getElementById("owner-sites-status");
  var OWNER_EMPTY_MESSAGE = "No properties linked to your account yet";

  if (!listEl && !emptyEl) {
    return;
  }

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

  function isOwnerScoped() {
    if (window.NovaraAuth && typeof NovaraAuth.isOwnerUser === "function") {
      return NovaraAuth.isOwnerUser(currentUser());
    }
    var user = currentUser();
    if (!user) return false;
    var role = String(user.role || "").toLowerCase();
    if (role === "aem") return false;
    return role === "owner" || Boolean(user.ownerId);
  }

  function currentOwnerId() {
    if (window.NovaraAuth && typeof NovaraAuth.getOwnerId === "function") {
      return NovaraAuth.getOwnerId(currentUser()) || "";
    }
    var user = currentUser();
    return user ? String(user.ownerId || "").trim() : "";
  }

  function siteBelongsToOwner(site, ownerId) {
    if (!ownerId) return false;
    var id = String((site && (site.ownerId || site.owner)) || "").trim();
    return id === ownerId;
  }

  function filterSites(sites) {
    var list = Array.isArray(sites) ? sites.slice() : [];
    if (!isOwnerScoped()) {
      return list;
    }
    var ownerId = currentOwnerId();
    if (!ownerId) {
      return [];
    }
    return list.filter(function (site) {
      return siteBelongsToOwner(site, ownerId);
    });
  }

  function setStatus(message, isError) {
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.classList.toggle("is-error", Boolean(isError));
  }

  function showEmpty(visible) {
    if (emptyEl) {
      emptyEl.hidden = !visible;
      emptyEl.textContent = OWNER_EMPTY_MESSAGE;
    }
    if (listEl) {
      listEl.hidden = Boolean(visible);
    }
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
        var href =
          "sites.html";
        var location = site.location || "—";
        var status = site.status || "—";
        return (
          '<li class="owner-site-item">' +
          '<a href="' +
          escapeHtml(href) +
          '">' +
          "<strong>" +
          escapeHtml(site.name || site.siteName || site.siteId || "Site") +
          "</strong>" +
          "<span>" +
          escapeHtml(location) +
          " · " +
          escapeHtml(status) +
          "</span>" +
          "</a>" +
          "</li>"
        );
      })
      .join("");
  }

  function ensureOwnerContext() {
    var user = currentUser();
    if (!isOwnerScoped() || currentOwnerId()) {
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

  function loadSites() {
    setStatus("Loading your properties…", false);
    var api = window.NovaraApi;
    if (!api || typeof api.getSites !== "function") {
      showEmpty(true);
      setStatus("API client is unavailable.", true);
      return Promise.resolve();
    }
    return api
      .getSites()
      .then(function (data) {
        var sites = filterSites((data && data.sites) || []);
        renderSites(sites);
        if (!sites.length) {
          setStatus(OWNER_EMPTY_MESSAGE, false);
        } else {
          setStatus(
            sites.length + " propert" + (sites.length === 1 ? "y" : "ies"),
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

  ensureOwnerContext().then(loadSites);
})();
