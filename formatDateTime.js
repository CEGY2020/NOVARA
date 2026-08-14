/**
 * NOVARA Platform – Date/Time Formatting Utility
 * Formats dates as MM-DD-YY and time (e.g. 08-14-26 09:44 AM)
 */
(function (root) {
  function pad(n) {
    return n < 10 ? "0" + n : String(n);
  }

  /**
   * Readings store DynamoDB sort keys as ``{iso}#SYS001``.
   * Chart labels and Date parsing need the ISO timestamp only.
   */
  function stripReadingSortKey(input) {
    if (input == null) return "";
    var raw = String(input).trim();
    return raw.replace(/#(SYS\d+)$/i, "");
  }

  function parseDate(input) {
    if (input instanceof Date) return input;
    if (input == null || input === "") return new Date(NaN);
    var raw = stripReadingSortKey(input);
    if (!raw) return new Date(NaN);
    var dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (dateOnly) {
      return new Date(
        Number(dateOnly[1]),
        Number(dateOnly[2]) - 1,
        Number(dateOnly[3])
      );
    }
    return new Date(raw);
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
    if (mode === "datetime24") {
      return formatDateTime(input, { use24Hour: true });
    }
    return formatDateTime(input);
  }

  /**
   * Compact x-axis ticks: date-only for longer spans, 24-hour datetime otherwise.
   * "08-07-26" vs "08-07-26 20:30"
   */
  function chartTickMode(start, end) {
    var a = parseDate(start);
    var b = parseDate(end);
    if (isNaN(a.getTime()) || isNaN(b.getTime())) return "date";
    var hours = Math.abs(b.getTime() - a.getTime()) / 3600000;
    // 3- and 7-day ranges keep time; 30-day ticks stay date-only.
    return hours <= 192 ? "datetime24" : "date";
  }

  function formatAxisTick(input, mode) {
    var formatted = formatChartLabel(input, mode || "datetime24");
    return formatted || stripReadingSortKey(input);
  }

  /**
   * Display helper: date-only values stay MM-DD-YY; timestamps include time.
   * Returns "" for empty/invalid input so callers can substitute "—".
   */
  function formatDisplay(input, options) {
    if (input == null || input === "") return "";
    if (isDateOnly(input)) return formatDate(input);
    var formatted = formatDateTime(input, options);
    return formatted || stripReadingSortKey(input);
  }

  function formatOrDash(input, options) {
    return formatDisplay(input, options) || "—";
  }

  var api = {
    stripReadingSortKey: stripReadingSortKey,
    formatDate: formatDate,
    formatTime: formatTime,
    formatDateTime: formatDateTime,
    formatChartLabel: formatChartLabel,
    chartTickMode: chartTickMode,
    formatAxisTick: formatAxisTick,
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
