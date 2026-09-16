(function(){
  "use strict";

  function text(v){return v==null?"":String(v).trim();}
  function yn(v){return v?"YES":"NO";}
  function el(id){return document.getElementById(id);}

  var form=el("company-edit-form");
  if(!form||!window.NovaraApi)return;

  form.addEventListener("submit",function(event){
    event.preventDefault();
    event.stopImmediatePropagation();

    var companyId=text(el("edit-company-id")&&el("edit-company-id").value);
    if(!companyId)return;

    var desired={
      ProgramPool:yn(el("edit-program-pool").checked),
      ProgramDHW:yn(el("edit-program-dhw").checked),
      ProgramHVAC:yn(el("edit-program-hvac").checked),
      ProgramRestaurant:yn(el("edit-program-restaurant").checked),
      ProgramOther:yn(el("edit-program-other").checked)
    };

    var companyPayload={
      CompanyID:companyId,
      MasterID:text(el("edit-master-id").value),
      CompanyName:text(el("edit-company-name").value),
      RelationshipType:text(el("edit-relationship").value),
      ProgramPool:desired.ProgramPool,
      ProgramDHW:desired.ProgramDHW,
      ProgramHVAC:desired.ProgramHVAC,
      ProgramRestaurant:desired.ProgramRestaurant,
      ProgramOther:desired.ProgramOther,
      ExampleSite:text(el("edit-example-site").value),
      ImportAsLead:"NO",
      NeedsReview:text(el("edit-needs-review").value),
      ReviewReason:text(el("edit-review-reason").value)
    };

    var status=el("company-edit-status");
    if(status)status.textContent="Saving company…";

    NovaraApi.updateMasterCompany(companyPayload)
      .then(function(){
        var syncBox=el("sync-company-programs-sites");
        if(syncBox && !syncBox.checked)return null;
        if(status)status.textContent="Company saved. Updating linked sites…";
        return NovaraApi.getMasterSites({companyId:companyId});
      })
      .then(function(result){
        if(!result)return null;
        var sites=(result&&result.sites)||[];
        if(!sites.length)return [];
        if(status)status.textContent="Updating "+sites.length+" linked site"+(sites.length===1?"":"s")+"…";
        return Promise.all(sites.map(function(r){
          return NovaraApi.updateMasterSite({
            MasterID:text(r.MasterID),
            SiteID:text(r.SiteID),
            CompanyID:text(r.CompanyID),
            SiteKey:text(r.SiteKey),
            SiteName:text(r.SiteName),
            Address:text(r.Address),
            City:text(r.City),
            State:text(r.State),
            Zip:text(r.Zip),
            Phone:text(r.Phone),
            CustomerNumber:text(r.CustomerNumber),
            ProgramPool:desired.ProgramPool,
            ProgramDHW:desired.ProgramDHW,
            ProgramHVAC:desired.ProgramHVAC,
            ProgramRestaurant:desired.ProgramRestaurant,
            ProgramOther:desired.ProgramOther,
            RelatedCompany:text(r.RelatedCompany),
            SourceCount:text(r.SourceCount),
            SourceRefs:text(r.SourceRefs),
            ImportAsLead:"NO",
            NeedsReview:text(r.NeedsReview)||"NO",
            ReviewReason:text(r.ReviewReason),
            Status:text(r.Status)||"Needs Review"
          });
        }));
      })
      .then(function(results){
        if(status){
          if(results===null)status.textContent="Company saved.";
          else status.textContent="Saved. Company and linked site programs updated.";
        }
        setTimeout(function(){window.location.reload();},700);
      })
      .catch(function(err){
        if(status)status.textContent="Save failed: "+(err&&err.message?err.message:"Unknown error");
      });
  },true);
})();
