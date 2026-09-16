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

  function applyRegionToOpenCompany(){
    var filter=document.getElementById("utility-filter");
    var selected=filter?text(filter.value):"";
    if(!selected)return;

    var siteBody=document.getElementById("detail-sites-body");
    if(!siteBody)return;
    var visibleSiteNames={};
    var visibleSites=0;
    Array.prototype.forEach.call(siteBody.querySelectorAll("tr"),function(row){
      var cells=row.querySelectorAll("td");
      if(cells.length<5)return;
      var siteName=text(cells[0].textContent);
      var city=text(cells[4].textContent);
      var match=regionForCity(city)===selected;
      row.style.display=match?"":"none";
      if(match){visibleSites++;visibleSiteNames[norm(siteName)]=true;}
    });

    var contactBody=document.getElementById("detail-contacts-body");
    var visibleContacts=0;
    if(contactBody){
      Array.prototype.forEach.call(contactBody.querySelectorAll("tr"),function(row){
        var cells=row.querySelectorAll("td");
        if(cells.length<3)return;
        var siteName=norm(cells[2].textContent);
        var match=!!visibleSiteNames[siteName];
        row.style.display=match?"":"none";
        if(match)visibleContacts++;
      });
    }

    var sitesHeading=document.getElementById("sites-heading");
    var contactsHeading=document.getElementById("contacts-heading");
    if(sitesHeading)sitesHeading.textContent="Linked Sites — "+selected+" ("+visibleSites+")";
    if(contactsHeading)contactsHeading.textContent="Linked Contacts — "+selected+" ("+visibleContacts+")";

    var detailFields=document.getElementById("detail-fields");
    if(detailFields){
      Array.prototype.forEach.call(detailFields.querySelectorAll(".detail-field"),function(card){
        var label=card.querySelector("span"),value=card.querySelector("strong");
        if(!label||!value)return;
        var key=text(label.textContent);
        if(key==="Utility Region")value.textContent=selected;
        if(key==="Linked Sites")value.textContent=String(visibleSites);
        if(key==="Linked Contacts")value.textContent=String(visibleContacts);
      });
    }
  }

  var body=document.getElementById("companies-body");
  if(body){
    body.addEventListener("click",function(event){
      if(event.target.closest(".company-link"))setTimeout(applyRegionToOpenCompany,0);
    });
  }
  var utility=document.getElementById("utility-filter");
  if(utility){
    utility.addEventListener("change",function(){setTimeout(applyRegionToOpenCompany,0);});
  }
})();
