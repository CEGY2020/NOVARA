(function(global){
'use strict';

var key=String(global.NOVARA_GOOGLE_MAPS_API_KEY||'').trim();

function byId(id){return document.getElementById(id);}
function clean(v){return String(v||'').trim();}
function setValue(id,value){var el=byId(id);if(!el||!value)return;el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}
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

function addOtherOffice(place){
  var root=byId('offices');if(!root)return;
  var parsed=parseAddress(place.addressComponents);
  var wrap=document.createElement('div');wrap.className='record';
  wrap.innerHTML='<div class="record-head"><strong>Other Office</strong><button type="button" class="remove">Remove</button></div><div class="chain-grid"><label>Office Name<input data-k="name"></label><label>Address<input data-k="address"></label><label>City<input data-k="city"></label><label>State<input data-k="state"></label><label>ZIP<input data-k="zip"></label><label>Phone<input data-k="phone" type="tel"></label></div>';
  var values={name:(place.displayName||'Other Office'),address:parsed.address||((place.formattedAddress||'').split(',')[0]||''),city:parsed.city,state:parsed.state,zip:parsed.zip,phone:place.nationalPhoneNumber||''};
  wrap.querySelectorAll('[data-k]').forEach(function(el){el.value=values[el.dataset.k]||'';});wrap.querySelector('.remove').onclick=function(){wrap.remove();};root.appendChild(wrap);
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
    var main=corporate[0];
    var parsed=parseAddress(main.addressComponents);
    setValue('website',main.websiteURI||'');
    setValue('main-address',parsed.address||((main.formattedAddress||'').split(',')[0]||''));
    setValue('main-city',parsed.city);setValue('main-state',parsed.state);setValue('main-zip',parsed.zip);setValue('main-phone',main.nationalPhoneNumber||'');
    var offices=byId('offices');if(offices)offices.innerHTML='';
    corporate.slice(1,6).forEach(addOtherOffice);
    status('Online lookup complete. Please review the information before saving.',false);
  }catch(err){console.error('Restaurant chain online lookup failed',err);status(err&&err.message?err.message:'Online lookup failed.',true);}
  finally{if(button){button.disabled=false;button.textContent='Look Up Chain Online';}}
}

function init(){
  var input=byId('chain-name');if(!input||byId('lookup-chain-online'))return;
  var label=input.closest('label');if(!label)return;
  var wrap=document.createElement('div');wrap.style.cssText='display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:4px';
  var button=document.createElement('button');button.type='button';button.id='lookup-chain-online';button.className='primary';button.textContent='Look Up Chain Online';button.addEventListener('click',lookup);
  var msg=document.createElement('span');msg.id='online-lookup-status';msg.setAttribute('role','status');msg.style.cssText='font:700 10pt Arial,sans-serif';
  wrap.appendChild(button);wrap.appendChild(msg);label.appendChild(wrap);
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})(window);
