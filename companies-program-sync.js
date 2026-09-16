(function(){
  "use strict";

  function text(v){return v==null?"":String(v).trim();}
  function yn(v){return v?"YES":"NO";}

  var form=document.getElementById("company-edit-form");
  if(!form)return;

  var programRow=document.querySelector("#company-edit-form .check-row");
  if(programRow && !document.getElementById("sync-company-programs-sites")){
    var sync=document.createElement("label");
    sync.style.marginLeft="10px";
    sync.style.fontWeight="700";
    sync.innerHTML='<input id="sync-company-programs-sites" type="checkbox" checked> Apply these program changes to all linked sites';
    programRow.appendChild(sync);
  }

  form.addEventListener("submit",function(){
    var syncBox=document.getElementById("sync-company-programs-sites");
    if(!syncBox || !syncBox.checked || !window.NovaraApi)return;

    var companyId=text(document.getElementById("edit-company-id")&&document.getElementById("edit-company-id").value);
    if(!companyId)return;

    var desired={
      ProgramPool:yn(document.getElementById("edit-program-pool").checked),
      ProgramDHW:yn(document.getElementById("edit-program-dhw").checked),
      ProgramHVAC:yn(document.getElementById("edit-program-hvac").checked),
      ProgramRestaurant:yn(document.getElementById("edit-program-restaurant").checked),
      ProgramOther:yn(document.getElementById("edit-program-other").checked)
    };

    var status=document.getElementById("company-edit-status");
    setTimeout(function(){
      NovaraApi.getMasterSites({companyId:companyId}).then(function(result){
        var sites=(result&&result.sites)||[];
        if(!sites.length)return [];
        if(status)status.textContent="Saving company and syncing "+sites.length+" linked site"+(sites.length===1?"":"s")+"…";
        return Promise.all(sites.map(function(r){
          var payload={
            MasterID:text(r.MasterID),SiteID:text(r.SiteID),CompanyID:text(r.CompanyID),SiteKey:text(r.SiteKey),SiteName:text(r.SiteName),
            Address:text(r.Address),City:text(r.City),State:text(r.State),Zip:text(r.Zip),Phone:text(r.Phone),CustomerNumber:text(r.CustomerNumber),
            ProgramPool:desired.ProgramPool,ProgramDHW:desired.ProgramDHW,ProgramHVAC:desired.ProgramHVAC,ProgramRestaurant:desired.ProgramRestaurant,ProgramOther:desired.ProgramOther,
            RelatedCompany:text(r.RelatedCompany),SourceCount:text(r.SourceCount),SourceRefs:text(r.SourceRefs),ImportAsLead:"NO",
            NeedsReview:text(r.NeedsReview)||"NO",ReviewReason:text(r.ReviewReason),Status:text(r.Status)||"Needs Review"
          };
          return NovaraApi.updateMasterSite(payload);
        }));
      }).then(function(results){
        if(!results)return;
        if(status)status.textContent="Saved. Linked site programs updated.";
        setTimeout(function(){window.location.reload();},700);
      }).catch(function(err){
        if(status)status.textContent="Company saved, but site program sync failed: "+(err&&err.message?err.message:"Unknown error");
      });
    },150);
  },true);
})();
