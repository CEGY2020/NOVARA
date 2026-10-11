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
function isUsDst(date){
  var y=date.getUTCFullYear();
  function nthSunday(month,n){
    var d=new Date(Date.UTC(y,month,1));
    var first=(7-d.getUTCDay())%7+1;
    return new Date(Date.UTC(y,month,first+(n-1)*7,10));
  }
  var start=nthSunday(2,2);
  var nov=new Date(Date.UTC(y,10,1));
  var firstSunday=(7-nov.getUTCDay())%7+1;
  var end=new Date(Date.UTC(y,10,firstSunday,9));
  return date>=start&&date<end;
}
function timeZoneFor(state,utcOffsetMinutes){
  state=String(state||'').toUpperCase();
  if(state==='HI')return 'Pacific/Honolulu';
  if(state==='AZ')return 'America/Phoenix';
  if(state==='AK')return 'America/Anchorage';

  var offset=Number(utcOffsetMinutes);
  if(Number.isFinite(offset)){
    var dst=isUsDst(new Date());
    if(dst){
      if(offset===-420)return 'America/Los_Angeles';
      if(offset===-360)return 'America/Denver';
      if(offset===-300)return 'America/Chicago';
      if(offset===-240)return 'America/New_York';
      if(offset===-480)return 'America/Anchorage';
    }else{
      if(offset===-480)return 'America/Los_Angeles';
      if(offset===-420)return 'America/Denver';
      if(offset===-360)return 'America/Chicago';
      if(offset===-300)return 'America/New_York';
      if(offset===-540)return 'America/Anchorage';
    }
  }

  var pacific=['CA','WA','NV'];
  var mountain=['CO','MT','NM','UT','WY'];
  var central=['AL','AR','IA','IL','LA','MN','MS','MO','OK','WI'];
  var eastern=['CT','DC','DE','GA','MA','MD','ME','NH','NJ','NY','NC','OH','PA','RI','SC','VT','VA','WV'];
  if(pacific.indexOf(state)>=0)return 'America/Los_Angeles';
  if(mountain.indexOf(state)>=0)return 'America/Denver';
  if(central.indexOf(state)>=0)return 'America/Chicago';
  if(eastern.indexOf(state)>=0)return 'America/New_York';
  return '';
}
function status(message,isError){
  var addr=field('Street address');if(!addr)return;
  var host=addr.closest('.field')||addr.parentNode;
  var el=host&&host.querySelector('.restaurant-address-status');
  if(!el&&host){el=document.createElement('small');el.className='restaurant-address-status';el.style.cssText='display:block;margin-top:3px;font:700 9pt Arial,sans-serif';host.appendChild(el);}
  if(el){el.textContent=message||'';el.style.color=isError?'#a12622':'#555';}
}
function suppressBrowserAutofill(el){
  if(!el)return;
  el.setAttribute('autocomplete','new-password');
  el.setAttribute('autocorrect','off');
  el.setAttribute('autocapitalize','none');
  el.setAttribute('spellcheck','false');
  el.setAttribute('data-lpignore','true');
  el.setAttribute('data-1p-ignore','true');
  el.setAttribute('data-form-type','other');
  el.setAttribute('name','novara-restaurant-address-lookup');
  var form=el.closest&&el.closest('form');
  if(form)form.setAttribute('autocomplete','off');
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
  suppressBrowserAutofill(original);
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
    suppressBrowserAutofill(widget);
    original.parentNode.insertBefore(widget,original);
    original.style.display='none';
    status('Start typing the restaurant address and select the correct location.',false);

    widget.addEventListener('focus',function(){suppressBrowserAutofill(widget);},true);
    widget.addEventListener('gmp-select',async function(event){
      try{
        var prediction=event.placePrediction;if(!prediction)return;
        var place=prediction.toPlace();
        await place.fetchFields({fields:['addressComponents','formattedAddress','displayName','utcOffsetMinutes']});
        var p=parseAddress(place.addressComponents);
        if(!p.address&&place.formattedAddress)p.address=place.formattedAddress.split(',')[0].trim();
        setField('Street address',p.address);
        setField('City',p.city);
        setField('State',p.state);
        setField('ZIP',p.zip);
        var tz=timeZoneFor(p.state,place.utcOffsetMinutes);
        if(tz)setField('Time zone',tz);
        widget.value=p.address||place.formattedAddress||widget.value;
        status('Address selected. City, State, ZIP and Time Zone filled automatically.',false);
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
