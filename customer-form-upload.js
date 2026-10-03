(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const fieldNames = ['companyId','companyName','siteId','siteName','address','city','state','zip','leadId','contactName','email','phone','stage','followUp','assignedTo','notes'];
  let records = null, filePayload = null, documents = [], busy = false, reading = 0;
  function status(message, error) { $('form-status').textContent = message; $('form-status').classList.toggle('is-error', !!error); }
  function lock(value) {
    busy = value;
    ['read-form','save-form','reload-records','customer-file',...fieldNames,'review-confirm'].forEach(id => $(id).disabled = value);
  }
  function options(id, rows, key, label) {
    const select = $(id), previous = select.value;
    while (select.options.length > 1) select.remove(1);
    rows.forEach(row => select.add(new Option(label(row), row[key])));
    select.value = rows.some(row => row[key] === previous) ? previous : '';
  }
  async function reload() {
    const data = await NovaraApi.fetchJson('/api/customer-forms/records');
    if (!Array.isArray(data.companies) || !Array.isArray(data.sites) || !Array.isArray(data.leads)) throw new Error('Customer records could not be loaded.');
    records = data;
    options('companyId', data.companies, 'CompanyID', r => r.CompanyName + ' · ' + r.CompanyID);
    options('siteId', data.sites, 'SiteID', r => [r.SiteName,r.Address,r.City].filter(Boolean).join(' · '));
    options('leadId', data.leads, 'LeadID', r => (r.SiteName || r.CompanyName) + ' · ' + r.LeadID);
    const history = await NovaraApi.fetchJson('/api/customer-forms/documents');
    documents = history.documents || []; renderDocuments();
  }
  function renderDocuments() {
    const target = $('documents'); target.replaceChildren();
    const filter = $('document-search').value.toLowerCase();
    const table = document.createElement('table'); table.className = 'data-table';
    const head = table.createTHead().insertRow();
    ['Form','Site','Lead','Uploaded','Download'].forEach(label => {const th = document.createElement('th'); th.textContent = label; head.appendChild(th);});
    const body = table.createTBody();
    documents.slice().sort((a,b) => String(b.UpdatedAt).localeCompare(String(a.UpdatedAt))).forEach(doc => {
      const site = (records.sites.find(s => s.SiteID === doc.SiteID) || {}).SiteName || doc.SiteID;
      if (![doc.FileName,site,doc.LeadID].join(' ').toLowerCase().includes(filter)) return;
      const row = body.insertRow();
      [doc.FileName,site,doc.LeadID,String(doc.UpdatedAt).slice(0,10)].forEach(value => row.insertCell().textContent = value);
      const button = document.createElement('button'); button.type='button'; button.textContent='Download';
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          const response = await NovaraApi.fetchJson('/api/customer-forms/download', {id:doc.SettingKey});
          const bytes = Uint8Array.from(atob(response.fileBase64), c => c.charCodeAt(0));
          const url = URL.createObjectURL(new Blob([bytes], {type:'application/octet-stream'}));
          const a = document.createElement('a'); a.href=url; a.download=response.fileName; a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (err) {status(err.message,true);} finally {button.disabled=false;}
      });
      row.insertCell().appendChild(button);
    });
    target.appendChild(table);
  }
  $('document-search').addEventListener('input', renderDocuments);
  fieldNames.forEach(id => $(id).addEventListener('input', () => { $('review-confirm').checked=false; }));
  $('customer-file').addEventListener('change', () => {
    reading++; filePayload=null; $('review-section').hidden=true; $('review-confirm').checked=false;
    status('Click Read Form to prepare this file.');
  });
  $('companyId').addEventListener('change', () => {
    const row = records.companies.find(r => r.CompanyID === $('companyId').value);
    if (row) $('companyName').value = row.CompanyName;
    $('review-confirm').checked=false;
  });
  $('siteId').addEventListener('change', () => {
    const row = records.sites.find(r => r.SiteID === $('siteId').value);
    if (row) {
      for (const [field,key] of [['siteName','SiteName'],['address','Address'],['city','City'],['state','State'],['zip','Zip']]) $(field).value=row[key] || '';
      const company = records.companies.find(r => r.CompanyID === row.CompanyID);
      if (company) { $('companyId').value=company.CompanyID; $('companyName').value=company.CompanyName; }
      const leads = records.leads.filter(r => r.SiteID === row.SiteID);
      $('leadId').value = leads.length === 1 ? leads[0].LeadID : '';
    }
    $('review-confirm').checked=false;
  });
  $('read-form').addEventListener('click', async () => {
    if (busy) return;
    const file = $('customer-file').files[0];
    if (!file) return status('Choose a customer form first.',true);
    if (file.size > 2 * 1024 * 1024) return status('Each form must be 2 MB or smaller.',true);
    lock(true); filePayload=null; $('review-section').hidden=true;
    const generation = ++reading;
    try {
      status('Reading form and checking customer records…');
      await reload();
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary=''; for (let i=0;i<bytes.length;i+=8192) binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
      const payload={fileName:file.name,fileBase64:btoa(binary)};
      const preview=await NovaraApi.sendJson('/api/customer-forms/preview','POST',payload);
      if (generation !== reading) return;
      fieldNames.forEach(id => $(id).value='');
      Object.entries(preview.fields || {}).forEach(([id,value]) => {if (fieldNames.includes(id)) $(id).value=value;});
      $('source-text').textContent=preview.text || '(No extracted text)';
      $('notes').value=preview.text || '';
      $('review-confirm').checked=false;
      filePayload=payload; $('review-section').hidden=false;
      status(preview.warning + ' Review the address and contact details before saving.');
    } catch (err) {status(err.message,true);} finally {lock(false);}
  });
  $('reload-records').addEventListener('click', async () => {
    lock(true); try {await reload(); status('Records refreshed. Review your selections before saving.'); $('review-confirm').checked=false;}
    catch(err){status(err.message,true);} finally{lock(false);}
  });
  $('review-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !filePayload || !$('review-confirm').checked) return;
    const fields=Object.fromEntries(fieldNames.map(id => [id,$(id).value.trim()]));
    lock(true); status('Saving the customer, lead notes, and original form…');
    try {
      const result=await NovaraApi.sendJson('/api/customer-forms/import','POST',{...filePayload,fields});
      $('review-confirm').checked=false;
      status((result.alreadyImported ? 'This form is already attached; nothing was duplicated.' : 'Saved successfully.') + ' Site: '+result.siteId+' · Lead: '+result.leadId+'. To use this form for another site, select that site and review the notes again.');
      try {await reload();} catch(err){status('The import was saved, but the list could not refresh. Reload Records to see it.',true);}
    } catch(err){status(err.message,true);} finally{lock(false);}
  });
  lock(true);
  reload().then(() => status('Choose a form to begin.')).catch(err => status(err.message,true)).finally(() => lock(false));
})();
