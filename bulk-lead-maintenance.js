(function () {
  "use strict";

  var exportBtn = document.getElementById("export-all-leads-btn");
  var uploadBtn = document.getElementById("upload-leads-btn");
  var fileInput = document.getElementById("bulk-leads-file");
  var statusEl = document.getElementById("bulk-leads-status");

  if (!exportBtn || !uploadBtn || !fileInput) return;

  var HEADERS = [
    "LeadID",
    "CompanyName",
    "SiteName",
    "ManagementCompany",
    "ContactName",
    "ContactEmail",
    "ContactPhone",
    "Source",
    "SystemType",
    "Stage",
    "NextFollowUp",
    "AssignedTo",
    "EstimatedSavings",
    "Notes"
  ];

  var STAGES = {
    "New Lead": true,
    "Contacted": true,
    "Qualified": true,
    "Proposal Sent": true,
    "Won": true,
    "Lost": true
  };

  function text(value) {
    return value == null ? "" : String(value);
  }

  function setStatus(message, isError) {
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.classList.toggle("is-error", Boolean(isError));
  }

  function csvEscape(value) {
    var s = text(value);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function todayIsoDate() {
    var now = new Date();
    return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
  }

  function validDate(value) {
    var s = text(value).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
  }

  function sortForMaintenance(a, b) {
    var today = todayIsoDate();
    var ad = validDate(a.nextFollowUp);
    var bd = validDate(b.nextFollowUp);
    var ac = a.stage === "Won" || a.stage === "Lost";
    var bc = b.stage === "Won" || b.stage === "Lost";

    function bucket(date, closed) {
      if (closed) return 4;
      if (date && date < today) return 0;
      if (date) return 1;
      return 2;
    }

    var ab = bucket(ad, ac);
    var bb = bucket(bd, bc);
    if (ab !== bb) return ab - bb;
    if (ad !== bd) return (ad || "9999-12-31") < (bd || "9999-12-31") ? -1 : 1;
    return text(a.companyName || a.siteName).localeCompare(text(b.companyName || b.siteName), undefined, { sensitivity: "base" });
  }

  function getAllLeads() {
    var api = window.NovaraApi;
    if (!api || typeof api.getLeads !== "function") {
      return Promise.reject(new Error("NOVARA API is unavailable."));
    }
    return api.getLeads().then(function (data) {
      return ((data && data.leads) || []).slice();
    });
  }

  function exportAllLeads() {
    exportBtn.disabled = true;
    setStatus("Preparing complete lead maintenance file…", false);

    getAllLeads()
      .then(function (leads) {
        leads.sort(sortForMaintenance);
        var rows = [HEADERS.join(",")];
        leads.forEach(function (lead) {
          rows.push([
            lead.leadId,
            lead.companyName,
            lead.siteName,
            lead.mgmtCompanyName,
            lead.contactName,
            lead.contactEmail,
            lead.contactPhone,
            lead.source,
            lead.systemType,
            lead.stage,
            lead.nextFollowUp,
            lead.assignedTo,
            lead.estimatedSavings,
            lead.notes
          ].map(csvEscape).join(","));
        });

        var csv = "\uFEFF" + rows.join("\r\n");
        var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = "NOVARA-All-Leads-Maintenance-" + todayIsoDate() + ".csv";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        setStatus(leads.length + " leads exported. Edit the file in Excel, keep LeadID unchanged, save as CSV, then upload it here.", false);
      })
      .catch(function (err) {
        setStatus(err.message || "Could not export leads.", true);
      })
      .finally(function () {
        exportBtn.disabled = false;
      });
  }

  function parseCsv(input) {
    var rows = [];
    var row = [];
    var field = "";
    var inQuotes = false;
    var i = 0;
    input = text(input).replace(/^\uFEFF/, "");

    while (i < input.length) {
      var ch = input[i];
      if (inQuotes) {
        if (ch === '"') {
          if (input[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i += 1;
          continue;
        }
        field += ch;
        i += 1;
        continue;
      }

      if (ch === '"') {
        inQuotes = true;
        i += 1;
      } else if (ch === ",") {
        row.push(field);
        field = "";
        i += 1;
      } else if (ch === "\r" || ch === "\n") {
        row.push(field);
        field = "";
        rows.push(row);
        row = [];
        if (ch === "\r" && input[i + 1] === "\n") i += 2;
        else i += 1;
      } else {
        field += ch;
        i += 1;
      }
    }

    if (field !== "" || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows.filter(function (r) { return r.some(function (v) { return text(v).trim() !== ""; }); });
  }

  function rowObjects(rows) {
    if (!rows.length) throw new Error("The uploaded CSV is empty.");
    var headers = rows[0].map(function (h) { return text(h).trim(); });
    HEADERS.forEach(function (required) {
      if (headers.indexOf(required) === -1) throw new Error("Missing required column: " + required);
    });

    return rows.slice(1).map(function (row, index) {
      var obj = { __row: index + 2 };
      headers.forEach(function (header, col) {
        obj[header] = row[col] == null ? "" : row[col];
      });
      return obj;
    });
  }

  function normalizePayload(row, existing) {
    var stage = text(row.Stage).trim() || "New Lead";
    if (!STAGES[stage]) throw new Error("Row " + row.__row + ": invalid Stage '" + stage + "'.");
    var next = text(row.NextFollowUp).trim();
    if (next && !/^\d{4}-\d{2}-\d{2}$/.test(next)) {
      throw new Error("Row " + row.__row + ": NextFollowUp must use YYYY-MM-DD.");
    }
    var savings = text(row.EstimatedSavings).trim();
    if (savings && !Number.isFinite(Number(savings))) {
      throw new Error("Row " + row.__row + ": EstimatedSavings must be a number or blank.");
    }

    var payload = {
      LeadID: text(row.LeadID).trim(),
      CompanyName: text(row.CompanyName).trim(),
      ContactName: text(row.ContactName).trim(),
      ContactEmail: text(row.ContactEmail).trim(),
      ContactPhone: text(row.ContactPhone).trim(),
      Source: text(row.Source).trim(),
      SystemType: text(row.SystemType).trim(),
      Stage: stage,
      NextFollowUp: next,
      AssignedTo: text(row.AssignedTo).trim(),
      Notes: text(row.Notes)
    };
    if (savings) payload.EstimatedSavings = Number(savings);

    // Preserve related IDs and names that are not directly editable through the current lead API payload.
    if (existing && existing.siteId) payload.SiteID = existing.siteId;
    if (existing && existing.siteName) payload.SiteName = existing.siteName;
    if (existing && existing.mgmtCompanyId) payload.MgmtCompanyID = existing.mgmtCompanyId;
    if (existing && existing.mgmtCompanyName) payload.MgmtCompanyName = existing.mgmtCompanyName;
    if (existing && existing.ownerId) payload.OwnerID = existing.ownerId;
    return payload;
  }

  function valuesDiffer(row, existing) {
    var comparisons = [
      [row.CompanyName, existing.companyName],
      [row.ContactName, existing.contactName],
      [row.ContactEmail, existing.contactEmail],
      [row.ContactPhone, existing.contactPhone],
      [row.Source, existing.source],
      [row.SystemType, existing.systemType],
      [row.Stage, existing.stage],
      [row.NextFollowUp, existing.nextFollowUp],
      [row.AssignedTo, existing.assignedTo],
      [row.EstimatedSavings, existing.estimatedSavings],
      [row.Notes, existing.notes]
    ];
    return comparisons.some(function (pair) {
      return text(pair[0]).trim() !== text(pair[1]).trim();
    });
  }

  function processInBatches(items, worker, batchSize) {
    var index = 0;
    var results = [];
    batchSize = batchSize || 5;

    function next() {
      if (index >= items.length) return Promise.resolve(results);
      var batch = items.slice(index, index + batchSize);
      index += batchSize;
      return Promise.all(batch.map(function (item) {
        return worker(item)
          .then(function (value) { results.push({ ok: true, item: item, value: value }); })
          .catch(function (error) { results.push({ ok: false, item: item, error: error }); });
      })).then(next);
    }
    return next();
  }

  function uploadRevisedFile(file) {
    if (!file) return;
    if (!/\.csv$/i.test(file.name || "")) {
      setStatus("Please upload the exported CSV file. You can edit it in Excel and Save As CSV before uploading.", true);
      fileInput.value = "";
      return;
    }

    uploadBtn.disabled = true;
    exportBtn.disabled = true;
    setStatus("Checking uploaded lead file…", false);

    Promise.all([file.text(), getAllLeads()])
      .then(function (values) {
        var rows = rowObjects(parseCsv(values[0]));
        var current = values[1];
        var byId = {};
        current.forEach(function (lead) { if (lead && lead.leadId) byId[text(lead.leadId).trim()] = lead; });

        var seen = {};
        var changes = [];
        rows.forEach(function (row) {
          var id = text(row.LeadID).trim();
          if (!id) throw new Error("Row " + row.__row + ": LeadID is required.");
          if (seen[id]) throw new Error("Duplicate LeadID in upload: " + id);
          seen[id] = true;
          if (!byId[id]) throw new Error("Row " + row.__row + ": LeadID " + id + " does not exist. Bulk maintenance only updates existing leads.");
          if (valuesDiffer(row, byId[id])) {
            changes.push({ row: row, existing: byId[id], payload: normalizePayload(row, byId[id]) });
          }
        });

        if (!changes.length) {
          setStatus("Upload checked. No lead changes were found.", false);
          return null;
        }

        var preview = changes.slice(0, 8).map(function (c) {
          return c.payload.LeadID + " — " + (c.payload.CompanyName || c.existing.siteName || "Lead");
        }).join("\n");
        if (changes.length > 8) preview += "\n…plus " + (changes.length - 8) + " more";

        var approved = window.confirm(
          "This file will update " + changes.length + " existing lead" + (changes.length === 1 ? "" : "s") + ".\n\n" +
          preview +
          "\n\nLeadID is used as the permanent key. No new leads will be created. Continue?"
        );
        if (!approved) {
          setStatus("Bulk lead update canceled. No changes were made.", false);
          return null;
        }

        setStatus("Updating " + changes.length + " leads…", false);
        return processInBatches(changes, function (change) {
          return window.NovaraApi.updateLead(change.payload);
        }, 5).then(function (results) {
          var success = results.filter(function (r) { return r.ok; }).length;
          var failed = results.filter(function (r) { return !r.ok; });
          if (failed.length) {
            var ids = failed.slice(0, 5).map(function (r) { return r.item.payload.LeadID; }).join(", ");
            throw new Error(success + " updated; " + failed.length + " failed (" + ids + (failed.length > 5 ? ", …" : "") + "). Review those leads and retry the file.");
          }
          setStatus(success + " leads updated successfully from the uploaded maintenance file.", false);
          document.dispatchEvent(new CustomEvent("novara:lead-saved"));
          return true;
        });
      })
      .catch(function (err) {
        setStatus(err.message || "Could not process the lead maintenance file.", true);
      })
      .finally(function () {
        uploadBtn.disabled = false;
        exportBtn.disabled = false;
        fileInput.value = "";
      });
  }

  exportBtn.addEventListener("click", exportAllLeads);
  uploadBtn.addEventListener("click", function () { fileInput.click(); });
  fileInput.addEventListener("change", function () { uploadRevisedFile(fileInput.files && fileInput.files[0]); });
})();
