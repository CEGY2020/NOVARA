(function(){
'use strict';

const REQUIRED={
  site:['Restaurant / chain','Site ID','Street address','City','State','ZIP','Utility territory','Time zone','Servicing contractor'],
  equipment:['Plant arrangement'],
  core:['Controller / gateway','Controller ID'],
  alert:['Restaurant staff receive notices','Backup contractor / dispatch contact','After-hours emergency contact'],
  leaks:['Leak detection installed','Leak response arrangement']
};

const REQUIRED_RECORDS=[
  {section:'equipment',repeat:'heaters',label:'Installed heater record'},
  {section:'alert',repeat:'recipients',label:'Alarm recipient'},
  {section:'utility',repeat:'meters',label:'Gas meter record'}
];

function addStyles(){
  if(document.getElementById('restaurant-progress-styles'))return;
  const style=document.createElement('style');
  style.id='restaurant-progress-styles';
  style.textContent=`
    .required-marker{color:#c62828!important;font-weight:700!important;margin-left:3px}
    .required-key{font:700 12pt Arial,sans-serif;color:#000;margin:0 0 8px}
    .required-key .required-marker{margin-left:0;margin-right:4px}
    #completion{min-width:230px!important;text-align:left!important}
    .required-progress{display:grid;gap:5px;font:12pt Arial,sans-serif;color:#000}
    .required-progress strong{font-size:12pt!important;color:#000!important}
    .required-progress-track{height:10px;border:1px solid #6fb9e8;border-radius:6px;background:#fff;overflow:hidden}
    .required-progress-fill{height:100%;background:#4aa3df;width:0;transition:width .18s ease}
    .required-progress-note{font-size:11pt!important;color:#000!important}
    .section-nav .required-section-count{display:inline!important;margin-left:5px!important;font-size:10pt!important;font-weight:700!important;color:#000!important}
  `;
  document.head.appendChild(style);
}

function sectionIdForInput(input){
  const section=input.closest('.form-section');
  return section&&section.id?section.id.replace(/^section-/,''):'';
}

function isRequired(sectionId,label){
  return !!(REQUIRED[sectionId]&&REQUIRED[sectionId].includes(label));
}

function filled(input){
  if(!input)return false;
  if(input.type==='checkbox'||input.type==='radio')return input.checked;
  return String(input.value||'').trim()!=='';
}

function markRequiredFields(){
  document.querySelectorAll('.form-section .field').forEach(field=>{
    const input=field.querySelector('input[data-label],select[data-label],textarea[data-label]');
    if(!input)return;
    const sectionId=sectionIdForInput(input);
    const label=input.dataset.label||'';
    if(!isRequired(sectionId,label))return;
    input.setAttribute('aria-required','true');
    const labelSpan=field.querySelector(':scope > span');
    if(labelSpan&&!labelSpan.querySelector('.required-marker')){
      const star=document.createElement('span');
      star.className='required-marker';
      star.textContent='*';
      star.setAttribute('aria-label','required');
      labelSpan.appendChild(star);
    }
  });
}

function addKey(){
  document.querySelectorAll('.form-section').forEach(section=>{
    const id=section.id.replace(/^section-/,'');
    if(!(REQUIRED[id]&&REQUIRED[id].length))return;
    if(section.querySelector('.required-key'))return;
    const grid=section.querySelector('.fields-grid');
    if(!grid)return;
    const key=document.createElement('p');
    key.className='required-key';
    key.innerHTML='<span class="required-marker">*</span> Required';
    grid.before(key);
  });
}

function requiredFieldStats(){
  let total=0,done=0;
  Object.keys(REQUIRED).forEach(sectionId=>{
    REQUIRED[sectionId].forEach(label=>{
      total++;
      const section=document.getElementById('section-'+sectionId);
      const input=section&&Array.from(section.querySelectorAll('[data-label]')).find(el=>el.dataset.label===label);
      if(filled(input))done++;
    });
  });
  return {total,done};
}

function requiredRecordStats(){
  let total=0,done=0;
  REQUIRED_RECORDS.forEach(item=>{
    total++;
    const section=document.getElementById('section-'+item.section);
    if(section&&section.querySelector('[data-repeat="'+item.repeat+'"]'))done++;
  });
  return {total,done};
}

function sectionStats(sectionId){
  const labels=REQUIRED[sectionId]||[];
  let done=0;
  labels.forEach(label=>{
    const section=document.getElementById('section-'+sectionId);
    const input=section&&Array.from(section.querySelectorAll('[data-label]')).find(el=>el.dataset.label===label);
    if(filled(input))done++;
  });
  const recordItems=REQUIRED_RECORDS.filter(item=>item.section===sectionId);
  recordItems.forEach(item=>{
    const section=document.getElementById('section-'+sectionId);
    if(section&&section.querySelector('[data-repeat="'+item.repeat+'"]'))done++;
  });
  return {done,total:labels.length+recordItems.length};
}

function updateMenuCounts(){
  const buttons=document.querySelectorAll('#section-nav > button');
  const sections=document.querySelectorAll('#section-content > .form-section');
  buttons.forEach((button,index)=>{
    const section=sections[index];
    if(!section)return;
    const id=section.id.replace(/^section-/,'');
    const stats=sectionStats(id);
    let badge=button.querySelector('.required-section-count');
    if(!stats.total){if(badge)badge.remove();return;}
    if(!badge){badge=document.createElement('span');badge.className='required-section-count';button.insertBefore(badge,button.querySelector('small'));}
    badge.textContent=' '+stats.done+'/'+stats.total;
  });
}

function updateProgress(){
  const completion=document.getElementById('completion');
  if(!completion)return;
  const fields=requiredFieldStats();
  const records=requiredRecordStats();
  const total=fields.total+records.total;
  const done=fields.done+records.done;
  const pct=total?Math.round(done/total*100):0;
  completion.innerHTML='';
  const wrap=document.createElement('div');
  wrap.className='required-progress';
  wrap.innerHTML='<strong>Required setup: '+done+' of '+total+' complete ('+pct+'%)</strong><div class="required-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+pct+'"><div class="required-progress-fill" style="width:'+pct+'%"></div></div><span class="required-progress-note">Complete all * fields and required records.</span>';
  completion.appendChild(wrap);
  updateMenuCounts();
}

function refresh(){
  addStyles();
  markRequiredFields();
  addKey();
  updateProgress();
}

document.addEventListener('input',()=>setTimeout(refresh,0),true);
document.addEventListener('change',()=>setTimeout(refresh,0),true);
document.addEventListener('click',()=>setTimeout(refresh,25),true);

function start(){
  refresh();
  const target=document.getElementById('section-content');
  if(target&&window.MutationObserver){
    const observer=new MutationObserver(()=>setTimeout(refresh,0));
    observer.observe(target,{childList:true,subtree:true});
  }
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);
else start();
})();
