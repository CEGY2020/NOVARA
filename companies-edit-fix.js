(function(){
  "use strict";
  function $(id){return document.getElementById(id);}
  function text(v){return v==null?"":String(v).trim();}
  function yes(v){return text(v).toUpperCase()==="YES";}
  function currentCompanyId(){
    var fields=document.querySelectorAll('#detail-fields .detail-field');
    for(var i=0;i<fields.length;i++){
      var label=fields[i].querySelector('span');
      var value=fields[i].querySelector('strong');
      if(label&&value&&text(label.textContent)==='Company ID')return text(value.textContent);
    }
    return '';
  }
  function setStatus(msg){var el=$('company-edit-status');if(el)el.textContent=msg||'';}
  function openEditor(event){
    if(event){event.preventDefault();event.stopImmediatePropagation();}
    var cid=currentCompanyId();
    if(!cid){setStatus('Could not identify the company.');return;}
    if(!window.NovaraApi||!NovaraApi.getMasterCompanies){setStatus('NOVARA API unavailable.');return;}
    NovaraApi.getMasterCompanies({companyId:cid}).then(function(payload){
      var rows=(payload&&payload.companies)||[];
      var c=rows.find(function(r){return text(r.CompanyID||r.companyId)===cid;})||rows[0];
      if(!c){setStatus('Company record not found.');return;}
      $('edit-company-name').value=text(c.CompanyName||c.companyName);
      $('edit-company-id').value=text(c.CompanyID||c.companyId);
      $('edit-master-id').value=text(c.MasterID||c.masterId);
      $('edit-relationship').value=text(c.RelationshipType)||'OMC - Review';
      $('edit-example-site').value=text(c.ExampleSite);
      $('edit-needs-review').value=yes(c.NeedsReview)?'YES':'NO';
      $('edit-review-reason').value=text(c.ReviewReason);
      $('edit-program-pool').checked=yes(c.ProgramPool);
      $('edit-program-dhw').checked=yes(c.ProgramDHW);
      $('edit-program-hvac').checked=yes(c.ProgramHVAC);
      $('edit-program-restaurant').checked=yes(c.ProgramRestaurant);
      $('edit-program-other').checked=yes(c.ProgramOther);
      setStatus('');
      $('record-edit-panel').hidden=true;
      $('company-edit-panel').hidden=false;
      $('company-edit-panel').scrollIntoView({behavior:'smooth',block:'center'});
    }).catch(function(err){setStatus((err&&err.message)||'Could not load company record.');});
  }
  function saveEditor(event){
    event.preventDefault();event.stopImmediatePropagation();
    var payload={
      CompanyID:text($('edit-company-id').value),
      MasterID:text($('edit-master-id').value),
      CompanyName:text($('edit-company-name').value),
      RelationshipType:text($('edit-relationship').value),
      ProgramPool:$('edit-program-pool').checked?'YES':'NO',
      ProgramDHW:$('edit-program-dhw').checked?'YES':'NO',
      ProgramHVAC:$('edit-program-hvac').checked?'YES':'NO',
      ProgramRestaurant:$('edit-program-restaurant').checked?'YES':'NO',
      ProgramOther:$('edit-program-other').checked?'YES':'NO',
      ExampleSite:text($('edit-example-site').value),
      ImportAsLead:'NO',
      NeedsReview:text($('edit-needs-review').value),
      ReviewReason:text($('edit-review-reason').value)
    };
    if(!payload.CompanyID||!payload.CompanyName){setStatus('Company ID and Company Name are required.');return;}
    setStatus('Saving…');
    NovaraApi.updateMasterCompany(payload).then(function(){
      setStatus('Saved. Refreshing…');
      setTimeout(function(){window.location.reload();},500);
    }).catch(function(err){setStatus((err&&err.message)||'Save failed.');});
  }
  document.addEventListener('DOMContentLoaded',function(){
    var editBtn=$('edit-company-btn'), form=$('company-edit-form'), cancel=$('cancel-company-edit');
    if(editBtn)editBtn.addEventListener('click',openEditor,true);
    if(form)form.addEventListener('submit',saveEditor,true);
    if(cancel)cancel.addEventListener('click',function(event){event.preventDefault();event.stopImmediatePropagation();$('company-edit-panel').hidden=true;},true);
  });
})();
