(function(){
'use strict';

const STOP=new Set(['a','an','and','as','at','but','by','for','from','in','into','nor','of','on','or','per','the','to','via','with']);
const KEEP=new Set(['RHW','DHW','HVAC','AEM','AS','ID','ZIP','BTU','GPM','PSI','OEM','API','PDF','URL','NOVARA','ProLink','kW']);

function titleSegment(seg,isFirst,isLast){
  if(!seg)return seg;
  if(KEEP.has(seg))return seg;
  if(/^[A-Z0-9]{2,}$/.test(seg))return seg;
  const lower=seg.toLowerCase();
  if(!isFirst&&!isLast&&STOP.has(lower))return lower;
  return lower.charAt(0).toUpperCase()+lower.slice(1);
}

function titleWord(word,index,total){
  if(!word.trim())return word;
  if(KEEP.has(word))return word;
  if(/^BTU\/h$/i.test(word))return 'BTU/h';
  if(/^kW$/i.test(word))return 'kW';
  if(/^[A-Z0-9]{2,}$/.test(word))return word;
  let partIndex=0;
  const parts=(word.match(/[A-Za-z]+/g)||[]);
  return word.replace(/[A-Za-z]+/g,function(seg){
    const first=index===0&&partIndex===0;
    const last=index===total-1&&partIndex===parts.length-1;
    partIndex++;
    return titleSegment(seg,first,last);
  });
}

function titleCase(text){
  const words=text.split(/(\s+)/);
  const real=words.filter(x=>x&&!/^\s+$/.test(x));
  let i=0;
  return words.map(function(piece){
    if(!piece||/^\s+$/.test(piece))return piece;
    const out=titleWord(piece,i,real.length);
    i++;
    return out;
  }).join('');
}

function updateTextNode(el){
  if(!el)return;
  const nodes=Array.from(el.childNodes).filter(n=>n.nodeType===Node.TEXT_NODE&&n.nodeValue.trim());
  nodes.forEach(function(n){
    const next=titleCase(n.nodeValue);
    if(next!==n.nodeValue)n.nodeValue=next;
  });
}

function apply(){
  document.querySelectorAll('.field > span, .form-section h2, .form-section h3, .repeat-heading h3, .record-header strong, .topbar h2, .workspace-overview .eyebrow, .workspace-overview h1, .review-card h2').forEach(updateTextNode);
  document.querySelectorAll('#section-nav > button, .workspace-bar label, .workspace-bar button, .file-button, .section-footer button, .repeat-heading button, .record-header button, .report-tools button').forEach(updateTextNode);
}

function start(){
  apply();
  const root=document.querySelector('.restaurant-layout')||document.body;
  if(window.MutationObserver){
    const observer=new MutationObserver(function(){apply();});
    observer.observe(root,{childList:true,subtree:true});
  }
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);
else start();
})();
