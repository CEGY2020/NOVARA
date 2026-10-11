(function(){
'use strict';

let scheduled=false;

function cleanupStandalone(){
  const standalone=document.getElementById('section-additional');
  if(standalone)standalone.remove();
  const navButton=document.getElementById('additional-input-nav');
  if(navButton)navButton.remove();
}

function buildSectionAdditional(section){
  if(!section||section.id==='section-additional')return;

  const old=section.querySelector(':scope > .section-additional-input');
  if(old){
    const oldFields=Array.from(old.querySelectorAll('.field[data-additional-from]'));
    const mainGrid=section.querySelector(':scope > .fields-grid');
    if(mainGrid){
      oldFields.forEach(function(field){
        field.style.display='none';
        field.dataset.simpleHidden='true';
        delete field.dataset.additionalFrom;
        mainGrid.append(field);
      });
    }
    old.remove();
  }

  const fields=Array.from(section.querySelectorAll(':scope > .fields-grid > .field[data-simple-hidden="true"]'));
  const hiddenExtras=Array.from(section.children).filter(function(el){
    return el.dataset&&el.dataset.simpleHidden==='true'&&(el.classList.contains('repeat-heading')||el.classList.contains('repeat-record')||el.classList.contains('empty-records'));
  });
  if(!fields.length&&!hiddenExtras.length)return;

  const details=document.createElement('details');
  details.className='section-additional-input';
  const summary=document.createElement('summary');
  summary.textContent='Additional Input';
  details.append(summary);

  const note=document.createElement('p');
  note.className='additional-input-note';
  note.textContent='Optional detail and engineering information for this section.';
  details.append(note);

  if(fields.length){
    const grid=document.createElement('div');
    grid.className='fields-grid additional-input-grid';
    fields.forEach(function(field){
      field.style.display='';
      delete field.dataset.simpleHidden;
      field.dataset.additionalFrom=section.id.replace(/^section-/,'');
      grid.append(field);
    });
    details.append(grid);
  }

  if(hiddenExtras.length){
    const records=document.createElement('div');
    records.className='additional-input-records';
    hiddenExtras.forEach(function(el){
      el.style.display='';
      delete el.dataset.simpleHidden;
      records.append(el);
    });
    details.append(records);
  }

  const footer=section.querySelector(':scope > .section-footer');
  if(footer)section.insertBefore(details,footer);
  else section.append(details);
}

function addStyles(){
  if(document.getElementById('restaurant-additional-input-styles'))return;
  const style=document.createElement('style');
  style.id='restaurant-additional-input-styles';
  style.textContent='body[data-page="restaurant"] .section-additional-input{margin-top:18px;border-top:1px solid #bfcbd3;padding-top:10px}body[data-page="restaurant"] .section-additional-input>summary{cursor:pointer;font:700 12pt Arial,sans-serif;color:#000;padding:5px 0}body[data-page="restaurant"] .section-additional-input[open]>summary{margin-bottom:8px}body[data-page="restaurant"] .additional-input-note{margin:0 0 10px!important;font:12pt Arial,sans-serif!important;color:#000!important}body[data-page="restaurant"] .additional-input-grid{margin-bottom:8px}body[data-page="restaurant"] .additional-input-records{margin-top:10px}';
  document.head.append(style);
}

function build(){
  scheduled=false;
  cleanupStandalone();
  addStyles();
  document.querySelectorAll('#section-content > .form-section').forEach(buildSectionAdditional);
  document.dispatchEvent(new CustomEvent('restaurant-additional-input-ready'));
}

function schedule(){
  if(scheduled)return;
  scheduled=true;
  setTimeout(build,30);
}

function start(){
  document.addEventListener('restaurant-simple-refresh',schedule);
  schedule();
  const root=document.getElementById('section-content');
  if(root&&window.MutationObserver){
    new MutationObserver(function(mutations){
      if(mutations.some(function(m){return m.addedNodes&&m.addedNodes.length;}))schedule();
    }).observe(root,{childList:true});
  }
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
