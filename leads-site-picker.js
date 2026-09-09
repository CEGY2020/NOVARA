(function(){
  var form=document.getElementById('lead-form');
  var company=document.getElementById('field-companyName');
  if(!form||!company||!window.NovaraApi)return;
  var companyLabel=company.closest('.form-field');
  var grid=companyLabel&&companyLabel.parentNode;
  if(!companyLabel||!grid)return;

  var owners=[],sites=[],mgmt=[];
  var ownerField=document.createElement('label');
  ownerField.className='form-field';
  ownerField.innerHTML='<span>Owner</span><select id="field-ownerId"><option value="">Select owner…</option></select><small class="field-hint">Choose the owner first. The Site list will then show only that owner\'s properties.</small>';
  grid.insertBefore(ownerField,companyLabel);

  companyLabel.innerHTML='<span>Site / Property <em>*</em></span><div style="display:flex;gap:8px;align-items:center"><select id="field-siteId" style="flex:1"><option value="">Select owner first…</option></select><button type="button" class="secondary-btn" id="lead-add-site-btn" style="white-space:nowrap">+ Add New</button></div><input type="hidden" id="field-companyName" name="CompanyName" required><small class="field-hint" id="lead-site-hint">Select an owner, then choose an existing site or add a new one.</small>';
  company=document.getElementById('field-companyName');

  var newSite=document.createElement('div');
  newSite.id='lead-new-site-panel';
  newSite.className='form-field form-field-wide';
  newSite.hidden=true;
  newSite.innerHTML='<div style="border:1px solid #d8e1ea;border-radius:10px;padding:14px;background:#f8fbfd"><strong>Add New Site</strong><div class="form-grid" style="margin-top:12px"><label class="form-field"><span>Site Name <em>*</em></span><input id="lead-new-site-name" maxlength="160"></label><label class="form-field"><span>Management Company</span><select id="lead-new-site-mgmt"><option value="">Select…</option></select></label><label class="form-field form-field-wide"><span>Address</span><input id="lead-new-site-address" maxlength="180"></label><label class="form-field"><span>City</span><input id="lead-new-site-city" maxlength="100"></label><label class="form-field"><span>State</span><input id="lead-new-site-state" maxlength="40"></label><label class="form-field"><span>ZIP</span><input id="lead-new-site-zip" maxlength="20"></label></div><div style="display:flex;gap:8px;margin-top:10px"><button type="button" class="primary-btn" id="lead-create-site">Save New Site</button><button type="button" class="secondary-btn" id="lead-cancel-new-site">Cancel</button></div><p id="lead-new-site-status" class="field-hint"></p></div>';
  grid.insertBefore(newSite,companyLabel.nextSibling);

  var ownerSel=document.getElementById('field-ownerId');
  var siteSel=document.getElementById('field-siteId');
  var hint=document.getElementById('lead-site-hint');
  function esc(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
  function oid(o){return o&&(o.ownerId||o.OwnerID||o.id)||''}
  function oname(o){return o&&(o.name||o.ownerName||o.Name)||oid(o)}
  function sid(s){return s&&(s.siteId||s.SiteID||s.id)||''}
  function sname(s){return s&&(s.siteName||s.SiteName||s.name||s.Name)||sid(s)}
  function siteOwner(s){return String((s&&(s.ownerId||s.OwnerID||s.owner||s.Owner))||'')}
  function mid(m){return m&&(m.mgmtCompanyId||m.MgmtCompanyID||m.id)||''}
  function mname(m){return m&&(m.name||m.mgmtCompanyName||m.Name)||mid(m)}
  function populateOwners(){ownerSel.innerHTML='<option value="">Select owner…</option>'+owners.map(function(o){return '<option value="'+esc(oid(o))+'">'+esc(oname(o))+'</option>'}).join('')}
  function populateMgmt(){var s=document.getElementById('lead-new-site-mgmt');s.innerHTML='<option value="">Select…</option>'+mgmt.map(function(m){return '<option value="'+esc(mid(m))+'">'+esc(mname(m))+'</option>'}).join('')}
  function filterSites(){var id=ownerSel.value;var list=id?sites.filter(function(s){return siteOwner(s)===id}):[];siteSel.innerHTML=id?'<option value="">Select site…</option>':'<option value="">Select owner first…</option>';siteSel.innerHTML+=list.map(function(s){return '<option value="'+esc(sid(s))+'">'+esc(sname(s))+'</option>'}).join('');siteSel.disabled=!id;company.value='';hint.textContent=!id?'Select an owner first.':(list.length?list.length+' site'+(list.length===1?'':'s')+' available for this owner.':'No existing sites for this owner. Click + Add New.')}
  function chooseSite(){var s=sites.find(function(x){return String(sid(x))===String(siteSel.value)});company.value=s?sname(s):'';if(s)hint.textContent='Selected '+sname(s)+' ('+sid(s)+').'}
  function nextSiteId(){var max=0;sites.forEach(function(s){var m=/^SITE(\d+)$/i.exec(sid(s));if(m)max=Math.max(max,Number(m[1])||0)});return 'SITE'+String(max+1).padStart(3,'0')}
  function loadDirs(){return Promise.all([NovaraApi.getOwners(),NovaraApi.getSites(),NovaraApi.getMgmtCompanies()]).then(function(r){owners=r[0].owners||[];sites=r[1].sites||[];mgmt=r[2].mgmtCompanies||r[2].companies||[];populateOwners();populateMgmt();syncEditLead()}).catch(function(e){hint.textContent='Could not load Owners/Sites: '+e.message})}
  function syncEditLead(){var currentName=String(company.value||'').trim();if(!currentName)return;var s=sites.find(function(x){return sname(x).trim().toLowerCase()===currentName.toLowerCase()});if(!s)return;ownerSel.value=siteOwner(s);filterSites();siteSel.value=sid(s);chooseSite()}
  ownerSel.addEventListener('change',filterSites);
  siteSel.addEventListener('change',chooseSite);
  document.getElementById('lead-add-site-btn').onclick=function(){if(!ownerSel.value){hint.textContent='Select the Owner before adding a new Site.';ownerSel.focus();return}newSite.hidden=false;document.getElementById('lead-new-site-name').focus()};
  document.getElementById('lead-cancel-new-site').onclick=function(){newSite.hidden=true};
  document.getElementById('lead-create-site').onclick=function(){var name=document.getElementById('lead-new-site-name').value.trim(),st=document.getElementById('lead-new-site-status');if(!name){st.textContent='Site Name is required.';return}var payload={SiteID:nextSiteId(),SiteName:name,Owner:ownerSel.value,OwnerID:ownerSel.value,MgmtCompany:document.getElementById('lead-new-site-mgmt').value,Address:document.getElementById('lead-new-site-address').value.trim(),City:document.getElementById('lead-new-site-city').value.trim(),State:document.getElementById('lead-new-site-state').value.trim(),Zip:document.getElementById('lead-new-site-zip').value.trim(),SystemType:document.getElementById('field-systemType').value||'',Status:'Online',Systems:0};st.textContent='Saving new Site…';NovaraApi.createSite(payload).then(function(){st.textContent='Site created.';return NovaraApi.getSites()}).then(function(r){sites=r.sites||[];filterSites();siteSel.value=payload.SiteID;chooseSite();newSite.hidden=true}).catch(function(e){st.textContent=e.message})};

  var originalCreate=NovaraApi.createLead,originalUpdate=NovaraApi.updateLead;
  function addLinks(p){p=p||{};var s=sites.find(function(x){return String(sid(x))===String(siteSel.value)});var o=owners.find(function(x){return String(oid(x))===String(ownerSel.value)});if(s){p.SiteID=sid(s);p.CompanyName=sname(s)}if(o){p.OwnerID=oid(o);p.OwnerName=oname(o)}return p}
  NovaraApi.createLead=function(p){return originalCreate(addLinks(p))};
  NovaraApi.updateLead=function(p){return originalUpdate(addLinks(p))};

  var modal=document.getElementById('lead-modal');
  if(modal){new MutationObserver(function(){if(!modal.hidden){setTimeout(function(){var nm=String(company.value||'').trim();if(nm){var s=sites.find(function(x){return sname(x).trim().toLowerCase()===nm.toLowerCase()});if(s){ownerSel.value=siteOwner(s);filterSites();siteSel.value=sid(s);chooseSite()}}else{ownerSel.value='';filterSites()}},0)}}).observe(modal,{attributes:true,attributeFilter:['hidden']})}
  loadDirs();
})();