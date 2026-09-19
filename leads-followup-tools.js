(function () {
  "use strict";

  var CLOSED_STAGES = { Won: true, Lost: true };
  var followUpFilter = document.getElementById("filter-followup");
  var stageFilter = document.getElementById("filter-stage");
  var assignedFilter = document.getElementById("filter-assigned");
  var leadTypeFilter = document.getElementById("filter-lead-type");
  var utilityTerritoryFilter = document.getElementById("filter-utility-territory");
  var searchInput = document.getElementById("lead-search");
  var printBtn = document.getElementById("print-leads-btn");
  var clearBtn = document.getElementById("clear-lead-filters-btn");
  var tbody = document.getElementById("leads-tbody");
  var pipelineBoard = document.getElementById("pipeline-board");
  var statusEl = document.getElementById("leads-status");

  if (!tbody) return;

  var allLeads = [];
  var leadsById = {};
  var applyQueued = false;

  function text(value) {
    return value == null ? "" : String(value);
  }

  function escapeHtml(value) {
    return text(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function todayIsoDate() {
    var now = new Date();
    var y = now.getFullYear();
    var m = String(now.getMonth() + 1).padStart(2, "0");
    var d = String(now.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  function addDaysIso(isoDate, days) {
    var parts = text(isoDate).split("-");
    if (parts.length !== 3) return "";
    var date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (Number.isNaN(date.getTime())) return "";
    date.setDate(date.getDate() + days);
    return (
      date.getFullYear() +
      "-" +
      String(date.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(date.getDate()).padStart(2, "0")
    );
  }

  function followUpDate(lead) {
    var value = text(lead && lead.nextFollowUp).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
  }

  function isOpenLead(lead) {
    return !CLOSED_STAGES[text(lead && lead.stage)];
  }

  function matchesFollowUp(lead) {
    var filter = followUpFilter ? text(followUpFilter.value).trim() : "";
    if (!filter) return true;
    if (!isOpenLead(lead)) return false;

    var date = followUpDate(lead);
    var today = todayIsoDate();

    if (filter === "today") return date === today;
    if (filter === "overdue") return Boolean(date) && date < today;
    if (filter === "due-soon") {
      return Boolean(date) && date >= today && date <= addDaysIso(today, 7);
    }
    if (filter === "next-30") {
      return Boolean(date) && date >= today && date <= addDaysIso(today, 30);
    }
    if (filter === "none") return !date;
    return true;
  }

  function searchHaystack(lead) {
    return [
      lead && lead.leadId,
      lead && lead.companyName,
      lead && lead.siteName,
      lead && lead.mgmtCompanyName,
      lead && lead.contactName,
      lead && lead.contactEmail,
      lead && lead.contactPhone,
      lead && lead.stage,
      lead && lead.assignedTo,
      lead && lead.source,
      lead && lead.systemType,
      utilityTerritory(lead),
      lead && lead.notes,
    ]
      .map(text)
      .join(" ")
      .toLowerCase();
  }

  function matchesSearch(lead) {
    var query = searchInput ? text(searchInput.value).trim().toLowerCase() : "";
    if (!query) return true;
    return searchHaystack(lead).indexOf(query) !== -1;
  }

  var SDGE_CITIES = ["aliso viejo","bonita","bonsall","carlsbad","chula vista","coronado","dana point","del mar","descanso","el cajon","encinitas","escondido","fallbrook","imperial beach","la jolla","la mesa","laguna beach","laguna hills","laguna niguel","lakeside","lemon grove","mission beach","mission valley","mission viejo","national city","oceanside","otay mesa","pacific beach","poway","ramona","rancho bernardo","rancho san diego","rancho santa fe","san clemente","san diego","san diego / mission hills","san juan capistrano","san marcos","san ysidro","santee","solana beach","spring valley","vista","leucadia"];
  var PGE_CITIES = ["citrus heights","dublin","emeryville","fremont","fresno","milpitas","oakland","palo alto","pleasant hill","roseville","saint helena","st helena","san francisco","san jose","san lorenzo","san mateo","stockton","sunnyvale","vallejo"];
  var SOCALGAS_CITIES = ["anaheim","bakersfield","brea","buena park","burbank","cerritos","chatsworth","chino","city of industry","corona","costa mesa","culver city","cypress","desert hot springs","diamond bar","downey","encino","fountain valley","fullerton","garden grove","gardena","glendale","hawaiian gardens","hawthorne","hermosa beach","hollywood","huntington beach","indio","irvine","la habra","la mirada","la quinta","la verne","laguna woods","lake forest","lakewood","lancaster","long beach","los angeles","marina del rey","menifee","monrovia","montclair","newport beach","newport coast","north hills","north hollywood","northridge","norwalk","ontario","orange","oxnard","palm desert","palm springs","palos verdes peninsula","pasadena","pico rivera","placentia","rancho palos verdes","rancho santa margarita","redondo beach","rosemead","san bernardino","san marino","santa ana","santa monica","seal beach","studio city","temecula","torrance","tustin","tustin ranch","valencia","valley village","van nuys","ventura","w hollywood","west covina","west hollywood","whittier","woodland hills","yorba linda"];

  function normalizedLeadType(lead) {
    var value = text(lead && lead.systemType).trim();
    return value === "DHW" ? "DHW NG" : value;
  }

  function utilityTerritory(lead) {
    if (!lead) return "Verify";
    var explicit = text(lead.utilityTerritory || lead.utilityRegion || lead.gasRegion).trim();
    if (explicit) return explicit;
    var state = text(lead.state).trim().toUpperCase();
    var city = text(lead.city).toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
    if (state && state !== "CA") return "Verify";
    if (SDGE_CITIES.indexOf(city) !== -1) return "SDG&E";
    if (PGE_CITIES.indexOf(city) !== -1) return "PG&E";
    if (SOCALGAS_CITIES.indexOf(city) !== -1) return "SoCalGas";
    return "Verify";
  }

  function matchesStageAndAssigned(lead) {
    var stage = stageFilter ? text(stageFilter.value).trim() : "";
    var assigned = assignedFilter ? text(assignedFilter.value).trim() : "";
    if (stage && text(lead && lead.stage).trim() !== stage) return false;
    if (assigned && text(lead && lead.assignedTo).trim() !== assigned) return false;
    return true;
  }

  function matchesLeadTypeAndUtility(lead) {
    var leadType = leadTypeFilter ? text(leadTypeFilter.value).trim() : "";
    var utility = utilityTerritoryFilter ? text(utilityTerritoryFilter.value).trim() : "";
    if (leadType && normalizedLeadType(lead) !== leadType) return false;
    if (utility && utilityTerritory(lead) !== utility) return false;
    return true;
  }

  function matchesAllFilters(lead) {
    return matchesStageAndAssigned(lead) && matchesLeadTypeAndUtility(lead) && matchesFollowUp(lead) && matchesSearch(lead);
  }

  function leadPriority(lead) {
    if (!lead) return 99;
    if (!isOpenLead(lead)) return 5;
    var date = followUpDate(lead);
    var today = todayIsoDate();
    if (date && date < today) return 0;
    if (date === today) return 1;
    if (date) return 2;
    return 3;
  }

  function sortLeads(a, b) {
    var pa = leadPriority(a);
    var pb = leadPriority(b);
    if (pa !== pb) return pa - pb;

    var da = followUpDate(a) || "9999-12-31";
    var db = followUpDate(b) || "9999-12-31";
    if (da !== db) return da < db ? -1 : 1;

    var ca = text((a && (a.companyName || a.siteName)) || "");
    var cb = text((b && (b.companyName || b.siteName)) || "");
    return ca.localeCompare(cb, undefined, { sensitivity: "base" });
  }

  function visibleFilteredLeads() {
    return allLeads.filter(matchesAllFilters).sort(sortLeads);
  }

  function reorderVisibleRows() {
    var rows = Array.prototype.slice.call(tbody.querySelectorAll("tr.lead-row"));
    if (!rows.length) return;

    rows.forEach(function (row) {
      var id = row.getAttribute("data-lead-id");
      var lead = leadsById[id];
      row.hidden = !lead || !matchesSearch(lead) || !matchesFollowUp(lead);
    });

    var sortedRows = rows.slice().sort(function (a, b) {
      return sortLeads(
        leadsById[a.getAttribute("data-lead-id")],
        leadsById[b.getAttribute("data-lead-id")]
      );
    });

    var currentIds = rows.map(function (row) {
      return row.getAttribute("data-lead-id");
    }).join("|");
    var sortedIds = sortedRows.map(function (row) {
      return row.getAttribute("data-lead-id");
    }).join("|");

    if (currentIds !== sortedIds) {
      sortedRows.forEach(function (row) {
        tbody.appendChild(row);
      });
    }
  }

  function updatePipeline() {
    if (!pipelineBoard) return;
    var cards = pipelineBoard.querySelectorAll(".pipeline-card[data-lead-id]");
    Array.prototype.forEach.call(cards, function (card) {
      var id = card.getAttribute("data-lead-id");
      var lead = leadsById[id];
      card.hidden = !lead || !matchesSearch(lead) || !matchesFollowUp(lead);
    });

    var columns = pipelineBoard.querySelectorAll(".pipeline-column");
    Array.prototype.forEach.call(columns, function (column) {
      var visible = Array.prototype.filter.call(
        column.querySelectorAll(".pipeline-card[data-lead-id]"),
        function (card) { return !card.hidden; }
      );
      var count = column.querySelector(".pipeline-count");
      if (count) count.textContent = String(visible.length);
    });
  }

  function filterDescription() {
    var parts = [];
    var labels = {
      today: "contact today",
      overdue: "overdue",
      "due-soon": "next 7 days",
      "next-30": "next 30 days",
      none: "no follow-up scheduled",
    };
    if (followUpFilter && followUpFilter.value && labels[followUpFilter.value]) {
      parts.push(labels[followUpFilter.value]);
    }
    if (stageFilter && stageFilter.value) parts.push(stageFilter.value);
    if (assignedFilter && assignedFilter.value) parts.push("assigned to " + assignedFilter.value);
    if (leadTypeFilter && leadTypeFilter.value) parts.push("lead type " + leadTypeFilter.value);
    if (utilityTerritoryFilter && utilityTerritoryFilter.value) parts.push(utilityTerritoryFilter.value);
    if (searchInput && searchInput.value.trim()) parts.push('search “' + searchInput.value.trim() + '”');
    return parts.join(", ");
  }

  function updateStatus() {
    if (!statusEl || !allLeads.length) return;
    var count = visibleFilteredLeads().length;
    var description = filterDescription();
    statusEl.textContent =
      count +
      " lead" +
      (count === 1 ? "" : "s") +
      " shown" +
      (description ? " (" + description + ")" : "") +
      " · " +
      allLeads.length +
      " total";
  }

  function applyTools() {
    applyQueued = false;
    reorderVisibleRows();
    updatePipeline();
    updateStatus();
  }

  function queueApply() {
    if (applyQueued) return;
    applyQueued = true;
    window.requestAnimationFrame(applyTools);
  }

  function loadLeadData() {
    var api = window.NovaraApi;
    var request = api && typeof api.getLeads === "function"
      ? api.getLeads()
      : fetch("/api/leads").then(function (response) { return response.json(); });

    return Promise.resolve(request)
      .then(function (data) {
        allLeads = (data && data.leads) || [];
        leadsById = {};
        allLeads.forEach(function (lead) {
          if (lead && lead.leadId) leadsById[lead.leadId] = lead;
        });
        queueApply();
      })
      .catch(function () {
        // The base Leads page already reports API errors. Do not replace that message here.
      });
  }

  function formatPrintDate(value) {
    return followUpDate({ nextFollowUp: value }) || "—";
  }

  function printCallSheet() {
    var leads = visibleFilteredLeads();
    if (!leads.length) {
      window.alert("There are no leads to print for the current filters.");
      return;
    }

    var popup = window.open("", "_blank");
    if (!popup) {
      window.alert("Your browser blocked the print window. Allow pop-ups for this site and try again.");
      return;
    }

    var rows = leads.map(function (lead) {
      var company = lead.companyName || lead.siteName || "—";
      var contact = lead.contactName || "—";
      return (
        "<tr>" +
        "<td><strong>" + escapeHtml(company) + "</strong><br><span>" + escapeHtml(lead.leadId || "") + "</span></td>" +
        "<td>" + escapeHtml(contact) + "</td>" +
        "<td>" + escapeHtml(lead.contactPhone || "—") + "</td>" +
        "<td>" + escapeHtml(lead.contactEmail || "—") + "</td>" +
        "<td>" + escapeHtml(lead.stage || "—") + "</td>" +
        "<td>" + escapeHtml(formatPrintDate(lead.nextFollowUp)) + "</td>" +
        "<td>" + escapeHtml(lead.assignedTo || "—") + "</td>" +
        "<td>" + escapeHtml(lead.notes || "") + "</td>" +
        "</tr>"
      );
    }).join("");

    var description = filterDescription();
    var generated = new Date().toLocaleString();
    popup.document.open();
    popup.document.write(
      "<!doctype html><html><head><title>NOVARA Lead Follow-Up Call Sheet</title>" +
      "<style>" +
      "body{font-family:Arial,sans-serif;color:#000;margin:24px;font-size:12px}" +
      "h1{font-size:20px;margin:0 0 4px}p{margin:2px 0 12px}" +
      "table{width:100%;border-collapse:collapse}th,td{border:1px solid #777;padding:6px;vertical-align:top;text-align:left}" +
      "th{background:#eee;font-size:11px}td span{font-size:10px;color:#333}" +
      "@media print{body{margin:.3in}button{display:none}thead{display:table-header-group}}" +
      "</style></head><body>" +
      "<h1>NOVARA Lead Follow-Up Call Sheet</h1>" +
      "<p><strong>Generated:</strong> " + escapeHtml(generated) + "</p>" +
      (description ? "<p><strong>Filters:</strong> " + escapeHtml(description) + "</p>" : "") +
      "<p><strong>Leads:</strong> " + leads.length + "</p>" +
      "<table><thead><tr><th>Company / Site</th><th>Contact</th><th>Phone</th><th>Email</th><th>Stage</th><th>Next Contact</th><th>Assigned</th><th>Action / Notes</th></tr></thead><tbody>" +
      rows +
      "</tbody></table>" +
      "<script>window.onload=function(){window.print();};<\/script>" +
      "</body></html>"
    );
    popup.document.close();
  }

  function clearFilters() {
    if (searchInput) searchInput.value = "";
    if (stageFilter) stageFilter.value = "";
    if (assignedFilter) assignedFilter.value = "";
    if (leadTypeFilter) leadTypeFilter.value = "";
    if (utilityTerritoryFilter) utilityTerritoryFilter.value = "";
    if (followUpFilter) followUpFilter.value = "";

    // Trigger the base Leads page to rebuild its rows after resetting its filters.
    [stageFilter, assignedFilter, leadTypeFilter, utilityTerritoryFilter, followUpFilter].forEach(function (el) {
      if (el) el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    queueApply();
  }

  if (searchInput) searchInput.addEventListener("input", queueApply);
  if (followUpFilter) followUpFilter.addEventListener("change", queueApply);
  if (stageFilter) stageFilter.addEventListener("change", queueApply);
  if (assignedFilter) assignedFilter.addEventListener("change", queueApply);
  if (leadTypeFilter) leadTypeFilter.addEventListener("change", queueApply);
  if (utilityTerritoryFilter) utilityTerritoryFilter.addEventListener("change", queueApply);
  if (printBtn) printBtn.addEventListener("click", printCallSheet);
  if (clearBtn) clearBtn.addEventListener("click", clearFilters);

  var observer = new MutationObserver(queueApply);
  observer.observe(tbody, { childList: true, subtree: true });
  if (pipelineBoard) observer.observe(pipelineBoard, { childList: true, subtree: true });

  document.addEventListener("novara:lead-saved", loadLeadData);
  window.addEventListener("focus", loadLeadData);

  loadLeadData();
})();
