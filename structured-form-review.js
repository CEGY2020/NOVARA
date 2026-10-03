(function () {
  'use strict';
  const fields = {
    company: [['CompanyName','Company name'],['RelationshipType','Relationship',['','MGMT','OWNER']],['CompanyID','Existing Company ID (optional)'],['Address','Office street address'],['City','Office city'],['State','State'],['Zip','ZIP'],['Phone','Office phone'],['Email','Company email'],['Notes','Outreach notes']],
    contacts: [['ContactName','Name'],['Title','Title / role'],['Scope','Scope',['Company','Site']],['SiteName','Site name (site contacts only)'],['Email','Email'],['Phone','Direct phone'],['OfficePhone','Office / routing phone'],['VerificationStatus','Verification'],['Notes','Contact notes']],
    sites: [['SiteName','Property name'],['SiteID','Existing Site ID (optional)'],['Address','Street address'],['City','City'],['State','State'],['Zip','ZIP'],['Phone','Site phone'],['OwnerName','Owner (if identified)'],['ManagementStatus','Management status',['Needs confirmation','Source listing; verify current manager','Unconfirmed','Confirmed']],['PoolCount','Pool count'],['PoolAreaSqFt','Pool area (sq ft)'],['PoolAreaStatus','Area verification'],['SavingsAllowanceMonthlyPer800SqFt','Monthly allowance per 800 sq ft ($)'],['PoolEvidence','Pool evidence'],['ReviewReason','Review flags'],['Notes','Site outreach notes']],
    contactLogs: [['DateTime','Contact date / time'],['Method','Method'],['Person','Person / title'],['PhoneEmail','Phone / email'],['Outcome','Discussion / outcome'],['NextAction','Next action'],['FollowUp','Follow-up date']]
  };
  let section, current;
  function element(tag, text) {const e=document.createElement(tag); if(text)e.textContent=text; return e;}
  function invalidate() {if(current)current.confirm.checked=false;}
  function addCard(kind, row, container) {
    const card=element('details'); card.open=kind==='company' || !Object.keys(row).length; card.style.cssText='margin:8px 0;padding:10px;border:1px solid #a8b6c3;min-width:0';
    card.appendChild(element('summary',row.SiteName || row.ContactName || (kind==='company'?'Company / owner / management':'Contact log / new record')));
    const grid=element('div'); grid.className='form-grid'; const inputs={};
    fields[kind].forEach(([key,label,choices])=>{
      const lookup=key==='CompanyID'?current.records.companies:key==='SiteID'?current.records.sites:null;
      if(lookup)choices=['',...lookup.map(r=>r[key])];
      const wrapper=element('label',label), input=element(choices?'select':'input'); input.value=row[key] || '';
      if(choices){choices.forEach(value=>{const match=lookup&&lookup.find(r=>r[key]===value);input.add(new Option(match?((match.CompanyName||match.SiteName)+' · '+value):(value || (lookup?'Match by name/address or create new':'Unknown / review')),value));}); input.value=row[key] || choices[0];}
      if(key==='Email') input.inputMode='email';
      input.setAttribute('aria-label',label); input.addEventListener('input',invalidate);
      wrapper.appendChild(input);grid.appendChild(wrapper);inputs[key]=input;
    });
    card.appendChild(grid);
    if(kind==='sites') {
      const saving=element('p'); saving.style.marginTop='10px';
      function calc(){ const area=Number(inputs.PoolAreaSqFt.value.replace(/,/g,'')),rate=Number(inputs.SavingsAllowanceMonthlyPer800SqFt.value.replace(/,/g,'')); saving.textContent=area>0&&rate>=0&&inputs.SavingsAllowanceMonthlyPer800SqFt.value ? 'Preliminary savings: $'+(area/800*rate).toFixed(2)+'/month · $'+(area/800*rate*12).toFixed(2)+'/year. Confirm area before quoting.' : 'Savings pending pool area and allowance.';}
      inputs.PoolAreaSqFt.addEventListener('input',calc);inputs.SavingsAllowanceMonthlyPer800SqFt.addEventListener('input',calc);calc();card.appendChild(saving);
    }
    const record={inputs,card};current.rows[kind].push(record);
    if(kind!=='company') {const remove=element('button','Remove from this import');remove.type='button';remove.addEventListener('click',()=>{current.rows[kind]=current.rows[kind].filter(r=>r!==record);card.remove();invalidate();});card.appendChild(remove);}
    container.appendChild(card);
  }
  function hide(){if(section)section.hidden=true;current=null;}
  document.getElementById('customer-file').addEventListener('change',hide);
  document.getElementById('read-form').addEventListener('click',hide);
  window.NovaraStructuredForms={show(bundle,payload,records,reload){
    if(!section){section=element('section');section.className='card';document.getElementById('review-section').before(section);}
    section.replaceChildren();section.hidden=false;
    current={rows:{company:[],contacts:[],sites:[],contactLogs:[]},confirm:element('input'),records};
    section.appendChild(element('h3','2. Review database records'));
    section.appendChild(element('p','Company, contacts, properties, pool data, and contact history are saved in separate fields. Notes contain only your outreach notes. Blank fields preserve existing values.'));
    section.appendChild(element('p',`${bundle.sites.length} sites and ${bundle.contacts.length} contacts found. Confirm matches and remove any records you do not want to import.`));
    (bundle.warnings||[]).forEach(w=>section.appendChild(element('p',w)));
    const source=element('details');source.appendChild(element('summary','View original extracted text'));const sourceText=element('pre',document.getElementById('source-text').textContent);sourceText.style.cssText='white-space:pre-wrap;max-height:260px;overflow:auto';source.appendChild(sourceText);section.appendChild(source);
    const companyMatches=records.companies.filter(r=>r.CompanyName.trim().toLowerCase()===bundle.company.CompanyName.trim().toLowerCase());
    if(companyMatches.length===1)bundle.company.CompanyID=companyMatches[0].CompanyID;
    const form=element('form');section.appendChild(form);
    for(const kind of ['company','contacts','sites','contactLogs']){
      const group=element('div');form.appendChild(group);group.appendChild(element('h4',({company:'Company and office',contacts:'Contacts',sites:'Properties and pools',contactLogs:'Contact history'})[kind]));
      (kind==='company'?[bundle.company]:(bundle[kind]||[])).forEach(row=>addCard(kind,row,group));
      if(kind!=='company'){const add=element('button','Add '+({contacts:'contact',sites:'site',contactLogs:'contact log'})[kind]);add.type='button';add.addEventListener('click',()=>{addCard(kind,{},group);invalidate();});group.appendChild(add);}
    }
    const label=element('label');current.confirm.type='checkbox';current.confirm.required=true;label.append(current.confirm,document.createTextNode(' I reviewed these records and their company/site assignments.'));form.appendChild(label);
    const save=element('button','Save All Reviewed Records');save.type='submit';save.className='primary-btn';save.style.cssText='display:block;margin:12px 0';form.appendChild(save);
    const message=element('p');message.setAttribute('role','status');form.appendChild(message);
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(!current.confirm.checked || save.disabled)return;
      const structured={};for(const [kind,rows] of Object.entries(current.rows)){const values=rows.map(r=>Object.fromEntries(Object.entries(r.inputs).map(([k,input])=>[k,input.value.trim()])));structured[kind]=kind==='company'?values[0]:values;}
      const controls=[...form.querySelectorAll('input,select,button')];controls.forEach(c=>c.disabled=true);document.getElementById('read-form').disabled=true;document.getElementById('customer-file').disabled=true;
      message.textContent='Saving structured customer records…';
      try{
        const result=await NovaraApi.sendJson('/api/customer-forms/import-structured','POST',{...payload,structured,reviewed:true});
        message.textContent=result.alreadyImported?'This document was already imported as structured records; no duplicates created.':`Saved ${result.siteIds.length} sites, ${result.contactIds.length} contacts, and ${result.leadIds.length} leads. Company and owner/management records are linked. The original form is attached.`;
        try{await reload();}catch(error){message.textContent+=' Saved successfully; refresh the page to reload the list.';}
      }catch(error){message.textContent=error.message;}finally{controls.forEach(c=>c.disabled=false);current.confirm.checked=false;document.getElementById('read-form').disabled=false;document.getElementById('customer-file').disabled=false;}
    });
  }};
})();
