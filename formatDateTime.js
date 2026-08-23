/**
 * NOVARA Platform – Date/Time Formatting Utility
 * Formats dates as MM-DD-YY and time (e.g. 08-14-26 09:44 AM)
 */
(function (root) {
  function pad(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function parseDate(input) {
    if (input instanceof Date) return input;
    if (input == null || input === "") return new Date(NaN);
    var raw = String(input).trim();
    if (!raw) return new Date(NaN);
    var dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (dateOnly) {
      return new Date(
        Number(dateOnly[1]),
        Number(dateOnly[2]) - 1,
        Number(dateOnly[3])
      );
    }
    var date = new Date(raw);
    return date;
  }

  function isDateOnly(input) {
    return typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.trim());
  }

  function formatDate(input) {
    var d = parseDate(input);
    if (isNaN(d.getTime())) return "";
    var mm = pad(d.getMonth() + 1);
    var dd = pad(d.getDate());
    var yy = String(d.getFullYear()).slice(-2);
    return mm + "-" + dd + "-" + yy;
  }

  function formatTime(input) {
    var d = parseDate(input);
    if (isNaN(d.getTime())) return "";
    var hours = d.getHours();
    var minutes = pad(d.getMinutes());
    var ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    hours = hours ? hours : 12;
    return pad(hours) + ":" + minutes + " " + ampm;
  }

  function formatDateTime(input, options) {
    var d = parseDate(input);
    if (isNaN(d.getTime())) return "";
    options = options || {};
    var includeSeconds = Boolean(options.includeSeconds);
    var use24Hour = Boolean(options.use24Hour);
    var datePart = formatDate(d);
    if (use24Hour) {
      var hh = pad(d.getHours());
      var mm = pad(d.getMinutes());
      var ss = includeSeconds ? ":" + pad(d.getSeconds()) : "";
      return datePart + " " + hh + ":" + mm + ss;
    }
    var hours = d.getHours();
    var minutes = pad(d.getMinutes());
    var seconds = includeSeconds ? ":" + pad(d.getSeconds()) : "";
    var ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    hours = hours ? hours : 12;
    return datePart + " " + pad(hours) + ":" + minutes + seconds + " " + ampm;
  }

  function formatChartLabel(input, mode) {
    mode = mode || "datetime";
    if (mode === "date") return formatDate(input);
    if (mode === "time") return formatTime(input);
    return formatDateTime(input);
  }

  /**
   * Display helper: date-only values stay MM-DD-YY; timestamps include time.
   * Returns "" for empty/invalid input so callers can substitute "—".
   */
  function formatDisplay(input, options) {
    if (input == null || input === "") return "";
    if (isDateOnly(input)) return formatDate(input);
    var formatted = formatDateTime(input, options);
    return formatted || String(input);
  }

  function formatOrDash(input, options) {
    return formatDisplay(input, options) || "—";
  }

  var api = {
    formatDate: formatDate,
    formatTime: formatTime,
    formatDateTime: formatDateTime,
    formatChartLabel: formatChartLabel,
    formatDisplay: formatDisplay,
    formatOrDash: formatOrDash,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.NovaraDateTime = api;
  }
})(
  typeof window !== "undefined"
    ? window
    : typeof global !== "undefined"
      ? global
      : this
);
