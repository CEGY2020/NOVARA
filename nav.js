/** Shared app chrome. */
(function () {
  var AEM_NAV_ITEMS = [
    { id: "dashboard", label: "Dashboard", href: "dashboard.html" },
    { id: "companies", label: "Companies", href: "companies.html" },
    { id: "sites", label: "Sites", href: "sites.html" },
    { id: "systems", label: "Systems", href: "systems.html" },
    { id: "owners", label: "Owners", href: "owners.html" },
    { id: "mgmt-companies", label: "Management Companies", href: "mgmt-companies.html" },
    { id: "master-data-import", label: "Master Data Upload", href: "master-data-import.html" },
    { id: "leads", label: "Leads", href: "leads.html" },
    { id: "pool-post-vss", label: "Pool Post-VSS", href: "pool-post-vss.html" },
    { id: "users", label: "Users", href: "users.html" },
    { id: "alarms", label: "Active Alarms", href: "active-alarms.html" },
    { id: "savings", label: "Energy Savings", href: "energy-savings.html" },
    { id: "bills", label: "Utility Data", href: "bills.html" },
    { id: "reports", label: "Reports", href: "reports.html" },
    { id: "settings", label: "Settings", href: "settings.html" }
  ];
  var OWNER_NAV_ITEMS=[{id:"owner-home",label:"Home",href:"owner-home.html"},{id:"sites",label:"My Sites",href:"sites.html"},{id:"owner-performance",label:"Performance",href:"owner-home.html#performance"},{id:"owner-savings",label:"Savings",href:"owner-home.html#savings"}];
  var MGMT_NAV_ITEMS=[{id:"mgmt-home",label:"Portfolio",href:"mgmt-home.html"},{id:"sites",label:"Managed Sites",href:"sites.html"},{id:"systems",label:"Systems",href:"systems.html"},{id:"alarms",label:"Alarms",href:"active-alarms.html"},{id:"savings",label:"Savings",href:"energy-savings.html"},{id:"mgmt-team",label:"Team",href:"mgmt-home.html#team"}];
  var CONTRACTOR_NAV_ITEMS=[{id:"contractor-home",label:"Home",href:"contractor-home.html"},{id:"contractor-sites",label:"Assigned Sites",href:"contractor-home.html#sites"},{id:"contractor-agreements",label:"Agreements",href:"contractor-home.html#agreements"}];
  var SALES_NAV_ITEMS=[{id:"sales-home",label:"Home",href:"sales-home.html"},{id:"sales-leads",label:"Leads",href:"leads.html"},{id:"pool-post-vss",label:"Pool Post-VSS",href:"pool-post-vss.html"},{id:"sales-pipeline",label:"Pipeline",href:"leads.html#pipeline"}];
  var ROLE_NAV={aem:AEM_NAV_ITEMS,owner:OWNER_NAV_ITEMS,mgmt:MGMT_NAV_ITEMS,contractor:CONTRACTOR_NAV_ITEMS,sales:SALES_NAV_ITEMS};
  var ROLE_TITLES={aem:"Administrator",owner:"Owner",mgmt:"Management Company",contractor:"Contractor",sales:"Sales"};
  var currentPage=document.body.getAttribute("data-page")||"";
  function readStoredUser(){if(window.NovaraAuth&&NovaraAuth.getCurrentUser)return NovaraAuth.getCurrentUser();try{var raw=sessionStorage.getItem("novaraUser")||localStorage.getItem("novaraUser");return raw?JSON.parse(raw):null}catch(e){return null}}
  function readStoredRole(){var user=readStoredUser();if(user&&user.role)return user.role;if(window.NovaraRole&&NovaraRole.getSelectedRole)return NovaraRole.getSelectedRole();try{return sessionStorage.getItem("novaraRole")}catch(e){return null}}
  var currentUser=readStoredUser(),role=readStoredRole()||document.body.getAttribute("data-role")||"aem";if(window.NovaraRole&&NovaraRole.normalizeRole)role=NovaraRole.normalizeRole(role)||role;if(ROLE_NAV[role]==null)role="aem";if(window.NovaraRole&&NovaraRole.setSelectedRole)NovaraRole.setSelectedRole(role);var NAV_ITEMS=(ROLE_NAV[role]||AEM_NAV_ITEMS).slice();var isLoggedInAem=currentUser&&String(currentUser.role||"").toLowerCase()==="aem";if(!isLoggedInAem)NAV_ITEMS=NAV_ITEMS.filter(function(item){return item.id!=="users"});
  function currentHash(){return String(window.location.hash||"").replace(/^#/,"").toLowerCase()}function pageFileName(){return window.location.pathname.split("/").pop()||""}
  function isItemActive(item){if(role==="sales"&&currentPage==="leads"){var onPipeline=currentHash()==="pipeline";if(item.id==="sales-pipeline")return onPipeline;if(item.id==="sales-leads")return !onPipeline;return false}if(role==="mgmt"&&currentPage==="mgmt-home"){var hash=currentHash();if(item.id==="mgmt-team")return hash==="team";if(item.id==="mgmt-home")return hash!=="team"}if(item.id===currentPage)return true;if(!item.href||item.href.indexOf("#")===-1)return false;var parts=item.href.split("#"),path=parts[0],hash2=(parts[1]||"").toLowerCase();if(path&&pageFileName()!==path)return false;return currentHash()===hash2}
  var APPLICATIONS = ["RHW", "DHW", "HVAC", "Pool"];
  var requestedApplication = new URLSearchParams(window.location.search).get("application");
  var application = APPLICATIONS.indexOf(requestedApplication) >= 0 ? requestedApplication : "";
  function escapeText(value) { return String(value || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function appHref(href, app) { var parts=href.split("#"); return parts[0]+(parts[0].indexOf("?")>=0?"&":"?")+"application="+encodeURIComponent(app)+(parts[1]?"#"+parts[1]:""); }
  function matchesApplication(record) {
    if (!application) return true;
    var type=String(record.systemType || record.SystemType || "").toUpperCase();
    if (application === "RHW") return /RHW|RESTAURANT/.test(type);
    if (application === "DHW") return /DHW|DOMESTIC/.test(type);
    return type.indexOf(application.toUpperCase()) >= 0;
  }
  function portfolioItems(app) {
    var items=[{id:"portfolio",label:"Portfolio",href:"portfolio.html"}];
    if(app==="RHW")items.push({id:"restaurant",label:"Restaurant Workspace",href:"restaurant-workspace.html"},{id:"rhw-portal",label:"AS Plumbing RHW",href:"as-plumbing-rhw.html"},{id:"rhw-portal",label:"Chipotle RHW",href:"chipotle-rhw.html"});
    [["sites","Sites","sites.html"],["systems","Systems","systems.html"],["owners","Owners","owners.html"],["mgmt-companies","Management Companies","mgmt-companies.html"],["companies","Contacts","contacts.html"],["systems","Equipment / Assets","equipment.html"],["alarms","Alerts","active-alarms.html"]].forEach(function(entry){
      if (NAV_ITEMS.some(function(item){return item.id===entry[0]})) items.push({id:entry[0],label:entry[1],href:entry[2]});
    });
    if(role==="aem") items.splice(items.length-2,0,{id:"providers",label:"Service Providers / Contractors",href:"service-providers.html"});
    return items.map(function(item){return {id:item.id,label:item.label,href:appHref(item.href,app)}});
  }
  var MENU_DEFINITIONS = {
    "Customers":"Find and manage companies, sites, and customer contacts.",
    "Leads":"Track outreach, surveys, agreements, purchases, and deployment progress.",
    "User Guide":"Instructions for using the platform and its features.",
    "Portfolio":"Overview and shortcuts.",
    "AS Plumbing RHW":"Contractor forms for service, commissioning and job costs.",
    "Chipotle RHW":"Restaurant and facilities forms, reports and upgrade planning.",
    "Restaurant Workspace":"Restaurant setup, equipment, alarm routing, job costs and reports.",
    "Sites":"Properties and locations.",
    "Systems":"Connected heating and cooling systems.",
    "Owners":"Property owners and contacts.",
    "Management Companies":"Property managers and contacts.",
    "Contacts":"Names, emails, and phone numbers.",
    "Service Providers / Contractors":"Installation and service partners.",
    "Equipment / Assets":"Equipment totals by site and system.",
    "Alerts":"Warnings and system faults.",
    "Dashboard":"Portfolio operating overview.",
    "Home":"Your account overview.",
    "Performance":"System operating performance.",
    "Savings":"Energy savings overview.",
    "Energy Savings":"Energy savings overview.",
    "Master Data Upload":"Import customer forms and records.",
    "Pool Post-VSS":"Pool survey review and next steps.",
    "Users":"Manage platform user accounts.",
    "Utility Data":"Energy usage and utility bills.",
    "Reports":"View portfolio reports.",
    "Settings":"Account and platform preferences.",
    "Pipeline":"Lead stages and sales progress.",
    "Team":"Management team information.",
    "Agreements":"Service and installation agreements."
  };
  function dropdownLink(item) {
    return '<a href="'+escapeText(item.href)+'"><strong>'+escapeText(item.label)+'</strong><span class="menu-definition">'+escapeText(MENU_DEFINITIONS[item.label] || "Open "+item.label.toLowerCase()+".")+'</span></a>';
  }
  function definitionMenu(label, href, active) {
    return '<details class="application-menu definition-menu"'+(active?' data-active="true"':'')+'><summary>'+label+'</summary><div class="navigation-dropdown">'+dropdownLink({label:label,href:href})+'</div></details>';
  }

  function customerRows(rows, app) {
    var field={RHW:"ProgramRestaurant",DHW:"ProgramDHW",HVAC:"ProgramHVAC",Pool:"ProgramPool"}[app];
    return rows.filter(function(row){
      var relationship=String(row.RelationshipType||"").toLowerCase();
      var status=String(row.CustomerStatus||row.Status||row.status||"").toLowerCase();
      return String(row[field]||"").toUpperCase()==="YES" &&
        !/contractor|service provider|prospect|lead/.test(relationship) &&
        !/^(inactive|archived|former|closed)$/.test(status);
    }).sort(function(a,b){return String(a.CompanyName||"").localeCompare(String(b.CompanyName||""));});
  }
  function setupCustomerMenus(root) {
    var request;
    function records(){
      if(!request) request=new Promise(function(resolve,reject){
        function read(){
          if(!window.NovaraAuth || !NovaraAuth.getToken()){reject(new Error("Sign in to view customers."));return;}
          if(!window.NovaraApi){reject(new Error("Customer directory unavailable."));return;}
          // Master directory is shared: only directory roles use it here.
          if(role==="aem"||role==="sales") NovaraApi.getMasterCompanies().then(function(data){resolve(data.companies||[]);},reject);
          else NovaraApi.getSites().then(function(data){
            var byId={};
            (data.sites||[]).forEach(function(site){
              var id=site.ownerId||site.companyId||site.CompanyID;
              if(!id)return;
              var row=byId[id]||(byId[id]={CompanyID:id,CompanyName:site.owner||site.companyName||site.CompanyName||id});
              var type=String(site.systemType||site.SystemType||"").toUpperCase();
              if(/RHW|RESTAURANT/.test(type))row.ProgramRestaurant="YES";
              if(/DHW|DOMESTIC/.test(type))row.ProgramDHW="YES";
              if(/HVAC/.test(type))row.ProgramHVAC="YES";
              if(/POOL/.test(type))row.ProgramPool="YES";
            });resolve(Object.keys(byId).map(function(id){return byId[id];}));
          },reject);
        }
        if(window.NovaraApi)read();
        else {
          function script(src){return new Promise(function(resolve,reject){var s=document.createElement("script");s.src=src;s.onload=resolve;s.onerror=reject;document.head.appendChild(s);});}
          Promise.resolve().then(function(){if(!window.NovaraAuth)return script("auth.js");}).then(function(){if(window.NOVARA_API_BASE===undefined)return script("api-config.js");}).then(function(){if(!window.NovaraApi)return script("api-client.js");}).then(read,reject);
        }
      });
      return request;
    }
    root.querySelectorAll("[data-customer-app]").forEach(function(menu){
      var app=menu.getAttribute("data-customer-app"),panel=menu.querySelector(".navigation-dropdown");
      function list(){
        panel.innerHTML='<div class="customer-menu-heading"><strong>'+app+' customers</strong><span>Select a customer to open the submenu.</span></div><p class="customer-menu-message" role="status">Loading customers…</p>';
        records().then(function(rows){
          var customers=customerRows(rows,app);
          panel.innerHTML='<div class="customer-menu-heading"><strong>'+app+' customers</strong><span>Select a customer to open the submenu.</span></div>';
          if(!customers.length){var empty=document.createElement("p");empty.className="customer-menu-message";empty.textContent="No customers added for "+app+" yet.";panel.appendChild(empty);}
          customers.forEach(function(customer){
            var button=document.createElement("button");button.type="button";button.className="customer-menu-choice";
            var name=document.createElement("strong");name.textContent=customer.CompanyName||customer.CompanyID;button.appendChild(name);
            var hint=document.createElement("span");hint.className="menu-definition";hint.textContent="Open "+app+" submenu →";button.appendChild(hint);
            button.addEventListener("click",function(){submenu(customer);});panel.appendChild(button);
          });
          var add=document.createElement("a");add.href=appHref("companies.html?action=add-customer",app);add.className="customer-menu-add";add.textContent="+ Add customer";panel.appendChild(add);
        }).catch(function(error){
          panel.innerHTML='<div class="customer-menu-heading"><strong>'+app+' customers</strong></div>';
          var message=document.createElement("p");message.className="customer-menu-message";message.setAttribute("role","status");message.textContent=error.message||"Unable to load customers.";panel.appendChild(message);
          if(!window.NovaraAuth||!NovaraAuth.getToken()){var login=document.createElement("a");login.href="login.html";login.textContent="Log in";panel.appendChild(login);}
          else {var retry=document.createElement("button");retry.type="button";retry.className="customer-menu-choice";retry.textContent="Retry";retry.onclick=function(){request=null;list();};panel.appendChild(retry);}
        });
      }
      function submenu(customer){
        panel.innerHTML="";
        var heading=document.createElement("div");heading.className="customer-menu-heading";
        var back=document.createElement("button");back.type="button";back.className="customer-menu-back";back.textContent="← Customers";back.onclick=function(){list();};heading.appendChild(back);
        var name=document.createElement("strong");name.textContent=customer.CompanyName+" · "+app;heading.appendChild(name);panel.appendChild(heading);
        var detail=document.createElement("a");detail.href=appHref("companies.html?companyId="+encodeURIComponent(customer.CompanyID),app);detail.innerHTML="<strong>Customer details</strong><span class='menu-definition'>Company, linked sites and contacts.</span>";panel.appendChild(detail);
        panel.insertAdjacentHTML("beforeend",portfolioItems(app).map(dropdownLink).join(""));
        back.focus();
      }
      var loaded=false;menu.addEventListener("toggle",function(){if(menu.open&&!loaded){loaded=true;list();}});
    });
  }

  function renderSidebar(root) {
    document.body.classList.add("top-navigation-layout");
    root.className="app-navigation";
    root.setAttribute("aria-label","Platform navigation");
    var css=document.createElement("link");css.rel="stylesheet";css.href="navigation.css?v=20261004-customers";document.head.appendChild(css);
    if(currentPage!=="leads"&&currentPage!=="restaurant"&&currentPage!=="rhw-portal"){
      ["novara-ui-standard.css","submenu-lists.css?v=20261003"].forEach(function(href){if(href.indexOf("novara-ui")===0&&document.querySelector('link[href^="novara-ui-standard"]'))return;var style=document.createElement("link");style.rel="stylesheet";style.href=href;document.head.appendChild(style);});
      var listTools=document.createElement("script");listTools.src="submenu-lists.js?v=20261003";document.head.appendChild(listTools);
    }
    document.body.classList.add("platform-waves");
    var waveMap={RHW:"1",DHW:"2",HVAC:"4",Pool:"5"};
    var pageWaves={dashboard:"3",portfolio:"5",sites:"1",systems:"2",owners:"4","mgmt-companies":"5",companies:"1",contacts:"2",providers:"4",equipment:"3",alarms:"4",leads:"3","user-guide":"5",reports:"5",settings:"2"};
    document.body.setAttribute("data-wave",waveMap[application]||pageWaves[currentPage]||"3");
    var waveStyle=document.createElement("link");waveStyle.rel="stylesheet";waveStyle.href="platform-waves.css?v=20261003";document.head.appendChild(waveStyle);
    var menus=APPLICATIONS.map(function(app){
      return '<details class="application-menu" data-customer-app="'+app+'"'+(application===app?' data-active="true"':'')+'><summary>'+(app==="Pool"?"Pools":app)+'</summary><div class="navigation-dropdown"><p class="customer-menu-message">Loading customers…</p></div></details>';
    }).join("");
    var customers=NAV_ITEMS.some(function(item){return item.id==="companies"});
    var leads=NAV_ITEMS.some(function(item){return item.id==="leads"||item.id==="sales-leads"});
    var utilityItems=NAV_ITEMS.filter(function(item){return ["sites","systems","owners","mgmt-companies","companies","leads","sales-leads","alarms"].indexOf(item.id)<0});
    root.innerHTML='<a class="platform-brand" href="'+(window.NovaraRole?NovaraRole.getHomeForRole(role):"dashboard.html")+'" aria-label="Optima ProLink home"><img src="images/optima-prolink-logo-clean.svg" alt="Optima ProLink"></a><nav aria-label="Main menu">'+menus+(customers?definitionMenu("Customers","companies.html",currentPage==="companies"||currentPage==="contacts"):'')+(leads?definitionMenu("Leads","leads.html",currentPage==="leads"):'')+definitionMenu("User Guide","user-guide.html",currentPage==="user-guide")+'</nav>'+(utilityItems.length?'<details class="application-menu account-menu"><summary aria-label="User account"><svg class="account-bust" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7" r="4"></circle><path d="M3 22v-3a9 9 0 0 1 18 0v3z"></path></svg></summary><div class="navigation-dropdown">'+utilityItems.map(dropdownLink).join("")+'</div></details>':'');
    setupCustomerMenus(root);
    var account=root.querySelector(".account-menu");
    if(account){
      var name=(currentUser&&(currentUser.fullName||currentUser.email))||"Not signed in";
      account.querySelector("summary").setAttribute("aria-label","User account: "+name);
      account.querySelector("summary").setAttribute("title",name);
      var identity=document.createElement("div");identity.className="account-identity";
      var nameEl=document.createElement("strong");nameEl.textContent=name;identity.appendChild(nameEl);
      if(currentUser&&currentUser.email&&currentUser.email!==name){var email=document.createElement("span");email.textContent=currentUser.email;identity.appendChild(email);}
      var roleEl=document.createElement("span");roleEl.textContent=currentUser?(ROLE_TITLES[role]||role):"Sign in to view your account";identity.appendChild(roleEl);
      account.querySelector(".navigation-dropdown").prepend(identity);
    }
    var badge=document.createElement("a");badge.id="user-alarm-status";badge.href="active-alarms.html";badge.className="user-alarm-status alarm-unknown";badge.textContent="Checking alarms…";badge.setAttribute("aria-live","polite");root.insertBefore(badge,root.querySelector(".account-menu"));
    var alarmScript=document.createElement("script");alarmScript.src="alarm-status.js?v=20261003";document.head.appendChild(alarmScript);
    // Mouse hover opens dropdowns; touch and keyboard keep native details controls.
    root.querySelectorAll(".application-menu").forEach(function(menu){
      var closeTimer;
      menu.addEventListener("mouseenter",function(){
        if(!window.matchMedia("(hover: hover) and (pointer: fine)").matches)return;
        window.clearTimeout(closeTimer);
        root.querySelectorAll("details").forEach(function(other){if(other!==menu)other.open=false;});
        menu.open=true;
      });
      menu.addEventListener("mouseleave",function(){
        if(!window.matchMedia("(hover: hover) and (pointer: fine)").matches)return;
        closeTimer=window.setTimeout(function(){
          if(!menu.contains(document.activeElement))menu.open=false;
        },160);
      });
      menu.addEventListener("focusout",function(){
        window.clearTimeout(closeTimer);
        closeTimer=window.setTimeout(function(){
          if(!menu.contains(document.activeElement)&&!menu.matches(":hover"))menu.open=false;
        },160);
      });
    });
    root.addEventListener("toggle",function(event){if(!event.target.open)return;root.querySelectorAll("details").forEach(function(menu){if(menu!==event.target)menu.open=false});},true);
    document.addEventListener("click",function(event){if(!root.contains(event.target))root.querySelectorAll("details").forEach(function(menu){menu.open=false});});
    root.addEventListener("keydown",function(event){if(event.key==="Escape")root.querySelectorAll("details").forEach(function(menu){if(menu.open){menu.open=false;menu.querySelector("summary").focus()}});});
    if(application && currentPage!=="portfolio"){
      var context=document.createElement("div");context.className="application-context";
      context.innerHTML='<strong>'+application+'</strong> <span>'+(["sites","systems","companies"].indexOf(currentPage)>=0?'Application view':'Shared portfolio records')+'</span> <a href="'+escapeText(window.location.pathname.split("/").pop())+'">View all applications</a>';
      var main=document.querySelector("main");if(main)main.insertBefore(context,main.firstChild);
    }
  }
  function renderUserProfile(root){var title=ROLE_TITLES[role]||"Administrator",displayName=(currentUser&&currentUser.fullName)||(currentUser&&currentUser.email)||"NOVARA User",companyLabel=currentUser&&currentUser.company?" · "+currentUser.company:"",initials="?";if(window.NovaraAuth&&NovaraAuth.initialsFor)initials=NovaraAuth.initialsFor(currentUser||{fullName:displayName});else initials=String(displayName).split(/\s+/).filter(Boolean).slice(0,2).map(function(part){return part.charAt(0).toUpperCase()}).join("")||"?";root.className="user-profile";root.innerHTML='<div class="user-avatar">'+initials+'</div><div><strong>'+displayName+'</strong><span>'+title+companyLabel+'</span></div><a href="index.html" class="logout-btn" id="novara-logout-btn">Logout</a>';var logoutBtn=root.querySelector("#novara-logout-btn");if(logoutBtn)logoutBtn.addEventListener("click",function(event){event.preventDefault();if(window.NovaraAuth&&NovaraAuth.logout){NovaraAuth.logout("index.html");return}try{sessionStorage.removeItem("novaraUser");sessionStorage.removeItem("novaraToken");sessionStorage.removeItem("novaraTokenExpires");sessionStorage.removeItem("novaraRole");localStorage.removeItem("novaraUser");localStorage.removeItem("novaraToken");localStorage.removeItem("novaraTokenExpires")}catch(e){}window.location.href="index.html"})}
  function refreshActive(){var root=document.getElementById("sidebar-root");if(!root)return;root.querySelectorAll("a").forEach(function(link){if(link.getAttribute("href")===(pageFileName()+window.location.search))link.setAttribute("aria-current","page");else link.removeAttribute("aria-current");});}
  var sidebarRoot=document.getElementById("sidebar-root"),profileRoot=document.getElementById("user-profile-root");if(sidebarRoot)renderSidebar(sidebarRoot);if(profileRoot)renderUserProfile(profileRoot);window.addEventListener("hashchange",refreshActive);window.NovaraNav={refreshActive:refreshActive,role:role,items:NAV_ITEMS,application:application,matchesApplication:matchesApplication,portfolioItems:portfolioItems};
})();