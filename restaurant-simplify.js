(function(){
'use strict';

const SITE_KEEP=new Set([
  'Restaurant / chain',
  'Store number',
  'Site ID',
  'Street address',
  'City',
  'State',
  'ZIP',
  'Utility territory',
  'Time zone',
  'Servicing contractor',
  'Restaurant area (sq ft)',
  'Meals per day'
]);

function simplifySite(){
  const section=document.getElementById('section-site');
  if(!section)return;

  section.querySelectorAll('.field').forEach(function(field){
    const input=field.querySelector('[data-label]');
    if(!input)return;
    const keep=SITE_KEEP.has(input.dataset.label||'');
    field.style.display=keep?'':'none';
    if(keep)delete field.dataset.simpleHidden;
    else field.dataset.simpleHidden='true';
  });

  section.querySelectorAll('.repeat-heading,.repeat-record,.empty-records').forEach(function(el){
    el.style.display='none';
    el.dataset.simpleHidden='true';
  });

  const intro=section.querySelector(':scope > p');
  if(intro)intro.textContent='AEM Site Setup Information.';
}

function refresh(){
  simplifySite();
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
