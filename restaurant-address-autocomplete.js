(function(global){
'use strict';

var key=String(global.NOVARA_GOOGLE_MAPS_API_KEY||'').trim();
var loadPromise=null;

function field(label){
  return Array.from(document.querySelectorAll('#section-site [data-label]')).find(function(el){return el.dataset.label===label;});
}
function fire(el){if(!el)return;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}
function setField(label,value){var el=field(label);if(!el)return;el.value=value||'';fire(el);}
function parseAddress(components){
  var out={address:'',city:'',state:'',zip:''},num='',route='',zip='',suffix='';
  (components||[]).forEach(function(c){
    var t=c.types||[];
    if(t.indexOf('street_number')>=0)num=c.longText||'';
    if(t.indexOf('route')>=0)route=c.shortText||c.longText||'';
    if(t.indexOf('locality')>=0)out.city=c.longText||'';
    if(!out.city&&t.indexOf('postal_town')>=0)out.city=c.longText||'';
    if(!out.city&&t.indexOf('sublocality_level_1')>=0)out.city=c.longText||'';
    if(t.indexOf('administrative_area_level_1')>=0)out.state=c.shortText||c.longText||'';
    if(t.indexOf('postal_code')>=0)zip=c.longText||'';
    if(t.indexOf('postal_code_suffix')>=0)suffix=c.longText||'';
  });
  out.address=[num,route].filter(Boolean).join(' ').trim();
  out.zip=zip+(suffix?'-'+suffix:'');
  return out;
}
function status(message,isError){
  var addr=field('Street address');if(!addr)return;
  var host=addr.closest('.field')||addr.parentNode;
  var el=host&&host.querySelector('.restaurant-address-status');
  if(!el&&host){el=document.createElement('small');el.className='restaurant-address-status';el.style.cssText='display:block;margin-top:3px;font:700 9pt Arial,sans-serif';host.appendChild(el);}
  if(el){el.textContent=message||'';el.style.color=isError?'#a12622':'#555';}
}
function loadMaps(){
  if(global.google&&global.google.maps)return Promise.resolve();
  if(loadPromise)return loadPromise;
  if(!key)return Promise.reject(new Error('Google address lookup is not configured.'));
  loadPromise=new Promise(function(resolve,reject){
    var cb='__novaraRestaurantAddressGoogleReady';
    var timer=setTimeout(function(){reject(new Error('Google address lookup did not finish loading.'));},15000);
    global[cb]=function(){clearTimeout(timer);try{delete global[cb];}catch(_){global[cb]=undefined;}resolve();};
    var s=document.createElement('script');
    s.src='https://maps.googleapis.com/maps/api/js?key='+encodeURIComponent(key)+'&loading=async&libraries=places&v=weekly&callback='+cb;
    s.async=true;s.defer=true;s.onerror=function(){clearTimeout(timer);reject(new Error('Google address lookup could not load.'));};
    document.head.appendChild(s);
  });
  return loadPromise;
}
async function attach(){
  var original=field('Street address');
  if(!original||original.dataset.googleAddressReady==='1')return;
  original.dataset.googleAddressReady='1';
  original.setAttribute('autocomplete','off');
  try{
    await loadMaps();
    var places=typeof global.google.maps.importLibrary==='function'?await global.google.maps.importLibrary('places'):global.google.maps.places;
    var PlaceAutocompleteElement=places.PlaceAutocompleteElement||(global.google.maps.places&&global.google.maps.places.PlaceAutocompleteElement);
    if(!PlaceAutocompleteElement)throw new Error('Google Places address autocomplete is unavailable.');

    var widget=new PlaceAutocompleteElement();
    widget.includedRegionCodes=['us'];
    widget.placeholder='Start typing restaurant address…';
    widget.value=original.value||'';
    widget.style.display='block';widget.style.width='100%';widget.style.boxSizing='border-box';widget.style.minHeight='32px';
    original.parentNode.insertBefore(widget,original);
    original.style.display='none';
    status('Start typing the restaurant address and select the correct location.',false);

    widget.addEventListener('gmp-select',async function(event){
      try{
        var prediction=event.placePrediction;if(!prediction)return;
        var place=prediction.toPlace();
        await place.fetchFields({fields:['addressComponents','formattedAddress','displayName']});
        var p=parseAddress(place.addressComponents);
        if(!p.address&&place.formattedAddress)p.address=place.formattedAddress.split(',')[0].trim();
        setField('Street address',p.address);
        setField('City',p.city);
        setField('State',p.state);
        setField('ZIP',p.zip);
        widget.value=p.address||place.formattedAddress||widget.value;
        status('Address selected. City, State and ZIP filled automatically.',false);
      }catch(err){console.error(err);status('Address selected, but the details could not be filled automatically.',true);}
    });
  }catch(err){console.error(err);original.style.display='';original.dataset.googleAddressReady='';status(err&&err.message?err.message:'Google address lookup could not start.',true);}
}
function start(){
  attach();
  var root=document.getElementById('section-content');
  if(root&&global.MutationObserver)new MutationObserver(function(){setTimeout(attach,0);}).observe(root,{childList:true,subtree:true});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})(window);
