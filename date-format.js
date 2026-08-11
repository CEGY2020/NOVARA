/* Shared MM/DD/YY date formatting for form fields (storage remains YYYY-MM-DD). */
(function (global) {
  function digitsOnly(value) {
    return String(value == null ? "" : value).replace(/\D/g, "");
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  /**
   * Expand a 2-digit year to a full year.
   * Follow-up / install dates are near-term business dates → 00–99 → 2000–2099.
   */
  function fullYearFromTwoDigit(yy) {
    var n = Number(yy);
    if (!Number.isFinite(n) || n < 0 || n > 99) return null;
    return 2000 + n;
  }

  function isValidYmd(year, month, day) {
    if (
      !Number.isFinite(year) ||
      !Number.isFinite(month) ||
      !Number.isFinite(day)
    ) {
      return false;
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return false;
    }
    var date = new Date(year, month - 1, day);
    return (
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
    );
  }

  /**
   * Progressive mask while typing: MM/DD/YY (up to 6 digits).
   * Empty input returns "".
   */
  function formatDateMMDDYY(value) {
    var digits = digitsOnly(value).slice(0, 6);
    if (!digits) {
      return "";
    }
    if (digits.length <= 2) {
      return digits;
    }
    if (digits.length <= 4) {
      return digits.slice(0, 2) + "/" + digits.slice(2);
    }
    return (
      digits.slice(0, 2) +
      "/" +
      digits.slice(2, 4) +
      "/" +
      digits.slice(4)
    );
  }

  /** Convert YYYY-MM-DD → MM/DD/YY. Invalid/empty → "". */
  function isoToDisplay(value) {
    var raw = String(value == null ? "" : value).trim();
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (!match) {
      return "";
    }
    var year = Number(match[1]);
    var month = Number(match[2]);
    var day = Number(match[3]);
    if (!isValidYmd(year, month, day)) {
      return "";
    }
    return pad2(month) + "/" + pad2(day) + "/" + pad2(year % 100);
  }

  /**
   * Convert MM/DD/YY (also accepts M/D/YY) → YYYY-MM-DD.
   * Returns "" for empty, null for invalid non-empty input.
   * Also accepts already-ISO YYYY-MM-DD values.
   */
  function displayToIso(value) {
    var raw = String(value == null ? "" : value).trim();
    if (!raw) {
      return "";
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      var isoParts = raw.split("-");
      var isoY = Number(isoParts[0]);
      var isoM = Number(isoParts[1]);
      var isoD = Number(isoParts[2]);
      if (!isValidYmd(isoY, isoM, isoD)) {
        return null;
      }
      return isoY + "-" + pad2(isoM) + "-" + pad2(isoD);
    }

    var match = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(raw);
    if (!match) {
      return null;
    }
    var month = Number(match[1]);
    var day = Number(match[2]);
    var year = fullYearFromTwoDigit(match[3]);
    if (year == null || !isValidYmd(year, month, day)) {
      return null;
    }
    return year + "-" + pad2(month) + "-" + pad2(day);
  }

  function syncPickerFromText(textInput, pickerInput) {
    if (!pickerInput) return;
    var iso = displayToIso(textInput.value);
    pickerInput.value = iso || "";
  }

  function syncTextFromPicker(textInput, pickerInput) {
    if (!pickerInput) return;
    textInput.value = isoToDisplay(pickerInput.value);
  }

  /**
   * Bind a text input (MM/DD/YY) to an optional native date picker input.
   * Keeps both in sync; storage conversion is caller's responsibility via displayToIso.
   */
  function bindDateInput(textInput, pickerInput) {
    if (!textInput || textInput.getAttribute("data-date-bound") === "1") {
      return;
    }
    textInput.setAttribute("data-date-bound", "1");

    textInput.addEventListener("input", function () {
      var formatted = formatDateMMDDYY(textInput.value);
      if (textInput.value !== formatted) {
        textInput.value = formatted;
      }
      syncPickerFromText(textInput, pickerInput);
    });

    textInput.addEventListener("blur", function () {
      var formatted = formatDateMMDDYY(textInput.value);
      var iso = displayToIso(formatted);
      if (iso) {
        textInput.value = isoToDisplay(iso);
      } else if (!String(textInput.value || "").trim()) {
        textInput.value = "";
      } else {
        textInput.value = formatted;
      }
      syncPickerFromText(textInput, pickerInput);
    });

    if (pickerInput) {
      pickerInput.addEventListener("change", function () {
        syncTextFromPicker(textInput, pickerInput);
      });
      pickerInput.addEventListener("input", function () {
        syncTextFromPicker(textInput, pickerInput);
      });
    }

    if (textInput.value) {
      var initial = textInput.value;
      var fromIso = isoToDisplay(initial);
      textInput.value = fromIso || formatDateMMDDYY(initial);
      syncPickerFromText(textInput, pickerInput);
    }
  }

  /**
   * Set a bound MM/DD/YY text field (and optional picker) from an ISO date.
   */
  function setDateFieldValue(textInput, isoValue, pickerInput) {
    if (!textInput) return;
    var display = isoToDisplay(isoValue);
    textInput.value = display;
    if (pickerInput) {
      var iso = displayToIso(display);
      pickerInput.value = iso || "";
    }
  }

  global.NovaraDate = {
    digitsOnly: digitsOnly,
    formatDateMMDDYY: formatDateMMDDYY,
    isoToDisplay: isoToDisplay,
    displayToIso: displayToIso,
    bindDateInput: bindDateInput,
    setDateFieldValue: setDateFieldValue,
  };
})(window);
