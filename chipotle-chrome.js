(function(){
var chipotle=document.body.dataset.organization==="chipotle"||new URLSearchParams(location.search).get("portal")==="chipotle";
try{var user=window.NovaraAuth&&window.NovaraAuth.getCurrentUser?window.NovaraAuth.getCurrentUser():null;chipotle=chipotle||!!(user&&String(user.Company||user.company||"").toLowerCase()==="chipotle");}catch(e){}

function addAemRhwPortal(){
  var root=document.getElementById("sidebar-root");
  if(!root)return;
  root.querySelectorAll(".navigation-dropdown").forEach(function(panel){
    var heading=Array.prototype.find.call(panel.querySelectorAll(".customer-menu-heading strong"),function(el){return String(el.textContent||"").trim().toLowerCase()==="rhw review portals";});
    if(!heading||panel.querySelector('[data-aem-rhw-portal="true"]'))return;
    var link=document.createElement("a");
    link.href="restaurant-workspace.html?application=RHW&portal=aem";
    link.setAttribute("data-aem-rhw-portal","true");
    var title=document.createElement("strong");
    title.textContent="AEM RHW";
    var description=document.createElement("span");
    description.className="menu-definition";
    description.textContent="AEM forms, reports and upgrade planning.";
    link.appendChild(title);
    link.appendChild(description);
    panel.appendChild(link);
  });
}

function watchForRhwPortals(){
  addAemRhwPortal();
  var root=document.getElementById("sidebar-root");
  if(!root||!window.MutationObserver)return;
  var observer=new MutationObserver(function(){addAemRhwPortal();});
  observer.observe(root,{childList:true,subtree:true});
}

if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",watchForRhwPortals);
else watchForRhwPortals();

if(!chipotle)return;
document.body.classList.add("chipotle-workspace");
var heading=document.querySelector(".topbar>div");
if(heading){var brand=document.createElement("div");brand.className="aem-brand";var logo=document.createElement("img");logo.src="logo.png";logo.alt="AEM";heading.parentNode.insertBefore(brand,heading);brand.appendChild(logo);brand.appendChild(heading);}

function setupRhwChrome(){
  var profile=document.getElementById("user-profile-root");
  if(!profile||document.body.dataset.page!=="restaurant")return;
  var currentUser=null;
  try{currentUser=window.NovaraAuth&&NovaraAuth.getCurrentUser?window.NovaraAuth.getCurrentUser():null;}catch(e){}
  var displayName=currentUser&&(currentUser.fullName||currentUser.email)?(currentUser.fullName||currentUser.email):"User";
  var name=profile.querySelector("strong");
  if(name)name.textContent=displayName;
  var detail=profile.querySelector("span");
  if(detail)detail.remove();
  var logout=profile.querySelector(".logout-btn");
  if(!logout)return;
  if(!profile.querySelector(".chipotle-home-button")){
    var home=document.createElement("a");
    home.className="chipotle-home-button";
    home.href="chipotle-rhw.html?application=RHW";
    home.textContent="Home";
    home.setAttribute("aria-label","Return to RHW home");
    profile.insertBefore(home,logout);
  }
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",setupRhwChrome);
else setupRhwChrome();
})();