(function(){
'use strict';

const STORAGE_KEY='novara.restaurantChainRecords.v1';
let currentId='';

function load(){
  try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]');}catch(e){return [];}
}
function save(rows){localStorage.setItem(STORAGE_KEY,JSON.stringify(rows));}
function clean(v){return String(v||'').trim();}
function slug(name){
  const words=clean(name).toUpperCase().replace(/[^A-Z0-9 ]/g,' ').split(/\s+/).filter(Boolean);
  let code=(words[0]||'CHAIN').slice(0,4);
  if(code.length<3&&words[1])code=(code+words[1]).slice(0,4);
  return code.padEnd(3,'X');
}
function makeId(name,existing){
  const prefix=slug(name);
  let n=1,id='';
  const used=new Set(existing.map(r=>r.id));
  do{id=prefix+'-'+String(n).padStart(3,'0');n++;}while(used.has(id));
  return id;
}
function officeRow(data={}){
  const wrap=document.createElement('div');wrap.className='record';
  wrap.innerHTML='<div class="record-head"><strong>Other Office</strong><button type="button" class="remove">Remove</button></div><div class="chain-grid">'+
    '<label>Office Name<input data-k="name"></label><label>Address<input data-k="address"></label><label>City<input data-k="city"></label><label>State<input data-k="state"></label><label>ZIP<input data-k="zip"></label><label>Phone<input data-k="phone" type="tel"></label></div>';
  wrap.querySelectorAll('[data-k]').forEach(el=>el.value=data[el.dataset.k]||'');
  wrap.querySelector('.remove').onclick=()=>wrap.remove();return wrap;
}
function contactRow(data={}){
  const wrap=document.createElement('div');wrap.className='record';
  wrap.innerHTML='<div class="record-head"><strong>Corporate Contact</strong><button type="button" class="remove">Remove</button></div><div class="chain-grid">'+
    '<label>Name<input data-k="name"></label><label>Title / Department<input data-k="title"></label><label>Email<input data-k="email" type="email"></label><label>Phone<input data-k="phone" type="tel"></label><label class="wide">Notes<textarea data-k="notes"></textarea></label></div>';
  wrap.querySelectorAll('[data-k]').forEach(el=>el.value=data[el.dataset.k]||'');
  wrap.querySelector('.remove').onclick=()=>wrap.remove();return wrap;
}
function collectRows(root){
  return Array.from(root.querySelectorAll('.record')).map(row=>{
    const out={};row.querySelectorAll('[data-k]').forEach(el=>out[el.dataset.k]=clean(el.value));return out;
  });
}
function setStatus(msg){document.getElementById('status').textContent=msg;}
function reset(){
  currentId='';document.getElementById('chain-form').reset();document.getElementById('chain-id').value='';document.getElementById('offices').innerHTML='';document.getElementById('contacts').innerHTML='';setStatus('');
}
function render(){
  const q=clean(document.getElementById('chain-search').value).toLowerCase();
  const body=document.getElementById('chain-list');body.innerHTML='';
  load().filter(r=>!q||r.name.toLowerCase().includes(q)).sort((a,b)=>a.name.localeCompare(b.name)).forEach(r=>{
    const tr=document.createElement('tr');
    tr.innerHTML='<td>'+esc(r.name)+'</td><td>'+esc(r.id)+'</td><td>'+esc([r.mainAddress,r.mainCity,r.mainState].filter(Boolean).join(', '))+'</td><td>'+esc(r.mainPhone||'')+'</td><td>'+((r.offices||[]).length)+'</td><td>'+((r.contacts||[]).length)+'</td><td><button type="button">Open</button></td>';
    tr.querySelector('button').onclick=()=>open(r.id);body.appendChild(tr);
  });
}
function esc(v){return String(v||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function open(id){
  const r=load().find(x=>x.id===id);if(!r)return;
  currentId=r.id;
  const map={
    'chain-name':'name','chain-id':'id','website':'website','main-address':'mainAddress','main-city':'mainCity','main-state':'mainState','main-zip':'mainZip','main-phone':'mainPhone','main-email':'mainEmail','notes':'notes'
  };
  Object.keys(map).forEach(k=>document.getElementById(k).value=r[map[k]]||'');
  const offices=document.getElementById('offices');offices.innerHTML='';(r.offices||[]).forEach(x=>offices.appendChild(officeRow(x)));
  const contacts=document.getElementById('contacts');contacts.innerHTML='';(r.contacts||[]).forEach(x=>contacts.appendChild(contactRow(x)));
  setStatus('');document.getElementById('editor').scrollIntoView({behavior:'smooth',block:'start'});
}
function submit(e){
  e.preventDefault();
  const rows=load();
  const name=clean(document.getElementById('chain-name').value);
  let id=currentId||makeId(name,rows);
  const rec={id,name,website:clean(website.value),mainAddress:clean(document.getElementById('main-address').value),mainCity:clean(document.getElementById('main-city').value),mainState:clean(document.getElementById('main-state').value),mainZip:clean(document.getElementById('main-zip').value),mainPhone:clean(document.getElementById('main-phone').value),mainEmail:clean(document.getElementById('main-email').value),notes:clean(document.getElementById('notes').value),offices:collectRows(document.getElementById('offices')),contacts:collectRows(document.getElementById('contacts'))};
  const i=rows.findIndex(r=>r.id===id);if(i>=0)rows[i]=rec;else rows.push(rec);save(rows);currentId=id;document.getElementById('chain-id').value=id;setStatus('Saved');render();
  window.dispatchEvent(new CustomEvent('restaurant-chains-updated'));
}

document.getElementById('new-chain').onclick=reset;
document.getElementById('add-office').onclick=()=>document.getElementById('offices').appendChild(officeRow());
document.getElementById('add-contact').onclick=()=>document.getElementById('contacts').appendChild(contactRow());
document.getElementById('chain-search').addEventListener('input',render);
document.getElementById('chain-form').addEventListener('submit',submit);
document.getElementById('delete-chain').onclick=function(){
  if(!currentId)return;
  const rows=load().filter(r=>r.id!==currentId);save(rows);reset();render();setStatus('Deleted');window.dispatchEvent(new CustomEvent('restaurant-chains-updated'));
};
render();
})();
