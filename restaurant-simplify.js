(function(){
'use strict';

const KEEP_BY_SECTION={
  site:new Set([
    'Restaurant / chain','Site ID','Street address','City','State','ZIP',
    'Utility territory','Time zone','Servicing contractor','Restaurant area (sq ft)'
  ]),
  equipment:new Set([
    'Plant arrangement','Existing plant description','Dedicated recirculation pump',
    'Dishwasher sanitation method','Gas pressure under full load (inches WC)','Water treatment'
  ]),
  core:new Set([
    'Controller / gateway','Controller ID','Connection / communication path',
    'Commissioning technician','Commissioning date','Open-hours outlet target (°F)',
    'Return temperature target (°F)','Recirc mode','Control-write capability verified',
    'Communication outage response'
  ]),
  alert:new Set([
    'Restaurant staff receive notices','Acknowledgement required',
    'Acknowledgement deadline (minutes)','Backup contractor / dispatch contact',
    'After-hours emergency contact','Alarm acknowledgement / closure procedure'
  ]),
  leaks:new Set([
    'Leak detection installed','Leak response arrangement','Shutoff valve installed',
    'Leak test date','Test outcome','Emergency response instructions',
    'Automatic protective action permitted'
  ]),
  service:new Set([
    'Contractor company','Quote / work order number','Job status','Visit date',
    'Diagnosis and root cause','Work performed / proposed scope','Next maintenance date',
    'Warranty / exclusions','Verified incentive ($)','Incentive program / measure',
    'Recurring fault / callback pattern'
  ]),
  advise:new Set([
    'Meals per day','Decision','Observed peak demand (GPM)','Design cold inlet (°F)',
    'Design hot supply (°F)','Design efficiency (decimal)','Proposed brand / exact model',
    'Proposed heater count','Per-unit input (BTU/h)',
    'Manufacturer capacity at design rise (GPM)','Required redundancy',
    'Baseline gas (therms/year)','Proposed gas (therms/year)','Gas price ($/therm)',
    'Remaining life assessment','Evidence and recommendation rationale','Next review date'
  ]),
  report:new Set([
    'Report name','Report family','Scope','Delivery cadence','Delivery day / date',
    'Delivery time','Delivery time zone','Recipients (visible list)','Requested format',
    'Natural-language request','Editable report brief','Question the report should answer'
  ]),
  access:new Set([
    'Executive admin / approver','Review date','Access notes'
  ]),
  utility:new Set([
    'Authorization status','Authorized customer representative',
    'Customer authorization reference / UID','Authorization date',
    'Requested history begins','Requested history ends','Other gas loads on this meter',
    'DHW allocation method / evidence','Integration owner','Connection status',
    'Sync error / action needed'
  ])
};

function moveMealsToAdvise(){
  const site=document.getElementById('section-site');
  const advise=document.getElementById('section-advise');
  if(!site||!advise)return;
  const mealsInput=Array.from(site.querySelectorAll('[data-label]')).find(function(el){
    return el.dataset.label==='Meals per day';
  });
  if(!mealsInput)return;
  const field=mealsInput.closest('.field');
  const grid=advise.querySelector('.fields-grid');
  if(!field||!grid)return;
  field.style.display='';
  delete field.dataset.simpleHidden;
  grid.insertBefore(field,grid.firstChild);
}

function simplifySection(sectionId){
  const section=document.getElementById('section-'+sectionId);
  const keep=KEEP_BY_SECTION[sectionId];
  if(!section||!keep)return;
  const grid=section.querySelector('.fields-grid');
  if(!grid)return;

  Array.from(grid.children).forEach(function(field){
    if(!field.classList||!field.classList.contains('field'))return;
    const input=field.querySelector('[data-label]');
    if(!input)return;
    const visible=keep.has(input.dataset.label||'');
    field.style.display=visible?'':'none';
    if(visible)delete field.dataset.simpleHidden;
    else field.dataset.simpleHidden='true';
  });

  if(sectionId==='site'){
    section.querySelectorAll('.repeat-heading,.repeat-record,.empty-records').forEach(function(el){
      el.style.display='none';
      el.dataset.simpleHidden='true';
    });
    const intro=section.querySelector(':scope > p');
    if(intro)intro.textContent='AEM Site Setup Information.';
  }
}

function refresh(){
  moveMealsToAdvise();
  Object.keys(KEEP_BY_SECTION).forEach(simplifySection);
  document.dispatchEvent(new CustomEvent('restaurant-simple-refresh'));
}

function start(){
  refresh();
  const target=document.getElementById('section-content');
  if(target&&window.MutationObserver){
    const observer=new MutationObserver(function(){setTimeout(refresh,0);});
    observer.observe(target,{childList:true,subtree:true});
  }
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);
else start();
})();
