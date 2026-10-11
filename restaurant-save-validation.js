(function(){
'use strict';

const REQUIRED_RECORDS=[
  {section:'equipment',repeat:'heaters',label:'installed heater record'},
  {section:'alert',repeat:'recipients',label:'alarm recipient'},
  {section:'utility',repeat:'meters',label:'gas meter record'}
];

function addStyles(){
  if(document.getElementById('restaurant-save-validation-styles'))return;
  const style=document.createElement('style');
  style.id='restaurant-save-validation-styles';
  style.textContent=`
    body[data-page="restaurant"] .field.missing-required :is(input,select,textarea){
      border:2px solid #c62828!important;
      background:#fff4f4!important;
    }
    body[data-page="restaurant"] .missing-required-note{
      color:#c62828!important;
      font:700 10pt Arial,sans-serif!important;
      margin-top:2px!important;
    }
  `;
  document.head.appendChild(style);
}

function clearMissing(){
  document.querySelectorAll('.field.missing-required').forEach(field=>field.classList.remove('missing-required'));
  document.querySelectorAll('.missing-required-note').forEach(note=>note.remove());
}

function isFilled(input){
  if(!input)return false;
  if(input.type==='checkbox'||input.type==='radio')return input.checked;
  return String(input.value||'').trim()!=='';
}

function missingFields(){
  const missing=[];
  document.querySelectorAll('[aria-required="true"]').forEach(input=>{
    if(isFilled(input))return;
    const field=input.closest('.field');
    if(field){
      field.classList.add('missing-required');
      if(!field.querySelector('.missing-required-note')){
        const note=document.createElement('span');
        note.className='missing-required-note';
        note.textContent='Required';
        field.appendChild(note);
      }
    }
    missing.push(input.dataset.label||'required field');
  });
  return missing;
}

function missingRecords(){
  const missing=[];
  REQUIRED_RECORDS.forEach(item=>{
    const section=document.getElementById('section-'+item.section);
    if(!section||!section.querySelector('[data-repeat="'+item.repeat+'"]'))missing.push(item.label);
  });
  return missing;
}

function validateAfterSave(){
  clearMissing();
  const fields=missingFields();
  const records=missingRecords();
  const total=fields.length+records.length;
  const status=document.getElementById('save-status');
  if(!status)return;
  if(total){
    status.textContent='Saved — '+total+' required item'+(total===1?'':'s')+' still missing.';
    status.classList.add('error');
  }else{
    status.textContent='Saved — all required setup items are complete.';
    status.classList.remove('error');
  }
}

function start(){
  addStyles();
  const button=document.getElementById('save-draft');
  if(!button)return;
  button.addEventListener('click',()=>setTimeout(validateAfterSave,75));
  document.addEventListener('input',event=>{
    const field=event.target&&event.target.closest&&event.target.closest('.field.missing-required');
    if(field&&isFilled(event.target)){
      field.classList.remove('missing-required');
      const note=field.querySelector('.missing-required-note');
      if(note)note.remove();
    }
  },true);
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);
else start();
})();
