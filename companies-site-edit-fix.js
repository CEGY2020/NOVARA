(function(){
  "use strict";

  function enhanceSiteRows(){
    var body=document.getElementById("detail-sites-body");
    if(!body)return;
    var rows=body.querySelectorAll("tr");
    rows.forEach(function(row){
      var existing=row.querySelector(".edit-site");
      var firstCell=row.querySelector("td");
      if(!existing||!firstCell||firstCell.querySelector(".edit-site-inline"))return;
      var btn=document.createElement("button");
      btn.type="button";
      btn.className="secondary-btn small-edit edit-site-inline";
      btn.textContent="Edit Site";
      btn.style.marginLeft="10px";
      btn.addEventListener("click",function(event){
        event.preventDefault();
        existing.click();
      });
      firstCell.appendChild(btn);
    });
  }

  var body=document.getElementById("detail-sites-body");
  if(body){
    enhanceSiteRows();
    new MutationObserver(enhanceSiteRows).observe(body,{childList:true,subtree:true});
  }
})();
