/**
 * Shared app chrome: sidebar + user profile.
 * Pages set <body data-page="dashboard|sites|systems|..."> and include
 * #sidebar-root and #user-profile-root mounts.
 * Navigation is filtered by the selected portal role (NovaraRole).
 */
(function () {
  // Entity pages (Sites, Systems, Owners, Management Companies, Leads) stay
  // grouped ahead of ops links (alarms, savings, reports, settings).
  var AEM_NAV_ITEMS = [
    { id: "dashboard", label: "Dashboard", href: "dashboard.html" },
    { id: "sites", label: "Sites", href: "sites.html" },
    { id: "systems", label: "Systems", href: "systems.html" },
    { id: "owners", label: "Owners", href: "owners.html" },
    { id: "mgmt-companies", label: "Management Companies", href: "mgmt-companies.html" },
    { id: "leads", label: "Leads", href: "leads.html" },
    { id: "alarms", label: "Active Alarms", href: "active-alarms.html" },
    { id: "savings", label: "Energy Savings", href: "energy-savings.html" },
    { id: "reports", label: "Reports", href: "reports.html" },
    { id: "settings", label: "Settings", href: "settings.html" }
  ];

  var OWNER_NAV_ITEMS = [
    { id: "owner-home", label: "Home", href: "owner-home.html" },
    { id: "owner-sites", label: "My Sites", href: "owner-home.html#sites" },
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
    { id: "sales-leads", label: "Leads", href: "sales-home.html#leads" },
    { id: "sales-pipeline", label: "Pipeline", href: "sales-home.html#pipeline" }
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

  function readStoredRole() {
    if (window.NovaraRole && NovaraRole.getSelectedRole) {
      return NovaraRole.getSelectedRole();
    }
    try {
      return sessionStorage.getItem("novaraRole");
    } catch (e) {
      return null;
    }
  }

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

  var NAV_ITEMS = ROLE_NAV[role] || AEM_NAV_ITEMS;

  function renderSidebar(root) {
    var links = NAV_ITEMS.map(function (item) {
      var active = item.id === currentPage ? ' class="active"' : "";
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
    root.className = "user-profile";
    root.innerHTML =
      '<div class="user-avatar">SN</div>' +
      "<div>" +
      "  <strong>Steve Nold</strong>" +
      "  <span>" + title + "</span>" +
      "</div>" +
      '<a href="login.html" class="logout-btn">Logout</a>';
  }

  var sidebarRoot = document.getElementById("sidebar-root");
  var profileRoot = document.getElementById("user-profile-root");

  if (sidebarRoot) {
    renderSidebar(sidebarRoot);
  }

  if (profileRoot) {
    renderUserProfile(profileRoot);
  }
})();
