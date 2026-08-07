/**
 * Shared app chrome: sidebar + user profile.
 * Pages set <body data-page="dashboard|sites|systems|..."> and include
 * #sidebar-root and #user-profile-root mounts.
 */
(function () {
  var NAV_ITEMS = [
    { id: "dashboard", label: "Dashboard", href: "dashboard.html" },
    { id: "sites", label: "Sites", href: "sites.html" },
    { id: "systems", label: "Systems", href: "systems.html" },
    { id: "alarms", label: "Active Alarms", href: "active-alarms.html" },
    { id: "savings", label: "Energy Savings", href: "energy-savings.html" },
    { id: "reports", label: "Reports", href: "reports.html" },
    { id: "settings", label: "Settings", href: "settings.html" }
  ];

  var currentPage = document.body.getAttribute("data-page") || "";

  function renderSidebar(root) {
    var links = NAV_ITEMS.map(function (item) {
      var active = item.id === currentPage ? ' class="active"' : "";
      return '<a href="' + item.href + '"' + active + ">" + item.label + "</a>";
    }).join("\n");

    root.innerHTML =
      '<div class="brand">' +
      '  <img src="logo.png" alt="AEM Logo">' +
      "  <div>" +
      "    <h1>NOVARA</h1>" +
      "    <p>Operational Intelligence</p>" +
      "  </div>" +
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
    root.className = "user-profile";
    root.innerHTML =
      '<div class="user-avatar">SN</div>' +
      "<div>" +
      "  <strong>Steve Nold</strong>" +
      "  <span>Administrator</span>" +
      "</div>" +
      '<a href="index.html" class="logout-btn">Logout</a>';
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
