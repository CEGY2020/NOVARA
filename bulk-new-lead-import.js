(function () {
  "use strict";

  var importBtn = document.getElementById("import-new-leads-btn");
  var fileInput = document.getElementById("new-leads-file");
  var statusEl = document.getElementById("bulk-leads-status");
  if (!importBtn || !fileInput) return;

  function text(value) { return value == null ? "" : String(value).trim(); }
  function setStatus(message, isError) {
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.classList.toggle("is-error", Boolean(isError));
  }
  function norm(value) {
    return text(value).toLowerCase().replace(/&amp;/g, "&").replace(/[^a-z0-9]+/g, " ").trim();
  }
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
      script.onload = function () { window.XLSX ? resolve(window.XLSX) : reject(new Error("Spreadsheet reader did not load.")); };
      script.onerror = function () { reject(new Error("Could not load spreadsheet reader. Check your internet connection.")); };
      document.head.appendChild(script);
    });
  }
  function readRows(file) {
    return Promise.all([loadXlsx(), file.arrayBuffer()]).then(function (values) {
      var XLSX = values[0];
      var book = XLSX.read(values[1], { type: "array" });
      var sheetName = book.SheetNames.indexOf("SCG Customers") >= 0 ? "SCG Customers" : book.SheetNames[0];
      if (!sheetName) throw new Error("No worksheet was found in the uploaded file.");
      return XLSX.utils.sheet_to_json(book.Sheets[sheetName], { defval: "", raw: false });
    });
  }
  function splitContact(raw) {
    var value = text(raw);
    var match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    var email = match ? match[0] : "";
    var name = value;
    if (email) name = value.replace(email, "").replace(/^[,;\s]+|[,;\s]+$/g, "");
    return { name: name, email: email };
  }
  function maxLeadNumber(leads) {
    var max = 0;
    (leads || []).forEach(function (lead) {
      var m = /^LD(\d+)$/i.exec(text(lead && lead.leadId));
      if (m) max = Math.max(max, Number(m[1]) || 0);
    });
    return max;
  }
  function nextLeadId(number) {
    return "LD" + String(number).padStart(Math.max(3, String(number).length), "0");
  }
  function existingKeys(leads) {
    var customerNumbers = {};
    var siteCity = {};
    (leads || []).forEach(function (lead) {
      var customerNumber = text(lead && lead.externalCustomerNumber);
      if (customerNumber) customerNumbers[customerNumber] = true;
      var key = norm(lead && lead.siteName) + "|" + norm(lead && lead.city);
      if (key !== "|") siteCity[key] = true;
    });
    return { customerNumbers: customerNumbers, siteCity: siteCity };
  }
  function buildPayload(row, leadId) {
    var siteName = text(row["Customer Name"] || row.CustomerName);
    var companyName = text(row["Customer Name2"] || row.CustomerName2) || siteName;
    var customerNumber = text(row["Customer Number"] || row.CustomerNumber);
    var address = text(row["Customer Address"] || row.CustomerAddress);
    var city = text(row.City);
    var state = text(row.State) || "CA";
    var phone = text(row.Phone);
    var contact = splitContact(row.Contact);
    var customerType = text(row["Customer Type"] || row.CustomerType);
    var notes = [
      "Imported from SCG customer list.",
      customerNumber ? "Customer Number: " + customerNumber + "." : "",
      address ? "Address: " + address + (city ? ", " + city : "") + (state ? ", " + state : "") + "." : "",
      customerType ? "Customer Type: " + customerType + "." : ""
    ].filter(Boolean).join(" ");

    return {
      LeadID: leadId,
      CompanyName: companyName,
      SiteName: siteName,
      ContactName: contact.name,
      ContactEmail: contact.email,
      ContactPhone: phone,
      Source: "Other",
      SystemType: "Pool",
      Stage: "New Lead",
      NextFollowUp: "",
      AssignedTo: "",
      Notes: notes,
      ExternalCustomerNumber: customerNumber,
      SiteAddress: address,
      City: city,
      State: state,
      ImportSource: "SCG Customer List",
      CustomerType: customerType
    };
  }
  function processBatches(items, worker, batchSize) {
    var index = 0, results = [];
    function next() {
      if (index >= items.length) return Promise.resolve(results);
      var batch = items.slice(index, index + batchSize);
      index += batchSize;
      return Promise.all(batch.map(function (item) {
        return worker(item).then(function (value) {
          results.push({ ok: true, item: item, value: value });
        }).catch(function (error) {
          results.push({ ok: false, item: item, error: error });
        });
      })).then(next);
    }
    return next();
  }
  function importFile(file) {
    if (!file) return;
    importBtn.disabled = true;
    setStatus("Reading customer list…", false);

    Promise.all([readRows(file), window.NovaraApi.getLeads()])
      .then(function (values) {
        var rows = values[0] || [];
        var leads = (values[1] && values[1].leads) || [];
        if (!rows.length) throw new Error("The uploaded spreadsheet contains no customer rows.");

        var keys = existingKeys(leads);
        var max = maxLeadNumber(leads);
        var newRows = [];
        var skipped = [];
        var seenCustomerNumbers = {};
        var seenSiteCity = {};

        rows.forEach(function (row, idx) {
          var siteName = text(row["Customer Name"] || row.CustomerName);
          if (!siteName) return;
          var customerNumber = text(row["Customer Number"] || row.CustomerNumber);
          var city = text(row.City);
          var siteKey = norm(siteName) + "|" + norm(city);
          var duplicate = false;
          if (customerNumber && (keys.customerNumbers[customerNumber] || seenCustomerNumbers[customerNumber])) duplicate = true;
          if (!duplicate && siteKey !== "|" && (keys.siteCity[siteKey] || seenSiteCity[siteKey])) duplicate = true;
          if (duplicate) {
            skipped.push(siteName);
            return;
          }
          if (customerNumber) seenCustomerNumbers[customerNumber] = true;
          if (siteKey !== "|") seenSiteCity[siteKey] = true;
          max += 1;
          newRows.push(buildPayload(row, nextLeadId(max)));
        });

        if (!newRows.length) {
          setStatus("No new customers to import. " + skipped.length + " matching record(s) were skipped as duplicates.", false);
          return null;
        }

        var approved = window.confirm(
          "Import " + newRows.length + " new SCG pool customer lead" + (newRows.length === 1 ? "" : "s") + " into NOVARA?\n\n" +
          skipped.length + " possible duplicate" + (skipped.length === 1 ? "" : "s") + " will be skipped.\n\n" +
          "The import will create New Lead records with System Type = Pool."
        );
        if (!approved) {
          setStatus("Import canceled. No customer records were added.", false);
          return null;
        }

        setStatus("Importing " + newRows.length + " customers…", false);
        return processBatches(newRows, function (payload) {
          return window.NovaraApi.createLead(payload);
        }, 5).then(function (results) {
          var successes = results.filter(function (r) { return r.ok; });
          var failures = results.filter(function (r) { return !r.ok; });
          if (failures.length) {
            var ids = failures.slice(0, 5).map(function (r) { return r.item.LeadID; }).join(", ");
            throw new Error(successes.length + " imported; " + failures.length + " failed (" + ids + (failures.length > 5 ? ", …" : "") + ").");
          }
          setStatus(successes.length + " SCG customer leads imported successfully. " + skipped.length + " duplicate(s) skipped.", false);
          document.dispatchEvent(new CustomEvent("novara:lead-saved"));
          return true;
        });
      })
      .catch(function (err) {
        setStatus(err.message || "Could not import the customer list.", true);
      })
      .finally(function () {
        importBtn.disabled = false;
        fileInput.value = "";
      });
  }

  importBtn.addEventListener("click", function () { fileInput.click(); });
  fileInput.addEventListener("change", function () { importFile(fileInput.files && fileInput.files[0]); });
})();
