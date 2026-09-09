(function () {
  "use strict";
  if (!document.body || document.body.getAttribute("data-page") !== "leads") return;
  if (document.getElementById("export-all-leads-btn")) return;

  var actions = document.querySelector(".lead-toolbar-actions");
  if (!actions) return;

  var printAllBtn = document.createElement("button");
  printAllBtn.type = "button";
  printAllBtn.className = "secondary-btn";
  printAllBtn.id = "print-all-leads-btn";
  printAllBtn.textContent = "Print All Leads";

  var exportBtn = document.createElement("button");
  exportBtn.type = "button";
  exportBtn.className = "secondary-btn";
  exportBtn.id = "export-all-leads-btn";
  exportBtn.textContent = "Export All Leads";

  var uploadBtn = document.createElement("button");
  uploadBtn.type = "button";
  uploadBtn.className = "secondary-btn";
  uploadBtn.id = "upload-leads-btn";
  uploadBtn.textContent = "Upload Revised Leads";

  var importBtn = document.createElement("button");
  importBtn.type = "button";
  importBtn.className = "secondary-btn";
  importBtn.id = "import-new-leads-btn";
  importBtn.textContent = "Import New Leads";

  var reportLink = document.createElement("a");
  reportLink.className = "secondary-btn";
  reportLink.id = "daily-sales-reports-link";
  reportLink.href = "sales-reports.html";
  reportLink.textContent = "Daily Sales Reports";

  var input = document.createElement("input");
  input.type = "file";
  input.id = "bulk-leads-file";
  input.accept = ".csv,text/csv";
  input.hidden = true;

  var newLeadsInput = document.createElement("input");
  newLeadsInput.type = "file";
  newLeadsInput.id = "new-leads-file";
  newLeadsInput.accept = ".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv";
  newLeadsInput.hidden = true;

  actions.appendChild(printAllBtn);
  actions.appendChild(exportBtn);
  actions.appendChild(uploadBtn);
  actions.appendChild(importBtn);
  actions.appendChild(reportLink);
  actions.appendChild(input);
  actions.appendChild(newLeadsInput);

  var status = document.createElement("p");
  status.id = "bulk-leads-status";
  status.className = "chart-status";
  status.setAttribute("aria-live", "polite");
  status.style.width = "100%";
  status.style.marginTop = "4px";
  var toolbar = document.querySelector(".leads-toolbar");
  if (toolbar) toolbar.appendChild(status);

  printAllBtn.addEventListener("click", function () {
    var search = document.getElementById("lead-search");
    var stage = document.getElementById("filter-stage");
    var assigned = document.getElementById("filter-assigned");
    var follow = document.getElementById("filter-followup");
    var print = document.getElementById("print-leads-btn");
    if (!print) return;

    var saved = {
      search: search ? search.value : "",
      stage: stage ? stage.value : "",
      assigned: assigned ? assigned.value : "",
      follow: follow ? follow.value : ""
    };

    if (search) search.value = "";
    if (stage) stage.value = "";
    if (assigned) assigned.value = "";
    if (follow) follow.value = "";
    print.click();

    if (search) search.value = saved.search;
    if (stage) stage.value = saved.stage;
    if (assigned) assigned.value = saved.assigned;
    if (follow) follow.value = saved.follow;
  });

  var maintenanceScript = document.createElement("script");
  maintenanceScript.src = "bulk-lead-maintenance.js?v=1";
  maintenanceScript.defer = false;
  document.body.appendChild(maintenanceScript);

  var importScript = document.createElement("script");
  importScript.src = "bulk-new-lead-import.js?v=1";
  importScript.defer = false;
  document.body.appendChild(importScript);
})();
