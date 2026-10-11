(function(){
'use strict';

const STORAGE_KEY='novara.restaurantChainRecords.v1';

function clean(v){return String(v||'').trim();}
function load(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]');}catch(e){return [];}}
function slug(name){
  const words=clean(name).toUpperCase().replace(/[^A-Z0-9 ]/g,' ').split(/\s+/).filter(Boolean);
  let code=(words[0]||'CHAIN').slice(0,4);
  if(code.length<3&&words[1])code=(code+words[1]).slice(0,4);
  return code.padEnd(3,'X');
}
function makeId(name,rows){
  const prefix=slug(name);
  const used=new Set(rows.map(r=>String(r.id||'')));
  let n=1,id='';
  do{id=prefix+'-'+String(n).padStart(3,'0');n++;}while(used.has(id));
  return id;
}
function update(){
  const nameInput=document.getElementById('chain-name');
  const idInput=document.getElementById('chain-id');
  if(!nameInput||!idInput)return;
  const name=clean(nameInput.value);
  if(!name){idInput.value='';return;}
  const rows=load();
  const existing=rows.find(r=>clean(r.name).toLowerCase()===name.toLowerCase());
  if(existing){idInput.value=existing.id||'';return;}
  idInput.value=makeId(name,rows);
}
function start(){
  const input=document.getElementById('chain-name');
  if(!input)return;
  input.addEventListener('input',update);
  input.addEventListener('change',()=>setTimeout(update,0));
  document.getElementById('new-chain')?.addEventListener('click',()=>setTimeout(update,0));
  document.getElementById('lookup-chain-online')?.addEventListener('click',()=>setTimeout(update,0));
  update();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
