/**
 * Session helper for NOVARAUsers sign-in.
 * Stores the authenticated user + bearer token in sessionStorage, or
 * localStorage when "Remember me" is checked.
 */
(function (global) {
  var USER_KEY = "novaraUser";
  var TOKEN_KEY = "novaraToken";
  var EXPIRES_KEY = "novaraTokenExpires";

  function storageFor(remember) {
    return remember ? global.localStorage : global.sessionStorage;
  }

  function readJSON(store, key) {
    try {
      var raw = store.getItem(key);
      if (!raw) {
        return null;
      }
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

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
      ownerId: String(user.ownerId || user.OwnerID || "").trim(),
      status: String(user.status || user.Status || ""),
    };
  }

  function clearStore(store) {
    try {
      store.removeItem(USER_KEY);
      store.removeItem(TOKEN_KEY);
      store.removeItem(EXPIRES_KEY);
    } catch (e) {
      // no-op
    }
  }

  function isExpired(expiresAt) {
    if (!expiresAt) {
      return false;
    }
    var ms = Date.parse(expiresAt);
    if (Number.isNaN(ms)) {
      return false;
    }
    return Date.now() >= ms;
  }

  function readSession() {
    var stores = [global.sessionStorage, global.localStorage];
    for (var i = 0; i < stores.length; i += 1) {
      var store = stores[i];
      var user = normalizeUser(readJSON(store, USER_KEY));
      if (!user || !user.userId) {
        continue;
      }
      var token = "";
      var expiresAt = "";
      try {
        token = store.getItem(TOKEN_KEY) || "";
        expiresAt = store.getItem(EXPIRES_KEY) || "";
      } catch (e) {
        token = "";
        expiresAt = "";
      }
      if (isExpired(expiresAt)) {
        clearStore(store);
        continue;
      }
      return {
        user: user,
        token: token,
        expiresAt: expiresAt,
        remember: store === global.localStorage,
      };
    }
    return null;
  }

  function getCurrentUser() {
    var session = readSession();
    return session ? session.user : null;
  }

  function getToken() {
    var session = readSession();
    return session && session.token ? session.token : "";
  }

  function setCurrentUser(user, options) {
    var normalized = normalizeUser(user);
    if (!normalized || !normalized.userId) {
      return null;
    }
    options = options || {};
    var remember = Boolean(options.remember);
    var token = String(options.token || "");
    var expiresAt = String(options.expiresAt || "");
    var active = storageFor(remember);
    var other = storageFor(!remember);

    clearStore(other);
    try {
      active.setItem(USER_KEY, JSON.stringify(normalized));
      if (token) {
        active.setItem(TOKEN_KEY, token);
      } else {
        active.removeItem(TOKEN_KEY);
      }
      if (expiresAt) {
        active.setItem(EXPIRES_KEY, expiresAt);
      } else {
        active.removeItem(EXPIRES_KEY);
      }
    } catch (e) {
      // Ignore storage failures.
    }
    if (normalized.role && global.NovaraRole && NovaraRole.setSelectedRole) {
      NovaraRole.setSelectedRole(normalized.role);
    }
    return normalized;
  }

  function clearCurrentUser() {
    clearStore(global.sessionStorage);
    clearStore(global.localStorage);
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

  function isAemUser(user) {
    var current = user || getCurrentUser();
    return Boolean(
      current && String(current.role || "").toLowerCase() === "aem"
    );
  }

  function isOwnerUser(user) {
    var current = user || getCurrentUser();
    if (!current || isAemUser(current)) {
      return false;
    }
    var role = String(current.role || "").toLowerCase();
    return role === "owner" || Boolean(current.ownerId);
  }

  function getOwnerId(user) {
    var current = user || getCurrentUser();
    if (!current || isAemUser(current)) {
      return "";
    }
    if (!isOwnerUser(current)) {
      return "";
    }
    return String(current.ownerId || "").trim();
  }

  function updateCurrentUser(partial) {
    var session = readSession();
    if (!session || !session.user) {
      return null;
    }
    var merged = {};
    Object.keys(session.user).forEach(function (key) {
      merged[key] = session.user[key];
    });
    if (partial && typeof partial === "object") {
      Object.keys(partial).forEach(function (key) {
        merged[key] = partial[key];
      });
    }
    return setCurrentUser(merged, {
      token: session.token,
      expiresAt: session.expiresAt,
      remember: session.remember,
    });
  }

  function logout(redirectTo) {
    clearCurrentUser();
    if (global.NovaraRole && NovaraRole.clearSelectedRole) {
      NovaraRole.clearSelectedRole();
    }
    window.location.href = redirectTo || "video-landing.html";
  }

  global.NovaraAuth = {
    USER_KEY: USER_KEY,
    TOKEN_KEY: TOKEN_KEY,
    getCurrentUser: getCurrentUser,
    getToken: getToken,
    setCurrentUser: setCurrentUser,
    updateCurrentUser: updateCurrentUser,
    clearCurrentUser: clearCurrentUser,
    initialsFor: initialsFor,
    logout: logout,
    isAemUser: isAemUser,
    isOwnerUser: isOwnerUser,
    getOwnerId: getOwnerId,
  };
})(window);
