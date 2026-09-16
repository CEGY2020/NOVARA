(function(){
  "use strict";

  var state={companies:[],sites:[],contacts:[],filtered:[]};
  function $(id){return document.getElementById(id);}
  function text(v){return v==null?"":String(v).trim();}
  function norm(v){return text(v).toLowerCase();}
  function cityNorm(v){return norm(v).replace(/\./g,"").replace(/\s+/g," ").trim();}
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

  /* Conservative gas-utility territory lookup for current NOVARA site cities.
     Exact matches only. Anything not in a verified list remains Verify rather than guessed. */
  var SDGE_CITIES=[
    "aliso viejo","bonita","bonsall","carlsbad","chula vista","coronado","dana point","del mar","descanso","el cajon","encinitas","escondido","fallbrook","imperial beach","la jolla","la mesa","laguna beach","laguna hills","laguna niguel","lakeside","lemon grove","mission beach","mission valley","mission viejo","national city","oceanside","otay mesa","pacific beach","poway","ramona","rancho bernardo","rancho san diego","rancho santa fe","san clemente","san diego","san diego / mission hills","san juan capistrano","san marcos","san ysidro","santee","solana beach","spring valley","vista","leucadia"
  ];
  var PGE_CITIES=[
    "citrus heights","dublin","emeryville","fremont","fresno","milpitas","oakland","palo alto","pleasant hill","roseville","saint helena","st helena","san francisco","san jose","san lorenzo","san mateo","stockton","sunnyvale","vallejo"
  ];
  var SOCALGAS_CITIES=[
    "anaheim","bakersfield","brea","buena park","burbank","cerritos","chatsworth","chino","city of industry","corona","costa mesa","culver city","cypress","desert hot springs","diamond bar","downey","encino","fountain valley","fullerton","garden grove","gardena","glendale","hawaiian gardens","hawthorne","hermosa beach","hollywood","huntington beach","indio","irvine","la habra","la mirada","la quinta","la verne","laguna woods","lake forest","lakewood","lancaster","long beach","los angeles","marina del rey","menifee","monrovia","montclair","newport beach","newport coast","north hills","north hollywood","northridge","norwalk","ontario","orange","oxnard","palm desert","palm springs","palos verdes peninsula","pasadena","pico rivera","placentia","rancho palos verdes","rancho santa margarita","redondo beach","rosemead","san bernardino","san marino","santa ana","santa monica","seal beach","studio city","temecula","torrance","tustin","tustin ranch","valencia","valley village","van nuys","ventura","w hollywood","west covina","west hollywood","whittier","woodland hills","yorba linda"
  ];
  function inList(city,list){return list.indexOf(cityNorm(city))!==-1;}
  function siteUtilityRegion(site){
    var stateCode=text(site.State||site.state).toUpperCase();
    var city=text(site.City||site.city);
    if(stateCode&&stateCode!=="CA")return "Verify";
    if(inList(city,SDGE_CITIES))return "SDG&E";
    if(inList(city,PGE_CITIES))return "PG&E";
    if(inList(city,SOCALGAS_CITIES))return "SoCalGas";
    return "Verify";
  }
  function companyUtilityRegions(company){
    var regions={},sites=companySites(companyId(company));
    sites.forEach(function(s){regions[siteUtilityRegion(s)]=true;});
    return Object.keys(regions);
  }
  function companyStates(company){
    var states={};companySites(companyId(company)).forEach(function(s){var st=text(s.State||s.state).toUpperCase();if(st)states[st]=true;});return Object.keys(states);
  }

  function rowSearchText(company){
    var cid=companyId(company), mid=masterId(company), sites=companySites(cid), contacts=companyContacts(cid,mid);
    var chunks=[company.CompanyName,company.CompanyID,company.MasterID,company.RelationshipType,company.ExampleSite,programs(company).join(' '),companyUtilityRegions(company).join(' '),companyStates(company).join(' ')];
    sites.forEach(function(s){chunks.push(s.SiteName,s.SiteID,s.Address,s.City,s.State,s.Phone,s.CustomerNumber,s.SiteKey);});
    contacts.forEach(function(c){chunks.push(c.ContactName,c.ContactID,c.SiteName,c.Email,c.Phone);});
    return norm(chunks.join(' '));
  }
  function matchProgram(company,selected){if(!selected)return true;return programs(company).indexOf(selected)!==-1;}
  function matchUtility(company,selected){if(!selected)return true;return companyUtilityRegions(company).indexOf(selected)!==-1;}
  function matchState(company,selected){if(!selected)return true;return companyStates(company).indexOf(selected)!==-1;}

  function render(){
    var q=norm($("company-search").value), rel=text($("relationship-filter").value), prog=text($("program-filter").value), utility=text($("utility-filter").value), st=text($("state-filter").value);
    state.filtered=state.companies.filter(function(c){
      if(rel&&text(c.RelationshipType)!==rel)return false;
      if(!matchProgram(c,prog))return false;
      if(!matchUtility(c,utility))return false;
      if(!matchState(c,st))return false;
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
    var mid=masterId(c), sites=companySites(cid), contacts=companyContacts(cid,mid), regions=companyUtilityRegions(c), states=companyStates(c);
    $("detail-company-name").textContent=text(c.CompanyName||c.companyName)||cid;
    var p=programs(c);$("detail-programs").textContent=p.length?'Programs: '+p.join(', '):'Programs: none assigned';
    var fields=[
      ['Company ID',cid],['Master ID',mid],['Relationship',text(c.RelationshipType)||'—'],['Needs Review',yes(c.NeedsReview)?'YES':'NO'],
      ['Utility Region',regions.length?regions.join(', '):'Verify'],['State',states.length?states.join(', '):'—'],['Linked Sites',String(sites.length)],['Linked Contacts',String(contacts.length)]
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

  function populateStates(){
    var found={};state.sites.forEach(function(s){var st=text(s.State||s.state).toUpperCase();if(st)found[st]=true;});
    var select=$("state-filter"), current=select.value;
    select.innerHTML='<option value="">All</option>'+Object.keys(found).sort().map(function(st){return '<option value="'+esc(st)+'">'+esc(st)+'</option>';}).join('');
    if(current&&found[current])select.value=current;
  }

  function load(){
    if(!window.NovaraApi){$("companies-status").textContent='NOVARA API unavailable.';return;}
    $("companies-status").textContent='Loading companies, sites, and contacts…';
    Promise.all([NovaraApi.getMasterCompanies(),NovaraApi.getMasterSites(),NovaraApi.getContacts()]).then(function(values){
      state.companies=(values[0]&&values[0].companies)||[];
      state.sites=(values[1]&&values[1].sites)||[];
      state.contacts=(values[2]&&values[2].contacts)||[];
      populateStates();render();
    }).catch(function(err){$("companies-status").textContent=err&&err.message?err.message:'Could not load company lookup data.';});
  }

  $("company-search").addEventListener('input',render);
  $("relationship-filter").addEventListener('change',render);
  $("program-filter").addEventListener('change',render);
  $("utility-filter").addEventListener('change',render);
  $("state-filter").addEventListener('change',render);
  $("clear-company-search").addEventListener('click',function(){
    $("company-search").value='';$("relationship-filter").value='';$("program-filter").value='';$("utility-filter").value='';$("state-filter").value='';render();$("company-search").focus();
  });
  $("companies-body").addEventListener('click',function(event){var btn=event.target.closest('.company-link');if(btn)showCompany(btn.getAttribute('data-company-id'));});
  $("close-company-detail").addEventListener('click',function(){$("company-detail").hidden=true;});

  load();
})();
