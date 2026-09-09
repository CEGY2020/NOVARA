window.NOVARA_API_BASE = "https://jwhirgzy45.execute-api.us-west-2.amazonaws.com";

(function () {
  if (!document.body || document.body.getAttribute("data-page") !== "leads") return;
  var script = document.createElement("script");
  script.src = "bulk-lead-bootstrap.js?v=1";
  script.defer = false;
  document.body.appendChild(script);
})();
