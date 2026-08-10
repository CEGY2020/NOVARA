/* Shared NOVARA JSON API client for readings + savings + sites + systems + owners + mgmt companies + leads. */
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

  function fetchJson(path, query) {
    var url = buildUrl(path, query);
    return fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    }).then(function (response) {
      return parseResponse(response, path);
    });
  }

  function sendJson(path, method, payload) {
    var url = buildUrl(path);
    var options = {
      method: method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
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
  };
})(window);
