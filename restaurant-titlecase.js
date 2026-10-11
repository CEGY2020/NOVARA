(function(){
'use strict';

const STOP=new Set(['a','an','and','as','at','but','by','for','from','in','into','nor','of','on','or','per','the','to','via','with']);
const KEEP=new Map([
  ['rhw','RHW'],['dhw','DHW'],['hvac','HVAC'],['aem','AEM'],['as','AS'],['id','ID'],['zip','ZIP'],['btu','BTU'],['gpm','GPM'],['psi','PSI'],['oem','OEM'],['api','API'],['pdf','PDF'],['url','URL'],['novara','NOVARA'],['prolink','ProLink'],['kw','kW']
]);

function convertWord(word,index,total){
  if(!word)return word;
  const lower=word.toLowerCase();
  if(KEEP.has(lower))return KEEP.get(lower);
  if(index>0&&index<total-1&&STOP.has(lower))return lower;
  return lower.charAt(0).toUpperCase()+lower.slice(1);
}

function titleCase(text){
  const tokens=String(text||'').split(/(\s+)/);
  const real=tokens.filter(t=>t&&!/^\s+$/.test(t));
  let index=0;
  return tokens.map(function(token){
    if(!token||/^\s+$/.test(token))return token;
    const current=index++;
    return token.replace(/[A-Za-z]+/g,function(part){
      return convertWord(part,current,real.length);
    });
  }).join('');
}

function setLeadingText(el,text){
  if(!el)return;
  let node=Array.from(el.childNodes).find(n=>n.nodeType===3&&n.nodeValue.trim());
  if(node)node.nodeValue=titleCase(text)+' ';
  else el.insertBefore(document.createTextNode(titleCase(text)+' '),el.firstChild);
}

function apply(){
  document.querySelectorAll('.field').forEach(function(field){
    const input=field.querySelector('[data-label]');
    const span=field.querySelector(':scope > span');
    if(input&&span)setLeadingText(span,input.dataset.label||'');
  });

  const buttons=document.querySelectorAll('#section-nav > button');
  buttons.forEach(function(button,index){
    const schema=window.RestaurantSchema&&window.RestaurantSchema[index];
    if(schema)setLeadingText(button,schema.title||'');
    const small=button.querySelector('small');
    if(small)small.textContent=titleCase(small.textContent);
  });

  document.querySelectorAll('.form-section').forEach(function(section){
    const id=section.id.replace(/^section-/,'');
    const schema=(window.RestaurantSchema||[]).find(s=>s.id===id);
    const h2=section.querySelector(':scope > h2');
    if(schema&&h2)h2.textContent=titleCase(schema.title||'');
  });

  document.querySelectorAll('.repeat-heading h3,.record-header strong,.workspace-bar label,.workspace-bar button,.file-button,.section-footer button,.repeat-heading button,.record-header button,.report-tools button,.review-card h2,.workspace-overview .eyebrow,.workspace-overview h1,.topbar h2').forEach(function(el){
    if(el.children.length)setLeadingText(el,el.firstChild&&el.firstChild.nodeType===3?el.firstChild.nodeValue:el.textContent);
    else el.textContent=titleCase(el.textContent);
  });
}

function start(){
  apply();
  const root=document.querySelector('.restaurant-layout')||document.body;
  if(window.MutationObserver){
    const observer=new MutationObserver(function(){setTimeout(apply,0);});
    observer.observe(root,{childList:true,subtree:true});
  }
  setTimeout(apply,250);
  setTimeout(apply,1000);
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);
else start();
})();
