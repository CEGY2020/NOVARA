(function () {
  "use strict";

  var state = { companies: null, sites: null, contacts: null };

  function $(id) { return document.getElementById(id); }
  function text(v) { return v == null ? "" : String(v).trim(); }
  function norm(v) { return text(v).toLowerCase().replace(/&amp;/g, "&").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim(); }
  function yes(v) { return /^(yes|y|true|1)$/i.test(text(v)); }
  function setStatus(id, msg, error) {
    var el = $(id); if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("is-error", Boolean(error));
  }
  function escapeHtml(v) {
    return text(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#39;");
  }
  function parseCsv(input) {
    var rows=[], row=[], field="", quotes=false, i=0;
    input = String(input || "").replace(/^\uFEFF/, "");
    while (i < input.length) {
      var ch=input[i];
      if (quotes) {
        if (ch==='\"' && input[i+1]==='\"') { field+='\"'; i+=2; continue; }
        if (ch==='\"') { quotes=false; i++; continue; }
        field+=ch; i++; continue;
      }
      if (ch==='\"') { quotes=true; i++; }
      else if (ch===',') { row.push(field); field=""; i++; }
      else if (ch==='\r' || ch==='\n') { row.push(field); field=""; rows.push(row); row=[]; if(ch==='\r'&&input[i+1]==='\n') i+=2; else i++; }
      else { field+=ch; i++; }
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function(r){ return r.some(function(v){ return text(v)!==""; }); });
  }
  function objects(rows) {
    if (!rows.length) return [];
    var headers=rows[0].map(text);
    return rows.slice(1).map(function(row){ var o={}; headers.forEach(function(h,i){ o[h]=row[i]==null?"":row[i]; }); return o; });
  }
  function loadCsv(file) { return file.text().then(function(t){ return objects(parseCsv(t)); }); }
  function tablePreview(rows, columns) {
    if (!rows.length) return "<p>No rows found.</p>";
    var shown=rows.slice(0,10);
    var html='<table class="data-table"><thead><tr>'+columns.map(function(c){return '<th>'+escapeHtml(c)+'</th>';}).join('')+'</tr></thead><tbody>';
    shown.forEach(function(r){ html+='<tr>'+columns.map(function(c){return '<td>'+escapeHtml(r[c])+'</td>';}).join('')+'</tr>'; });
    html+='</tbody></table>';
    if(rows.length>10) html+='<p class="muted">Showing 10 of '+rows.length+' rows.</p>';
    return html;
  }
  function processSequential(items, worker) {
    var results=[], chain=Promise.resolve();
    items.forEach(function(item){ chain=chain.then(function(){ return worker(item).then(function(v){results.push({ok:true,item:item,value:v});}).catch(function(e){results.push({ok:false,item:item,error:e});}); }); });
    return chain.then(function(){return results;});
  }
  function summarize(results) {
    var created=0, skipped=0, failed=0;
    results.forEach(function(r){
      if(!r.ok) failed++;
      else if(r.value&&r.value.skipped) skipped++;
      else created++;
    });
    return {created:created,skipped:skipped,failed:failed};
  }
  function siteIdentity(r) {
    var explicit=norm(r.SiteKey||r.siteKey);
    if(explicit) return explicit;
    return norm(r.SiteName)+'|'+norm(r.Address)+'|'+norm(r.City);
  }
  function programsFromFlags(r) {
    var out=[];
    if(yes(r.ProgramPool)) out.push('Pool');
    if(yes(r.ProgramDHW)) out.push('DHW');
    if(yes(r.ProgramHVAC)) out.push('HVAC');
    if(yes(r.ProgramRestaurant)) out.push('Restaurant');
    if(yes(r.ProgramOther)) out.push('Other');
    return out.join(', ');
  }

  function previewCompanies() {
    var file=$('companies-file').files&&$('companies-file').files[0];
    if(!file){setStatus('companies-status','Choose the Companies Import CSV first.',true);return;}
    loadCsv(file).then(function(rows){
      var invalid=rows.filter(function(r){return !text(r.CompanyID)||!text(r.MasterID)||!text(r.CompanyName);});
      state.companies={rows:rows,invalid:invalid};
      $('companies-preview').innerHTML=tablePreview(rows,['MasterID','CompanyID','CompanyName','RelationshipType','ProgramPool','ProgramDHW','ProgramHVAC','NeedsReview']);
      $('companies-import-btn').disabled=!rows.length||invalid.length>0;
      setStatus('companies-status',rows.length+' company rows loaded; '+invalid.length+' missing required IDs/names. OMC - Review rows are allowed and stay flagged for later classification.',Boolean(invalid.length));
    }).catch(function(e){setStatus('companies-status',e.message||'Could not read CSV.',true);});
  }

  function importCompanies() {
    if(!state.companies||!state.companies.rows.length)return;
    var api=window.NovaraApi;
    if(!api){setStatus('companies-status','NOVARA API unavailable.',true);return;}
    $('companies-import-btn').disabled=true;
    setStatus('companies-status','Checking permanent company master data…',false);
    api.getMasterCompanies().then(function(payload){
      var existing=(payload&&payload.companies)||[];
      var byId={}, byName={};
      existing.forEach(function(x){byId[text(x.CompanyID||x.companyId)]=x;byName[norm(x.CompanyName||x.companyName)]=x;});
      return processSequential(state.companies.rows,function(r){
        var id=text(r.CompanyID), name=text(r.CompanyName);
        if(byId[id]||byName[norm(name)]) return Promise.resolve({skipped:true});
        byId[id]=r; byName[norm(name)]=r;
        return api.createMasterCompany({
          MasterID:text(r.MasterID),CompanyID:id,CompanyName:name,RelationshipType:text(r.RelationshipType||r['Relationship Type']),
          ProgramPool:text(r.ProgramPool),ProgramDHW:text(r.ProgramDHW),ProgramHVAC:text(r.ProgramHVAC),ProgramRestaurant:text(r.ProgramRestaurant),ProgramOther:text(r.ProgramOther),
          ExampleSite:text(r.ExampleSite),ImportAsLead:'NO',NeedsReview:text(r.NeedsReview),ReviewReason:text(r.ReviewReason)
        });
      });
    }).then(function(results){
      var s=summarize(results);
      setStatus('companies-status',s.created+' companies added; '+s.skipped+' existing matches skipped; '+s.failed+' failed. No Leads were created.',Boolean(s.failed));
    }).catch(function(e){setStatus('companies-status',e.message||'Company import failed.',true);}).finally(function(){$('companies-import-btn').disabled=false;});
  }

  function previewSites() {
    var file=$('sites-file').files&&$('sites-file').files[0];
    if(!file){setStatus('sites-status','Choose the Sites Import CSV first.',true);return;}
    loadCsv(file).then(function(rows){
      var invalid=rows.filter(function(r){return !text(r.SiteID)||!text(r.MasterID)||!text(r.SiteName);});
      state.sites={rows:rows,invalid:invalid};
      $('sites-preview').innerHTML=tablePreview(rows,['MasterID','SiteID','CompanyID','SiteName','Address','City','ProgramPool','ProgramDHW','ProgramHVAC','NeedsReview']);
      $('sites-import-btn').disabled=!rows.length||invalid.length>0;
      setStatus('sites-status',rows.length+' site rows loaded; '+invalid.length+' missing required IDs/names. Review rows may be loaded for lookup and remain flagged.',Boolean(invalid.length));
    }).catch(function(e){setStatus('sites-status',e.message||'Could not read CSV.',true);});
  }

  function importSites() {
    if(!state.sites||!state.sites.rows.length)return;
    var api=window.NovaraApi;
    if(!api){setStatus('sites-status','NOVARA API unavailable.',true);return;}
    $('sites-import-btn').disabled=true;
    setStatus('sites-status','Checking existing site IDs and site keys…',false);
    api.getMasterSites().then(function(payload){
      var existing=(payload&&payload.sites)||[];
      var byId={}, byKey={};
      existing.forEach(function(x){var id=text(x.SiteID||x.siteId);if(id)byId[id]=x;var k=siteIdentity(x);if(k)byKey[k]=x;});
      return processSequential(state.sites.rows,function(r){
        var id=text(r.SiteID), key=siteIdentity(r);
        if(byId[id]||byKey[key]) return Promise.resolve({skipped:true});
        byId[id]=r; if(key)byKey[key]=r;
        return api.createMasterSite({
          MasterID:text(r.MasterID),SiteID:id,CompanyID:text(r.CompanyID),SiteKey:text(r.SiteKey),SiteName:text(r.SiteName),Address:text(r.Address),City:text(r.City),State:text(r.State),Zip:text(r.Zip),Phone:text(r.Phone),CustomerNumber:text(r.CustomerNumber),
          ProgramPool:text(r.ProgramPool),ProgramDHW:text(r.ProgramDHW),ProgramHVAC:text(r.ProgramHVAC),ProgramRestaurant:text(r.ProgramRestaurant),ProgramOther:text(r.ProgramOther),
          RelatedCompany:text(r.RelatedCompany),SourceCount:text(r.SourceCount),SourceRefs:text(r.SourceRefs),ImportAsLead:'NO',NeedsReview:text(r.NeedsReview),ReviewReason:text(r.ReviewReason),Status:yes(r.NeedsReview)?'Needs Review':'Offline'
        });
      });
    }).then(function(results){
      var s=summarize(results);
      setStatus('sites-status',s.created+' sites added; '+s.skipped+' existing matches skipped; '+s.failed+' failed. No Leads were created.',Boolean(s.failed));
    }).catch(function(e){setStatus('sites-status',e.message||'Site import failed.',true);}).finally(function(){$('sites-import-btn').disabled=false;});
  }

  function previewContacts() {
    var file=$('contacts-file').files&&$('contacts-file').files[0];
    if(!file){setStatus('contacts-status','Choose the Contacts Import CSV first.',true);return;}
    loadCsv(file).then(function(rows){
      var invalid=rows.filter(function(r){return !text(r.ContactID)||!text(r.MasterID)||!text(r.SiteID)||!text(r.ContactName);});
      state.contacts={rows:rows,invalid:invalid};
      $('contacts-preview').innerHTML=tablePreview(rows,['MasterID','ContactID','SiteID','CompanyID','SiteName','ContactName','Email','Phone','ProgramPool','ProgramDHW','ProgramHVAC','NeedsReview']);
      $('contacts-import-btn').disabled=!rows.length||invalid.length>0;
      setStatus('contacts-status',rows.length+' contact rows loaded; '+invalid.length+' missing required IDs/name. Contacts will be permanent lookup records, not Leads.',Boolean(invalid.length));
    }).catch(function(e){setStatus('contacts-status',e.message||'Could not read CSV.',true);});
  }

  function importContacts() {
    if(!state.contacts||!state.contacts.rows.length)return;
    var api=window.NovaraApi;
    if(!api){setStatus('contacts-status','NOVARA API unavailable.',true);return;}
    $('contacts-import-btn').disabled=true;
    setStatus('contacts-status','Checking permanent contact master data…',false);
    api.getContacts().then(function(payload){
      var existing=(payload&&payload.contacts)||[];
      var byId={}, byNatural={};
      existing.forEach(function(x){
        var id=text(x.ContactID||x.contactId); if(id)byId[id]=x;
        var k=text(x.SiteID||x.siteId)+'|'+norm(x.ContactName||x.contactName)+'|'+norm(x.Email||x.email)+'|'+norm(x.Phone||x.phone); if(k)byNatural[k]=x;
      });
      return processSequential(state.contacts.rows,function(r){
        var id=text(r.ContactID);
        var k=text(r.SiteID)+'|'+norm(r.ContactName)+'|'+norm(r.Email)+'|'+norm(r.Phone);
        if(byId[id]||byNatural[k]) return Promise.resolve({skipped:true});
        byId[id]=r; byNatural[k]=r;
        return api.createContact({
          MasterID:text(r.MasterID),ContactID:id,SiteID:text(r.SiteID),CompanyID:text(r.CompanyID),SiteKey:text(r.SiteKey),SiteName:text(r.SiteName),ContactName:text(r.ContactName),Email:text(r.Email),Phone:text(r.Phone),
          ProgramPool:text(r.ProgramPool),ProgramDHW:text(r.ProgramDHW),ProgramHVAC:text(r.ProgramHVAC),ProgramRestaurant:text(r.ProgramRestaurant),ProgramOther:text(r.ProgramOther),
          Source:text(r.Source),ImportAsLead:'NO',NeedsReview:text(r.NeedsReview),ReviewReason:text(r.ReviewReason)
        });
      });
    }).then(function(results){
      var s=summarize(results);
      setStatus('contacts-status',s.created+' contacts added; '+s.skipped+' existing matches skipped; '+s.failed+' failed. No Leads were created.',Boolean(s.failed));
    }).catch(function(e){setStatus('contacts-status',e.message||'Contact import failed.',true);}).finally(function(){$('contacts-import-btn').disabled=false;});
  }

  $('companies-preview-btn').addEventListener('click',previewCompanies);
  $('companies-import-btn').addEventListener('click',function(){if(window.confirm('Import these permanent company lookup records? This does not create Leads.')) importCompanies();});
  $('sites-preview-btn').addEventListener('click',previewSites);
  $('sites-import-btn').addEventListener('click',function(){if(window.confirm('Import these permanent site lookup records? Existing SiteID/SiteKey matches will be skipped.')) importSites();});
  $('contacts-preview-btn').addEventListener('click',previewContacts);
  $('contacts-import-btn').addEventListener('click',function(){if(window.confirm('Import these permanent contact lookup records? This does not create Leads.')) importContacts();});
})();
