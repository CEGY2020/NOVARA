(function(){
'use strict';

const SECTION_INFO=[
  {id:'site',title:'Restaurant Profile',desc:'Site identity, location, utility territory, contractor and operating context.'},
  {id:'equipment',title:'DHW & Kitchen Equipment',desc:'Water-heating plant, installed heaters, kitchen hot-water equipment and condition information.'},
  {id:'core',title:'Core · Points & Operating Settings',desc:'Controller, monitored points, commissioning information and operating settings.'},
  {id:'alert',title:'Alert · Conditions & Routing',desc:'Alarm rules, notification routing, escalation contacts and acknowledgement procedures.'},
  {id:'leaks',title:'Alert · Leak Protection',desc:'Leak sensing, protective equipment, testing and emergency response information.'},
  {id:'service',title:'Contractor · Work & Full Job Costs',desc:'Service activity, diagnosis, scope, job status, costs, incentives and maintenance history.'},
  {id:'advise',title:'Advise · Sizing & Upgrade Review',desc:'Sizing inputs, replacement options, gas-use assumptions, costs and recommendation rationale.'},
  {id:'reports',title:'ProLink · Report Assistant',desc:'Requested reports, scope, schedule, recipients and report instructions.'},
  {id:'access',title:'ProLink · Access Request',desc:'Requested user access, approver information and permission records.'},
  {id:'utility',title:'Gas Data · UtilityAPI',desc:'Gas-meter authorization, history request, allocation method and connection status.'}
];

function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function userKey(){const u=window.NovaraAuth&&NovaraAuth.getCurrentUser&&NovaraAuth.getCurrentUser();return 'prolinkRestaurantDrafts.v1.'+(u&&u.userId||'guest');}
function drafts(){try{const d=JSON.parse(localStorage.getItem(userKey())||'[]');return Array.isArray(d)?d:[];}catch(e){return [];}}
function selectedDraft(){const picker=document.getElementById('draft-picker');const list=drafts();if(!list.length)return null;return list.find(d=>picker&&d.id===picker.value)||list[0];}
function values(d,id){return d&&d.sections&&d.sections[id]&&d.sections[id].values||{};}
function rows(d,id,name){const r=d&&d.sections&&d.sections[id]&&d.sections[id].rows&&d.sections[id].rows[name];return Array.isArray(r)?r:[];}
function chain(d){return String(values(d,'site')['Restaurant / chain']||'Untitled restaurant').trim();}
function siteId(d){return String(values(d,'site')['Site ID']||'Site ID pending').trim();}
function cityState(d){const v=values(d,'site');return [v.City,v.State].filter(Boolean).join(', ');}
function present(v){return v!==undefined&&v!==null&&v!==''&&v!==false;}
function started(d,id){const s=d&&d.sections&&d.sections[id];if(!s)return false;return Object.values(s.values||{}).some(present)||Object.values(s.rows||{}).some(v=>Array.isArray(v)&&v.length);}
function countStarted(d){return SECTION_INFO.filter(s=>started(d,s.id)).length;}
function sectionSnapshot(d,id){
  const v=values(d,id), out=[];
  Object.keys(v).forEach(k=>{if(present(v[k]))out.push({label:k,value:typeof v[k]==='boolean'?(v[k]?'Yes':'No'):v[k]});});
  return out;
}
function sectionRowsSnapshot(d,id){
  const s=d&&d.sections&&d.sections[id]; if(!s||!s.rows)return [];
  const out=[]; Object.keys(s.rows).forEach(name=>{const list=s.rows[name];if(Array.isArray(list)&&list.length)out.push({name:name,records:list});});
  return out;
}
function sectionHtml(d,info){
  const fields=sectionSnapshot(d,info.id);
  const repeats=sectionRowsSnapshot(d,info.id);
  let body='<p class="desc">'+esc(info.desc)+'</p>';
  if(fields.length){body+='<table><tbody>'+fields.map(r=>'<tr><th>'+esc(r.label)+'</th><td>'+esc(r.value)+'</td></tr>').join('')+'</tbody></table>';}
  else body+='<p class="empty">No section values entered.</p>';
  repeats.forEach(group=>{
    body+='<h3>'+esc(group.name.replace(/[-_]/g,' '))+'</h3>';
    group.records.forEach((record,i)=>{
      const entries=Object.keys(record||{}).filter(k=>present(record[k]));
      body+='<div class="record"><strong>Record '+(i+1)+'</strong>'+(entries.length?'<table><tbody>'+entries.map(k=>'<tr><th>'+esc(k)+'</th><td>'+esc(typeof record[k]==='boolean'?(record[k]?'Yes':'No'):record[k])+'</td></tr>').join('')+'</tbody></table>':'<p class="empty">No values entered.</p>')+'</div>';
    });
  });
  return '<section class="report-section"><h2>'+esc(info.title)+'</h2>'+body+'</section>';
}
function popup(title,body){
  const w=window.open('','_blank'); if(!w){alert('Please allow pop-ups for this site to open reports.');return;}
  const html='<!doctype html><html><head><meta charset="utf-8"><title>'+esc(title)+'</title><style>body{font:12pt Arial,sans-serif;color:#000;margin:32px}h1{font-size:20pt;margin:0 0 6px}h2{font-size:15pt;border-bottom:1px solid #999;padding-bottom:5px;margin-top:26px}h3{font-size:12pt;margin:18px 0 6px}.meta{margin:0 0 18px;font-weight:700}.desc{margin:4px 0 12px}.actions{margin-bottom:18px}.actions button{font:12pt Arial;padding:6px 12px;margin-right:8px}table{width:100%;border-collapse:collapse;margin:8px 0 16px}th,td{border:1px solid #999;padding:6px 8px;text-align:left;vertical-align:top}th{width:38%;background:#f2f5f7}.record{break-inside:avoid}.report-section{break-inside:auto}.empty{color:#666}.note{border:1px solid #bbb;background:#f7f7f7;padding:10px;margin:12px 0}.comparison th:first-child{width:auto}@media print{.actions{display:none}body{margin:.45in}.report-section{break-before:page}.report-section:first-of-type{break-before:auto}}</style></head><body><div class="actions"><button onclick="window.print()">Print / Save PDF</button><button onclick="window.close()">Close</button></div>'+body+'</body></html>';
  w.document.open();w.document.write(html);w.document.close();
}
function printSelected(){
  const d=selectedDraft(); if(!d){alert('No restaurant draft is available.');return;}
  const ids=Array.from(document.querySelectorAll('#report-center-section input[type="checkbox"][data-section]:checked')).map(x=>x.dataset.section);
  if(!ids.length){alert('Select at least one section to print.');return;}
  const chosen=SECTION_INFO.filter(s=>ids.includes(s.id));
  const body='<h1>'+esc(chain(d))+' · Selected Reports</h1><div class="meta">Site ID: '+esc(siteId(d))+' &nbsp; | &nbsp; '+esc(cityState(d)||'Location not entered')+' &nbsp; | &nbsp; '+esc(new Date().toLocaleDateString())+'</div>'+chosen.map(s=>sectionHtml(d,s)).join('');
  popup(chain(d)+' Selected Reports',body);
}
function companyRows(list){
  const groups={};
  list.forEach(d=>{const c=chain(d)||'Untitled restaurant';if(!groups[c])groups[c]=[];groups[c].push(d);});
  return Object.keys(groups).sort().map(c=>{
    const sites=groups[c];
    const avg=sites.length?Math.round(sites.reduce((n,d)=>n+countStarted(d),0)/sites.length*10)/10:0;
    return {company:c,sites:sites.length,avgStarted:avg};
  });
}
function summaryReport(){
  const current=selectedDraft(); if(!current){alert('No restaurant draft is available.');return;}
  const all=drafts(); const currentChain=chain(current);
  const same=all.filter(d=>d.id!==current.id&&chain(d)===currentChain);
  const others=all.filter(d=>chain(d)!==currentChain);
  const sv=values(current,'site'), ev=values(current,'equipment'), cv=values(current,'core'), lv=values(current,'leaks'), sev=values(current,'service'), av=values(current,'advise'), uv=values(current,'utility');
  const siteSummary=[
    ['Restaurant / Chain',currentChain],['Site ID',siteId(current)],['Location',cityState(current)||'Not entered'],['Street Address',sv['Street address']||'Not entered'],['Utility Territory',sv['Utility territory']||'Not entered'],['Servicing Contractor',sv['Servicing contractor']||'Not entered'],['Plant Arrangement',ev['Plant arrangement']||'Not entered'],['Controller / Gateway',cv['Controller / gateway']||'Not entered'],['Leak Detection',lv['Leak detection installed']||'Not entered'],['Job Status',sev['Job status']||'Not entered'],['Advise Decision',av.Decision||'Not entered'],['Gas Data Status',uv['Connection status']||uv['Authorization status']||'Not entered'],['Sections Started',countStarted(current)+' of '+SECTION_INFO.length]
  ];
  let body='<h1>'+esc(currentChain)+' · Site Summary Report</h1><div class="meta">Site ID: '+esc(siteId(current))+' &nbsp; | &nbsp; Report Date: '+esc(new Date().toLocaleDateString())+'</div>';
  body+='<p class="note"><strong>Comparison basis:</strong> this report compares only Restaurant drafts saved in this browser for the current signed-in user. It does not claim measured energy, runtime, alarm, or cost performance unless those values have actually been entered in the Restaurant data.</p>';
  body+='<h2>Site Summary</h2><table><tbody>'+siteSummary.map(r=>'<tr><th>'+esc(r[0])+'</th><td>'+esc(r[1])+'</td></tr>').join('')+'</tbody></table>';
  body+='<h2>Available Reports</h2><table><tbody>'+SECTION_INFO.map(s=>'<tr><th>'+esc(s.title)+'</th><td>'+esc(s.desc)+'</td></tr>').join('')+'</tbody></table>';
  body+='<h2>Comparison With Other '+esc(currentChain)+' Sites</h2>';
  if(!same.length){body+='<p class="empty">No other saved sites for this company/chain are available in this browser.</p>';}
  else{
    body+='<table class="comparison"><thead><tr><th>Site ID</th><th>Location</th><th>Contractor</th><th>Plant</th><th>Controller</th><th>Sections Started</th></tr></thead><tbody>'+same.map(d=>{const s=values(d,'site'),e=values(d,'equipment'),c=values(d,'core');return '<tr><td>'+esc(siteId(d))+'</td><td>'+esc(cityState(d)||'—')+'</td><td>'+esc(s['Servicing contractor']||'—')+'</td><td>'+esc(e['Plant arrangement']||'—')+'</td><td>'+esc(c['Controller / gateway']||'—')+'</td><td>'+esc(countStarted(d)+'/'+SECTION_INFO.length)+'</td></tr>';}).join('')+'</tbody></table>';
  }
  body+='<h2>Comparison With Other Companies</h2>';
  if(!others.length){body+='<p class="empty">No saved Restaurant sites for other companies/chains are available in this browser.</p>';}
  else{
    const groups=companyRows(others);
    body+='<table class="comparison"><thead><tr><th>Company / Chain</th><th>Saved Sites</th><th>Average Sections Started</th></tr></thead><tbody>'+groups.map(g=>'<tr><td>'+esc(g.company)+'</td><td>'+g.sites+'</td><td>'+esc(g.avgStarted+' of '+SECTION_INFO.length)+'</td></tr>').join('')+'</tbody></table>';
  }
  body+='<h2>Overall Assessment</h2><p>'+esc('This site currently has '+countStarted(current)+' of '+SECTION_INFO.length+' Restaurant sections started. Use the selected section reports for the detailed site record. The company and cross-company tables above provide a data-completeness and configuration comparison only; they are not a performance ranking unless comparable measured operating data has been entered for all sites.')+'</p>';
  popup(currentChain+' Site Summary',body);
}
function build(){
  const root=document.getElementById('section-content'),nav=document.getElementById('section-nav');if(!root||!nav)return;
  const old=document.getElementById('report-center-section');if(old)old.remove();
  const oldBtn=document.getElementById('report-center-nav');if(oldBtn)oldBtn.remove();
  const sec=document.createElement('section');sec.id='report-center-section';sec.className='form-section';sec.hidden=true;
  sec.innerHTML='<h2>Reports & Print</h2><p>Select the section reports you want to print, or create a summary and comparison report for this site.</p><div class="report-center-list"></div><div class="report-tools report-center-actions"></div>';
  const list=sec.querySelector('.report-center-list');
  SECTION_INFO.forEach(info=>{const label=document.createElement('label');label.style.display='flex';label.style.alignItems='center';label.style.gap='8px';label.style.margin='6px 0';const cb=document.createElement('input');cb.type='checkbox';cb.dataset.section=info.id;cb.checked=true;const span=document.createElement('span');span.innerHTML='<strong>'+esc(info.title)+'</strong> — '+esc(info.desc);label.append(cb,span);list.append(label);});
  const actions=sec.querySelector('.report-center-actions');
  function button(text,fn){const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=fn;actions.append(b);}
  button('Select All',()=>sec.querySelectorAll('input[data-section]').forEach(x=>x.checked=true));
  button('Clear All',()=>sec.querySelectorAll('input[data-section]').forEach(x=>x.checked=false));
  button('Print Selected Reports',printSelected);
  button('Site Summary Report',summaryReport);
  root.append(sec);
  const navBtn=document.createElement('button');navBtn.id='report-center-nav';navBtn.type='button';navBtn.textContent='Reports & Print';const small=document.createElement('small');small.textContent='Select · print · compare';navBtn.append(small);
  navBtn.onclick=function(){Array.from(root.children).forEach(s=>{if(s.classList&&s.classList.contains('form-section'))s.hidden=s!==sec;});Array.from(nav.children).forEach(b=>b.removeAttribute('aria-current'));navBtn.setAttribute('aria-current','step');root.scrollIntoView({behavior:'smooth',block:'start'});};
  nav.append(navBtn);
  Array.from(nav.children).filter(b=>b!==navBtn).forEach(b=>b.addEventListener('click',()=>{sec.hidden=true;navBtn.removeAttribute('aria-current');},{capture:true}));
}
function start(){build();setTimeout(build,400);}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
