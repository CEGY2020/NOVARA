(function(){
'use strict';
var q=new URLSearchParams(location.search),leadId=q.get('leadId')||'';
var program='DHW';
var lead=document.getElementById('leadId'),root=document.getElementById('reviewSections'),status=document.getElementById('status');
var save=document.getElementById('saveReview'),state=document.getElementById('saveState');
var reviewerName=document.getElementById('reviewerName'),reviewerCompany=document.getElementById('reviewerCompany'),overall=document.getElementById('overallStatus'),reviewDate=document.getElementById('reviewDate');
var back=document.getElementById('backToEvaluation');
if(lead)lead.value=leadId;if(back)back.href='dhw-site-evaluation.html?leadId='+encodeURIComponent(leadId);
if(reviewDate&&!reviewDate.value)reviewDate.value=new Date().toISOString().slice(0,10);
var key='novara.dhwReview.v1.'+(leadId||'unlinked');
var sections=[
 {id:'property',title:'Property & System',fields:[['siteName','Property / Site'],['address','Site Address'],['city','City'],['state','State'],['zip','ZIP'],['buildingType','Property Type'],['systems','Number of DHW Systems'],['systemId','System ID'],['systemLocation','System Location'],['units','Units / Rooms Served'],['contractor','Service Contractor'],['fuel','Fuel Type'],['gasMeterId','Gas Meter ID'],['utility','Gas Utility']]},
 {id:'heaters',title:'Water Heaters',fields:[['totalInputBtu','Total Heater Input BTU/h'],['totalOutputBtu','Total Heater Output BTU/h']]},
 {id:'storage',title:'Storage & Operating Conditions',fields:[['storageTankQty','Storage Tank Quantity'],['storageTankGallons','Gallons per Storage Tank'],['totalStorageGallons','Total Storage Gallons'],['supply','DHW Supply Temperature °F'],['returnTemp','DHW Return Temperature °F'],['mixingValve','Mixing Valve']]},
 {id:'pump',title:'Recirculation Pump',fields:[['pumpMake','Pump Make'],['pumpModel','Pump Model'],['pumpSerial','Pump Serial Number']]},
 {id:'multifamily',title:'Multifamily Load Information',show:function(d){return String(d.buildingType||'').toLowerCase()==='multifamily'},fields:[['mf1br','1-Bedroom Apartments Served'],['mf2br','2-Bedroom Apartments Served'],['mf3br','3-Bedroom Apartments Served'],['mf4br','4-Bedroom Apartments Served'],['mfShowers','Number of Showers'],['mfDishwashers','Dishwashers in Apartments'],['mfUnitWashers','Clothes Washers in Apartments'],['mfCommonWashers','Common-Area Clothes Washers']]},
 {id:'hotel',title:'Hotel Load Information',show:function(d){return String(d.buildingType||'').toLowerCase()==='hotel'},fields:[['hotelRooms','Number of Rooms Served'],['hotelLaundry','Laundry Connected to DHW'],['hotelKitchen','Kitchen / Restaurant Load']]},
 {id:'gas',title:'Gas & Evaluation Data',fields:[['therms','Annual Gas Use (therms)'],['gasCost','Annual Gas Cost'],['projectCost','Estimated Project Cost'],['verification','Equipment / Nameplate Verification'],['notes','Site Evaluation Notes']]}
];
function text(v){return v==null||String(v).trim()===''?'Not entered':String(v)}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function loadSaved(){try{return JSON.parse(localStorage.getItem(key)||'{}')||{}}catch(e){return {}}}
function render(d,saved){
 root.innerHTML='';
 sections.forEach(function(sec){if(sec.show&&!sec.show(d))return;
  var el=document.createElement('section');el.className='review-section';el.dataset.reviewSection=sec.id;
  var html='<h3>'+esc(sec.title)+'</h3><div class="review-grid">';
  sec.fields.forEach(function(f){html+='<div class="review-item"><strong>'+esc(f[1])+'</strong><span>'+esc(text(d[f[0]]))+'</span></div>'});html+='</div>';
  if(sec.id==='heaters')html+=heaterTable(d.waterHeatersJson);
  var rs=(saved.sections&&saved.sections[sec.id])||{};
  html+='<div class="review-controls"><label class="form-field"><span>Section Review</span><select data-review-status><option'+sel(rs.status,'Approved')+'>Approved</option><option'+sel(rs.status,'Needs Correction')+'>Needs Correction</option><option'+sel(rs.status,'Not Applicable')+'>Not Applicable</option></select></label><label class="form-field"><span>Reviewer Comments</span><textarea data-review-comment>'+esc(rs.comment||'')+'</textarea></label></div>';
  el.innerHTML=html;root.appendChild(el);
 });
}
function sel(v,x){return v===x?' selected':''}
function heaterTable(raw){var a=[];try{a=JSON.parse(raw||'[]');if(!Array.isArray(a))a=[]}catch(e){}if(!a.length)return '<p class="empty">No individual water heater records entered.</p>';
 var h='<table class="heater-table"><thead><tr><th>#</th><th>Make</th><th>Model</th><th>Serial</th><th>Input BTU/h</th><th>Output BTU/h</th></tr></thead><tbody>';
 a.forEach(function(x,i){h+='<tr><td>'+(i+1)+'</td><td>'+esc(text(x.make))+'</td><td>'+esc(text(x.model))+'</td><td>'+esc(text(x.serial))+'</td><td>'+esc(text(x.inputBtu))+'</td><td>'+esc(text(x.outputBtu))+'</td></tr>'});return h+'</tbody></table>';
}
function collect(){var r={reviewerName:reviewerName.value,reviewerCompany:reviewerCompany.value,overallStatus:overall.value,reviewDate:reviewDate.value,updatedAt:new Date().toISOString(),sections:{}};root.querySelectorAll('[data-review-section]').forEach(function(s){r.sections[s.dataset.reviewSection]={status:s.querySelector('[data-review-status]').value,comment:s.querySelector('[data-review-comment]').value}});return r}
function fillTop(s){reviewerName.value=s.reviewerName||'';reviewerCompany.value=s.reviewerCompany||'';overall.value=s.overallStatus||'Draft';reviewDate.value=s.reviewDate||reviewDate.value}
function setStatus(msg,bad){status.textContent=msg||'';status.style.color=bad?'#9b1c1c':''}
function mark(msg){state.textContent=msg}
if(save)save.addEventListener('click',function(){localStorage.setItem(key,JSON.stringify(collect()));mark('Saved');setStatus('Review saved in this browser. The DHW master evaluation was not changed.')});
if(!leadId){setStatus('Lead ID is required. Open the Review Portal from a DHW Site Evaluation.',true);render({},loadSaved());return}
var saved=loadSaved();fillTop(saved);setStatus('Loading DHW evaluation…');
NovaraApi.getSiteEvaluation(leadId,program).then(function(r){var d=r&&r.evaluation&&r.evaluation.Fields||{};render(d,saved);setStatus(r&&r.evaluation?'DHW evaluation loaded. Review the sections below.':'No saved DHW evaluation was found for this Lead ID.',!r||!r.evaluation)}).catch(function(e){render({},saved);setStatus(e.message||'Could not load DHW evaluation.',true)});
})();