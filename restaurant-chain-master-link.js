(function(){
'use strict';
const RECORD_KEY='novara.restaurantChainRecords.v1';
function records(){try{return JSON.parse(localStorage.getItem(RECORD_KEY)||'[]');}catch(e){return [];}}
function apply(){
  const input=document.querySelector('#section-site [data-label="Restaurant / chain"]');
  if(!input)return;
  let list=document.getElementById('restaurant-chain-list');
  if(!list){list=document.createElement('datalist');list.id='restaurant-chain-list';document.body.appendChild(list);}
  const names=records().map(r=>String(r&&r.name||'').trim()).filter(Boolean);
  if(!names.some(n=>n.toLowerCase()==='chipotle'))names.push('Chipotle');
  list.innerHTML='';
  Array.from(new Set(names)).sort((a,b)=>a.localeCompare(b)).forEach(name=>{const o=document.createElement('option');o.value=name;list.appendChild(o);});
  input.setAttribute('list','restaurant-chain-list');
  const field=input.closest('.field');
  if(field&&!field.querySelector('.manage-chain-link')){
    const a=document.createElement('a');
    a.className='manage-chain-link';
    a.href='restaurant-chains.html?application=RHW';
    a.textContent='Find / Add Chain';
    a.style.cssText='display:inline-block;width:max-content;margin-top:3px;padding:5px 10px;border:1px solid #7f8c99;border-radius:5px;background:#fff;color:#000;font:700 11pt Arial,sans-serif;text-decoration:none';
    field.appendChild(a);
  }
}
function start(){apply();const root=document.getElementById('section-content');if(root&&window.MutationObserver)new MutationObserver(apply).observe(root,{childList:true,subtree:true});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
