(function () {
  "use strict";
  if (!document.body || document.body.getAttribute("data-page") !== "leads") return;
  if (document.getElementById("export-all-leads-btn")) return;

  var actions = document.querySelector(".lead-toolbar-actions");
  if (!actions) return;

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

  var input = document.createElement("input");
  input.type = "file";
  input.id = "bulk-leads-file";
  input.accept = ".csv,text/csv";
  input.hidden = true;

  actions.appendChild(exportBtn);
  actions.appendChild(uploadBtn);
  actions.appendChild(input);

  var status = document.createElement("p");
  status.id = "bulk-leads-status";
  status.className = "chart-status";
  status.setAttribute("aria-live", "polite");
  status.style.width = "100%";
  status.style.marginTop = "4px";
  var toolbar = document.querySelector(".leads-toolbar");
  if (toolbar) toolbar.appendChild(status);

  var script = document.createElement("script");
  script.src = "bulk-lead-maintenance.js?v=1";
  script.defer = false;
  document.body.appendChild(script);
})();
