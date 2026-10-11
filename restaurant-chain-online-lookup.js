(function(global){
'use strict';

var key=String(global.NOVARA_GOOGLE_MAPS_API_KEY||'').trim();
var lastResults=[];

function byId(id){return document.getElementById(id);}
function clean(v){return String(v||'').trim();}
function esc(v){return String(v||'').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function setValue(id,value){var el=byId(id);if(!el)return;el.value=value||'';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}
function status(message,isError){var el=byId('online-lookup-status');if(!el)return;el.textContent=message||'';el.style.color=isError?'#a12622':'#000';}

function loadMaps(){
  if(global.google&&global.google.maps)return Promise.resolve();
  if(!key)return Promise.reject(new Error('Google Places is not configured.'));
  if(global.__novaraMapsPromise)return global.__novaraMapsPromise;
  global.__novaraMapsPromise=new Promise(function(resolve,reject){
    var callback='__novaraRestaurantChainGoogleReady';
    var timer=setTimeout(function(){reject(new Error('Google Places did not finish loading.'));},15000);
    global[callback]=function(){clearTimeout(timer);try{delete global[callback];}catch(_){global[callback]=undefined;}if(global.google&&global.google.maps)resolve();else reject(new Error('Google Places did not initialize.'));};
    var script=document.createElement('script');
    script.src='https://maps.googleapis.com/maps/api/js?key='+encodeURIComponent(key)+'&loading=async&libraries=places&v=weekly&callback='+callback;
    script.async=true;script.defer=true;script.onerror=function(){clearTimeout(timer);reject(new Error('Google Places could not load.'));};document.head.appendChild(script);
  });
  return global.__novaraMapsPromise;
}

function parseAddress(components){
  var out={address:'',city:'',state:'',zip:''},street='',number='',zipBase='',zipSuffix='';
  (components||[]).forEach(function(c){var t=c.types||[];if(t.indexOf('street_number')>=0)number=c.longText||'';if(t.indexOf('route')>=0)street=c.shortText||c.longText||'';if(t.indexOf('locality')>=0)out.city=c.longText||'';if(!out.city&&t.indexOf('postal_town')>=0)out.city=c.longText||'';if(!out.city&&t.indexOf('sublocality_level_1')>=0)out.city=c.longText||'';if(t.indexOf('administrative_area_level_1')>=0)out.state=c.shortText||c.longText||'';if(t.indexOf('postal_code')>=0)zipBase=c.longText||'';if(t.indexOf('postal_code_suffix')>=0)zipSuffix=c.longText||'';});
  out.address=[number,street].filter(Boolean).join(' ').trim();out.zip=zipBase+(zipSuffix?'-'+zipSuffix:'');return out;
}

function isCorporate(place){var types=place.types||[];return types.indexOf('corporate_office')>=0||types.indexOf('establishment')>=0&&!types.some(function(t){return ['restaurant','food','meal_takeaway','cafe'].indexOf(t)>=0;});}

function officeData(place){var parsed=parseAddress(place.addressComponents);return {name:(place.displayName||'Other Office'),address:parsed.address||((place.formattedAddress||'').split(',')[0]||''),city:parsed.city,state:parsed.state,zip:parsed.zip,phone:place.nationalPhoneNumber||''};}

function addOtherOffice(place){
  var root=byId('offices');if(!root)return;
  var values=officeData(place);
  var wrap=document.createElement('div');wrap.className='record';
  wrap.innerHTML='<div class="record-head"><strong>Other Office</strong><button type="button" class="remove">Remove</button></div><div class="chain-grid"><label>Office Name<input data-k="name"></label><label>Address<input data-k="address"></label><label>City<input data-k="city"></label><label>State<input data-k="state"></label><label>ZIP<input data-k="zip"></label><label>Phone<input data-k="phone" type="tel"></label></div>';
  wrap.querySelectorAll('[data-k]').forEach(function(el){el.value=values[el.dataset.k]||'';});wrap.querySelector('.remove').onclick=function(){wrap.remove();};root.appendChild(wrap);
}

function fillMain(place){
  var parsed=parseAddress(place.addressComponents);
  setValue('website',place.websiteURI||'');
  setValue('main-address',parsed.address||((place.formattedAddress||'').split(',')[0]||''));
  setValue('main-city',parsed.city);setValue('main-state',parsed.state);setValue('main-zip',parsed.zip);setValue('main-phone',place.nationalPhoneNumber||'');
}

function renderChoices(rows){
  var box=byId('online-location-choices');
  if(!box)return;
  if(!rows.length){box.innerHTML='';box.hidden=true;return;}
  box.hidden=false;
  box.innerHTML='<div style="font:700 11pt Arial,sans-serif;margin-bottom:6px">Google found multiple possible corporate locations. Choose the Main Office; add any others you want to keep.</div>';
  rows.forEach(function(place,index){
    var d=officeData(place);
    var card=document.createElement('div');
    card.style.cssText='border:1px solid #c7d3dc;border-radius:6px;padding:8px;margin:6px 0;background:#fff';
    card.innerHTML='<div style="font:700 11pt Arial,sans-serif">'+esc(place.displayName||('Location '+(index+1)))+'</div><div style="font:10pt Arial,sans-serif;margin:3px 0 6px">'+esc(place.formattedAddress||[d.address,d.city,d.state,d.zip].filter(Boolean).join(', '))+(place.nationalPhoneNumber?' · '+esc(place.nationalPhoneNumber):'')+'</div>';
    var main=document.createElement('button');main.type='button';main.className='primary';main.textContent='Use as Main Office';main.style.marginRight='6px';main.addEventListener('click',function(){fillMain(place);status('Main Office selected. Review before saving.',false);});
    var other=document.createElement('button');other.type='button';other.textContent='Add to Other Offices';other.addEventListener('click',function(){addOtherOffice(place);status('Office added to Other Offices.',false);});
    card.appendChild(main);card.appendChild(other);box.appendChild(card);
  });
}

async function lookup(){
  var name=clean(byId('chain-name')&&byId('chain-name').value);
  if(!name){status('Enter the restaurant chain name first.',true);return;}
  var button=byId('lookup-chain-online');if(button){button.disabled=true;button.textContent='Looking Up…';}
  status('Searching Google for '+name+' corporate information…',false);
  try{
    await loadMaps();
    var places=typeof global.google.maps.importLibrary==='function'?await global.google.maps.importLibrary('places'):global.google.maps.places;
    var Place=places.Place||(global.google.maps.places&&global.google.maps.places.Place);
    if(!Place||typeof Place.searchByText!=='function')throw new Error('Google Places text search is unavailable.');
    var result=await Place.searchByText({textQuery:name+' headquarters corporate office',fields:['displayName','formattedAddress','addressComponents','nationalPhoneNumber','websiteURI','types','businessStatus'],maxResultCount:10,language:'en',region:'us'});
    var rows=(result&&result.places)||[];
    if(!rows.length)throw new Error('No corporate listing was found for '+name+'.');
    var corporate=rows.filter(isCorporate);if(!corporate.length)corporate=rows;
    lastResults=corporate.slice(0,8);
    fillMain(lastResults[0]);
    var offices=byId('offices');if(offices)offices.innerHTML='';
    renderChoices(lastResults);
    status(lastResults.length>1?'Multiple possible office locations found. Choose the Main Office and add any others you want to keep.':'Online lookup complete. Please review the information before saving.',false);
  }catch(err){console.error('Restaurant chain online lookup failed',err);renderChoices([]);status(err&&err.message?err.message:'Online lookup failed.',true);}
  finally{if(button){button.disabled=false;button.textContent='Look Up Chain Online';}}
}

function init(){
  var input=byId('chain-name');if(!input||byId('lookup-chain-online'))return;
  var label=input.closest('label');if(!label)return;
  var wrap=document.createElement('div');wrap.style.cssText='display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:4px';
  var button=document.createElement('button');button.type='button';button.id='lookup-chain-online';button.className='primary';button.textContent='Look Up Chain Online';button.addEventListener('click',lookup);
  var msg=document.createElement('span');msg.id='online-lookup-status';msg.setAttribute('role','status');msg.style.cssText='font:700 10pt Arial,sans-serif';
  wrap.appendChild(button);wrap.appendChild(msg);label.appendChild(wrap);
  var choices=document.createElement('div');choices.id='online-location-choices';choices.hidden=true;choices.style.cssText='grid-column:1/-1;margin-top:4px';
  var grid=label.closest('.chain-grid');if(grid)grid.appendChild(choices);
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})(window);
