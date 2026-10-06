(function(){
var chipotle=document.body.dataset.organization==="chipotle"||new URLSearchParams(location.search).get("portal")==="chipotle";
try{var user=window.NovaraAuth&&window.NovaraAuth.getCurrentUser?window.NovaraAuth.getCurrentUser():null;chipotle=chipotle||!!(user&&String(user.Company||user.company||"").toLowerCase()==="chipotle");}catch(e){}
if(!chipotle)return;
document.body.classList.add("chipotle-workspace");
var heading=document.querySelector(".topbar>div");
if(heading){var brand=document.createElement("div");brand.className="chipotle-brand";var logo=document.createElement("img");logo.src="images/chipotle-medallion.svg";logo.alt="Chipotle Mexican Grill";logo.width=48;logo.height=48;heading.parentNode.insertBefore(brand,heading);brand.appendChild(logo);brand.appendChild(heading);}

var topbar=document.querySelector(".topbar");
if(topbar&&document.body.dataset.page==="restaurant"){
  var home=document.createElement("a");
  home.className="chipotle-home-button";
  home.href="chipotle-rhw.html?application=RHW";
  home.textContent="← Home";
  home.setAttribute("aria-label","Return to Chipotle RHW home");
  home.style.cssText="display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:8px 14px;background:#fff;color:#000;border:1px solid #ccc;border-radius:6px;font-size:14px;font-weight:600;text-decoration:none;white-space:nowrap;box-sizing:border-box;";
  topbar.insertBefore(home,topbar.firstChild);
}
})();