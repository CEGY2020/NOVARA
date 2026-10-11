(function(){
'use strict';

function currentUserId(){
  try{
    var u=window.NovaraAuth&&window.NovaraAuth.getCurrentUser&&window.NovaraAuth.getCurrentUser();
    return u&&u.userId||'guest';
  }catch(_){return 'guest';}
}

function storageKey(){return 'prolinkRestaurantDrafts.v1.'+currentUserId();}
function readDrafts(){
  try{
    var v=JSON.parse(localStorage.getItem(storageKey())||'[]');
    return Array.isArray(v)?v:[];
  }catch(_){return [];}
}
function writeDrafts(v){localStorage.setItem(storageKey(),JSON.stringify(v));}
function title(d){return d&&d.sections&&d.sections.site&&d.sections.site.values&&d.sections.site.values['Restaurant / chain']||'Untitled restaurant';}
function hasMeaningfulData(d){
  if(!d||!d.sections)return false;
  return Object.keys(d.sections).some(function(sectionId){
    var s=d.sections[sectionId]||{};
    var values=s.values||{};
    var rows=s.rows||{};
    var meaningfulValue=Object.keys(values).some(function(k){
      var v=values[k];
      if(k==='Site ID'&&/PENDING$/i.test(String(v||'')))return false;
      return !(v===''||v===false||v==null);
    });
    var meaningfulRows=Object.keys(rows).some(function(k){return Array.isArray(rows[k])&&rows[k].length>0;});
    return meaningfulValue||meaningfulRows;
  });
}

function removeTrulyBlankUntitled(){
  var drafts=readDrafts();
  if(drafts.length<2)return;
  var kept=drafts.filter(function(d){return title(d)!=='Untitled restaurant'||hasMeaningfulData(d);});
  if(kept.length&&kept.length!==drafts.length){writeDrafts(kept);}
}

function addDeleteButton(){
  var bar=document.querySelector('.workspace-bar');
  var save=document.getElementById('save-draft');
  if(!bar||!save||document.getElementById('delete-draft'))return;
  var b=document.createElement('button');
  b.id='delete-draft';
  b.type='button';
  b.textContent='Delete Draft';
  b.style.cssText='color:#a12622!important;border-color:#a12622!important;background:#fff!important';
  save.insertAdjacentElement('afterend',b);
  b.addEventListener('click',function(){
    var picker=document.getElementById('draft-picker');
    if(!picker)return;
    var id=picker.value;
    var drafts=readDrafts();
    var selected=drafts.find(function(d){return d&&d.id===id;});
    if(!selected)return;
    var name=title(selected);
    if(!confirm('Delete draft "'+name+'"?'))return;
    var remaining=drafts.filter(function(d){return d&&d.id!==id;});
    if(!remaining.length){
      alert('Keep at least one draft. Create another restaurant first, then delete this one.');
      return;
    }
    writeDrafts(remaining);
    location.reload();
  });
}

function start(){
  removeTrulyBlankUntitled();
  addDeleteButton();
  var picker=document.getElementById('draft-picker');
  if(picker){
    var drafts=readDrafts();
    if(drafts.length!==picker.options.length)location.reload();
  }
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
