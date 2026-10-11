(function(){
'use strict';

const SECTION_TITLES={
  site:'Restaurant Profile',equipment:'DHW & Kitchen Equipment',core:'Core · Points & Operating Settings',
  alert:'Alert · Conditions & Routing',leaks:'Alert · Leak Protection',service:'Contractor · Work & Full Job Costs',
  advise:'Advise · Sizing & Upgrade Review',report:'ProLink · Report Assistant',access:'ProLink · Access Request',
  utility:'Gas Data · UtilityAPI'
};
let scheduled=false;

function originalSections(){
  return Array.from(document.querySelectorAll('#section-content > .form-section')).filter(function(section){
    return section.id!=='section-additional';
  });
}

function buildAdditional(){
  scheduled=false;
  const root=document.getElementById('section-content');
  const nav=document.getElementById('section-nav');
  if(!root||!nav)return;

  const existing=document.getElementById('section-additional');
  if(existing)existing.remove();
  const oldButton=document.getElementById('additional-input-nav');
  if(oldButton)oldButton.remove();

  const sources=originalSections();
  const groups=[];
  sources.forEach(function(section){
    const id=section.id.replace(/^section-/,'');
    const fields=Array.from(section.querySelectorAll('.field[data-simple-hidden="true"]'));
    if(fields.length)groups.push({id:id,fields:fields});
  });
  if(!groups.length)return;

  const extra=document.createElement('section');
  extra.id='section-additional';
  extra.className='form-section';
  extra.hidden=true;
  const h2=document.createElement('h2');h2.textContent='Additional Input';
  const p=document.createElement('p');p.textContent='Optional detail and engineering information that is not needed on the main day-to-day forms.';
  extra.append(h2,p);

  groups.forEach(function(group){
    const heading=document.createElement('div');
    heading.className='repeat-heading additional-input-heading';
    const h3=document.createElement('h3');
    h3.textContent=SECTION_TITLES[group.id]||group.id;
    heading.append(h3);
    extra.append(heading);

    const grid=document.createElement('div');
    grid.className='fields-grid additional-input-grid';
    group.fields.forEach(function(field){
      field.style.display='';
      delete field.dataset.simpleHidden;
      field.dataset.additionalFrom=group.id;
      grid.append(field);
    });
    extra.append(grid);
  });

  const footer=document.createElement('div');
  footer.className='section-footer';
  const back=document.createElement('button');
  back.type='button';back.textContent='← Previous';
  back.addEventListener('click',function(){
    const buttons=Array.from(nav.querySelectorAll('button:not(#additional-input-nav)'));
    if(buttons.length)buttons[buttons.length-1].click();
  });
  const done=document.createElement('button');
  done.type='button';done.textContent='Back to Restaurant Profile';
  done.addEventListener('click',function(){
    const first=nav.querySelector('button:not(#additional-input-nav)');
    if(first)first.click();
  });
  footer.append(back,done);
  extra.append(footer);
  root.append(extra);

  const button=document.createElement('button');
  button.id='additional-input-nav';
  button.type='button';
  button.textContent='Additional Input';
  const small=document.createElement('small');small.textContent='Optional detail fields';button.append(small);
  button.addEventListener('click',function(){
    originalSections().forEach(function(section){section.hidden=true;});
    extra.hidden=false;
    Array.from(nav.children).forEach(function(b){b.removeAttribute('aria-current');});
    button.setAttribute('aria-current','step');
    root.scrollIntoView({behavior:'smooth',block:'start'});
  });
  nav.append(button);

  nav.querySelectorAll('button:not(#additional-input-nav)').forEach(function(b){
    b.addEventListener('click',function(){extra.hidden=true;button.removeAttribute('aria-current');},{capture:true});
  });

  document.dispatchEvent(new CustomEvent('restaurant-additional-input-ready'));
}

function schedule(){
  if(scheduled)return;
  scheduled=true;
  setTimeout(buildAdditional,20);
}

function start(){
  document.addEventListener('restaurant-simple-refresh',schedule);
  schedule();
  const root=document.getElementById('section-content');
  if(root&&window.MutationObserver){
    new MutationObserver(function(mutations){
      if(mutations.some(function(m){return Array.from(m.addedNodes||[]).some(function(n){return n.nodeType===1&&n.id!=='section-additional';});}))schedule();
    }).observe(root,{childList:true});
  }
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
