/**
 * Selected portal role (AEM, Owner, Contractor, Sales).
 * Stored in sessionStorage and used for post-login routing.
 */
(function (global) {
  var STORAGE_KEY = "novaraRole";

  var VALID_ROLES = ["aem", "owner", "contractor", "sales"];

  var ROLE_LABELS = {
    aem: "AEM",
    owner: "Owner",
    contractor: "Contractor",
    sales: "Sales"
  };

  var HOME_BY_ROLE = {
    aem: "dashboard.html",
    owner: "owner-home.html",
    contractor: "contractor-home.html",
    sales: "sales-home.html"
  };

  function normalizeRole(role) {
    if (!role) {
      return null;
    }
    role = String(role).toLowerCase().trim();
    return VALID_ROLES.indexOf(role) >= 0 ? role : null;
  }

  function getSelectedRole() {
    try {
      return normalizeRole(sessionStorage.getItem(STORAGE_KEY));
    } catch (e) {
      return null;
    }
  }

  function setSelectedRole(role) {
    var normalized = normalizeRole(role);
    if (!normalized) {
      return null;
    }
    try {
      sessionStorage.setItem(STORAGE_KEY, normalized);
    } catch (e) {
      // Ignore storage failures; query param still carries role into login.
    }
    return normalized;
  }

  function clearSelectedRole() {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      // no-op
    }
  }

  function getRoleFromQuery() {
    try {
      var params = new URLSearchParams(window.location.search);
      return normalizeRole(params.get("role"));
    } catch (e) {
      return null;
    }
  }

  /** Prefer ?role= from the URL, then fall back to stored role. */
  function captureRoleFromQuery() {
    var fromQuery = getRoleFromQuery();
    if (fromQuery) {
      return setSelectedRole(fromQuery);
    }
    return getSelectedRole();
  }

  function getHomeForRole(role) {
    var normalized = normalizeRole(role) || "aem";
    return HOME_BY_ROLE[normalized] || HOME_BY_ROLE.aem;
  }

  function getRoleLabel(role) {
    var normalized = normalizeRole(role);
    return normalized ? ROLE_LABELS[normalized] : "";
  }

  global.NovaraRole = {
    STORAGE_KEY: STORAGE_KEY,
    VALID_ROLES: VALID_ROLES,
    ROLE_LABELS: ROLE_LABELS,
    HOME_BY_ROLE: HOME_BY_ROLE,
    normalizeRole: normalizeRole,
    getSelectedRole: getSelectedRole,
    setSelectedRole: setSelectedRole,
    clearSelectedRole: clearSelectedRole,
    getRoleFromQuery: getRoleFromQuery,
    captureRoleFromQuery: captureRoleFromQuery,
    getHomeForRole: getHomeForRole,
    getRoleLabel: getRoleLabel
  };
})(window);
