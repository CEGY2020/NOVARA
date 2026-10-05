(function(){
var chipotle=document.body.dataset.organization==="chipotle"||new URLSearchParams(location.search).get("portal")==="chipotle";
try{var user=window.NovaraAuth&&window.NovaraAuth.getUser?window.NovaraAuth.getUser():null;chipotle=chipotle||!!(user&&String(user.Company||user.company||"").toLowerCase()==="chipotle");}catch(e){}
if(!chipotle)return;
document.body.classList.add("chipotle-workspace");
var heading=document.querySelector(".topbar>div");
if(heading){var brand=document.createElement("div");brand.className="chipotle-brand";var logo=document.createElement("img");logo.src="images/chipotle-medallion.svg";logo.alt="Chipotle Mexican Grill";logo.width=48;logo.height=48;heading.parentNode.insertBefore(brand,heading);brand.appendChild(logo);brand.appendChild(heading);}
})();