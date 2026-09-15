(function () {
  "use strict";

  var state = { companies: null, sites: null, contacts: null };

  function $(id) { return document.getElementById(id); }
  function text(v) { return v == null ? "" : String(v).trim(); }
  function norm(v) { return text(v).toLowerCase().replace(/&amp;/g, "&").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim(); }
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
  function nextId(prefix, existingIds) {
    var max=0, re=new RegExp('^'+prefix+'(\\d+)$','i');
    existingIds.forEach(function(id){ var m=re.exec(text(id)); if(m) max=Math.max(max,parseInt(m[1],10)||0); });
    return prefix+String(max+1).padStart(3,'0');
  }
  function processSequential(items, worker) {
    var results=[], chain=Promise.resolve();
    items.forEach(function(item){ chain=chain.then(function(){ return worker(item).then(function(v){results.push({ok:true,item:item,value:v});}).catch(function(e){results.push({ok:false,item:item,error:e});}); }); });
    return chain.then(function(){return results;});
  }
  function isOwnerType(type) { return /^owner$/i.test(text(type)); }
  function isMgmtType(type) { return /^(management company|management|mgmt)$/i.test(text(type)); }

  function previewCompanies() {
    var file=$('companies-file').files&&$('companies-file').files[0];
    if(!file){setStatus('companies-status','Choose a Companies CSV first.',true);return;}
    loadCsv(file).then(function(rows){
      var usable=[], skipped=[];
      rows.forEach(function(r){
        var type=text(r.CompanyType||r.RelationshipType);
        if(isOwnerType(type)||isMgmtType(type)) usable.push(r); else skipped.push(r);
      });
      state.companies={rows:rows,usable:usable,skipped:skipped};
      $('companies-preview').innerHTML=tablePreview(rows,['CompanyName','CompanyType','RelationshipType','ProgramsSeen','ExampleSite']);
      $('companies-import-btn').disabled=!usable.length;
      setStatus('companies-status',usable.length+' importable; '+skipped.length+' skipped for Owner/Management Company review.',false);
    }).catch(function(e){setStatus('companies-status',e.message||'Could not read CSV.',true);});
  }

  function importCompanies() {
    if(!state.companies||!state.companies.usable.length)return;
    var api=window.NovaraApi;
    if(!api){setStatus('companies-status','NOVARA API unavailable.',true);return;}
    $('companies-import-btn').disabled=true;
    setStatus('companies-status','Checking existing companies…',false);
    Promise.all([api.getOwners(),api.getMgmtCompanies()]).then(function(vals){
      var owners=(vals[0]&&vals[0].owners)||[];
      var mgmts=(vals[1]&&vals[1].companies)||[];
      var ownerNames={}; owners.forEach(function(x){ownerNames[norm(x.name||x.ownerName)]=true;});
      var mgmtNames={}; mgmts.forEach(function(x){mgmtNames[norm(x.name||x.companyName||x.mgmtCompanyName)]=true;});
      var ownerIds=owners.map(function(x){return x.ownerId;});
      var mgmtIds=mgmts.map(function(x){return x.mgmtCompanyId;});
      return processSequential(state.companies.usable,function(r){
        var name=text(r.CompanyName); var type=text(r.CompanyType||r.RelationshipType);
        if(isOwnerType(type)){
          if(ownerNames[norm(name)]) return Promise.resolve({skipped:true});
          var id=nextId('OWN',ownerIds); ownerIds.push(id); ownerNames[norm(name)]=true;
          return api.createOwner({OwnerID:id,Name:name,Address:text(r.Address),City:text(r.City),State:text(r.State),Zip:text(r.Zip),ContactName:text(r.ContactName),ContactEmail:text(r.Email||r.ContactEmail),ContactPhone:text(r.Phone||r.ContactPhone),Notes:text(r.Notes),Status:'Active'});
        }
        if(mgmtNames[norm(name)]) return Promise.resolve({skipped:true});
        var mid=nextId('MGMT',mgmtIds); mgmtIds.push(mid); mgmtNames[norm(name)]=true;
        return api.createMgmtCompany({MgmtCompanyID:mid,Name:name,Address:text(r.Address),City:text(r.City),State:text(r.State),Zip:text(r.Zip),ContactName:text(r.ContactName),ContactEmail:text(r.Email||r.ContactEmail),ContactPhone:text(r.Phone||r.ContactPhone),Notes:text(r.Notes)});
      });
    }).then(function(results){
      var ok=results.filter(function(x){return x.ok;}).length, fail=results.length-ok;
      setStatus('companies-status',ok+' company rows processed; '+fail+' failed. Ambiguous rows remain unimported.',Boolean(fail));
    }).catch(function(e){setStatus('companies-status',e.message||'Company import failed.',true);}).finally(function(){$('companies-import-btn').disabled=false;});
  }

  function previewSites() {
    var file=$('sites-file').files&&$('sites-file').files[0];
    if(!file){setStatus('sites-status','Choose a Sites CSV first.',true);return;}
    loadCsv(file).then(function(rows){
      state.sites={rows:rows};
      $('sites-preview').innerHTML=tablePreview(rows,['SiteName','Address','City','State','Programs','RelatedCompany','ReviewStatus']);
      $('sites-import-btn').disabled=!rows.length;
      var review=rows.filter(function(r){return text(r.ReviewStatus).toLowerCase()==='review';}).length;
      setStatus('sites-status',rows.length+' site rows loaded; '+review+' marked Review.',false);
    }).catch(function(e){setStatus('sites-status',e.message||'Could not read CSV.',true);});
  }

  function importSites() {
    if(!state.sites||!state.sites.rows.length)return;
    var api=window.NovaraApi;
    if(!api){setStatus('sites-status','NOVARA API unavailable.',true);return;}
    $('sites-import-btn').disabled=true; setStatus('sites-status','Checking existing sites and company links…',false);
    Promise.all([api.getSites(),api.getOwners(),api.getMgmtCompanies()]).then(function(vals){
      var sites=(vals[0]&&vals[0].sites)||[];
      var owners=(vals[1]&&vals[1].owners)||[];
      var mgmts=(vals[2]&&vals[2].companies)||[];
      var siteKeys={}; sites.forEach(function(x){siteKeys[norm(x.siteName)+'|'+norm(x.address)+'|'+norm(x.city)]=true;});
      var siteIds=sites.map(function(x){return x.siteId;});
      var ownerByName={}; owners.forEach(function(x){ownerByName[norm(x.name||x.ownerName)]=x.ownerId;});
      var mgmtByName={}; mgmts.forEach(function(x){mgmtByName[norm(x.name||x.companyName||x.mgmtCompanyName)]=x.mgmtCompanyId;});
      return processSequential(state.sites.rows,function(r){
        var key=norm(r.SiteName)+'|'+norm(r.Address)+'|'+norm(r.City);
        if(siteKeys[key]) return Promise.resolve({skipped:true});
        var sid=nextId('SITE',siteIds); siteIds.push(sid); siteKeys[key]=true;
        var related=norm(r.RelatedCompany); var ownerId=ownerByName[related]||''; var mgmtId=mgmtByName[related]||'';
        var programs=text(r.Programs); var sys='';
        if(/pool/i.test(programs)) sys='Pool'; else if(/hvac/i.test(programs)) sys='HVAC'; else if(/dhw|domestic/i.test(programs)) sys='DHW';
        return api.createSite({SiteID:sid,SiteName:text(r.SiteName),Owner:ownerId,OwnerID:ownerId,MgmtCompany:mgmtId,Address:text(r.Address),City:text(r.City),State:text(r.State),Zip:text(r.Zip),SystemType:sys,Status:'Online',Systems:0});
      });
    }).then(function(results){
      var ok=results.filter(function(x){return x.ok;}).length, fail=results.length-ok;
      setStatus('sites-status',ok+' site rows processed; '+fail+' failed. No Leads were created.',Boolean(fail));
    }).catch(function(e){setStatus('sites-status',e.message||'Site import failed.',true);}).finally(function(){$('sites-import-btn').disabled=false;});
  }

  function previewContacts() {
    var file=$('contacts-file').files&&$('contacts-file').files[0];
    if(!file){setStatus('contacts-status','Choose a Contacts CSV first.',true);return;}
    loadCsv(file).then(function(rows){
      state.contacts={rows:rows};
      $('contacts-preview').innerHTML=tablePreview(rows,['SiteName','ContactName','Email','Phone','Source','ImportAsLead']);
      var invalid=rows.filter(function(r){return !text(r.SiteName)||(!text(r.ContactName)&&!text(r.Email)&&!text(r.Phone));}).length;
      setStatus('contacts-status',rows.length+' contact rows validated; '+invalid+' need review. Contacts are staged only until the permanent Contacts object is added.',Boolean(invalid));
    }).catch(function(e){setStatus('contacts-status',e.message||'Could not read CSV.',true);});
  }

  $('companies-preview-btn').addEventListener('click',previewCompanies);
  $('companies-import-btn').addEventListener('click',function(){if(window.confirm('Import the previewed company rows into permanent NOVARA master data? No Leads will be created.')) importCompanies();});
  $('sites-preview-btn').addEventListener('click',previewSites);
  $('sites-import-btn').addEventListener('click',function(){if(window.confirm('Import the previewed sites into NOVARA? Existing matches will be skipped and no Leads will be created.')) importSites();});
  $('contacts-preview-btn').addEventListener('click',previewContacts);
})();
