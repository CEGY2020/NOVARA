(function(){
  "use strict";

  var state={companies:[],sites:[],contacts:[],filtered:[],currentCompanyId:"",editingRecord:null};
  function $(id){return document.getElementById(id);}
  function text(v){return v==null?"":String(v).trim();}
  function norm(v){return text(v).toLowerCase();}
  function cityNorm(v){return norm(v).replace(/\./g,"").replace(/\s+/g," ").trim();}
  function esc(v){return text(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#39;");}
  function yes(v){return text(v).toUpperCase()==="YES";}
  function yn(v){return v?"YES":"NO";}
  function programs(row){var out=[];if(yes(row.ProgramPool))out.push("Pool");if(yes(row.ProgramDHW))out.push("DHW");if(yes(row.ProgramHVAC))out.push("HVAC");if(yes(row.ProgramRestaurant))out.push("Restaurant");if(yes(row.ProgramOther))out.push("Other");return out;}
  function programsHtml(row){var p=programs(row);return p.length?'<div class="program-tags">'+p.map(function(x){return '<span class="program-tag">'+esc(x)+'</span>';}).join('')+'</div>':'—';}
  function companyId(row){return text(row.CompanyID||row.companyId);}
  function masterId(row){return text(row.MasterID||row.masterId);}
  function siteCompanyId(row){return text(row.CompanyID||row.companyId);}
  function contactCompanyId(row){return text(row.CompanyID||row.companyId);}
  function companySites(cid){return state.sites.filter(function(s){return siteCompanyId(s)===cid;});}
  function companyContacts(cid,mid){return state.contacts.filter(function(c){return contactCompanyId(c)===cid||(mid&&text(c.MasterID||c.masterId)===mid);});}

  var SDGE_CITIES=["aliso viejo","bonita","bonsall","carlsbad","chula vista","coronado","dana point","del mar","descanso","el cajon","encinitas","escondido","fallbrook","imperial beach","la jolla","la mesa","laguna beach","laguna hills","laguna niguel","lakeside","lemon grove","mission beach","mission valley","mission viejo","national city","oceanside","otay mesa","pacific beach","poway","ramona","rancho bernardo","rancho san diego","rancho santa fe","san clemente","san diego","san diego / mission hills","san juan capistrano","san marcos","san ysidro","santee","solana beach","spring valley","vista","leucadia"];
  var PGE_CITIES=["citrus heights","dublin","emeryville","fremont","fresno","milpitas","oakland","palo alto","pleasant hill","roseville","saint helena","st helena","san francisco","san jose","san lorenzo","san mateo","stockton","sunnyvale","vallejo"];
  var SOCALGAS_CITIES=["anaheim","bakersfield","brea","buena park","burbank","cerritos","chatsworth","chino","city of industry","corona","costa mesa","culver city","cypress","desert hot springs","diamond bar","downey","encino","fountain valley","fullerton","garden grove","gardena","glendale","hawaiian gardens","hawthorne","hermosa beach","hollywood","huntington beach","indio","irvine","la habra","la mirada","la quinta","la verne","laguna woods","lake forest","lakewood","lancaster","long beach","los angeles","marina del rey","menifee","monrovia","montclair","newport beach","newport coast","north hills","north hollywood","northridge","norwalk","ontario","orange","oxnard","palm desert","palm springs","palos verdes peninsula","pasadena","pico rivera","placentia","rancho palos verdes","rancho santa margarita","redondo beach","rosemead","san bernardino","san marino","santa ana","santa monica","seal beach","studio city","temecula","torrance","tustin","tustin ranch","valencia","valley village","van nuys","ventura","w hollywood","west covina","west hollywood","whittier","woodland hills","yorba linda"];
  function inList(city,list){return list.indexOf(cityNorm(city))!==-1;}
  function siteUtilityRegion(site){var stateCode=text(site.State||site.state).toUpperCase(),city=text(site.City||site.city);if(stateCode&&stateCode!=="CA")return "Verify";if(inList(city,SDGE_CITIES))return "SDG&E";if(inList(city,PGE_CITIES))return "PG&E";if(inList(city,SOCALGAS_CITIES))return "SoCalGas";return "Verify";}
  function companyUtilityRegions(company){var regions={},sites=companySites(companyId(company));sites.forEach(function(s){regions[siteUtilityRegion(s)]=true;});return Object.keys(regions);}
  function companyStates(company){var states={};companySites(companyId(company)).forEach(function(s){var st=text(s.State||s.state).toUpperCase();if(st)states[st]=true;});return Object.keys(states);}

  function rowSearchText(company){
    var cid=companyId(company),mid=masterId(company),sites=companySites(cid),contacts=companyContacts(cid,mid),chunks=[company.CompanyName,company.CompanyID,company.MasterID,company.RelationshipType,company.ExampleSite,programs(company).join(' '),companyUtilityRegions(company).join(' '),companyStates(company).join(' ')];
    sites.forEach(function(s){chunks.push(s.SiteName,s.SiteID,s.Address,s.City,s.State,s.Phone,s.CustomerNumber,s.SiteKey);});
    contacts.forEach(function(c){chunks.push(c.ContactName,c.ContactID,c.SiteName,c.Email,c.Phone);});
    return norm(chunks.join(' '));
  }
  function matchProgram(company,selected){return !selected||programs(company).indexOf(selected)!==-1;}
  function matchUtility(company,selected){return !selected||companyUtilityRegions(company).indexOf(selected)!==-1;}
  function matchState(company,selected){return !selected||companyStates(company).indexOf(selected)!==-1;}

  function render(){
    var q=norm($("company-search").value),rel=text($("relationship-filter").value),prog=text($("program-filter").value),utility=text($("utility-filter").value),st=text($("state-filter").value);
    state.filtered=state.companies.filter(function(c){if(rel&&text(c.RelationshipType)!==rel)return false;if(!matchProgram(c,prog)||!matchUtility(c,utility)||!matchState(c,st))return false;if(q&&rowSearchText(c).indexOf(q)===-1)return false;return true;});
    var body=$("companies-body");
    body.innerHTML=state.filtered.length?state.filtered.map(function(c){var cid=companyId(c),mid=masterId(c),sites=companySites(cid),contacts=companyContacts(cid,mid);return '<tr><td><button class="company-link" data-company-id="'+esc(cid)+'">'+esc(c.CompanyName||c.companyName)+'</button></td><td>'+esc(cid)+'</td><td>'+esc(mid)+'</td><td>'+esc(c.RelationshipType||'—')+'</td><td>'+programsHtml(c)+'</td><td>'+sites.length+'</td><td>'+contacts.length+'</td><td>'+esc(yes(c.NeedsReview)?'YES':'NO')+'</td></tr>';}).join(''):'<tr><td colspan="8">No matching companies found.</td></tr>';
    $("companies-status").textContent=state.filtered.length+' of '+state.companies.length+' companies shown.';
  }

  function renderDetail(){
    var cid=state.currentCompanyId,c=state.companies.find(function(row){return companyId(row)===cid;});if(!c)return;
    var mid=masterId(c),sites=companySites(cid),contacts=companyContacts(cid,mid),regions=companyUtilityRegions(c),states=companyStates(c);
    $("detail-company-name").textContent=text(c.CompanyName||c.companyName)||cid;
    var p=programs(c);$("detail-programs").textContent=p.length?'Programs: '+p.join(', '):'Programs: none assigned';
    var fields=[['Company ID',cid],['Master ID',mid],['Relationship',text(c.RelationshipType)||'—'],['Needs Review',yes(c.NeedsReview)?'YES':'NO'],['Utility Region',regions.length?regions.join(', '):'Verify'],['State',states.length?states.join(', '):'—'],['Linked Sites',String(sites.length)],['Linked Contacts',String(contacts.length)]];
    $("detail-fields").innerHTML=fields.map(function(f){return '<div class="detail-field"><span>'+esc(f[0])+'</span><strong>'+esc(f[1])+'</strong></div>';}).join('');
    $("sites-heading").textContent='Linked Sites ('+sites.length+')';$("contacts-heading").textContent='Linked Contacts ('+contacts.length+')';
    $("detail-sites-body").innerHTML=sites.length?sites.map(function(s){var address=[text(s.Address),text(s.City),text(s.State)].filter(Boolean).join(', ');return '<tr><td>'+esc(s.SiteName)+'</td><td>'+esc(s.SiteID)+'</td><td>'+esc(s.CompanyID||'—')+'</td><td>'+esc(address||'—')+'</td><td>'+esc(s.City||'—')+'</td><td>'+esc(s.Phone||'—')+'</td><td>'+programsHtml(s)+'</td><td>'+esc(yes(s.NeedsReview)?'YES':'NO')+'</td><td><button class="secondary-btn small-edit edit-site" data-site-id="'+esc(s.SiteID)+'">Edit</button></td></tr>';}).join(''):'<tr><td colspan="9">No linked sites.</td></tr>';
    $("detail-contacts-body").innerHTML=contacts.length?contacts.map(function(cn){var email=text(cn.Email),emailCell=email?'<a href="mailto:'+esc(email)+'">'+esc(email)+'</a>':'—';return '<tr><td>'+esc(cn.ContactName)+'</td><td>'+esc(cn.ContactID)+'</td><td>'+esc(cn.SiteName||cn.SiteID||'—')+'</td><td>'+esc(cn.CompanyID||'—')+'</td><td>'+emailCell+'</td><td>'+esc(cn.Phone||'—')+'</td><td>'+programsHtml(cn)+'</td><td>'+esc(yes(cn.NeedsReview)?'YES':'NO')+'</td><td><button class="secondary-btn small-edit edit-contact" data-contact-id="'+esc(cn.ContactID)+'">Edit</button></td></tr>';}).join(''):'<tr><td colspan="9">No linked contacts.</td></tr>';
  }

  function showCompany(cid){state.currentCompanyId=cid;renderDetail();$("company-edit-panel").hidden=true;$("record-edit-panel").hidden=true;$("company-detail").hidden=false;$("company-detail").scrollIntoView({behavior:'smooth',block:'start'});}

  function openCompanyEdit(){
    var c=state.companies.find(function(row){return companyId(row)===state.currentCompanyId;});if(!c)return;
    $("edit-company-name").value=text(c.CompanyName);$("edit-company-id").value=companyId(c);$("edit-master-id").value=masterId(c);$("edit-relationship").value=text(c.RelationshipType)||"OMC - Review";$("edit-example-site").value=text(c.ExampleSite);$("edit-needs-review").value=yes(c.NeedsReview)?"YES":"NO";$("edit-review-reason").value=text(c.ReviewReason);
    $("edit-program-pool").checked=yes(c.ProgramPool);$("edit-program-dhw").checked=yes(c.ProgramDHW);$("edit-program-hvac").checked=yes(c.ProgramHVAC);$("edit-program-restaurant").checked=yes(c.ProgramRestaurant);$("edit-program-other").checked=yes(c.ProgramOther);
    $("company-edit-status").textContent="";$("company-edit-panel").hidden=false;$("record-edit-panel").hidden=true;$("company-edit-panel").scrollIntoView({behavior:'smooth',block:'center'});
  }

  function saveCompany(event){event.preventDefault();var c=state.companies.find(function(row){return companyId(row)===state.currentCompanyId;});if(!c)return;var payload={CompanyID:companyId(c),MasterID:text($("edit-master-id").value),CompanyName:text($("edit-company-name").value),RelationshipType:text($("edit-relationship").value),ProgramPool:yn($("edit-program-pool").checked),ProgramDHW:yn($("edit-program-dhw").checked),ProgramHVAC:yn($("edit-program-hvac").checked),ProgramRestaurant:yn($("edit-program-restaurant").checked),ProgramOther:yn($("edit-program-other").checked),ExampleSite:text($("edit-example-site").value),ImportAsLead:"NO",NeedsReview:text($("edit-needs-review").value),ReviewReason:text($("edit-review-reason").value)};
    $("company-edit-status").textContent="Saving…";NovaraApi.updateMasterCompany(payload).then(function(){Object.assign(c,payload);$("company-edit-status").textContent="Saved.";render();renderDetail();setTimeout(function(){$("company-edit-panel").hidden=true;},500);}).catch(function(err){$("company-edit-status").textContent=err.message||"Save failed.";});}

  function fieldHtml(label,id,value,type,wide){return '<label'+(wide?' class="wide"':'')+'>'+esc(label)+'<input id="'+id+'" type="'+(type||'text')+'" value="'+esc(value)+'"></label>';}
  function selectHtml(label,id,value,options){return '<label>'+esc(label)+'<select id="'+id+'">'+options.map(function(o){return '<option value="'+esc(o)+'"'+(o===value?' selected':'')+'>'+esc(o)+'</option>';}).join('')+'</select></label>';}
  function programEditHtml(r){return '<div class="wide check-row"><span>Programs:</span><label><input id="rec-pool" type="checkbox" '+(yes(r.ProgramPool)?'checked':'')+'> Pool</label><label><input id="rec-dhw" type="checkbox" '+(yes(r.ProgramDHW)?'checked':'')+'> DHW</label><label><input id="rec-hvac" type="checkbox" '+(yes(r.ProgramHVAC)?'checked':'')+'> HVAC</label><label><input id="rec-restaurant" type="checkbox" '+(yes(r.ProgramRestaurant)?'checked':'')+'> Restaurant</label><label><input id="rec-other" type="checkbox" '+(yes(r.ProgramOther)?'checked':'')+'> Other</label></div>';}

  function openSiteEdit(siteId){
    var r=state.sites.find(function(x){return text(x.SiteID)===siteId;});if(!r)return;state.editingRecord={type:'site',row:r};$("record-edit-title").textContent='Edit Site — '+text(r.SiteName);
    $("record-edit-fields").innerHTML=fieldHtml('Site Name','rec-site-name',r.SiteName)+fieldHtml('Site ID','rec-site-id',r.SiteID)+fieldHtml('Company ID','rec-company-id',r.CompanyID)+fieldHtml('Address','rec-address',r.Address)+fieldHtml('City','rec-city',r.City)+fieldHtml('State','rec-state',r.State)+fieldHtml('ZIP','rec-zip',r.Zip)+fieldHtml('Phone','rec-phone',r.Phone)+selectHtml('Needs Review','rec-needs-review',yes(r.NeedsReview)?'YES':'NO',['NO','YES'])+fieldHtml('Review Reason','rec-review-reason',r.ReviewReason,'text',true)+programEditHtml(r);
    $('rec-site-id').readOnly=true;$("record-edit-status").textContent='';$("record-edit-panel").hidden=false;$("company-edit-panel").hidden=true;$("record-edit-panel").scrollIntoView({behavior:'smooth',block:'center'});
  }

  function openContactEdit(contactId){
    var r=state.contacts.find(function(x){return text(x.ContactID)===contactId;});if(!r)return;state.editingRecord={type:'contact',row:r};$("record-edit-title").textContent='Edit Contact — '+text(r.ContactName);
    $("record-edit-fields").innerHTML=fieldHtml('Contact Name','rec-contact-name',r.ContactName)+fieldHtml('Contact ID','rec-contact-id',r.ContactID)+fieldHtml('Company ID','rec-company-id',r.CompanyID)+fieldHtml('Site ID','rec-site-id',r.SiteID)+fieldHtml('Site Name','rec-site-name',r.SiteName)+fieldHtml('Email','rec-email',r.Email,'email')+fieldHtml('Phone','rec-phone',r.Phone)+selectHtml('Needs Review','rec-needs-review',yes(r.NeedsReview)?'YES':'NO',['NO','YES'])+fieldHtml('Review Reason','rec-review-reason',r.ReviewReason,'text',true)+programEditHtml(r);
    $('rec-contact-id').readOnly=true;$("record-edit-status").textContent='';$("record-edit-panel").hidden=false;$("company-edit-panel").hidden=true;$("record-edit-panel").scrollIntoView({behavior:'smooth',block:'center'});
  }

  function saveRecord(event){
    event.preventDefault();var e=state.editingRecord;if(!e)return;var r=e.row,payload;
    if(e.type==='site'){
      payload={MasterID:text(r.MasterID),SiteID:text(r.SiteID),CompanyID:text($('rec-company-id').value),SiteKey:text(r.SiteKey),SiteName:text($('rec-site-name').value),Address:text($('rec-address').value),City:text($('rec-city').value),State:text($('rec-state').value),Zip:text($('rec-zip').value),Phone:text($('rec-phone').value),CustomerNumber:text(r.CustomerNumber),ProgramPool:yn($('rec-pool').checked),ProgramDHW:yn($('rec-dhw').checked),ProgramHVAC:yn($('rec-hvac').checked),ProgramRestaurant:yn($('rec-restaurant').checked),ProgramOther:yn($('rec-other').checked),RelatedCompany:text(r.RelatedCompany),SourceCount:text(r.SourceCount),SourceRefs:text(r.SourceRefs),ImportAsLead:'NO',NeedsReview:text($('rec-needs-review').value),ReviewReason:text($('rec-review-reason').value),Status:text(r.Status)||'Offline'};
    }else{
      payload={MasterID:text(r.MasterID),ContactID:text(r.ContactID),SiteID:text($('rec-site-id').value),CompanyID:text($('rec-company-id').value),SiteKey:text(r.SiteKey),SiteName:text($('rec-site-name').value),ContactName:text($('rec-contact-name').value),Email:text($('rec-email').value),Phone:text($('rec-phone').value),ProgramPool:yn($('rec-pool').checked),ProgramDHW:yn($('rec-dhw').checked),ProgramHVAC:yn($('rec-hvac').checked),ProgramRestaurant:yn($('rec-restaurant').checked),ProgramOther:yn($('rec-other').checked),Source:text(r.Source),ImportAsLead:'NO',NeedsReview:text($('rec-needs-review').value),ReviewReason:text($('rec-review-reason').value)};
    }
    $("record-edit-status").textContent='Saving…';var promise=e.type==='site'?NovaraApi.updateMasterSite(payload):NovaraApi.updateContact(payload);promise.then(function(){Object.assign(r,payload);$("record-edit-status").textContent='Saved.';render();renderDetail();populateStates();setTimeout(function(){$("record-edit-panel").hidden=true;},500);}).catch(function(err){$("record-edit-status").textContent=err.message||'Save failed.';});
  }

  function populateStates(){var found={};state.sites.forEach(function(s){var st=text(s.State||s.state).toUpperCase();if(st)found[st]=true;});var select=$("state-filter"),current=select.value;select.innerHTML='<option value="">All</option>'+Object.keys(found).sort().map(function(st){return '<option value="'+esc(st)+'">'+esc(st)+'</option>';}).join('');if(current&&found[current])select.value=current;}

  function load(){if(!window.NovaraApi){$("companies-status").textContent='NOVARA API unavailable.';return;}$("companies-status").textContent='Loading companies, sites, and contacts…';Promise.all([NovaraApi.getMasterCompanies(),NovaraApi.getMasterSites(),NovaraApi.getContacts()]).then(function(values){state.companies=(values[0]&&values[0].companies)||[];state.sites=(values[1]&&values[1].sites)||[];state.contacts=(values[2]&&values[2].contacts)||[];populateStates();render();}).catch(function(err){$("companies-status").textContent=err&&err.message?err.message:'Could not load company lookup data.';});}

  $("company-search").addEventListener('input',render);$("relationship-filter").addEventListener('change',render);$("program-filter").addEventListener('change',render);$("utility-filter").addEventListener('change',render);$("state-filter").addEventListener('change',render);
  $("clear-company-search").addEventListener('click',function(){$("company-search").value='';$("relationship-filter").value='';$("program-filter").value='';$("utility-filter").value='';$("state-filter").value='';render();$("company-search").focus();});
  $("companies-body").addEventListener('click',function(event){var btn=event.target.closest('.company-link');if(btn)showCompany(btn.getAttribute('data-company-id'));});
  $("detail-sites-body").addEventListener('click',function(event){var btn=event.target.closest('.edit-site');if(btn)openSiteEdit(btn.getAttribute('data-site-id'));});
  $("detail-contacts-body").addEventListener('click',function(event){var btn=event.target.closest('.edit-contact');if(btn)openContactEdit(btn.getAttribute('data-contact-id'));});
  $("edit-company-btn").addEventListener('click',openCompanyEdit);$("company-edit-form").addEventListener('submit',saveCompany);$("cancel-company-edit").addEventListener('click',function(){$("company-edit-panel").hidden=true;});
  $("record-edit-form").addEventListener('submit',saveRecord);$("cancel-record-edit").addEventListener('click',function(){$("record-edit-panel").hidden=true;state.editingRecord=null;});
  $("close-company-detail").addEventListener('click',function(){$("company-detail").hidden=true;state.currentCompanyId='';});

  load();
})();
