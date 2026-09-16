(function(){
  "use strict";

  function text(v){return v==null?"":String(v).trim();}
  function norm(v){return text(v).toLowerCase().replace(/\./g,"").replace(/\s+/g," ").trim();}
  function yes(v){return text(v).toUpperCase()==="YES";}
  function esc(v){return text(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#39;");}

  var SDGE_CITIES=["aliso viejo","bonita","bonsall","carlsbad","chula vista","coronado","dana point","del mar","descanso","el cajon","encinitas","escondido","fallbrook","imperial beach","la jolla","la mesa","laguna beach","laguna hills","laguna niguel","lakeside","lemon grove","mission beach","mission valley","mission viejo","national city","oceanside","otay mesa","pacific beach","poway","ramona","rancho bernardo","rancho san diego","rancho santa fe","san clemente","san diego","san diego / mission hills","san juan capistrano","san marcos","san ysidro","santee","solana beach","spring valley","vista","leucadia"];
  var PGE_CITIES=["citrus heights","dublin","emeryville","fremont","fresno","milpitas","oakland","palo alto","pleasant hill","roseville","saint helena","st helena","san francisco","san jose","san lorenzo","san mateo","stockton","sunnyvale","vallejo"];
  var SOCALGAS_CITIES=["anaheim","bakersfield","brea","buena park","burbank","cerritos","chatsworth","chino","city of industry","corona","costa mesa","culver city","cypress","desert hot springs","diamond bar","downey","encino","fountain valley","fullerton","garden grove","gardena","glendale","hawaiian gardens","hawthorne","hermosa beach","hollywood","huntington beach","indio","irvine","la habra","la mirada","la quinta","la verne","laguna woods","lake forest","lakewood","lancaster","long beach","los angeles","marina del rey","menifee","monrovia","montclair","newport beach","newport coast","north hills","north hollywood","northridge","norwalk","ontario","orange","oxnard","palm desert","palm springs","palos verdes peninsula","pasadena","pico rivera","placentia","rancho palos verdes","rancho santa margarita","redondo beach","rosemead","san bernardino","san marino","santa ana","santa monica","seal beach","studio city","temecula","torrance","tustin","tustin ranch","valencia","valley village","van nuys","ventura","w hollywood","west covina","west hollywood","whittier","woodland hills","yorba linda"];
  function inList(city,list){return list.indexOf(norm(city))!==-1;}
  function regionForCity(city){if(inList(city,SDGE_CITIES))return"SDG&E";if(inList(city,PGE_CITIES))return"PG&E";if(inList(city,SOCALGAS_CITIES))return"SoCalGas";return"Verify";}

  function printPoolSoCalGas(){
    if(!window.NovaraApi)return;
    var button=document.getElementById("print-pool-socalgas");
    var old=button?button.textContent:"";
    if(button){button.disabled=true;button.textContent="Preparing…";}
    Promise.all([NovaraApi.getMasterSites(),NovaraApi.getMasterCompanies()]).then(function(values){
      var sites=(values[0]&&values[0].sites)||[];
      var companies=(values[1]&&values[1].companies)||[];
      var names={};
      companies.forEach(function(c){names[text(c.CompanyID)]=text(c.CompanyName);});
      var rows=sites.filter(function(s){return yes(s.ProgramPool)&&regionForCity(s.City)==="SoCalGas";});
      rows.sort(function(a,b){var ca=names[text(a.CompanyID)]||"",cb=names[text(b.CompanyID)]||"";return ca.localeCompare(cb)||text(a.SiteName).localeCompare(text(b.SiteName));});
      var body=rows.map(function(s,i){return '<tr><td>'+(i+1)+'</td><td>'+esc(names[text(s.CompanyID)]||s.RelatedCompany||'—')+'</td><td>'+esc(s.SiteName)+'</td><td>'+esc(s.Address)+'</td><td>'+esc(s.City)+'</td><td>'+esc(s.State)+'</td><td>'+esc(s.Zip)+'</td><td>'+esc(s.Phone||'')+'</td></tr>';}).join('');
      var win=window.open("","_blank");
      if(!win)throw new Error("Pop-up blocked. Allow pop-ups for NOVARA and try again.");
      win.document.write('<!doctype html><html><head><meta charset="utf-8"><title>NOVARA Pool SoCalGas Sites</title><style>body{font-family:Arial,sans-serif;color:#000;margin:24px}h1{font-size:22px;margin:0 0 6px}p{margin:0 0 18px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #999;padding:6px;text-align:left;vertical-align:top}th{background:#dbeaf5}@media print{body{margin:10mm}button{display:none}thead{display:table-header-group}}</style></head><body><h1>NOVARA Pool Sites — SoCalGas Region</h1><p>Total sites: <strong>'+rows.length+'</strong></p><button onclick="window.print()">Print</button><table><thead><tr><th>#</th><th>Company</th><th>Site</th><th>Address</th><th>City</th><th>State</th><th>ZIP</th><th>Phone</th></tr></thead><tbody>'+body+'</tbody></table><script>setTimeout(function(){window.print();},250);<\/script></body></html>');
      win.document.close();
    }).catch(function(err){alert(err&&err.message?err.message:"Could not prepare site list.");}).finally(function(){if(button){button.disabled=false;button.textContent=old||"Print Pool SoCalGas Sites";}});
  }

  var button=document.getElementById("print-pool-socalgas");
  if(button)button.addEventListener("click",printPoolSoCalGas);
})();
