(function(){
  "use strict";

  var state={companies:[],sites:[],contacts:[],filtered:[]};
  function $(id){return document.getElementById(id);}
  function text(v){return v==null?"":String(v).trim();}
  function norm(v){return text(v).toLowerCase();}
  function esc(v){return text(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#39;");}
  function yes(v){return text(v).toUpperCase()==="YES";}
  function programs(row){var out=[];if(yes(row.ProgramPool))out.push("Pool");if(yes(row.ProgramDHW))out.push("DHW");if(yes(row.ProgramHVAC))out.push("HVAC");if(yes(row.ProgramRestaurant))out.push("Restaurant");if(yes(row.ProgramOther))out.push("Other");return out;}
  function programsHtml(row){var p=programs(row);return p.length?'<div class="program-tags">'+p.map(function(x){return '<span class="program-tag">'+esc(x)+'</span>';}).join('')+'</div>':'—';}
  function companyId(row){return text(row.CompanyID||row.companyId);}
  function masterId(row){return text(row.MasterID||row.masterId);}
  function siteCompanyId(row){return text(row.CompanyID||row.companyId);}
  function contactCompanyId(row){return text(row.CompanyID||row.companyId);}
  function companySites(cid){return state.sites.filter(function(s){return siteCompanyId(s)===cid;});}
  function companyContacts(cid,mid){return state.contacts.filter(function(c){return contactCompanyId(c)===cid||(mid&&text(c.MasterID||c.masterId)===mid);});}
  function rowSearchText(company){
    var cid=companyId(company), mid=masterId(company), sites=companySites(cid), contacts=companyContacts(cid,mid);
    var chunks=[company.CompanyName,company.CompanyID,company.MasterID,company.RelationshipType,company.ExampleSite,programs(company).join(' ')];
    sites.forEach(function(s){chunks.push(s.SiteName,s.SiteID,s.Address,s.City,s.State,s.Phone,s.CustomerNumber,s.SiteKey,s.UtilityRegion,s.GasRegion,s.Region,s.Utility,s.SourceRefs,s.Source);});
    contacts.forEach(function(c){chunks.push(c.ContactName,c.ContactID,c.SiteName,c.Email,c.Phone);});
    return norm(chunks.join(' '));
  }
  function matchProgram(company,selected){if(!selected)return true;return programs(company).indexOf(selected)!==-1;}
  function regionText(company){
    var cid=companyId(company), sites=companySites(cid), values=[company.UtilityRegion,company.GasRegion,company.Region,company.Utility,company.SourceRefs,company.Source];
    sites.forEach(function(s){values.push(s.UtilityRegion,s.GasRegion,s.Region,s.Utility,s.SourceRefs,s.Source);});
    return norm(values.join(' ')).replace(/&/g,'and');
  }
  function matchRegion(company,selected){
    if(!selected)return true;
    var r=regionText(company);
    if(selected==='socalgas')return r.indexOf('socalgas')!==-1||r.indexOf('southern california gas')!==-1;
    if(selected==='sdge')return r.indexOf('sdgande')!==-1||r.indexOf('sdge')!==-1||r.indexOf('san diego gas')!==-1;
    if(selected==='pge')return r.indexOf('pgande')!==-1||r.indexOf('pge')!==-1||r.indexOf('pacific gas')!==-1;
    return true;
  }
  function matchState(company,selected){
    if(!selected)return true;
    var cid=companyId(company), sites=companySites(cid);
    return sites.some(function(s){return text(s.State).toUpperCase()===selected.toUpperCase();});
  }
  function populateStates(){
    var seen={};
    state.sites.forEach(function(s){var st=text(s.State).toUpperCase();if(st)seen[st]=true;});
    var list=Object.keys(seen).sort();
    $("state-filter").innerHTML='<option value="">All States</option>'+list.map(function(st){return '<option value="'+esc(st)+'">'+esc(st)+'</option>';}).join('');
  }

  function render(){
    var q=norm($("company-search").value), rel=text($("relationship-filter").value), prog=text($("program-filter").value), region=text($("region-filter").value), stateFilter=text($("state-filter").value);
    state.filtered=state.companies.filter(function(c){
      if(rel&&text(c.RelationshipType)!==rel)return false;
      if(!matchProgram(c,prog))return false;
      if(!matchRegion(c,region))return false;
      if(!matchState(c,stateFilter))return false;
      if(q&&rowSearchText(c).indexOf(q)===-1)return false;
      return true;
    });
    var body=$("companies-body");
    if(!state.filtered.length){body.innerHTML='<tr><td colspan="8">No matching companies found.</td></tr>';}else{
      body.innerHTML=state.filtered.map(function(c){
        var cid=companyId(c), mid=masterId(c), sites=companySites(cid), contacts=companyContacts(cid,mid);
        return '<tr>'+[
          '<td><button class="company-link" data-company-id="'+esc(cid)+'">'+esc(c.CompanyName||c.companyName)+'</button></td>',
          '<td>'+esc(cid)+'</td>',
          '<td>'+esc(mid)+'</td>',
          '<td>'+esc(c.RelationshipType||'—')+'</td>',
          '<td>'+programsHtml(c)+'</td>',
          '<td>'+sites.length+'</td>',
          '<td>'+contacts.length+'</td>',
          '<td>'+esc(yes(c.NeedsReview)?'YES':'NO')+'</td>'
        ].join('')+'</tr>';
      }).join('');
    }
    $("companies-status").textContent=state.filtered.length+' of '+state.companies.length+' companies shown.';
  }

  function showCompany(cid){
    var c=state.companies.find(function(row){return companyId(row)===cid;});
    if(!c)return;
    var mid=masterId(c), sites=companySites(cid), contacts=companyContacts(cid,mid);
    $("detail-company-name").textContent=text(c.CompanyName||c.companyName)||cid;
    var p=programs(c);$("detail-programs").textContent=p.length?'Programs: '+p.join(', '):'Programs: none assigned';
    var fields=[
      ['Company ID',cid],['Master ID',mid],['Relationship',text(c.RelationshipType)||'—'],['Needs Review',yes(c.NeedsReview)?'YES':'NO'],
      ['Example Site',text(c.ExampleSite)||'—'],['Review Reason',text(c.ReviewReason)||'—'],['Linked Sites',String(sites.length)],['Linked Contacts',String(contacts.length)]
    ];
    $("detail-fields").innerHTML=fields.map(function(f){return '<div class="detail-field"><span>'+esc(f[0])+'</span><strong>'+esc(f[1])+'</strong></div>';}).join('');
    $("sites-heading").textContent='Linked Sites ('+sites.length+')';
    $("contacts-heading").textContent='Linked Contacts ('+contacts.length+')';
    $("detail-sites-body").innerHTML=sites.length?sites.map(function(s){
      var address=[text(s.Address),text(s.City),text(s.State)].filter(Boolean).join(', ');
      return '<tr><td>'+esc(s.SiteName)+'</td><td>'+esc(s.SiteID)+'</td><td>'+esc(address||'—')+'</td><td>'+esc(s.City||'—')+'</td><td>'+esc(s.Phone||'—')+'</td><td>'+programsHtml(s)+'</td><td>'+esc(yes(s.NeedsReview)?'YES':'NO')+'</td></tr>';
    }).join(''):'<tr><td colspan="7">No linked sites.</td></tr>';
    $("detail-contacts-body").innerHTML=contacts.length?contacts.map(function(cn){
      var email=text(cn.Email);var emailCell=email?'<a href="mailto:'+esc(email)+'">'+esc(email)+'</a>':'—';
      return '<tr><td>'+esc(cn.ContactName)+'</td><td>'+esc(cn.ContactID)+'</td><td>'+esc(cn.SiteName||cn.SiteID||'—')+'</td><td>'+emailCell+'</td><td>'+esc(cn.Phone||'—')+'</td><td>'+programsHtml(cn)+'</td><td>'+esc(yes(cn.NeedsReview)?'YES':'NO')+'</td></tr>';
    }).join(''):'<tr><td colspan="7">No linked contacts.</td></tr>';
    $("company-detail").hidden=false;
    $("company-detail").scrollIntoView({behavior:'smooth',block:'start'});
  }

  function load(){
    if(!window.NovaraApi){$("companies-status").textContent='NOVARA API unavailable.';return;}
    $("companies-status").textContent='Loading companies, sites, and contacts…';
    Promise.all([NovaraApi.getMasterCompanies(),NovaraApi.getMasterSites(),NovaraApi.getContacts()]).then(function(values){
      state.companies=(values[0]&&values[0].companies)||[];
      state.sites=(values[1]&&values[1].sites)||[];
      state.contacts=(values[2]&&values[2].contacts)||[];
      populateStates();
      render();
    }).catch(function(err){$("companies-status").textContent=err&&err.message?err.message:'Could not load company lookup data.';});
  }

  $("company-search").addEventListener('input',render);
  $("relationship-filter").addEventListener('change',render);
  $("program-filter").addEventListener('change',render);
  $("region-filter").addEventListener('change',render);
  $("state-filter").addEventListener('change',render);
  $("clear-company-search").addEventListener('click',function(){
    $("company-search").value='';$("relationship-filter").value='';$("program-filter").value='';$("region-filter").value='';$("state-filter").value='';render();$("company-search").focus();
  });
  $("companies-body").addEventListener('click',function(event){var btn=event.target.closest('.company-link');if(btn)showCompany(btn.getAttribute('data-company-id'));});
  $("close-company-detail").addEventListener('click',function(){$("company-detail").hidden=true;});

  load();
})();
