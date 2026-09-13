(function(){
  "use strict";
  var api=window.NovaraApi,leads=[],sites=[],current=null;
  function el(id){return document.getElementById(id)}
  function text(v){return v==null?"":String(v)}
  function set(id,v){if(el(id))el(id).value=text(v)}
  function fieldValue(id){return el(id)?el(id).value:""}
  function pick(obj,names){obj=obj||{};for(var i=0;i<names.length;i++){var v=obj[names[i]];if(v!=null&&String(v).trim()!=="")return v}return""}
  function fields(){
    var ids=["vssDate","vssCompletedBy","poolNameId","poolType","poolLengthFt","poolWidthFt","poolSurfaceAreaSqFt","poolVolumeGallons","currentPoolSetpointF","observedPoolTempF","poolOpenTime","poolCloseTime","operatingDays","existingControl","heaterManufacturer","heaterModel","heaterQuantity","heaterBTUInput","totalConnectedBTU","fuel","heaterNotes","vssStatus","programEligibility","customerApprovalStatus","moreInformationRequired","vssNotes"];
    var o={};ids.forEach(function(id){o[id]=fieldValue(id)});
    o.SiteID=fieldValue("siteId");o.SiteName=fieldValue("siteName");o.CompanyName=fieldValue("companyName");o.SiteAddress=fieldValue("siteAddress");o.CityStateZip=fieldValue("cityStateZip");
    return o;
  }
  function loadFields(o){o=o||{};Object.keys(o).forEach(function(k){if(el(k))set(k,o[k])})}
  function clearExisting(){["siteName","companyName","contactName","contactPhone","contactEmail","mgmtCompany","siteId","siteAddress","cityStateZip"].forEach(function(x){set(x,"")})}
  function findSite(siteId){return sites.find(function(s){return text(pick(s,["siteId","SiteID"]))===text(siteId)})||null}
  function cityStateZip(lead,site){
    var city=pick(lead,["city","City"])||pick(site,["city","City"]),state=pick(lead,["state","State"])||pick(site,["state","State"]),zip=pick(lead,["zip","ZIP","postalCode","PostalCode"])||pick(site,["zip","ZIP","postalCode","PostalCode"]);
    return [city,state,zip].filter(function(v){return text(v).trim()!==""}).join(city&&state?", ":" ").replace(/, ([A-Z]{2}), /,", $1 ");
  }
  function selectLead(id){
    current=leads.find(function(x){return text(x.leadId)===text(id)})||null;
    if(!current){clearExisting();return}
    var site=findSite(current.siteId);
    set("siteName",current.siteName||pick(site,["siteName","SiteName","name","Name"]));
    set("companyName",current.companyName||current.ownerName||"");
    set("contactName",current.contactName);set("contactPhone",current.contactPhone);set("contactEmail",current.contactEmail);
    set("mgmtCompany",current.mgmtCompanyName||pick(site,["mgmtCompany","MgmtCompany","managementCompany","ManagementCompany"]));
    set("siteId",current.siteId);
    set("siteAddress",current.siteAddress||pick(site,["address","Address","siteAddress","SiteAddress","address1","Address1"]));
    set("cityStateZip",cityStateZip(current,site));
    api.getSiteEvaluation(current.leadId,"Pool").then(function(r){if(r&&r.evaluation&&r.evaluation.Fields)loadFields(r.evaluation.Fields)}).catch(function(){});
  }
  function syncPrint(){
    document.querySelectorAll("[data-print]").forEach(function(node){var id=node.getAttribute("data-print"),v="";if(id==="leadId")v=fieldValue("leadId");else v=fieldValue(id);node.textContent=v||"____________________"});
  }
  function init(){
    if(!api)return;
    Promise.all([api.getLeads(),api.getSites().catch(function(){return{sites:[]}})]).then(function(results){
      leads=(results[0]&&results[0].leads)||[];sites=(results[1]&&results[1].sites)||[];
      leads=leads.filter(function(l){var t=text(l.systemType||l.SystemType).toLowerCase();return !t||t.indexOf("pool")!==-1});
      leads.sort(function(a,b){return text(a.siteName||a.companyName).localeCompare(text(b.siteName||b.companyName))});
      var s=el("leadId");leads.forEach(function(l){var o=document.createElement("option");o.value=l.leadId;o.textContent=(l.siteName||l.companyName||l.leadId)+" — "+l.leadId;s.appendChild(o)});
      var params=new URLSearchParams(window.location.search),lead=params.get("leadId");if(lead){s.value=lead;selectLead(lead)}
    }).catch(function(e){el("vssStatusMessage").textContent=e.message});
  }
  el("leadId").addEventListener("change",function(){selectLead(this.value)});
  ["poolLengthFt","poolWidthFt"].forEach(function(id){el(id).addEventListener("input",function(){var a=parseFloat(fieldValue("poolLengthFt")),b=parseFloat(fieldValue("poolWidthFt"));if(isFinite(a)&&isFinite(b))set("poolSurfaceAreaSqFt",(a*b).toFixed(1))})});
  ["heaterQuantity","heaterBTUInput"].forEach(function(id){el(id).addEventListener("input",function(){var a=parseFloat(fieldValue("heaterQuantity")),b=parseFloat(fieldValue("heaterBTUInput"));if(isFinite(a)&&isFinite(b))set("totalConnectedBTU",Math.round(a*b))})});
  el("vssForm").addEventListener("submit",function(e){e.preventDefault();if(!current){el("vssStatusMessage").textContent="Select a Lead first.";return}el("vssStatusMessage").textContent="Saving…";api.saveSiteEvaluation({LeadID:current.leadId,Program:"Pool",Fields:fields()}).then(function(){el("vssStatusMessage").textContent="Post-VSS information saved to NOVARA."}).catch(function(err){el("vssStatusMessage").textContent=err.message||"Save failed."})});
  el("printBtn").addEventListener("click",function(){if(!current){el("vssStatusMessage").textContent="Select a Lead first.";return}syncPrint();window.print()});
  init();
})();