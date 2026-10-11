(function(){
var chipotle=document.body.dataset.organization==="chipotle"||new URLSearchParams(location.search).get("portal")==="chipotle";
try{var user=window.NovaraAuth&&window.NovaraAuth.getCurrentUser?window.NovaraAuth.getCurrentUser():null;chipotle=chipotle||!!(user&&String(user.Company||user.company||"").toLowerCase()==="chipotle");}catch(e){}
if(!chipotle)return;
document.body.classList.add("chipotle-workspace");
var heading=document.querySelector(".topbar>div");
if(heading){var brand=document.createElement("div");brand.className="aem-brand";var logo=document.createElement("img");logo.src="logo.png";logo.alt="AEM";heading.parentNode.insertBefore(brand,heading);brand.appendChild(logo);brand.appendChild(heading);}

function setupRhwChrome(){
  var profile=document.getElementById("user-profile-root");
  if(!profile||document.body.dataset.page!=="restaurant")return;
  var currentUser=null;
  try{currentUser=window.NovaraAuth&&NovaraAuth.getCurrentUser?NovaraAuth.getCurrentUser():null;}catch(e){}
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