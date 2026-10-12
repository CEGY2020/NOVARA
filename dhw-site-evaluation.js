(function(){
'use strict';
var type=document.getElementById('buildingType');
var multi=document.getElementById('multifamily-fields');
var hotel=document.getElementById('hotel-fields');
var heaterList=document.getElementById('heater-list');
var addHeater=document.getElementById('add-heater');
var heaterJson=document.getElementById('waterHeatersJson');
var totalInput=document.getElementById('totalInputBtu');
var totalOutput=document.getElementById('totalOutputBtu');
var tankQty=document.getElementById('storageTankQty');
var tankGal=document.getElementById('storageTankGallons');
var totalStorage=document.getElementById('totalStorageGallons');
var reviewLink=document.getElementById('review-link');
var q=new URLSearchParams(location.search),leadId=q.get('leadId')||'';
if(reviewLink){reviewLink.href='dhw-review.html?leadId='+encodeURIComponent(leadId);if(!leadId){reviewLink.setAttribute('aria-disabled','true');reviewLink.style.pointerEvents='none';reviewLink.style.opacity='.55'}}

function n(v){var x=parseFloat(v);return isFinite(x)?x:0}
function showConditional(){
  var v=(type&&type.value||'').toLowerCase();
  if(multi)multi.hidden=v!=='multifamily';
  if(hotel)hotel.hidden=v!=='hotel';
}
function heaterRow(data){
  data=data||{};
  var row=document.createElement('div');
  row.className='dhw-equipment-row';
  row.innerHTML='<label class="form-field"><span>Make</span><input data-h="make"></label>'+
    '<label class="form-field"><span>Model</span><input data-h="model"></label>'+
    '<label class="form-field"><span>Serial Number</span><input data-h="serial"></label>'+
    '<label class="form-field"><span>Input BTU/h</span><input data-h="inputBtu" type="number" min="0"></label>'+
    '<label class="form-field"><span>Output BTU/h</span><input data-h="outputBtu" type="number" min="0"></label>'+
    '<button type="button" class="secondary-btn dhw-remove">Remove</button>';
  ['make','model','serial','inputBtu','outputBtu'].forEach(function(k){var el=row.querySelector('[data-h="'+k+'"]');if(el&&data[k]!=null)el.value=data[k]});
  row.addEventListener('input',syncHeaters);
  row.querySelector('.dhw-remove').addEventListener('click',function(){row.remove();if(!heaterList.children.length)heaterList.appendChild(heaterRow());syncHeaters()});
  return row;
}
function getHeaters(){
  return Array.from(heaterList.querySelectorAll('.dhw-equipment-row')).map(function(row){var d={};row.querySelectorAll('[data-h]').forEach(function(el){d[el.dataset.h]=el.value});return d});
}
function syncHeaters(){
  if(!heaterJson)return;
  var items=getHeaters();
  heaterJson.value=JSON.stringify(items);
  if(totalInput)totalInput.value=items.reduce(function(s,x){return s+n(x.inputBtu)},0)||'';
  if(totalOutput)totalOutput.value=items.reduce(function(s,x){return s+n(x.outputBtu)},0)||'';
  var count=document.getElementById('heaters');if(count)count.value=items.length;
}
function syncStorage(){if(totalStorage)totalStorage.value=(n(tankQty&&tankQty.value)*n(tankGal&&tankGal.value))||''}
function restoreHeaters(){
  var items=[];
  try{items=JSON.parse(heaterJson&&heaterJson.value||'[]');if(!Array.isArray(items))items=[]}catch(e){items=[]}
  heaterList.innerHTML='';
  (items.length?items:[{}]).forEach(function(d){heaterList.appendChild(heaterRow(d))});
  syncHeaters();
}
if(type){type.addEventListener('change',showConditional);showConditional()}
if(addHeater)addHeater.addEventListener('click',function(){heaterList.appendChild(heaterRow());syncHeaters()});
if(tankQty)tankQty.addEventListener('input',syncStorage);
if(tankGal)tankGal.addEventListener('input',syncStorage);
restoreHeaters();syncStorage();
/* The shared site-evaluation loader fills saved hidden values asynchronously. Re-read shortly after load. */
setTimeout(function(){showConditional();restoreHeaters();syncStorage()},700);
})();