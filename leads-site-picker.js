(function () {
  var form = document.getElementById('lead-form');
  if (!form || !window.NovaraApi) return;

  var ownerSel = document.getElementById('field-ownerId');
  var siteSel = document.getElementById('field-siteId');
  var siteNameInput = document.getElementById('field-siteName');
  var mgmtSel = document.getElementById('field-mgmtCompanyId');
  var mgmtNameInput = document.getElementById('field-mgmtCompanyName');
  var siteHint = document.getElementById('lead-site-hint');
  var sitePanel = document.getElementById('lead-new-site-panel');
  var mgmtPanel = document.getElementById('lead-new-mgmt-panel');

  var owners = [];
  var sites = [];
  var mgmt = [];

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function oid(o) { return o && (o.ownerId || o.OwnerID || o.id) || ''; }
  function oname(o) { return o && (o.name || o.ownerName || o.Name) || oid(o); }
  function sid(s) { return s && (s.siteId || s.SiteID || s.id) || ''; }
  function sname(s) { return s && (s.siteName || s.SiteName || s.name || s.Name) || sid(s); }
  function siteOwner(s) { return String(s && (s.ownerId || s.OwnerID || s.owner || s.Owner) || ''); }
  function siteMgmt(s) { return String(s && (s.mgmtCompanyId || s.MgmtCompanyID || s.mgmtCompany || s.MgmtCompany) || ''); }
  function mid(m) { return m && (m.mgmtCompanyId || m.MgmtCompanyID || m.id) || ''; }
  function mname(m) { return m && (m.name || m.mgmtCompanyName || m.Name) || mid(m); }

  function nextSequentialId(list, getId, prefix) {
    var max = 0;
    var re = new RegExp('^' + prefix + '(\\d+)$', 'i');
    list.forEach(function (row) {
      var match = re.exec(String(getId(row) || ''));
      if (match) max = Math.max(max, Number(match[1]) || 0);
    });
    return prefix + String(max + 1).padStart(3, '0');
  }

  function populateOwners() {
    if (!ownerSel) return;
    var current = ownerSel.value;
    ownerSel.innerHTML = '<option value="">Select owner…</option>' + owners.map(function (o) {
      return '<option value="' + esc(oid(o)) + '">' + esc(oname(o)) + '</option>';
    }).join('');
    if (current) ownerSel.value = current;
  }

  function populateMgmt() {
    if (!mgmtSel) return;
    var current = mgmtSel.value;
    mgmtSel.innerHTML = '<option value="">Select management company…</option>' + mgmt.map(function (m) {
      return '<option value="' + esc(mid(m)) + '">' + esc(mname(m)) + '</option>';
    }).join('');
    if (current) mgmtSel.value = current;
    syncMgmtName();
  }

  function populateSites() {
    if (!siteSel) return;
    var current = siteSel.value;
    var ownerId = ownerSel ? String(ownerSel.value || '') : '';
    var list = ownerId ? sites.filter(function (s) { return siteOwner(s) === ownerId; }) : sites.slice();
    siteSel.innerHTML = '<option value="">Select site…</option>' + list.map(function (s) {
      return '<option value="' + esc(sid(s)) + '">' + esc(sname(s)) + '</option>';
    }).join('');
    if (current && list.some(function (s) { return String(sid(s)) === String(current); })) {
      siteSel.value = current;
    } else if (current) {
      siteSel.value = '';
    }
    syncSiteName();
    if (siteHint) {
      siteHint.textContent = list.length
        ? list.length + ' site' + (list.length === 1 ? '' : 's') + ' available.'
        : 'No existing sites found. Click + Add New.';
    }
  }

  function syncSiteName() {
    if (!siteNameInput || !siteSel) return;
    var selected = sites.find(function (s) { return String(sid(s)) === String(siteSel.value); });
    siteNameInput.value = selected ? sname(selected) : '';
    if (selected) {
      var ownerId = siteOwner(selected);
      if (ownerId && ownerSel) ownerSel.value = ownerId;
      var mgmtId = siteMgmt(selected);
      if (mgmtId && mgmtSel) {
        mgmtSel.value = mgmtId;
        syncMgmtName();
      }
    }
  }

  function syncMgmtName() {
    if (!mgmtNameInput || !mgmtSel) return;
    var selected = mgmt.find(function (m) { return String(mid(m)) === String(mgmtSel.value); });
    mgmtNameInput.value = selected ? mname(selected) : '';
  }

  function loadDirectories() {
    return Promise.all([
      NovaraApi.getOwners(),
      NovaraApi.getSites(),
      NovaraApi.getMgmtCompanies()
    ]).then(function (responses) {
      owners = responses[0].owners || [];
      sites = responses[1].sites || [];
      mgmt = responses[2].mgmtCompanies || responses[2].companies || [];
      populateOwners();
      populateMgmt();
      populateSites();
    }).catch(function (err) {
      if (siteHint) siteHint.textContent = 'Could not load Owners/Sites/Management Companies: ' + err.message;
    });
  }

  if (ownerSel) ownerSel.addEventListener('change', populateSites);
  if (siteSel) siteSel.addEventListener('change', syncSiteName);
  if (mgmtSel) mgmtSel.addEventListener('change', syncMgmtName);

  var addSiteBtn = document.getElementById('lead-add-site-btn');
  var cancelSiteBtn = document.getElementById('lead-cancel-new-site');
  var createSiteBtn = document.getElementById('lead-create-site');
  if (addSiteBtn) addSiteBtn.addEventListener('click', function () {
    if (sitePanel) sitePanel.hidden = false;
    var input = document.getElementById('lead-new-site-name');
    if (input) input.focus();
  });
  if (cancelSiteBtn) cancelSiteBtn.addEventListener('click', function () {
    if (sitePanel) sitePanel.hidden = true;
  });
  if (createSiteBtn) createSiteBtn.addEventListener('click', function () {
    var nameEl = document.getElementById('lead-new-site-name');
    var statusEl = document.getElementById('lead-new-site-status');
    var name = nameEl ? nameEl.value.trim() : '';
    if (!name) {
      if (statusEl) statusEl.textContent = 'Site Name is required.';
      if (nameEl) nameEl.focus();
      return;
    }

    var payload = {
      SiteID: nextSequentialId(sites, sid, 'SITE'),
      SiteName: name,
      Owner: ownerSel ? ownerSel.value : '',
      OwnerID: ownerSel ? ownerSel.value : '',
      MgmtCompany: mgmtSel ? mgmtSel.value : '',
      MgmtCompanyID: mgmtSel ? mgmtSel.value : '',
      Address: (document.getElementById('lead-new-site-address') || {}).value || '',
      City: (document.getElementById('lead-new-site-city') || {}).value || '',
      State: (document.getElementById('lead-new-site-state') || {}).value || '',
      Zip: (document.getElementById('lead-new-site-zip') || {}).value || '',
      SystemType: (document.getElementById('field-systemType') || {}).value || '',
      Status: 'Online',
      Systems: 0
    };

    if (statusEl) statusEl.textContent = 'Saving new Site…';
    NovaraApi.createSite(payload)
      .then(function () { return NovaraApi.getSites(); })
      .then(function (response) {
        sites = response.sites || [];
        populateSites();
        if (siteSel) siteSel.value = payload.SiteID;
        syncSiteName();
        if (sitePanel) sitePanel.hidden = true;
        if (statusEl) statusEl.textContent = '';
        if (nameEl) nameEl.value = '';
      })
      .catch(function (err) {
        if (statusEl) statusEl.textContent = err.message || 'Could not create Site.';
      });
  });

  var addMgmtBtn = document.getElementById('lead-add-mgmt-btn');
  var cancelMgmtBtn = document.getElementById('lead-cancel-new-mgmt');
  var createMgmtBtn = document.getElementById('lead-create-mgmt');
  if (addMgmtBtn) addMgmtBtn.addEventListener('click', function () {
    if (mgmtPanel) mgmtPanel.hidden = false;
    var input = document.getElementById('lead-new-mgmt-name');
    if (input) input.focus();
  });
  if (cancelMgmtBtn) cancelMgmtBtn.addEventListener('click', function () {
    if (mgmtPanel) mgmtPanel.hidden = true;
  });
  if (createMgmtBtn) createMgmtBtn.addEventListener('click', function () {
    var nameEl = document.getElementById('lead-new-mgmt-name');
    var statusEl = document.getElementById('lead-new-mgmt-status');
    var name = nameEl ? nameEl.value.trim() : '';
    if (!name) {
      if (statusEl) statusEl.textContent = 'Management Company Name is required.';
      if (nameEl) nameEl.focus();
      return;
    }

    var payload = {
      MgmtCompanyID: nextSequentialId(mgmt, mid, 'MGT'),
      Name: name,
      ContactName: (document.getElementById('lead-new-mgmt-contact') || {}).value || '',
      ContactPhone: (document.getElementById('lead-new-mgmt-phone') || {}).value || '',
      ContactEmail: (document.getElementById('lead-new-mgmt-email') || {}).value || '',
      Address: '',
      City: '',
      State: '',
      Zip: '',
      Notes: ''
    };

    if (statusEl) statusEl.textContent = 'Saving new Management Company…';
    NovaraApi.createMgmtCompany(payload)
      .then(function () { return NovaraApi.getMgmtCompanies(); })
      .then(function (response) {
        mgmt = response.mgmtCompanies || response.companies || [];
        populateMgmt();
        if (mgmtSel) mgmtSel.value = payload.MgmtCompanyID;
        syncMgmtName();
        if (mgmtPanel) mgmtPanel.hidden = true;
        if (statusEl) statusEl.textContent = '';
        if (nameEl) nameEl.value = '';
      })
      .catch(function (err) {
        if (statusEl) statusEl.textContent = err.message || 'Could not create Management Company.';
      });
  });

  var originalCreate = NovaraApi.createLead;
  var originalUpdate = NovaraApi.updateLead;

  function addRelationshipFields(payload) {
    payload = payload || {};
    var selectedSite = sites.find(function (s) { return siteSel && String(sid(s)) === String(siteSel.value); });
    var selectedOwner = owners.find(function (o) { return ownerSel && String(oid(o)) === String(ownerSel.value); });
    var selectedMgmt = mgmt.find(function (m) { return mgmtSel && String(mid(m)) === String(mgmtSel.value); });

    if (selectedSite) {
      payload.SiteID = sid(selectedSite);
      payload.SiteName = sname(selectedSite);
    } else {
      payload.SiteID = '';
      payload.SiteName = '';
    }
    if (selectedOwner) {
      payload.OwnerID = oid(selectedOwner);
      payload.OwnerName = oname(selectedOwner);
    }
    if (selectedMgmt) {
      payload.MgmtCompanyID = mid(selectedMgmt);
      payload.MgmtCompanyName = mname(selectedMgmt);
    }
    return payload;
  }

  NovaraApi.createLead = function (payload) {
    return originalCreate(addRelationshipFields(payload));
  };
  NovaraApi.updateLead = function (payload) {
    return originalUpdate(addRelationshipFields(payload));
  };

  var modal = document.getElementById('lead-modal');
  function syncEditSelection() {
    var leadIdEl = document.getElementById('field-leadId');
    var leadId = leadIdEl ? String(leadIdEl.value || '') : '';
    if (!leadId || !window.NovaraApi || typeof NovaraApi.getLeads !== 'function') return;
    NovaraApi.getLeads().then(function (response) {
      var rows = response.leads || [];
      var lead = rows.find(function (row) { return String(row.leadId || row.LeadID || '') === leadId; });
      if (!lead) return;
      var ownerId = lead.ownerId || lead.OwnerID || '';
      var siteId = lead.siteId || lead.SiteID || '';
      var mgmtId = lead.mgmtCompanyId || lead.MgmtCompanyID || '';
      if (ownerId && ownerSel) ownerSel.value = ownerId;
      populateSites();
      if (siteId && siteSel) siteSel.value = siteId;
      syncSiteName();
      if (mgmtId && mgmtSel) mgmtSel.value = mgmtId;
      syncMgmtName();
    }).catch(function () {});
  }

  if (modal) {
    new MutationObserver(function () {
      if (!modal.hidden) setTimeout(syncEditSelection, 0);
    }).observe(modal, { attributes: true, attributeFilter: ['hidden'] });
  }

  loadDirectories();
})();
