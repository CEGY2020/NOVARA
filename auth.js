/**
 * Lightweight session helper for NOVARAUsers sign-in.
 * Stores the authenticated user in sessionStorage (no JWT yet).
 */
(function (global) {
  var USER_KEY = "novaraUser";

  function normalizeUser(user) {
    if (!user || typeof user !== "object") {
      return null;
    }
    var role = user.role || user.Role || "";
    if (global.NovaraRole && NovaraRole.normalizeRole) {
      role = NovaraRole.normalizeRole(role) || "";
    } else {
      role = String(role || "")
        .toLowerCase()
        .trim();
    }
    return {
      userId: String(user.userId || user.UserID || ""),
      fullName: String(user.fullName || user.FullName || user.name || ""),
      email: String(user.email || user.Email || "")
        .toLowerCase()
        .trim(),
      role: role,
      company: String(user.company || user.Company || ""),
      status: String(user.status || user.Status || ""),
    };
  }

  function getCurrentUser() {
    try {
      var raw = sessionStorage.getItem(USER_KEY);
      if (!raw) {
        return null;
      }
      return normalizeUser(JSON.parse(raw));
    } catch (e) {
      return null;
    }
  }

  function setCurrentUser(user) {
    var normalized = normalizeUser(user);
    if (!normalized || !normalized.userId) {
      return null;
    }
    try {
      sessionStorage.setItem(USER_KEY, JSON.stringify(normalized));
    } catch (e) {
      // Ignore storage failures.
    }
    if (normalized.role && global.NovaraRole && NovaraRole.setSelectedRole) {
      NovaraRole.setSelectedRole(normalized.role);
    }
    return normalized;
  }

  function clearCurrentUser() {
    try {
      sessionStorage.removeItem(USER_KEY);
    } catch (e) {
      // no-op
    }
  }

  function initialsFor(user) {
    var name = (user && user.fullName) || "";
    var parts = name.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) {
      var email = (user && user.email) || "";
      return email ? email.charAt(0).toUpperCase() : "?";
    }
    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  function logout(redirectTo) {
    clearCurrentUser();
    if (global.NovaraRole && NovaraRole.clearSelectedRole) {
      NovaraRole.clearSelectedRole();
    }
    window.location.href = redirectTo || "directory.html";
  }

  global.NovaraAuth = {
    USER_KEY: USER_KEY,
    getCurrentUser: getCurrentUser,
    setCurrentUser: setCurrentUser,
    clearCurrentUser: clearCurrentUser,
    initialsFor: initialsFor,
    logout: logout,
  };
})(window);
