(function(global){
'use strict';

var key=String(global.NOVARA_GOOGLE_MAPS_API_KEY||'').trim();
var loadPromise=null;

function norm(v){return String(v||'').trim().toLowerCase();}
function field(label){
  var wanted=norm(label);
  return Array.from(document.querySelectorAll('#section-site [data-label]')).find(function(el){return norm(el.dataset.label)===wanted;});
}
function fire(el){if(!el)return;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}
function setField(label,value){
  var el=field(label);if(!el)return false;
  var wanted=String(value||'');
  if(el.tagName==='SELECT'){
    var option=Array.from(el.options||[]).find(function(o){return norm(o.value)===norm(wanted)||norm(o.textContent)===norm(wanted);});
    if(option)el.value=option.value;else el.value=wanted;
  }else el.value=wanted;
  fire(el);return true;
}
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
  out.address=[num,route].filter(Boolean).join(' ').trim();out.zip=zip+(suffix?'-'+suffix:'');return out;
}
function isUsDst(date){
  var y=date.getUTCFullYear();
  function nthSunday(month,n){var d=new Date(Date.UTC(y,month,1));var first=(7-d.getUTCDay())%7+1;return new Date(Date.UTC(y,month,first+(n-1)*7,10));}
  var start=nthSunday(2,2),nov=new Date(Date.UTC(y,10,1)),firstSunday=(7-nov.getUTCDay())%7+1,end=new Date(Date.UTC(y,10,firstSunday,9));
  return date>=start&&date<end;
}
function timeZoneFor(state,utcOffsetMinutes){
  state=String(state||'').toUpperCase();
  if(state==='HI')return 'Pacific/Honolulu';if(state==='AZ')return 'America/Phoenix';if(state==='AK')return 'America/Anchorage';
  var offset=Number(utcOffsetMinutes);
  if(Number.isFinite(offset)){
    var dst=isUsDst(new Date());
    if(dst){if(offset===-420)return 'America/Los_Angeles';if(offset===-360)return 'America/Denver';if(offset===-300)return 'America/Chicago';if(offset===-240)return 'America/New_York';if(offset===-480)return 'America/Anchorage';}
    else{if(offset===-480)return 'America/Los_Angeles';if(offset===-420)return 'America/Denver';if(offset===-360)return 'America/Chicago';if(offset===-300)return 'America/New_York';if(offset===-540)return 'America/Anchorage';}
  }
  var zones={CA:'America/Los_Angeles',WA:'America/Los_Angeles',NV:'America/Los_Angeles',OR:'America/Los_Angeles',CO:'America/Denver',MT:'America/Denver',NM:'America/Denver',UT:'America/Denver',WY:'America/Denver',AL:'America/Chicago',AR:'America/Chicago',IA:'America/Chicago',IL:'America/Chicago',LA:'America/Chicago',MN:'America/Chicago',MS:'America/Chicago',MO:'America/Chicago',OK:'America/Chicago',WI:'America/Chicago',CT:'America/New_York',DC:'America/New_York',DE:'America/New_York',GA:'America/New_York',MA:'America/New_York',MD:'America/New_York',ME:'America/New_York',NH:'America/New_York',NJ:'America/New_York',NY:'America/New_York',NC:'America/New_York',OH:'America/New_York',PA:'America/New_York',RI:'America/New_York',SC:'America/New_York',VT:'America/New_York',VA:'America/New_York',WV:'America/New_York'};
  return zones[state]||'';
}
function status(message,isError){
  var addr=field('Street address');if(!addr)return;
  var host=addr.closest('.field')||addr.parentNode;
  var el=host&&host.querySelector('.restaurant-address-status');
  if(!el&&host&&message){el=document.createElement('small');el.className='restaurant-address-status';el.style.cssText='display:block;margin-top:3px;font:700 9pt Arial,sans-serif';host.appendChild(el);}
  if(el){el.textContent=message||'';el.style.color=isError?'#a12622':'#555';el.style.display=message?'block':'none';}
}
function suppressBrowserAutofill(el){
  if(!el)return;
  el.setAttribute('autocomplete','new-password');el.setAttribute('autocorrect','off');el.setAttribute('autocapitalize','none');el.setAttribute('spellcheck','false');el.setAttribute('data-lpignore','true');el.setAttribute('data-1p-ignore','true');el.setAttribute('data-form-type','other');el.setAttribute('name','novara-restaurant-address-lookup');
  var form=el.closest&&el.closest('form');if(form)form.setAttribute('autocomplete','off');
}
function loadMaps(){
  if(global.google&&global.google.maps)return Promise.resolve();if(loadPromise)return loadPromise;if(!key)return Promise.reject(new Error('Google address lookup is not configured.'));
  loadPromise=new Promise(function(resolve,reject){
    var cb='__novaraRestaurantAddressGoogleReady',timer=setTimeout(function(){reject(new Error('Google address lookup did not finish loading.'));},15000);
    global[cb]=function(){clearTimeout(timer);try{delete global[cb];}catch(_){global[cb]=undefined;}resolve();};
    var s=document.createElement('script');s.src='https://maps.googleapis.com/maps/api/js?key='+encodeURIComponent(key)+'&loading=async&libraries=places&v=weekly&callback='+cb;s.async=true;s.defer=true;s.onerror=function(){clearTimeout(timer);reject(new Error('Google address lookup could not load.'));};document.head.appendChild(s);
  });return loadPromise;
}
function applyTimeZone(state,offset){var tz=timeZoneFor(state,offset);if(!tz)return;[0,50,200].forEach(function(delay){setTimeout(function(){setField('Time zone',tz);status('',false);},delay);});}
function closeMenu(menu){if(menu){menu.innerHTML='';menu.style.display='none';}}
function menuFor(input){
  var host=input.closest('.field')||input.parentNode;host.style.position='relative';
  var menu=host.querySelector('.restaurant-address-menu');
  if(!menu){menu=document.createElement('div');menu.className='restaurant-address-menu';menu.style.cssText='position:absolute;left:0;right:0;top:100%;z-index:9999;background:#fff;border:1px solid #7f8c99;border-radius:5px;box-shadow:0 4px 12px rgba(0,0,0,.18);max-height:260px;overflow:auto;display:none';host.appendChild(menu);}
  return menu;
}
function styleAddressInput(input){
  input.style.height='32px';input.style.minHeight='32px';input.style.padding='5px 8px';input.style.font='12pt Arial,sans-serif';input.style.color='#000';input.style.background='#fff';input.style.border='1px solid #7f8c99';input.style.borderRadius='5px';input.style.boxSizing='border-box';input.style.width='100%';
}
async function attach(){
  var original=field('Street address');if(!original||original.dataset.googleAddressReady==='1')return;
  original.dataset.googleAddressReady='1';suppressBrowserAutofill(original);styleAddressInput(original);
  try{
    await loadMaps();
    var places=typeof global.google.maps.importLibrary==='function'?await global.google.maps.importLibrary('places'):global.google.maps.places;
    var AutocompleteSuggestion=places.AutocompleteSuggestion||(global.google.maps.places&&global.google.maps.places.AutocompleteSuggestion);
    var AutocompleteSessionToken=places.AutocompleteSessionToken||(global.google.maps.places&&global.google.maps.places.AutocompleteSessionToken);
    if(!AutocompleteSuggestion||typeof AutocompleteSuggestion.fetchAutocompleteSuggestions!=='function')throw new Error('Google Places address autocomplete is unavailable.');
    var menu=menuFor(original),token=AutocompleteSessionToken?new AutocompleteSessionToken():null,timer=0,lastQuery='';
    async function search(){
      var q=String(original.value||'').trim();lastQuery=q;closeMenu(menu);if(q.length<3)return;
      try{
        var req={input:q,includedRegionCodes:['us']};if(token)req.sessionToken=token;
        var res=await AutocompleteSuggestion.fetchAutocompleteSuggestions(req);if(lastQuery!==q)return;
        var suggestions=(res&&res.suggestions)||[];if(!suggestions.length)return;
        menu.innerHTML='';
        suggestions.slice(0,8).forEach(function(s){
          var pred=s.placePrediction;if(!pred)return;
          var btn=document.createElement('button');btn.type='button';btn.style.cssText='display:block;width:100%;text-align:left;border:0;border-bottom:1px solid #e2e7eb;background:#fff;padding:8px 10px;font:12pt Arial,sans-serif;color:#000;cursor:pointer';
          btn.textContent=pred.text&&pred.text.toString?pred.text.toString():String(pred.text||'');
          btn.addEventListener('mousedown',function(e){e.preventDefault();});
          btn.addEventListener('click',async function(){
            try{
              var place=pred.toPlace();await place.fetchFields({fields:['addressComponents','formattedAddress','displayName','utcOffsetMinutes']});
              var p=parseAddress(place.addressComponents);if(!p.address&&place.formattedAddress)p.address=place.formattedAddress.split(',')[0].trim();
              setField('Street address',p.address);setField('City',p.city);setField('State',p.state);setField('ZIP',p.zip);applyTimeZone(p.state,place.utcOffsetMinutes);closeMenu(menu);status('',false);
              token=AutocompleteSessionToken?new AutocompleteSessionToken():null;
            }catch(err){console.error(err);status('Address selected, but the details could not be filled automatically.',true);}
          });
          menu.appendChild(btn);
        });menu.style.display='block';
      }catch(err){console.error(err);status('Google address lookup could not return suggestions.',true);}
    }
    original.addEventListener('input',function(){clearTimeout(timer);timer=setTimeout(search,180);});
    original.addEventListener('focus',function(){suppressBrowserAutofill(original);if(String(original.value||'').trim().length>=3)search();},true);
    original.addEventListener('keydown',function(e){if(e.key==='Escape')closeMenu(menu);});
    document.addEventListener('click',function(e){if(e.target!==original&&!menu.contains(e.target))closeMenu(menu);});
    status('',false);
  }catch(err){console.error(err);original.dataset.googleAddressReady='';status(err&&err.message?err.message:'Google address lookup could not start.',true);}
}
function start(){attach();var root=document.getElementById('section-content');if(root&&global.MutationObserver)new MutationObserver(function(){setTimeout(attach,0);}).observe(root,{childList:true,subtree:true});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})(window);
