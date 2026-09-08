(function(){
  var form=document.getElementById('eval-form'),status=document.getElementById('status');
  if(!form)return;
  var program=document.body.getAttribute('data-program')||'';
  var q=new URLSearchParams(location.search),leadId=q.get('leadId')||'';
  var lead=document.getElementById('leadId'); if(lead)lead.value=leadId;
  var summaryLink=document.getElementById('summary-link');
  if(summaryLink){summaryLink.href='summary-report.html?leadId='+encodeURIComponent(leadId)+'&program='+encodeURIComponent(program);if(!leadId){summaryLink.setAttribute('aria-disabled','true');summaryLink.style.pointerEvents='none';summaryLink.style.opacity='.55'}}
  var fields=[].slice.call(form.querySelectorAll('input,select,textarea')).filter(function(x){return x.id&&x.id!=='leadId'});
  function setStatus(msg,bad){status.textContent=msg||'';status.style.color=bad?'#9b1c1c':''}
  function collect(){var d={};fields.forEach(function(x){d[x.id]=x.value});return d}
  function fill(d){d=d||{};fields.forEach(function(x){if(d[x.id]!=null)x.value=d[x.id]})}
  function load(){if(!leadId){setStatus('Open this evaluation from an Opportunity so it can be linked to a Lead ID.',true);return Promise.resolve()}setStatus('Loading saved evaluation…');return NovaraApi.getSiteEvaluation(leadId,program).then(function(r){if(r&&r.evaluation&&r.evaluation.Fields)fill(r.evaluation.Fields);setStatus(r&&r.evaluation?'Saved evaluation loaded from AWS.':'No saved evaluation yet. Ready to begin.')}).catch(function(e){setStatus(e.message,true)})}
  form.addEventListener('submit',function(e){e.preventDefault();if(!leadId){setStatus('Lead ID is required. Return to Opportunities and open the evaluation from there.',true);return}var btn=form.querySelector('button[type="submit"]');if(btn)btn.disabled=true;setStatus('Saving evaluation to AWS…');NovaraApi.saveSiteEvaluation({LeadID:leadId,Program:program,Fields:collect()}).then(function(){setStatus(program+' site evaluation saved to AWS. You can now open the Summary Report; the evaluation data will carry forward automatically.')}).catch(function(err){setStatus(err.message,true)}).finally(function(){if(btn)btn.disabled=false})});
  load();
})();