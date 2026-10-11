(function(){
'use strict';

function findField(sectionId,label){
  const section=document.getElementById(sectionId);
  if(!section)return null;
  const input=Array.from(section.querySelectorAll('[data-label]')).find(function(el){return el.dataset.label===label;});
  return input&&input.closest('.field');
}

function apply(){
  const storeField=findField('section-site','Store number');
  if(storeField)storeField.remove();

  const mealsField=findField('section-site','Meals per day');
  const advise=document.getElementById('section-advise');
  const adviseGrid=advise&&advise.querySelector('.fields-grid');
  if(mealsField&&adviseGrid){
    mealsField.style.display='';
    mealsField.removeAttribute('data-simple-hidden');
    adviseGrid.insertBefore(mealsField,adviseGrid.firstChild);
  }
}

function start(){
  apply();
  const target=document.getElementById('section-content');
  if(target&&window.MutationObserver){
    let queued=false;
    const observer=new MutationObserver(function(){
      if(queued)return;
      queued=true;
      setTimeout(function(){queued=false;apply();},0);
    });
    observer.observe(target,{childList:true,subtree:true});
  }
  setTimeout(apply,250);
  setTimeout(apply,1000);
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);
else start();
})();
