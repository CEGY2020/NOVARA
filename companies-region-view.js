(function(){
  "use strict";

  function text(v){return v==null?"":String(v).trim();}
  function norm(v){return text(v).toLowerCase().replace(/\./g,"").replace(/\s+/g," ").trim();}

  var SDGE_CITIES=["aliso viejo","bonita","bonsall","carlsbad","chula vista","coronado","dana point","del mar","descanso","el cajon","encinitas","escondido","fallbrook","imperial beach","la jolla","la mesa","laguna beach","laguna hills","laguna niguel","lakeside","lemon grove","mission beach","mission valley","mission viejo","national city","oceanside","otay mesa","pacific beach","poway","ramona","rancho bernardo","rancho san diego","rancho santa fe","san clemente","san diego","san diego / mission hills","san juan capistrano","san marcos","san ysidro","santee","solana beach","spring valley","vista","leucadia"];
  var PGE_CITIES=["citrus heights","dublin","emeryville","fremont","fresno","milpitas","oakland","palo alto","pleasant hill","roseville","saint helena","st helena","san francisco","san jose","san lorenzo","san mateo","stockton","sunnyvale","vallejo"];
  var SOCALGAS_CITIES=["anaheim","bakersfield","brea","buena park","burbank","cerritos","chatsworth","chino","city of industry","corona","costa mesa","culver city","cypress","desert hot springs","diamond bar","downey","encino","fountain valley","fullerton","garden grove","gardena","glendale","hawaiian gardens","hawthorne","hermosa beach","hollywood","huntington beach","indio","irvine","la habra","la mirada","la quinta","la verne","laguna woods","lake forest","lakewood","lancaster","long beach","los angeles","marina del rey","menifee","monrovia","montclair","newport beach","newport coast","north hills","north hollywood","northridge","norwalk","ontario","orange","oxnard","palm desert","palm springs","palos verdes peninsula","pasadena","pico rivera","placentia","rancho palos verdes","rancho santa margarita","redondo beach","rosemead","san bernardino","san marino","santa ana","santa monica","seal beach","studio city","temecula","torrance","tustin","tustin ranch","valencia","valley village","van nuys","ventura","w hollywood","west covina","west hollywood","whittier","woodland hills","yorba linda"];

  function inList(city,list){return list.indexOf(norm(city))!==-1;}
  function regionForCity(city){
    if(inList(city,SDGE_CITIES))return "SDG&E";
    if(inList(city,PGE_CITIES))return "PG&E";
    if(inList(city,SOCALGAS_CITIES))return "SoCalGas";
    return "Verify";
  }

  function rowHasProgram(row,selectedProgram){
    if(!selectedProgram)return true;
    var tags=row.querySelectorAll(".program-tag");
    for(var i=0;i<tags.length;i++){
      if(text(tags[i].textContent)===selectedProgram)return true;
    }
    return false;
  }

  function applyFiltersToOpenCompany(){
    var utilityFilter=document.getElementById("utility-filter");
    var programFilter=document.getElementById("program-filter");
    var selectedUtility=utilityFilter?text(utilityFilter.value):"";
    var selectedProgram=programFilter?text(programFilter.value):"";
    if(!selectedUtility && !selectedProgram)return;

    var siteBody=document.getElementById("detail-sites-body");
    if(!siteBody)return;
    var visibleSiteNames={};
    var visibleSites=0;
    var totalSites=0;

    Array.prototype.forEach.call(siteBody.querySelectorAll("tr"),function(row){
      var cells=row.querySelectorAll("td");
      if(cells.length<5)return;
      totalSites++;
      var siteName=text(cells[0].textContent);
      var city=text(cells[4].textContent);
      var utilityMatch=!selectedUtility || regionForCity(city)===selectedUtility;
      var programMatch=rowHasProgram(row,selectedProgram);
      var match=utilityMatch && programMatch;
      row.style.display=match?"":"none";
      if(match){visibleSites++;visibleSiteNames[norm(siteName)]=true;}
    });

    var contactBody=document.getElementById("detail-contacts-body");
    var visibleContacts=0;
    var totalContacts=0;
    if(contactBody){
      Array.prototype.forEach.call(contactBody.querySelectorAll("tr"),function(row){
        var cells=row.querySelectorAll("td");
        if(cells.length<3)return;
        totalContacts++;
        var siteName=norm(cells[2].textContent);
        var match=!!visibleSiteNames[siteName];
        row.style.display=match?"":"none";
        if(match)visibleContacts++;
      });
    }

    var filterLabel=[];
    if(selectedProgram)filterLabel.push(selectedProgram);
    if(selectedUtility)filterLabel.push(selectedUtility);
    var labelText=filterLabel.join(" / ");

    var sitesHeading=document.getElementById("sites-heading");
    var contactsHeading=document.getElementById("contacts-heading");
    if(sitesHeading)sitesHeading.textContent="Linked Sites — "+labelText+" ("+visibleSites+" matching / "+totalSites+" total)";
    if(contactsHeading)contactsHeading.textContent="Linked Contacts — "+labelText+" ("+visibleContacts+" matching / "+totalContacts+" total)";

    var detailFields=document.getElementById("detail-fields");
    if(detailFields){
      Array.prototype.forEach.call(detailFields.querySelectorAll(".detail-field"),function(card){
        var label=card.querySelector("span"),value=card.querySelector("strong");
        if(!label||!value)return;
        var key=text(label.textContent);
        if(key==="Utility Region" && selectedUtility)value.textContent=selectedUtility;
        if(key==="Linked Sites")value.textContent=visibleSites+" matching / "+totalSites+" total";
        if(key==="Linked Contacts")value.textContent=visibleContacts+" matching / "+totalContacts+" total";
      });
    }
  }

  var body=document.getElementById("companies-body");
  if(body){
    body.addEventListener("click",function(event){
      if(event.target.closest(".company-link"))setTimeout(applyFiltersToOpenCompany,0);
    });
  }
  var utility=document.getElementById("utility-filter");
  if(utility){utility.addEventListener("change",function(){setTimeout(applyFiltersToOpenCompany,0);});}
  var program=document.getElementById("program-filter");
  if(program){program.addEventListener("change",function(){setTimeout(applyFiltersToOpenCompany,0);});}
})();
