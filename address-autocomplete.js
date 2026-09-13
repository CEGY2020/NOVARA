(function (global) {
  "use strict";

  var key = String(global.NOVARA_GOOGLE_MAPS_API_KEY || "").trim();
  var targets = [
    { address: "lead-new-site-address", city: "lead-new-site-city", state: "lead-new-site-state", zip: "lead-new-site-zip" },
    { address: "field-address", city: "field-city", state: "field-state", zip: "field-zip" }
  ];

  function statusFor(input, message, isError) {
    if (!input || !input.parentNode) return;
    var id = input.id + "-google-status";
    var status = document.getElementById(id);
    if (!status) {
      status = document.createElement("small");
      status.id = id;
      status.style.display = "block";
      status.style.marginTop = "4px";
      status.style.fontSize = "12px";
      input.parentNode.appendChild(status);
    }
    status.textContent = message || "";
    status.style.color = isError ? "#a12622" : "#555";
  }

  function prepareOriginalInputs() {
    targets.forEach(function (cfg) {
      var input = document.getElementById(cfg.address);
      if (!input) return;
      input.setAttribute("autocomplete", "off");
      input.setAttribute("autocorrect", "off");
      input.setAttribute("spellcheck", "false");
      input.setAttribute("data-lpignore", "true");
      input.setAttribute("data-1p-ignore", "true");
      statusFor(input, "Loading Google address lookup…", false);
    });
  }

  function showGlobalError(message) {
    targets.forEach(function (cfg) {
      var input = document.getElementById(cfg.address);
      if (input) statusFor(input, message, true);
    });
  }

  global.gm_authFailure = function () {
    showGlobalError("Google address lookup could not authenticate. Check the Google API key restrictions and enabled APIs.");
    global.NovaraAddressAutocomplete = { configured: false, error: "Google Maps authentication failed" };
  };

  function loadMaps() {
    if (global.google && global.google.maps) return Promise.resolve();
    if (!key) return Promise.reject(new Error("Google Maps API key is not configured."));
    if (global.__novaraMapsPromise) return global.__novaraMapsPromise;

    global.__novaraMapsPromise = new Promise(function (resolve, reject) {
      var callbackName = "__novaraGoogleMapsReady";
      var timeout = setTimeout(function () {
        reject(new Error("Google Maps JavaScript API did not finish loading. Check the API key restrictions and billing."));
      }, 15000);

      global[callbackName] = function () {
        clearTimeout(timeout);
        try { delete global[callbackName]; } catch (_) { global[callbackName] = undefined; }
        if (global.google && global.google.maps) resolve();
        else reject(new Error("Google Maps JavaScript API loaded but did not initialize."));
      };

      var script = document.createElement("script");
      script.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(key) + "&loading=async&libraries=places&v=weekly&callback=" + callbackName;
      script.async = true;
      script.defer = true;
      script.onerror = function () {
        clearTimeout(timeout);
        reject(new Error("Google Maps JavaScript API could not load."));
      };
      document.head.appendChild(script);
    });

    return global.__novaraMapsPromise;
  }

  function setValue(id, value) {
    var node = document.getElementById(id);
    if (!node) return;
    node.value = value || "";
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function parseAddress(components) {
    var out = { address: "", city: "", state: "", zip: "" };
    var streetNumber = "", route = "", zipBase = "", zipSuffix = "";
    (components || []).forEach(function (component) {
      var types = component.types || [];
      if (types.indexOf("street_number") !== -1) streetNumber = component.longText || "";
      if (types.indexOf("route") !== -1) route = component.shortText || component.longText || "";
      if (types.indexOf("locality") !== -1) out.city = component.longText || "";
      if (!out.city && types.indexOf("postal_town") !== -1) out.city = component.longText || "";
      if (!out.city && types.indexOf("sublocality_level_1") !== -1) out.city = component.longText || "";
      if (types.indexOf("administrative_area_level_1") !== -1) out.state = component.shortText || component.longText || "";
      if (types.indexOf("postal_code") !== -1) zipBase = component.longText || "";
      if (types.indexOf("postal_code_suffix") !== -1) zipSuffix = component.longText || "";
    });
    out.address = [streetNumber, route].filter(Boolean).join(" ").trim();
    out.zip = zipBase + (zipSuffix ? "-" + zipSuffix : "");
    return out;
  }

  async function setupTarget(cfg, PlaceAutocompleteElement) {
    var original = document.getElementById(cfg.address);
    if (!original || original.dataset.novaraAutocompleteReady === "1") return;

    var widget = new PlaceAutocompleteElement();
    widget.includedRegionCodes = ["us"];
    widget.placeholder = "Start typing an address…";
    widget.value = original.value || "";
    widget.style.display = "block";
    widget.style.width = "100%";
    widget.style.boxSizing = "border-box";
    widget.style.minHeight = "42px";
    widget.dataset.novaraFor = cfg.address;

    original.parentNode.insertBefore(widget, original);
    original.style.display = "none";
    original.dataset.novaraAutocompleteReady = "1";
    statusFor(original, "Google address lookup ready", false);

    widget.addEventListener("gmp-select", async function (event) {
      try {
        var prediction = event.placePrediction;
        if (!prediction) return;
        var place = prediction.toPlace();
        await place.fetchFields({ fields: ["addressComponents", "formattedAddress"] });
        var parsed = parseAddress(place.addressComponents);
        if (!parsed.address && place.formattedAddress) parsed.address = place.formattedAddress.split(",")[0].trim();
        setValue(cfg.address, parsed.address);
        setValue(cfg.city, parsed.city);
        setValue(cfg.state, parsed.state);
        setValue(cfg.zip, parsed.zip);
        widget.value = parsed.address || place.formattedAddress || widget.value;
        statusFor(original, "Address selected from Google", false);
      } catch (err) {
        console.error("NOVARA address lookup failed", err);
        statusFor(original, "Google found the address, but NOVARA could not load its details.", true);
      }
    });

    widget.addEventListener("gmp-error", function (event) {
      console.error("NOVARA address lookup error", event);
      statusFor(original, "Google address lookup returned an error.", true);
    });

    var container = original.closest(".modal-backdrop, .inline-create-panel");
    if (container && typeof MutationObserver !== "undefined") {
      new MutationObserver(function () {
        if (!container.hidden) {
          setTimeout(function () { widget.value = original.value || ""; }, 0);
        }
      }).observe(container, { attributes: true, attributeFilter: ["hidden"] });
    }
  }

  function init() {
    prepareOriginalInputs();
    if (!key) {
      showGlobalError("Google address lookup is not configured yet.");
      global.NovaraAddressAutocomplete = { configured: false };
      return;
    }

    loadMaps()
      .then(function () {
        if (!global.google || !global.google.maps) {
          throw new Error("Google Maps JavaScript API did not initialize.");
        }
        if (typeof global.google.maps.importLibrary === "function") {
          return global.google.maps.importLibrary("places");
        }
        if (global.google.maps.places) return global.google.maps.places;
        throw new Error("Google Places library did not initialize.");
      })
      .then(function (places) {
        var PlaceAutocompleteElement = places.PlaceAutocompleteElement || (global.google.maps.places && global.google.maps.places.PlaceAutocompleteElement);
        if (!PlaceAutocompleteElement) throw new Error("PlaceAutocompleteElement is unavailable. Enable Places API (New) for this Google Cloud project.");
        return Promise.all(targets.map(function (cfg) { return setupTarget(cfg, PlaceAutocompleteElement); }));
      })
      .then(function () { global.NovaraAddressAutocomplete = { configured: true }; })
      .catch(function (err) {
        console.error("NOVARA address autocomplete was not initialized", err);
        showGlobalError(err && err.message ? err.message : "Google address lookup could not start.");
        global.NovaraAddressAutocomplete = { configured: false, error: err && err.message ? err.message : "Unknown error" };
      });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(window);
