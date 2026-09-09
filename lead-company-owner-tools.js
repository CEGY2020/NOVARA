(function () {
  "use strict";

  var form = document.getElementById("lead-form");
  var companyInput = document.getElementById("field-companyName");
  var ownerSel = document.getElementById("field-ownerId");
  if (!form || !companyInput || !ownerSel || !window.NovaraApi) return;

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function oid(o) { return o && (o.ownerId || o.OwnerID || o.id) || ""; }
  function oname(o) { return o && (o.name || o.ownerName || o.Name) || oid(o); }

  function nextOwnerId(owners) {
    var max = 0;
    (owners || []).forEach(function (o) {
      var m = /^OWN(?:ER)?(\d+)$/i.exec(String(oid(o) || ""));
      if (m) max = Math.max(max, Number(m[1]) || 0);
    });
    return "OWN" + String(max + 1).padStart(3, "0");
  }

  /* COMPANY NAME: make the existing field a real lookup/autocomplete while
     preserving the same field ID/value expected by leads.js. */
  var companyList = document.createElement("datalist");
  companyList.id = "lead-company-options";
  companyInput.setAttribute("list", companyList.id);
  companyInput.setAttribute("autocomplete", "off");
  companyInput.parentNode.appendChild(companyList);

  var companyWrap = document.createElement("div");
  companyWrap.className = "inline-picker-row";
  companyInput.parentNode.insertBefore(companyWrap, companyInput);
  companyWrap.appendChild(companyInput);

  var addCompanyBtn = document.createElement("button");
  addCompanyBtn.type = "button";
  addCompanyBtn.className = "secondary-btn inline-add-btn";
  addCompanyBtn.id = "lead-add-company-btn";
  addCompanyBtn.textContent = "+ Add New";
  companyWrap.appendChild(addCompanyBtn);

  var companyHint = document.createElement("small");
  companyHint.className = "field-hint";
  companyHint.id = "lead-company-hint";
  companyHint.textContent = "Type to look up an existing company, or click + Add New.";
  companyInput.parentNode.appendChild(companyHint);

  function loadCompanies() {
    if (typeof NovaraApi.getLeads !== "function") return;
    NovaraApi.getLeads().then(function (response) {
      var seen = {};
      var names = [];
      (response.leads || []).forEach(function (lead) {
        var name = String(lead.companyName || lead.CompanyName || "").trim();
        if (!name) return;
        var key = name.toLowerCase();
        if (seen[key]) return;
        seen[key] = true;
        names.push(name);
      });
      names.sort(function (a, b) { return a.localeCompare(b); });
      companyList.innerHTML = names.map(function (name) {
        return '<option value="' + esc(name) + '"></option>';
      }).join("");
      companyHint.textContent = names.length
        ? names.length + " existing compan" + (names.length === 1 ? "y" : "ies") + " available. Type to search or click + Add New."
        : "No existing companies yet. Click + Add New and type the company name.";
    }).catch(function () {
      companyHint.textContent = "Type a company name, or click + Add New.";
    });
  }

  addCompanyBtn.addEventListener("click", function () {
    companyInput.value = "";
    companyInput.removeAttribute("list");
    companyHint.textContent = "Enter the new company name. It will be available in the lookup after this lead is saved.";
    companyInput.focus();
  });
  companyInput.addEventListener("blur", function () {
    if (!companyInput.hasAttribute("list")) companyInput.setAttribute("list", companyList.id);
  });

  /* OWNER: add + Add New beside the existing owner lookup and create a real
     NOVARAOwner record without leaving the Add Lead form. */
  var ownerWrap = document.createElement("div");
  ownerWrap.className = "inline-picker-row";
  ownerSel.parentNode.insertBefore(ownerWrap, ownerSel);
  ownerWrap.appendChild(ownerSel);

  var addOwnerBtn = document.createElement("button");
  addOwnerBtn.type = "button";
  addOwnerBtn.className = "secondary-btn inline-add-btn";
  addOwnerBtn.id = "lead-add-owner-btn";
  addOwnerBtn.textContent = "+ Add New";
  ownerWrap.appendChild(addOwnerBtn);

  var ownerPanel = document.createElement("div");
  ownerPanel.id = "lead-new-owner-panel";
  ownerPanel.className = "inline-create-panel";
  ownerPanel.hidden = true;
  ownerPanel.innerHTML =
    '<strong>Add New Owner</strong>' +
    '<div class="form-grid" style="margin-top:12px">' +
      '<label class="form-field"><span>Owner Name <em>*</em></span><input id="lead-new-owner-name" maxlength="120"></label>' +
      '<label class="form-field"><span>Contact Name</span><input id="lead-new-owner-contact" maxlength="120"></label>' +
      '<label class="form-field"><span>Phone</span><input id="lead-new-owner-phone" maxlength="40"></label>' +
      '<label class="form-field"><span>Email</span><input id="lead-new-owner-email" type="email" maxlength="160"></label>' +
      '<label class="form-field"><span>Address</span><input id="lead-new-owner-address" maxlength="180"></label>' +
      '<label class="form-field"><span>City</span><input id="lead-new-owner-city" maxlength="100"></label>' +
      '<label class="form-field"><span>State</span><input id="lead-new-owner-state" maxlength="40"></label>' +
      '<label class="form-field"><span>ZIP</span><input id="lead-new-owner-zip" maxlength="20"></label>' +
    '</div>' +
    '<div class="inline-create-actions"><button type="button" class="primary-btn" id="lead-create-owner">Save New Owner</button><button type="button" class="secondary-btn" id="lead-cancel-new-owner">Cancel</button></div>' +
    '<p id="lead-new-owner-status" class="field-hint" aria-live="polite"></p>';
  ownerSel.parentNode.appendChild(ownerPanel);

  var owners = [];

  function refreshOwners(selectId) {
    return NovaraApi.getOwners().then(function (response) {
      owners = response.owners || [];
      var current = selectId || ownerSel.value;
      ownerSel.innerHTML = '<option value="">Select owner…</option>' + owners.map(function (o) {
        return '<option value="' + esc(oid(o)) + '">' + esc(oname(o)) + '</option>';
      }).join("");
      if (current) ownerSel.value = current;
      ownerSel.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  addOwnerBtn.addEventListener("click", function () {
    ownerPanel.hidden = false;
    var input = document.getElementById("lead-new-owner-name");
    if (input) input.focus();
  });

  document.getElementById("lead-cancel-new-owner").addEventListener("click", function () {
    ownerPanel.hidden = true;
  });

  document.getElementById("lead-create-owner").addEventListener("click", function () {
    var nameEl = document.getElementById("lead-new-owner-name");
    var statusEl = document.getElementById("lead-new-owner-status");
    var name = nameEl ? nameEl.value.trim() : "";
    if (!name) {
      statusEl.textContent = "Owner Name is required.";
      if (nameEl) nameEl.focus();
      return;
    }

    var ownerId = nextOwnerId(owners);
    var payload = {
      OwnerID: ownerId,
      Name: name,
      ContactName: (document.getElementById("lead-new-owner-contact") || {}).value || "",
      ContactPhone: (document.getElementById("lead-new-owner-phone") || {}).value || "",
      ContactEmail: (document.getElementById("lead-new-owner-email") || {}).value || "",
      Address: (document.getElementById("lead-new-owner-address") || {}).value || "",
      City: (document.getElementById("lead-new-owner-city") || {}).value || "",
      State: (document.getElementById("lead-new-owner-state") || {}).value || "",
      Zip: (document.getElementById("lead-new-owner-zip") || {}).value || "",
      Status: "Active",
      Notes: ""
    };

    statusEl.textContent = "Saving new Owner…";
    NovaraApi.createOwner(payload)
      .then(function () { return refreshOwners(ownerId); })
      .then(function () {
        ownerPanel.hidden = true;
        statusEl.textContent = "";
        ["lead-new-owner-name","lead-new-owner-contact","lead-new-owner-phone","lead-new-owner-email","lead-new-owner-address","lead-new-owner-city","lead-new-owner-state","lead-new-owner-zip"].forEach(function (id) {
          var el = document.getElementById(id); if (el) el.value = "";
        });
      })
      .catch(function (err) {
        statusEl.textContent = err.message || "Could not create Owner.";
      });
  });

  loadCompanies();
  refreshOwners().catch(function () {});
})();
