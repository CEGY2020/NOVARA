(function () {
  "use strict";

  var enabledEl = document.getElementById("sales-report-enabled");
  var hourEl = document.getElementById("sales-report-hour");
  var boardEl = document.getElementById("board-recipients");
  var salesBody = document.getElementById("salespeople-tbody");
  var progressBody = document.getElementById("progress-tbody");
  var dailyLists = document.getElementById("daily-lists");
  var statusEl = document.getElementById("sales-report-status");
  var saveBtn = document.getElementById("save-sales-report-settings");
  var sendBtn = document.getElementById("send-sales-reports-now");
  var refreshBtn = document.getElementById("refresh-sales-reports");
  var current = null;

  if (!enabledEl || !hourEl || !salesBody || !progressBody || !dailyLists) return;

  for (var h = 0; h < 24; h += 1) {
    var opt = document.createElement("option");
    opt.value = String(h);
    var hour12 = h % 12 || 12;
    opt.textContent = hour12 + ":00 " + (h < 12 ? "AM" : "PM");
    hourEl.appendChild(opt);
  }

  function text(value) { return value == null ? "" : String(value); }
  function esc(value) {
    return text(value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  }
  function setStatus(message, isError) {
    statusEl.textContent = message || "";
    statusEl.classList.toggle("is-error", Boolean(isError));
  }

  function fetchReport() {
    setStatus("Loading sales reports…", false);
    return window.NovaraApi.fetchJson("/api/sales-reports")
      .then(function (data) {
        current = data;
        render(data);
        setStatus("Sales report data loaded.", false);
      })
      .catch(function (err) {
        setStatus(err.message || "Unable to load sales reports.", true);
      });
  }

  function render(data) {
    var settings = (data && data.settings) || {};
    enabledEl.value = settings.enabled ? "true" : "false";
    hourEl.value = String(settings.deliveryHour == null ? 7 : settings.deliveryHour);
    boardEl.value = (settings.boardRecipients || []).join("\n");

    var progressByName = {};
    (data.progress || []).forEach(function (row) { progressByName[row.name] = row; });

    var salespeople = data.salespeople || [];
    if (!salespeople.length) {
      salesBody.innerHTML = '<tr><td colspan="7">No active salespeople are configured.</td></tr>';
    } else {
      salesBody.innerHTML = salespeople.map(function (person, index) {
        var p = progressByName[person.name] || {};
        return '<tr data-sales-index="' + index + '">' +
          '<td><input type="checkbox" class="sales-email-enabled"' + (person.enabled === false ? '' : ' checked') + '></td>' +
          '<td><strong>' + esc(person.name) + '</strong></td>' +
          '<td><input type="email" class="sales-email-address" value="' + esc(person.email || '') + '"></td>' +
          '<td>' + esc(p.active || 0) + '</td>' +
          '<td>' + esc(p.won || 0) + '</td>' +
          '<td>' + esc(p.lost || 0) + '</td>' +
          '<td>' + esc(p.closeRate || 0) + '%</td>' +
          '</tr>';
      }).join("");
    }

    if (!(data.progress || []).length) {
      progressBody.innerHTML = '<tr><td colspan="10">No salesperson progress data available.</td></tr>';
    } else {
      progressBody.innerHTML = data.progress.map(function (p) {
        return '<tr><td><strong>' + esc(p.name) + '</strong></td><td>' + esc(p.total) + '</td><td>' + esc(p.active) + '</td><td>' + esc(p.new) + '</td><td>' + esc(p.contacted) + '</td><td>' + esc(p.qualified) + '</td><td>' + esc(p.proposal) + '</td><td>' + esc(p.won) + '</td><td>' + esc(p.lost) + '</td><td>' + esc(p.closeRate) + '%</td></tr>';
      }).join("");
    }

    var leadOrder = settings.leadOrder || {};
    var blocks = [];
    Object.keys(data.dailyLists || {}).forEach(function (name) {
      var leads = data.dailyLists[name] || [];
      var rows = leads.length ? leads.map(function (lead) {
        return '<tr><td><input class="daily-lead-order" type="number" min="1" step="1" data-lead-id="' + esc(lead.leadId) + '" value="' + esc(leadOrder[lead.leadId] == null ? '' : leadOrder[lead.leadId]) + '"></td><td><strong>' + esc(lead.companyName || lead.siteName || '') + '</strong><br><small>' + esc(lead.leadId || '') + '</small></td><td>' + esc(lead.contactName || '') + '</td><td>' + esc(lead.contactPhone || '') + '</td><td>' + esc(lead.nextFollowUp || 'No date') + '</td><td>' + esc(lead.stage || '') + '</td></tr>';
      }).join("") : '<tr><td colspan="6">No active leads assigned.</td></tr>';
      blocks.push('<section class="report-card"><h3>' + esc(name) + '</h3><div class="daily-list"><table><thead><tr><th>Order</th><th>Company / Site</th><th>Contact</th><th>Phone</th><th>Next Contact</th><th>Stage</th></tr></thead><tbody>' + rows + '</tbody></table></div></section>');
    });
    dailyLists.innerHTML = blocks.join("") || '<div class="report-card">No salesperson lead lists available.</div>';
  }

  function collectSettings() {
    var salespeople = [];
    var rows = salesBody.querySelectorAll("tr[data-sales-index]");
    Array.prototype.forEach.call(rows, function (row) {
      var index = Number(row.getAttribute("data-sales-index"));
      var base = (current.salespeople || [])[index] || {};
      salespeople.push({
        name: base.name || "",
        email: row.querySelector(".sales-email-address").value.trim(),
        enabled: row.querySelector(".sales-email-enabled").checked
      });
    });

    var leadOrder = {};
    Array.prototype.forEach.call(document.querySelectorAll(".daily-lead-order"), function (input) {
      var value = input.value.trim();
      if (!value) return;
      var parsed = parseInt(value, 10);
      if (Number.isFinite(parsed) && parsed > 0) leadOrder[input.getAttribute("data-lead-id")] = parsed;
    });

    return {
      enabled: enabledEl.value === "true",
      deliveryHour: Number(hourEl.value),
      boardRecipients: boardEl.value.split(/[\n,;]+/).map(function (v) { return v.trim(); }).filter(Boolean),
      salespeople: salespeople,
      leadOrder: leadOrder
    };
  }

  function saveSettings() {
    saveBtn.disabled = true;
    setStatus("Saving daily sales report settings…", false);
    window.NovaraApi.sendJson("/api/sales-reports", "PUT", collectSettings())
      .then(function () { setStatus("Daily sales report settings saved.", false); return fetchReport(); })
      .catch(function (err) { setStatus(err.message || "Unable to save settings.", true); })
      .finally(function () { saveBtn.disabled = false; });
  }

  function sendNow() {
    if (!window.confirm("Send each enabled salesperson their lead list now, and send the restricted progress report to the authorized recipients?")) return;
    sendBtn.disabled = true;
    setStatus("Sending sales reports…", false);
    window.NovaraApi.sendJson("/api/sales-reports/send-now", "POST", {})
      .then(function () { setStatus("Sales reports sent.", false); })
      .catch(function (err) { setStatus(err.message || "Unable to send reports.", true); })
      .finally(function () { sendBtn.disabled = false; });
  }

  saveBtn.addEventListener("click", saveSettings);
  sendBtn.addEventListener("click", sendNow);
  refreshBtn.addEventListener("click", fetchReport);
  fetchReport();
})();
