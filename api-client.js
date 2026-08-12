/* Shared NOVARA JSON API client for readings + savings + sites + systems + photos + owners + mgmt companies + leads + users. */
(function (global) {
  function apiBase() {
    var base = global.NOVARA_API_BASE;
    if (base == null || base === "") {
      return "";
    }
    return String(base).replace(/\/+$/, "");
  }

  function buildUrl(path, query) {
    var url = apiBase() + path;
    if (!query) {
      return url;
    }
    var parts = [];
    Object.keys(query).forEach(function (key) {
      var value = query[key];
      if (value == null || value === "") {
        return;
      }
      parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(value)));
    });
    if (!parts.length) {
      return url;
    }
    return url + (url.indexOf("?") === -1 ? "?" : "&") + parts.join("&");
  }

  function parseResponse(response, path) {
    var contentType = (response.headers.get("content-type") || "").toLowerCase();
    return response.text().then(function (text) {
      var body = null;
      var trimmed = (text || "").replace(/^\uFEFF/, "").trim();
      if (trimmed) {
        try {
          body = JSON.parse(trimmed);
        } catch (err) {
          if (
            contentType.indexOf("text/html") !== -1 ||
            trimmed.charAt(0) === "<"
          ) {
            throw new Error(
              "API returned HTML instead of JSON at " +
                path +
                ". Deploy the NOVARA Lambda API and set window.NOVARA_API_BASE (api-config.js) or Amplify /api rewrite."
            );
          }
          throw new Error("Invalid JSON from " + path + ": " + err.message);
        }
      }
      if (!response.ok) {
        var detail = body && (body.detail || body.error);
        throw new Error(detail || "Request failed (" + response.status + ")");
      }
      return body || {};
    });
  }

  function authHeaders() {
    var headers = { Accept: "application/json" };
    try {
      if (global.NovaraAuth && typeof NovaraAuth.getToken === "function") {
        var token = NovaraAuth.getToken();
        if (token) {
          headers.Authorization = "Bearer " + token;
        }
      }
    } catch (e) {
      // Ignore storage access issues.
    }
    return headers;
  }

  function fetchJson(path, query) {
    var url = buildUrl(path, query);
    return fetch(url, {
      method: "GET",
      headers: authHeaders(),
      cache: "no-store",
    }).then(function (response) {
      return parseResponse(response, path);
    });
  }

  function sendJson(path, method, payload) {
    var url = buildUrl(path);
    var headers = authHeaders();
    headers["Content-Type"] = "application/json";
    var options = {
      method: method,
      headers: headers,
      cache: "no-store",
    };
    // Avoid DELETE/GET request bodies (some proxies reject them).
    if (method !== "DELETE" && method !== "GET") {
      options.body = JSON.stringify(payload || {});
    }
    return fetch(url, options).then(function (response) {
      return parseResponse(response, path);
    });
  }

  function resolveUploadUrl(uploadUrl) {
    var url = String(uploadUrl || "");
    if (!url) {
      return "";
    }
    if (/^https?:\/\//i.test(url)) {
      return url;
    }
    return buildUrl(url);
  }

  function uploadBinary(uploadUrl, file, headers) {
    var url = resolveUploadUrl(uploadUrl);
    var requestHeaders = {};
    if (headers && typeof headers === "object") {
      Object.keys(headers).forEach(function (key) {
        requestHeaders[key] = headers[key];
      });
    }
    if (!requestHeaders["Content-Type"] && file && file.type) {
      requestHeaders["Content-Type"] = file.type;
    }
    return fetch(url, {
      method: "PUT",
      headers: requestHeaders,
      body: file,
      cache: "no-store",
    }).then(function (response) {
      if (!response.ok) {
        return response.text().then(function (text) {
          var detail = text;
          try {
            var parsed = JSON.parse(text || "{}");
            detail = parsed.detail || parsed.error || text;
          } catch (e) {
            // keep raw text
          }
          throw new Error(detail || "Upload failed (" + response.status + ")");
        });
      }
      return { ok: true };
    });
  }

  global.NovaraApi = {
    base: apiBase,
    url: buildUrl,
    fetchJson: fetchJson,
    sendJson: sendJson,
    getReadings: function (siteId, days, systemId) {
      return fetchJson("/api/readings", {
        siteId: siteId,
        days: days,
        systemId: systemId,
      });
    },
    getSavings: function (days) {
      return fetchJson("/api/savings", {
        days: days,
      });
    },
    getSites: function () {
      return fetchJson("/api/sites");
    },
    createSite: function (site) {
      return sendJson("/api/sites", "POST", site);
    },
    updateSite: function (site) {
      return sendJson("/api/sites", "PUT", site);
    },
    getSystems: function () {
      return fetchJson("/api/systems");
    },
    createSystem: function (system) {
      return sendJson("/api/systems", "POST", system);
    },
    updateSystem: function (system) {
      var id = system && (system.SystemID || system.systemId);
      if (id) {
        return sendJson(
          "/api/systems/" + encodeURIComponent(String(id)),
          "PUT",
          system
        );
      }
      return sendJson("/api/systems", "PUT", system);
    },
    deleteSystem: function (systemId) {
      var id =
        typeof systemId === "string" || typeof systemId === "number"
          ? systemId
          : systemId && (systemId.SystemID || systemId.systemId);
      if (!id) {
        return Promise.reject(new Error("SystemID is required"));
      }
      return sendJson(
        "/api/systems/" + encodeURIComponent(String(id)),
        "DELETE",
        null
      );
    },
    getPhotos: function (filters) {
      var opts = filters || {};
      return fetchJson("/api/photos", {
        siteId: opts.siteId || opts.SiteID || "",
        systemId: opts.systemId || opts.SystemID || "",
      });
    },
    createPhoto: function (photo) {
      return sendJson("/api/photos", "POST", photo);
    },
    deletePhoto: function (photoId) {
      var id =
        typeof photoId === "string" || typeof photoId === "number"
          ? photoId
          : photoId && (photoId.PhotoID || photoId.photoId);
      if (!id) {
        return Promise.reject(new Error("PhotoID is required"));
      }
      return sendJson(
        "/api/photos/" + encodeURIComponent(String(id)),
        "DELETE",
        null
      );
    },
    uploadPhotoFile: function (uploadUrl, file, headers) {
      return uploadBinary(uploadUrl, file, headers);
    },
    getOwners: function () {
      return fetchJson("/api/owners");
    },
    createOwner: function (owner) {
      return sendJson("/api/owners", "POST", owner);
    },
    updateOwner: function (owner) {
      var id = owner && (owner.OwnerID || owner.ownerId);
      if (!id) {
        return Promise.reject(new Error("OwnerID is required"));
      }
      return sendJson(
        "/api/owners/" + encodeURIComponent(String(id)),
        "PUT",
        owner
      );
    },
    getMgmtCompanies: function () {
      return fetchJson("/api/mgmt-companies");
    },
    createMgmtCompany: function (company) {
      return sendJson("/api/mgmt-companies", "POST", company);
    },
    updateMgmtCompany: function (company) {
      var id =
        company && (company.MgmtCompanyID || company.mgmtCompanyId);
      if (!id) {
        return Promise.reject(new Error("MgmtCompanyID is required"));
      }
      return sendJson(
        "/api/mgmt-companies/" + encodeURIComponent(String(id)),
        "PUT",
        company
      );
    },
    getLeads: function () {
      return fetchJson("/api/leads");
    },
    createLead: function (lead) {
      return sendJson("/api/leads", "POST", lead);
    },
    updateLead: function (lead) {
      var id = lead && (lead.LeadID || lead.leadId);
      if (!id) {
        return Promise.reject(new Error("LeadID is required"));
      }
      return sendJson(
        "/api/leads/" + encodeURIComponent(String(id)),
        "PUT",
        lead
      );
    },
    getUsers: function (status) {
      return fetchJson("/api/users", status ? { status: status } : null);
    },
    signupUser: function (payload) {
      return sendJson("/api/users/signup", "POST", payload);
    },
    loginUser: function (payload) {
      return sendJson("/api/users/login", "POST", payload);
    },
    getSession: function () {
      return fetchJson("/api/users/session");
    },
    updateUserStatus: function (userId, status, options) {
      var id =
        typeof userId === "string" || typeof userId === "number"
          ? userId
          : userId && (userId.UserID || userId.userId);
      if (!id) {
        return Promise.reject(new Error("UserID is required"));
      }
      var opts = options || {};
      var body = { Status: status };
      if (opts.rejectionReason != null) {
        body.RejectionReason = opts.rejectionReason;
      }
      if (opts.sendRejectionEmail != null) {
        body.SendRejectionEmail = opts.sendRejectionEmail;
      }
      if (opts.decisionToken) {
        body.DecisionToken = opts.decisionToken;
      }
      return sendJson(
        "/api/users/" + encodeURIComponent(String(id)) + "/status",
        "PUT",
        body
      );
    },
    getPreapprovedEmails: function () {
      return fetchJson("/api/users/preapproved");
    },
    addPreapprovedEmail: function (email) {
      return sendJson("/api/users/preapproved", "POST", { Email: email });
    },
    removePreapprovedEmail: function (email) {
      if (!email) {
        return Promise.reject(new Error("Email is required"));
      }
      return sendJson(
        "/api/users/preapproved/" + encodeURIComponent(String(email)),
        "DELETE"
      );
    },
  };
})(window);
