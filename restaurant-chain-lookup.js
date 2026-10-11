(function(){
'use strict';

const STORAGE_KEY='novara.restaurantChains.v1';
const DEFAULT_CHAINS=['Chipotle'];

function loadChains(){
  let saved=[];
  try{saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]');}catch(e){saved=[];}
  return Array.from(new Set(DEFAULT_CHAINS.concat(saved).map(v=>String(v||'').trim()).filter(Boolean)))
    .sort((a,b)=>a.localeCompare(b));
}

function saveChains(chains){
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify(chains));}catch(e){}
}

function fire(input){
  input.dispatchEvent(new Event('input',{bubbles:true}));
  input.dispatchEvent(new Event('change',{bubbles:true}));
}

function setup(){
  const input=document.querySelector('#section-site [data-label="Restaurant / chain"]');
  if(!input||input.dataset.chainLookupReady==='true')return;
  input.dataset.chainLookupReady='true';
  input.setAttribute('list','restaurant-chain-list');
  input.setAttribute('autocomplete','off');
  input.setAttribute('placeholder','Type or select a chain');

  let list=document.getElementById('restaurant-chain-list');
  if(!list){
    list=document.createElement('datalist');
    list.id='restaurant-chain-list';
    document.body.appendChild(list);
  }

  function render(){
    const chains=loadChains();
    list.innerHTML='';
    chains.forEach(name=>{
      const option=document.createElement('option');
      option.value=name;
      list.appendChild(option);
    });
    return chains;
  }

  const field=input.closest('.field');
  if(field&&!field.querySelector('.add-chain-button')){
    const button=document.createElement('button');
    button.type='button';
    button.className='add-chain-button';
    button.textContent='Add New Chain';
    button.style.cssText='width:max-content;height:30px;padding:3px 10px;border:1px solid #7f8c99;border-radius:5px;background:#fff;color:#000;font:700 11pt Arial,sans-serif;cursor:pointer;margin-top:3px';
    button.addEventListener('click',function(){
      const current=String(input.value||'').trim();
      const name=window.prompt('Enter the restaurant chain name:',current);
      if(name===null)return;
      const clean=String(name).trim();
      if(!clean)return;
      const chains=render();
      if(!chains.some(v=>v.toLowerCase()===clean.toLowerCase())){
        chains.push(clean);
        chains.sort((a,b)=>a.localeCompare(b));
        saveChains(chains);
      }
      render();
      input.value=clean;
      fire(input);
    });
    field.appendChild(button);
  }

  render();
}

function start(){
  setup();
  const target=document.getElementById('section-content');
  if(target&&window.MutationObserver){
    const observer=new MutationObserver(()=>setup());
    observer.observe(target,{childList:true,subtree:true});
  }
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);
else start();
})();
