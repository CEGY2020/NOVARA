(function(){
  "use strict";
  function text(v){return v==null?"":String(v).trim();}
  function norm(v){return text(v).toLowerCase().replace(/\./g,"").replace(/\s+/g," ").trim();}
  function yes(v){return text(v).toUpperCase()==="YES";}

  var SDGE_CITIES=["aliso viejo","bonita","bonsall","carlsbad","chula vista","coronado","dana point","del mar","descanso","el cajon","encinitas","escondido","fallbrook","imperial beach","la jolla","la mesa","laguna beach","laguna hills","laguna niguel","lakeside","lemon grove","mission beach","mission valley","mission viejo","national city","oceanside","otay mesa","pacific beach","poway","ramona","rancho bernardo","rancho san diego","rancho santa fe","san clemente","san diego","san diego / mission hills","san juan capistrano","san marcos","san ysidro","santee","solana beach","spring valley","vista","leucadia"];
  var PGE_CITIES=["citrus heights","dublin","emeryville","fremont","fresno","milpitas","oakland","palo alto","pleasant hill","roseville","saint helena","st helena","san francisco","san jose","san lorenzo","san mateo","stockton","sunnyvale","vallejo"];
  var SOCALGAS_CITIES=["anaheim","bakersfield","brea","buena park","burbank","cerritos","chatsworth","chino","city of industry","corona","costa mesa","culver city","cypress","desert hot springs","diamond bar","downey","encino","fountain valley","fullerton","garden grove","gardena","glendale","hawaiian gardens","hawthorne","hermosa beach","hollywood","huntington beach","indio","irvine","la habra","la mirada","la quinta","la verne","laguna woods","lake forest","lakewood","lancaster","long beach","los angeles","marina del rey","menifee","monrovia","montclair","newport beach","newport coast","north hills","north hollywood","northridge","norwalk","ontario","orange","oxnard","palm desert","palm springs","palos verdes peninsula","pasadena","pico rivera","placentia","rancho palos verdes","rancho santa margarita","redondo beach","rosemead","san bernardino","san marino","santa ana","santa monica","seal beach","studio city","temecula","torrance","tustin","tustin ranch","valencia","valley village","van nuys","ventura","w hollywood","west covina","west hollywood","whittier","woodland hills","yorba linda"];
  function inList(city,list){return list.indexOf(norm(city))!==-1;}
  function regionForCity(city){if(inList(city,SDGE_CITIES))return"SDG&E";if(inList(city,PGE_CITIES))return"PG&E";if(inList(city,SOCALGAS_CITIES))return"SoCalGas";return"Verify";}
  function siteHasProgram(site,program){if(!program)return true;var key="Program"+program;return yes(site[key]);}

  var sites=[];
  function apply(){
    var programEl=document.getElementById("program-filter"),utilityEl=document.getElementById("utility-filter");
    var program=programEl?text(programEl.value):"",utility=utilityEl?text(utilityEl.value):"";
    if(!program&&!utility)return;
    var allowed={};
    sites.forEach(function(s){
      var programMatch=siteHasProgram(s,program);
      var utilityMatch=!utility||regionForCity(s.City)===utility;
      if(programMatch&&utilityMatch)allowed[text(s.CompanyID)]=true;
    });
    var shown=0,total=0;
    var body=document.getElementById("companies-body");
    if(!body)return;
    Array.prototype.forEach.call(body.querySelectorAll("tr"),function(row){
      var cells=row.querySelectorAll("td");
      if(cells.length<2)return;
      total++;
      var cid=text(cells[1].textContent);
      var match=!!allowed[cid];
      row.style.display=match?"":"none";
      if(match)shown++;
    });
    var status=document.getElementById("companies-status");
    if(status)status.textContent=shown+" companies have matching sites for "+([program,utility].filter(Boolean).join(" / "))+".";
  }

  if(window.NovaraApi){
    NovaraApi.getMasterSites().then(function(result){sites=(result&&result.sites)||[];setTimeout(apply,0);}).catch(function(){});
  }
  ["program-filter","utility-filter","relationship-filter","state-filter","company-search","clear-company-search"].forEach(function(id){
    var e=document.getElementById(id);if(e)e.addEventListener(id==="company-search"?"input":"change",function(){setTimeout(apply,20);});
  });
  var clear=document.getElementById("clear-company-search");if(clear)clear.addEventListener("click",function(){setTimeout(apply,20);});
})();
