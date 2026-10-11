(function(){
'use strict';

function esc(value){
  return String(value==null?'':value).replace(/[&<>"']/g,function(ch){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
  });
}

function controlValue(input){
  if(!input)return '';
  if(input.type==='checkbox')return input.checked?'Yes':'No';
  if(input.tagName==='SELECT'){
    const option=input.options[input.selectedIndex];
    return option&&input.value?option.textContent.trim():'';
  }
  return String(input.value||'').trim();
}

function fieldRows(section){
  const rows=[];
  section.querySelectorAll('.field').forEach(function(field){
    if(field.closest('.repeat-record'))return;
    if(getComputedStyle(field).display==='none')return;
    const input=field.querySelector('[data-label]');
    if(!input)return;
    rows.push({label:input.dataset.label||'',value:controlValue(input)});
  });
  return rows;
}

function repeatGroups(section){
  const groups=[];
  let currentTitle='Records';
  Array.from(section.children).forEach(function(child){
    if(child.classList&&child.classList.contains('repeat-heading')){
      const h=child.querySelector('h3');
      currentTitle=h?h.textContent.trim():'Records';
      if(!groups.length||groups[groups.length-1].title!==currentTitle)groups.push({title:currentTitle,records:[]});
      return;
    }
    if(child.classList&&child.classList.contains('repeat-record')){
      if(!groups.length||groups[groups.length-1].title!==currentTitle)groups.push({title:currentTitle,records:[]});
      const record=[];
      child.querySelectorAll('.field').forEach(function(field){
        if(getComputedStyle(field).display==='none')return;
        const input=field.querySelector('[data-label]');
        if(!input)return;
        record.push({label:input.dataset.label||'',value:controlValue(input)});
      });
      groups[groups.length-1].records.push(record);
    }
  });
  return groups;
}

function table(rows){
  if(!rows.length)return '';
  return '<table><tbody>'+rows.map(function(row){
    return '<tr><th>'+esc(row.label)+'</th><td>'+(row.value?esc(row.value):'<span class="blank">—</span>')+'</td></tr>';
  }).join('')+'</tbody></table>';
}

function report(section){
  const title=(section.querySelector(':scope > h2')||{}).textContent||'Restaurant Report';
  const subtitle=(section.querySelector(':scope > p')||{}).textContent||'';
  const chainInput=document.querySelector('#section-site [data-label="Restaurant / chain"]');
  const siteInput=document.querySelector('#section-site [data-label="Site ID"]');
  const chain=controlValue(chainInput)||'Restaurant';
  const site=controlValue(siteInput)||'Site ID pending';
  const rows=fieldRows(section);
  const repeats=repeatGroups(section);
  const logo=(document.querySelector('.aem-brand img')||{}).src||'https://cegy2020.github.io/NOVARA/logo.png';
  const repeatHtml=repeats.map(function(group){
    let body='';
    if(!group.records.length){
      body='<p class="empty">No records entered.</p>';
    }else{
      body=group.records.map(function(record,index){
        return '<div class="record"><h3>Record '+(index+1)+'</h3>'+table(record)+'</div>';
      }).join('');
    }
    return '<section class="records"><h2>'+esc(group.title)+'</h2>'+body+'</section>';
  }).join('');
  const html='<!doctype html><html><head><meta charset="utf-8"><title>'+esc(chain)+' - '+esc(title)+'</title><style>'+
    'body{font-family:Arial,Helvetica,sans-serif;color:#000;margin:32px;font-size:12pt}.head{display:flex;align-items:center;gap:16px;border-bottom:2px solid #000;padding-bottom:12px;margin-bottom:18px}.head img{width:74px;height:50px;object-fit:contain}.head h1{font-size:20pt;margin:0 0 4px}.meta{display:flex;gap:28px;flex-wrap:wrap;margin:8px 0 20px;font-weight:700}.description{margin:0 0 18px}table{width:100%;border-collapse:collapse;margin:8px 0 20px}th,td{border:1px solid #999;padding:7px 9px;text-align:left;vertical-align:top}th{width:42%;background:#f2f5f7}.records{margin-top:24px}.records>h2{font-size:15pt;border-bottom:1px solid #aaa;padding-bottom:5px}.record{break-inside:avoid;margin:14px 0}.record h3{font-size:12pt;margin:0 0 6px}.blank,.empty{color:#666}.actions{margin-bottom:18px}.actions button{font:12pt Arial;padding:7px 12px;margin-right:8px}@media print{.actions{display:none}body{margin:0.45in}thead{display:table-header-group}}'+
    '</style></head><body><div class="actions"><button onclick="window.print()">Print / Save PDF</button><button onclick="window.close()">Close</button></div><div class="head"><img src="'+esc(logo)+'"><div><h1>'+esc(title)+' Report</h1><div>'+esc(chain)+'</div></div></div><div class="meta"><span>Site ID: '+esc(site)+'</span><span>Report Date: '+esc(new Date().toLocaleDateString())+'</span></div><p class="description">'+esc(subtitle)+'</p>'+table(rows)+repeatHtml+'</body></html>';
  const win=window.open('','_blank');
  if(!win){alert('Please allow pop-ups for this site to open the report.');return;}
  win.document.open();
  win.document.write(html);
  win.document.close();
}

function addButtons(){
  document.querySelectorAll('.form-section').forEach(function(section){
    const footer=section.querySelector('.section-footer');
    if(!footer||footer.querySelector('.section-report-button'))return;
    const button=document.createElement('button');
    button.type='button';
    button.className='section-report-button';
    button.textContent='View / Print Report';
    button.addEventListener('click',function(){report(section);});
    const next=footer.lastElementChild;
    if(next)footer.insertBefore(button,next);else footer.appendChild(button);
  });
}

function start(){
  addButtons();
  const root=document.getElementById('section-content');
  if(root&&window.MutationObserver){
    new MutationObserver(function(){setTimeout(addButtons,0);}).observe(root,{childList:true,subtree:true});
  }
  setTimeout(addButtons,250);
  setTimeout(addButtons,1000);
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
