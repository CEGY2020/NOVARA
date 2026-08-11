/* Shared US phone formatting: 1 (XXX) XXX-XXXX */
(function (global) {
  function digitsOnly(value) {
    return String(value == null ? "" : value).replace(/\D/g, "");
  }

  /**
   * Normalize common US phone inputs into "1 (XXX) XXX-XXXX".
   * Accepts 10-digit NANP numbers, 11-digit numbers starting with 1,
   * and partially typed values (progressive mask while typing).
   * Returns "" for empty input; leaves non-NANP digit strings as digits only.
   */
  function formatPhoneUS(value, options) {
    var opts = options || {};
    var completeOnly = Boolean(opts.completeOnly);
    var digits = digitsOnly(value);
    if (!digits) {
      return "";
    }

    // Drop a leading country-code 1 when more digits follow.
    if (digits.charAt(0) === "1") {
      digits = digits.slice(1);
    }

    // Cap at 10 NANP digits after the country code.
    if (digits.length > 10) {
      digits = digits.slice(0, 10);
    }

    if (completeOnly && digits.length !== 10) {
      return String(value == null ? "" : value).trim();
    }

    var area = digits.slice(0, 3);
    var prefix = digits.slice(3, 6);
    var line = digits.slice(6, 10);
    var out = "1";

    if (!area) {
      return out;
    }
    out += " (" + area;
    if (area.length < 3) {
      return out;
    }
    out += ")";
    if (!prefix) {
      return out;
    }
    out += " " + prefix;
    if (!line) {
      return out;
    }
    return out + "-" + line;
  }

  function bindPhoneInput(input) {
    if (!input || input.getAttribute("data-phone-bound") === "1") {
      return;
    }
    input.setAttribute("data-phone-bound", "1");

    input.addEventListener("input", function () {
      var formatted = formatPhoneUS(input.value);
      if (input.value !== formatted) {
        input.value = formatted;
      }
    });

    input.addEventListener("blur", function () {
      var formatted = formatPhoneUS(input.value);
      if (input.value !== formatted) {
        input.value = formatted;
      }
    });

    // Format any pre-filled value (e.g. browser autofill).
    if (input.value) {
      input.value = formatPhoneUS(input.value);
    }
  }

  global.NovaraPhone = {
    digitsOnly: digitsOnly,
    formatPhoneUS: formatPhoneUS,
    bindPhoneInput: bindPhoneInput,
  };
})(window);
