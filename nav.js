/**
 * Shared app chrome: sidebar + user profile.
 * Pages set <body data-page="dashboard|sites|systems|..."> and include
 * #sidebar-root and #user-profile-root mounts.
 * Navigation is filtered by the selected portal role (NovaraRole).
 */
(function () {
  // Entity pages (Sites, Systems, Owners, Management Companies, Leads) stay
  // grouped ahead of ops links (alarms, savings, utility data, reports, settings).
  var AEM_NAV_ITEMS = [
    { id: "dashboard", label: "Dashboard", href: "dashboard.html" },
    { id: "sites", label: "Sites", href: "sites.html" },
    { id: "systems", label: "Systems", href: "systems.html" },
    { id: "owners", label: "Owners", href: "owners.html" },
    { id: "mgmt-companies", label: "Management Companies", href: "mgmt-companies.html" },
    { id: "leads", label: "Leads", href: "leads.html" },
    { id: "users", label: "Users", href: "users.html" },
    { id: "alarms", label: "Active Alarms", href: "active-alarms.html" },
    { id: "savings", label: "Energy Savings", href: "energy-savings.html" },
    { id: "bills", label: "Utility Data", href: "bills.html" },
    { id: "reports", label: "Reports", href: "reports.html" },
    { id: "settings", label: "Settings", href: "settings.html" }
  ];

  var OWNER_NAV_ITEMS = [
    { id: "owner-home", label: "Home", href: "owner-home.html" },
    { id: "sites", label: "My Sites", href: "sites.html" },
    { id: "owner-performance", label: "Performance", href: "owner-home.html#performance" },
    { id: "owner-savings", label: "Savings", href: "owner-home.html#savings" }
  ];

  var CONTRACTOR_NAV_ITEMS = [
    { id: "contractor-home", label: "Home", href: "contractor-home.html" },
    { id: "contractor-sites", label: "Assigned Sites", href: "contractor-home.html#sites" },
    { id: "contractor-agreements", label: "Agreements", href: "contractor-home.html#agreements" }
  ];

  var SALES_NAV_ITEMS = [
    { id: "sales-home", label: "Home", href: "sales-home.html" },
    { id: "sales-leads", label: "Leads", href: "leads.html" },
    { id: "sales-pipeline", label: "Pipeline", href: "leads.html#pipeline" }
  ];

  var ROLE_NAV = {
    aem: AEM_NAV_ITEMS,
    owner: OWNER_NAV_ITEMS,
    contractor: CONTRACTOR_NAV_ITEMS,
    sales: SALES_NAV_ITEMS
  };

  var ROLE_TITLES = {
    aem: "Administrator",
    owner: "Owner",
    contractor: "Contractor",
    sales: "Sales"
  };

  var currentPage = document.body.getAttribute("data-page") || "";

  function readStoredUser() {
    if (window.NovaraAuth && NovaraAuth.getCurrentUser) {
      return NovaraAuth.getCurrentUser();
    }
    try {
      var raw =
        sessionStorage.getItem("novaraUser") ||
        localStorage.getItem("novaraUser");
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function readStoredRole() {
    var user = readStoredUser();
    if (user && user.role) {
      return user.role;
    }
    if (window.NovaraRole && NovaraRole.getSelectedRole) {
      return NovaraRole.getSelectedRole();
    }
    try {
      return sessionStorage.getItem("novaraRole");
    } catch (e) {
      return null;
    }
  }

  var currentUser = readStoredUser();
  var role =
    readStoredRole() ||
    document.body.getAttribute("data-role") ||
    "aem";

  if (ROLE_NAV[role] == null) {
    role = "aem";
  }

  if (window.NovaraRole && NovaraRole.setSelectedRole) {
    NovaraRole.setSelectedRole(role);
  }

  var NAV_ITEMS = (ROLE_NAV[role] || AEM_NAV_ITEMS).slice();
  // Users admin is only for logged-in AEM accounts.
  var isLoggedInAem =
    currentUser && String(currentUser.role || "").toLowerCase() === "aem";
  if (!isLoggedInAem) {
    NAV_ITEMS = NAV_ITEMS.filter(function (item) {
      return item.id !== "users";
    });
  }

  function currentHash() {
    return String(window.location.hash || "")
      .replace(/^#/, "")
      .toLowerCase();
  }

  function pageFileName() {
    return window.location.pathname.split("/").pop() || "";
  }

  function isItemActive(item) {
    // Sales Leads vs Pipeline share leads.html; hash selects the active item.
    if (role === "sales" && currentPage === "leads") {
      var onPipeline = currentHash() === "pipeline";
      if (item.id === "sales-pipeline") {
        return onPipeline;
      }
      if (item.id === "sales-leads") {
        return !onPipeline;
      }
      return false;
    }

    if (item.id === currentPage) {
      return true;
    }

    if (!item.href || item.href.indexOf("#") === -1) {
      return false;
    }

    var parts = item.href.split("#");
    var path = parts[0];
    var hash = (parts[1] || "").toLowerCase();
    if (path && pageFileName() !== path) {
      return false;
    }
    return currentHash() === hash;
  }

  function renderSidebar(root) {
    var links = NAV_ITEMS.map(function (item) {
      var active = isItemActive(item) ? ' class="active"' : "";
      return '<a href="' + item.href + '"' + active + ">" + item.label + "</a>";
    }).join("\n");

    root.innerHTML =
      '<div class="brand">' +
      '  <img class="brand-logo" src="images/novara-logo.png" alt="NOVARA">' +
      "</div>" +
      "<nav>" +
      links +
      "</nav>" +
      '<div class="sidebar-footer">' +
      "  <p>Advanced Energy Management</p>" +
      "  <p>Version 1.0</p>" +
      "</div>";
  }

  function renderUserProfile(root) {
    var title = ROLE_TITLES[role] || "Administrator";
    var displayName =
      (currentUser && currentUser.fullName) ||
      (currentUser && currentUser.email) ||
      "NOVARA User";
    var initials = "?";
    if (window.NovaraAuth && NovaraAuth.initialsFor) {
      initials = NovaraAuth.initialsFor(currentUser || { fullName: displayName });
    } else {
      initials = String(displayName)
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(function (part) {
          return part.charAt(0).toUpperCase();
        })
        .join("") || "?";
    }
    root.className = "user-profile";
    root.innerHTML =
      '<div class="user-avatar">' +
      initials +
      "</div>" +
      "<div>" +
      "  <strong>" +
      displayName +
      "</strong>" +
      "  <span>" +
      title +
      "</span>" +
      "</div>" +
      '<a href="directory.html" class="logout-btn" id="novara-logout-btn">Logout</a>';

    var logoutBtn = root.querySelector("#novara-logout-btn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", function (event) {
        event.preventDefault();
        if (window.NovaraAuth && NovaraAuth.logout) {
          NovaraAuth.logout("directory.html");
          return;
        }
        try {
          sessionStorage.removeItem("novaraUser");
          sessionStorage.removeItem("novaraToken");
          sessionStorage.removeItem("novaraTokenExpires");
          sessionStorage.removeItem("novaraRole");
          localStorage.removeItem("novaraUser");
          localStorage.removeItem("novaraToken");
          localStorage.removeItem("novaraTokenExpires");
        } catch (e) {
          // no-op
        }
        window.location.href = "directory.html";
      });
    }
  }

  function refreshActive() {
    var root = document.getElementById("sidebar-root");
    if (!root) return;
    var nav = root.querySelector("nav");
    if (!nav) {
      renderSidebar(root);
      return;
    }
    var links = nav.querySelectorAll("a");
    NAV_ITEMS.forEach(function (item, index) {
      if (!links[index]) return;
      if (isItemActive(item)) {
        links[index].classList.add("active");
      } else {
        links[index].classList.remove("active");
      }
    });
  }

  var sidebarRoot = document.getElementById("sidebar-root");
  var profileRoot = document.getElementById("user-profile-root");

  if (sidebarRoot) {
    renderSidebar(sidebarRoot);
  }

  if (profileRoot) {
    renderUserProfile(profileRoot);
  }

  window.addEventListener("hashchange", refreshActive);

  window.NovaraNav = {
    refreshActive: refreshActive,
    role: role,
    items: NAV_ITEMS
  };
})();
